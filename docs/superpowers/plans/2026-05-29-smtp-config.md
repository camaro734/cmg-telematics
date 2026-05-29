# Configuración SMTP desde la UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al administrador CMG configurar el servidor SMTP desde la UI sin tocar el .env, y que notify-svc lo use automáticamente.

**Architecture:** Nueva tabla `system_settings` (clave/valor JSONB). El core-api expone 3 endpoints (GET/PUT/test) protegidos por `require_tier('cmg') + role=admin`. El notify-svc lee SMTP de la BD con TTL de 5 min, con fallback a variables de entorno. El frontend añade una sección SMTP en SettingsPage.

**Tech Stack:** Python FastAPI + SQLAlchemy 2 + Alembic + smtplib (backend), asyncpg (notify-svc), React 18 + React Query (frontend). IMPORTANTE: No ejecutar `alembic upgrade head` ni reinicar contenedores — solo preparar los archivos y avisar a Carlos.

---

## Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| `backend/alembic/versions/032_system_settings.py` | Migración nueva |
| `backend/app/models/system_settings.py` | Nuevo modelo |
| `backend/app/models/__init__.py` | Importar SystemSettings |
| `backend/app/api/v1/settings_smtp.py` | Router con 3 endpoints |
| `backend/app/api/v1/router.py` | Registrar router smtp |
| `services/notify/src/dispatcher.py` | Leer SMTP de BD con TTL |
| `frontend/src/features/settings/SettingsPage.tsx` | Sección SMTP |
| `frontend/src/lib/types.ts` | Tipo SmtpConfig |
| `frontend/src/lib/queryKeys.ts` | Key smtp |

---

## Tarea 1: Migración 032 y modelo SystemSettings

**Files:**
- Create: `backend/alembic/versions/032_system_settings.py`
- Create: `backend/app/models/system_settings.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Paso 1: Crear la migración**

```python
# backend/alembic/versions/032_system_settings.py
"""system_settings table for global CMG configuration

Revision ID: 032
Revises: 031
Create Date: 2026-05-29

Tabla genérica clave/valor JSONB para configuración global del sistema.
Primera clave: 'smtp' — servidor de correo para alertas.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('key', sa.Text(), primary_key=True, nullable=False),
        sa.Column('value', JSONB(), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True),
                  server_default=sa.text('NOW()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('system_settings')
```

- [ ] **Paso 2: Crear el modelo SQLAlchemy**

```python
# backend/app/models/system_settings.py
from datetime import datetime
from sqlalchemy import Text, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    key:        Mapped[str]      = mapped_column(Text(), primary_key=True)
    value:      Mapped[dict]     = mapped_column(JSONB(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

- [ ] **Paso 3: Importar en models/__init__.py**

Añadir al final de los imports:
```python
from app.models.system_settings import SystemSettings
```

Y añadir `"SystemSettings"` al `__all__` si existe.

- [ ] **Paso 4: Verificar que no hay errores de importación**

```bash
cd /opt/cmg-telematic1/backend && python -c "from app.models.system_settings import SystemSettings; print('OK')"
```
Resultado esperado: `OK`

- [ ] **Paso 5: Commit (sin aplicar la migración)**

```bash
cd /opt/cmg-telematic1
git add backend/alembic/versions/032_system_settings.py \
        backend/app/models/system_settings.py \
        backend/app/models/__init__.py
git commit -m "feat(db): add system_settings table + SQLAlchemy model

Migration 032 — NOT applied yet. Run alembic upgrade head when ready.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 2: Endpoints SMTP en core-api

**Files:**
- Create: `backend/app/api/v1/settings_smtp.py`
- Modify: `backend/app/api/v1/router.py`

- [ ] **Paso 1: Crear el router SMTP**

```python
# backend/app/api/v1/settings_smtp.py
"""Endpoints de configuración SMTP — solo tier=cmg, role=admin."""
import smtplib
import logging
from email.message import EmailMessage
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from app.api.v1.deps import get_current_user, get_db, require_tier
from app.schemas.auth import CurrentUser
from app.models.system_settings import SystemSettings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings/smtp", tags=["settings"])

SMTP_KEY = "smtp"
DEFAULT_SMTP = {
    "host": "",
    "port": 587,
    "user": "",
    "password": "",
    "from_addr": "alertas@cmg.es",
    "tls": True,
}


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
    password: str = ""        # vacío = mantener contraseña existente
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
        raise HTTPException(status_code=403, detail="Solo el administrador CMG puede gestionar la configuración SMTP.")
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
    cfg = row.value if row else DEFAULT_SMTP
    smtp_host = cfg.get("host", "")
    if not smtp_host:
        raise HTTPException(status_code=400, detail="No hay servidor SMTP configurado.")

    msg = EmailMessage()
    msg["From"] = cfg.get("from_addr", "alertas@cmg.es")
    msg["To"] = str(body.to)
    msg["Subject"] = "CMG Telematics — prueba de configuración SMTP"
    msg.set_content("Este es un email de prueba enviado desde CMG Telematics para verificar la configuración SMTP.")

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
```

- [ ] **Paso 2: Registrar en router.py**

En `backend/app/api/v1/router.py`:
```python
# Añadir import:
from app.api.v1.settings_smtp import router as smtp_router

# Añadir al final del bloque de include_router:
api_router.include_router(smtp_router)
```

- [ ] **Paso 3: Verificar imports**

```bash
cd /opt/cmg-telematic1/backend && python -c "from app.api.v1.settings_smtp import router; print('OK')"
```
Resultado esperado: `OK`

- [ ] **Paso 4: Tests de backend**

```bash
cd /opt/cmg-telematic1/backend && python -m pytest tests/ -x -q 2>&1 | tail -10
```
Resultado esperado: todos pasan (los nuevos endpoints no tienen tests todavía — aceptable para MVP).

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/api/v1/settings_smtp.py backend/app/api/v1/router.py
git commit -m "feat(api): add SMTP config endpoints GET/PUT/test — cmg admin only

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 3: notify-svc — leer SMTP de BD con TTL

**Files:**
- Modify: `services/notify/src/dispatcher.py`

- [ ] **Paso 1: Leer dispatcher.py actual**

```bash
cat /opt/cmg-telematic1/services/notify/src/dispatcher.py
```

- [ ] **Paso 2: Reemplazar dispatcher.py**

```python
# services/notify/src/dispatcher.py
import asyncio
import logging
import smtplib
import time
from email.message import EmailMessage
import httpx
import asyncpg
from src.config import settings

logger = logging.getLogger(__name__)

# ── Cache SMTP con TTL 5 min ──────────────────────────────────────────────────

_smtp_cache: dict | None = None
_smtp_cache_ts: float = 0.0
_SMTP_TTL = 300  # 5 minutos


async def _load_smtp_from_db(db_pool: asyncpg.Pool) -> dict:
    """Lee config SMTP de system_settings. Fallback a variables de entorno."""
    global _smtp_cache, _smtp_cache_ts

    now = time.monotonic()
    if _smtp_cache is not None and (now - _smtp_cache_ts) < _SMTP_TTL:
        return _smtp_cache

    try:
        row = await db_pool.fetchrow(
            "SELECT value FROM system_settings WHERE key = 'smtp'"
        )
        if row and row["value"].get("host"):
            _smtp_cache = row["value"]
            _smtp_cache_ts = now
            logger.debug("SMTP config loaded from DB: host=%s", _smtp_cache.get("host"))
            return _smtp_cache
    except Exception as exc:
        logger.warning("Could not load SMTP from DB (%s) — using env fallback", exc)

    # Fallback a variables de entorno
    _smtp_cache = {
        "host": settings.smtp_host,
        "port": settings.smtp_port,
        "user": settings.smtp_user,
        "password": settings.smtp_password,
        "from_addr": settings.smtp_from,
        "tls": True,
    }
    _smtp_cache_ts = now
    return _smtp_cache


# ── Dispatcher principal ──────────────────────────────────────────────────────

async def dispatch_action(action: dict, context: dict, db_pool: asyncpg.Pool | None = None) -> None:
    atype = action.get("type")
    if atype == "email":
        await _send_email(action, context, db_pool)
    elif atype == "webhook":
        await _send_webhook(action, context)
    elif atype == "in_app":
        pass  # already persisted in alert_instance by rules-engine
    elif atype in ("push", "sms"):
        logger.info(
            "[stub] Would send %s to alert %s vehicle %s",
            atype, context.get("alert_id"), context.get("vehicle_id"),
        )
    else:
        logger.warning("Unknown action type: %s", atype)


async def _send_email(action: dict, context: dict, db_pool: asyncpg.Pool | None = None) -> None:
    recipients = action.get("recipients") or action.get("to", [])
    if isinstance(recipients, str):
        recipients = [recipients]
    if not recipients:
        return

    # Cargar config SMTP (BD con TTL o env)
    cfg = await _load_smtp_from_db(db_pool) if db_pool else {
        "host": settings.smtp_host, "port": settings.smtp_port,
        "user": settings.smtp_user, "password": settings.smtp_password,
        "from_addr": settings.smtp_from, "tls": True,
    }

    smtp_host = cfg.get("host", "")
    if not smtp_host:
        logger.info(
            "[stub] Email to %s — rule: %s vehicle: %s",
            recipients, context.get("rule_name"), context.get("vehicle_name", context.get("vehicle_id")),
        )
        return

    msg = EmailMessage()
    msg["From"] = cfg.get("from_addr", settings.smtp_from)
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = action.get(
        "subject", "[ALERTA] %s — %s" % (
            context.get("rule_name", "CMG Telematics"),
            context.get("vehicle_name", ""),
        )
    )
    msg.set_content(
        "Vehículo: %s\nSeveridad: %s\nValor disparado: %s\nRegla: %s" % (
            context.get("vehicle_name", context.get("vehicle_id")),
            context.get("severity"),
            context.get("trigger_value"),
            context.get("rule_name"),
        )
    )
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _smtp_send, msg, cfg)


def _smtp_send(msg: EmailMessage, cfg: dict) -> None:
    host = cfg.get("host", settings.smtp_host)
    port = cfg.get("port", settings.smtp_port)
    user = cfg.get("user", settings.smtp_user)
    password = cfg.get("password", settings.smtp_password)
    tls = cfg.get("tls", True)

    with smtplib.SMTP(host, port, timeout=30) as s:
        if tls or user:
            s.starttls()
        if user:
            s.login(user, password)
        s.send_message(msg)


async def _send_webhook(action: dict, context: dict) -> None:
    url = action.get("url", "")
    if not url:
        logger.warning("Webhook action has no URL")
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.request(
                method=action.get("method", "POST").upper(),
                url=url,
                json=context,
            )
        logger.info("Webhook sent to %s for alert %s", url, context.get("alert_id"))
    except Exception as exc:
        logger.error("Webhook %s failed: %s", url, exc)
```

- [ ] **Paso 3: Actualizar llamadas en main.py de notify-svc**

```bash
grep -n "dispatch_action\|db_pool" /opt/cmg-telematic1/services/notify/src/main.py | head -15
```

La función `_process_alert(db_pool, redis, fields)` ya recibe `db_pool`. Buscar la línea que llama a `dispatch_action(action, context)` y cambiarla a `dispatch_action(action, context, db_pool)`. Usar Edit con replace_all=True:

Buscar: `await dispatch_action(action, context)`
Reemplazar por: `await dispatch_action(action, context, db_pool)`

- [ ] **Paso 4: Verificar importaciones**

```bash
cd /opt/cmg-telematic1 && python -c "
import sys; sys.path.insert(0, 'services/notify')
from src.dispatcher import dispatch_action, _load_smtp_from_db
print('OK')
"
```
Resultado esperado: `OK`

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add services/notify/src/dispatcher.py services/notify/src/main.py
git commit -m "feat(notify): load SMTP config from system_settings DB with 5min TTL

Fallback to env vars if DB unavailable or no config stored.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 4: Frontend — tipos, queryKeys y sección SMTP en SettingsPage

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`
- Modify: `frontend/src/features/settings/SettingsPage.tsx`

- [ ] **Paso 1: Añadir tipo SmtpConfig en types.ts**

```bash
grep -n "export interface\|export type" /opt/cmg-telematic1/frontend/src/lib/types.ts | tail -10
```

Añadir al final del archivo:
```ts
export interface SmtpConfig {
  host: string
  port: number
  user: string
  password_set: boolean
  from_addr: string
  tls: boolean
}

export interface SmtpConfigUpdate {
  host: string
  port: number
  user: string
  password: string
  from_addr: string
  tls: boolean
}
```

- [ ] **Paso 2: Añadir queryKey en queryKeys.ts**

```bash
grep -n "settings\|smtp" /opt/cmg-telematic1/frontend/src/lib/queryKeys.ts | head -5
```

Añadir en el objeto `keys`:
```ts
  smtpConfig: () => ['settings', 'smtp'] as const,
```

- [ ] **Paso 3: Leer SettingsPage.tsx actual**

```bash
cat /opt/cmg-telematic1/frontend/src/features/settings/SettingsPage.tsx
```

- [ ] **Paso 4: Añadir sección SMTP en SettingsPage.tsx**

SettingsPage.tsx tiene 37 líneas. Reemplazar el archivo completo con la versión que añade la sección SMTP al final:

```tsx
// frontend/src/features/settings/SettingsPage.tsx
import Shell from '../../shared/ui/Shell'
import { useAuthStore } from '../auth/useAuthStore'
import UsersSection from './UsersSection'
import NotificationSettings from './NotificationSettings'
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
import SmtpSection from './SmtpSection'

export default function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const isCmgAdmin = user?.tenant_tier === 'cmg' && user?.role === 'admin'

  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, maxWidth: 860, overflowY: 'auto', height: '100%' }}>
        <UsersSection />
        <NotificationSettings />
        <WorkCycleDefinitionsSection />
        {isCmgAdmin && <SmtpSection />}
      </div>
    </Shell>
  )
}
```

- [ ] **Paso 5: Crear SmtpSection.tsx**

```tsx
// frontend/src/features/settings/SmtpSection.tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { toast } from '../../shared/ui/Toast'
import type { SmtpConfig, SmtpConfigUpdate } from '../../lib/types'

const INPUT_STYLE = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
  fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const,
}
const LABEL_STYLE = {
  fontSize: 11, fontWeight: 600 as const, color: 'var(--fg-muted)',
  letterSpacing: '0.05em', display: 'block' as const, marginBottom: 5,
  fontFamily: 'var(--font-sans)',
}
const HELP_STYLE = {
  fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)',
  marginTop: 4, lineHeight: 1.5 as const,
}

export default function SmtpSection() {
  const qc = useQueryClient()
  const [showPassword, setShowPassword] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  const [draft, setDraft] = useState<SmtpConfigUpdate>({
    host: '', port: 587, user: '', password: '', from_addr: 'alertas@cmg.es', tls: true,
  })

  const { data: config } = useQuery({
    queryKey: keys.smtpConfig(),
    queryFn: () => apiClient.get<SmtpConfig>('/api/v1/settings/smtp'),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (config) {
      setDraft({
        host: config.host,
        port: config.port,
        user: config.user,
        password: '',  // no rellenamos la contraseña por seguridad
        from_addr: config.from_addr,
        tls: config.tls,
      })
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: () => apiClient.put<SmtpConfig>('/api/v1/settings/smtp', draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.smtpConfig() })
      toast.success('Configuración SMTP guardada')
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const handleTest = async () => {
    if (!testEmail || !testEmail.includes('@')) return
    setIsTesting(true)
    setTestResult(null)
    try {
      // Guardar primero, luego probar
      await apiClient.put('/api/v1/settings/smtp', draft)
      const result = await apiClient.post<{ ok: boolean; error?: string }>(
        '/api/v1/settings/smtp/test', { to: testEmail }
      )
      setTestResult(result)
      if (result.ok) toast.success(`Email de prueba enviado a ${testEmail}`)
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message })
    } finally {
      setIsTesting(false)
    }
  }

  const field = (key: keyof SmtpConfigUpdate) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(prev => ({ ...prev, [key]: key === 'port' ? parseInt(e.target.value) || 587 : e.target.value }))
  }

  return (
    <div style={{ marginBottom: 32, paddingBottom: 32, borderBottom: '1px solid var(--border)' }}>
      <p style={{
        fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
        letterSpacing: '0.06em', marginBottom: 16, fontFamily: 'var(--font-sans)',
      }}>
        CORREO (SMTP)
      </p>
      <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
        Configura el servidor de correo para el envío de alertas por email a los destinatarios configurados en cada regla.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px 16px', marginBottom: 12 }}>
        <div>
          <label style={LABEL_STYLE}>SERVIDOR SMTP</label>
          <input
            value={draft.host}
            onChange={field('host')}
            placeholder="smtp.gmail.com"
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>PUERTO</label>
          <input
            type="number"
            value={draft.port}
            onChange={field('port')}
            style={INPUT_STYLE}
            min={1} max={65535}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>USUARIO</label>
          <input
            value={draft.user}
            onChange={field('user')}
            placeholder="usuario@empresa.com"
            autoComplete="off"
            style={INPUT_STYLE}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={LABEL_STYLE}>
            CONTRASEÑA{config?.password_set && ' '}
            {config?.password_set && (
              <span style={{ color: 'var(--ok)', fontWeight: 400, letterSpacing: 0 }}>· configurada</span>
            )}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={draft.password}
              onChange={field('password')}
              placeholder={config?.password_set ? 'Dejar vacío para mantener la actual' : 'Contraseña SMTP'}
              autoComplete="new-password"
              style={{ ...INPUT_STYLE, paddingRight: 80 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', color: 'var(--fg-dim)',
                cursor: 'pointer', fontSize: 11,
              }}
            >
              {showPassword ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={LABEL_STYLE}>DIRECCIÓN REMITENTE</label>
          <input
            value={draft.from_addr}
            onChange={field('from_addr')}
            placeholder="alertas@cmg.es"
            style={INPUT_STYLE}
          />
          <p style={HELP_STYLE}>Esta dirección aparece como remitente en los emails de alerta.</p>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12, fontSize: 13, color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)' }}>
        <input
          type="checkbox"
          checked={draft.tls}
          onChange={e => setDraft(p => ({ ...p, tls: e.target.checked }))}
          style={{ accentColor: 'var(--cmg-teal)', width: 15, height: 15 }}
        />
        Activar STARTTLS (recomendado con puerto 587)
      </label>

      <div style={{
        padding: '10px 14px', background: 'var(--bg-elevated)',
        border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20,
      }}>
        <p style={{ ...HELP_STYLE, margin: 0 }}>
          <strong style={{ color: 'var(--fg-tertiary)' }}>Gmail:</strong> smtp.gmail.com · puerto 587 · usa una <em>contraseña de aplicación</em> (no la de tu cuenta) — Cuenta Google → Seguridad → Contraseñas de aplicación.<br/>
          <strong style={{ color: 'var(--fg-tertiary)' }}>Outlook / Office 365:</strong> smtp.office365.com · puerto 587 · usuario = dirección de correo completa.<br/>
          <strong style={{ color: 'var(--fg-tertiary)' }}>OVH / cPanel:</strong> mail.tudominio.com · puerto 587 · usuario = dirección de correo completa.
        </p>
      </div>

      {/* Test */}
      <div style={{ marginBottom: 16 }}>
        <label style={LABEL_STYLE}>ENVIAR EMAIL DE PRUEBA</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="email"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            placeholder="destino@empresa.com"
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting || !testEmail}
            style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 600,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--fg-tertiary)', cursor: isTesting ? 'wait' : 'pointer',
              fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const,
            }}
          >
            {isTesting ? 'Enviando…' : 'Enviar prueba →'}
          </button>
        </div>
        {testResult && (
          <div style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 6,
            background: testResult.ok ? 'var(--ok-soft)' : 'var(--danger-soft)',
            border: `1px solid ${testResult.ok ? 'var(--ok)' : 'var(--danger)'}`,
            fontSize: 12, color: testResult.ok ? 'var(--ok)' : 'var(--danger)',
            fontFamily: 'var(--font-sans)',
          }}>
            {testResult.ok ? '✓ Email enviado correctamente' : `✗ ${testResult.error}`}
          </div>
        )}
        <p style={HELP_STYLE}>Guarda la configuración y envía un email de prueba para verificar que funciona correctamente.</p>
      </div>

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        style={{
          padding: '8px 20px', fontSize: 13, fontWeight: 600,
          background: 'var(--cmg-teal)', border: 'none', borderRadius: 6,
          color: '#fff', cursor: saveMutation.isPending ? 'wait' : 'pointer',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {saveMutation.isPending ? 'Guardando…' : 'Guardar configuración SMTP'}
      </button>
    </div>
  )
}
```

- [ ] **Paso 6: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -8
```
Resultado esperado: build ✓, tests pasan.

- [ ] **Paso 7: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/types.ts \
        frontend/src/lib/queryKeys.ts \
        frontend/src/features/settings/SettingsPage.tsx \
        frontend/src/features/settings/SmtpSection.tsx
git commit -m "feat(settings): add SMTP configuration section for CMG admins

GET/PUT/test via /api/v1/settings/smtp. Test email with inline result.
Help text for Gmail, Outlook and cPanel.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 5: Instrucciones de despliegue (para Carlos)

**Esta tarea NO la ejecuta el agente — requiere confirmación explícita de Carlos.**

- [ ] **Paso 1: Aplicar la migración en producción**

```bash
# Copiar el archivo de migración al contenedor de core-api
docker cp backend/alembic/versions/032_system_settings.py \
  $(docker ps -q --filter "name=cmg-telematic1_core-api") \
  /app/alembic/versions/032_system_settings.py

# Aplicar la migración (sin reiniciar el servicio)
docker exec $(docker ps -q --filter "name=cmg-telematic1_core-api") \
  alembic upgrade head
```

- [ ] **Paso 2: Reconstruir core-api para que cargue el nuevo router**

```bash
docker-compose build core-api
# Usar el procedimiento de swap manual para no bajar el stack
```

- [ ] **Paso 3: Reconstruir notify-svc**

```bash
docker-compose build notify-svc
# Usar el procedimiento de swap manual
```

- [ ] **Paso 4: Reconstruir frontend**

```bash
docker-compose build frontend
# Usar el procedimiento de swap manual (2s downtime)
```
