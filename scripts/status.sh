#!/bin/bash
# ============================================================
# GEODAILY — Estado General de Todos los Servicios
# ============================================================
# Uso: geodaily-status
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

check_svc() {
    local name="$1"
    local status="$2"
    if [ "$status" = "active" ] || [ "$status" = "running" ] || [ "$status" = "healthy" ]; then
        echo -e "  ${GREEN}✅${NC} $name"
    elif [ "$status" = "inactive" ] || [ "$status" = "dead" ] || [ "$status" = "exited" ]; then
        echo -e "  ${RED}❌${NC} $name ($status)"
    else
        echo -e "  ${YELLOW}⚠️${NC} $name ($status)"
    fi
}

echo -e "\n${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  🌱 GEODAILY — Estado de Servicios${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}\n"

# --- Servicios Node.js (systemd) ---
echo -e "${BOLD}📡 Servicios Node.js:${NC}"
for svc in geodaily-backend geodaily-expo; do
    s=$(systemctl is-active "$svc" 2>/dev/null)
    check_svc "$svc ($(systemctl show -p Description "$svc" 2>/dev/null | cut -d= -f2- | head -c60))" "$s"
done

echo -e "\n${BOLD}🐳 Contenedores Docker:${NC}"
for container in qgis-postgis qgis-server qgis-nginx qgis-geo-api openproject-app openproject-db openproject-cache; do
    status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
    health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null)
    if [ "$status" = "running" ]; then
        if [ -n "$health" ] && [ "$health" != "<no value>" ]; then
            check_svc "${container} (${health})" "$health"
        else
            echo -e "  ${GREEN}✅${NC} $container (running)"
        fi
    else
        check_svc "$container" "$status"
    fi
done

echo -e "\n${BOLD}🔌 Health Checks HTTP:${NC}"
endpoints=(
    "Backend API:http://localhost:8089/health"
    "Geo API:http://localhost:8000/health"
    "Expo:http://localhost:8082"
)
for ep in "${endpoints[@]}"; do
    name="${ep%%:*}"
    url="${ep#*:}"
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
    if [[ "$code" =~ ^(200|301|302|401|403)$ ]]; then
        echo -e "  ${GREEN}✅${NC} $name (HTTP $code)"
    else
        echo -e "  ${RED}❌${NC} $name (HTTP $code)"
    fi
done

echo -e "\n${BOLD}🗺️  QGIS WMS:${NC}"
if curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:8088/qgis/?SERVICE=WMS&REQUEST=GetCapabilities" 2>/dev/null | grep -q 200; then
    echo -e "  ${GREEN}✅${NC} QGIS WMS (8088) — operativo"
    layers=$(curl -s "http://localhost:8088/qgis/?SERVICE=WMS&REQUEST=GetCapabilities" 2>/dev/null | grep -oP '<Name>[^<]+</Name>' | grep -v "WMS" | grep -v "Colombia" | tr -d '\t' | paste -sd,)
    echo -e "     Capas: ${layers:-ninguna}"
else
    echo -e "  ${RED}❌${NC} QGIS WMS (8088) — no responde"
fi

echo -e "\n${BOLD}📊 Últimas ejecuciones del watchdog:${NC}"
tail -5 /var/log/geodaily-watchdog.log 2>/dev/null | while read line; do
    echo "  $line"
done

echo -e "\n${CYAN}════════════════════════════════════════════${NC}"
echo -e "  ${BOLD}systemd activos:${NC} $(systemctl list-units --type=service --state=running 2>/dev/null | grep -c "geodaily")"
echo -e "  ${BOLD}Contenedores running:${NC} $(docker ps -q 2>/dev/null | wc -l)"
echo -e "  ${BOLD}Watchdog:${NC} $(crontab -l 2>/dev/null | grep -c watchdog) tarea(s) en cron"
echo -e "${CYAN}════════════════════════════════════════════${NC}\n"
