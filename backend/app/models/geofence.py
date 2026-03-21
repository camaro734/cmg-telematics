import uuid
from datetime import datetime
from sqlalchemy import String, Float, Boolean, ForeignKey, TIMESTAMP, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Geofence(Base):
    """A geographic zone that triggers alerts when vehicles enter or exit."""
    __tablename__ = "geofence"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Shape type: "circle" or "polygon"
    shape_type: Mapped[str] = mapped_column(String(20), nullable=False, default="circle")

    # For circle: center + radius
    center_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    center_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    radius_m: Mapped[float | None] = mapped_column(Float, nullable=True)  # radius in meters

    # For polygon: list of {lat, lng} points as JSON
    polygon_points: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Alert configuration
    alert_on_enter: Mapped[bool] = mapped_column(Boolean, default=True)
    alert_on_exit: Mapped[bool] = mapped_column(Boolean, default=True)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.utcnow())
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True)


class GeofenceEvent(Base):
    """Records when a vehicle enters or exits a geofence."""
    __tablename__ = "geofence_event"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    geofence_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("geofence.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, index=True)

    event_type: Mapped[str] = mapped_column(String(10), nullable=False)  # "enter" | "exit"
    occurred_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, index=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)

    # Geofence name snapshot
    geofence_name: Mapped[str] = mapped_column(String(200), nullable=False)
    vehicle_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
