"""
Notification service — sends email and web push alerts.
Both channels are optional (no SMTP/VAPID config = silently skip).
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)


async def _get_tenant_users(db: AsyncSession, tenant_id) -> list:
    """Get all active operator+ users in the same tenant that have email notifications enabled."""
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.active == True,
            User.role.in_(["superadmin", "admin", "operator"]),
            User.notify_email == True,
        )
    )
    return result.scalars().all()


async def send_email_alert(
    db: AsyncSession,
    tenant_id,
    vehicle_name: str,
    display_name: str,
    converted_value: float,
    threshold: float,
    unit: str,
    level: str,
    fired_at: str,
    condition: str = "gt",
) -> None:
    """Send email notification to all operator+ users of the tenant."""
    from app.models.tenant_notification_config import TenantNotificationConfig

    # Try tenant-specific config first
    cfg_result = await db.execute(
        select(TenantNotificationConfig).where(
            TenantNotificationConfig.tenant_id == tenant_id,
            TenantNotificationConfig.active == True,
        )
    )
    tenant_cfg = cfg_result.scalar_one_or_none()

    if tenant_cfg and tenant_cfg.smtp_host:
        # Check if this level should trigger email
        should_notify = (
            (level == "high" and tenant_cfg.notify_level_high) or
            (level == "medium" and tenant_cfg.notify_level_medium) or
            (level == "low" and tenant_cfg.notify_level_low)
        )
        if not should_notify:
            return

        smtp_host = tenant_cfg.smtp_host
        smtp_port = tenant_cfg.smtp_port
        smtp_user = tenant_cfg.smtp_user
        smtp_password = tenant_cfg.smtp_password
        smtp_from = f"{tenant_cfg.smtp_from_name} <{tenant_cfg.smtp_from}>"
        smtp_tls = tenant_cfg.smtp_tls
        smtp_ssl = tenant_cfg.smtp_ssl
    elif settings.SMTP_HOST:
        # Fall back to global platform settings
        smtp_host = settings.SMTP_HOST
        smtp_port = settings.SMTP_PORT
        smtp_user = settings.SMTP_USER
        smtp_password = settings.SMTP_PASSWORD
        smtp_from = settings.SMTP_FROM
        smtp_tls = settings.SMTP_TLS
        smtp_ssl = False
    else:
        return  # No email configured anywhere

    try:
        import aiosmtplib
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        users = await _get_tenant_users(db, tenant_id)
        if not users:
            return

        level_emoji = {"high": "🔴", "medium": "🟡", "low": "🔵"}.get(level, "⚠️")
        subject = f"{level_emoji} CMG Telematics — Alerta {level.upper()}: {display_name}"

        if level == "high":
            alert_color = "#ef4444"
            alert_bg = "#ef444422"
        elif level == "medium":
            alert_color = "#f59e0b"
            alert_bg = "#f59e0b22"
        else:
            alert_color = "#3b82f6"
            alert_bg = "#3b82f622"

        body_html = f"""
        <html><body style="font-family: sans-serif; background: #0f1117; color: #e2e8f0; padding: 24px;">
          <div style="max-width: 600px; margin: 0 auto; background: #1e2532; border-radius: 12px; padding: 24px; border: 1px solid rgba(255,255,255,0.08);">
            <h2 style="color: #1D9E75; margin-top:0;">CMG Telematics — Alerta de Flota</h2>
            <div style="background: {alert_bg}; border-left: 4px solid {alert_color}; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <strong style="font-size: 1.2em;">{level_emoji} {display_name}</strong><br>
              <span style="font-size: 2em; font-weight: bold; color: {alert_color};">{converted_value:.2f} {unit}</span>
            </div>
            <table style="width:100%; border-collapse: collapse; margin-top: 16px;">
              <tr><td style="padding: 8px; color: #64748b;">Vehículo</td><td style="padding: 8px;"><strong>{vehicle_name}</strong></td></tr>
              <tr><td style="padding: 8px; color: #64748b;">Variable</td><td style="padding: 8px;">{display_name}</td></tr>
              <tr><td style="padding: 8px; color: #64748b;">Valor</td><td style="padding: 8px;">{converted_value:.2f} {unit}</td></tr>
              <tr><td style="padding: 8px; color: #64748b;">Umbral</td><td style="padding: 8px;">{threshold:.2f} {unit}</td></tr>
              <tr><td style="padding: 8px; color: #64748b;">Nivel</td><td style="padding: 8px;">{level.upper()}</td></tr>
              <tr><td style="padding: 8px; color: #64748b;">Hora</td><td style="padding: 8px;">{fired_at}</td></tr>
            </table>
            <div style="margin-top: 24px; text-align: center;">
              <a href="https://213.210.20.183/alerts" style="background: #1D9E75; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Ver Alertas →</a>
            </div>
            <p style="margin-top: 24px; color: #64748b; font-size: 0.85em; text-align: center;">CMG Telematics — Sistema de Monitorización Industrial</p>
          </div>
        </body></html>
        """

        for user in users:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = user.email
            msg.attach(MIMEText(body_html, "html"))

            await aiosmtplib.send(
                msg,
                hostname=smtp_host,
                port=smtp_port,
                username=smtp_user if smtp_user else None,
                password=smtp_password if smtp_password else None,
                use_tls=smtp_ssl,
                start_tls=smtp_tls and not smtp_ssl,
                timeout=10,
            )
            logger.info(f"Alert email sent to {user.email} for vehicle {vehicle_name}")

    except Exception as e:
        logger.error(f"Failed to send alert email: {e}")


async def send_push_alert(
    db: AsyncSession,
    tenant_id,
    vehicle_name: str,
    display_name: str,
    converted_value: float,
    threshold: float,
    unit: str,
    level: str,
    alert_id: str,
) -> None:
    """Send web push notification to subscribed users."""
    if not settings.VAPID_PRIVATE_KEY:
        return  # Push not configured

    try:
        import json
        from pywebpush import webpush, WebPushException
        from app.models.push_subscription import PushSubscription

        result = await db.execute(
            select(PushSubscription)
            .join(User, PushSubscription.user_id == User.id)
            .where(
                User.tenant_id == tenant_id,
                User.active == True,
            )
        )
        subscriptions = result.scalars().all()

        if not subscriptions:
            return

        level_emoji = {"high": "🔴", "medium": "🟡", "low": "🔵"}.get(level, "⚠️")
        payload = json.dumps({
            "title": f"{level_emoji} Alerta {level.upper()} — {vehicle_name}",
            "body": f"{display_name}: {converted_value:.2f} {unit} (umbral: {threshold:.2f})",
            "url": "/alerts",
            "tag": f"alert-{alert_id}",
            "level": level,
        })

        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=payload,
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": settings.VAPID_SUBJECT},
                    ttl=3600,
                )
            except WebPushException as e:
                if e.response and e.response.status_code in (404, 410):
                    # Subscription expired — remove it
                    await db.delete(sub)
                    await db.commit()
                else:
                    logger.error(f"Push failed for subscription {sub.id}: {e}")

    except Exception as e:
        logger.error(f"Failed to send push notification: {e}")
