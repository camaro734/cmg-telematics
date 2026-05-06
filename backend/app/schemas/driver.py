from __future__ import annotations
import uuid
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict


class DriverOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    full_name: str
    phone: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    notes: str | None = None
    active: bool
    created_at: datetime
    # Populated at query time (current assigned vehicle name, if any)
    current_vehicle_name: str | None = None


class DriverCreate(BaseModel):
    full_name: str
    phone: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    notes: str | None = None


class DriverUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    notes: str | None = None
    active: bool | None = None


class AssignDriverRequest(BaseModel):
    driver_id: uuid.UUID | None = None  # None = desasignar


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vehicle_id: uuid.UUID
    driver_id: uuid.UUID
    assigned_at: datetime
    ended_at: datetime | None = None
