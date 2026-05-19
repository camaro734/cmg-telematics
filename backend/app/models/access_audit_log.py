"""Access audit log model — RGPD compliance.

Records every cross-tenant access from CMG admins or Manufacturers
to vehicles/data belonging to Client tenants.

This model is WRITE-ONLY for the access_v2 helper. Reads happen via
dedicated audit endpoints (Phase 4+).
"""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, Text, TIMESTAMP, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class AccessAuditLog(Base):
    __tablename__ = "access_audit_log"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=func.gen_random_uuid(),
    )
    time: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        primary_key=True,
        server_default=func.now(),
        nullable=False,
    )

    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_tenant_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_tenant_tier: Mapped[str] = mapped_column(String(20), nullable=False)

    target_vehicle_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    target_tenant_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    operation: Mapped[str] = mapped_column(String(20), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)

    justification: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    endpoint: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_access_audit_target_tenant_time", "target_tenant_id", "time"),
        Index("ix_access_audit_user_time", "user_id", "time"),
    )
