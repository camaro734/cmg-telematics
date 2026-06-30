import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, ForeignKey, DateTime, Boolean, CheckConstraint, Text, ARRAY, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base

class Tenant(Base):
    __tablename__ = "tenant"
    __table_args__ = (
        CheckConstraint("tier IN ('cmg','manufacturer','client','subclient')", name="ck_tenant_tier"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="SET NULL"), nullable=True)
    parent_manufacturer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="RESTRICT"), nullable=True)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    brand_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    custom_domain: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    brand_tokens: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notification_email: Mapped[str | None] = mapped_column(Text(), nullable=True)
    enabled_modules: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    portal_access_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    business_cif: Mapped[str | None] = mapped_column(String(20), nullable=True)
    business_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Datos de contacto del emisor para el membrete del reporte (cabecera tipo factura).
    business_legal_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    business_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    business_email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    business_website: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Base de la empresa: dirección + coordenadas de salida/llegada por defecto
    # para la optimización de rutas. Una base por tenant; nullable hasta que el
    # admin del cliente la configure desde Ajustes → Mi base.
    base_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    base_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    base_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    manufacturer_can_view_operations: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    manufacturer_can_view_can_data: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    manufacturer_can_create_rules: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    # Autogestión del fabricante (solo CMG las activa). Por defecto false.
    manufacturer_can_manage_clients: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    manufacturer_can_transfer_vehicles: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    # Permite a este cliente (bajo un fabricante) accionar controles (DOUT/Manual CAN).
    # Por defecto false: los clientes de un fabricante solo ven telemetría hasta que CMG
    # les concede el control. No afecta a cmg/manufacturer ni a clientes directos de CMG.
    can_actuate_controls: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    compliance_level: Mapped[str] = mapped_column(String(20), server_default="standard", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    parent = relationship("Tenant", remote_side=[id], backref="children", foreign_keys=[parent_id])
    parent_manufacturer: Mapped[Optional["Tenant"]] = relationship(
        "Tenant",
        remote_side="Tenant.id",
        foreign_keys=[parent_manufacturer_id],
    )
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    vehicles = relationship("Vehicle", back_populates="tenant", cascade="all, delete-orphan", foreign_keys="[Vehicle.tenant_id]")
    devices = relationship("Device", back_populates="tenant")
