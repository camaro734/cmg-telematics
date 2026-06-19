import uuid
from sqlalchemy import ForeignKey, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class VehicleTypeManufacturer(Base):
    """Asignación de plantillas (tipos de vehículo) a fabricantes.

    Lista blanca: un fabricante solo ve en el desplegable de creación de
    vehículos las plantillas que CMG le asigne aquí. Sus subclientes heredan
    el alcance vía tenant.parent_manufacturer_id.
    """
    __tablename__ = "vehicle_type_manufacturer"

    vehicle_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle_type.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        PrimaryKeyConstraint("vehicle_type_id", "tenant_id", name="pk_vehicle_type_manufacturer"),
    )
