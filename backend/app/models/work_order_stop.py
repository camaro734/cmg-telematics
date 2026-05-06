import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime, Integer, CheckConstraint, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class WorkOrderStop(Base):
    __tablename__ = "work_order_stop"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','arrived','in_progress','done','skipped')",
            name="ck_work_order_stop_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_order.id", ondelete="CASCADE"), nullable=False
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    arrival_radius_m: Mapped[int] = mapped_column(Integer, default=150)  # geofence radius
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Telemetry aggregated during the work interval (PTO on → off)
    pto_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    fuel_l: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpm_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    pump_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)   # min bomba/depresor
    pressure_min: Mapped[float | None] = mapped_column(Float, nullable=True)   # min presión depresor
    pressure_max: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    work_order = relationship("WorkOrder", back_populates="stops")
