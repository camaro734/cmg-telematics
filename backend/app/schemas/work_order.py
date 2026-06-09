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
    final_client_name: str | None = None
    final_client_address: str | None = None
    doc_number: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    auto_close_config: dict | None = None
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
    final_client_name: str | None = None
    final_client_address: str | None = None
    auto_close_config: dict | None = None


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
    final_client_name: str | None = None
    final_client_address: str | None = None
    auto_close_config: dict | None = None


class WorkOrderStatusPatch(BaseModel):
    status: WorkOrderStatus


# ── Work Order Stop ────────────────────────────────────────────────────────────

WorkOrderStopStatus = Literal['pending', 'arrived', 'in_progress', 'done', 'skipped']


class WorkOrderStopOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    work_order_id: uuid.UUID
    order_index: int
    title: str
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    arrival_radius_m: int = 150
    notes: str | None = None
    client_name: str | None = None
    status: WorkOrderStopStatus
    arrived_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    pto_minutes: float | None = None
    fuel_l: float | None = None
    rpm_avg: float | None = None
    pump_minutes: float | None = None
    pressure_min: float | None = None
    pressure_max: float | None = None
    created_at: datetime


class WorkOrderStopCreate(BaseModel):
    order_index: int = 0
    title: str
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    arrival_radius_m: int = 150
    notes: str | None = None
    client_name: str | None = None


class WorkOrderStopUpdate(BaseModel):
    order_index: int | None = None
    title: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    arrival_radius_m: int | None = None
    notes: str | None = None
    client_name: str | None = None
    status: WorkOrderStopStatus | None = None


class WorkOrderStopStatusPatch(BaseModel):
    status: WorkOrderStopStatus
