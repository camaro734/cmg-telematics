"""Retroactive work cycle detection from telemetry_record.

detect_and_store_cycles() is the public entry point. It queries telemetry_record
for the given vehicle+period, groups records into cycles per trigger_type, builds
cycle_data from snapshot/aggregate fields, and writes work_cycle rows to the DB.
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_, select, text

from app.models.work_cycle import WorkCycleDefinition, WorkCycle
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.services.geo import haversine_m
from app.services.sensor_transform import apply_transform

logger = logging.getLogger(__name__)


# Whitelist of allowed extra columns in _query_telemetry.
# Protection against accidental exposure of non-scoped fields in future changes.
# status_field de sensor_schema puede apuntar a estas columnas nativas del row.
_ALLOWED_EXTRA_COLS = frozenset({"pto_active", "ignition", "ext_voltage_mv", "speed_kmh"})

# Valores "not available" del estándar J1939 (1/2/4 bytes). Espejo de
# frontend/src/lib/sensorValue.ts::J1939_NA.
_J1939_NA = frozenset({0xFF, 0xFFFF, 0xFFFFFFFF})


def _build_schema_index(sensor_schema: list | None) -> dict[str, dict]:
    """Indexa el sensor_schema por su ``key`` para resolver señales por nombre."""
    index: dict[str, dict] = {}
    for s in sensor_schema or []:
        if isinstance(s, dict) and s.get("key"):
            index[s["key"]] = s
    return index


def _resolve_field_value(
    field: str, can_data: dict | None, row: dict, schema_by_key: dict[str, dict]
) -> float | None:
    """Resuelve el valor físico de un ``field`` (key de sensor_schema) en una fila.

    Traduce ``key`` → ``avl_<id>`` (o columna nativa vía ``status_field``), aplica
    ``bit_index`` para señales digitales y ``apply_transform`` (scale/transform)
    para analógicas. Espejo de ``frontend/src/lib/sensorValue.ts``.
    Fallback retrocompatible: si ``field`` no está en el schema, se busca como clave
    directa de ``can_data`` (comportamiento legado para definiciones antiguas/tests).
    """
    sensor = schema_by_key.get(field)
    can = can_data or {}
    if sensor is None:
        return _to_float(can.get(field))

    status_field = sensor.get("status_field")
    if status_field:
        val = row.get(status_field)
        if isinstance(val, bool):
            return 1.0 if val else 0.0
        return _to_float(val)

    avl_id = sensor.get("avl_id")
    if avl_id is None:
        return None
    raw = _to_float(can.get(f"avl_{avl_id}"))
    if raw is None:
        return None
    if raw in _J1939_NA or raw in (sensor.get("invalid_values") or []):
        return None

    bit_index = sensor.get("bit_index")
    if bit_index is not None:
        return float((int(raw) >> int(bit_index)) & 1)
    return apply_transform(raw, sensor)


def _to_float(raw: Any) -> float | None:
    if raw is None or isinstance(raw, bool):
        return 1.0 if raw is True else (0.0 if raw is False else None)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


async def detect_and_store_cycles(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    tenant_id: uuid.UUID,
    definition: WorkCycleDefinition,
    from_dt: datetime,
    to_dt: datetime,
) -> int:
    """Detect cycles and persist them. Returns number of cycles written."""
    await db.execute(
        text("""
            DELETE FROM work_cycle
            WHERE vehicle_id = :vid AND definition_id = :did
              AND tenant_id = :tid
              AND started_at >= :from_dt AND started_at < :to_dt
        """),
        {"vid": str(vehicle_id), "did": str(definition.id), "tid": str(tenant_id), "from_dt": from_dt, "to_dt": to_dt},
    )

    trigger_type = definition.trigger_type
    config = definition.trigger_config or {}

    # Catálogo de señales del tipo de vehículo: necesario para traducir los nombres
    # (key) de las definiciones a las claves reales avl_<id> de can_data.
    sensor_schema = await db.scalar(
        select(VehicleType.sensor_schema).where(VehicleType.id == definition.vehicle_type_id)
    )
    schema_by_key = _build_schema_index(sensor_schema)

    # Configuración v2 de la regla de intervención (migración 062).
    merge_window = int(definition.merge_window_seconds or 300)
    safety_radius = int(definition.safety_radius_m or 150)
    is_end = _make_end_predicate(
        definition.end_trigger_type, definition.end_trigger_config or {}, schema_by_key
    )

    if trigger_type == "pto_change":
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=["pto_active"])
        groups = _group_with_merge(
            rows, _make_bool_col_predicate("pto_active"), merge_window, safety_radius, is_end
        )
    elif trigger_type == "ignition_period":
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=["ignition"])
        groups = _group_with_merge(
            rows, _make_bool_col_predicate("ignition"), merge_window, safety_radius, is_end
        )
    elif trigger_type == "threshold_exceeded":
        sensor = config.get("sensor", "")
        threshold = float(config.get("threshold", 0))
        operator = config.get("op", ">")
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _group_with_merge(
            rows, _make_threshold_predicate(sensor, threshold, operator, schema_by_key),
            merge_window, safety_radius, is_end,
        )
    elif trigger_type == "sensor_pulse":
        sensor = config.get("sensor", "")
        min_gap = int(config.get("min_gap_seconds", 30))
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _detect_pulses(rows, sensor, min_gap, schema_by_key)
    else:
        return 0

    snapshot_fields: list[str] = definition.snapshot_fields or []
    aggregate_fields: list[str] = definition.aggregate_fields or []
    is_pulse = trigger_type == "sensor_pulse"

    # Paradas candidatas para asociar la intervención por geofence al cerrar.
    stops = await _fetch_active_stops(db, tenant_id, vehicle_id)

    for g in groups:
        group_rows = g["rows"]
        if not group_rows:
            continue
        cycle_data = _build_cycle_data(group_rows, snapshot_fields, aggregate_fields, schema_by_key)
        start_row = group_rows[0]
        end_row = group_rows[-1]
        started_at: datetime = start_row["recorded_at"]
        ended_at: datetime | None = None if is_pulse else end_row["recorded_at"]
        duration: int | None = (
            None if is_pulse
            else int((end_row["recorded_at"] - started_at).total_seconds())
        )
        # Asociación OT por geofence (auto/pending/sin_asignar) según la ubicación de inicio.
        assignment_status, work_order_id, work_order_stop_id = _classify_assignment(
            start_row.get("lat"), start_row.get("lon"), stops
        )
        db.add(WorkCycle(
            vehicle_id=vehicle_id,
            definition_id=definition.id,
            tenant_id=tenant_id,
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=duration,
            cycle_data=cycle_data,
            lat=start_row.get("lat"),
            lon=start_row.get("lon"),
            work_order_id=work_order_id,
            work_order_stop_id=work_order_stop_id,
            assignment_status=assignment_status,
        ))

    await db.commit()
    return len(groups)


async def recompute_cycles_for_report(
    db: AsyncSession,
    *,
    from_dt: datetime,
    to_dt: datetime,
    vehicle_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    tenant_scope: uuid.UUID | None = None,
) -> int:
    """Recomputa (idempotente) las intervenciones del rango para los vehículos en
    scope, justo antes de leer el reporte de partes.

    Hace que los partes salgan para CUALQUIER fecha sin depender de la ventana
    rolling del runner programado (que solo cubre las últimas 2 h y se perdía los
    días en que el servicio no corría). ``detect_and_store_cycles`` es DELETE+INSERT
    transaccional por ventana, así que repetirlo es seguro y nunca deja huecos.

    Respeta el scope multi-tenant: CMG admin (tenant_scope=None) procesa todos los
    vehículos activos; el resto solo los de su tenant.
    """
    q = select(Vehicle).where(Vehicle.active.is_(True))
    if vehicle_id is not None:
        q = q.where(Vehicle.id == vehicle_id)
    if tenant_scope is not None:
        q = q.where(Vehicle.tenant_id == tenant_scope)
    if client_id is not None:
        q = q.where(Vehicle.tenant_id == client_id)
    vehicles = (await db.execute(q)).scalars().all()

    total = 0
    for vehicle in vehicles:
        defs = (await db.execute(
            select(WorkCycleDefinition).where(
                WorkCycleDefinition.vehicle_type_id == vehicle.vehicle_type_id,
                WorkCycleDefinition.active.is_(True),
                or_(
                    WorkCycleDefinition.tenant_id == vehicle.tenant_id,
                    WorkCycleDefinition.tenant_id.is_(None),
                ),
            )
        )).scalars().all()
        for defn in defs:
            try:
                total += await detect_and_store_cycles(
                    db, vehicle.id, vehicle.tenant_id, defn, from_dt, to_dt
                )
            except Exception as exc:  # noqa: BLE001 — un fallo no debe tumbar el reporte
                logger.warning(
                    "recompute_cycles_for_report: fallo vehicle=%s def=%s: %s",
                    vehicle.id, defn.id, exc,
                )
    return total


async def _fetch_active_stops(
    db: AsyncSession, tenant_id: uuid.UUID, vehicle_id: uuid.UUID
) -> list[dict]:
    """Paradas (work_order_stop) candidatas para asociación por geofence.

    Sólo paradas activas (no ``done``/``skipped``) con coordenadas, de OTs del mismo
    tenant y vehículo. Reutiliza el criterio de radio (``arrival_radius_m``) del
    geofence de stop_autoclose.
    """
    result = await db.execute(
        text("""
            SELECT wos.id, wos.work_order_id, wos.lat, wos.lon, wos.arrival_radius_m
            FROM work_order_stop wos
            JOIN work_order wo ON wo.id = wos.work_order_id
            WHERE wo.tenant_id = :tid
              AND wo.vehicle_id = :vid
              AND wos.status NOT IN ('done', 'skipped')
              AND wos.lat IS NOT NULL AND wos.lon IS NOT NULL
        """),
        {"tid": str(tenant_id), "vid": str(vehicle_id)},
    )
    return [dict(row._mapping) for row in result]


def _classify_assignment(
    lat, lon, stops: list[dict]
) -> tuple[str, uuid.UUID | None, uuid.UUID | None]:
    """Resuelve la asociación de una intervención a una parada de OT por geofence.

    - Dentro del radio de **una** parada → ``('auto', work_order_id, stop_id)``.
    - Dentro de **varias** paradas candidatas → ``('pending', None, None)`` (no se adivina).
    - **Ninguna** → ``('sin_asignar', None, None)``.
    """
    if lat is None or lon is None:
        return ("sin_asignar", None, None)
    clat, clon = float(lat), float(lon)
    matches: list[dict] = []
    for s in stops:
        slat, slon = s.get("lat"), s.get("lon")
        if slat is None or slon is None:
            continue
        radius = float(s.get("arrival_radius_m") or 150)
        if haversine_m(clat, clon, float(slat), float(slon)) <= radius:
            matches.append(s)
    if len(matches) == 1:
        return ("auto", matches[0]["work_order_id"], matches[0]["id"])
    if len(matches) > 1:
        return ("pending", None, None)
    return ("sin_asignar", None, None)


async def _query_telemetry(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    extra_cols: list[str],
) -> list[dict]:
    safe_extras = [c for c in extra_cols if c in _ALLOWED_EXTRA_COLS]
    col_list = ", ".join(["time AS recorded_at", "lat", "lon", "can_data"] + safe_extras)
    result = await db.execute(
        text(f"""
            SELECT {col_list}
            FROM telemetry_record
            WHERE vehicle_id = :vid
              AND time >= :from_dt AND time < :to_dt
            ORDER BY time
        """),
        {"vid": str(vehicle_id), "from_dt": from_dt, "to_dt": to_dt},
    )
    return [dict(row._mapping) for row in result]


# Operadores de comparación soportados por triggers de umbral (inicio y fin).
_OPS = {
    ">":  lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<":  lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
}


def _row_latlon(row: dict) -> tuple[float, float] | None:
    """Extrae (lat, lon) como floats; None si falta alguno o no es numérico."""
    lat, lon = row.get("lat"), row.get("lon")
    if lat is None or lon is None:
        return None
    try:
        return (float(lat), float(lon))
    except (TypeError, ValueError):
        return None


def _make_bool_col_predicate(col: str):
    """Predicado para columnas booleanas nativas (pto_active, ignition)."""
    return lambda row: row.get(col) is True


def _make_threshold_predicate(sensor: str, threshold: float, op: str, schema_by_key: dict[str, dict]):
    """Predicado de umbral sobre una señal resuelta por key del sensor_schema."""
    cmp = _OPS.get(op, _OPS["=="])

    def pred(row: dict) -> bool:
        v = _resolve_field_value(sensor, row.get("can_data"), row, schema_by_key)
        return v is not None and cmp(v, threshold)

    return pred


def _make_end_predicate(end_trigger_type: str | None, end_config: dict, schema_by_key: dict[str, dict]):
    """Construye el predicado de fin configurable, o None si el fin es implícito.

    El editor (WorkCycleDefsSection) sólo produce ``end_trigger_type='threshold_exceeded'``
    con ``end_trigger_config={sensor, op, value}`` (umbral bajo la clave ``value``).
    """
    if not end_trigger_type:
        return None
    if end_trigger_type == "threshold_exceeded":
        sensor = end_config.get("sensor", "")
        # El fin guarda el umbral bajo "value"; se acepta "threshold" como alias defensivo.
        value = float(end_config.get("value", end_config.get("threshold", 0)))
        op = end_config.get("op", "<")
        return _make_threshold_predicate(sensor, value, op, schema_by_key)
    return None


def _group_with_merge(
    rows: list[dict],
    is_active,
    merge_window_seconds: int,
    safety_radius_m: int,
    is_end=None,
) -> list[dict]:
    """Agrupa filas en intervenciones aplicando ventana de fusión y radio de seguridad.

    - **Inicio:** la primera fila con ``is_active`` abre la intervención.
    - **Fin explícito** (``is_end`` no es None): cierra en la primera fila con
      ``is_end`` True (inclusive); la inactividad del inicio NO cierra.
    - **Fin implícito** (``is_end`` None): si el inicio se apaga pero vuelve dentro de
      ``merge_window_seconds`` Y el vehículo sigue dentro de ``safety_radius_m`` del
      punto de inicio → misma intervención (se puentea el hueco). Si la ventana expira
      O el vehículo sale del radio → cierra (fin = última fila activa).
    """
    cycles: list[dict] = []
    current: list[dict] = []   # filas confirmadas (activas + huecos ya puenteados)
    pending: list[dict] = []   # filas de hueco tentativas (aún sin confirmar)
    anchor: tuple[float, float] | None = None

    def _close() -> None:
        nonlocal current, pending, anchor
        if current:
            cycles.append({"rows": current})
        current, pending, anchor = [], [], None

    for row in rows:
        if not current:
            if is_active(row):
                current = [row]
                pending = []
                anchor = _row_latlon(row)
            continue

        # Fin explícito: el disparador de fin manda; acumula hasta que se cumple.
        if is_end is not None:
            current.append(row)
            if is_end(row):
                _close()
            continue

        # Fin implícito: inicio activo → continúa (puenteando hueco previo si lo hay).
        if is_active(row):
            if pending:
                current.extend(pending)
                pending = []
            current.append(row)
            continue

        # Inicio inactivo → hueco: ¿puentear (ventana+radio) o cerrar?
        gap_s = (row["recorded_at"] - current[-1]["recorded_at"]).total_seconds()
        ll = _row_latlon(row)
        left_radius = (
            anchor is not None and ll is not None
            and haversine_m(anchor[0], anchor[1], ll[0], ll[1]) > safety_radius_m
        )
        if left_radius or gap_s > merge_window_seconds:
            _close()
        else:
            pending.append(row)

    _close()
    return cycles


def _detect_pulses(
    rows: list[dict], sensor: str, min_gap_seconds: int, schema_by_key: dict[str, dict]
) -> list[dict]:
    pulses: list[dict] = []
    last_t: datetime | None = None
    for row in rows:
        val = _resolve_field_value(sensor, row.get("can_data"), row, schema_by_key)
        if val is not None and val != 0:
            t: datetime = row["recorded_at"]
            if last_t is None or (t - last_t).total_seconds() >= min_gap_seconds:
                pulses.append({"rows": [row]})
                last_t = t
    return pulses


def _build_cycle_data(
    rows: list[dict],
    snapshot_fields: list[str],
    aggregate_fields: list[str],
    schema_by_key: dict[str, dict],
) -> dict[str, Any]:
    """Construye cycle_data resolviendo cada field (key de sensor_schema) a su valor
    físico (avl_<id> traducido + bit_index/transform). Ver _resolve_field_value."""
    data: dict[str, Any] = {}
    if not rows:
        return data

    first, last = rows[0], rows[-1]
    for field in snapshot_fields:
        if (v := _resolve_field_value(field, first.get("can_data"), first, schema_by_key)) is not None:
            data[f"{field}_start"] = v
        if (v := _resolve_field_value(field, last.get("can_data"), last, schema_by_key)) is not None:
            data[f"{field}_end"] = v

    for field in aggregate_fields:
        values = [
            v for row in rows
            if (v := _resolve_field_value(field, row.get("can_data"), row, schema_by_key)) is not None
        ]
        if values:
            data[f"{field}_sum"] = round(sum(values), 3)
            data[f"{field}_avg"] = round(sum(values) / len(values), 3)
            data[f"{field}_max"] = round(max(values), 3)
            data[f"{field}_min"] = round(min(values), 3)

    return data
