# backend/app/api/v1/vehicles.py
import re
import unicodedata
import uuid
import json
import logging
from math import radians, sin, cos, sqrt, asin
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleCreate, VehicleUpdate, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour, VehicleTypeSensorSchemaUpdate,
    VehicleTypeCreate, VehicleTypeUpdate, HistoricMetricItem, DoutSlot,
    VehicleTypeReportMetricsUpdate, VehicleTypeSystemBlocksUpdate, SystemBlock,
    SystemBlockTemplateOut, SystemBlockTemplateCreate, SystemBlockTemplateUpdate,
    SaveAsTemplateBody, SensorCatalogItem,
    TripPoint, Trip, DayTripTotals, DayTrips,
)
from app.models.system_block_template import SystemBlockTemplate
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.maintenance import MaintenancePlan
from app.models.device import Device
from app.models.driver import Driver, VehicleDriverAssignment
from app.models.tenant import Tenant
from app.schemas.maintenance import MaintenancePlanOut, MaintenanceTemplateItem
from app.api.v1.access_v2 import assert_can_access_vehicle, list_accessible_vehicle_ids

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vehicles"])


# AVL IDs conocidos que reportan régimen del motor (RPM). Es la fuente PRIMARIA
# de detección de ignición: si CUALQUIERA está por encima del umbral, el motor
# está en marcha. Sólo si la trama no trae ningún AVL de RPM se cae a DIN2
# (avl_2) o CAN ignition (avl_239). DIN1 (avl_1) NO es señal de ignición; se
# usa como fallback de PTO. Lista cubre Teltonika OBD-II/J1939 estándar y los
# canales custom de los PLCs que se ven en la flota CMG.
_RPM_AVL_IDS = (
    "avl_30",     # OBD-II Engine RPM
    "avl_36",     # J1939 Engine Speed
    "avl_85",     # Algunos vehículos lo usan como RPM (ojo: en otros es Fuel Level)
    "avl_269",    # CAN Engine RPM
    "avl_10309",  # Custom: cisterna vacuum-pressure (CMG)
)
# Umbral conservador: 200 unidades raw filtra ruido (los valores espurios
# observados en la flota están <100). Por encima de 200 indica motor encendido
# en cualquiera de las escalas habituales (×0.125 J1939 → 25 rpm, ×0.25 OBD →
# 50 rpm). Un motor real al ralentí está siempre muy por encima.
_RPM_IGNITION_THRESHOLD = 200


_TRIP_STOP_KMH = 3.0    # umbral de velocidad "en movimiento"
_TRIP_GAP_S    = 300.0  # hueco > 5 min → no cuenta como movimiento
_TRIP_MAX_KMH  = 150.0  # velocidad imposible → glitch GPS, se ignora

_TZ_MADRID = ZoneInfo("Europe/Madrid")


def _haversine_km(alat: float, alon: float, blat: float, blon: float) -> float:
    R = 6371.0
    dlat = radians(blat - alat)
    dlon = radians(blon - alon)
    h = sin(dlat / 2) ** 2 + cos(radians(alat)) * cos(radians(blat)) * sin(dlon / 2) ** 2
    return 2.0 * R * asin(sqrt(max(0.0, min(1.0, h))))


def _finalize_trip(pts: list[dict], idx: int) -> tuple[Trip, float]:
    """Convierte un segmento de puntos con ignición ON en un Trip.

    Retorna (Trip, mov_dist_km) — mov_dist se necesita para el avg global del día.
    """
    max_spd = max(
        (p["speed_kmh"] for p in pts if p["speed_kmh"] is not None and p["speed_kmh"] <= _TRIP_MAX_KMH),
        default=0.0,
    )
    dist = mov_dist = mov_time = 0.0
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        dt = (b["t"] - a["t"]).total_seconds()
        dd = _haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
        dist += dd
        if dt <= 0:
            continue
        v = dd / (dt / 3600.0)
        if v > _TRIP_MAX_KMH:
            continue  # glitch GPS: no cuenta distancia ni tiempo
        if v >= _TRIP_STOP_KMH and dt <= _TRIP_GAP_S:
            mov_dist += dd
            mov_time += dt
    avg = (mov_dist / (mov_time / 3600.0)) if mov_time > 0.0 else 0.0
    trip = Trip(
        index=idx,
        start=pts[0]["t"],
        end=pts[-1]["t"],
        duration_s=int((pts[-1]["t"] - pts[0]["t"]).total_seconds()),
        distance_km=round(dist, 3),
        moving_time_s=int(mov_time),
        avg_speed_kmh=round(avg, 1),
        max_speed_kmh=round(max_spd, 1),
        points=[TripPoint(t=p["t"], lat=p["lat"], lon=p["lon"]) for p in pts],
    )
    return trip, mov_dist


def _segment_trips(rows: list) -> tuple[list[Trip], DayTripTotals]:
    """Segmenta puntos crudos en trayectos ON→OFF aplicando carry-forward en ignición."""
    segments: list[list[dict]] = []
    cur: list[dict] | None = None
    prev_ign = False
    for row in rows:
        state: bool = row["ignition"] if row["ignition"] is not None else prev_ign
        prev_ign = state
        pt = {"t": row["time"], "lat": row["lat"], "lon": row["lon"], "speed_kmh": row["speed_kmh"]}
        if state:
            if cur is None:
                cur = []
            cur.append(pt)
        else:
            if cur is not None and len(cur) >= 2:
                segments.append(cur)
            cur = None
    if cur is not None and len(cur) >= 2:
        segments.append(cur)

    pairs = [_finalize_trip(seg, i + 1) for i, seg in enumerate(segments)]
    trips = [p[0] for p in pairs]
    mov_dists = [p[1] for p in pairs]

    total_mov_time = sum(t.moving_time_s for t in trips)
    total_mov_dist = sum(mov_dists)
    avg_total = (total_mov_dist / (total_mov_time / 3600.0)) if total_mov_time > 0.0 else 0.0
    totals = DayTripTotals(
        trips=len(trips),
        distance_km=round(sum(t.distance_km for t in trips), 2),
        route_time_s=sum(t.duration_s for t in trips),
        avg_speed_kmh=round(avg_total, 1),
    )
    return trips, totals


def _ignition_from_can(can_data: dict) -> bool:
    """Detecta ignición a partir de CAN data. Prioridad:
    1) Cualquier AVL conocido de RPM > umbral → motor en marcha.
    2) Si la trama trae RPM pero está en 0 → motor parado (return False).
    3) Si NO trae ningún AVL de RPM → fallback DIN2 (avl_2) o CAN ignition (avl_239).

    DIN1 (avl_1) ya NO es señal de ignición; se reserva para el fallback de PTO.
    """
    has_rpm_data = False
    for key in _RPM_AVL_IDS:
        v = can_data.get(key)
        if isinstance(v, (int, float)):
            has_rpm_data = True
            if v > _RPM_IGNITION_THRESHOLD:
                return True
    if has_rpm_data:
        return False
    return can_data.get("avl_1") == 1 or can_data.get("avl_239") == 1


class MaintenanceTemplatesUpdate(BaseModel):
    templates: list[MaintenanceTemplateItem]


def _check_vehicle_access(vehicle: Vehicle, user: CurrentUser) -> None:
    if user.tenant_tier == "cmg":
        return
    if str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")


@router.get("/sensors/catalog", response_model=list[SensorCatalogItem])
async def get_sensor_catalog(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unión deduplicada de todos los sensores de todos los tipos de vehículo.

    Devuelve {key, label, unit} ordenado por label. Si la misma key aparece en
    varios tipos con labels distintos, prevalece la primera encontrada.
    """
    _cmg_admin(user)
    result = await db.execute(select(VehicleType.sensor_schema))
    schemas = result.scalars().all()
    catalog: dict[str, SensorCatalogItem] = {}
    for schema in schemas:
        for s in (schema or []):
            key = s.get("key", "")
            if key and key not in catalog:
                catalog[key] = SensorCatalogItem(
                    key=key,
                    label=s.get("label", key),
                    unit=s.get("unit"),
                )
    return sorted(catalog.values(), key=lambda x: x.label.lower())


@router.get("/vehicle-types", response_model=list[VehicleTypeOut])
async def list_vehicle_types(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VehicleType).order_by(VehicleType.name))
    return result.scalars().all()


@router.patch("/vehicle-types/{type_id}/sensor-schema", response_model=VehicleTypeOut)
async def update_vehicle_type_sensor_schema(
    type_id: uuid.UUID,
    body: VehicleTypeSensorSchemaUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo CMG admin puede modificar tipos de vehículo",
        )
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de vehículo no encontrado",
        )
    vtype.sensor_schema = body.sensor_schema
    flag_modified(vtype, "sensor_schema")
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.patch("/vehicle-types/{type_id}/maintenance-templates", response_model=VehicleTypeOut)
async def update_vehicle_type_maintenance_templates(
    type_id: uuid.UUID,
    body: MaintenanceTemplatesUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo CMG admin puede modificar tipos de vehículo",
        )
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tipo de vehículo no encontrado")
    vtype.maintenance_templates = [t.model_dump() for t in body.templates]
    flag_modified(vtype, "maintenance_templates")
    await db.commit()
    await db.refresh(vtype)

    # Auto-aplicar plantillas a vehículos existentes del tipo
    await _apply_templates_to_vehicles(db, type_id, [t.model_dump() for t in body.templates])

    return vtype


async def _apply_templates_to_vehicles(db: AsyncSession, type_id: uuid.UUID, templates: list) -> int:
    """Crea MaintenancePlan para cada template en todos los vehículos activos del tipo.
    Una sola query de existencia (en lugar de N×M) y bulk insert.
    """
    if not templates:
        return 0
    vehicles_result = await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type_id == type_id, Vehicle.active == True)
    )
    vehicles = vehicles_result.scalars().all()
    if not vehicles:
        return 0

    template_names = [t["name"] for t in templates]
    vehicle_ids = [v.id for v in vehicles]

    existing_result = await db.execute(
        select(MaintenancePlan.vehicle_id, MaintenancePlan.name).where(
            MaintenancePlan.vehicle_id.in_(vehicle_ids),
            MaintenancePlan.name.in_(template_names),
        )
    )
    existing_pairs = {(row[0], row[1]) for row in existing_result.all()}

    created = 0
    for vehicle in vehicles:
        for tmpl in templates:
            if (vehicle.id, tmpl["name"]) in existing_pairs:
                continue
            db.add(MaintenancePlan(
                vehicle_id=vehicle.id,
                tenant_id=vehicle.tenant_id,
                name=tmpl["name"],
                trigger_condition={"thresholds": tmpl.get("thresholds", []), "op": "OR"},
                warn_before_pct=tmpl.get("warn_before_pct", 10),
                active=True,
            ))
            created += 1
    if created:
        await db.commit()
    return created


@router.post("/vehicle-types/{type_id}/apply-maintenance-templates")
async def apply_maintenance_templates(
    type_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aplica las plantillas de mantenimiento del tipo a todos sus vehículos activos."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin")
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")
    templates = vtype.maintenance_templates or []
    created = await _apply_templates_to_vehicles(db, type_id, templates)
    return {"created": created, "message": f"{created} plan(es) creado(s)"}


class DoutConfigUpdate(BaseModel):
    dout_config: list[DoutSlot]


@router.patch("/vehicle-types/{type_id}/historic-metrics", response_model=VehicleTypeOut)
async def update_vehicle_type_historic_metrics(
    type_id: uuid.UUID,
    body: VehicleTypeReportMetricsUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")
    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vtype = result.scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404)
    vtype.historic_metrics = [m.model_dump() for m in body.report_metrics]
    flag_modified(vtype, "historic_metrics")
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.patch("/vehicle-types/{type_id}/dout-config", response_model=VehicleTypeOut)
async def update_vehicle_type_dout_config(
    type_id: uuid.UUID,
    body: DoutConfigUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")
    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vtype = result.scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404)
    vtype.dout_config = [s.model_dump() for s in body.dout_config]
    flag_modified(vtype, "dout_config")
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.post("/vehicle-types", response_model=VehicleTypeOut, status_code=201)
async def create_vehicle_type(
    body: VehicleTypeCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede crear tipos de vehículo")
    dup = await db.execute(select(VehicleType).where(VehicleType.slug == body.slug))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya existe un tipo con ese slug")
    vtype = VehicleType(name=body.name, slug=body.slug, sensor_schema=[])
    db.add(vtype)
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.patch("/vehicle-types/{type_id}", response_model=VehicleTypeOut)
async def update_vehicle_type(
    type_id: uuid.UUID,
    body: VehicleTypeUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede modificar tipos de vehículo")
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    if body.name is not None:
        vtype.name = body.name
    if body.slug is not None:
        dup = await db.execute(
            select(VehicleType).where(VehicleType.slug == body.slug, VehicleType.id != type_id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Ya existe un tipo con ese slug")
        vtype.slug = body.slug
    if body.pdf_metrics is not None:
        keys = [m.key for m in body.pdf_metrics]
        if len(keys) != len(set(keys)):
            raise HTTPException(
                status_code=422,
                detail="No se puede duplicar una métrica en pdf_metrics",
            )
        vtype.pdf_metrics = [m.model_dump() for m in body.pdf_metrics]
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.delete("/vehicle-types/{type_id}", status_code=204)
async def delete_vehicle_type(
    type_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elimina un tipo de vehículo. Bloqueado si hay vehículos que lo usan."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede borrar tipos de vehículo")
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    count_result = await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type_id == type_id)
    )
    vehicles_using = count_result.scalars().all()
    if vehicles_using:
        n = len(vehicles_using)
        raise HTTPException(
            status_code=400,
            detail=f"No se puede borrar: {n} vehículo{'s' if n != 1 else ''} {'usan' if n != 1 else 'usa'} este tipo",
        )
    await db.delete(vtype)
    await db.commit()


@router.post("/vehicle-types/{type_id}/icon", response_model=VehicleTypeOut)
async def upload_vehicle_type_icon(
    type_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.tenant_tier != "cmg" or current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin")
    if not (file.content_type or "").startswith("image/png"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Solo se aceptan archivos PNG")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo demasiado grande (máx 2 MB)")

    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vehicle_type = result.scalar_one_or_none()
    if not vehicle_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tipo de vehículo no encontrado")

    uploads_dir = Path("/app/uploads/icons")
    uploads_dir.mkdir(parents=True, exist_ok=True)
    try:
        (uploads_dir / f"{type_id}.png").write_bytes(content)
    except OSError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error al guardar el archivo: {e}")

    vehicle_type.icon_url = f"/uploads/icons/{type_id}.png"
    await db.commit()
    await db.refresh(vehicle_type)
    return vehicle_type


@router.get("/vehicle-types/system-blocks/templates")
async def list_system_block_templates(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista las plantillas de bloques disponibles desde la base de datos."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")
    result = await db.execute(
        select(SystemBlockTemplate).order_by(
            SystemBlockTemplate.is_builtin.desc(), SystemBlockTemplate.name
        )
    )
    rows = result.scalars().all()
    # Dict keyed by slug — campos aditivos (uuid, is_builtin) no rompen clientes existentes
    return {
        row.slug: {
            "id": row.slug,
            "uuid": str(row.id),
            "label": row.name,
            "description": row.description or "",
            "blocks": row.blocks,
            "is_builtin": row.is_builtin,
        }
        for row in rows
    }


def _slugify(name: str) -> str:
    """'VPS Cuba' → 'vps_cuba'. Solo ASCII, minúsculas, guiones bajos."""
    normalized = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", normalized.lower()).strip("_") or "plantilla"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    """Garantiza unicidad añadiendo sufijo numérico si el slug ya existe."""
    slug, suffix = base, 2
    while True:
        exists = (await db.execute(
            select(SystemBlockTemplate).where(SystemBlockTemplate.slug == slug)
        )).scalar_one_or_none()
        if not exists:
            return slug
        slug = f"{base}_{suffix}"
        suffix += 1


def _cmg_admin(user: CurrentUser) -> None:
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")


@router.get("/vehicle-types/system-blocks/templates/{template_id}", response_model=SystemBlockTemplateOut)
async def get_system_block_template(
    template_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve una plantilla de bloques por su ID."""
    _cmg_admin(user)
    tpl = (await db.execute(
        select(SystemBlockTemplate).where(SystemBlockTemplate.id == template_id)
    )).scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    return tpl


@router.post("/vehicle-types/system-blocks/templates", response_model=SystemBlockTemplateOut, status_code=201)
async def create_system_block_template(
    body: SystemBlockTemplateCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Crea una nueva plantilla de bloques. El slug se autogenera del nombre."""
    _cmg_admin(user)
    slug = await _unique_slug(db, _slugify(body.name))
    tpl = SystemBlockTemplate(
        slug=slug,
        name=body.name,
        description=body.description,
        blocks=[b.model_dump() for b in body.blocks],
        is_builtin=False,
        created_by=user.user_id,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.put("/vehicle-types/system-blocks/templates/{template_id}", response_model=SystemBlockTemplateOut)
async def update_system_block_template(
    template_id: uuid.UUID,
    body: SystemBlockTemplateUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Edita nombre, descripción y bloques de una plantilla (incluso las de fábrica)."""
    _cmg_admin(user)
    tpl = (await db.execute(
        select(SystemBlockTemplate).where(SystemBlockTemplate.id == template_id)
    )).scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    tpl.name = body.name
    tpl.description = body.description
    tpl.blocks = [b.model_dump() for b in body.blocks]
    flag_modified(tpl, "blocks")
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.delete("/vehicle-types/system-blocks/templates/{template_id}", status_code=204)
async def delete_system_block_template(
    template_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elimina una plantilla (cualquiera, incluyendo las de fábrica)."""
    _cmg_admin(user)
    tpl = (await db.execute(
        select(SystemBlockTemplate).where(SystemBlockTemplate.id == template_id)
    )).scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    await db.delete(tpl)
    await db.commit()


@router.post("/vehicle-types/{type_id}/save-as-template", response_model=SystemBlockTemplateOut, status_code=201)
async def save_vehicle_type_as_template(
    type_id: uuid.UUID,
    body: SaveAsTemplateBody,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Guarda los bloques actuales de un tipo de vehículo como nueva plantilla."""
    _cmg_admin(user)
    vtype = (await db.execute(
        select(VehicleType).where(VehicleType.id == type_id)
    )).scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    slug = await _unique_slug(db, _slugify(body.name))
    tpl = SystemBlockTemplate(
        slug=slug,
        name=body.name,
        description=body.description,
        blocks=list(vtype.system_blocks or []),
        is_builtin=False,
        created_by=user.user_id,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.get("/vehicle-types/{type_id}/system-blocks", response_model=list[SystemBlock])
async def get_vehicle_type_system_blocks(
    type_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve los bloques del panel de diagnóstico configurados para este tipo."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")
    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vtype = result.scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")
    return vtype.system_blocks or []


@router.patch("/vehicle-types/{type_id}/system-blocks", response_model=VehicleTypeOut)
async def update_vehicle_type_system_blocks(
    type_id: uuid.UUID,
    body: VehicleTypeSystemBlocksUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reemplaza completamente los bloques del panel de diagnóstico del tipo."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")
    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vtype = result.scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404)
    vtype.system_blocks = [b.model_dump() for b in body.system_blocks]
    flag_modified(vtype, "system_blocks")
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.post("/vehicle-types/{type_id}/apply-template", response_model=VehicleTypeOut)
async def apply_system_block_template(
    type_id: uuid.UUID,
    body: dict,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aplica una plantilla de bloques al tipo, reemplazando los bloques actuales."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="CMG admin only")
    template_id = body.get("template_id", "")
    tpl_result = await db.execute(
        select(SystemBlockTemplate).where(SystemBlockTemplate.slug == template_id)
    )
    tpl = tpl_result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=400, detail=f"Plantilla '{template_id}' no existe")
    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vtype = result.scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404)
    vtype.system_blocks = tpl.blocks
    flag_modified(vtype, "system_blocks")
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_vehicles(
    request: Request,
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Vehicle).where(Vehicle.active == True)
    if user.tenant_tier == "cmg":
        if tenant_id is not None:
            query = query.where(Vehicle.tenant_id == tenant_id)
    elif user.tenant_tier == "manufacturer":
        if tenant_id is not None and str(tenant_id) != str(user.tenant_id):
            # Manufacturer viendo vehículos de un cliente propio
            target = await db.get(Tenant, tenant_id)
            if not target or str(target.parent_manufacturer_id) != str(user.tenant_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Sin permiso para ver vehículos de este tenant",
                )
            query = query.where(Vehicle.tenant_id == tenant_id)
        else:
            # Manufacturer viendo sus propios vehículos
            query = query.where(Vehicle.manufacturer_tenant_id == user.tenant_id)
    elif user.role == "driver":
        query = query.where(
            Vehicle.id.in_(
                select(VehicleDriverAssignment.vehicle_id)
                .join(Driver, Driver.id == VehicleDriverAssignment.driver_id)
                .where(
                    Driver.user_id == user.user_id,
                    VehicleDriverAssignment.ended_at.is_(None),
                )
            )
        )
    else:
        query = query.where(Vehicle.tenant_id == user.tenant_id)
    from sqlalchemy.orm import joinedload
    result = await db.execute(query.options(joinedload(Vehicle.vehicle_type)).order_by(Vehicle.name))
    vehicles = result.unique().scalars().all()

    # Obtener status de Redis en pipeline (1 round-trip en lugar de N)
    redis = getattr(request.app.state, 'redis', None)
    pipeline_results: list[dict] = []
    if redis and vehicles:
        try:
            pipe = redis.pipeline()
            for v in vehicles:
                pipe.hgetall(f'vehicle:{v.id}:status')
            pipeline_results = await pipe.execute()
        except Exception:
            pipeline_results = []

    def _get(raw, key: str):
        if not raw:
            return None
        val = raw.get(key.encode()) if isinstance(next(iter(raw), None), bytes) else raw.get(key)
        return val.decode() if isinstance(val, bytes) else val

    out = []
    for idx, v in enumerate(vehicles):
        d = VehicleOut.model_validate(v).model_dump()
        d['type_slug'] = v.vehicle_type.slug if v.vehicle_type else None
        raw = pipeline_results[idx] if idx < len(pipeline_results) else None
        if raw:
            try:
                last_seen_str = _get(raw, 'last_seen')
                if last_seen_str:
                    try:
                        ls = datetime.fromisoformat(last_seen_str.replace('Z', '+00:00'))
                        age_min = (datetime.now(timezone.utc) - ls).total_seconds() / 60
                        online = age_min < 5
                    except Exception:
                        online = False
                else:
                    online = False
                spd = _get(raw, 'speed_kmh')
                speed = float(spd) if spd else 0
                ign_raw = _get(raw, 'ignition')
                _ign = ign_raw and ign_raw.lower() in ('true', '1')
                if not online:
                    d['status'] = 'offline'
                elif speed > 2:
                    d['status'] = 'moving'
                elif _ign:
                    d['status'] = 'idle'
                else:
                    d['status'] = 'parked'
                d['last_seen'] = last_seen_str
                lat = _get(raw, 'lat'); lon = _get(raw, 'lon')
                if lat: d['lat'] = float(lat)
                if lon: d['lng'] = float(lon)
                d['speed'] = speed
            except Exception:
                pass
        out.append(d)
    return out


@router.post("/vehicles", response_model=VehicleOut, status_code=201)
async def create_vehicle(
    body: VehicleCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    effective_tenant_id = (
        body.tenant_id
        if (body.tenant_id is not None and user.tenant_tier == "cmg")
        else uuid.UUID(str(user.tenant_id))
    )
    vtype = await db.get(VehicleType, body.vehicle_type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    vehicle = Vehicle(
        tenant_id=effective_tenant_id,
        vehicle_type_id=body.vehicle_type_id,
        name=body.name,
        license_plate=body.license_plate,
        vin=body.vin,
        year=body.year,
    )
    db.add(vehicle)
    try:
        await db.commit()
        await db.refresh(vehicle)
    except IntegrityError as e:
        await db.rollback()
        msg = str(e.orig) if hasattr(e, "orig") else str(e)
        if "vehicle_vin_key" in msg:
            detail = "Ese VIN ya está registrado en otro vehículo"
        elif "license_plate" in msg:
            detail = "Esa matrícula ya está registrada en otro vehículo"
        else:
            detail = "Ya existe un vehículo con esos datos"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    # Auto-create maintenance plans from vehicle type templates
    templates = vtype.maintenance_templates or []
    for tmpl in templates:
        plan = MaintenancePlan(
            vehicle_id=vehicle.id,
            tenant_id=vehicle.tenant_id,
            name=tmpl["name"],
            trigger_condition={
                "thresholds": tmpl["thresholds"],
                "op": "OR",
            },
            warn_before_pct=tmpl.get("warn_before_pct", 10),
            active=True,
        )
        db.add(plan)
    if templates:
        await db.commit()
    return vehicle


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    body: VehicleUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="write")
    if not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    if body.vehicle_type_id is not None:
        vtype = await db.get(VehicleType, body.vehicle_type_id)
        if not vtype:
            raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(vehicle, field, value)
    try:
        await db.commit()
        await db.refresh(vehicle)
    except IntegrityError as e:
        await db.rollback()
        msg = str(e.orig) if hasattr(e, "orig") else str(e)
        if "vehicle_vin_key" in msg:
            detail = "Ese VIN ya está registrado en otro vehículo"
        elif "license_plate" in msg:
            detail = "Esa matrícula ya está registrada en otro vehículo"
        else:
            detail = "Ya existe un vehículo con esos datos"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    return vehicle


@router.get("/vehicles/statuses", response_model=list[VehicleStatus])
async def get_vehicles_statuses_bulk(
    ids: str = Query(..., description="UUIDs separados por coma, máx 200"),
    request: Request = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve el status en Redis de múltiples vehículos en una sola llamada."""
    try:
        vehicle_ids = [uuid.UUID(x.strip()) for x in ids.split(",")][:200]
    except ValueError:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=400, detail="IDs inválidos — deben ser UUIDs válidos")

    redis = request.app.state.redis

    # Filtrar IDs accesibles por jerarquía v2 (subconjunto silencioso, sin 403)
    accessible_set = await list_accessible_vehicle_ids(user, db)
    if accessible_set != "ALL":
        accessible_set_ids = set(accessible_set)
        vehicle_ids = [vid for vid in vehicle_ids if vid in accessible_set_ids]

    if not vehicle_ids:
        return []

    # Validar existencia y active en bulk
    res = await db.execute(
        select(Vehicle).where(Vehicle.id.in_(vehicle_ids), Vehicle.active == True)
    )
    vehicles_by_id = {v.id: v for v in res.scalars().all()}

    # Fabricante cross-tenant: filtrar además por flag operativo del tenant dueño
    # (list_accessible_vehicle_ids solo filtra por manufacturer_tenant_id, sin flags)
    if user.tenant_tier == "manufacturer":
        accessible_ids: list[uuid.UUID] = []
        for vid in vehicle_ids:
            if vid not in vehicles_by_id:
                continue
            try:
                await assert_can_access_vehicle(user, vid, db, operation="read", scope="operational")
                accessible_ids.append(vid)
            except Exception:
                continue
    else:
        accessible_ids = [vid for vid in vehicle_ids if vid in vehicles_by_id]

    if not accessible_ids:
        return []

    # Leer Redis en pipeline: un hgetall por vehicle en una sola operación
    try:
        pipe = redis.pipeline()
        for vid in accessible_ids:
            pipe.hgetall(f"vehicle:{vid}:status")
        pipeline_results = await pipe.execute()
    except Exception:
        logger.warning("Redis unavailable for bulk vehicle statuses")
        return [VehicleStatus(vehicle_id=vid, online=False) for vid in accessible_ids]

    def _parse_bool(val: str | None) -> bool | None:
        if val is None:
            return None
        return val.lower() in ("true", "1", "yes")

    def _parse_float(val: str | None) -> float | None:
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    def _parse_datetime(val: str | None) -> datetime | None:
        if val is None:
            return None
        try:
            return datetime.fromisoformat(val)
        except (ValueError, TypeError):
            return None

    def _parse_json(val: str | None) -> dict | None:
        if val is None:
            return None
        try:
            return json.loads(val)
        except (ValueError, TypeError):
            return None

    def _get(hash_data: dict, key: str) -> str | None:
        raw = hash_data.get(key.encode()) if hash_data and isinstance(next(iter(hash_data), None), bytes) else hash_data.get(key)
        if raw is None:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw

    # Obtener estados DOUT en pipeline también
    try:
        pipe2 = redis.pipeline()
        for vid in accessible_ids:
            pipe2.get(f"vehicle:{vid}:dout")
        dout_results = await pipe2.execute()
    except Exception:
        dout_results = [None] * len(accessible_ids)

    statuses: list[VehicleStatus] = []
    for vid, hash_data, dout_raw in zip(accessible_ids, pipeline_results, dout_results):
        if not hash_data:
            # Sin datos en Redis → omitir del resultado
            continue

        ext_voltage_str = _get(hash_data, "ext_voltage_mv")
        ext_voltage_mv = None
        if ext_voltage_str:
            try:
                ext_voltage_mv = int(float(ext_voltage_str))
            except (ValueError, TypeError):
                pass

        heading_str = _get(hash_data, "heading")
        heading: int | None = None
        if heading_str:
            try:
                heading = int(float(heading_str))
            except (ValueError, TypeError):
                pass

        dout_state: dict[int, bool] = {}
        if dout_raw:
            try:
                dout_state = {int(k): bool(v) for k, v in json.loads(dout_raw).items()}
            except (ValueError, TypeError):
                pass

        can_str = _get(hash_data, "can_data")
        can_data = _parse_json(can_str)
        pto_str = _get(hash_data, "pto_active")
        pto_active = _parse_bool(pto_str)
        ignition_val = _parse_bool(_get(hash_data, "ignition"))

        if not ignition_val and can_data:
            if _ignition_from_can(can_data):
                ignition_val = True
        if not pto_active and can_data:
            if can_data.get("avl_2") == 1 or can_data.get("avl_179") == 1:
                pto_active = True

        last_seen_str = _get(hash_data, "last_seen")
        last_seen_dt = _parse_datetime(last_seen_str)
        received_at_dt = _parse_datetime(_get(hash_data, "received_at"))
        if last_seen_dt:
            age_minutes = (datetime.now(timezone.utc) - last_seen_dt).total_seconds() / 60
            effective_online = age_minutes < 5
        else:
            effective_online = False

        statuses.append(VehicleStatus(
            vehicle_id=vid,
            online=effective_online,
            last_seen=last_seen_dt,
            device_last_seen=received_at_dt,
            lat=_parse_float(_get(hash_data, "lat")),
            lon=_parse_float(_get(hash_data, "lon")),
            speed_kmh=_parse_float(_get(hash_data, "speed_kmh")),
            heading=heading,
            ignition=ignition_val,
            pto_active=pto_active,
            ext_voltage_mv=ext_voltage_mv,
            can_data=can_data,
            dout_state=dout_state,
        ))

    return statuses


@router.get("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read")
    if not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    return vehicle


@router.get("/vehicles/{vehicle_id}/status", response_model=VehicleStatus)
async def get_vehicle_status(
    vehicle_id: uuid.UUID,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read", scope="operational")
    if not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    redis = request.app.state.redis
    redis_key = f"vehicle:{vehicle_id}:status"
    try:
        hash_data = await redis.hgetall(redis_key)
    except Exception:
        logger.warning("Redis unavailable for vehicle status %s, returning offline", vehicle_id)
        return VehicleStatus(vehicle_id=vehicle_id, online=False)

    if not hash_data:
        return VehicleStatus(vehicle_id=vehicle_id, online=False)

    def _parse_bool(val: str | None) -> bool | None:
        if val is None:
            return None
        return val.lower() in ("true", "1", "yes")

    def _parse_float(val: str | None) -> float | None:
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    def _parse_datetime(val: str | None) -> datetime | None:
        if val is None:
            return None
        try:
            return datetime.fromisoformat(val)
        except (ValueError, TypeError):
            logger.warning("Failed to parse datetime from Redis: %r", val)
            return None

    def _parse_json(val: str | None) -> dict | None:
        if val is None:
            return None
        try:
            return json.loads(val)
        except (ValueError, TypeError):
            return None

    def _get(key: str) -> str | None:
        raw = hash_data.get(key.encode()) if hash_data and isinstance(next(iter(hash_data), None), bytes) else hash_data.get(key)
        if raw is None:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw

    online_str = _get("online")
    last_seen_str = _get("last_seen")
    lat_str = _get("lat")
    lon_str = _get("lon")
    speed_str = _get("speed_kmh")
    ignition_str = _get("ignition")
    pto_str = _get("pto_active")
    ext_voltage_str = _get("ext_voltage_mv")
    heading_str = _get("heading")
    can_str = _get("can_data")
    received_at_str = _get("received_at")

    ext_voltage_mv = None
    if ext_voltage_str:
        try:
            ext_voltage_mv = int(float(ext_voltage_str))
        except (ValueError, TypeError):
            pass

    heading: int | None = None
    if heading_str:
        try:
            heading = int(float(heading_str))
        except (ValueError, TypeError):
            pass

    dout_raw = await redis.get(f"vehicle:{vehicle_id}:dout")
    dout_state: dict[int, bool] = {}
    if dout_raw:
        try:
            dout_state = {int(k): bool(v) for k, v in json.loads(dout_raw).items()}
        except (ValueError, TypeError):
            pass

    can_data = _parse_json(can_str)
    pto_active = _parse_bool(pto_str)
    ignition_val = _parse_bool(ignition_str)

    # Fallback ignición: RPM > umbral (primario); si no llega RPM, DIN2 (avl_2) o avl_239.
    if not ignition_val and can_data:
        if _ignition_from_can(can_data):
            ignition_val = True

    # Fallback PTO: si Redis tiene pto_active=false pero DIN1 (avl_1) o avl_179 = 1.
    if not pto_active and can_data:
        if can_data.get("avl_1") == 1 or can_data.get("avl_179") == 1:
            pto_active = True

    # Recalcular online basado en last_seen (< 5 min = online real)
    last_seen_dt = _parse_datetime(last_seen_str)
    if last_seen_dt:
        age_minutes = (datetime.now(timezone.utc) - last_seen_dt).total_seconds() / 60
        effective_online = age_minutes < 5
    else:
        effective_online = False

    # Calcular status
    _speed = _parse_float(speed_str) or 0
    _ign_det = ignition_val or False
    if not effective_online:
        _vstatus = 'offline'
    elif _speed > 2:
        _vstatus = 'moving'
    elif _ign_det:
        _vstatus = 'idle'
    else:
        _vstatus = 'parked'
    _lon = _parse_float(lon_str)
    return VehicleStatus(
        vehicle_id=vehicle_id,
        online=effective_online,
        last_seen=last_seen_dt,
        device_last_seen=_parse_datetime(received_at_str),
        lat=_parse_float(lat_str),
        lon=_lon,
        lng=_lon,
        speed_kmh=_speed,
        heading=heading,
        ignition=ignition_val,
        pto_active=pto_active,
        ext_voltage_mv=ext_voltage_mv,
        can_data=can_data,
        dout_state=dout_state,
        status=_vstatus,
    )


@router.get("/vehicles/{vehicle_id}/telemetry/latest", response_model=TelemetryPoint)
async def get_vehicle_telemetry_latest(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    since = datetime.now(timezone.utc) - timedelta(days=7)
    row = (
        await db.execute(
            text(
                "SELECT time, lat, lon, speed_kmh, heading, altitude_m, "
                "ignition, pto_active, ext_voltage_mv, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid AND time >= :since "
                "ORDER BY time DESC LIMIT 1"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "since": since},
        )
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No hay telemetría reciente")

    return TelemetryPoint(**dict(row._mapping))


@router.get("/vehicles/{vehicle_id}/telemetry/history", response_model=list[TelemetryPoint])
async def get_vehicle_telemetry_history(
    vehicle_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 500,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 5000:
        limit = 5000
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    if start is None:
        start = datetime.now(timezone.utc) - timedelta(days=1)
    if end is None:
        end = datetime.now(timezone.utc)
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be <= end")

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon, speed_kmh, heading, altitude_m, "
                "ignition, pto_active, ext_voltage_mv, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= :start AND time <= :end "
                "ORDER BY time DESC LIMIT :lim"
            ),
            {
                "vid": vehicle_id,
                "tid": vehicle.tenant_id,
                "start": start,
                "end": end,
                "lim": limit,
            },
        )
    ).fetchall()

    return [TelemetryPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/track/today", response_model=list[TrackPoint])
async def get_vehicle_track_today(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read", scope="operational")
    if not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= current_date::timestamptz "
                "AND lat IS NOT NULL AND lon IS NOT NULL "
                "ORDER BY time ASC LIMIT 2000"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id},
        )
    ).fetchall()

    return [TrackPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/track", response_model=list[TrackPoint])
async def get_vehicle_track(
    vehicle_id: uuid.UUID,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read", scope="operational")
    if not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    if from_ > to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from debe ser anterior a to")

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= :from_ AND time <= :to "
                "AND lat IS NOT NULL AND lon IS NOT NULL "
                "ORDER BY time ASC LIMIT 2000"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "from_": from_, "to": to},
        )
    ).fetchall()

    return [TrackPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/trips", response_model=DayTrips)
async def get_vehicle_trips(
    vehicle_id: uuid.UUID,
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="Fecha YYYY-MM-DD (Europe/Madrid)"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DayTrips:
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read", scope="operational")
    if not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    try:
        naive = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato de fecha inválido")

    day_start = naive.replace(tzinfo=_TZ_MADRID)
    day_end   = (naive + timedelta(days=1)).replace(tzinfo=_TZ_MADRID)

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon, ignition, speed_kmh "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND lat IS NOT NULL AND lon IS NOT NULL "
                "AND time >= :day_start AND time < :day_end "
                "ORDER BY time ASC "
                "LIMIT 10000"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "day_start": day_start, "day_end": day_end},
        )
    ).fetchall()

    trips, totals = _segment_trips([dict(r._mapping) for r in rows])
    return DayTrips(date=date, trips=trips, totals=totals)


@router.get("/vehicles/{vehicle_id}/avl-series")
async def get_vehicle_avl_series(
    vehicle_id: uuid.UUID,
    avl_id: int = Query(..., description="AVL ID a consultar (ej: 145)"),
    hours: int = Query(168, ge=1, le=720),
    start: datetime | None = None,
    end: datetime | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve serie temporal de cualquier AVL ID desde telemetry_record.can_data."""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    if start is not None and end is not None:
        since = start
        until = end
    else:
        until = datetime.now(timezone.utc)
        since = until - timedelta(hours=hours)

    key = f"avl_{avl_id}"
    range_hours = (until - since).total_seconds() / 3600.0

    # Para rangos > 24h agregamos por hora con time_bucket — evita devolver decenas
    # de miles de puntos crudos y aprovecha la hypertable.
    if range_hours > 24:
        rows = await db.execute(
            text("""
                SELECT time_bucket('1 hour', time) AS bucket,
                       AVG((can_data->>:key)::numeric) AS value
                FROM telemetry_record
                WHERE vehicle_id = :vid
                  AND time >= :since
                  AND time <= :until
                  AND can_data ? :key
                  AND (can_data->>:key) IS NOT NULL
                GROUP BY bucket
                ORDER BY bucket ASC
                LIMIT 5000
            """),
            {"vid": str(vehicle_id), "key": key, "since": since, "until": until},
        )
    else:
        rows = await db.execute(
            text("""
                SELECT time AS bucket,
                       (can_data->>:key)::numeric AS value
                FROM telemetry_record
                WHERE vehicle_id = :vid
                  AND time >= :since
                  AND time <= :until
                  AND can_data ? :key
                  AND (can_data->>:key) IS NOT NULL
                ORDER BY time ASC
                LIMIT 5000
            """),
            {"vid": str(vehicle_id), "key": key, "since": since, "until": until},
        )
    data = rows.fetchall()
    return [
        {"bucket": r[0].isoformat(), "value": float(r[1]) if r[1] is not None else None}
        for r in data
    ]


@router.get("/vehicles/{vehicle_id}/kpis", response_model=list[KpiHour])
async def get_vehicle_kpis(
    vehicle_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    if start is None:
        start = datetime.now(timezone.utc) - timedelta(hours=24)
    if end is None:
        end = datetime.now(timezone.utc)
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be <= end")

    rows = (
        await db.execute(
            text(
                "SELECT bucket, avg_pressure_1, max_pressure_1, avg_oil_temp, "
                "max_oil_temp, pto_active_minutes, engine_on_minutes, record_count "
                "FROM telemetry_1h "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND bucket >= :start AND bucket <= :end "
                "ORDER BY bucket DESC"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "start": start, "end": end},
        )
    ).fetchall()

    return [KpiHour(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/maintenance", response_model=list[MaintenancePlanOut])
async def list_vehicle_maintenance(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read")

    result = await db.execute(
        select(MaintenancePlan)
        .where(MaintenancePlan.vehicle_id == vehicle_id)
        .order_by(MaintenancePlan.name)
    )
    plans = result.scalars().all()

    # Import here to avoid circular import at module level
    from app.api.v1.maintenance import _to_out as _maintenance_to_out
    return [await _maintenance_to_out(p, vehicle.name, db) for p in plans]


class DoutCommand(BaseModel):
    slot: int = Field(..., ge=1, le=4)
    state: bool


@router.post("/vehicles/{vehicle_id}/dout", status_code=200)
async def send_dout_command(
    vehicle_id: uuid.UUID,
    body: DoutCommand,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Se requiere rol admin u operador")
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="write")
    if not vehicle.active:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="No hay dispositivo activo vinculado al vehículo")

    # Build setdigout command: "setdigout XXXX 0" — FMC650 has 4 DOUTs, needs exactly 4 chars
    chars = ["?", "?", "?", "?"]
    if 1 <= body.slot <= 4:
        chars[body.slot - 1] = "1" if body.state else "0"
    command = f"setdigout {''.join(chars)} 0"

    redis = request.app.state.redis

    # Persist state so it survives browser refresh / other sessions
    dout_key = f"vehicle:{vehicle_id}:dout"
    dout_raw = await redis.get(dout_key)
    dout_state: dict[str, bool] = {}
    if dout_raw:
        try:
            dout_state = json.loads(dout_raw)
        except (ValueError, TypeError):
            pass
    dout_state[str(body.slot)] = body.state
    await redis.set(dout_key, json.dumps(dout_state))

    await redis.publish("cmg:dout_commands", json.dumps({
        "imei": device.imei,
        "command": command,
        "device_id": str(device.id),
        "vehicle_id": str(vehicle_id),
        "tenant_id": str(vehicle.tenant_id),
    }))
    logger.info("DOUT publicado → IMEI %s slot=%s state=%s", device.imei, body.slot, body.state)
    return {"ok": True, "imei": device.imei, "command": command}


# ── GDPR Art. 17 — purga irreversible por vehículo ──────────────────────────

class _GdprPurgeBody(BaseModel):
    confirm: str = Field(..., description="Debe ser exactamente 'PURGE-{vehicle_id}'")


@router.delete("/vehicles/{vehicle_id}/gdpr-purge", status_code=200)
async def gdpr_purge_vehicle(
    vehicle_id: uuid.UUID,
    body: _GdprPurgeBody,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Purga hard-delete de todos los datos de un vehículo (Art. 17 GDPR).
    Exclusivo CMG admin. Operación atómica — rollback total si falla algo.
    """
    _cmg_admin(user)

    expected = f"PURGE-{vehicle_id}"
    if body.confirm != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Confirmación inválida — envía {{\"confirm\": \"{expected}\"}}",
        )

    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    vid = str(vehicle_id)
    tenant_id = str(vehicle.tenant_id)
    ip = (request.headers.get("X-Real-IP") or
          (request.client.host if request.client else None))
    ua = request.headers.get("user-agent")

    try:
        # 1. alert_instance — FK NO ACTION bloquea DELETE vehicle si queda alguna
        r_alerts = await db.execute(
            text("DELETE FROM alert_instance WHERE vehicle_id = :vid"),
            {"vid": vehicle_id},
        )
        # 2. work_order_stop — lat/lon + client_name (datos personales en paradas)
        r_stops = await db.execute(
            text("""
                DELETE FROM work_order_stop
                WHERE work_order_id IN (
                    SELECT id FROM work_order WHERE vehicle_id = :vid
                )
            """),
            {"vid": vehicle_id},
        )
        # 3. Telemetría cruda (hypertable)
        r_raw = await db.execute(
            text("DELETE FROM telemetry_record WHERE vehicle_id = :vid"),
            {"vid": vehicle_id},
        )
        # 4. KPIs materializados (CA — TimescaleDB enruta a _materialized_hypertable_3)
        r_ca = await db.execute(
            text("DELETE FROM telemetry_1h WHERE vehicle_id = :vid"),
            {"vid": vehicle_id},
        )
        # 5. Audit log de accesos a este vehículo (IP + user_agent = dato personal)
        r_audit = await db.execute(
            text("DELETE FROM access_audit_log WHERE target_vehicle_id = :vid"),
            {"vid": vehicle_id},
        )
        # 6. Vehículo — CASCADE: command_log, maintenance_log/plan, assignments, work_cycle
        #    SET NULL automático: work_order, work_report, device
        await db.execute(
            text("DELETE FROM vehicle WHERE id = :vid"),
            {"vid": vehicle_id},
        )

        counts = {
            "alert_instances":        r_alerts.rowcount,
            "work_order_stops":       r_stops.rowcount,
            "telemetry_record":       r_raw.rowcount,
            "telemetry_1h":           r_ca.rowcount,
            "access_audit_deleted":   r_audit.rowcount,
        }

        # 7. Prueba de cumplimiento Art. 5(2) — esta fila SE CONSERVA
        await db.execute(
            text("""
                INSERT INTO access_audit_log
                    (time, user_id, user_tenant_id, user_tenant_tier,
                     target_vehicle_id, target_tenant_id,
                     operation, scope, justification, endpoint, ip_address, user_agent)
                VALUES
                    (now(), :uid, :utid, :utier,
                     :vid, :tid,
                     'GDPR_PURGE', 'vehicle', :justif, :ep, :ip, :ua)
            """),
            {
                "uid":   user.user_id,
                "utid":  user.tenant_id,
                "utier": user.tenant_tier,
                "vid":   vehicle_id,
                "tid":   vehicle.tenant_id,
                "justif": f"Purga GDPR Art.17 — {counts}",
                "ep":    str(request.url.path),
                "ip":    ip,
                "ua":    ua,
            },
        )

        await db.commit()

    except Exception:
        await db.rollback()
        raise

    logger.info(
        "GDPR_PURGE vehicle=%s tenant=%s by user=%s | %s",
        vid, tenant_id, user.user_id, counts,
    )
    return {"vehicle_id": vid, "purged": counts}
