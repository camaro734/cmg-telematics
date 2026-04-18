import uuid
from datetime import datetime
from sqlalchemy import Float, Boolean, Integer, SmallInteger, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class TelemetryRecord(Base):
    __tablename__ = "telemetry_record"

    time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), primary_key=True, nullable=False)
    device_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, nullable=False)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    lat: Mapped[float | None] = mapped_column(Float(precision=10), nullable=True)
    lon: Mapped[float | None] = mapped_column(Float(precision=10), nullable=True)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    ignition: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    pto_active: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ext_voltage_mv: Mapped[int | None] = mapped_column(Integer, nullable=True)
    can_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
