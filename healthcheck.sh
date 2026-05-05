#!/bin/bash
# CMG Track Health Monitor — ejecuta cada 5 minutos via cron
LOG=/var/log/cmg-healthcheck.log
TELEGRAM_TOKEN=7604956704:AAH_nOUf2i9mLiECiVSHnYrPVhfLXe6F0cQ
CHAT_ID=5597545280
ALERT_SENT=/tmp/cmg-alert-sent

send_alert() {
  local msg="$1"
  # Evitar spam: solo enviar si no hemos alertado en los últimos 30 min
  if [ ! -f "$ALERT_SENT" ] || [ $(find "$ALERT_SENT" -mmin +30 2>/dev/null | wc -l) -gt 0 ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${CHAT_ID}" \
      -d "text=$msg" \
      -d "parse_mode=Markdown" > /dev/null 2>&1
    touch "$ALERT_SENT"
    echo "$(date): ALERT: $msg" >> "$LOG"
  fi
}

send_recovery() {
  local msg="$1"
  if [ -f "$ALERT_SENT" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${CHAT_ID}" \
      -d "text=$msg" \
      -d "parse_mode=Markdown" > /dev/null 2>&1
    rm -f "$ALERT_SENT"
    echo "$(date): RECOVERY: $msg" >> "$LOG"
  fi
}

FAILED=0
ISSUES=""

# 1. Comprobar contenedores críticos
for SVC in cmg-telematic1_core-api_1 cmg-telematic1_frontend_1 cmg-telematic1_postgres_1 cmg-telematic1_redis_1 cmg-telematic1_caddy_1; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$SVC" 2>/dev/null)
  if [ "$STATUS" != "running" ]; then
    ISSUES+="\n❌ Contenedor caído: $SVC (status: ${STATUS:-no encontrado})"
    FAILED=1
    # Intentar reiniciar automáticamente
    docker start "$SVC" 2>/dev/null
  fi
done

# 2. Comprobar que la web responde
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://cmgtrack.com/ 2>/dev/null)
if [ "$HTTP" != "200" ]; then
  ISSUES+="\n❌ Web no responde (HTTP $HTTP)"
  FAILED=1
fi

# 3. Comprobar API
API=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://cmgtrack.com/api/v1/auth/login -X POST -H 'Content-Type: application/json' -d '{"email":"x","password":"x"}' 2>/dev/null)
if [ "$API" != "401" ] && [ "$API" != "422" ] && [ "$API" != "429" ]; then
  ISSUES+="\n❌ API no responde (HTTP $API)"
  FAILED=1
fi

# 4. Comprobar espacio en disco
DISK=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK" -gt 85 ]; then
  ISSUES+="\n⚠️ Disco al ${DISK}% — liberar espacio"
  FAILED=1
fi

# 5. Comprobar memoria
MEM_FREE=$(free -m | awk 'NR==2{print $7}')
if [ "$MEM_FREE" -lt 200 ]; then
  ISSUES+="\n⚠️ Memoria disponible: ${MEM_FREE}MB — riesgo de OOM"
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  send_alert "🚨 *CMG Track — Problema detectado*$ISSUES"
else
  send_recovery "✅ *CMG Track — Recuperado* — Todos los servicios operativos"
  # Limpiar log viejo si todo OK
  [ $(wc -l < "$LOG" 2>/dev/null || echo 0) -gt 500 ] && tail -100 "$LOG" > "$LOG".tmp && mv "$LOG".tmp "$LOG"
fi
