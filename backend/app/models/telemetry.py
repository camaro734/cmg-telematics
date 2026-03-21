import uuid
from datetime import datetime
from sqlalchemy import (
    String, ForeignKey, DateTime, Boolean, Integer,
    Float, Index, SmallInteger
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class TelemetryRecord(Base):
    """
    TimescaleDB hypertable — partitioned by 'time' (chunks of 1 day).
    Primary key includes 'time' as required by TimescaleDB.
    """
    __tablename__ = "telemetry_record"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, primary_key=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device.id", ondelete="CASCADE"), nullable=False
    )

    # GPS
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    speed: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    angle: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    satellites: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    priority: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    # Ignition and power
    ignition: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ext_voltage_mv: Mapped[int | None] = mapped_column(Integer, nullable=True)
    battery_mv: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Digital outputs
    dout1: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    dout2: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    dout3: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    dout4: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Digital inputs
    din1: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    din2: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    din3: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    din4: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # All raw IO data (flexible JSONB)
    io_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        Index("ix_telemetry_device_time", "device_id", "time"),
    )

    device = relationship("Device", back_populates="telemetry_records")
