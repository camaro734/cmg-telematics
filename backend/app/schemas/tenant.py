# backend/app/schemas/tenant.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    parent_id: uuid.UUID | None = None
    tier: str
    name: str
    slug: str
    active: bool
    brand_name: str | None = None
    brand_color: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    brand_tokens: dict[str, Any] | None = None
    created_at: datetime


class TenantCreate(BaseModel):
    parent_id: uuid.UUID | None = None
    tier: str
    name: str
    slug: str
    brand_name: str | None = None
    brand_color: str | None = None
    logo_url: str | None = None


class BrandTokensUpdate(BaseModel):
    brand_tokens: dict[str, Any]


class GrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    grantor_id: uuid.UUID
    grantee_id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID | None = None
    allowed_actions: list[str]
    constraints: dict[str, Any] | None = None
    granted_at: datetime
    expires_at: datetime | None = None
    active: bool


class GrantCreate(BaseModel):
    grantee_id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID | None = None
    allowed_actions: list[str]
    constraints: dict[str, Any] | None = None
    expires_at: datetime | None = None
