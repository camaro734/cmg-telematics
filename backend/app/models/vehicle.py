import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Vehicle(Base):
    __tablename__ = "vehicle"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id", ondelete="CASCADE"))
    manufacturer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenant.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    license_plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vin: Mapped[str | None] = mapped_column(String(17), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    tenant = relationship("Tenant", foreign_keys="Vehicle.tenant_id", back_populates="vehicles")
    manufacturer = relationship("Tenant", foreign_keys="Vehicle.manufacturer_id")
    device = relationship("Device", back_populates="vehicle", uselist=False)
