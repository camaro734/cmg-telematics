#!/bin/bash
# CMG Track — Backup diario PostgreSQL + Google Drive
BACKUP_DIR=/opt/backups/cmg-track
DATE=$(date +%Y%m%d_%H%M)
FILE="$BACKUP_DIR/cmg_telematics_${DATE}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/uploads_${DATE}.tar.gz"
TELEGRAM_TOKEN=$(cat /root/.telegram-token 2>/dev/null)
if [ -z "$TELEGRAM_TOKEN" ]; then
  echo "WARNING: /root/.telegram-token vacío o inexistente. Notificaciones DESHABILITADAS." >&2
fi
CHAT_ID="5597545280"

# Dump comprimido
docker exec cmg-telematic1_postgres_1 pg_dump -U cmg cmg_telematics | gzip > "$FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$FILE" | cut -f1)
  # Borrar backups locales de más de 7 días
  find "$BACKUP_DIR" -name '*.sql.gz' -mtime +7 -delete
  find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -mtime +7 -delete
  COUNT=$(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)

  # Backup uploads (fotos, firmas, iconos)
  UPLOADS_SRC=/var/lib/docker/volumes/cmg-telematic1_uploads_data/_data
  UPLOADS_MSG=""
  if [ -d "$UPLOADS_SRC" ] && [ "$(ls -A $UPLOADS_SRC)" ]; then
    tar -czf "$UPLOADS_FILE" -C "$UPLOADS_SRC" . 2>/dev/null
    if [ $? -eq 0 ]; then
      UPLOADS_SIZE=$(du -sh "$UPLOADS_FILE" | cut -f1)
      UPLOADS_MSG="%0A📁 Uploads: $UPLOADS_SIZE"
    else
      UPLOADS_MSG="%0A⚠️ Fallo backup uploads"
    fi
  else
    UPLOADS_MSG="%0A📁 Uploads: vacío (sin archivos)"
  fi

  # Subir a Google Drive
  rclone copy "$BACKUP_DIR" gdrive:CMGTrack-Backups --timeout 60s 2>/dev/null
  DRIVE_OK=$?
  DRIVE_MSG=""
  [ $DRIVE_OK -eq 0 ] && DRIVE_MSG="%0A☁️ Subido a Google Drive" || DRIVE_MSG="%0A⚠️ Fallo subida a Drive"

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=💾 <b>Backup CMG Track OK</b>%0AArchivo: $(basename $FILE)%0ATamaño: $SIZE%0ABackups guardados: $COUNT${UPLOADS_MSG}${DRIVE_MSG}" \
    -d "parse_mode=HTML" >> /var/log/cmg-telegram.log 2>&1
else
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=🚨 <b>Backup CMG Track FALLIDO</b> — Revisar servidor" \
    -d "parse_mode=HTML" >> /var/log/cmg-telegram.log 2>&1
fi
