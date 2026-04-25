# backend/app/schemas/vehicle.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict
from app.schemas.maintenance import MaintenanceTemplateItem


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


ReportMetricItem = HistoricMetricItem


class VehicleTypeReportMetricsUpdate(BaseModel):
    report_metrics: list[HistoricMetricItem]


class VehicleTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    slug: str
    name: str
    sensor_schema: list[dict[str, Any]]
    icon_url: str | None = None
    maintenance_templates: list[MaintenanceTemplateItem] = []
    historic_metrics: list[HistoricMetricItem] = []
    dout_config: list[DoutSlot] = []


class VehicleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    vehicle_type_id: uuid.UUID
    name: str
    license_plate: str | None = None
    vin: str | None = None
    driver_name: str | None = None
    year: int | None = None
    active: bool
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


class VehicleStatus(BaseModel):
    vehicle_id: uuid.UUID
    online: bool
    last_seen: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    speed_kmh: float | None = None
    ignition: bool | None = None
    pto_active: bool | None = None
    ext_voltage_mv: int | None = None
    can_data: dict[str, Any] | None = None
    dout_state: dict[int, bool] = {}


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


class KpiHour(BaseModel):
    bucket: datetime
    avg_pressure_1: float | None = None
    max_pressure_1: float | None = None
    avg_oil_temp: float | None = None
    max_oil_temp: float | None = None
    pto_active_minutes: int | None = None
    engine_on_minutes: int | None = None
    record_count: int | None = None


class VehicleTypeSensorSchemaUpdate(BaseModel):
    sensor_schema: list[dict[str, Any]]


class VehicleTypeCreate(BaseModel):
    name: str
    slug: str


class VehicleTypeUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
