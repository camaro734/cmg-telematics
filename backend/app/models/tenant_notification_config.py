import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, ForeignKey, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class TenantNotificationConfig(Base):
    """Per-tenant notification settings (SMTP email)."""
    __tablename__ = "tenant_notification_config"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenant.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # one config per tenant
        index=True,
    )

    # SMTP settings
    smtp_host: Mapped[str] = mapped_column(String(200), default="")
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_user: Mapped[str] = mapped_column(String(200), default="")
    smtp_password: Mapped[str] = mapped_column(String(500), default="")  # store encrypted or plaintext for now
    smtp_from: Mapped[str] = mapped_column(String(200), default="")  # e.g. "alertas@miempresa.es"
    smtp_from_name: Mapped[str] = mapped_column(String(200), default="CMG Telematics")
    smtp_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    smtp_ssl: Mapped[bool] = mapped_column(Boolean, default=False)  # port 465 SSL vs 587 STARTTLS

    # Which levels trigger email
    notify_level_high: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_level_medium: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_level_low: Mapped[bool] = mapped_column(Boolean, default=False)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: __import__('datetime').datetime.utcnow(),
        onupdate=lambda: __import__('datetime').datetime.utcnow(),
    )
