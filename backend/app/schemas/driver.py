from __future__ import annotations
import uuid
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class DriverOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    full_name: str
    phone: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    notes: str | None = None
    active: bool
    created_at: datetime
    # Login vinculado (driver.user_id), si el chofer tiene cuenta para la app móvil
    user_id: uuid.UUID | None = None
    # Populated at query time (current assigned vehicle name, if any)
    current_vehicle_name: str | None = None


class _DriverLoginMixin(BaseModel):
    """Alta opcional del login del chofer (rol `driver`).

    - `email` + `password`: crea un usuario nuevo y lo vincula.
    - `user_id`: vincula un usuario existente (debe ser del mismo tenant).
    Ambas vías son mutuamente excluyentes; ninguna = chofer sin login.
    """
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8)
    user_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check_login_fields(self):
        if self.user_id is not None and (self.email or self.password):
            raise ValueError("Usa email+password (login nuevo) o user_id (vincular), no ambos")
        if bool(self.email) != bool(self.password):
            raise ValueError("Para crear el login del chofer indica email y password")
        return self


class DriverCreate(_DriverLoginMixin):
    full_name: str
    phone: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    notes: str | None = None


class DriverUpdate(_DriverLoginMixin):
    full_name: str | None = None
    phone: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    notes: str | None = None
    active: bool | None = None


class AssignDriverRequest(BaseModel):
    driver_id: uuid.UUID | None = None  # None = desasignar


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vehicle_id: uuid.UUID
    driver_id: uuid.UUID
    assigned_at: datetime
    ended_at: datetime | None = None
