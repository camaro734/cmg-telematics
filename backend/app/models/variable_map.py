import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Float, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class VariableMap(Base):
    __tablename__ = "variable_map"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Scope: exactly one of vehicle_id OR tenant_id must be set.
    # - tenant_id set  → manufacturer-level template (inherited by all their vehicles)
    # - vehicle_id set → vehicle-specific override (takes precedence over template)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=True
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenant.id", ondelete="CASCADE"), nullable=True
    )
    io_key: Mapped[str] = mapped_column(String(20), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scale_factor: Mapped[float] = mapped_column(Float, default=1.0)
    offset: Mapped[float] = mapped_column(Float, default=0.0)
    alert_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    alert_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_type: Mapped[str] = mapped_column(
        SAEnum("gauge", "counter", "boolean", "hours", name="variable_data_type"),
        default="gauge",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    vehicle = relationship("Vehicle")
    tenant = relationship("Tenant")
