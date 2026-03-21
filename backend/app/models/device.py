import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Device(Base):
    __tablename__ = "device"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle.id", ondelete="SET NULL"), nullable=True
    )
    imei: Mapped[str] = mapped_column(String(15), unique=True, nullable=False)
    model: Mapped[str] = mapped_column(String(50), default="FMC650")
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    vehicle = relationship("Vehicle", back_populates="device")
    telemetry_records = relationship("TelemetryRecord", back_populates="device")
    command_logs = relationship("CommandLog", back_populates="device")
