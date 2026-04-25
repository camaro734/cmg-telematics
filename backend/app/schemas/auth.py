# backend/app/schemas/auth.py
import uuid
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    logo_url: str | None = None
    brand_name: str | None = None
    enabled_modules: list[str] = []


class RefreshRequest(BaseModel):
    refresh_token: str


class CurrentUser(BaseModel):
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_tier: str
    role: str
    email: str
