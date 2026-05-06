# backend/app/schemas/alert.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class AlertInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    rule_id: uuid.UUID
    vehicle_id: uuid.UUID
    tenant_id: uuid.UUID
    triggered_at: datetime
    resolved_at: datetime | None = None
    status: str
    trigger_value: dict[str, Any] | None = None
    ack_by_user_id: uuid.UUID | None = None
    ack_at: datetime | None = None
    ack_note: str | None = None


class AlertInstanceEnrichedOut(BaseModel):
    """AlertInstanceOut con rule_name, vehicle_name y severity del JOIN."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    rule_id: uuid.UUID
    vehicle_id: uuid.UUID
    tenant_id: uuid.UUID
    triggered_at: datetime
    resolved_at: datetime | None = None
    status: str
    trigger_value: dict[str, Any] | None = None
    ack_by_user_id: uuid.UUID | None = None
    ack_at: datetime | None = None
    ack_note: str | None = None
    rule_name: str
    vehicle_name: str
    severity: str


class AckRequest(BaseModel):
    note: str | None = None
