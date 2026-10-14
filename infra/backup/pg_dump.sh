#!/usr/bin/env bash
# Backup nocturno de PostgreSQL (ADR-002). Pensado para correr en el VPS por cron:
#
#   0 3 * * * /opt/terreno/infra/backup/pg_dump.sh >> /var/log/terreno-backup.log 2>&1
#
# Genera un dump comprimido del contenedor `db` y aplica retención local.
# IMPORTANTE (ADR-002): la copia FUERA del VPS es obligatoria; ver el bloque final.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/terreno/infra}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/terreno/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-terreno}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/terreno-$STAMP.sql.gz"

docker compose -f "$COMPOSE_DIR/$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$OUT"

echo "[$(date -Is)] backup OK: $OUT ($(du -h "$OUT" | cut -f1))"

# Retención: borra dumps locales más viejos que RETENTION_DAYS.
find "$BACKUP_DIR" -name 'terreno-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

# --- Copia fuera del VPS (obligatorio) -------------------------------------
# El dump en el mismo host NO es un backup. Configura una de estas y descomenta:
#
#   rclone copy "$OUT" remoto:terreno-backups/            # S3/B2/Drive vía rclone
#   rsync -az "$OUT" usuario@otro-host:/srv/backups/      # segundo host
