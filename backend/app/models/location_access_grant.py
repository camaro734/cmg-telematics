import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LocationAccessGrant(Base):
    """Una fila = el tenant granting_tenant_id concede a su parent_id ver vehicle_id.

    La cadena de permisos se verifica contando grants consecutivos desde el dueño
    hasta el usuario. Si falta cualquier eslabón, los niveles superiores no ven.
    """

    __tablename__ = "location_access_grant"

    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vehicle.id", ondelete="CASCADE"),
        primary_key=True,
    )
    granting_tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant.id", ondelete="CASCADE"),
        primary_key=True,
    )
    granted_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default="now()",
    )

    vehicle: Mapped["Vehicle"] = relationship("Vehicle", back_populates="location_grants")  # type: ignore[name-defined]
    granting_tenant: Mapped["Tenant"] = relationship("Tenant")  # type: ignore[name-defined]
