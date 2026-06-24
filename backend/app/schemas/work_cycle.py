from __future__ import annotations
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any
from pydantic import BaseModel, ConfigDict, field_validator

_VALID_TRIGGER_TYPES = {"pto_change", "threshold_exceeded", "sensor_pulse", "ignition_period"}


class WorkCycleDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vehicle_type_id: uuid.UUID
    tenant_id: uuid.UUID | None
    name: str
    trigger_type: str
    trigger_config: dict[str, Any]
    snapshot_fields: list[str]
    aggregate_fields: list[str]
    active: bool
    created_at: datetime
    # Regla de intervención (migración 062). end_trigger_type None = fin implícito.
    end_trigger_type: str | None = None
    end_trigger_config: dict[str, Any] = {}
    merge_window_seconds: int = 300
    safety_radius_m: int = 150


class WorkCycleDefinitionCreate(BaseModel):
    vehicle_type_id: uuid.UUID
    name: str
    trigger_type: str
    trigger_config: dict[str, Any] = {}
    snapshot_fields: list[str] = []
    aggregate_fields: list[str] = []
    # Regla de intervención (aditivo, retrocompatible): defaults seguros.
    end_trigger_type: str | None = None
    end_trigger_config: dict[str, Any] = {}
    merge_window_seconds: int = 300
    safety_radius_m: int = 150

    @field_validator("trigger_type")
    @classmethod
    def validate_trigger_type(cls, v: str) -> str:
        if v not in _VALID_TRIGGER_TYPES:
            raise ValueError(f"trigger_type debe ser uno de: {', '.join(sorted(_VALID_TRIGGER_TYPES))}")
        return v


class WorkCycleDefinitionUpdate(BaseModel):
    name: str | None = None
    trigger_config: dict[str, Any] | None = None
    snapshot_fields: list[str] | None = None
    aggregate_fields: list[str] | None = None
    active: bool | None = None
    # Regla de intervención (migración 062): opcionales, se aplican vía model_dump(exclude_unset).
    end_trigger_type: str | None = None
    end_trigger_config: dict[str, Any] | None = None
    merge_window_seconds: int | None = None
    safety_radius_m: int | None = None


class WorkCycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vehicle_id: uuid.UUID
    definition_id: uuid.UUID
    tenant_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    cycle_data: dict[str, Any]
    lat: Decimal | None
    lon: Decimal | None


class ComputeCyclesRequest(BaseModel):
    vehicle_id: uuid.UUID
    definition_id: uuid.UUID
    from_dt: datetime
    to_dt: datetime
