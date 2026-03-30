import uuid
from datetime import datetime
from sqlalchemy import String, Float, Boolean, ForeignKey, TIMESTAMP, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AutomationRule(Base):
    """
    Per-client automation rule: when a telemetry trigger fires, execute one or more actions.

    Trigger: a threshold condition on any IO key (same syntax as AlertRule).
    Actions: JSONB array of {type, params} objects. Supported types:
      - "track_position": record lat/lng into AutomationPositionLog while trigger is active
        params: {"label": str, "color": str (hex)}
      (more types can be added in _check_automations without schema changes)

    Scope: tenant_id required (manufacturer or end-client).
           vehicle_id optional — null means all vehicles of that tenant.

    Access: only superadmin can create/edit/delete. Read is superadmin-only too.
    """
    __tablename__ = "automation_rule"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Trigger — same semantics as AlertRule
    io_key: Mapped[str] = mapped_column(String(50), nullable=False)
    condition: Mapped[str] = mapped_column(String(10), nullable=False, default="eq")
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    scale_factor: Mapped[float] = mapped_column(Float, default=1.0)
    offset: Mapped[float] = mapped_column(Float, default=0.0)

    # Actions array — e.g. [{"type": "track_position", "params": {"label": "Bomba activa"}}]
    actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.utcnow()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class AutomationSession(Base):
    """
    Open/closed period when an AutomationRule trigger is active on a device.
    Created when the trigger fires, closed when the condition clears.
    """
    __tablename__ = "automation_session"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automation_rule.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    color: Mapped[str | None] = mapped_column(String(10), nullable=True)


class AutomationPositionLog(Base):
    """
    Position recorded during an active AutomationSession (for track_position action).
    One row per telemetry record while the trigger is active.
    """
    __tablename__ = "automation_position_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automation_session.id", ondelete="CASCADE"), nullable=False, index=True
    )
    time: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, index=True
    )
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    speed: Mapped[int | None] = mapped_column(nullable=True)
