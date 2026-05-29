# Spec: Configuración SMTP desde la UI de administrador

**Fecha:** 2026-05-29
**Estado:** Aprobado
**Sub-proyecto:** B (full stack: backend + notify-svc + frontend)

---

## 1. Objetivo

Permitir al administrador CMG configurar el servidor SMTP desde la interfaz web, sin tocar el `.env`. El `notify-svc` usa esa configuración para enviar emails de alerta.

---

## 2. Backend — migración y modelo

### Migración 032: tabla `system_settings`

```sql
CREATE TABLE system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Fila de SMTP:**
```json
{
  "key": "smtp",
  "value": {
    "host": "",
    "port": 587,
    "user": "",
    "password": "",
    "from": "alertas@cmg.es",
    "tls": true
  }
}
```

La contraseña se almacena en texto plano en la BD (campo sensible, solo accesible para tier=cmg admin). No requiere cifrado adicional para MVP.

### Modelo SQLAlchemy

```python
# backend/app/models/system_settings.py
class SystemSettings(Base):
    __tablename__ = "system_settings"
    key:        Mapped[str]  = mapped_column(Text(), primary_key=True)
    value:      Mapped[dict] = mapped_column(JSONB(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                  server_default=func.now(),
                                                  onupdate=func.now())
```

---

## 3. Backend — endpoints

### `GET /api/v1/settings/smtp`

- Solo tier=cmg, role=admin
- Devuelve la configuración SMTP **sin la contraseña** (campo `password` omitido o `"••••••"` si existe)
- Si no hay fila en `system_settings`, devuelve los valores por defecto vacíos

**Response schema:**
```python
class SmtpConfig(BaseModel):
    host: str = ""
    port: int = 587
    user: str = ""
    password_set: bool = False   # indica si hay contraseña guardada, sin exponerla
    from_addr: str = "alertas@cmg.es"
    tls: bool = True
```

### `PUT /api/v1/settings/smtp`

- Solo tier=cmg, role=admin
- Acepta el body completo. Si `password` llega vacío (`""`), NO sobreescribe la contraseña existente.
- Upsert en `system_settings` (INSERT ... ON CONFLICT DO UPDATE)

**Request schema:**
```python
class SmtpConfigUpdate(BaseModel):
    host: str
    port: int = 587
    user: str = ""
    password: str = ""    # vacío = mantener contraseña actual
    from_addr: str = "alertas@cmg.es"
    tls: bool = True
```

### `POST /api/v1/settings/smtp/test`

- Solo tier=cmg, role=admin
- Body: `{ "to": "email@destino.com" }`
- Lee la config SMTP de `system_settings` (o env como fallback)
- Envía un email de prueba usando `smtplib` directamente desde core-api (sin pasar por notify-svc)
- Devuelve `{ "ok": true }` o `{ "ok": false, "error": "mensaje SMTP" }`

---

## 4. notify-svc — lectura de SMTP desde BD

**Archivo:** `services/notify/src/dispatcher.py`

Al iniciar, `notify-svc` obtiene la config SMTP:
1. Intenta leer de `system_settings` donde `key = 'smtp'`
2. Si falla o está vacío, cae a las variables de entorno (`settings.smtp_host`, etc.) — compatibilidad retroactiva
3. La config se cachea en memoria con TTL de 5 minutos. Se recarga en la siguiente alerta cuando el TTL ha expirado (equilibrio entre rendimiento y reactividad a cambios)

```python
async def get_smtp_config(db) -> dict:
    """Lee SMTP de system_settings, fallback a env vars."""
    result = await db.execute(
        select(SystemSettings).where(SystemSettings.key == "smtp")
    )
    row = result.scalar_one_or_none()
    if row and row.value.get("host"):
        return row.value
    # fallback a .env
    return {
        "host": settings.smtp_host,
        "port": settings.smtp_port,
        "user": settings.smtp_user,
        "password": settings.smtp_password,
        "from": settings.smtp_from,
        "tls": True,
    }
```

---

## 5. Frontend — sección SMTP en SettingsPage

**Archivo:** `frontend/src/features/settings/SettingsPage.tsx`

Nueva sección "Correo (SMTP)" visible solo si `user?.tenant_tier === 'cmg' && user?.role === 'admin'`.

### Layout de la sección

```
CORREO (SMTP)
Configura el servidor de correo para el envío de alertas por email.

Servidor SMTP          [                    ]  Puerto  [ 587 ]
Usuario                [                    ]  Contraseña  [••••••    ] [ver/ocultar]
Dirección remitente    [alertas@cmg.es      ]
[✓] Activar STARTTLS

Si usas Gmail: smtp.gmail.com · puerto 587 · contraseña de aplicación (no la de tu cuenta)
Si usas Outlook/Office365: smtp.office365.com · puerto 587

[ Enviar email de prueba ]    → input email destino + botón Enviar
                               → muestra ✓ Enviado o ✗ Error: [mensaje SMTP]

                                                   [ Guardar cambios ]
```

### Notas de implementación

- Al cargar la sección, `GET /api/v1/settings/smtp` → poblar campos (sin contraseña)
- El campo Contraseña muestra `••••••••` si `password_set=true`. Si el usuario lo deja en blanco al guardar, no se sobreescribe.
- Toggle "ver/ocultar" contraseña (input type password ↔ text)
- "Enviar email de prueba" primero guarda la configuración actual, luego llama a `POST /api/v1/settings/smtp/test`
- Toast de éxito/error tras guardar y tras prueba

---

## 6. Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| `alembic/versions/032_system_settings.py` | Nueva migración |
| `backend/app/models/system_settings.py` | Nuevo modelo |
| `backend/app/models/__init__.py` | Importar SystemSettings |
| `backend/app/api/v1/settings_smtp.py` | Nuevo router con 3 endpoints |
| `backend/app/api/v1/__init__.py` o `main.py` | Registrar router |
| `services/notify/src/dispatcher.py` | Leer SMTP de BD |
| `frontend/src/features/settings/SettingsPage.tsx` | Nueva sección SMTP |
| `frontend/src/lib/types.ts` | Tipo `SmtpConfig` |
| `frontend/src/lib/queryKeys.ts` | Key `settings.smtp` |

---

## 7. Qué NO cambia

- Variables de entorno SMTP en `.env` — se mantienen como fallback
- `notify-svc` no se reinicia para leer el nuevo config (lo lee en cada alerta)
- El resto de SettingsPage (usuarios, notificaciones, ciclos) — sin cambios
- Ningún cambio en el protocolo de envío (sigue siendo smtplib STARTTLS)
