#!/bin/bash
echo "======================================="
echo " CMG Track — Estado del sistema"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================="

echo ""
echo "── CONTENEDORES ──"
for SVC in cmg-telematic1_postgres_1 cmg-telematic1_redis_1 cmg-telematic1_core-api_1 cmg-telematic1_ingest-svc_1 cmg-telematic1_frontend_1 cmg-telematic1_caddy_1; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$SVC" 2>/dev/null || echo 'no encontrado')
  ICON="✅"
  [ "$STATUS" != "running" ] && ICON="❌"
  printf "  %s %-45s %s\n" "$ICON" "$SVC" "$STATUS"
done

echo ""
echo "── WEB ──"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://cmgtrack.com/)
[ "$HTTP" = "200" ] && echo "  ✅ cmgtrack.com → HTTP $HTTP" || echo "  ❌ cmgtrack.com → HTTP $HTTP"

echo ""
echo "── RECURSOS ──"
echo "  Disco: $(df -h / | awk 'NR==2{print $5" usado de "$2}')"
echo "  RAM:   $(free -h | awk 'NR==2{print $3" usado de "$2}')"
echo "  CPU:   $(top -bn1 | grep 'Cpu(s)' | awk '{print $2"% en uso"}' 2>/dev/null || echo 'n/a')"

echo ""
echo "── BACKUPS ──"
LAST=$(ls -t /opt/backups/cmg-track/*.sql.gz 2>/dev/null | head -1)
if [ -n "$LAST" ]; then
  echo "  Último: $(basename $LAST) ($(du -sh $LAST | cut -f1))"
  echo "  Hace:   $(( (  $(date +%s) - $(stat -c%Y $LAST) ) / 3600 )) horas"
else
  echo "  ❌ Sin backups"
fi

echo ""
echo "── CLIENTES ──"
docker exec cmg-telematic1_postgres_1 psql -U cmg -d cmg_telematics   -c "SELECT name, (SELECT COUNT(*) FROM vehicle WHERE tenant_id=t.id) as vehiculos FROM tenant t ORDER BY name;"   -t 2>/dev/null | grep -v '^$' | while read line; do echo "  $line"; done

echo ""
