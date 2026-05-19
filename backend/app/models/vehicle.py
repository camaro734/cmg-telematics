import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base

class Vehicle(Base):
    __tablename__ = "vehicle"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    manufacturer_tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="RESTRICT"), nullable=True)
    vehicle_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle_type.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    license_plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vin: Mapped[str | None] = mapped_column(String(17), unique=True, nullable=True)
    driver_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant", back_populates="vehicles", foreign_keys=[tenant_id])
    manufacturer: Mapped[Optional["Tenant"]] = relationship("Tenant", foreign_keys=[manufacturer_tenant_id])
    vehicle_type = relationship("VehicleType", back_populates="vehicles")
    device = relationship("Device", back_populates="vehicle", uselist=False)
    driver_assignments = relationship("VehicleDriverAssignment", back_populates="vehicle", order_by="VehicleDriverAssignment.assigned_at.desc()")
