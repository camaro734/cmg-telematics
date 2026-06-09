import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class WorkOrder(Base):
    __tablename__ = "work_order"
    __table_args__ = (
        CheckConstraint("status IN ('pending','in_progress','done','cancelled')", name="ck_work_order_status"),
        CheckConstraint("priority IN ('low','normal','high','urgent')", name="ck_work_order_priority"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="SET NULL"), nullable=True)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("driver.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="normal", nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    location_lat: Mapped[float | None] = mapped_column(nullable=True)
    location_lon: Mapped[float | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    final_client_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    doc_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Configuración para cierre automático de paradas por geocerca + señal.
    # NULL = desactivado. Contrato esperado cuando enabled=true:
    # {
    #   "enabled": bool,
    #   "service_signal_key": str,    # clave sensor_schema o campo directo ("pto_active", "avl_150")
    #   "signal_op": "==" | ">" | ">=" | "<" | "<=",
    #   "signal_value": bool | number,
    #   "min_active_seconds": int,    # sostenido mínimo → EN_CURSO
    #   "min_inactive_seconds": int,  # sostenido apagado → COMPLETADO
    #   "exit_margin_m": int          # histéresis radio de salida (arrival_radius_m + exit_margin_m)
    # }
    auto_close_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)

    vehicle = relationship("Vehicle", foreign_keys=[vehicle_id])
    driver = relationship("Driver", foreign_keys=[driver_id])
    creator = relationship("User", foreign_keys=[created_by])
    stops = relationship(
        "WorkOrderStop", back_populates="work_order",
        order_by="WorkOrderStop.order_index", cascade="all, delete-orphan",
    )
