from __future__ import annotations
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict


class MaintenanceCounter(BaseModel):
    """Entrada del catálogo de contadores de un vehicle_type."""
    type: str
    label: str
    unit: str
    source_type: Literal['telemetry_1h', 'can_data', 'calendar']
    source_key: str | None = None
    semantics: Literal['sum', 'max_minus_min'] | None = None


class MaintenanceThreshold(BaseModel):
    type: str
    value: float


class TriggerCondition(BaseModel):
    thresholds: list[MaintenanceThreshold]
    op: Literal['OR'] = 'OR'


class MaintenanceTemplateItem(BaseModel):
    name: str
    thresholds: list[MaintenanceThreshold]
    warn_before_pct: int = 10


class ThresholdProgress(BaseModel):
    type: str
    current: float
    limit: float
    pct: float


class MaintenanceProgress(BaseModel):
    status: Literal['ok', 'próximo', 'vencido']
    thresholds: list[ThresholdProgress]


class MaintenancePlanCreate(BaseModel):
    vehicle_id: uuid.UUID
    name: str
    trigger_condition: TriggerCondition
    warn_before_pct: int = 10
    active: bool = True


class MaintenancePlanUpdate(BaseModel):
    name: str | None = None
    trigger_condition: TriggerCondition | None = None
    warn_before_pct: int | None = None
    active: bool | None = None


class MaintenancePlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_name: str
    tenant_id: uuid.UUID
    owner_tenant_id: uuid.UUID
    name: str
    trigger_condition: TriggerCondition
    warn_before_pct: int
    active: bool
    created_at: datetime
    progress: MaintenanceProgress


class MaintenanceLogCreate(BaseModel):
    performed_at: datetime
    description: str | None = None
    reset_counters: list[str]
    cost_eur: float | None = None


class MaintenanceLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    plan_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID
    performed_at: datetime
    performed_by_email: str | None = None
    description: str | None = None
    reset_counters: list[str]
    cost_eur: float | None = None
    document_url: str | None = None
    counter_readings: dict | None = None


class ThresholdProjection(BaseModel):
    type: str
    current: float
    limit: float
    pct: float
    days_remaining: float | None = None


class MaintenanceProjection(BaseModel):
    status: Literal['ok', 'próximo', 'vencido']
    thresholds: list[ThresholdProjection]
