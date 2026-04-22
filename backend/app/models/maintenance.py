import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean, Integer, Numeric, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class MaintenancePlan(Base):
    __tablename__ = "maintenance_plan"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    trigger_condition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    next_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    warn_before_pct: Mapped[int] = mapped_column(Integer, default=10)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

class MaintenanceLog(Base):
    __tablename__ = "maintenance_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("maintenance_plan.id", ondelete="SET NULL"),
        nullable=True,
    )
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    performed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    reset_counters: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
    cost_eur: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    photo_urls: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
    document_url: Mapped[str | None] = mapped_column(Text, nullable=True)
