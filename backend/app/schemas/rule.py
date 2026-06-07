# backend/app/schemas/rule.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, model_validator

_FIELD_REQUIRED_TYPES = {"threshold", "threshold_sustained", "accumulation", "trend_rising", "schedule"}


def _check_condition_field(condition: dict) -> None:
    if condition.get("type") in _FIELD_REQUIRED_TYPES and not condition.get("field"):
        raise ValueError("La condición requiere una variable — 'field' está vacío")


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None = None
    active: bool
    vehicle_filter: dict[str, Any]
    condition: dict[str, Any]
    severity: str
    actions: list[Any]
    escalation: list[Any]
    schedule: dict[str, Any]
    cooldown_minutes: int
    created_at: datetime
    archived_at: datetime | None = None
    alert_count: int | None = None


class RuleCreate(BaseModel):
    name: str
    description: str | None = None
    vehicle_filter: dict[str, Any] = {"scope": "all"}
    condition: dict[str, Any]
    severity: str = "warning"
    actions: list[Any] = []
    escalation: list[Any] = []
    schedule: dict[str, Any] = {"type": "always"}
    cooldown_minutes: int = 30

    @model_validator(mode='after')
    def check_condition_field(self) -> 'RuleCreate':
        _check_condition_field(self.condition)
        return self


class RuleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    active: bool | None = None
    vehicle_filter: dict[str, Any] | None = None
    condition: dict[str, Any] | None = None
    severity: str | None = None
    actions: list[Any] | None = None
    escalation: list[Any] | None = None
    schedule: dict[str, Any] | None = None
    cooldown_minutes: int | None = None

    @model_validator(mode='after')
    def check_condition_field(self) -> 'RuleUpdate':
        if self.condition is not None:
            _check_condition_field(self.condition)
        return self


class RuleTestRequest(BaseModel):
    field_values: dict[str, Any]


class RuleTestResult(BaseModel):
    would_fire: bool
    trigger_value: float | None = None
    reason: str | None = None
