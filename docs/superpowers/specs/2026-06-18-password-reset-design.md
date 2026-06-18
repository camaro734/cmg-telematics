# Diseño — Recuperación de contraseña por email

**Fecha:** 2026-06-18
**Autor:** Carlos (CMG) + Claude
**Estado:** Aprobado el diseño en conversación; pendiente de revisión del spec.

## Objetivo

Permitir que un usuario que ha olvidado su contraseña la recupere sin intervención
de un administrador: desde la página de login solicita un enlace de recuperación a
su correo, y mediante ese enlace establece una nueva contraseña.

## Contexto del sistema (ya existente, se reutiliza)

- **Auth:** `backend/app/api/v1/auth.py` (login, refresh, logout). Hash bcrypt en
  `backend/app/core/security.py` (`hash_password`, `verify_password`).
- **Modelo User:** `backend/app/models/user.py` — `email` único e indexado,
  `hashed_password`, `active: bool`, y **`pwd_version: int`** (ya embebido en el JWT;
  incrementarlo invalida todos los tokens del usuario).
- **Rate-limit:** patrón `_check_login_rate_limit` en `auth.py`
  (clave Redis `ratelimit:login:{ip}`, ventana 900 s).
- **SMTP / email:** configuración en tabla `system_settings` key `"smtp"`
  (`backend/app/api/v1/settings_smtp.py`, UI en `frontend/src/features/settings/SmtpSection.tsx`,
  solo CMG admin). **notify-svc** (`services/notify/src/dispatcher.py`) es el único
  emisor de correo: lee la config SMTP de la BD y envía. Se le encola trabajo vía
  Redis stream (`STREAM_KEY`), como hace `backend/app/core/maintenance_notifier.py`.
- **Rutas públicas frontend:** ya existe el patrón `/portal/:token` sin `RequireAuth`.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Almacén del token | **Redis con TTL** | Efímero, auto-expira, sin migración en producción |
| Caducidad del enlace | **1 hora** (3600 s) | Estándar de la industria |
| Respuesta si el email no existe | **Mensaje genérico** | Anti-enumeración de usuarios |
| Invalidación de sesiones | **Incrementar `pwd_version`** | Mecanismo ya existente; invalida todos los tokens |
| Emisor del correo | **Extender notify-svc** (`body` personalizado) | No duplicar SMTP; notify-svc sigue siendo único emisor |

## Flujo

```
[/login] enlace "¿Olvidaste tu contraseña?"
   → [/forgot-password] el usuario escribe su correo
   → POST /auth/forgot-password { email }
        Backend: si existe usuario activo con ese email:
          - token = secrets.token_urlsafe(32)
          - Redis SET pwreset:<sha256(token)> = user_id, EX 3600
          - encola email a notify-svc con enlace https://cmgtrack.com/reset-password/<token>
        Responde SIEMPRE 200 con mensaje genérico (exista o no el email)
   → usuario recibe correo, pulsa el enlace
   → [/reset-password/:token] escribe nueva contraseña (x2)
   → POST /auth/reset-password { token, new_password }
        Backend: sha256(token) → busca en Redis
          - si no existe/caducado → 400 "enlace inválido o caducado"
          - si existe: valida new_password, user.hashed_password = hash_password(...),
            user.pwd_version += 1, borra la clave Redis (single-use)
        Responde 200
   → frontend redirige a [/login] con aviso "Contraseña actualizada"
```

## Componentes

### Backend

**`backend/app/api/v1/auth.py`** — 2 endpoints públicos nuevos:

- `POST /auth/forgot-password`, body `{ email: str }`:
  - Rate-limit por IP (`ratelimit:pwreset:ip:{ip}`) y por email (`ratelimit:pwreset:email:{email}`),
    reusando el patrón de `_check_login_rate_limit`.
  - `SELECT User WHERE email = :email AND active = True`.
  - Si existe: genera token, guarda `pwreset:<sha256(token)>` → `str(user.id)` con `EX 3600`,
    y encola el email (ver helper abajo).
  - **Siempre** `200 {"detail": "Si el correo está registrado, recibirás un enlace para restablecer la contraseña."}`.

- `POST /auth/reset-password`, body `{ token: str, new_password: str }`:
  - Rate-limit por IP.
  - `key = "pwreset:" + sha256(token)`; `user_id = await redis.get(key)`.
  - Si no hay → `400 "El enlace no es válido o ha caducado."`.
  - Valida `new_password` (misma política que el alta de usuarios; si no hay, mínimo 8 caracteres) → Pydantic.
  - `user.hashed_password = hash_password(new_password)`; `user.pwd_version += 1`; `await db.commit()`.
  - `await redis.delete(key)` (single-use).
  - `200 {"detail": "Contraseña actualizada."}`.

**Helper de envío** (en `auth.py` o un módulo `app/core/mailer.py`): encola en el
Redis stream de notify-svc un mensaje con
`actions=[{"type": "email", "recipients": [email], "subject": "...", "body": "..."}]`
y un `context` mínimo. El `body` contiene el enlace de recuperación.

**Schemas** (`backend/app/schemas/auth.py`): `ForgotPasswordRequest { email: EmailStr }`,
`ResetPasswordRequest { token: str, new_password: str (min_length) }`.

### notify-svc

**`services/notify/src/dispatcher.py`** — `_send_email`: si `action.get("body")` está
presente, usar ese cuerpo en lugar del template de alerta hardcodeado (líneas 96-103).
Cambio aditivo y retrocompatible (las alertas existentes no pasan `body`).

### Frontend

- **`frontend/src/features/auth/LoginPage.tsx`**: enlace "¿Olvidaste tu contraseña?" → `/forgot-password`.
- **`ForgotPasswordPage`** (`/forgot-password`): campo email + submit. Tras enviar,
  muestra el mensaje genérico de confirmación. Enlace "volver a login".
- **`ResetPasswordPage`** (`/reset-password/:token`): dos campos (nueva contraseña + repetir),
  validación de coincidencia y longitud mínima. Al éxito, redirige a `/login` con aviso.
- **`App.tsx`**: ambas rutas **fuera de `RequireAuth`** (patrón `/portal/:token`).
- **`apiClient`**: dos funciones nuevas (`forgotPassword`, `resetPassword`).

## Seguridad

- Token guardado **hasheado** (sha256) en Redis — leer Redis no revela tokens usables.
- **Single-use**: la clave se borra al consumirla.
- **TTL 1 h**: caduca solo.
- **Respuesta genérica** en forgot-password: no revela qué correos existen.
- **Rate-limiting** por IP y por email en forgot; por IP en reset.
- **`pwd_version += 1`**: invalida todas las sesiones activas tras el cambio.
- Solo usuarios `active = True` reciben enlace.

## Testing

**Backend (`pytest`):**
- forgot con email existente activo → 200 + token en Redis + email encolado.
- forgot con email inexistente → 200 mismo mensaje, sin token, sin email.
- forgot con email de usuario inactivo → 200 mismo mensaje, sin token.
- reset con token válido → 200, contraseña cambiada, `pwd_version` incrementado, clave borrada.
- reset con token caducado/inexistente → 400.
- reset con token ya usado (segunda vez) → 400.
- rate-limit forgot supera el umbral → 429.

**Frontend:**
- Render de `ForgotPasswordPage` y `ResetPasswordPage`.
- Validación: contraseñas no coinciden / demasiado corta → error, no se envía.

## Fuera de alcance (YAGNI)

- Preguntas de seguridad, 2FA, recuperación por SMS.
- Histórico/auditoría de solicitudes de reset (se eligió Redis efímero, no tabla).
- Auto-login tras el reset (el usuario vuelve a `/login` e inicia sesión).

## Despliegue

Toca **3 servicios**: core-api (endpoints), notify-svc (cuerpo de email),
frontend (páginas). Sin migración Alembic. Seguir el procedimiento de deploy del
proyecto (build con compose + swap con `docker run`).
