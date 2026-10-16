#!/usr/bin/env bash
# Compatibilidad con el cron anterior: DB + archivos cifrados y copia externa.
set -euo pipefail
exec node "${COMPOSE_DIR:-/opt/terreno/infra}/tools/ops.mjs" backup
