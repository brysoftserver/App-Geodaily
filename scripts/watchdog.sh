#!/bin/bash
# ============================================================
# GEODAILY — Watchdog de Servicios
# ============================================================
# Monitorea todos los servicios críticos y los reinicia
# automáticamente si detecta que están caídos.
#
# Uso:
#   ./watchdog.sh              # Una sola ejecución
#   ./watchdog.sh --loop       # Ejecución continua (cada 60s)
#   ./watchdog.sh --cron       # Una ejecución (para cron, log a syslog)
#
# Instalación en cron (cada minuto):
#   * * * * * /opt/App-movil/scripts/watchdog.sh --cron
# ============================================================

set -euo pipefail

# --- Configuración ---
LOG_FILE="/var/log/geodaily-watchdog.log"
DOCKER_COMPOSE_DIR="/opt/Qgis-server"
BACKEND_PORT=8089
EXPO_PORT=8082
GEO_API_PORT=8000
QGIS_PORT=8088  # Nginx proxy
POSTGIS_PORT=5433

# Colores para terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Funciones ---
log() {
    local level="$1"
    local msg="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${msg}" | tee -a "$LOG_FILE"
}

log_ok()    { log "${GREEN}OK${NC}"    "$1"; }
log_warn()  { log "${YELLOW}WARN${NC}" "$1"; }
log_error() { log "${RED}ERROR${NC}"   "$1"; }

check_http() {
    local name="$1"
    local url="$2"
    local timeout="${3:-5}"

    if curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null | grep -qE "200|301|302|401|403"; then
        return 0
    fi
    return 1
}

check_docker_container() {
    local container="$1"
    local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
    local health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null)

    if [ "$status" != "running" ]; then
        return 1
    fi
    if [ -n "$health" ] && [ "$health" != "healthy" ] && [ "$health" != "<no value>" ]; then
        return 2
    fi
    return 0
}

restart_systemd_service() {
    local service="$1"
    log_warn "Reiniciando servicio systemd: ${service}"
    systemctl restart "$service" 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet "$service"; then
        log_ok "Servicio ${service} reiniciado exitosamente"
        return 0
    else
        log_error "FALLO al reiniciar ${service}"
        return 1
    fi
}

restart_docker_service() {
    local container="$1"
    log_warn "Reiniciando contenedor Docker: ${container}"
    docker restart "$container" 2>/dev/null || true
    sleep 5
    local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
    if [ "$status" = "running" ]; then
        log_ok "Contenedor ${container} reiniciado exitosamente"
        return 0
    else
        log_error "FALLO al reiniciar contenedor ${container}"
        return 1
    fi
}

# --- Health Checks ---
TOTAL_CHECKS=0
FAILED_CHECKS=0

check_service() {
    local name="$1"
    local type="$2"  # "systemd", "docker", "http"
    local target="$3"
    local extra="$4"  # URL o puerto extra según el tipo

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    local ok=false

    case "$type" in
        systemd)
            if systemctl is-active --quiet "$target"; then
                ok=true
            else
                log_error "Servicio systemd CAÍDO: ${target}"
                restart_systemd_service "$target"
                FAILED_CHECKS=$((FAILED_CHECKS + 1))
            fi
            ;;
        docker)
            local container="$target"
            local check_result=0
            check_docker_container "$container" || check_result=$?
            if [ "$check_result" -eq 0 ]; then
                ok=true
            else
                log_error "Contenedor CAÍDO: ${container} (status: $(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null))"
                restart_docker_service "$container"
                FAILED_CHECKS=$((FAILED_CHECKS + 1))
            fi
            ;;
        http)
            if check_http "$name" "$target" "${extra:-5}"; then
                ok=true
            else
                # Reintentar después de 3 segundos (evita falsos positivos)
                log_warn "HTTP SIN RESPUESTA: ${name} — reintentando en 3s..."
                sleep 3
                if check_http "$name" "$target" "${extra:-5}"; then
                    log_ok "${name} (recuperado tras reintento)"
                    ok=true
                else
                    log_error "HTTP CAÍDO: ${name} (${target})"
                    # Intentar reiniciar el servicio asociado
                    if [ -n "$extra" ] && [ "$extra" != "0" ]; then
                        if [[ "$extra" == systemd:* ]]; then
                            restart_systemd_service "${extra#systemd:}"
                        elif [[ "$extra" == docker:* ]]; then
                            restart_docker_service "${extra#docker:}"
                        fi
                    fi
                    FAILED_CHECKS=$((FAILED_CHECKS + 1))
                fi
            fi
            ;;
    esac

    if [ "$ok" = true ]; then
        log_ok "${name}"
    fi
}

# ============================================================
# MAIN
# ============================================================
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

# Si es modo --cron o --loop, mostrar banner
if [ "${1:-}" = "--cron" ] || [ "${1:-}" = "--loop" ]; then
    echo "=== GEODAILY Watchdog $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG_FILE"
fi

# ============================================================
# 1. Servicios Node.js (systemd)
# ============================================================
check_service "Backend API (8089)"     systemd "geodaily-backend.service" ""
check_service "Expo Dev Server (8082)" systemd "geodaily-expo.service"    ""

# ============================================================
# 2. Health endpoints HTTP (verificación funcional)
# ============================================================
check_service "Backend Health"  http "http://localhost:${BACKEND_PORT}/health"  ""
check_service "Geo API Health"  http "http://localhost:${GEO_API_PORT}/health"  "docker:qgis-geo-api"

# ============================================================
# 3. Contenedores Docker
# ============================================================
check_service "PostGIS"         docker "qgis-postgis" ""
check_service "QGIS Server"     docker "qgis-server"  ""
check_service "Nginx (QGIS)"    docker "qgis-nginx"   ""
check_service "Geo API"         docker "qgis-geo-api" ""

# ============================================================
# 4. QGIS WMS (verificación funcional)
# ============================================================
if check_http "QGIS WMS" "http://localhost:${QGIS_PORT}/qgis/?SERVICE=WMS&REQUEST=GetCapabilities" 15; then
    log_ok "QGIS WMS (8088)"
else
    log_error "QGIS WMS NO RESPONDE (puerto ${QGIS_PORT})"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# ============================================================
# Resumen
# ============================================================
PASSED=$((TOTAL_CHECKS - FAILED_CHECKS))
echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
echo -e "  Resumen: ${GREEN}${PASSED}${NC}/${TOTAL_CHECKS} checks exitosos"
if [ "$FAILED_CHECKS" -gt 0 ]; then
    echo -e "  ⚠️  ${RED}${FAILED_CHECKS} servicio(s) fueron reiniciados${NC}"
fi
echo -e "${GREEN}═══════════════════════════════════════${NC}\n"

# Si se encontraron fallos, loggear a syslog también
if [ "$FAILED_CHECKS" -gt 0 ]; then
    logger -t geodaily-watchdog "⚠️  ${FAILED_CHECKS}/${TOTAL_CHECKS} servicios fallaron - acciones de recuperación ejecutadas"
fi

# ============================================================
# Modo loop: ejecutar cada 60 segundos
# ============================================================
if [ "${1:-}" = "--loop" ]; then
    sleep 60
    exec "$0" --loop
fi

exit $FAILED_CHECKS
