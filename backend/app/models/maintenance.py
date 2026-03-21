import uuid
from datetime import datetime, date
from sqlalchemy import String, Float, Boolean, ForeignKey, TIMESTAMP, Date, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MaintenanceTask(Base):
    """Defines a recurring maintenance task for a vehicle."""
    __tablename__ = "maintenance_task"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Trigger type: by odometer km, engine hours, calendar days, or fixed date
    trigger_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "km" | "hours" | "days" | "date"
    interval_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Current due thresholds
    next_due_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    next_due_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    next_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Warning threshold: alert X km/hours/days before due
    warn_before: Mapped[float] = mapped_column(Float, default=50.0)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.utcnow()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class MaintenanceLog(Base):
    """Records a completed maintenance event."""
    __tablename__ = "maintenance_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maintenance_task.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, index=True
    )

    performed_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    performed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Snapshot of vehicle state at time of maintenance
    odometer_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    engine_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.utcnow()
    )
