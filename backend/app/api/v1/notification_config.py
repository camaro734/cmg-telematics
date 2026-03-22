"""
Per-tenant email/SMTP notification configuration.
Access: superadmin (all tenants), admin (their own tenant only).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from uuid import UUID

from app.core.database import get_db
from app.models.tenant_notification_config import TenantNotificationConfig
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/notification-config", tags=["notification-config"])

WRITE_ROLES = {"superadmin", "admin"}


class NotificationConfigOut(BaseModel):
    id: UUID
    tenant_id: UUID
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str  # returned masked in GET
    smtp_from: str
    smtp_from_name: str
    smtp_tls: bool
    smtp_ssl: bool
    notify_level_high: bool
    notify_level_medium: bool
    notify_level_low: bool
    active: bool
    model_config = ConfigDict(from_attributes=True)


class NotificationConfigUpsert(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: Optional[str] = None  # None = keep existing
    smtp_from: str = ""
    smtp_from_name: str = "CMG Telematics"
    smtp_tls: bool = True
    smtp_ssl: bool = False
    notify_level_high: bool = True
    notify_level_medium: bool = False
    notify_level_low: bool = False
    active: bool = True


class TestEmailRequest(BaseModel):
    email: str


@router.get("", response_model=NotificationConfigOut)
async def get_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TenantNotificationConfig).where(
            TenantNotificationConfig.tenant_id == current_user.tenant_id
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        # Return empty defaults
        return NotificationConfigOut(
            id=UUID("00000000-0000-0000-0000-000000000000"),
            tenant_id=current_user.tenant_id,
            smtp_host="", smtp_port=587, smtp_user="",
            smtp_password="", smtp_from="", smtp_from_name="CMG Telematics",
            smtp_tls=True, smtp_ssl=False,
            notify_level_high=True, notify_level_medium=False, notify_level_low=False,
            active=False,
        )
    # Mask password in response
    return NotificationConfigOut(
        id=config.id,
        tenant_id=config.tenant_id,
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port,
        smtp_user=config.smtp_user,
        smtp_password="••••••••" if config.smtp_password else "",
        smtp_from=config.smtp_from,
        smtp_from_name=config.smtp_from_name,
        smtp_tls=config.smtp_tls,
        smtp_ssl=config.smtp_ssl,
        notify_level_high=config.notify_level_high,
        notify_level_medium=config.notify_level_medium,
        notify_level_low=config.notify_level_low,
        active=config.active,
    )


@router.put("", response_model=NotificationConfigOut)
async def upsert_config(
    body: NotificationConfigUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(TenantNotificationConfig).where(
            TenantNotificationConfig.tenant_id == current_user.tenant_id
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        config = TenantNotificationConfig(tenant_id=current_user.tenant_id)
        db.add(config)

    config.smtp_host = body.smtp_host
    config.smtp_port = body.smtp_port
    config.smtp_user = body.smtp_user
    if body.smtp_password is not None and body.smtp_password != "••••••••":
        config.smtp_password = body.smtp_password
    config.smtp_from = body.smtp_from
    config.smtp_from_name = body.smtp_from_name
    config.smtp_tls = body.smtp_tls
    config.smtp_ssl = body.smtp_ssl
    config.notify_level_high = body.notify_level_high
    config.notify_level_medium = body.notify_level_medium
    config.notify_level_low = body.notify_level_low
    config.active = body.active

    await db.commit()
    await db.refresh(config)

    return NotificationConfigOut(
        id=config.id,
        tenant_id=config.tenant_id,
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port,
        smtp_user=config.smtp_user,
        smtp_password="••••••••" if config.smtp_password else "",
        smtp_from=config.smtp_from,
        smtp_from_name=config.smtp_from_name,
        smtp_tls=config.smtp_tls,
        smtp_ssl=config.smtp_ssl,
        notify_level_high=config.notify_level_high,
        notify_level_medium=config.notify_level_medium,
        notify_level_low=config.notify_level_low,
        active=config.active,
    )


@router.post("/test")
async def test_email(
    body: TestEmailRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a test email using the current tenant SMTP config."""
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(TenantNotificationConfig).where(
            TenantNotificationConfig.tenant_id == current_user.tenant_id,
            TenantNotificationConfig.active == True,
        )
    )
    config = result.scalar_one_or_none()
    if not config or not config.smtp_host:
        raise HTTPException(400, "No hay configuración SMTP activa para este tenant")

    try:
        import aiosmtplib
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        msg = MIMEMultipart("alternative")
        msg["Subject"] = "CMG Telematics — Prueba de notificación"
        msg["From"] = f"{config.smtp_from_name} <{config.smtp_from}>"
        msg["To"] = body.email

        html = f"""
        <html><body style="font-family: sans-serif; background: #0f1117; color: #e2e8f0; padding: 24px;">
          <div style="max-width: 600px; margin: 0 auto; background: #1e2532; border-radius: 12px; padding: 24px; border: 1px solid rgba(255,255,255,0.08);">
            <h2 style="color: #1D9E75; margin-top:0;">Configuración de correo correcta</h2>
            <p>Este es un correo de prueba enviado desde <strong>CMG Telematics</strong>.</p>
            <p>La configuración SMTP está funcionando correctamente. A partir de ahora recibirás las alertas de tu flota en este correo.</p>
            <p style="color: #64748b; font-size: 0.85em; margin-top: 24px;">CMG Telematics — Sistema de Monitorización Industrial</p>
          </div>
        </body></html>
        """
        msg.attach(MIMEText(html, "html"))

        await aiosmtplib.send(
            msg,
            hostname=config.smtp_host,
            port=config.smtp_port,
            username=config.smtp_user if config.smtp_user else None,
            password=config.smtp_password if config.smtp_password else None,
            use_tls=config.smtp_ssl,
            start_tls=config.smtp_tls and not config.smtp_ssl,
            timeout=15,
        )
        return {"status": "ok", "message": f"Correo de prueba enviado a {body.email}"}

    except Exception as e:
        raise HTTPException(500, f"Error al enviar correo: {str(e)}")
