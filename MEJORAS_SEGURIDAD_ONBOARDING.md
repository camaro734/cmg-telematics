# Mejoras Seguridad + Onboarding — Resumen de implementación

Fecha: 2026-04-30

---

## MEJORA 1 — Rate limiting en login (5 intentos / 15 minutos)

**Archivos modificados:** `backend/app/api/v1/auth.py`

### Cambios
- `_LOGIN_MAX_ATTEMPTS` reducido de 10 → **5**
- `_LOGIN_WINDOW_SECONDS` ampliado de 60s → **900s (15 minutos)**
- La respuesta 429 incluye:
  - Mensaje legible con los minutos exactos restantes: *"Demasiados intentos. Inténtalo de nuevo en X minutos."*
  - Header `Retry-After` con los segundos exactos obtenidos del TTL real en Redis (más preciso que un valor fijo)
- Implementación: Redis manual con `INCR` + `EXPIRE` (funciona en entornos multi-instancia, a diferencia de slowapi que es en memoria por proceso)

> **Nota sobre slowapi:** No se añadió como dependencia porque ya existe una implementación Redis equivalente y superior. Añadir slowapi violaría la regla del proyecto "Nunca añadir dependencias sin justificación".

---

## MEJORA 2 — Revocación de refresh tokens (blacklist JTI en Redis)

**Archivos modificados:**
- `backend/app/core/security.py`
- `backend/app/schemas/auth.py`
- `backend/app/api/v1/auth.py`

### Cambios en security.py
- `create_refresh_token()` ahora incluye `"jti": str(uuid4())` en el payload
- Import añadido: `import uuid as _uuid_lib`

### Cambios en schemas/auth.py
- Añadido schema `LogoutRequest(BaseModel)` con campo `refresh_token: str`

### Cambios en auth.py

**Nuevo endpoint `POST /auth/logout`:**
- Recibe el refresh token en el body
- Decodifica el token (tolerante a fallos — retorna 204 silenciosamente si el token ya expiró)
- Extrae el `jti` y el `exp`
- Calcula TTL = `exp - now()` y persiste `auth:revoked:{jti}` en Redis con ese TTL
- El JTI se auto-expira de Redis cuando el token original habría caducado (sin acumulación de basura)

**Endpoint `POST /auth/refresh` actualizado:**
- Ahora acepta `request: Request` para acceder a Redis
- Llama a `_check_jti_revoked(request, jti)` antes de emitir nuevo token
- Si el JTI está en la blacklist → respuesta 401 "Token revocado"

**Helper `_check_jti_revoked(request, jti)`:**
- Comprueba `EXISTS auth:revoked:{jti}` en Redis
- No-op si Redis no está disponible (graceful degradation)

**Scope de revocación:** Solo refresh tokens (como se requería). Los access tokens no se revocan — su TTL corto de 15-60 min hace innecesario este mecanismo.

---

## MEJORA 3 — Wizard de onboarding post-creación de cliente

**Archivos modificados:** `frontend/src/features/clientes/TenantFormPage.tsx`

### Comportamiento
- Al crear un nuevo tenant (no en edición), en lugar de navegar a `/clientes`, aparece un **modal wizard** de 3 pasos
- El wizard **no aparece** en modo edición (comportamiento sin cambios)

### Diseño del wizard
- Modal con overlay oscuro + blur
- Barra de progreso visual (3 segmentos coloreados según el paso actual)
- Cada paso muestra: icono, número, título, descripción y botón CTA

### Pasos del wizard

| Paso | Título | Destino |
|------|--------|---------|
| 1 | Configura la plantilla de vehículo | `/tipos-vehiculo` |
| 2 | Añade el primer vehículo | `/vehiculos` |
| 3 | Conecta el dispositivo GPS | `/devices` |

### Navegación
- **"Ir a [página]"** (naranja): cierra el wizard y navega al destino del paso
- **"Siguiente" / "Finalizar"**: avanza sin navegar (salta el paso actual)
- **"Configurar más tarde"** (enlace discreto): cierra el wizard y navega a `/clientes`

### Estilo
- Tokens CSS del sistema: `--bg-surface`, `--bg-elevated`, `--bg-border`, `--accent-energy`, `--text-primary`, `--text-muted`
- Consistente con el resto de modales de la app (BrandTokensEditor, UserFormModal)
- Sin dependencias externas adicionales

---

## Verificación

```
Backend (Python syntax):
  OK  app/api/v1/auth.py
  OK  app/core/security.py
  OK  app/schemas/auth.py
  OK  app/main.py

Frontend TypeScript:
  npx tsc --noEmit → exit 0 (sin errores)
  
  (El error EACCES en npm run build es de permisos en dist/ construida como root
   previamente — no es un error de código)
```
