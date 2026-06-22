# Rutas + ETA en vivo y panel de flota configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a la pantalla de flota (1) búsqueda de ubicaciones + asignación de destino a un vehículo con ruta y ETA en vivo (motor Valhalla autoalojado, web Fase 1) y (2) un panel lateral cuyos datos se configuran por tipo de vehículo desde la pantalla de Tipos/Sensores.

**Architecture:** El frontend nunca habla con Valhalla/Nominatim directamente; `core-api` hace de proxy (privacidad + auth + tenant). El destino se persiste en BD (`vehicle_destination`, migración 061). El ETA restante se calcula bajo demanda contra Valhalla desde la última posición conocida del vehículo (Redis). El panel configurable reutiliza el flag-mechanism y el helper de formato de sensores que ya alimentan el popup del mapa.

**Tech Stack:** Backend FastAPI async + SQLAlchemy 2.x async + Alembic + Pydantic v2 + httpx (ya en `pyproject.toml`, sin usar aún). Frontend React 18 + Vite + TS estricto + React Query + Zustand + Leaflet puro. Infra: Docker Compose + Valhalla (`ghcr.io/gis-ops/docker-valhalla`).

## Global Constraints

- **Producción sin staging.** Confirmar con Carlos antes de: `alembic upgrade`, `docker compose down/restart`, cualquier `psql` no-SELECT, tocar `.env`/`docker-compose.yml`. (CLAUDE.md)
- **Multi-tenant en cada endpoint:** filtrar por `tenant_id`, respetar jerarquía cmg/client/subclient, usar `assert_can_access_vehicle(user, vehicle_id, db, operation, scope)`.
- **Nunca exponer puertos internos al exterior.** Valhalla solo en red interna Docker (`--network-alias valhalla`).
- **No añadir dependencias frontend** (nada de `leaflet-routing-machine`): la ruta se pinta como `L.polyline` a mano.
- TypeScript estricto, sin `any`. Type hints en toda función pública Python.
- Comentarios en español, código en inglés. Logs estructurados (`structlog`), nada de `print()`.
- Funciones ≤50 líneas, archivos ≤500 líneas.
- Deploy frontend y core-api: procedimiento manual de §DEPLOY del CLAUDE.md (build con compose, swap con `docker run`).
- Migración additive: aplicar con `compose run --rm --no-deps` (ver memoria de deploy).

---

## Orden de ejecución

Los dos bloques son independientes. **El Bloque 2 (Tareas B1–B2) es de bajo riesgo y se puede desplegar primero**, mientras se prepara la infraestructura de Valhalla del Bloque 1.

- Bloque 2: Tareas **B1, B2**
- Bloque 1: Tareas **A1 → A7** (A1 infra primero; A2–A5 backend; A6–A7 frontend)

---

# BLOQUE 2 — Panel lateral de flota configurable

## Task B1: Flag `show_in_fleet_panel` en SensorDef + checkbox en editor

**Files:**
- Modify: `frontend/src/lib/types.ts:153-179` (interface `SensorDef`)
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx:~900-920` (bloque de checkboxes)

**Interfaces:**
- Produces: campo opcional `show_in_fleet_panel?: boolean` en `SensorDef`. Persistido en `sensor_schema` JSONB vía el endpoint existente `PATCH /api/v1/vehicle-types/{id}/sensor-schema` (additive, sin cambios de backend).
- Consumes: nada nuevo.

- [ ] **Step 1: Añadir el flag al tipo**

En `frontend/src/lib/types.ts`, dentro de `interface SensorDef`, junto a los flags existentes:

```typescript
  visible_in_detail?: boolean
  show_in_popup?: boolean
  show_in_fleet_panel?: boolean   // mostrar en panel lateral de flota
```

- [ ] **Step 2: Añadir el checkbox en el editor**

En `frontend/src/features/vehicles/VehicleTypesPage.tsx`, justo después del bloque del checkbox `sensor-popup` (~L914-920), copiar el patrón existente:

```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
  <input
    type="checkbox"
    id="sensor-fleet-panel"
    checked={sensorForm.show_in_fleet_panel ?? false}
    onChange={e => setSensorForm(f => ({ ...f, show_in_fleet_panel: e.target.checked }))}
  />
  <label htmlFor="sensor-fleet-panel" style={{ fontSize: 13, color: 'var(--fg-primary)', cursor: 'pointer' }}>
    En panel lateral de Flota
  </label>
</div>
```

Verificar que `sensorForm` se inicializa con `show_in_fleet_panel` cuando se carga un sensor existente (si la inicialización copia el objeto sensor completo no hace falta nada; si copia campo a campo, añadir `show_in_fleet_panel: s.show_in_fleet_panel ?? false`).

- [ ] **Step 3: Verificar compilación TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/features/vehicles/VehicleTypesPage.tsx
git commit -m "feat(flota): flag show_in_fleet_panel en SensorDef + checkbox en editor de tipos"
```

---

## Task B2: VehicleDetailPanel pinta sensores desde sensor_schema (con fallback)

**Files:**
- Modify: `frontend/src/features/fleet/VehicleDetailPanel.tsx`
- Modify: `frontend/src/features/fleet/FleetDashboard.tsx` (pasar prop `vehicleType`)
- Reuse: `frontend/src/features/fleet/popupHtml.ts` (`sensorDisplayValue`), `frontend/src/lib/sensorValue.ts`

**Interfaces:**
- Consumes: `sensorDisplayValue(s: SensorDef, status: VehicleStatus): string` (ya exportada en `popupHtml.ts`). `VehicleTypeOut.sensor_schema: SensorDef[]`.
- Produces: `VehicleDetailPanel` acepta nueva prop opcional `vehicleType?: VehicleTypeOut`.

- [ ] **Step 1: Añadir la prop `vehicleType` al panel**

En `frontend/src/features/fleet/VehicleDetailPanel.tsx`, ampliar las props:

```typescript
import type { VehicleTypeOut, SensorDef } from '../../lib/types'
import { sensorDisplayValue } from './popupHtml'

interface VehicleDetailPanelProps {
  vehicleId: string | null
  plate?: string
  vehicleName?: string
  vehicleType?: VehicleTypeOut
  onClose: () => void
}
```

- [ ] **Step 2: Calcular los sensores configurados con fallback**

Dentro del componente, después de obtener `status` de `useVehicleLive`:

```typescript
// Sensores marcados para el panel de flota; si no hay ninguno, fallback a los 4 fijos.
const panelSensors: SensorDef[] = (vehicleType?.sensor_schema ?? [])
  .filter(s => s.show_in_fleet_panel === true)
```

- [ ] **Step 3: Renderizar dinámico o fallback**

Sustituir el bloque hardcoded (L98-115) por:

```jsx
{panelSensors.length > 0 ? (
  panelSensors.map(s => (
    <KpiRow
      key={s.key}
      label={s.label}
      value={<span style={{ color: stale ? 'var(--fg-muted)' : undefined }}>
        {status ? sensorDisplayValue(s, status) : '—'}
      </span>}
    />
  ))
) : (
  <>
    <KpiRow label="Ignición" value={
      <span style={{ color: stale ? 'var(--fg-muted)' : (status?.ignition ? 'var(--ok)' : 'var(--offline)') }}>
        {status?.ignition ? 'ON' : 'OFF'}
      </span>
    } />
    {status?.speed_kmh != null && (
      <KpiRow label="Velocidad" value={status.speed_kmh.toFixed(0)} unit="km/h" />
    )}
    {status?.ext_voltage_mv != null && (
      <KpiRow label="Tensión batería" value={(status.ext_voltage_mv / 1000).toFixed(1)} unit="V" />
    )}
    {status?.pto_active != null && (
      <KpiRow label="PTO" value={
        <span style={{ color: stale ? 'var(--fg-muted)' : (status.pto_active ? 'var(--cmg-teal)' : 'var(--fg-dim)') }}>
          {status.pto_active ? 'Activo' : 'Inactivo'}
        </span>
      } />
    )}
  </>
)}
```

Nota: `sensorDisplayValue` ya incluye la unidad, por eso el `KpiRow` dinámico no pasa `unit`.

- [ ] **Step 4: Pasar `vehicleType` desde FleetDashboard**

En `frontend/src/features/fleet/FleetDashboard.tsx`, donde se renderiza `<VehicleDetailPanel ... />`, añadir la prop. El dashboard ya carga `vehicles` y los tipos de vehículo (usados por el popup). Localizar el mapa de tipos (`vehicleTypesById` o equivalente que ya alimenta `buildPopupHtml`); si no existe, derivarlo:

```typescript
const vehicleTypesById = useMemo(
  () => new Map(vehicleTypes.map(vt => [vt.id, vt])),
  [vehicleTypes],
)
const selectedVehicle = selectedVehicleId ? vehicleById.get(selectedVehicleId) : undefined
```

```jsx
<VehicleDetailPanel
  vehicleId={selectedVehicleId}
  plate={selectedVehicle?.license_plate}
  vehicleName={selectedVehicle?.name}
  vehicleType={selectedVehicle ? vehicleTypesById.get(selectedVehicle.vehicle_type_id) : undefined}
  onClose={handleClose}
/>
```

Si `FleetDashboard` aún no carga la lista de tipos de vehículo, añadir el query (reutilizar `keys.vehicleTypes()`):

```typescript
const { data: vehicleTypes = [] } = useQuery({
  queryKey: keys.vehicleTypes(),
  queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
  staleTime: 5 * 60_000,
})
```

- [ ] **Step 5: Verificar compilación**

Run: `cd frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Verificación manual**

1. En `/tipos-vehiculo`, marcar "En panel lateral de Flota" en 2-3 sensores de un tipo.
2. En `/fleet`, seleccionar un vehículo de ese tipo → el panel derecho muestra esos sensores con sus valores/unidades.
3. Seleccionar un vehículo de un tipo SIN flags → el panel muestra los 4 campos clásicos (ignición, velocidad, tensión, PTO).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/fleet/VehicleDetailPanel.tsx frontend/src/features/fleet/FleetDashboard.tsx
git commit -m "feat(flota): panel lateral configurable por sensor_schema con fallback a campos fijos"
```

---

# BLOQUE 1 — Destino + ruta + ETA en vivo

## Task A1: Servicio Valhalla en Docker + build de teselas Europa

**Files:**
- Modify: `docker-compose.yml` (servicio `valhalla` + volumen `valhalla_tiles`)
- Modify: `.env.example` (documentar `VALHALLA_URL`) — NO tocar `.env` de producción sin confirmación
- Modify: `docs/deploy.md` (procedimiento de build de teselas)

**Interfaces:**
- Produces: servicio HTTP interno `http://valhalla:8002` con la API `/route`, `/status`. Volumen `valhalla_tiles` con las teselas de Europa.

> ⚠️ Esta tarea toca `docker-compose.yml` y descarga ~28 GB + build con pico ~108 GB de disco. **Confirmar con Carlos antes de ejecutar** y hacerlo fuera de hora punta. No tiene test automatizado; la verificación es por comandos.

- [ ] **Step 1: Añadir el servicio a docker-compose.yml**

```yaml
  valhalla:
    image: ghcr.io/gis-ops/docker-valhalla/valhalla:latest
    restart: unless-stopped
    networks:
      default:
        aliases:
          - valhalla
    volumes:
      - valhalla_tiles:/custom_files
    environment:
      - tile_urls=https://download.geofabrik.de/europe-latest.osm.pbf
      - server_threads=2
      - use_tiles_ignore_pbf=True
      - build_elevation=False
      - build_admins=True
      - build_time_zones=False
    # Sin `ports:` — solo accesible en la red interna Docker
```

Y en la sección `volumes:` del compose:

```yaml
  valhalla_tiles:
```

- [ ] **Step 2: Lanzar build de teselas (puntual, con disco vigilado)**

Confirmar margen de disco antes:

Run: `df -h /`
Expected: ≥110 GB libres antes de arrancar (hoy hay 120 GB).

Arrancar solo Valhalla para que descargue el `.pbf` y construya:

Run: `docker compose up -d valhalla && docker compose logs -f valhalla`
Expected (en logs, a lo largo de ~1-3 h): descarga del `.pbf`, `valhalla_build_tiles`, y finalmente `Running tile service`.

- [ ] **Step 3: Borrar el `.pbf` tras generar teselas (liberar disco)**

Una vez Valhalla esté sirviendo (paso 4 OK), eliminar el `.pbf` del volumen para bajar de ~108 GB a ~80 GB:

Run: `docker compose exec valhalla sh -c 'rm -f /custom_files/*.osm.pbf' && df -h /`
Expected: ~80 GB ocupados por el volumen, margen recuperado.

- [ ] **Step 4: Verificar que responde en red interna**

Run desde core-api (misma red):
```bash
docker compose exec core-api python -c "import httpx; print(httpx.post('http://valhalla:8002/route', json={'locations':[{'lat':39.47,'lon':-0.38},{'lat':41.39,'lon':2.17}],'costing':'auto'}).json()['trip']['summary'])"
```
Expected: un dict con `length` (km) y `time` (s) > 0 (ruta Valencia→Barcelona).

- [ ] **Step 5: Documentar y commit (sin push)**

Añadir el procedimiento (pasos 1-4 + borrado del pbf + re-build futuro cambiando `tile_urls`) a `docs/deploy.md`.

```bash
git add docker-compose.yml .env.example docs/deploy.md
git commit -m "infra(routing): servicio Valhalla Europa en red interna + procedimiento de build"
```

---

## Task A2: Config + servicios httpx de routing y geocoding

**Files:**
- Modify: `backend/app/core/config.py` (`valhalla_url`, `nominatim_url`)
- Create: `backend/app/services/routing.py`
- Create: `backend/app/services/geocoding.py`
- Test: `backend/tests/services/test_routing.py`
- Test: `backend/tests/services/test_geocoding.py`

**Interfaces:**
- Produces:
  - `async def valhalla_route(origin: tuple[float, float], dest: tuple[float, float], valhalla_url: str | None = None) -> RouteResult`
  - `class RouteResult` (Pydantic): `distance_m: float`, `duration_s: float`, `geometry: list[tuple[float, float]]` (lista de `(lat, lon)`).
  - `async def nominatim_search(query: str, limit: int = 5, nominatim_url: str | None = None) -> list[GeoResult]`
  - `class GeoResult` (Pydantic): `label: str`, `lat: float`, `lon: float`.
- Consumes: `httpx` (ya en `pyproject.toml`).

- [ ] **Step 1: Escribir el test de decodificación de polyline de Valhalla**

Valhalla devuelve `trip.legs[].shape` como polyline codificada con precisión 6. El servicio debe decodificarla.

Crear `backend/tests/services/test_routing.py`:

```python
import pytest
from app.services.routing import _decode_polyline6, valhalla_route, RouteResult


def test_decode_polyline6_known_value():
    # Polyline6 de un único punto (lat=38.5, lon=-120.2)
    encoded = "_izlhA~rlgdF"
    pts = _decode_polyline6(encoded)
    assert len(pts) == 1
    assert pts[0][0] == pytest.approx(38.5, abs=1e-4)
    assert pts[0][1] == pytest.approx(-120.2, abs=1e-4)


@pytest.mark.asyncio
async def test_valhalla_route_parses_summary(monkeypatch):
    fake_json = {
        "trip": {
            "summary": {"length": 12.5, "time": 600},
            "legs": [{"shape": "_izlhA~rlgdF"}],
        }
    }

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return fake_json

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json): return _Resp()

    monkeypatch.setattr("app.services.routing.httpx.AsyncClient", lambda **kw: _Client())
    result = await valhalla_route((39.47, -0.38), (41.39, 2.17), valhalla_url="http://valhalla:8002")
    assert isinstance(result, RouteResult)
    assert result.distance_m == pytest.approx(12500.0)   # 12.5 km → m
    assert result.duration_s == 600
    assert len(result.geometry) == 1
```

- [ ] **Step 2: Run test (debe fallar)**

Run: `pytest backend/tests/services/test_routing.py -xvs`
Expected: FAIL — `ModuleNotFoundError: app.services.routing`.

- [ ] **Step 3: Implementar `routing.py`**

```python
"""Cliente del motor de rutas Valhalla (autoalojado, red interna)."""
import httpx
from pydantic import BaseModel

from app.core.config import settings


class RouteResult(BaseModel):
    distance_m: float
    duration_s: float
    geometry: list[tuple[float, float]]  # lista de (lat, lon)


def _decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Decodifica una polyline de Valhalla (precisión 6) a (lat, lon)."""
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        for _unit in range(2):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else (result >> 1)
            if _unit == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lat / 1e6, lon / 1e6))
    return coords


async def valhalla_route(
    origin: tuple[float, float],
    dest: tuple[float, float],
    valhalla_url: str | None = None,
) -> RouteResult:
    """Calcula ruta coche origen→destino. origin/dest = (lat, lon)."""
    base = valhalla_url or settings.valhalla_url
    payload = {
        "locations": [
            {"lat": origin[0], "lon": origin[1]},
            {"lat": dest[0], "lon": dest[1]},
        ],
        "costing": "auto",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(f"{base}/route", json=payload)
        resp.raise_for_status()
        data = resp.json()
    trip = data["trip"]
    geometry: list[tuple[float, float]] = []
    for leg in trip.get("legs", []):
        geometry.extend(_decode_polyline6(leg["shape"]))
    return RouteResult(
        distance_m=trip["summary"]["length"] * 1000.0,
        duration_s=trip["summary"]["time"],
        geometry=geometry,
    )
```

- [ ] **Step 4: Run test (debe pasar)**

Run: `pytest backend/tests/services/test_routing.py -xvs`
Expected: PASS.

- [ ] **Step 5: Test de geocoding**

Crear `backend/tests/services/test_geocoding.py`:

```python
import pytest
from app.services.geocoding import nominatim_search, GeoResult


@pytest.mark.asyncio
async def test_nominatim_search_parses_results(monkeypatch):
    fake_json = [
        {"display_name": "Valencia, España", "lat": "39.4699", "lon": "-0.3763"},
        {"display_name": "Valencia, Venezuela", "lat": "10.16", "lon": "-68.0"},
    ]

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return fake_json

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params, headers): return _Resp()

    monkeypatch.setattr("app.services.geocoding.httpx.AsyncClient", lambda **kw: _Client())
    out = await nominatim_search("valencia", nominatim_url="http://nominatim")
    assert len(out) == 2
    assert isinstance(out[0], GeoResult)
    assert out[0].label == "Valencia, España"
    assert out[0].lat == pytest.approx(39.4699)
```

- [ ] **Step 6: Run test (debe fallar)**

Run: `pytest backend/tests/services/test_geocoding.py -xvs`
Expected: FAIL — módulo no existe.

- [ ] **Step 7: Implementar `geocoding.py`**

```python
"""Cliente de geocoding Nominatim (búsqueda de ubicación por texto)."""
import httpx
from pydantic import BaseModel

from app.core.config import settings


class GeoResult(BaseModel):
    label: str
    lat: float
    lon: float


async def nominatim_search(
    query: str,
    limit: int = 5,
    nominatim_url: str | None = None,
) -> list[GeoResult]:
    """Busca ubicaciones por texto libre. Devuelve hasta `limit` resultados."""
    base = nominatim_url or settings.nominatim_url
    params = {"q": query, "format": "json", "limit": limit}
    headers = {"User-Agent": "cmg-telematics/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base}/search", params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    return [
        GeoResult(label=item["display_name"], lat=float(item["lat"]), lon=float(item["lon"]))
        for item in data
    ]
```

- [ ] **Step 8: Run test (debe pasar)**

Run: `pytest backend/tests/services/test_geocoding.py -xvs`
Expected: PASS.

- [ ] **Step 9: Añadir config**

En `backend/app/core/config.py`, dentro de `class Settings`:

```python
    valhalla_url: str = "http://valhalla:8002"
    nominatim_url: str = "https://nominatim.openstreetmap.org"
```

Documentar ambas en `.env.example`.

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/routing.py backend/app/services/geocoding.py \
        backend/tests/services/test_routing.py backend/tests/services/test_geocoding.py \
        backend/app/core/config.py .env.example
git commit -m "feat(routing): clientes Valhalla y Nominatim + config (httpx)"
```

---

## Task A3: Modelo `vehicle_destination` + migración 061

**Files:**
- Create: `backend/app/models/vehicle_destination.py`
- Modify: `backend/app/models/__init__.py` (registrar el modelo)
- Create: `backend/alembic/versions/061_vehicle_destination.py`

**Interfaces:**
- Produces: tabla `vehicle_destination` y modelo `VehicleDestination` con columnas: `id`, `tenant_id`, `vehicle_id` (único), `label`, `lat`, `lon`, `status`, `assigned_by`, `assigned_at`, `arrived_at`.

- [ ] **Step 1: Crear el modelo**

`backend/app/models/vehicle_destination.py`:

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Float, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VehicleDestination(Base):
    """Destino activo asignado a un vehículo (Fase 1: marcado desde la web)."""
    __tablename__ = "vehicle_destination"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")  # active|arrived|cancelled
    assigned_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 2: Registrar el modelo**

En `backend/app/models/__init__.py`, añadir junto a los demás imports:

```python
from app.models.vehicle_destination import VehicleDestination  # noqa: F401
```

- [ ] **Step 3: Crear la migración 061**

`backend/alembic/versions/061_vehicle_destination.py`:

```python
"""vehicle_destination: destino activo por vehículo (rutas + ETA en vivo).

Revision ID: 061
Revises: 060
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_destination",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("assigned_by", UUID(as_uuid=True), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("arrived_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("vehicle_id", name="uq_vehicle_destination_vehicle_id"),
    )
    op.create_index("ix_vehicle_destination_tenant_id", "vehicle_destination", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_vehicle_destination_tenant_id", "vehicle_destination")
    op.drop_table("vehicle_destination")
```

- [ ] **Step 4: Verificar import (sin aplicar a producción)**

Run: `cd backend && python -c "from app.models.vehicle_destination import VehicleDestination; print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/vehicle_destination.py backend/app/models/__init__.py \
        backend/alembic/versions/061_vehicle_destination.py
git commit -m "feat(routing): modelo vehicle_destination + migración 061"
```

> La aplicación `alembic upgrade head` se hace en el deploy, con confirmación de Carlos, vía `compose run --rm --no-deps` (migración additive).

---

## Task A4: Endpoints de destino (POST/DELETE/GET con ETA)

**Files:**
- Create: `backend/app/api/v1/destinations.py`
- Modify: `backend/app/main.py` o el router agregador (registrar el nuevo router)
- Create: `backend/app/schemas/destination.py`
- Test: `backend/tests/api/test_destinations.py`

**Interfaces:**
- Consumes: `valhalla_route` (A2), `assert_can_access_vehicle`, `get_current_user`, `get_db`, `get_redis`.
- Produces:
  - `POST /api/v1/vehicles/{vehicle_id}/destination` body `DestinationIn{lat,lon,label}` → `DestinationOut`
  - `DELETE /api/v1/vehicles/{vehicle_id}/destination` → 204
  - `GET /api/v1/vehicles/{vehicle_id}/destination` → `DestinationOut` (incluye ruta + restante) o 404 si no hay
  - Helpers: `async def _get_vehicle_latlon(redis, vehicle_id) -> tuple[float,float] | None`, `def _haversine_m(a, b) -> float`, constante `ARRIVAL_RADIUS_M = 100`.

- [ ] **Step 1: Schemas**

`backend/app/schemas/destination.py`:

```python
import uuid
from datetime import datetime
from pydantic import BaseModel


class DestinationIn(BaseModel):
    lat: float
    lon: float
    label: str


class RouteInfo(BaseModel):
    distance_m: float
    duration_s: float
    geometry: list[tuple[float, float]]


class DestinationOut(BaseModel):
    vehicle_id: uuid.UUID
    label: str
    lat: float
    lon: float
    status: str
    assigned_at: datetime
    arrived_at: datetime | None = None
    route: RouteInfo | None = None          # ruta restante desde la posición actual
    remaining_distance_m: float | None = None
    remaining_duration_s: float | None = None
```

- [ ] **Step 2: Escribir los tests de endpoint**

`backend/tests/api/test_destinations.py` (sigue el patrón de `tests/api/test_devices_api.py`):

```python
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user, get_redis
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CMG_TENANT_ID = uuid.UUID("10000000-0000-0000-0000-000000000000")
VEHICLE_ID = uuid.uuid4()
CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)


def _override(user, db, redis):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen(): yield db
    app.dependency_overrides[get_db] = _db_gen
    app.dependency_overrides[get_redis] = lambda: redis


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _vehicle():
    v = MagicMock()
    v.id = VEHICLE_ID
    v.tenant_id = CMG_TENANT_ID
    v.active = True
    return v


def test_post_destination_creates(monkeypatch):
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)  # no existe destino previo
    redis = AsyncMock()
    _override(CMG_USER, db, redis)

    async def _fake_access(*a, **k): return _vehicle()
    monkeypatch.setattr("app.api.v1.destinations.assert_can_access_vehicle", _fake_access)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/destination",
                       json={"lat": 39.47, "lon": -0.38, "label": "Valencia"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Valencia"
    db.add.assert_called_once()


def test_get_destination_includes_remaining(monkeypatch):
    db = AsyncMock()
    dest = MagicMock()
    dest.vehicle_id = VEHICLE_ID; dest.label = "Valencia"; dest.lat = 39.47; dest.lon = -0.38
    dest.status = "active"; dest.arrived_at = None
    dest.assigned_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    result = MagicMock(); result.scalar_one_or_none.return_value = dest
    db.execute = AsyncMock(return_value=result)
    redis = AsyncMock()
    _override(CMG_USER, db, redis)

    async def _fake_access(*a, **k): return _vehicle()
    monkeypatch.setattr("app.api.v1.destinations.assert_can_access_vehicle", _fake_access)
    async def _fake_pos(*a, **k): return (40.0, -0.5)
    monkeypatch.setattr("app.api.v1.destinations._get_vehicle_latlon", _fake_pos)

    from app.services.routing import RouteResult
    async def _fake_route(*a, **k):
        return RouteResult(distance_m=8000, duration_s=420, geometry=[(40.0, -0.5), (39.47, -0.38)])
    monkeypatch.setattr("app.api.v1.destinations.valhalla_route", _fake_route)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/destination")
    assert resp.status_code == 200
    body = resp.json()
    assert body["remaining_distance_m"] == 8000
    assert body["remaining_duration_s"] == 420
    assert len(body["route"]["geometry"]) == 2


def test_get_destination_404_when_none(monkeypatch):
    db = AsyncMock()
    result = MagicMock(); result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)
    _override(CMG_USER, db, AsyncMock())
    async def _fake_access(*a, **k): return _vehicle()
    monkeypatch.setattr("app.api.v1.destinations.assert_can_access_vehicle", _fake_access)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/destination")
    assert resp.status_code == 404
```

- [ ] **Step 3: Run tests (deben fallar)**

Run: `pytest backend/tests/api/test_destinations.py -xvs`
Expected: FAIL — `app.api.v1.destinations` no existe.

- [ ] **Step 4: Implementar el router**

`backend/app/api/v1/destinations.py`:

```python
"""Endpoints de destino asignado a un vehículo (ruta + ETA en vivo)."""
import math
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user, get_redis
from app.api.v1.access_v2 import assert_can_access_vehicle
from app.core.database import get_db
from app.models.vehicle_destination import VehicleDestination
from app.schemas.auth import CurrentUser
from app.schemas.destination import DestinationIn, DestinationOut, RouteInfo
from app.services.routing import valhalla_route

router = APIRouter()

ARRIVAL_RADIUS_M = 100.0


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distancia en metros entre dos (lat, lon)."""
    r = 6371000.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _parse_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


async def _get_vehicle_latlon(redis, vehicle_id: uuid.UUID) -> tuple[float, float] | None:
    """Última posición conocida desde el hash Redis vehicle:{id}:status."""
    data = await redis.hgetall(f"vehicle:{vehicle_id}:status")
    if not data:
        return None
    # redis puede devolver bytes
    get = lambda k: data.get(k) or data.get(k.encode())
    lat, lon = _parse_float(get("lat")), _parse_float(get("lon"))
    if lat is None or lon is None:
        return None
    return (lat, lon)


@router.post("/vehicles/{vehicle_id}/destination", response_model=DestinationOut)
async def set_destination(
    vehicle_id: uuid.UUID,
    body: DestinationIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="write", scope="operational")
    existing = await db.execute(
        select(VehicleDestination).where(VehicleDestination.vehicle_id == vehicle_id)
    )
    dest = existing.scalar_one_or_none()
    if dest is None:
        dest = VehicleDestination(
            id=uuid.uuid4(), tenant_id=vehicle.tenant_id, vehicle_id=vehicle_id,
            label=body.label, lat=body.lat, lon=body.lon, status="active",
            assigned_by=user.user_id,
        )
        db.add(dest)
    else:
        dest.label, dest.lat, dest.lon = body.label, body.lat, body.lon
        dest.status, dest.arrived_at, dest.assigned_by = "active", None, user.user_id
    await db.commit()
    await db.refresh(dest)
    return DestinationOut(
        vehicle_id=dest.vehicle_id, label=dest.label, lat=dest.lat, lon=dest.lon,
        status=dest.status, assigned_at=dest.assigned_at, arrived_at=dest.arrived_at,
    )


@router.delete("/vehicles/{vehicle_id}/destination", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_destination(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_access_vehicle(user, vehicle_id, db, operation="write", scope="operational")
    result = await db.execute(
        select(VehicleDestination).where(VehicleDestination.vehicle_id == vehicle_id)
    )
    dest = result.scalar_one_or_none()
    if dest is not None:
        dest.status = "cancelled"
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/vehicles/{vehicle_id}/destination", response_model=DestinationOut)
async def get_destination(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    await assert_can_access_vehicle(user, vehicle_id, db, operation="read", scope="operational")
    result = await db.execute(
        select(VehicleDestination).where(
            VehicleDestination.vehicle_id == vehicle_id,
            VehicleDestination.status == "active",
        )
    )
    dest = result.scalar_one_or_none()
    if dest is None:
        raise HTTPException(status_code=404, detail="Sin destino activo")

    out = DestinationOut(
        vehicle_id=dest.vehicle_id, label=dest.label, lat=dest.lat, lon=dest.lon,
        status=dest.status, assigned_at=dest.assigned_at, arrived_at=dest.arrived_at,
    )
    pos = await _get_vehicle_latlon(redis, vehicle_id)
    if pos is None:
        return out

    # Detección de llegada
    if _haversine_m(pos, (dest.lat, dest.lon)) <= ARRIVAL_RADIUS_M:
        dest.status = "arrived"
        from datetime import datetime, timezone
        dest.arrived_at = datetime.now(timezone.utc)
        await db.commit()
        out.status, out.arrived_at = "arrived", dest.arrived_at
        return out

    try:
        route = await valhalla_route(pos, (dest.lat, dest.lon))
        out.route = RouteInfo(**route.model_dump())
        out.remaining_distance_m = route.distance_m
        out.remaining_duration_s = route.duration_s
    except Exception:  # noqa: BLE001 — Valhalla caído no debe romper el GET del destino
        pass
    return out
```

- [ ] **Step 5: Registrar el router**

En el agregador de routers v1 (donde se incluyen `vehicles.router`, etc.), añadir:

```python
from app.api.v1 import destinations
api_router.include_router(destinations.router, prefix="/api/v1", tags=["destinations"])
```

(Ajustar `prefix` al patrón existente: si los demás routers ya montan bajo `/api/v1`, replicar exactamente.)

- [ ] **Step 6: Run tests (deben pasar)**

Run: `pytest backend/tests/api/test_destinations.py -xvs`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/destinations.py backend/app/schemas/destination.py \
        backend/tests/api/test_destinations.py backend/app/main.py
git commit -m "feat(routing): endpoints destino con ruta+ETA y detección de llegada"
```

---

## Task A5: Endpoints proxy de geocoding y ruta libre

**Files:**
- Modify: `backend/app/api/v1/destinations.py` (añadir `/geocode` y `/route`)
- Test: `backend/tests/api/test_geocode_route_endpoints.py`

**Interfaces:**
- Consumes: `nominatim_search` (A2), `valhalla_route` (A2), `get_current_user`.
- Produces:
  - `GET /api/v1/geocode?q=…&limit=…` → `list[GeoResult]`
  - `GET /api/v1/route?from_lat=&from_lon=&to_lat=&to_lon=` → `RouteInfo`

- [ ] **Step 1: Escribir tests**

`backend/tests/api/test_geocode_route_endpoints.py`:

```python
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

USER = CurrentUser(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
                   tenant_tier="cmg", role="admin", email="a@b.com")


@pytest.fixture(autouse=True)
def clear_overrides():
    app.dependency_overrides[get_current_user] = lambda: USER
    yield
    app.dependency_overrides.clear()


def test_geocode(monkeypatch):
    from app.services.geocoding import GeoResult
    async def _fake(q, limit=5): return [GeoResult(label="Valencia", lat=39.47, lon=-0.38)]
    monkeypatch.setattr("app.api.v1.destinations.nominatim_search", _fake)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/geocode?q=valencia")
    assert resp.status_code == 200
    assert resp.json()[0]["label"] == "Valencia"


def test_route(monkeypatch):
    from app.services.routing import RouteResult
    async def _fake(o, d): return RouteResult(distance_m=8000, duration_s=420, geometry=[(0, 0), (1, 1)])
    monkeypatch.setattr("app.api.v1.destinations.valhalla_route", _fake)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/route?from_lat=40&from_lon=-0.5&to_lat=39.47&to_lon=-0.38")
    assert resp.status_code == 200
    assert resp.json()["distance_m"] == 8000
```

- [ ] **Step 2: Run (debe fallar)**

Run: `pytest backend/tests/api/test_geocode_route_endpoints.py -xvs`
Expected: FAIL — endpoints no existen.

- [ ] **Step 3: Implementar los endpoints**

Añadir a `backend/app/api/v1/destinations.py`:

```python
from fastapi import Query
from app.services.geocoding import nominatim_search, GeoResult


@router.get("/geocode", response_model=list[GeoResult])
async def geocode(
    q: str = Query(..., min_length=2),
    limit: int = Query(5, ge=1, le=10),
    user: CurrentUser = Depends(get_current_user),
):
    return await nominatim_search(q, limit=limit)


@router.get("/route", response_model=RouteInfo)
async def route(
    from_lat: float, from_lon: float, to_lat: float, to_lon: float,
    user: CurrentUser = Depends(get_current_user),
):
    result = await valhalla_route((from_lat, from_lon), (to_lat, to_lon))
    return RouteInfo(**result.model_dump())
```

- [ ] **Step 4: Run (debe pasar)**

Run: `pytest backend/tests/api/test_geocode_route_endpoints.py -xvs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/destinations.py backend/tests/api/test_geocode_route_endpoints.py
git commit -m "feat(routing): endpoints proxy /geocode (Nominatim) y /route (ruta libre)"
```

---

## Task A6: Frontend — tipos, hooks y estado de destino/búsqueda

**Files:**
- Modify: `frontend/src/lib/types.ts` (tipos `GeoResult`, `RouteInfo`, `DestinationOut`)
- Create: `frontend/src/features/fleet/useDestination.ts` (hooks React Query)
- Modify: `frontend/src/lib/queryKeys.ts` (o donde estén las `keys`)

**Interfaces:**
- Produces:
  - tipos `GeoResult`, `RouteInfo`, `DestinationOut`.
  - `useGeocode()` → mutation que llama `GET /api/v1/geocode?q=`.
  - `useVehicleDestination(vehicleId, enabled)` → query a `GET .../destination` (refetch corto).
  - `useSetDestination()` / `useCancelDestination()` → mutations POST/DELETE.

- [ ] **Step 1: Tipos**

En `frontend/src/lib/types.ts`:

```typescript
export interface GeoResult { label: string; lat: number; lon: number }
export interface RouteInfo { distance_m: number; duration_s: number; geometry: [number, number][] }
export interface DestinationOut {
  vehicle_id: string
  label: string
  lat: number
  lon: number
  status: 'active' | 'arrived' | 'cancelled'
  assigned_at: string
  arrived_at: string | null
  route: RouteInfo | null
  remaining_distance_m: number | null
  remaining_duration_s: number | null
}
```

- [ ] **Step 2: Hooks**

`frontend/src/features/fleet/useDestination.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { useWsConnected } from '../../lib/useWsConnected'  // mismo hook que useVehicleLive
import type { GeoResult, DestinationOut } from '../../lib/types'

export function useGeocode() {
  return useMutation({
    mutationFn: (q: string) =>
      apiClient.get<GeoResult[]>(`/api/v1/geocode?q=${encodeURIComponent(q)}`),
  })
}

export function useVehicleDestination(vehicleId: string | null, enabled: boolean) {
  const wsConnected = useWsConnected()
  return useQuery({
    queryKey: ['vehicle-destination', vehicleId],
    queryFn: () => apiClient.get<DestinationOut>(`/api/v1/vehicles/${vehicleId}/destination`),
    enabled: enabled && !!vehicleId,
    retry: false,                       // 404 = sin destino, no reintentar
    refetchInterval: wsConnected ? 30_000 : 60_000,
  })
}

export function useSetDestination(vehicleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { lat: number; lon: number; label: string }) =>
      apiClient.post<DestinationOut>(`/api/v1/vehicles/${vehicleId}/destination`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle-destination', vehicleId] }),
  })
}

export function useCancelDestination(vehicleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient.delete<void>(`/api/v1/vehicles/${vehicleId}/destination`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle-destination', vehicleId] }),
  })
}
```

(Confirmar el nombre real del hook de conexión WS; en `useVehicleLive.ts` se importa `useWsConnected` — reutilizar el mismo import.)

- [ ] **Step 3: Verificar compilación**

Run: `cd frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/features/fleet/useDestination.ts
git commit -m "feat(flota): tipos y hooks React Query para destino/geocode/ruta"
```

---

## Task A7: Frontend — búsqueda, marcador de destino, ruta y ETA en el panel

**Files:**
- Modify: `frontend/src/features/fleet/FleetDashboard.tsx` (caja de búsqueda + estado destino/ruta libre)
- Modify: `frontend/src/features/fleet/FleetMap.tsx` (marcador destino + polyline)
- Modify: `frontend/src/features/fleet/VehicleDetailPanel.tsx` (distancia/ETA + botones enviar/cancelar)

**Interfaces:**
- Consumes: hooks de A6; `FleetMap` recibe nuevas props `destination?: {lat,lon,label} | null` y `routeGeometry?: [number,number][] | null`.

- [ ] **Step 1: Capa de destino + ruta en FleetMap**

En `FleetMap.tsx`, añadir refs y props:

```typescript
const destMarkerRef = useRef<L.Marker | null>(null)
const routeLineRef = useRef<L.Polyline | null>(null)
```

Props nuevas en la interfaz del componente:

```typescript
destination?: { lat: number; lon: number; label: string } | null
routeGeometry?: [number, number][] | null
```

`useEffect` para pintar/limpiar (sigue el patrón de los marcadores existentes):

```typescript
useEffect(() => {
  const map = mapRef.current
  if (!map) return
  // limpiar previos
  if (destMarkerRef.current) { map.removeLayer(destMarkerRef.current); destMarkerRef.current = null }
  if (routeLineRef.current) { map.removeLayer(routeLineRef.current); routeLineRef.current = null }
  if (destination) {
    destMarkerRef.current = L.marker([destination.lat, destination.lon], {
      icon: L.divIcon({ className: 'dest-pin', html: '📍', iconSize: [24, 24] }),
    }).addTo(map).bindPopup(destination.label)
  }
  if (routeGeometry && routeGeometry.length > 1) {
    routeLineRef.current = L.polyline(routeGeometry, {
      color: '#1D9E75', weight: 4, opacity: 0.85,
    }).addTo(map)
    map.fitBounds(routeLineRef.current.getBounds(), { padding: [60, 60] })
  }
}, [destination, routeGeometry])
```

- [ ] **Step 2: Caja de búsqueda en FleetDashboard**

En `FleetDashboard.tsx`, añadir estado y un input. Al elegir un resultado, guardar el destino candidato:

```typescript
const [searchResults, setSearchResults] = useState<GeoResult[]>([])
const [pendingDest, setPendingDest] = useState<GeoResult | null>(null)
const geocode = useGeocode()

async function handleSearch(q: string) {
  const results = await geocode.mutateAsync(q)
  setSearchResults(results)
}
```

JSX (caja flotante sobre el mapa, estilo tokens del proyecto):

```jsx
<div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, width: 320 }}>
  <input
    placeholder="Buscar ubicación…"
    onKeyDown={e => { if (e.key === 'Enter') handleSearch((e.target as HTMLInputElement).value) }}
    style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
             background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--fg-primary)' }}
  />
  {searchResults.map((r, i) => (
    <button key={i} onClick={() => { setPendingDest(r); setSearchResults([]) }}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
               background: 'var(--bg-elevated)', border: 'none', color: 'var(--fg-primary)', cursor: 'pointer' }}>
      {r.label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Cargar destino del vehículo seleccionado y pasarlo al mapa**

En `FleetDashboard.tsx`:

```typescript
const destQuery = useVehicleDestination(selectedVehicleId, !!selectedVehicleId)
const activeDest = destQuery.data?.status === 'active' ? destQuery.data : null

// destino a pintar: el candidato de búsqueda o el activo del vehículo
const mapDestination = pendingDest
  ? { lat: pendingDest.lat, lon: pendingDest.lon, label: pendingDest.label }
  : activeDest ? { lat: activeDest.lat, lon: activeDest.lon, label: activeDest.label } : null
const mapRoute = activeDest?.route?.geometry ?? null
```

Pasar a `<FleetMap destination={mapDestination} routeGeometry={mapRoute} ... />`.

- [ ] **Step 4: Botones y ETA en VehicleDetailPanel**

Pasar a `VehicleDetailPanel` las props `pendingDest`, `destination` (DestinationOut activo) y callbacks. Añadir hooks de envío/cancelación y la sección de ETA:

```typescript
import { useSetDestination, useCancelDestination } from './useDestination'
// ...
const setDest = useSetDestination(vehicleId ?? '')
const cancelDest = useCancelDestination(vehicleId ?? '')

function fmtEta(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
```

JSX bajo los KPIs:

```jsx
{pendingDest && (
  <button onClick={() => setDest.mutate({ lat: pendingDest.lat, lon: pendingDest.lon, label: pendingDest.label })}
    style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 8,
             background: 'var(--cmg-teal)', color: '#fff', border: 'none', cursor: 'pointer' }}>
    Enviar destino: {pendingDest.label}
  </button>
)}
{destination?.status === 'active' && destination.remaining_distance_m != null && (
  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
    <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Hacia {destination.label}</div>
    <div style={{ fontSize: 20, fontFamily: 'var(--font-data)' }}>
      {(destination.remaining_distance_m / 1000).toFixed(1)} km · {fmtEta(destination.remaining_duration_s ?? 0)}
    </div>
    <button onClick={() => cancelDest.mutate()}
      style={{ marginTop: 8, background: 'none', border: '1px solid var(--border)',
               color: 'var(--accent-crit)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
      Cancelar destino
    </button>
  </div>
)}
{destination?.status === 'arrived' && (
  <div style={{ marginTop: 12, color: 'var(--accent-ok)' }}>✓ Vehículo llegado al destino</div>
)}
```

- [ ] **Step 5: Verificar compilación**

Run: `cd frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Verificación manual (requiere Valhalla y backend desplegados)**

1. En `/fleet`, buscar "Barcelona" → aparece resultado → clic → marcador 📍 en el mapa.
2. Seleccionar un vehículo con posición conocida → "Enviar destino" → se dibuja la polyline y el panel muestra "X km · Y min".
3. Esperar/forzar nueva posición (WS) → distancia/ETA se actualizan.
4. "Cancelar destino" → desaparecen ruta y ETA.
5. (Ruta libre) — si se implementa el modo, verificar preview sin guardar.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/fleet/FleetDashboard.tsx \
        frontend/src/features/fleet/FleetMap.tsx \
        frontend/src/features/fleet/VehicleDetailPanel.tsx
git commit -m "feat(flota): búsqueda de ubicación, destino en mapa, ruta y ETA en vivo"
```

> Nota: el modo "ruta libre" (preview punto a punto sin guardar, usando `GET /route`) puede añadirse como iteración posterior reutilizando `routeGeometry` con un origen elegido por clic. No bloquea el flujo principal.

---

## Despliegue (con confirmación de Carlos)

1. **Bloque 2** (frontend solo): build + swap frontend (§DEPLOY).
2. **Bloque 1 backend:** `alembic upgrade head` vía `compose run --rm --no-deps` (migración 061 additive) → swap core-api con `--env-file` + `--network-alias core-api`.
3. **Bloque 1 infra:** Task A1 (Valhalla) — fuera de hora punta, vigilando disco.
4. **Bloque 1 frontend:** build + swap frontend.
5. Validación: `curl` a `/geocode`, `/route`, `/vehicles/{id}/destination`; logs `docker compose logs core-api | grep ERROR`.

---

## Self-Review (cobertura del spec)

- Búsqueda de ubicación → A5 (`/geocode`) + A7 (caja de búsqueda). ✅
- Asignar destino persistente → A3 (tabla) + A4 (POST). ✅
- Ruta + distancia + ETA → A2 (Valhalla) + A4 (GET con restante) + A7 (polyline + panel). ✅
- ETA en vivo (refresco con WS) → A6 (`refetchInterval`/invalidación) + A7. ✅
- Detección de llegada (100 m) → A4 (`ARRIVAL_RADIUS_M`). ✅
- Ruta libre → A5 (`/route`); UI marcada como iteración posterior en A7. ✅
- Motor Valhalla autoalojado Europa, red interna, build con borrado de pbf → A1. ✅
- Privacidad (datos no salen) → proxy en core-api, Valhalla/Nominatim internos. ✅ (Nominatim por defecto apunta al público; si se requiere 100% interno, autoalojar Nominatim — fuera de alcance Fase 1, anotado como deuda.)
- Panel configurable por sensores → B1 (flag + editor) + B2 (render + fallback). ✅
