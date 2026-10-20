#!/bin/sh
# ============================================================
# GEODAILY — Libera el puerto 8089 antes de arrancar el backend
# ============================================================
# Reemplaza al antiguo `ExecStartPre=fuser -k 8089/tcp`, que no
# hacía nada porque `fuser` NO está instalado en este servidor.
# Por eso el servicio entraba en bucle de reinicio infinito con
# `EADDRINUSE: address already in use :::8089` (~65.000 veces).
#
# Aquí se busca el PID que realmente está escuchando en el 8089
# con `ss` (siempre presente en systemd) y se le envía TERM.
# Nunca falla: si no hay nada escuchando, termina con éxito.

PUERTO="${1:-8089}"

pids=$(ss -ltnpH "sport = :$PUERTO" 2>/dev/null \
  | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
  | sort -u)

if [ -z "$pids" ]; then
  echo "[puerto-$PUERTO] libre"
  exit 0
fi

for pid in $pids; do
  echo "[puerto-$PUERTO] liberando (pid $pid)"
  kill "$pid" 2>/dev/null
done

# Espera corta a que el socket se cierre (máx. ~3s)
i=0
while [ $i -lt 6 ]; do
  if ! ss -ltnH "sport = :$PUERTO" 2>/dev/null | grep -q .; then
    echo "[puerto-$PUERTO] liberado"
    exit 0
  fi
  sleep 0.5
  i=$((i + 1))
done

# Último recurso: el proceso no respondió a TERM
for pid in $pids; do
  echo "[puerto-$PUERTO] forzando cierre (pid $pid)"
  kill -9 "$pid" 2>/dev/null
done

sleep 0.5
exit 0
