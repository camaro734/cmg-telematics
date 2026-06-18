# backend/app/schemas/auth.py
import uuid
from pydantic import BaseModel, EmailStr, Field


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


class LogoutRequest(BaseModel):
    refresh_token: str


class CurrentUser(BaseModel):
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_tier: str
    role: str
    email: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)
