import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr


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
    password: str


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: Literal['admin', 'operator', 'viewer', 'driver'] | None = None
    active: bool | None = None
