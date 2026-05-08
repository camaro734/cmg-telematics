import uuid
from datetime import datetime
from pydantic import BaseModel, Field, model_validator


class MaterialItem(BaseModel):
    name: str
    quantity: float
    unit: str = ''


class WorkReportCreate(BaseModel):
    description: str | None = None
    work_duration_minutes: int | None = None
    materials_used: list[MaterialItem] = []
    signature_data: str | None = None  # base64 data URL del canvas (firma del cliente)
    client_signee_name: str | None = Field(default=None, max_length=200)
    client_signee_dni: str | None = Field(default=None, max_length=20)
    unsigned_reason: str | None = Field(default=None, max_length=200)

    @model_validator(mode='after')
    def _check_xor_signed_or_unsigned(self):
        # No se puede mezclar firma y motivo de no firma en el mismo payload.
        # La regla "uno obligatorio" se valida al transicionar la orden a 'done'
        # (ver work_orders.py); aquí solo bloqueamos el conflicto explícito.
        signed = bool(
            (self.signature_data and self.signature_data.strip())
            or (self.client_signee_name and self.client_signee_name.strip())
            or (self.client_signee_dni and self.client_signee_dni.strip())
        )
        unsigned = bool(self.unsigned_reason and self.unsigned_reason.strip())
        if signed and unsigned:
            raise ValueError(
                "No se puede indicar firma y motivo de no firma a la vez. Elige uno."
            )
        return self


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
    client_signee_name: str | None = None
    client_signee_dni: str | None = None
    unsigned_reason: str | None = None
    materials_used: list[MaterialItem] = []
    created_at: datetime

    model_config = {'from_attributes': True}
