from __future__ import annotations
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict

WorkOrderStatus   = Literal['pending', 'in_progress', 'done', 'cancelled']
WorkOrderPriority = Literal['low', 'normal', 'high', 'urgent']


class WorkOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    description: str | None = None
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    status: WorkOrderStatus
    priority: WorkOrderPriority
    scheduled_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    location_address: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    notes: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    # Populated at query time
    vehicle_name: str | None = None
    driver_name: str | None = None


class WorkOrderCreate(BaseModel):
    title: str
    description: str | None = None
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    priority: WorkOrderPriority = 'normal'
    scheduled_at: datetime | None = None
    location_address: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    notes: str | None = None


class WorkOrderUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    status: WorkOrderStatus | None = None
    priority: WorkOrderPriority | None = None
    scheduled_at: datetime | None = None
    location_address: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    notes: str | None = None


class WorkOrderStatusPatch(BaseModel):
    status: WorkOrderStatus
