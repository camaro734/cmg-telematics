# Proceso de deploy CMG Track

## Por qué este documento

Los contenedores core-api e ingest-svc se crearon originalmente con
`docker run` (no con `docker-compose up`). Por eso `docker-compose up -d
--build` falla — compose no puede recrear contenedores que él no creó.

Por ahora se mantiene este procedimiento manual hasta que se
re-orquesten los contenedores con compose (tarea futura).

## Pasos para rebuild + deploy de un servicio

### core-api

```bash
# 1. Build de la nueva imagen (sin corte de servicio)
cd /opt/cmg-telematic1
docker-compose build core-api

# 2. Swap del contenedor (~11s corte)
docker stop cmg-telematic1_core-api_1
docker rm cmg-telematic1_core-api_1
docker run -d \
  --name cmg-telematic1_core-api_1 \
  --network cmg-telematic1_default \
  --network-alias core-api \
  --restart unless-stopped \
  -p 127.0.0.1:8010:8010 \
  --env-file /opt/cmg-telematic1/.env \
  -v cmg-telematic1_uploads_data:/app/uploads \
  cmg-telematic1_core-api

# 3. Verificar
sleep 15
docker ps | grep core-api
docker logs cmg-telematic1_core-api_1 --tail 20
```

### ingest-svc

```bash
cd /opt/cmg-telematic1
docker-compose build ingest-svc

docker stop cmg-telematic1_ingest-svc_1
docker rm cmg-telematic1_ingest-svc_1
docker run -d \
  --name cmg-telematic1_ingest-svc_1 \
  --network cmg-telematic1_default \
  --network-alias ingest-svc \
  --restart unless-stopped \
  -p 0.0.0.0:5027:5027 \
  --memory 512m --cpus 1.0 \
  --env-file /opt/cmg-telematic1/.env \
  cmg-telematic1_ingest-svc

sleep 15
docker ps | grep ingest
docker logs cmg-telematic1_ingest-svc_1 --tail 20
```

## Verificación post-deploy

Después de cada rebuild, verificar que el código nuevo está dentro:

```bash
docker exec cmg-telematic1_core-api_1 grep <patrón> /app/<ruta>
```

Y que los servicios siguen procesando:

```bash
docker exec cmg-telematic1_postgres_1 psql -U cmg -d cmg_telematics -c "
SELECT imei, last_seen FROM device ORDER BY last_seen DESC LIMIT 3;
"
```

## Lección importante

**git push NO despliega.** Solo actualiza GitHub. El deploy requiere
rebuild manual de los servicios afectados según los pasos de arriba.

## Tarea futura

Migrar los contenedores core-api e ingest-svc a gestión completa con
docker-compose para que `docker-compose up -d --build` funcione
directamente. Pendiente de Semana 2 o posterior.
