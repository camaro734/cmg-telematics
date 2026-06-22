# Runbook de despliegue — Bloque 1 (Rutas + ETA, Valhalla)

> Turnkey para el VPS de producción `cmg-telematic1`. Commands copy-paste.
> **GATED**: cada paso que toca producción requiere OK explícito de Carlos.
> Rama con el código: `feat/rutas-eta-panel-flota`.
> El **Bloque 2 ya está desplegado** (panel configurable) — esto es solo el Bloque 1.

## Antes de empezar (requisitos)
- **Ventana tranquila**: el build de teselas de Valhalla descarga ~28 GB y tarda **1–3 h**.
- **Disco**: `df -h /` → **≥110 GB libres** (pico del build ~108 GB; hoy ~120 GB).
- Producción sin staging: la BD de Docker es la real de Wasterent/PREZERO.

Datos confirmados del entorno (2026-06-22):
- Red Docker: `cmg-telematic1_default`
- core-api: contenedor `cmg-telematic1_core-api_1`, imagen `cmg-telematic1_core-api` (build `./backend`), alias `core-api`, vol `cmg-telematic1_uploads_data:/app/uploads`, cmd `uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload`, puerto `127.0.0.1:8010:8010`. Imagen actual en vivo: `:060`.
- frontend: contenedor `cmg-telematic1_frontend_1`, imagen `cmg-telematic1_frontend`, alias `frontend`.
- BD: servicio `postgres`. Migraciones additive: `docker-compose run --rm --no-deps`.
- `VALHALLA_URL`/`NOMINATIM_URL`: `config.py` ya trae defaults (`http://valhalla:8002`, OSM público) → **.env opcional**.

---

## Paso 0 — Checkout de la rama en el checkout principal
El build debe hacerse desde `/opt/cmg-telematic1` (el nombre del directorio fija el prefijo de proyecto `cmg-telematic1`; NO construir desde el worktree o cambiarían los nombres de contenedor/red).

```bash
cd /opt/cmg-telematic1
git stash -u 2>/dev/null || true              # por si hay untracked (p.ej. mobile/CMG.html)
git checkout feat/rutas-eta-panel-flota
git log --oneline -1                           # confirmar HEAD de la rama
```

## Paso 1 — Migración 061 (additive)
Construir core-api con el código nuevo (incluye la migración 061 y los endpoints), luego aplicar la migración con ese código sin levantar dependencias.

```bash
cd /opt/cmg-telematic1
# Rollback tag de la imagen actual ANTES de reconstruir
docker tag cmg-telematic1_core-api:060 cmg-telematic1_core-api:rollback-pre-061

# Build (genera cmg-telematic1_core-api:latest con el código de la rama)
docker-compose build core-api

# Aplicar migración (compose inyecta DB_URL_SYNC desde .env; postgres ya está arriba)
docker-compose run --rm --no-deps core-api alembic upgrade head
```
**Verificar**: la salida debe mostrar `Running upgrade 060 -> 061, vehicle_destination`.
Comprobar la tabla (SELECT, permitido):
```bash
docker-compose exec postgres psql -U postgres -d cmg -c "\d vehicle_destination" 2>/dev/null \
  || docker-compose exec postgres psql -U postgres -c "\dt vehicle_destination"
```
(Ajustar usuario/BD reales si difieren — ver `.env` `DB_URL`.)

## Paso 2 — `.env` (OPCIONAL — el default interno ya funciona)
Solo si quieres override explícito. Modificar `.env` es gated.
```bash
# Añadir a /opt/cmg-telematic1/.env (opcional):
# VALHALLA_URL=http://valhalla:8002
# NOMINATIM_URL=https://nominatim.openstreetmap.org
```
> Nota: estas vars NO están en el bloque `environment:` del compose; el swap de core-api
> las inyecta vía `--env-file` (Paso 3). Sin tocar `.env`, `config.py` usa el default
> `http://valhalla:8002` (alias interno) → suficiente.

## Paso 3 — Swap de core-api a la imagen nueva (tag :061)
`docker-compose up` rompe al recrear (bug v1.29.2) → swap con `docker run`.
```bash
cd /opt/cmg-telematic1
docker tag cmg-telematic1_core-api:latest cmg-telematic1_core-api:061

OLD=$(docker ps -q --filter "name=cmg-telematic1_core-api_1")
docker stop "$OLD" && docker rm "$OLD"

docker run -d --name cmg-telematic1_core-api_1 \
  --network cmg-telematic1_default --network-alias core-api \
  --env-file /opt/cmg-telematic1/.env \
  -v cmg-telematic1_uploads_data:/app/uploads \
  -p 127.0.0.1:8010:8010 \
  --restart unless-stopped \
  cmg-telematic1_core-api:061 \
  uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```
**Verificar**:
```bash
docker logs cmg-telematic1_core-api_1 --tail 30 | grep -iE "error|started|application startup"
curl -s http://127.0.0.1:8010/health        # 200 OK
```

## Paso 4 — Valhalla (el paso largo; fuera de hora punta)
La rama añade el servicio `valhalla` (red interna, imagen pinned `3.5.1`, sin `ports:`).
```bash
cd /opt/cmg-telematic1
df -h /                                        # confirmar ≥110 GB libres
docker-compose up -d valhalla                  # primer arranque: descarga .pbf + build teselas
docker-compose logs -f valhalla                # esperar "Running tile service" (1–3 h)
```
Cuando sirva, **borrar el .pbf** para bajar de ~108 GB a ~80 GB:
```bash
docker-compose exec valhalla sh -c 'rm -f /custom_files/*.osm.pbf'
df -h /
```
**Verificar** (ruta Valencia→Barcelona desde core-api, red interna):
```bash
docker-compose exec core-api python -c "import httpx; print(httpx.post('http://valhalla:8002/route', json={'locations':[{'lat':39.47,'lon':-0.38},{'lat':41.39,'lon':2.17}],'costing':'auto'}).json()['trip']['summary'])"
```
> Caveat v1.29.2: `up -d valhalla` solo es seguro en el PRIMER arranque (servicio nuevo).
> Para reconstruir teselas después: `docker-compose restart valhalla` o swap con `docker run`,
> NO `up` (recrea → KeyError ContainerConfig).

## Paso 5 — Rebuild + swap del frontend (desde la rama completa)
Ahora sí desde la rama completa (incluye la UI de búsqueda/ruta/ETA del Bloque 1).
```bash
cd /opt/cmg-telematic1
docker tag cmg-telematic1_frontend:latest cmg-telematic1_frontend:rollback-pre-bloque1

docker-compose build frontend
OLD=$(docker ps -q --filter "name=cmg-telematic1_frontend_1")
docker stop "$OLD" && docker rm "$OLD"
docker run -d --name cmg-telematic1_frontend_1 \
  --network cmg-telematic1_default --network-alias frontend \
  --restart unless-stopped cmg-telematic1_frontend
```
**Verificar**: `docker logs cmg-telematic1_frontend_1 --tail 5` (nginx start sin error);
en `cmgtrack.com` → Flota → buscar una ubicación, "enviar destino" a un vehículo, ver ETA.

## Paso 6 — Cierre
```bash
cd /opt/cmg-telematic1
git checkout master            # devolver el checkout a master
git stash pop 2>/dev/null || true
```

---

## Rollback por servicio (si algo falla)
**core-api** → imagen previa:
```bash
docker stop cmg-telematic1_core-api_1 && docker rm cmg-telematic1_core-api_1
docker run -d --name cmg-telematic1_core-api_1 \
  --network cmg-telematic1_default --network-alias core-api \
  --env-file /opt/cmg-telematic1/.env -v cmg-telematic1_uploads_data:/app/uploads \
  -p 127.0.0.1:8010:8010 --restart unless-stopped \
  cmg-telematic1_core-api:rollback-pre-061 \
  uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```
> La migración 061 es **additive** (solo crea la tabla `vehicle_destination`); el código :060
> la ignora, así que NO hace falta downgrade para volver atrás el core-api. Si aun así
> quisieras revertir el esquema: `docker-compose run --rm --no-deps core-api alembic downgrade 060`.

**frontend** → `cmg-telematic1_frontend:rollback-pre-bloque1` (mismo patrón de swap).

**valhalla** → `docker-compose stop valhalla` (el resto del sistema funciona sin él; el ETA
solo deja de pintarse, `route=null`, sin romper).

## Orden y dependencias (resumen)
1. Migración 061 (build core-api primero) → 2. core-api swap → 3. Valhalla (build teselas) →
4. frontend rebuild. El frontend va al final: hasta que Valhalla tiene teselas, el ETA degrada
a `route=null` sin romper, pero la UI ya consulta endpoints que core-api debe servir (pasos 1–3).
