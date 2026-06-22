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

## Valhalla — build de teselas Europa (primera vez y re-builds)

> ⚠️ Operación puntual, **fuera de hora punta**. Requiere ~110 GB libres en disco durante el build;
> el pico se reduce a ~80 GB tras borrar el `.pbf`.

### Prerrequisito: espacio en disco

```bash
df -h /
# Necesario: ≥ 110 GB libres antes de arrancar
```

### Paso 1: arrancar solo Valhalla y seguir los logs

```bash
cd /opt/cmg-telematic1
docker compose up -d valhalla
docker compose logs -f valhalla
```

El contenedor descargará `europe-latest.osm.pbf` (~28 GB) y construirá las teselas de ruta.
El proceso completo tarda entre 1 y 3 horas. Esperar la línea `Running tile service` en los logs.

### Paso 2: borrar el `.pbf` tras generar teselas (recuperar disco)

Una vez que Valhalla sirve peticiones, el `.pbf` ya no es necesario:

```bash
docker compose exec valhalla sh -c 'rm -f /custom_files/*.osm.pbf'
df -h /
# Resultado esperado: ~80 GB ocupados por el volumen, margen recuperado
```

### Paso 3: verificar que responde en la red interna

```bash
docker compose exec core-api python -c "
import httpx
print(httpx.post(
    'http://valhalla:8002/route',
    json={
        'locations': [{'lat': 39.47, 'lon': -0.38}, {'lat': 41.39, 'lon': 2.17}],
        'costing': 'auto'
    }
).json()['trip']['summary'])
"
# Esperado: dict con 'length' (km) y 'time' (s) > 0 (ruta Valencia → Barcelona)
```

### Re-build futuro (actualizar teselas)

Para actualizar la cartografía (p.ej. nuevas carreteras), basta con cambiar `tile_urls`
en `docker-compose.yml` apuntando a un `.pbf` más reciente y reiniciar el servicio:

```bash
# Editar docker-compose.yml: tile_urls=<nueva_url>
# Borrar teselas antiguas del volumen
docker compose exec valhalla sh -c 'rm -rf /custom_files/*'
docker compose restart valhalla
docker compose logs -f valhalla
# Esperar 'Running tile service', luego borrar el .pbf (Paso 2)
```

## Lección importante

**git push NO despliega.** Solo actualiza GitHub. El deploy requiere
rebuild manual de los servicios afectados según los pasos de arriba.

## Tarea futura

Migrar los contenedores core-api e ingest-svc a gestión completa con
docker-compose para que `docker-compose up -d --build` funcione
directamente. Pendiente de Semana 2 o posterior.
