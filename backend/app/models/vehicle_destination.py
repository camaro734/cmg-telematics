import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Float, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VehicleDestination(Base):
    """Destino activo asignado a un vehículo (Fase 1: marcado desde la web)."""

    __tablename__ = "vehicle_destination"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")  # active|arrived|cancelled
    assigned_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
