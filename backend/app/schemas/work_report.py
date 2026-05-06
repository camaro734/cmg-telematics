import uuid
from datetime import datetime
from pydantic import BaseModel


class MaterialItem(BaseModel):
    name: str
    quantity: float
    unit: str = ''


class WorkReportCreate(BaseModel):
    description: str | None = None
    work_duration_minutes: int | None = None
    materials_used: list[MaterialItem] = []
    signature_data: str | None = None  # base64 data URL from canvas


class WorkReportOut(BaseModel):
    id: uuid.UUID
    work_order_id: uuid.UUID
    tenant_id: uuid.UUID
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    description: str | None = None
    work_duration_minutes: int | None = None
    photo_urls: list[str] = []
    signature_url: str | None = None
    materials_used: list[MaterialItem] = []
    created_at: datetime

    model_config = {'from_attributes': True}
