import uuid
from datetime import datetime
from sqlalchemy import String, Float, Boolean, Integer, ForeignKey, TIMESTAMP, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AlertRule(Base):
    """Configurable alert rule: fires an AlertLog when a telemetry variable crosses a threshold."""
    __tablename__ = "alert_rule"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=True, index=True
    )  # null = applies to all vehicles in tenant

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The FMC650 signal: column name (ignition, din1, ain1_mv...) or numeric IO ID as string ("300")
    io_key: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)  # shown in alert log

    # Condition: "gt" | "lt" | "gte" | "lte" | "eq" | "neq"
    condition: Mapped[str] = mapped_column(String(10), nullable=False, default="gt")
    threshold: Mapped[float] = mapped_column(Float, nullable=False)

    # Optional scaling: raw_value * scale_factor + offset = engineering value for comparison
    scale_factor: Mapped[float] = mapped_column(Float, default=1.0)
    offset: Mapped[float] = mapped_column("offset", Float, default=0.0)
    unit: Mapped[str] = mapped_column(String(20), default="")

    # "high" | "medium" | "low"
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="high")

    # Minimum minutes between repeated fires of the same rule for the same vehicle
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.utcnow()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
