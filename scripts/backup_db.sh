#!/usr/bin/env bash
# scripts/backup_db.sh
# Backup de TimescaleDB (PostgreSQL) usando pg_dump dentro del contenedor Docker.
#
# Uso manual:
#   ./scripts/backup_db.sh
#
# Cron recomendado (diario a las 02:00, retención de 30 días):
#   0 2 * * * /opt/cmg-telematic1/scripts/backup_db.sh >> /var/log/cmg-backup.log 2>&1
#
# Variables de entorno requeridas (se leen del .env si existe):
#   POSTGRES_USER     — usuario PostgreSQL
#   POSTGRES_DB       — nombre de la base de datos
#   BACKUP_DIR        — directorio de destino (default: /opt/cmg-telematic1/backups)
#   BACKUP_RETENTION_DAYS — días de retención (default: 30)

set -euo pipefail

# ── Cargar .env si existe y las variables no están ya definidas ──────────────
ENV_FILE="$(dirname "$0")/../.env"
if [[ -f "$ENV_FILE" ]]; then
    # Solo exportar variables que aún no están definidas en el entorno
    set -o allexport
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +o allexport
fi

# ── Configuración ────────────────────────────────────────────────────────────
POSTGRES_USER="${POSTGRES_USER:-cmg}"
POSTGRES_DB="${POSTGRES_DB:-cmg_telematics}"
BACKUP_DIR="${BACKUP_DIR:-/opt/cmg-telematic1/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${POSTGRES_DB}_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="cmg-telematic1-postgres-1"   # nombre por defecto de docker compose

# ── Crear directorio de backups si no existe ─────────────────────────────────
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date -Iseconds)] Iniciando backup de ${POSTGRES_DB}..."

# ── Verificar que el contenedor está corriendo ───────────────────────────────
if ! docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; then
    echo "[$(date -Iseconds)] ERROR: contenedor '${CONTAINER_NAME}' no está corriendo" >&2
    exit 1
fi

# ── Ejecutar pg_dump dentro del contenedor y comprimir en local ──────────────
# Usamos pg_dump con formato plain SQL comprimido con gzip.
# --no-password se ignora si PGPASSWORD está disponible en el contenedor.
if docker exec "$CONTAINER_NAME" \
    pg_dump \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --no-password \
    --format=plain \
    --no-acl \
    --no-owner \
    | gzip -9 > "$BACKUP_FILE"; then

    BACKUP_SIZE="$(du -sh "$BACKUP_FILE" | cut -f1)"
    echo "[$(date -Iseconds)] Backup completado: ${BACKUP_FILE} (${BACKUP_SIZE})"
else
    echo "[$(date -Iseconds)] ERROR: pg_dump falló" >&2
    # Eliminar archivo parcial
    rm -f "$BACKUP_FILE"
    exit 1
fi

# ── Verificar integridad: el archivo debe ser un gzip válido ─────────────────
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    echo "[$(date -Iseconds)] ERROR: el backup generado no es un gzip válido — eliminando" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# ── Crear enlace simbólico al último backup ──────────────────────────────────
ln -sf "$BACKUP_FILE" "${BACKUP_DIR}/latest.sql.gz"

# ── Limpieza: eliminar backups más antiguos que BACKUP_RETENTION_DAYS ────────
echo "[$(date -Iseconds)] Eliminando backups con más de ${BACKUP_RETENTION_DAYS} días..."
find "$BACKUP_DIR" -maxdepth 1 -name "${POSTGRES_DB}_*.sql.gz" \
    -mtime "+${BACKUP_RETENTION_DAYS}" -delete -print \
    | while read -r f; do
        echo "[$(date -Iseconds)] Eliminado: ${f}"
    done

# ── Resumen de backups existentes ────────────────────────────────────────────
BACKUP_COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -name "${POSTGRES_DB}_*.sql.gz" | wc -l)"
echo "[$(date -Iseconds)] Backup OK. Total backups almacenados: ${BACKUP_COUNT}"
