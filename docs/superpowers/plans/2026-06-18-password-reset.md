# Recuperación de contraseña — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un usuario recupere su contraseña por email mediante un enlace de un solo uso, sin intervención de un administrador.

**Architecture:** Dos endpoints públicos en `auth.py` (`forgot-password`, `reset-password`). El token se guarda **hasheado** en Redis con TTL 1 h (sin migración). El correo se envía reutilizando notify-svc (Redis stream `alerts.fire`), que se extiende para aceptar un cuerpo de email personalizado. Frontend: dos páginas públicas (`/forgot-password`, `/reset-password/:token`) más un enlace en el login.

**Tech Stack:** FastAPI + SQLAlchemy async + Redis (redis.asyncio) + bcrypt/jose · React 18 + React Router 6 + Zustand + Vitest.

## Global Constraints

- Comentarios en español, código en inglés.
- Type hints en toda función pública Python; TypeScript estricto (no `any`).
- Redis: acceso vía `getattr(request.app.state, "redis", None)`.
- Rate-limit pattern existente: `redis.incr(key)` + `redis.expire(key, window)` + `redis.ttl(key)`.
- Token de reset: `secrets.token_urlsafe(32)`; en Redis se guarda `sha256(token).hexdigest()`, nunca el token en claro.
- TTL del token: `3600` segundos.
- Respuesta de `forgot-password` SIEMPRE genérica e idéntica exista o no el email.
- Longitud mínima de contraseña: `8` (igual que `UserCreate` en `backend/app/schemas/user.py`).
- Tras cambiar contraseña: `user.pwd_version += 1` (invalida todos los JWT del usuario).
- Endpoints registrados bajo `/api/v1/auth` (router con `prefix="/auth"`).
- Frontend: estilos inline con CSS variables; reutilizar `<Input/>` de `shared/ui/Input`; toasts vía `useToast()`.
- Dominio del enlace: base `https://cmgtrack.com`.

---

### Task 1: Schemas y helper de token (backend)

**Files:**
- Modify: `backend/app/schemas/auth.py`
- Create: `backend/app/core/reset_token.py`
- Test: `backend/tests/test_reset_token.py`

**Interfaces:**
- Produces:
  - `ForgotPasswordRequest(email: EmailStr)` y `ResetPasswordRequest(token: str, new_password: str)` en `app.schemas.auth`.
  - `generate_reset_token() -> tuple[str, str]` (devuelve `(token_claro, redis_key)`), `reset_key_for(token: str) -> str` en `app.core.reset_token`.

- [ ] **Step 1: Escribir el test que falla**

```python
# backend/tests/test_reset_token.py
import hashlib
from app.core.reset_token import generate_reset_token, reset_key_for


def test_generate_reset_token_devuelve_token_y_clave_hasheada():
    token, key = generate_reset_token()
    assert isinstance(token, str) and len(token) >= 32
    # La clave es el hash sha256 del token, nunca el token en claro
    expected = "pwreset:" + hashlib.sha256(token.encode()).hexdigest()
    assert key == expected
    assert token not in key


def test_reset_key_for_es_deterministico():
    token, key = generate_reset_token()
    assert reset_key_for(token) == key
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && pytest tests/test_reset_token.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.core.reset_token'`

- [ ] **Step 3: Implementar `reset_token.py`**

```python
# backend/app/core/reset_token.py
"""Generación y derivación de claves para tokens de recuperación de contraseña.

El token en claro viaja en el enlace del email; en Redis solo se guarda su
hash sha256, de modo que leer Redis no permite usar los tokens.
"""
import hashlib
import secrets

_KEY_PREFIX = "pwreset:"


def reset_key_for(token: str) -> str:
    """Clave Redis para un token de reset: prefijo + sha256 del token en claro."""
    return _KEY_PREFIX + hashlib.sha256(token.encode()).hexdigest()


def generate_reset_token() -> tuple[str, str]:
    """Genera un token aleatorio URL-safe y su clave Redis hasheada."""
    token = secrets.token_urlsafe(32)
    return token, reset_key_for(token)
```

- [ ] **Step 4: Añadir los schemas en `auth.py`**

```python
# backend/app/schemas/auth.py  — añadir al final, junto a los demás
from pydantic import Field  # añadir a los imports existentes (BaseModel, EmailStr ya están)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd backend && pytest tests/test_reset_token.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/reset_token.py backend/app/schemas/auth.py backend/tests/test_reset_token.py
git commit -m "feat(auth): schemas y helper de token para recuperación de contraseña"
```

---

### Task 2: Helper de encolado de email de reset (backend)

**Files:**
- Create: `backend/app/core/reset_mailer.py`
- Test: `backend/tests/test_reset_mailer.py`

**Interfaces:**
- Consumes: `STREAM_KEY` (= `"alerts.fire"`, definido en `app.core.maintenance_notifier`).
- Produces: `async def enqueue_reset_email(redis, email: str, token: str) -> None` en `app.core.reset_mailer`.

- [ ] **Step 1: Escribir el test que falla**

```python
# backend/tests/test_reset_mailer.py
import json
from unittest.mock import AsyncMock
import pytest
from app.core.reset_mailer import enqueue_reset_email


@pytest.mark.asyncio
async def test_enqueue_reset_email_encola_action_email_con_body_y_enlace():
    redis = AsyncMock()
    await enqueue_reset_email(redis, "user@example.com", "TOK123")

    redis.xadd.assert_awaited_once()
    args, kwargs = redis.xadd.call_args
    stream_key, fields = args[0], args[1]
    assert stream_key == "alerts.fire"

    actions = json.loads(fields["actions"])
    assert len(actions) == 1
    action = actions[0]
    assert action["type"] == "email"
    assert action["recipients"] == ["user@example.com"]
    assert "Recuperación de contraseña" in action["subject"]
    # El body contiene el enlace con el token en claro
    assert "https://cmgtrack.com/reset-password/TOK123" in action["body"]
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && pytest tests/test_reset_mailer.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.core.reset_mailer'`

- [ ] **Step 3: Implementar `reset_mailer.py`**

```python
# backend/app/core/reset_mailer.py
"""Encola el correo de recuperación de contraseña en el stream de notify-svc.

Reutiliza el mismo stream (`alerts.fire`) y el mismo formato de action que
maintenance_notifier; la diferencia es que la action incluye `subject` y `body`
propios, de modo que notify-svc envía un correo con texto libre (ver
services/notify/src/dispatcher.py, Task 5).
"""
import json
import logging
import uuid

from redis.asyncio import Redis

from app.core.maintenance_notifier import STREAM_KEY

logger = logging.getLogger(__name__)

_RESET_BASE_URL = "https://cmgtrack.com"


async def enqueue_reset_email(redis: Redis, email: str, token: str) -> None:
    """Encola un correo con el enlace de recuperación para `email`."""
    link = f"{_RESET_BASE_URL}/reset-password/{token}"
    body = (
        "Hemos recibido una solicitud para restablecer tu contraseña en CMG Track.\n\n"
        f"Abre este enlace para crear una nueva contraseña (válido durante 1 hora):\n{link}\n\n"
        "Si no has solicitado este cambio, ignora este correo."
    )
    await redis.xadd(
        STREAM_KEY,
        {
            "alert_id": str(uuid.uuid4()),
            "rule_id": str(uuid.uuid4()),
            "vehicle_id": "",
            "tenant_id": "",
            "severity": "info",
            "trigger_value": json.dumps({"kind": "password_reset"}),
            "actions": json.dumps(
                [{
                    "type": "email",
                    "recipients": [email],
                    "subject": "Recuperación de contraseña — CMG Track",
                    "body": body,
                }]
            ),
            "escalation": json.dumps([]),
        },
        maxlen=10_000,
        approximate=True,
    )
    logger.info("Email de recuperación encolado para %s", email)
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `cd backend && pytest tests/test_reset_mailer.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/reset_mailer.py backend/tests/test_reset_mailer.py
git commit -m "feat(auth): helper para encolar email de recuperación en notify-svc"
```

---

### Task 3: notify-svc acepta cuerpo de email personalizado

**Files:**
- Modify: `services/notify/src/dispatcher.py:87-103` (función `_send_email`)
- Test: `services/notify/tests/test_dispatcher_body.py`

**Interfaces:**
- Consumes: `dispatch_action(action, context, db_pool)` con `action["body"]` opcional.
- Produces: `_send_email` usa `action["body"]` y `action["subject"]` cuando están presentes.

- [ ] **Step 1: Escribir el test que falla**

```python
# services/notify/tests/test_dispatcher_body.py
from unittest.mock import patch
import pytest
from src.dispatcher import _send_email


@pytest.mark.asyncio
async def test_send_email_usa_body_personalizado_cuando_existe():
    action = {
        "type": "email",
        "recipients": ["user@example.com"],
        "subject": "Asunto propio",
        "body": "Cuerpo libre con enlace https://cmgtrack.com/reset-password/TOK",
    }
    cfg = {"host": "smtp.test", "port": 587, "user": "", "password": "", "from_addr": "no-reply@cmg.es", "tls": True}
    captured = {}

    def _fake_send(msg, _cfg):
        captured["subject"] = msg["Subject"]
        captured["body"] = msg.get_content()

    with patch("src.dispatcher._load_smtp_from_db", return_value=cfg), \
         patch("src.dispatcher._smtp_send", _fake_send):
        await _send_email(action, {}, db_pool=object())

    assert captured["subject"] == "Asunto propio"
    assert "reset-password/TOK" in captured["body"]
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd services/notify && pytest tests/test_dispatcher_body.py -v`
Expected: FAIL — el body actual ignora `action["body"]` y devuelve el template "Vehículo: ..."

- [ ] **Step 3: Modificar `_send_email`**

Reemplazar el bloque del asunto y cuerpo (líneas ~90-103) por:

```python
    msg["Subject"] = action.get(
        "subject", "[ALERTA] %s — %s" % (
            context.get("rule_name", "CMG Telematics"),
            context.get("vehicle_name", ""),
        )
    )
    custom_body = action.get("body")
    if custom_body:
        # Correo con cuerpo libre (p. ej. recuperación de contraseña)
        msg.set_content(custom_body)
    else:
        msg.set_content(
            "Vehículo: %s\nSeveridad: %s\nValor disparado: %s\nRegla: %s" % (
                context.get("vehicle_name", context.get("vehicle_id")),
                context.get("severity"),
                context.get("trigger_value"),
                context.get("rule_name"),
            )
        )
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `cd services/notify && pytest tests/test_dispatcher_body.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add services/notify/src/dispatcher.py services/notify/tests/test_dispatcher_body.py
git commit -m "feat(notify): _send_email admite cuerpo y asunto personalizados"
```

---

### Task 4: Endpoint POST /auth/forgot-password (backend)

**Files:**
- Modify: `backend/app/api/v1/auth.py`
- Test: `backend/tests/test_forgot_password.py`

**Interfaces:**
- Consumes: `generate_reset_token` (Task 1), `enqueue_reset_email` (Task 2), `ForgotPasswordRequest` (Task 1), `User`, `verify_password`/`hash_password`.
- Produces: `POST /api/v1/auth/forgot-password` → 200 `{"detail": <mensaje genérico>}`.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# backend/tests/test_forgot_password.py
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from app.main import app

GENERIC = "Si el correo está registrado, recibirás un enlace para restablecer la contraseña."


def _db_returning(user):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db.execute = AsyncMock(return_value=result)
    return db


def _override_db(session):
    from app.core.database import get_db
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


def test_forgot_email_existente_encola_y_responde_generico():
    user = MagicMock(id="11111111-1111-1111-1111-111111111111", active=True)
    _override_db(_db_returning(user))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/forgot-password", json={"email": "user@example.com"})
    assert resp.status_code == 200
    assert resp.json()["detail"] == GENERIC
    app.state.redis.set.assert_awaited_once()
    app.state.redis.xadd.assert_awaited_once()


def test_forgot_email_inexistente_mismo_mensaje_sin_encolar():
    _override_db(_db_returning(None))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/forgot-password", json={"email": "nadie@example.com"})
    assert resp.status_code == 200
    assert resp.json()["detail"] == GENERIC
    app.state.redis.set.assert_not_awaited()
    app.state.redis.xadd.assert_not_awaited()
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd backend && pytest tests/test_forgot_password.py -v`
Expected: FAIL con 404 (la ruta aún no existe)

- [ ] **Step 3: Implementar el endpoint en `auth.py`**

Añadir imports al principio (junto a los existentes):

```python
from app.schemas.auth import ForgotPasswordRequest, ResetPasswordRequest
from app.core.reset_token import generate_reset_token, reset_key_for
from app.core.reset_mailer import enqueue_reset_email
from app.core.security import hash_password
```

Añadir constantes y endpoint (tras `_check_login_rate_limit`):

```python
_RESET_TOKEN_TTL = 3600  # 1 hora
_RESET_MAX_ATTEMPTS = 5
_RESET_WINDOW_SECONDS = 900
_RESET_GENERIC_MSG = "Si el correo está registrado, recibirás un enlace para restablecer la contraseña."


async def _check_reset_rate_limit(request: Request, suffix: str) -> None:
    """Rate limit para recuperación: máx 5 solicitudes por clave en 15 min."""
    redis = getattr(request.app.state, "redis", None)
    if redis is None:
        return
    key = f"ratelimit:pwreset:{suffix}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _RESET_WINDOW_SECONDS)
    if count > _RESET_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes. Inténtalo de nuevo más tarde.",
        )


@router.post("/forgot-password")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    await _check_reset_rate_limit(request, f"ip:{ip}")
    await _check_reset_rate_limit(request, f"email:{body.email}")

    result = await db.execute(select(User).where(User.email == body.email, User.active == True))
    user = result.scalar_one_or_none()
    redis = getattr(request.app.state, "redis", None)
    if user is not None and redis is not None:
        token, key = generate_reset_token()
        await redis.set(key, str(user.id), ex=_RESET_TOKEN_TTL)
        await enqueue_reset_email(redis, body.email, token)
    # Respuesta SIEMPRE genérica (no revela si el email existe)
    return {"detail": _RESET_GENERIC_MSG}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && pytest tests/test_forgot_password.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/auth.py backend/tests/test_forgot_password.py
git commit -m "feat(auth): endpoint forgot-password con rate-limit y respuesta genérica"
```

---

### Task 5: Endpoint POST /auth/reset-password (backend)

**Files:**
- Modify: `backend/app/api/v1/auth.py`
- Test: `backend/tests/test_reset_password.py`

**Interfaces:**
- Consumes: `ResetPasswordRequest` (Task 1), `reset_key_for` (Task 1), `hash_password`, `User`.
- Produces: `POST /api/v1/auth/reset-password` → 200 `{"detail": "Contraseña actualizada."}` o 400.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# backend/tests/test_reset_password.py
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.core.reset_token import reset_key_for


def _override_db(session):
    from app.core.database import get_db
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


def _db_with_user(user):
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    return db


def test_reset_token_invalido_devuelve_400():
    _override_db(_db_with_user(None))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    app.state.redis.get = AsyncMock(return_value=None)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/reset-password", json={"token": "malo", "new_password": "nuevapass123"})
    assert resp.status_code == 400


def test_reset_token_valido_cambia_password_e_incrementa_pwd_version():
    user = MagicMock(id="22222222-2222-2222-2222-222222222222", hashed_password="old", pwd_version=3)
    _override_db(_db_with_user(user))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    app.state.redis.get = AsyncMock(return_value=str(user.id))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/reset-password", json={"token": "buen-token", "new_password": "nuevapass123"})
    assert resp.status_code == 200
    assert user.pwd_version == 4
    assert user.hashed_password != "old"
    # token de un solo uso: se borra
    app.state.redis.delete.assert_awaited_once_with(reset_key_for("buen-token"))


def test_reset_password_corta_devuelve_422():
    _override_db(_db_with_user(None))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/reset-password", json={"token": "x", "new_password": "corta"})
    assert resp.status_code == 422
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd backend && pytest tests/test_reset_password.py -v`
Expected: FAIL con 404 (ruta inexistente) en los dos primeros

- [ ] **Step 3: Implementar el endpoint en `auth.py`**

```python
@router.post("/reset-password")
async def reset_password(request: Request, body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    await _check_reset_rate_limit(request, f"ip:{ip}")

    redis = getattr(request.app.state, "redis", None)
    key = reset_key_for(body.token)
    user_id = await redis.get(key) if redis is not None else None
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El enlace no es válido o ha caducado.")
    if isinstance(user_id, bytes):
        user_id = user_id.decode()

    user = await db.get(User, uuid.UUID(user_id))
    if user is None:
        await redis.delete(key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El enlace no es válido o ha caducado.")

    user.hashed_password = hash_password(body.new_password)
    user.pwd_version = (user.pwd_version or 0) + 1  # invalida todos los JWT activos
    await db.commit()
    await redis.delete(key)  # token de un solo uso
    return {"detail": "Contraseña actualizada."}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && pytest tests/test_reset_password.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Ejecutar toda la suite de auth para descartar regresiones**

Run: `cd backend && pytest tests/test_reset_token.py tests/test_reset_mailer.py tests/test_forgot_password.py tests/test_reset_password.py -v`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/auth.py backend/tests/test_reset_password.py
git commit -m "feat(auth): endpoint reset-password single-use con invalidación de sesiones"
```

---

### Task 6: ForgotPasswordPage + enlace en login (frontend)

**Files:**
- Create: `frontend/src/features/auth/ForgotPasswordPage.tsx`
- Modify: `frontend/src/features/auth/LoginPage.tsx` (sustituir el párrafo "¿Olvidaste tu contraseña? Contacta con tu administrador.")
- Modify: `frontend/src/App.tsx` (ruta pública)
- Test: `frontend/src/features/auth/__tests__/ForgotPasswordPage.test.tsx`

**Interfaces:**
- Consumes: `apiClient.post('/api/v1/auth/forgot-password', { email })`.
- Produces: ruta `/forgot-password` (pública) renderizando `ForgotPasswordPage`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
// frontend/src/features/auth/__tests__/ForgotPasswordPage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForgotPasswordPage from '../ForgotPasswordPage'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { post: vi.fn() },
}))
import { apiClient } from '../../../lib/apiClient'

function renderPage() {
  return render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
}

describe('ForgotPasswordPage', () => {
  it('envía el email y muestra el mensaje genérico de confirmación', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ detail: 'ok' })
    renderPage()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar enlace/i }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/auth/forgot-password', { email: 'a@b.com' },
    ))
    expect(await screen.findByText(/si el correo está registrado/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd frontend && npx vitest run src/features/auth/__tests__/ForgotPasswordPage.test.tsx`
Expected: FAIL — `ForgotPasswordPage` no existe

- [ ] **Step 3: Implementar `ForgotPasswordPage.tsx`**

```tsx
// frontend/src/features/auth/ForgotPasswordPage.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { Input } from '../../shared/ui/Input'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      await apiClient.post('/api/v1/auth/forgot-password', { email })
    } catch {
      // Respuesta genérica: no revelamos errores al usuario
    } finally {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 'clamp(24px, 5vw, 36px) clamp(20px, 5vw, 32px)', width: 'min(380px, calc(100vw - 32px))', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
        <h1 style={{ color: 'var(--fg-primary)', fontSize: 18, marginBottom: 8, textAlign: 'center' }}>Recuperar contraseña</h1>
        {sent ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center', marginTop: 16 }}>
            Si el correo está registrado, recibirás un enlace para restablecer la contraseña.
          </p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
              Introduce tu correo y te enviaremos un enlace.
            </p>
            <Input id="email" label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            <button type="submit" disabled={loading} style={{ background: loading ? 'var(--offline)' : 'var(--cmg-teal)', color: '#fff', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 14, marginTop: 8, cursor: loading ? 'not-allowed' : 'pointer', border: 'none' }}>
              {loading ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </form>
        )}
        <p style={{ marginTop: 24, fontSize: 12, textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--cmg-teal)' }}>Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Sustituir el párrafo en `LoginPage.tsx`**

Reemplazar:

```tsx
        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
          ¿Olvidaste tu contraseña? Contacta con tu administrador.
        </p>
```

por (añadir `import { Link } from 'react-router-dom'` junto al import de `useNavigate`):

```tsx
        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
          <Link to="/forgot-password" style={{ color: 'var(--cmg-teal)' }}>¿Olvidaste tu contraseña?</Link>
        </p>
```

- [ ] **Step 5: Añadir la ruta pública en `App.tsx`**

Junto a la ruta `/login` (añadir import lazy arriba con los demás):

```tsx
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage'))
```

```tsx
      <Route path="/forgot-password" element={<Suspense fallback={<Loading />}><ForgotPasswordPage /></Suspense>} />
```

- [ ] **Step 6: Ejecutar el test para verificar que pasa**

Run: `cd frontend && npx vitest run src/features/auth/__tests__/ForgotPasswordPage.test.tsx`
Expected: PASS (1 passed)

- [ ] **Step 7: Verificar tipos y commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: sin errores nuevos relacionados con estos archivos

```bash
git add frontend/src/features/auth/ForgotPasswordPage.tsx frontend/src/features/auth/LoginPage.tsx frontend/src/App.tsx frontend/src/features/auth/__tests__/ForgotPasswordPage.test.tsx
git commit -m "feat(auth): página /forgot-password y enlace en login"
```

---

### Task 7: ResetPasswordPage (frontend)

**Files:**
- Create: `frontend/src/features/auth/ResetPasswordPage.tsx`
- Modify: `frontend/src/App.tsx` (ruta pública `/reset-password/:token`)
- Test: `frontend/src/features/auth/__tests__/ResetPasswordPage.test.tsx`

**Interfaces:**
- Consumes: `apiClient.post('/api/v1/auth/reset-password', { token, new_password })`, `useParams<{ token: string }>()`, `useToast()`.
- Produces: ruta `/reset-password/:token` (pública).

- [ ] **Step 1: Escribir el test que falla**

```tsx
// frontend/src/features/auth/__tests__/ResetPasswordPage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ResetPasswordPage from '../ResetPasswordPage'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { post: vi.fn() } }))
vi.mock('../../../shared/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
import { apiClient } from '../../../lib/apiClient'

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password/${token}`]}>
      <Routes>
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResetPasswordPage', () => {
  it('no envía si las contraseñas no coinciden', async () => {
    renderAt('tok')
    fireEvent.change(screen.getByLabelText(/nueva contraseña/i), { target: { value: 'nuevapass123' } })
    fireEvent.change(screen.getByLabelText(/repetir/i), { target: { value: 'otracosa999' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('envía token y nueva contraseña cuando es válida', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ detail: 'ok' })
    renderAt('tok')
    fireEvent.change(screen.getByLabelText(/nueva contraseña/i), { target: { value: 'nuevapass123' } })
    fireEvent.change(screen.getByLabelText(/repetir/i), { target: { value: 'nuevapass123' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/auth/reset-password', { token: 'tok', new_password: 'nuevapass123' },
    ))
  })
})
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd frontend && npx vitest run src/features/auth/__tests__/ResetPasswordPage.test.tsx`
Expected: FAIL — `ResetPasswordPage` no existe

- [ ] **Step 3: Implementar `ResetPasswordPage.tsx`**

```tsx
// frontend/src/features/auth/ResetPasswordPage.tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { Input } from '../../shared/ui/Input'
import { useToast } from '../../shared/ui/Toast'

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { success } = useToast()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (password !== repeat) { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    try {
      await apiClient.post('/api/v1/auth/reset-password', { token, new_password: password })
      success('Contraseña actualizada. Inicia sesión.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 'clamp(24px, 5vw, 36px) clamp(20px, 5vw, 32px)', width: 'min(380px, calc(100vw - 32px))', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
        <h1 style={{ color: 'var(--fg-primary)', fontSize: 18, marginBottom: 16, textAlign: 'center' }}>Nueva contraseña</h1>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input id="password" label="Nueva contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus autoComplete="new-password" />
          <Input id="repeat" label="Repetir contraseña" type="password" value={repeat} onChange={e => setRepeat(e.target.value)} required autoComplete="new-password" />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -4 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ background: loading ? 'var(--offline)' : 'var(--cmg-teal)', color: '#fff', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 14, marginTop: 8, cursor: loading ? 'not-allowed' : 'pointer', border: 'none' }}>
            {loading ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Añadir la ruta pública en `App.tsx`**

```tsx
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage'))
```

```tsx
      <Route path="/reset-password/:token" element={<Suspense fallback={<Loading />}><ResetPasswordPage /></Suspense>} />
```

- [ ] **Step 5: Ejecutar el test para verificar que pasa**

Run: `cd frontend && npx vitest run src/features/auth/__tests__/ResetPasswordPage.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 6: Verificar tipos y commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: sin errores nuevos

```bash
git add frontend/src/features/auth/ResetPasswordPage.tsx frontend/src/App.tsx frontend/src/features/auth/__tests__/ResetPasswordPage.test.tsx
git commit -m "feat(auth): página /reset-password/:token"
```

---

### Task 8: Verificación integral y despliegue

**Files:** ninguno (validación)

- [ ] **Step 1: Suite backend completa de auth**

Run: `cd backend && pytest tests/test_reset_token.py tests/test_reset_mailer.py tests/test_forgot_password.py tests/test_reset_password.py -v`
Expected: PASS

- [ ] **Step 2: Suite notify**

Run: `cd services/notify && pytest tests/test_dispatcher_body.py -v`
Expected: PASS

- [ ] **Step 3: Tests frontend de auth + build**

Run: `cd frontend && npx vitest run src/features/auth && npx tsc --noEmit`
Expected: PASS y sin errores de tipos

- [ ] **Step 4: Despliegue (REQUIERE CONFIRMACIÓN DE CARLOS — producción)**

Seguir el procedimiento del proyecto (build con compose + swap con `docker run`) para los **3 servicios**: core-api, notify-svc, frontend. Ver `feedback_compose_deploy` en memoria. No hay migración Alembic.

Verificación post-deploy:
- `curl -i -X POST https://cmgtrack.com/api/v1/auth/forgot-password -H 'Content-Type: application/json' -d '{"email":"<un_email_real>"}'` → 200 + mensaje genérico; comprobar recepción del correo.
- Abrir el enlace recibido → `/reset-password/:token` → cambiar contraseña → login con la nueva.

---

## Self-Review

- **Cobertura del spec:** flujo (Tasks 4-7), almacén Redis hasheado+TTL (Task 1, 4), caducidad 1h (`_RESET_TOKEN_TTL`, Task 4), respuesta genérica (Task 4), invalidación `pwd_version` (Task 5), rate-limit (Task 4-5), email vía notify-svc con body custom (Tasks 2-3), páginas y rutas públicas (Tasks 6-7), tests (todas), despliegue 3 servicios (Task 8). ✔ Sin huecos.
- **Sin placeholders:** todo el código es literal. ✔
- **Consistencia de tipos:** `generate_reset_token`/`reset_key_for` (Task 1) usados igual en Tasks 4-5; `enqueue_reset_email(redis, email, token)` (Task 2) llamado igual en Task 4; `apiClient.post(path, body)` consistente en Tasks 6-7. ✔
