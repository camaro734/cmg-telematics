import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class MetricPreferences(BaseModel):
    keys: list[str] | None = None


class UserPreferencesIn(BaseModel):
    historic_metrics: dict[str, MetricPreferences] = {}
    # Orden de tarjetas de sensores por tipo de vehículo: {vehicle_type_id: [keys]}.
    # Una lista None borra el orden guardado para ese tipo.
    sensor_order: dict[str, list[str] | None] = {}


class UserPreferencesOut(BaseModel):
    historic_metrics: dict[str, MetricPreferences] = {}
    sensor_order: dict[str, list[str]] = {}


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    full_name: str
    role: Literal['admin', 'operator', 'viewer', 'driver']
    active: bool
    created_at: datetime


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: Literal['admin', 'operator', 'viewer', 'driver'] = 'operator'
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: Literal['admin', 'operator', 'viewer', 'driver'] | None = None
    active: bool | None = None
    password: str | None = Field(None, min_length=8)
