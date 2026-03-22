import uuid
from datetime import datetime
from sqlalchemy import String, Float, ForeignKey, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AlertLog(Base):
    __tablename__ = "alert_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("alert_rule.id", ondelete="SET NULL"), nullable=True, index=True
    )
    io_key: Mapped[str] = mapped_column(String(20), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False)  # "high" | "low"
    raw_value: Mapped[float] = mapped_column(Float, nullable=False)
    converted_value: Mapped[float] = mapped_column(Float, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    fired_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
