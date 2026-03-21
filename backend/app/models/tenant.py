import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenant"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(
        SAEnum("cmg", "manufacturer", "end_client", name="tenant_type"),
        nullable=False,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenant.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    active: Mapped[bool] = mapped_column(default=True)

    parent = relationship("Tenant", remote_side=[id], backref="children")
    users = relationship("User", back_populates="tenant")
    vehicles = relationship("Vehicle", foreign_keys="Vehicle.tenant_id", back_populates="tenant")
