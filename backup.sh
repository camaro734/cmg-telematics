#!/bin/bash
# CMG Track — Backup diario PostgreSQL + Google Drive
BACKUP_DIR=/opt/backups/cmg-track
DATE=$(date +%Y%m%d_%H%M)
FILE="$BACKUP_DIR/cmg_telematics_${DATE}.sql.gz"
TELEGRAM_TOKEN="7604956704:AAH_nOUf2i9mLiECiVSHnYrPVhfLXe6F0cQ"
CHAT_ID="5597545280"

# Dump comprimido
docker exec cmg-telematic1_postgres_1 pg_dump -U cmg cmg_telematics | gzip > "$FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$FILE" | cut -f1)
  # Borrar backups locales de más de 7 días
  find "$BACKUP_DIR" -name '*.sql.gz' -mtime +7 -delete
  COUNT=$(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)

  # Subir a Google Drive
  rclone copy "$BACKUP_DIR" gdrive:CMGTrack-Backups --timeout 60s 2>/dev/null
  DRIVE_OK=$?
  DRIVE_MSG=""
  [ $DRIVE_OK -eq 0 ] && DRIVE_MSG="%0A☁️ Subido a Google Drive" || DRIVE_MSG="%0A⚠️ Fallo subida a Drive"

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=💾 *Backup CMG Track OK*%0AArchivo: $(basename $FILE)%0ATamaño: $SIZE%0ABackups guardados: $COUNT${DRIVE_MSG}" \
    -d "parse_mode=Markdown" > /dev/null 2>&1
else
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=🚨 *Backup CMG Track FALLIDO* — Revisar servidor" \
    -d "parse_mode=Markdown" > /dev/null 2>&1
fi
