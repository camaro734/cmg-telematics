import uuid
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base

class VehicleType(Base):
    __tablename__ = "vehicle_type"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sensor_schema: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    vehicles = relationship("Vehicle", back_populates="vehicle_type")
