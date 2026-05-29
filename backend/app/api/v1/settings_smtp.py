"""Endpoints de configuración SMTP — solo tier=cmg, role=admin."""
import smtplib
import logging
from email.message import EmailMessage
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from app.api.v1.deps import get_current_user, get_db
from app.schemas.auth import CurrentUser
from app.models.system_settings import SystemSettings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings/smtp", tags=["settings"])

SMTP_KEY = "smtp"


class SmtpConfigOut(BaseModel):
    host: str = ""
    port: int = 587
    user: str = ""
    password_set: bool = False
    from_addr: str = "alertas@cmg.es"
    tls: bool = True


class SmtpConfigUpdate(BaseModel):
    host: str = ""
    port: int = 587
    user: str = ""
    password: str = ""
    from_addr: str = "alertas@cmg.es"
    tls: bool = True


class SmtpTestRequest(BaseModel):
    to: EmailStr


async def _get_smtp_row(db: AsyncSession) -> SystemSettings | None:
    result = await db.execute(
        select(SystemSettings).where(SystemSettings.key == SMTP_KEY)
    )
    return result.scalar_one_or_none()


def _require_cmg_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Solo el administrador CMG puede gestionar la configuración SMTP."
        )
    return user


@router.get("", response_model=SmtpConfigOut)
async def get_smtp(
    user: CurrentUser = Depends(_require_cmg_admin),
    db: AsyncSession = Depends(get_db),
) -> SmtpConfigOut:
    row = await _get_smtp_row(db)
    if not row:
        return SmtpConfigOut()
    v = row.value
    return SmtpConfigOut(
        host=v.get("host", ""),
        port=v.get("port", 587),
        user=v.get("user", ""),
        password_set=bool(v.get("password", "")),
        from_addr=v.get("from_addr", "alertas@cmg.es"),
        tls=v.get("tls", True),
    )


@router.put("", response_model=SmtpConfigOut)
async def update_smtp(
    body: SmtpConfigUpdate,
    user: CurrentUser = Depends(_require_cmg_admin),
    db: AsyncSession = Depends(get_db),
) -> SmtpConfigOut:
    row = await _get_smtp_row(db)
    existing_password = row.value.get("password", "") if row else ""

    new_value = {
        "host": body.host,
        "port": body.port,
        "user": body.user,
        "password": body.password if body.password else existing_password,
        "from_addr": body.from_addr,
        "tls": body.tls,
    }

    if row:
        row.value = new_value
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(row, "value")
    else:
        db.add(SystemSettings(key=SMTP_KEY, value=new_value))

    await db.commit()
    logger.info("SMTP config updated by user %s", user.email)
    return SmtpConfigOut(
        host=new_value["host"],
        port=new_value["port"],
        user=new_value["user"],
        password_set=bool(new_value["password"]),
        from_addr=new_value["from_addr"],
        tls=new_value["tls"],
    )


@router.post("/test")
async def test_smtp(
    body: SmtpTestRequest,
    user: CurrentUser = Depends(_require_cmg_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = await _get_smtp_row(db)
    cfg = row.value if row else {}
    smtp_host = cfg.get("host", "")
    if not smtp_host:
        raise HTTPException(status_code=400, detail="No hay servidor SMTP configurado.")

    msg = EmailMessage()
    msg["From"] = cfg.get("from_addr", "alertas@cmg.es")
    msg["To"] = str(body.to)
    msg["Subject"] = "CMG Telematics — prueba de configuración SMTP"
    msg.set_content(
        "Este es un email de prueba enviado desde CMG Telematics para verificar "
        "la configuración SMTP."
    )

    try:
        with smtplib.SMTP(smtp_host, cfg.get("port", 587), timeout=15) as s:
            if cfg.get("tls", True):
                s.starttls()
            if cfg.get("user"):
                s.login(cfg["user"], cfg.get("password", ""))
            s.send_message(msg)
        logger.info("SMTP test OK — sent to %s", body.to)
        return {"ok": True}
    except smtplib.SMTPAuthenticationError as e:
        return {"ok": False, "error": f"Error de autenticación: {e.smtp_error.decode('utf-8', errors='ignore')}"}
    except smtplib.SMTPConnectError as e:
        return {"ok": False, "error": f"No se pudo conectar a {smtp_host}:{cfg.get('port', 587)} — {e}"}
    except Exception as e:
        logger.error("SMTP test failed: %s", e)
        return {"ok": False, "error": str(e)}
