# Configuración de botones CAN en plantillas + permisos por rol — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover la configuración de slots + botones Manual CAN (FMC650 → CR2530) a las plantillas (`vehicle_type`), con permisos por rol por botón y función toggle/hold (mantener pulsado).

**Architecture:** Las definiciones de slots y botones pasan a dos campos JSONB en `vehicle_type` (heredados por todos los vehículos del tipo). El estado runtime de las salidas se guarda por vehículo en Redis (`vehicle:{id}:can_outputs`), no en BD. Los endpoints de operación resuelven la config desde la plantilla del vehículo y filtran botones por el rol del usuario. El control "hold" envía ON al pulsar y OFF al soltar; el OFF de soltar tiene prioridad y reintenta el lock del dispositivo para no quedarse colgado.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + Redis (backend); React 18 + React Query + Zustand (frontend).

**Spec:** `docs/superpowers/specs/2026-06-16-botones-can-plantillas-design.md`

---

## Referencia: estado actual (no romper)

- `vehicle_type` (`backend/app/models/vehicle_type.py`): campos JSONB `sensor_schema`, `dout_config`, `system_blocks`, etc. Patrón a imitar.
- Migración previa: `052_manual_can_buttons.py` (revision `052`). La nueva es `053`, `down_revision='052'`.
- Endpoints Manual CAN en `backend/app/api/v1/vehicles.py`:
  - `send_manual_can_command` (~1653): Arrancar/Parar por slot, lee `VehicleManualCanSlot.param_id`.
  - CRUD slots (~1891-2024) y CRUD botones (~2131-2234): se dejan de usar para definición (se mantienen en BD por seguridad, no se borran).
  - `toggle_manual_can_button` (~2237-2365): lee `slot.current_value` (BD) y bitmask.
  - Helpers `_get_slot_checked` (2070), `_current_bit` (2092), `_button_to_out` (2098).
- Frontend:
  - `VehicleDetailPage.tsx`: fetch `['manual-can-slots', id]` → `GET /vehicles/{id}/manual-can-slots`; pasa `manualCanSlots` a `ManualCanControl` (línea 465); monta `ManualCanSlotManager` (469) y `ManualCanButtonManager` (470).
  - `ManualCanControl.tsx`: panel operación. `SlotButtonsPanel` hace `GET .../can-slots/{slotId}/buttons` y `POST .../toggle`.
- Restore: el ingest **NO** restaura Manual CAN (solo DOUT vía Redis `vehicle:{id}:dout`). Mover estado a Redis no toca la lógica TCP del ingest.
- Roles: `admin | operator | viewer | driver`. `assert_can_access_vehicle(user, id, db, operation=...)` controla acceso por vehículo (driver requiere asignación activa).

## Estructura de ficheros

**Backend**
- Crear: `backend/alembic/versions/053_vehicle_type_manual_can.py` — añade `manual_can_slots`, `manual_can_buttons` JSONB a `vehicle_type`.
- Modificar: `backend/app/models/vehicle_type.py` — 2 columnas nuevas.
- Crear: `backend/app/services/manual_can_config.py` — helpers puros (resolver config desde el tipo del vehículo, cálculo de bitmask, claves/serialización de estado Redis, filtrado por rol, validación de payload). Aísla la lógica testeable sin DB.
- Modificar: `backend/app/api/v1/vehicles.py` — nuevo `PATCH /vehicle-types/{type_id}/manual-can`; reapuntar `send_manual_can_command`, `list_manual_can_slots`, `list_manual_can_buttons`, `toggle_manual_can_button` a la plantilla + estado Redis; añadir prioridad OFF en hold.
- Crear: `backend/tests/test_manual_can_config.py` — tests de los helpers puros (sin DB).

**Frontend**
- Crear: `frontend/src/features/vehicles/ManualCanConfigSection.tsx` — editor en `VehicleTypesPage`.
- Modificar: `frontend/src/features/vehicles/VehicleTypesPage.tsx` — montar la sección nueva.
- Modificar: `frontend/src/features/vehicle/ManualCanControl.tsx` — filtrar por rol + soportar `hold`.
- Modificar: `frontend/src/features/vehicle/VehicleDetailPage.tsx` — quitar imports/render de los dos managers (líneas 20-22, 469-470).
- Eliminar: `frontend/src/features/vehicle/ManualCanSlotManager.tsx`, `frontend/src/features/vehicle/ManualCanButtonManager.tsx`.

## Contratos de datos

`vehicle_type.manual_can_slots` (JSONB lista):
```json
{ "id": "uuid-str", "slot": 0, "param_id": 16002, "description": "Hidráulica" }
```
`vehicle_type.manual_can_buttons` (JSONB lista):
```json
{ "id": "uuid-str", "slot_id": "uuid-str", "byte_index": 0, "bit_index": 0,
  "label": "Bomba", "function": "toggle", "allowed_roles": ["admin","operator"],
  "sort_order": 0, "active": true }
```
Estado Redis por vehículo: hash `vehicle:{vehicle_id}:can_outputs`, campo = `str(slot_number)`, valor = hex de 16 chars (8 bytes).

---

## Task 1: Migración 053 — columnas JSONB en vehicle_type

**Files:**
- Create: `backend/alembic/versions/053_vehicle_type_manual_can.py`
- Modify: `backend/app/models/vehicle_type.py`

- [ ] **Step 1: Escribir la migración** (mirando el estilo de `052_manual_can_buttons.py`)

```python
"""vehicle_type: manual_can_slots + manual_can_buttons JSONB

Revision ID: 053
Revises: 052
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vehicle_type", sa.Column(
        "manual_can_slots", JSONB(), nullable=False, server_default="[]"))
    op.add_column("vehicle_type", sa.Column(
        "manual_can_buttons", JSONB(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("vehicle_type", "manual_can_buttons")
    op.drop_column("vehicle_type", "manual_can_slots")
```

- [ ] **Step 2: Añadir las columnas al modelo** `backend/app/models/vehicle_type.py` tras `system_blocks` (línea 20):

```python
    manual_can_slots: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]", default=list)
    manual_can_buttons: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]", default=list)
```

- [ ] **Step 3: Verificar SQL de la migración (sin aplicar)**

Run: `cd /opt/cmg-telematic1 && alembic upgrade 053 --sql | tail -20`
Expected: muestra `ALTER TABLE vehicle_type ADD COLUMN manual_can_slots ...` sin errores.

- [ ] **Step 4: NO aplicar todavía.** Aplicar `alembic upgrade head` requiere confirmación explícita de Carlos (producción). Marcar checkpoint.

---

## Task 2: Servicio de helpers puros `manual_can_config.py`

**Files:**
- Create: `backend/app/services/manual_can_config.py`
- Test: `backend/tests/test_manual_can_config.py`

- [ ] **Step 1: Escribir tests que fallan** (`backend/tests/test_manual_can_config.py`)

```python
import pytest
from app.services import manual_can_config as mc


def test_compute_bitmask_sets_and_clears_bit():
    base = bytes(8)
    on = mc.apply_bit(base, byte_index=0, bit_index=0, value=True)
    assert on.hex().upper() == "0100000000000000"
    off = mc.apply_bit(on, byte_index=0, bit_index=0, value=False)
    assert off == base


def test_current_bit_reads_bit():
    data = bytes([0b00000100, 0, 0, 0, 0, 0, 0, 0])
    assert mc.current_bit(data, 0, 2) is True
    assert mc.current_bit(data, 0, 1) is False
    assert mc.current_bit(None, 0, 0) is False


def test_role_can_press_admin_always():
    btn = {"allowed_roles": ["operator"], "function": "toggle"}
    assert mc.role_can_press(btn, "admin") is True
    assert mc.role_can_press(btn, "operator") is True
    assert mc.role_can_press(btn, "driver") is False


def test_validate_config_rejects_duplicate_bit():
    slots = [{"id": "s1", "slot": 0, "param_id": 16002, "description": "x"}]
    buttons = [
        {"id": "b1", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
         "label": "A", "function": "toggle", "allowed_roles": ["admin"],
         "sort_order": 0, "active": True},
        {"id": "b2", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
         "label": "B", "function": "toggle", "allowed_roles": ["admin"],
         "sort_order": 1, "active": True},
    ]
    with pytest.raises(ValueError):
        mc.validate_config(slots, buttons)


def test_validate_config_rejects_button_unknown_slot():
    slots = [{"id": "s1", "slot": 0, "param_id": 16002, "description": "x"}]
    buttons = [{"id": "b1", "slot_id": "sX", "byte_index": 0, "bit_index": 0,
                "label": "A", "function": "toggle", "allowed_roles": ["admin"],
                "sort_order": 0, "active": True}]
    with pytest.raises(ValueError):
        mc.validate_config(slots, buttons)
```

- [ ] **Step 2: Ejecutar y ver fallo**

Run: `cd /opt/cmg-telematic1 && pytest backend/tests/test_manual_can_config.py -x`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el servicio** (`backend/app/services/manual_can_config.py`)

```python
"""Helpers puros para la configuración Manual CAN en plantillas (vehicle_type).

La definición de slots/botones vive en vehicle_type.manual_can_slots /
.manual_can_buttons (JSONB). El estado runtime de salidas vive en Redis,
clave por vehículo. Estas funciones no tocan BD ni Redis (lógica testeable)."""
from __future__ import annotations

VALID_ROLES = {"admin", "operator", "viewer", "driver"}
VALID_FUNCTIONS = {"toggle", "hold"}


def state_key(vehicle_id) -> str:
    """Clave del hash Redis con el estado de salidas de un vehículo."""
    return f"vehicle:{vehicle_id}:can_outputs"


def apply_bit(data: bytes, byte_index: int, bit_index: int, value: bool) -> bytes:
    raw = bytearray(data if data and len(data) == 8 else bytes(8))
    if value:
        raw[byte_index] |= 1 << bit_index
    else:
        raw[byte_index] &= ~(1 << bit_index)
    return bytes(raw)


def current_bit(data: bytes | None, byte_index: int, bit_index: int) -> bool:
    if not data or len(data) <= byte_index:
        return False
    return bool(data[byte_index] & (1 << bit_index))


def role_can_press(button: dict, role: str) -> bool:
    if role == "admin":
        return True
    return role in (button.get("allowed_roles") or [])


def validate_config(slots: list[dict], buttons: list[dict]) -> None:
    """Lanza ValueError si la config es inconsistente."""
    slot_numbers = set()
    slot_ids = set()
    for s in slots:
        n = s["slot"]
        if not (0 <= n <= 9):
            raise ValueError(f"slot fuera de rango: {n}")
        if n in slot_numbers:
            raise ValueError(f"slot duplicado: {n}")
        if int(s["param_id"]) <= 0:
            raise ValueError("param_id debe ser > 0")
        slot_numbers.add(n)
        slot_ids.add(s["id"])

    seen_bits: set[tuple] = set()
    for b in buttons:
        if b["slot_id"] not in slot_ids:
            raise ValueError(f"botón referencia slot inexistente: {b['slot_id']}")
        if not (0 <= b["byte_index"] <= 7) or not (0 <= b["bit_index"] <= 7):
            raise ValueError("byte_index/bit_index fuera de rango 0-7")
        if b.get("function") not in VALID_FUNCTIONS:
            raise ValueError(f"function inválida: {b.get('function')}")
        roles = b.get("allowed_roles") or []
        if any(r not in VALID_ROLES for r in roles):
            raise ValueError("allowed_roles contiene un rol inválido")
        key = (b["slot_id"], b["byte_index"], b["bit_index"])
        if key in seen_bits:
            raise ValueError(f"bit duplicado en slot {b['slot_id']}: {key}")
        seen_bits.add(key)
```

- [ ] **Step 4: Ejecutar tests**

Run: `cd /opt/cmg-telematic1 && pytest backend/tests/test_manual_can_config.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/053_vehicle_type_manual_can.py backend/app/models/vehicle_type.py backend/app/services/manual_can_config.py backend/tests/test_manual_can_config.py
git commit -m "feat(backend): vehicle_type manual CAN config (migración 053 + helpers)"
```

---

## Task 3: Endpoint de configuración `PATCH /vehicle-types/{type_id}/manual-can`

**Files:**
- Modify: `backend/app/api/v1/vehicles.py` (junto al `PATCH /vehicle-types/{id}/sensor-schema`, ~221-243)

- [ ] **Step 1: Schemas Pydantic** (cerca de los schemas de tipo de vehículo)

```python
class ManualCanSlotCfg(BaseModel):
    id: uuid.UUID
    slot: int = Field(..., ge=0, le=9)
    param_id: int = Field(..., gt=0)
    description: str = Field("", max_length=100)


class ManualCanButtonCfg(BaseModel):
    id: uuid.UUID
    slot_id: uuid.UUID
    byte_index: int = Field(..., ge=0, le=7)
    bit_index: int = Field(..., ge=0, le=7)
    label: str = Field(..., max_length=100)
    function: Literal["toggle", "hold"] = "toggle"
    allowed_roles: list[str] = Field(default_factory=list)
    sort_order: int = Field(0, ge=0)
    active: bool = True


class ManualCanConfigIn(BaseModel):
    manual_can_slots: list[ManualCanSlotCfg]
    manual_can_buttons: list[ManualCanButtonCfg]
```

- [ ] **Step 2: Endpoint** (solo CMG admin, mismo gating que sensor-schema)

```python
@router.patch("/vehicle-types/{type_id}/manual-can", response_model=VehicleTypeOut)
async def update_vehicle_type_manual_can(
    type_id: uuid.UUID,
    body: ManualCanConfigIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Configura slots + botones Manual CAN de una plantilla. Solo CMG admin."""
    if not (user.role == "admin" and user.tenant_tier == "cmg"):
        raise HTTPException(status_code=403, detail="Solo CMG admin")
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")

    slots = [s.model_dump(mode="json") for s in body.manual_can_slots]
    buttons = [b.model_dump(mode="json") for b in body.manual_can_buttons]
    try:
        manual_can_config.validate_config(slots, buttons)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    vtype.manual_can_slots = slots
    vtype.manual_can_buttons = buttons
    flag_modified(vtype, "manual_can_slots")
    flag_modified(vtype, "manual_can_buttons")
    await db.commit()
    await db.refresh(vtype)
    return vtype
```

- [ ] **Step 3: Asegurar imports** en `vehicles.py`: `from typing import Literal`, `from app.services import manual_can_config`. Verificar que `flag_modified` y `VehicleType` ya estén importados (los usa `sensor-schema`).

- [ ] **Step 4: Añadir los 2 campos a `VehicleTypeOut`** en `backend/app/schemas/vehicle.py`:

```python
    manual_can_slots: list[dict[str, Any]] = []
    manual_can_buttons: list[dict[str, Any]] = []
```

- [ ] **Step 5: Validación de arranque (sin DB)**

Run: `cd /opt/cmg-telematic1 && python -c "import app.api.v1.vehicles"`
Expected: sin ImportError.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/vehicles.py backend/app/schemas/vehicle.py
git commit -m "feat(api): PATCH /vehicle-types/{id}/manual-can (config slots+botones, CMG admin)"
```

---

## Task 4: Reapuntar endpoints de operación a la plantilla + estado Redis

**Files:**
- Modify: `backend/app/api/v1/vehicles.py`

Helper nuevo (en `vehicles.py`) para resolver config desde el tipo del vehículo:

- [ ] **Step 1: Helper de resolución**

```python
async def _vehicle_manual_can_cfg(vehicle, db) -> tuple[list[dict], list[dict]]:
    """Devuelve (slots, buttons) de la plantilla del vehículo."""
    vtype = await db.get(VehicleType, vehicle.vehicle_type_id)
    if not vtype:
        return [], []
    return (vtype.manual_can_slots or [], vtype.manual_can_buttons or [])
```

- [ ] **Step 2: `list_manual_can_slots`** → leer de plantilla (mantener `response_model=list[ManualCanSlotOut]`; campos id/slot/description). Sustituir la query a `VehicleManualCanSlot` por:

```python
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read")
    if not vehicle.active:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    slots, _ = await _vehicle_manual_can_cfg(vehicle, db)
    out = [s for s in slots if include_inactive or True]  # plantilla no marca inactivo a nivel slot
    return [ManualCanSlotOut(id=s["id"], slot=s["slot"], param_id=s["param_id"],
                             description=s.get("description", ""), active=True)
            for s in sorted(out, key=lambda s: s["slot"])]
```

- [ ] **Step 3: `list_manual_can_buttons`** → leer de plantilla, filtrar por rol y estado Redis:

```python
@router.get("/vehicles/{vehicle_id}/can-slots/{slot_id}/buttons",
            response_model=list[ManualCanButtonOut])
async def list_manual_can_buttons(vehicle_id, slot_id, request: Request,
                                   user=Depends(get_current_user), db=Depends(get_db)):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="read")
    slots, buttons = await _vehicle_manual_can_cfg(vehicle, db)
    slot = next((s for s in slots if str(s["id"]) == str(slot_id)), None)
    if not slot:
        raise HTTPException(status_code=404, detail="Slot no encontrado")
    redis = request.app.state.redis
    raw_hex = await redis.hget(manual_can_config.state_key(vehicle_id), str(slot["slot"]))
    state = bytes.fromhex(raw_hex) if raw_hex else None
    visible = [b for b in buttons
               if str(b["slot_id"]) == str(slot_id) and b.get("active", True)
               and manual_can_config.role_can_press(b, user.role)]
    visible.sort(key=lambda b: (b.get("sort_order", 0), b["byte_index"], b["bit_index"]))
    return [ManualCanButtonOut(
        id=b["id"], slot_id=b["slot_id"], label=b["label"],
        byte_index=b["byte_index"], bit_index=b["bit_index"],
        active=b.get("active", True), sort_order=b.get("sort_order", 0),
        current_bit=manual_can_config.current_bit(state, b["byte_index"], b["bit_index"]),
    ) for b in visible]
```
Nota: añadir `function: str` a `ManualCanButtonOut` para que el frontend distinga toggle/hold.

- [ ] **Step 4: `send_manual_can_command`** → resolver `param_id` desde la plantilla en vez de `VehicleManualCanSlot`:

```python
    slots, _ = await _vehicle_manual_can_cfg(vehicle, db)
    slot_config = next((s for s in slots if s["slot"] == body.slot), None)
    if not slot_config:
        raise HTTPException(status_code=404, detail=f"Manual CAN no configurado para slot {body.slot}")
    param_id = slot_config["param_id"]
```

- [ ] **Step 5: Validación de arranque**

Run: `cd /opt/cmg-telematic1 && python -c "import app.api.v1.vehicles"`
Expected: sin error.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/vehicles.py
git commit -m "feat(api): operación Manual CAN lee config de plantilla + estado Redis"
```

---

## Task 5: Reescribir `toggle_manual_can_button` (plantilla + Redis + hold OFF prioritario)

**Files:**
- Modify: `backend/app/api/v1/vehicles.py` (función `toggle_manual_can_button`)

- [ ] **Step 1: Añadir `priority` opcional al body**

```python
class ManualCanButtonToggleIn(BaseModel):
    value: bool | None = None   # None=toggle; True/False=fijo (hold envía explícito)
```
(La prioridad se deduce: botón `hold` + `value is False` ⇒ OFF de soltar prioritario.)

- [ ] **Step 2: Reescritura** (lee botón/slot de plantilla, estado de Redis, permiso por rol, lock con reintento en OFF-hold)

```python
@router.post("/vehicles/{vehicle_id}/can-slots/{slot_id}/buttons/{button_id}/toggle",
             response_model=ManualCanButtonToggleResponse)
async def toggle_manual_can_button(vehicle_id, slot_id, button_id,
                                   body: ManualCanButtonToggleIn, request: Request,
                                   user=Depends(get_current_user), db=Depends(get_db)):
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="write")
    slots, buttons = await _vehicle_manual_can_cfg(vehicle, db)
    slot = next((s for s in slots if str(s["id"]) == str(slot_id)), None)
    btn = next((b for b in buttons if str(b["id"]) == str(button_id)
                and str(b["slot_id"]) == str(slot_id) and b.get("active", True)), None)
    if not slot or not btn:
        raise HTTPException(status_code=404, detail="Botón no encontrado o inactivo")
    if not manual_can_config.role_can_press(btn, user.role):
        raise HTTPException(status_code=403, detail="Tu rol no puede accionar este botón")

    device = (await db.execute(select(Device).where(
        Device.vehicle_id == vehicle_id, Device.active == True))).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="No hay dispositivo activo vinculado al vehículo")
    imei = device.imei
    redis = request.app.state.redis
    if not await redis.exists(f"ingest:conn:{imei}"):
        raise HTTPException(status_code=503, detail="El FMC no está conectado en este momento.")

    is_hold_off = btn.get("function") == "hold" and body.value is False
    pending_key = f"command:{imei}:pending_response"
    acquired = await redis.set(pending_key, "", nx=True, ex=25)
    if not acquired and is_hold_off:
        # OFF de soltar tiene prioridad: reintenta hasta ~20s para no dejar la salida colgada
        for _ in range(40):
            await asyncio.sleep(0.5)
            acquired = await redis.set(pending_key, "", nx=True, ex=25)
            if acquired:
                break
    if not acquired:
        raise HTTPException(status_code=409, detail="Ya hay un comando en vuelo para este dispositivo")

    try:
        state_k = manual_can_config.state_key(vehicle_id)
        raw_hex = await redis.hget(state_k, str(slot["slot"]))
        raw = bytes.fromhex(raw_hex) if raw_hex else bytes(8)
        cur = manual_can_config.current_bit(raw, btn["byte_index"], btn["bit_index"])
        new_state = (not cur) if body.value is None else body.value
        new_bytes = manual_can_config.apply_bit(raw, btn["byte_index"], btn["bit_index"], new_state)
        value_hex = new_bytes.hex().upper()
        command_sent = f"setparam {slot['param_id']}:{value_hex}"

        now = datetime.now(timezone.utc)
        log_id = uuid.uuid4()
        db.add(CommandLog(id=log_id, device_id=device.id, vehicle_id=vehicle_id,
                          tenant_id=vehicle.tenant_id, user_id=user.user_id,
                          command=command_sent, command_type="MANUAL_CAN", status="pending",
                          param_id=slot["param_id"], param_value=value_hex,
                          imei_snapshot=imei, sent_at=now))
        log = (await db.execute(select(CommandLog).where(CommandLog.id == log_id))).scalar_one()
        await redis.publish("cmg:manual_can_commands",
                            json.dumps({"imei": imei, "command": command_sent, "log_id": str(log_id)}))
        resp = await redis.blpop(f"command:{imei}:response", timeout=18)
        if resp is None:
            log.status = "timeout"; log.response_at = datetime.now(timezone.utc)
            await db.commit()
            raise HTTPException(status_code=504, detail="El FMC no respondió en 18 segundos")
        _, fmc_response = resp
        if fmc_response == "DISCONNECTED":
            log.status = "disconnected"; log.response_at = datetime.now(timezone.utc)
            await db.commit()
            raise HTTPException(status_code=503, detail="FMC desconectado")
        nr = datetime.now(timezone.utc)
        log.status = "confirmed"; log.response = fmc_response; log.response_at = nr
        log.latency_ms = int((nr - now).total_seconds() * 1000)
        await db.commit()
        # estado solo tras ack OK
        await redis.hset(state_k, str(slot["slot"]), value_hex)
        return ManualCanButtonToggleResponse(button_id=button_id, label=btn["label"],
                                             new_value=new_state, current_value=value_hex)
    finally:
        await redis.delete(pending_key)
```

- [ ] **Step 3: Verificar import de `asyncio`** en `vehicles.py` (añadir `import asyncio` si falta).

- [ ] **Step 4: Validación de arranque**

Run: `cd /opt/cmg-telematic1 && python -c "import app.api.v1.vehicles"`
Expected: sin error.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/vehicles.py
git commit -m "feat(api): toggle Manual CAN sobre plantilla + estado Redis + OFF hold prioritario"
```

---

## Task 6: Frontend — sección de configuración en plantillas

**Files:**
- Create: `frontend/src/features/vehicles/ManualCanConfigSection.tsx`
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- [ ] **Step 1:** Crear `ManualCanConfigSection.tsx` siguiendo el estilo de `DoutConfigSection`: recibe `vehicleType` (con `id`, `manual_can_slots`, `manual_can_buttons`); estado local editable; tabla de slots (slot 0-9, param_id, descripción) y tabla de botones (label, slot select, byte 0-7, bit 0-7, función toggle/hold, checkboxes de roles admin/operator/driver, orden, activo); botón Guardar → `PATCH /api/v1/vehicle-types/{id}/manual-can` con `{ manual_can_slots, manual_can_buttons }`; genera `id` con `crypto.randomUUID()` para filas nuevas; invalida `['vehicle-types']`. TypeScript estricto (interfaces `McSlot`, `McButton`).

- [ ] **Step 2:** Montar la sección en `VehicleTypesPage.tsx` junto a las demás secciones del tipo seleccionado: `<ManualCanConfigSection vehicleType={selectedType} />`.

- [ ] **Step 3: Validación build**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc --noEmit`
Expected: sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/vehicles/ManualCanConfigSection.tsx frontend/src/features/vehicles/VehicleTypesPage.tsx
git commit -m "feat(frontend): editor de botones CAN en plantillas (/tipos-vehiculo)"
```

---

## Task 7: Frontend — operación con rol + hold; quitar managers de la ficha

**Files:**
- Modify: `frontend/src/features/vehicle/ManualCanControl.tsx`
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`
- Delete: `frontend/src/features/vehicle/ManualCanSlotManager.tsx`, `ManualCanButtonManager.tsx`

- [ ] **Step 1:** En `ManualCanControl.tsx`, extender `CanButton` con `function: 'toggle' | 'hold'`. Para `toggle`, mantener `onClick → POST toggle {}`. Para `hold`, sustituir el handler por press/release:
  - `onPointerDown` / `onTouchStart` → `POST toggle { value: true }` (deshabilita re-press hasta ack).
  - `onPointerUp` / `onPointerLeave` / `onTouchEnd` → `POST toggle { value: false }`.
  - OFF de seguridad también en `useEffect` cleanup (desmontaje) y en `visibilitychange`/`blur` si el botón quedó pulsado.
  El backend ya filtra por rol, así que el panel solo muestra lo que devuelve `GET .../buttons` (no requiere leer el rol, pero puede usar `useAuthStore` para deshabilitar si `viewer`).

- [ ] **Step 2:** En `VehicleDetailPage.tsx`: borrar imports líneas 21-22 y el render líneas 469-470 (`ManualCanSlotManager`, `ManualCanButtonManager`). Mantener `ManualCanControl` (465) y el fetch de slots (159-160).

- [ ] **Step 3:** Borrar los dos ficheros de managers.

Run: `git rm frontend/src/features/vehicle/ManualCanSlotManager.tsx frontend/src/features/vehicle/ManualCanButtonManager.tsx`

- [ ] **Step 4: Validación build**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc --noEmit && npm run build`
Expected: build OK, sin referencias a los ficheros borrados.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/features/vehicle/
git commit -m "feat(frontend): operación CAN con rol+hold; config solo en plantillas"
```

---

## Task 8: Despliegue (requiere confirmación de Carlos — producción)

- [ ] **Step 1:** Confirmar con Carlos antes de aplicar migración y desplegar.
- [ ] **Step 2:** Aplicar migración 053:

Run: `cd /opt/cmg-telematic1 && alembic upgrade head` (CONFIRMAR ANTES)
Expected: `Running upgrade 052 -> 053`.

- [ ] **Step 3:** Rebuild + deploy core-api (con `--env-file`, volumen uploads, `--network-alias core-api`) según §DEPLOY de CLAUDE.md.
- [ ] **Step 4:** Rebuild + deploy frontend según §DEPLOY (build → stop+rm → run).
- [ ] **Step 5: Validación post-deploy**

Run: `docker compose logs core-api --tail 100 | grep -i error`
Expected: sin errores nuevos.
Smoke: como CMG admin, configurar un slot+botón en `/tipos-vehiculo`; en la ficha de un vehículo de ese tipo, verificar que el botón aparece y acciona (toggle y hold).

---

## Notas / decisiones diferidas
- Las tablas `vehicle_manual_can_slot` y `manual_can_button` quedan en BD sin uso (no se borran en este plan).
- Restore-on-reconnect de Manual CAN: fuera de alcance (hoy ni siquiera existe; el estado Redis lo habilitaría en el futuro sin tocar definiciones).
- `viewer` nunca acciona; `driver` solo si el botón lo permite Y tiene asignación activa al vehículo (lo garantiza `assert_can_access_vehicle`).
