# backend/app/schemas/vehicle.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.maintenance import MaintenanceTemplateItem, MaintenanceCounter


# Métricas "de parada": columnas fijas que el rules-engine agrega en work_order_stop.
STOP_METRIC_KEYS = frozenset({'pto_minutes', 'pressure_min', 'pressure_max', 'rpm_avg', 'pump_minutes', 'fuel_l'})
PdfMetricFormat = Literal['integer', 'decimal1', 'decimal2']
PdfMetricSource = Literal['stop', 'sensor']
PdfMetricAggregate = Literal['max', 'min', 'avg', 'last']


class PdfMetric(BaseModel):
    """Métrica configurable que aparece en la tabla de paradas del PDF de parte de servicio.

    ``source='stop'`` (default): una de las columnas fijas de work_order_stop (STOP_METRIC_KEYS).
    ``source='sensor'``: una señal del sensor_schema; ``key`` es la key del sensor y ``aggregate``
    el agregado a calcular al vuelo sobre la ventana de la parada.
    """
    key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=60)
    unit: str = Field(min_length=1, max_length=10)
    format: PdfMetricFormat
    source: PdfMetricSource = 'stop'
    aggregate: PdfMetricAggregate | None = None


class DoutSlot(BaseModel):
    slot: int        # DOUT number (1–4 on FMC650)
    label: str       # Human-readable action name, e.g. "Parar motor"
    enabled: bool = True


class HistoricMetricItem(BaseModel):
    key: str          # e.g. "engine_on_minutes", "pto_active_minutes", "distance_km"
    label: str        # e.g. "Horas motor"
    color: str        # e.g. "#22C55E"
    unit: str = ""    # e.g. "h", "km", "km/h"
    transform: float = 1.0  # multiply raw value by this (e.g. 1/60 to convert minutes→hours)
    avl_id: int | None = None
    chart_type: Literal['line', 'donut', 'bar'] = 'line'
    show_in_pdf: bool = True
    group: str | None = None  # métricas con el mismo grupo se muestran en un solo gráfico multi-serie


ReportMetricItem = HistoricMetricItem


class VehicleTypeReportMetricsUpdate(BaseModel):
    report_metrics: list[HistoricMetricItem]


class SystemBlock(BaseModel):
    """Bloque del panel de diagnóstico de un tipo de vehículo."""
    id: str = Field(min_length=1, max_length=100)        # slug, e.g. "block_motor"
    name: str = Field(min_length=1, max_length=100)      # editable por admin, e.g. "Motor"
    icon: str = Field(min_length=1, max_length=60)       # clave Tabler/Lucide, e.g. "ti-engine"
    sensor_keys: list[str] = []                          # sensores asignados al bloque
    key_sensor_keys: list[str] = []                      # subset que aparece en el resumen
    key_count: int = 2                                   # cuántos valores clave mostrar


class VehicleTypeSystemBlocksUpdate(BaseModel):
    system_blocks: list[SystemBlock]


class SensorCatalogItem(BaseModel):
    """Entrada mínima del catálogo global de sensores para el editor de bloques."""
    key: str
    label: str
    unit: str | None = None


class SystemBlockTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    slug: str
    name: str
    description: str | None = None
    blocks: list[SystemBlock] = []
    is_builtin: bool
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class SystemBlockTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    blocks: list[SystemBlock] = []


class SystemBlockTemplateUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    blocks: list[SystemBlock]


class SaveAsTemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class VehicleTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    slug: str
    name: str
    sensor_schema: list[dict[str, Any]]
    icon_url: str | None = None
    maintenance_templates: list[MaintenanceTemplateItem] = []
    maintenance_counters: list[MaintenanceCounter] = []
    historic_metrics: list[HistoricMetricItem] = []
    dout_config: list[DoutSlot] = []
    pdf_metrics: list[PdfMetric] = []
    system_blocks: list[SystemBlock] = []
    manual_can_slots: list[dict[str, Any]] = []
    manual_can_buttons: list[dict[str, Any]] = []
    # Fabricantes con acceso a esta plantilla. Solo se rellena para CMG admin
    # (gestión desde la página de Plantillas); vacío para el resto.
    manufacturer_ids: list[uuid.UUID] = []


class VehicleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    manufacturer_tenant_id: uuid.UUID | None = None
    vehicle_type_id: uuid.UUID
    name: str
    license_plate: str | None = None
    vin: str | None = None
    driver_name: str | None = None
    year: int | None = None
    active: bool
    hide_location_from_upstream: bool = False
    status: str | None = None
    last_seen: str | None = None
    lat: float | None = None
    lng: float | None = None
    speed: float | None = None
    type_slug: str | None = None
    created_at: datetime


class VehicleCreate(BaseModel):
    vehicle_type_id: uuid.UUID
    name: str
    license_plate: str | None = None
    vin: str | None = None
    year: int | None = None
    tenant_id: uuid.UUID | None = None


class VehicleUpdate(BaseModel):
    name: str | None = None
    license_plate: str | None = None
    vin: str | None = None
    driver_name: str | None = None
    year: int | None = None
    vehicle_type_id: uuid.UUID | None = None


class VehicleReassignBody(BaseModel):
    target_tenant_id: uuid.UUID


class VehicleReassignOut(BaseModel):
    vehicle_id: uuid.UUID
    from_tenant_id: uuid.UUID
    to_tenant_id: uuid.UUID
    reassigned_at: datetime
    alert_rules_deactivated: int
    grants_revoked: int
    device_moved: bool = False
    device_imei: str | None = None


class VehicleStatus(BaseModel):
    vehicle_id: uuid.UUID
    online: bool
    last_seen: datetime | None = None
    device_last_seen: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    speed_kmh: float | None = None
    heading: int | None = None
    ignition: bool | None = None
    pto_active: bool | None = None
    ext_voltage_mv: int | None = None
    can_data: dict[str, Any] | None = None
    dout_state: dict[int, bool] = {}
    status: str | None = None
    lng: float | None = None
    device_out_of_service: bool = False


class TelemetryPoint(BaseModel):
    time: datetime
    lat: float | None = None
    lon: float | None = None
    speed_kmh: float | None = None
    heading: int | None = None
    altitude_m: float | None = None
    ignition: bool | None = None
    pto_active: bool | None = None
    ext_voltage_mv: int | None = None
    can_data: dict[str, Any] | None = None


class TrackPoint(BaseModel):
    time: datetime
    lat: float | None = None
    lon: float | None = None


class TripPoint(BaseModel):
    t: datetime
    lat: float
    lon: float


class Trip(BaseModel):
    index: int
    start: datetime
    end: datetime
    duration_s: int
    distance_km: float
    moving_time_s: int
    avg_speed_kmh: float
    max_speed_kmh: float
    points: list[TripPoint]


class DayTripTotals(BaseModel):
    trips: int
    distance_km: float
    route_time_s: int
    avg_speed_kmh: float


class DayTrips(BaseModel):
    date: str
    trips: list[Trip]
    totals: DayTripTotals


class KpiHour(BaseModel):
    bucket: datetime
    avg_pressure_1: float | None = None
    max_pressure_1: float | None = None
    avg_oil_temp: float | None = None
    max_oil_temp: float | None = None
    pto_active_minutes: int | None = None
    engine_on_minutes: int | None = None
    record_count: int | None = None


class SensorLinearRange(BaseModel):
    """Transformación lineal de 2 puntos: entrada (crudo) → salida (físico)."""
    type: Literal['linear_range']
    in_min: float
    in_max: float
    out_min: float
    out_max: float


class VehicleTypeSensorSchemaUpdate(BaseModel):
    sensor_schema: list[dict[str, Any]]

    @field_validator('sensor_schema')
    @classmethod
    def _validate_transforms(cls, sensors: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Valida `transform`, `is_report` y `report_aggregate` si vienen (tolerante
        con el resto: las entradas sin estos campos son válidas, retrocompatible)."""
        for sensor in sensors:
            transform = sensor.get('transform')
            if transform is not None:
                if not isinstance(transform, dict):
                    raise ValueError("transform debe ser un objeto")
                if transform.get('type') == 'linear_range':
                    SensorLinearRange.model_validate(transform)
                elif transform.get('type') == 'minutes_to_hours':
                    pass  # sin parámetros adicionales
                else:
                    raise ValueError(f"transform.type no soportado: {transform.get('type')!r}")

            is_report = sensor.get('is_report')
            if is_report is not None and not isinstance(is_report, bool):
                raise ValueError("is_report debe ser booleano")
            agg = sensor.get('report_aggregate')
            if agg is not None and agg not in ('max', 'min', 'avg', 'last'):
                raise ValueError(f"report_aggregate no soportado: {agg!r}")
        return sensors


class VehicleTypeCreate(BaseModel):
    name: str
    slug: str


class VehicleTypeUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    pdf_metrics: list[PdfMetric] | None = None
    # Si viene, reemplaza el set de fabricantes con acceso a esta plantilla.
    manufacturer_ids: list[uuid.UUID] | None = None


class ManualCanCommandRequest(BaseModel):
    slot: int = Field(..., ge=0, le=9, description="Manual CAN slot 0-9")
    state: bool = Field(..., description="True=ON (01...), False=OFF (00...)")


class ManualCanCommandResponse(BaseModel):
    ok: bool
    command_log_id: uuid.UUID
    imei: str
    command_sent: str
    fmc_response: str | None
    latency_ms: int | None
    status: str


class FmcStatusResponse(BaseModel):
    connected: bool
    imei: str
    last_seen: datetime | None
