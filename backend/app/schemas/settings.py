# backend/app/schemas/settings.py
from __future__ import annotations
import uuid
from pydantic import BaseModel, ConfigDict, Field, field_validator


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    # El modelo Tenant usa `id`; exponemos como `tenant_id` al cliente
    tenant_id: uuid.UUID = Field(validation_alias="id")
    notification_email: str | None


class SettingsPatch(BaseModel):
    notification_email: str | None = None

    @field_validator("notification_email")
    @classmethod
    def validate_email(cls, v: str | None) -> str | None:
        if v is not None and (not v or "@" not in v):
            raise ValueError("Email inválido")
        return v
