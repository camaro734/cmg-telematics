from __future__ import annotations
import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID | None
    vehicle_id: uuid.UUID | None
    imei: str
    model: str
    firmware_ver: str | None
    online: bool
    last_seen: datetime | None
    active: bool
    created_at: datetime


class DeviceCreate(BaseModel):
    imei: str
    model: str = "FMC650"
    firmware_ver: str | None = None
    tenant_id: uuid.UUID

    @field_validator("imei")
    @classmethod
    def validate_imei(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or not (14 <= len(v) <= 15):
            raise ValueError("IMEI debe ser numérico de 14-15 dígitos")
        return v


class DeviceUpdate(BaseModel):
    firmware_ver: str | None = None
    tenant_id: uuid.UUID | None = None
    active: bool | None = None
    model: str | None = None


class DeviceAssignVehicle(BaseModel):
    vehicle_id: uuid.UUID | None
