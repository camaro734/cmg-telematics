# Manual CAN — Entrega Diferida y Limpieza de UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el FMC650 está offline, encolar los comandos Manual CAN y entregarlos al reconectar; convertir los botones momentáneos (`hold`) en un reset confirmado por modal (pulso ON+OFF); limpiar la UI (historial solo-admin, quitar aviso rojo FMC y la pestaña vieja).

**Architecture:** El endpoint `toggle_manual_can_button` deja de devolver `503` cuando no hay conexión TCP viva: persiste el comando en un hash Redis `vehicle:{id}:manual_can_pending` y devuelve `202`. El ingest, al reconectar (en `_handshake`, junto a `_restore_dout_state`), añade `_restore_manual_can_state()` que reproduce los comandos pendientes, actualiza el estado de salidas en Redis y confirma el `CommandLog` vía el wrapper HTTP interno `_confirm_command`. El frontend deja de depender del flag `connected`.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), asyncio + asyncpg + redis.asyncio (ingest), React 18 + React Query + Zustand (frontend). Tests: pytest (backend/ingest).

## Global Constraints

- Producción sin staging: NO ejecutar migraciones ni reinicios sin confirmación. Este plan **no requiere migración** (`CommandLog.status` es `String(20)` libre).
- Comentarios en español, código en inglés. Type hints en toda función pública (Python), TypeScript estricto (sin `any`).
- No tocar protocolo Codec 8/8E/12. `build_codec12_command` ya existe y se reutiliza.
- No usar threading — todo async/await. Redis con `pipeline()` donde haya varias ops.
- Multi-tenant: el endpoint ya valida con `assert_can_access_vehicle(...)` y `role_can_press`; no se altera.
- Deploy (cuando proceda, fuera de este plan) según CLAUDE.md: frontend con rebuild manual, core-api e ingest con sus flags.

## Estructura de ficheros

- Modify: `backend/app/api/v1/vehicles.py` — schema `ManualCanButtonToggleIn` (campo `pulse`); refactor de `toggle_manual_can_button` (helper `_send_manual_can_once` + rama de encolado + modo pulse).
- Modify: `services/ingest/src/server.py` — `_restore_manual_can_state()` + llamada en `_handshake`.
- Modify: `frontend/src/features/vehicle/ManualCanControl.tsx` — quitar `fmc-status`/badge, botones siempre activos, hold→modal+pulse, badge encolado/enviado, historial solo-admin.
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx` — quitar panel "Historial de comandos e incidencias".
- Test: `backend/tests/api/test_manual_can_deferred.py` (nuevo).
- Test: `services/ingest/tests/test_restore_manual_can.py` (nuevo).

**Clave Redis pendientes** `vehicle:{vehicle_id}:manual_can_pending` (Hash):
- campo = `param_id` (str); valor = JSON:
  `{"type": "set"|"pulse", "commands": ["setparam P:HEX", ...], "log_id": "<uuid>", "slot": <int>, "value_hex": "<hex final>"}`
- `set`: `commands=["setparam P:value_hex"]`, `value_hex`=estado resultante.
- `pulse`: `commands=["setparam P:ON_HEX","setparam P:OFF_HEX"]`, `value_hex`=OFF_HEX (estado final = bit a 0).
- Repetir presses sobre el mismo `param_id` sobrescribe el campo (gana el último). Sin TTL.

---

### Task 1: Backend — Encolar comando `set` (toggle) cuando el FMC está offline

**Files:**
- Modify: `backend/app/api/v1/vehicles.py` — `ManualCanButtonToggleIn` (~2156), `ManualCanButtonToggleResponse` (~2160), `toggle_manual_can_button` (2367-2512)
- Test: `backend/tests/api/test_manual_can_deferred.py` (crear)

**Interfaces:**
- Consumes: `manual_can_config.state_key`, `.current_bit`, `.apply_bit`, `.role_can_press`; `_vehicle_manual_can_cfg(vehicle, db)`; `CommandLog`; `assert_can_access_vehicle`.
- Produces:
  - `ManualCanButtonToggleIn { value: bool | None, pulse: bool = False }`
  - `ManualCanButtonToggleResponse { button_id, label, new_value, current_value, queued: bool = False }`
  - Hash Redis `vehicle:{vehicle_id}:manual_can_pending`, campo=`str(param_id)`, valor=JSON descrito arriba.
  - Helper `async def _send_manual_can_once(redis, db, *, imei, command, param_id, value_hex, vehicle, device, user, sent_at) -> CommandLog` (publica + BLPOP 18s + interpreta + commit; lanza `HTTPException` en timeout/disconnected/failed; el caller posee el lock).

- [ ] **Step 1: Escribir el test que falla — offline encola y devuelve 202**

Crear `backend/tests/api/test_manual_can_deferred.py`:

```python
"""TDD — Manual CAN entrega diferida (encolado cuando el FMC está offline)."""
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

TENANT_A = uuid.UUID("ce200000-0000-0000-0000-000000000001")
VEHICLE_A = uuid.UUID("ce400000-0000-0000-0000-000000000001")
DEVICE_A = uuid.UUID("ce500000-0000-0000-0000-000000000001")
SLOT_A = uuid.UUID("ce600000-0000-0000-0000-000000000001")
BUTTON_A = uuid.UUID("ce700000-0000-0000-0000-000000000001")
IMEI = "862272089079729"
PARAM_ID = 31412

ADMIN_A = CurrentUser(user_id=uuid.uuid4(), tenant_id=TENANT_A, tenant_tier="client",
                      role="admin", email="admin@a.com")


class _MockVehicle:
    id = VEHICLE_A
    tenant_id = TENANT_A
    active = True


class _MockDevice:
    id = DEVICE_A
    vehicle_id = VEHICLE_A
    imei = IMEI
    active = True


SLOTS = [{"id": str(SLOT_A), "slot": 0, "param_id": PARAM_ID}]
BUTTONS = [{"id": str(BUTTON_A), "slot_id": str(SLOT_A), "label": "Bomba",
            "byte_index": 0, "bit_index": 0, "function": "toggle",
            "active": True, "allowed_roles": []}]

URL = f"/api/v1/vehicles/{VEHICLE_A}/can-slots/{SLOT_A}/buttons/{BUTTON_A}/toggle"


def _setup_db():
    db = AsyncMock()
    db.execute.return_value = MagicMock(
        scalar_one_or_none=MagicMock(return_value=_MockDevice()))
    db.commit = AsyncMock()
    return db


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen():
        yield db
    app.dependency_overrides[get_db] = _db_gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_offline_set_queues_and_returns_202():
    """Sin ingest:conn → 202 queued, escribe pending en Redis, status=queued."""
    db = _setup_db()
    _setup(ADMIN_A, db)
    redis = AsyncMock()
    redis.exists.return_value = 0          # ingest:conn ausente → offline
    redis.hget.return_value = None         # estado de slot vacío

    with patch("app.api.v1.vehicles.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()), \
         patch("app.api.v1.vehicles._vehicle_manual_can_cfg",
               new_callable=AsyncMock, return_value=(SLOTS, BUTTONS)):
        with TestClient(app) as c:
            app.state.redis = redis
            r = c.post(URL, json={"value": True})

    assert r.status_code == 202
    body = r.json()
    assert body["queued"] is True
    # Se escribió el pending: hset(vehicle:{id}:manual_can_pending, "31412", <json>)
    hset_calls = [c for c in redis.hset.await_args_list
                  if c.args and c.args[0] == f"vehicle:{VEHICLE_A}:manual_can_pending"]
    assert hset_calls, "debe escribir el hash de pendientes"
    payload = json.loads(hset_calls[0].args[2])
    assert payload["type"] == "set"
    assert payload["commands"] == [f"setparam {PARAM_ID}:0100000000000000"]
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd backend && python -m pytest tests/api/test_manual_can_deferred.py::test_offline_set_queues_and_returns_202 -xvs`
Expected: FAIL — hoy el endpoint devuelve `503` (no `202`), no escribe pendientes.

- [ ] **Step 3: Añadir `pulse` al schema y `queued` a la respuesta**

En `backend/app/api/v1/vehicles.py` (~2156):

```python
class ManualCanButtonToggleIn(BaseModel):
    value: bool | None = None
    pulse: bool = False  # botones reset: dispara un pulso ON+OFF, ignora `value`


class ManualCanButtonToggleResponse(BaseModel):
    button_id: uuid.UUID
    label: str
    new_value: bool
    current_value: str  # hex 16 chars
    queued: bool = False  # True si el comando quedó encolado (FMC offline)
```

- [ ] **Step 4: Extraer helper `_send_manual_can_once` y añadir la rama de encolado**

Reemplazar el cuerpo de `toggle_manual_can_button` desde la comprobación de conexión
(actual 2411-2512) por la versión con encolado. Primero, añadir el helper justo
ANTES de `toggle_manual_can_button` (antes de la línea 2363, fuera del endpoint):

```python
async def _send_manual_can_once(
    redis, db, *, imei: str, command: str, param_id: int, value_hex: str,
    vehicle, device, user, sent_at: datetime,
) -> CommandLog:
    """Publica un comando Manual CAN y espera el ACK (BLPOP 18s). El caller posee
    el lock anti-concurrencia. Lanza HTTPException en timeout/disconnected/failed."""
    log_id = uuid.uuid4()
    log = CommandLog(
        id=log_id, device_id=device.id, vehicle_id=vehicle.id,
        tenant_id=vehicle.tenant_id, user_id=user.user_id, command=command,
        command_type="MANUAL_CAN", status="pending", param_id=param_id,
        param_value=value_hex, imei_snapshot=imei, sent_at=sent_at,
    )
    db.add(log)
    await redis.publish("cmg:manual_can_commands",
                        json.dumps({"imei": imei, "command": command, "log_id": str(log_id)}))
    resp_data = await redis.blpop(f"command:{imei}:response", timeout=18)
    if resp_data is None:
        log.status = "timeout"; log.response_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(status_code=504, detail="El FMC no respondió en 18 segundos")
    _, fmc_response = resp_data
    if fmc_response == "DISCONNECTED":
        log.status = "disconnected"; log.response_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(status_code=503, detail="FMC desconectado")
    if is_fmc_error_response(fmc_response):
        log.status = "failed"; log.response = fmc_response
        log.response_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(status_code=502, detail=f"El FMC rechazó el comando: {fmc_response}")
    now_response = datetime.now(timezone.utc)
    log.status = "confirmed"; log.response = fmc_response
    log.response_at = now_response
    log.latency_ms = int((now_response - sent_at).total_seconds() * 1000)
    await db.commit()
    return log
```

Luego, dentro de `toggle_manual_can_button`, sustituir desde la línea
`# Comando entregable solo con conexión TCP viva...` (2411) hasta el `finally` (2512).
Mantener la obtención de `slot`, `btn`, `device`, `imei`, `redis` tal cual (2383-2409).
Nueva lógica (solo rama `set`; la rama `pulse` se añade en Task 2):

```python
    # Estado actual del slot (bitmask 8 bytes en hex)
    state_k = manual_can_config.state_key(vehicle_id)
    raw_hex = await redis.hget(state_k, str(slot["slot"]))
    raw = bytes.fromhex(raw_hex) if raw_hex else bytes(8)
    online = bool(await redis.exists(f"ingest:conn:{imei}"))

    # ── Rama SET (toggle): un único setparam ──────────────────────────────
    current_state = manual_can_config.current_bit(raw, btn["byte_index"], btn["bit_index"])
    new_state = (not current_state) if body.value is None else body.value
    value_hex = manual_can_config.apply_bit(
        raw, btn["byte_index"], btn["bit_index"], new_state).hex().upper()
    command_sent = f"setparam {slot['param_id']}:{value_hex}"

    if not online:
        # Encolar: se entregará en _restore_manual_can_state al reconectar.
        log_id = uuid.uuid4()
        db.add(CommandLog(
            id=log_id, device_id=device.id, vehicle_id=vehicle_id,
            tenant_id=vehicle.tenant_id, user_id=user.user_id, command=command_sent,
            command_type="MANUAL_CAN", status="queued", param_id=slot["param_id"],
            param_value=value_hex, imei_snapshot=imei,
            sent_at=datetime.now(timezone.utc),
        ))
        await db.commit()
        await redis.hset(
            f"vehicle:{vehicle_id}:manual_can_pending", str(slot["param_id"]),
            json.dumps({"type": "set", "commands": [command_sent],
                        "log_id": str(log_id), "slot": slot["slot"], "value_hex": value_hex}),
        )
        logger.info("Manual CAN encolado (offline) → IMEI %s button=%s", imei, button_id)
        return ManualCanButtonToggleResponse(
            button_id=button_id, label=btn["label"], new_value=new_state,
            current_value=value_hex, queued=True)

    # ── Online: enviar ya (lock anti-concurrencia) ────────────────────────
    is_hold_off = btn.get("function") == "hold" and body.value is False
    pending_key = f"command:{imei}:pending_response"
    acquired = await redis.set(pending_key, "", nx=True, ex=25)
    if not acquired and is_hold_off:
        for _ in range(40):
            await asyncio.sleep(0.5)
            acquired = await redis.set(pending_key, "", nx=True, ex=25)
            if acquired:
                break
    if not acquired:
        raise HTTPException(status_code=409, detail="Ya hay un comando en vuelo para este dispositivo")
    try:
        await _send_manual_can_once(
            redis, db, imei=imei, command=command_sent, param_id=slot["param_id"],
            value_hex=value_hex, vehicle=vehicle, device=device, user=user,
            sent_at=datetime.now(timezone.utc))
        await redis.hset(state_k, str(slot["slot"]), value_hex)
        logger.info("Toggle Manual CAN confirmado: IMEI %s button=%s", imei, button_id)
        return ManualCanButtonToggleResponse(
            button_id=button_id, label=btn["label"], new_value=new_state, current_value=value_hex)
    finally:
        await redis.delete(pending_key)
```

Añadir al decorador el `status_code` no es necesario; FastAPI usa 200 por defecto y
el `202` se fija devolviendo `Response`. Para devolver `202` sin perder el modelo,
cambiar la firma para aceptar `response: Response` e indicar el código:

```python
from fastapi import Response  # ya importado en el módulo; verificar import

async def toggle_manual_can_button(
    vehicle_id: uuid.UUID, slot_id: uuid.UUID, button_id: uuid.UUID,
    body: ManualCanButtonToggleIn, request: Request, response: Response,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
```

y en la rama de encolado, antes del `return`: `response.status_code = 202`.

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `cd backend && python -m pytest tests/api/test_manual_can_deferred.py::test_offline_set_queues_and_returns_202 -xvs`
Expected: PASS.

- [ ] **Step 6: Test de no-regresión — online sigue confirmando (200)**

Añadir a `test_manual_can_deferred.py`:

```python
def test_online_set_still_confirms_200():
    """Con ingest:conn presente y ACK del FMC → 200, queued=False."""
    db = _setup_db()
    _setup(ADMIN_A, db)
    redis = AsyncMock()
    redis.exists.return_value = 1   # online
    redis.hget.return_value = None
    redis.set.return_value = True   # lock adquirido
    redis.blpop.return_value = (f"command:{IMEI}:response",
                                f"setparam {PARAM_ID}:0100000000000000")

    with patch("app.api.v1.vehicles.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()), \
         patch("app.api.v1.vehicles._vehicle_manual_can_cfg",
               new_callable=AsyncMock, return_value=(SLOTS, BUTTONS)):
        with TestClient(app) as c:
            app.state.redis = redis
            r = c.post(URL, json={"value": True})

    assert r.status_code == 200
    assert r.json()["queued"] is False
```

Run: `cd backend && python -m pytest tests/api/test_manual_can_deferred.py -xvs`
Expected: ambos PASS.

- [ ] **Step 7: No-regresión de la suite Manual CAN existente**

Run: `cd backend && python -m pytest tests/api/test_manual_can_commands.py -xvs`
Expected: 8/8 PASS (no se tocó `send_manual_can_command`).

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/v1/vehicles.py backend/tests/api/test_manual_can_deferred.py
git commit -m "feat(api): Manual CAN toggle encola comando si el FMC está offline (202 queued)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Backend — Modo pulse (reset por pulso ON+OFF) online y encolado

**Files:**
- Modify: `backend/app/api/v1/vehicles.py` — `toggle_manual_can_button` (rama `body.pulse`)
- Test: `backend/tests/api/test_manual_can_deferred.py`

**Interfaces:**
- Consumes: helper `_send_manual_can_once` (Task 1), `manual_can_config.apply_bit`.
- Produces: comportamiento `pulse`:
  - online → `_send_manual_can_once(ON)` y luego `_send_manual_can_once(OFF)` bajo un único lock; `200`, estado final = bit a 0.
  - offline → un pendiente `{"type":"pulse","commands":["setparam P:ON","setparam P:OFF"], ...}`; `202`.

- [ ] **Step 1: Test que falla — pulse offline encola dos comandos ON+OFF**

Añadir a `test_manual_can_deferred.py`:

```python
HOLD_BUTTONS = [{"id": str(BUTTON_A), "slot_id": str(SLOT_A), "label": "Reset horas",
                 "byte_index": 0, "bit_index": 2, "function": "hold",
                 "active": True, "allowed_roles": []}]


def test_offline_pulse_queues_on_off():
    """pulse offline → 202, pending type=pulse con ON y OFF."""
    db = _setup_db()
    _setup(ADMIN_A, db)
    redis = AsyncMock()
    redis.exists.return_value = 0
    redis.hget.return_value = None

    with patch("app.api.v1.vehicles.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()), \
         patch("app.api.v1.vehicles._vehicle_manual_can_cfg",
               new_callable=AsyncMock, return_value=(SLOTS, HOLD_BUTTONS)):
        with TestClient(app) as c:
            app.state.redis = redis
            r = c.post(URL, json={"pulse": True})

    assert r.status_code == 202
    assert r.json()["queued"] is True
    hset_calls = [c for c in redis.hset.await_args_list
                  if c.args and c.args[0] == f"vehicle:{VEHICLE_A}:manual_can_pending"]
    payload = json.loads(hset_calls[0].args[2])
    assert payload["type"] == "pulse"
    # bit_index=2 → ON=0x04, OFF=0x00
    assert payload["commands"] == [f"setparam {PARAM_ID}:0400000000000000",
                                   f"setparam {PARAM_ID}:0000000000000000"]


def test_online_pulse_sends_on_then_off():
    """pulse online → 200; publica DOS comandos (ON y OFF)."""
    db = _setup_db()
    _setup(ADMIN_A, db)
    redis = AsyncMock()
    redis.exists.return_value = 1
    redis.hget.return_value = None
    redis.set.return_value = True
    redis.blpop.side_effect = [
        (f"command:{IMEI}:response", f"setparam {PARAM_ID}:0400000000000000"),
        (f"command:{IMEI}:response", f"setparam {PARAM_ID}:0000000000000000"),
    ]

    with patch("app.api.v1.vehicles.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()), \
         patch("app.api.v1.vehicles._vehicle_manual_can_cfg",
               new_callable=AsyncMock, return_value=(SLOTS, HOLD_BUTTONS)):
        with TestClient(app) as c:
            app.state.redis = redis
            r = c.post(URL, json={"pulse": True})

    assert r.status_code == 200
    publishes = [c for c in redis.publish.await_args_list
                 if c.args and c.args[0] == "cmg:manual_can_commands"]
    assert len(publishes) == 2, "pulse online publica ON y OFF"
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `cd backend && python -m pytest tests/api/test_manual_can_deferred.py::test_offline_pulse_queues_on_off tests/api/test_manual_can_deferred.py::test_online_pulse_sends_on_then_off -xvs`
Expected: FAIL — `body.pulse` aún no se procesa (cae en la rama set).

- [ ] **Step 3: Implementar la rama pulse**

En `toggle_manual_can_button`, justo después de calcular `online` y antes de la rama SET,
insertar:

```python
    # ── Rama PULSE (botón reset): pulso ON+OFF, ignora body.value ──────────
    if body.pulse:
        on_hex = manual_can_config.apply_bit(
            raw, btn["byte_index"], btn["bit_index"], True).hex().upper()
        off_hex = manual_can_config.apply_bit(
            raw, btn["byte_index"], btn["bit_index"], False).hex().upper()
        cmd_on = f"setparam {slot['param_id']}:{on_hex}"
        cmd_off = f"setparam {slot['param_id']}:{off_hex}"

        if not online:
            log_id = uuid.uuid4()
            db.add(CommandLog(
                id=log_id, device_id=device.id, vehicle_id=vehicle_id,
                tenant_id=vehicle.tenant_id, user_id=user.user_id, command=cmd_on,
                command_type="MANUAL_CAN", status="queued", param_id=slot["param_id"],
                param_value=on_hex, imei_snapshot=imei,
                sent_at=datetime.now(timezone.utc),
            ))
            await db.commit()
            await redis.hset(
                f"vehicle:{vehicle_id}:manual_can_pending", str(slot["param_id"]),
                json.dumps({"type": "pulse", "commands": [cmd_on, cmd_off],
                            "log_id": str(log_id), "slot": slot["slot"], "value_hex": off_hex}),
            )
            logger.info("Manual CAN pulse encolado (offline) → IMEI %s button=%s", imei, button_id)
            response.status_code = 202
            return ManualCanButtonToggleResponse(
                button_id=button_id, label=btn["label"], new_value=False,
                current_value=off_hex, queued=True)

        pending_key = f"command:{imei}:pending_response"
        if not await redis.set(pending_key, "", nx=True, ex=25):
            raise HTTPException(status_code=409, detail="Ya hay un comando en vuelo para este dispositivo")
        try:
            now = datetime.now(timezone.utc)
            await _send_manual_can_once(
                redis, db, imei=imei, command=cmd_on, param_id=slot["param_id"],
                value_hex=on_hex, vehicle=vehicle, device=device, user=user, sent_at=now)
            await _send_manual_can_once(
                redis, db, imei=imei, command=cmd_off, param_id=slot["param_id"],
                value_hex=off_hex, vehicle=vehicle, device=device, user=user,
                sent_at=datetime.now(timezone.utc))
            await redis.hset(state_k, str(slot["slot"]), off_hex)
            logger.info("Pulse Manual CAN OK: IMEI %s button=%s", imei, button_id)
            return ManualCanButtonToggleResponse(
                button_id=button_id, label=btn["label"], new_value=False, current_value=off_hex)
        finally:
            await redis.delete(pending_key)
```

(la rama SET de Task 1 queda a continuación, sin cambios).

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `cd backend && python -m pytest tests/api/test_manual_can_deferred.py -xvs`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/vehicles.py backend/tests/api/test_manual_can_deferred.py
git commit -m "feat(api): modo pulse (reset ON+OFF) en Manual CAN, online y encolado

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Ingest — Reproducir pendientes al reconectar (`_restore_manual_can_state`)

**Files:**
- Modify: `services/ingest/src/server.py` — `_handshake` (~198, tras `_restore_dout_state`), nuevo método `_restore_manual_can_state`
- Test: `services/ingest/tests/test_restore_manual_can.py` (crear)

**Interfaces:**
- Consumes: `self.redis`, `self.writer`, `self.imei`, `self.device_info["vehicle_id"]`,
  `build_codec12_command`, `_confirm_command(log_id, response)`, `manual_can_config.state_key`
  (la clave de estado `vehicle:{id}:can_outputs` se referencia como literal para no acoplar al backend).
- Produces: al reconectar, lee `vehicle:{vehicle_id}:manual_can_pending`, escribe cada comando
  Codec 12 al socket, actualiza `vehicle:{vehicle_id}:can_outputs` con `value_hex` por slot,
  confirma cada `CommandLog` vía `_confirm_command(log_id, "OK (entrega diferida)")`, y borra el hash.

- [ ] **Step 1: Test que falla — restore escribe codec12, confirma y limpia**

Crear `services/ingest/tests/test_restore_manual_can.py`:

```python
"""TDD — _restore_manual_can_state: reproduce pendientes Manual CAN al reconectar."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.server import TeltonikaConnection

VEHICLE_ID = "ce400000-0000-0000-0000-000000000001"
IMEI = "862272089079729"


def _make_conn(pending: dict):
    reader = MagicMock()
    writer = MagicMock()
    writer.write = MagicMock()
    writer.drain = AsyncMock()
    redis = AsyncMock()
    redis.hgetall.return_value = pending
    conn = TeltonikaConnection(reader, writer, db_pool=MagicMock(), redis=redis)
    conn.imei = IMEI
    conn.device_info = {"vehicle_id": VEHICLE_ID}
    return conn, writer, redis


@pytest.mark.asyncio
async def test_restore_set_writes_and_confirms():
    pending = {"31412": json.dumps({
        "type": "set", "commands": ["setparam 31412:0100000000000000"],
        "log_id": "log-1", "slot": 0, "value_hex": "0100000000000000"})}
    conn, writer, redis = _make_conn(pending)

    with patch("src.server._confirm_command", new_callable=AsyncMock) as mock_confirm, \
         patch("src.server.build_codec12_command", return_value=b"PKT") as mock_build:
        await conn._restore_manual_can_state()

    mock_build.assert_called_once_with("setparam 31412:0100000000000000")
    writer.write.assert_called_once_with(b"PKT")
    mock_confirm.assert_awaited_once_with("log-1", "OK (entrega diferida)")
    redis.hset.assert_awaited()  # actualiza vehicle:{id}:can_outputs
    redis.delete.assert_awaited_with(f"vehicle:{VEHICLE_ID}:manual_can_pending")


@pytest.mark.asyncio
async def test_restore_pulse_writes_two_packets():
    pending = {"31412": json.dumps({
        "type": "pulse",
        "commands": ["setparam 31412:0400000000000000", "setparam 31412:0000000000000000"],
        "log_id": "log-2", "slot": 0, "value_hex": "0000000000000000"})}
    conn, writer, redis = _make_conn(pending)

    with patch("src.server._confirm_command", new_callable=AsyncMock), \
         patch("src.server.build_codec12_command", return_value=b"PKT"):
        await conn._restore_manual_can_state()

    assert writer.write.call_count == 2  # ON y OFF


@pytest.mark.asyncio
async def test_restore_empty_is_noop():
    conn, writer, redis = _make_conn({})
    await conn._restore_manual_can_state()
    writer.write.assert_not_called()
    redis.delete.assert_not_awaited()
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd services/ingest && python -m pytest tests/test_restore_manual_can.py -xvs`
Expected: FAIL — `_restore_manual_can_state` no existe (AttributeError).

- [ ] **Step 3: Implementar `_restore_manual_can_state` y llamarlo en `_handshake`**

En `services/ingest/src/server.py`, justo después de `_restore_dout_state` (tras la línea ~225):

```python
    async def _restore_manual_can_state(self) -> None:
        """Reproduce los comandos Manual CAN encolados mientras el FMC estaba offline.

        El API guarda en vehicle:{id}:manual_can_pending (hash por param_id) los
        comandos a entregar. Aquí se escriben al socket Codec 12, se actualiza el
        estado de salidas y se confirma cada CommandLog. Sin caducidad: persisten
        hasta reproducirse en una reconexión."""
        vehicle_id = self.device_info["vehicle_id"]
        pending_key = f"vehicle:{vehicle_id}:manual_can_pending"
        pending = await self.redis.hgetall(pending_key)
        if not pending:
            return
        outputs_key = f"vehicle:{vehicle_id}:can_outputs"
        for _param_id, raw in pending.items():
            try:
                entry = json.loads(raw)
            except (ValueError, TypeError):
                continue
            for command in entry.get("commands", []):
                self.writer.write(build_codec12_command(command))
                await self.writer.drain()
            if entry.get("value_hex") is not None and entry.get("slot") is not None:
                await self.redis.hset(outputs_key, str(entry["slot"]), entry["value_hex"])
            if entry.get("log_id"):
                # Entregado a un socket vivo → confirmado (best-effort para el ACK real).
                await _confirm_command(entry["log_id"], "OK (entrega diferida)")
            logger.info("Manual CAN diferido entregado a %s: %s", self.imei, entry.get("commands"))
        await self.redis.delete(pending_key)
```

Y en `_handshake`, tras `await self._restore_dout_state()` (línea ~198):

```python
        await self._restore_manual_can_state()
```

Verificar que `json` está importado en `server.py` (lo está; lo usa `manual_can_listener`).

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `cd services/ingest && python -m pytest tests/test_restore_manual_can.py -xvs`
Expected: 3/3 PASS.

- [ ] **Step 5: No-regresión ingest**

Run: `cd services/ingest && python -m pytest -q`
Expected: toda la suite PASS (incluye `test_fmc_response`, `test_idle_timeout`, etc.).

- [ ] **Step 6: Commit**

```bash
git add services/ingest/src/server.py services/ingest/tests/test_restore_manual_can.py
git commit -m "feat(ingest): _restore_manual_can_state reproduce comandos diferidos al reconectar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Frontend — Quitar aviso rojo FMC y botones siempre activos

**Files:**
- Modify: `frontend/src/features/vehicle/ManualCanControl.tsx`

**Interfaces:**
- Produces: el componente ya no consume `GET /fmc-status` ni el tipo `FmcStatus`; los botones
  no se deshabilitan por estado de conexión (`disabled` depende solo de `loading` para toggles).

- [ ] **Step 1: Eliminar query `fmc-status`, variable `connected` y el badge**

En `ManualCanControl.tsx`:
- Borrar el bloque `const { data: fmcStatus } = useQuery<FmcStatus>({...})` (líneas 64-68).
- Borrar `const connected = fmcStatus?.connected ?? false` (línea 79).
- Quitar `FmcStatus` del import de tipos (línea 5).
- En la cabecera (líneas 185-190), eliminar el `<span>` que muestra `● FMC Online / ○ FMC Offline`. Dejar solo el título "Control CAN Manual".

- [ ] **Step 2: Botones siempre habilitados (online envía, offline encola)**

En el render del botón (línea 214), cambiar:

```tsx
const disabled = isHold ? !connected : (!connected || !!loading)
```

por:

```tsx
// Online envía ya; offline encola en backend. Solo bloqueamos toggles en vuelo.
const disabled = isHold ? false : !!loading
```

En `handleToggleClick` (122) y `handleHoldStart` (127), eliminar la condición `!connected`
(quedará: `if (toggling[btn.id]) return` en toggle; el hold se rehace en Task 5).

- [ ] **Step 3: Verificar typecheck/build**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errores (ninguna referencia colgante a `connected`/`fmcStatus`/`FmcStatus`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/vehicle/ManualCanControl.tsx
git commit -m "feat(frontend): Manual CAN sin aviso FMC online/offline; botones siempre activos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — Botones `hold` = reset con modal de confirmación + pulse, y feedback encolado/enviado

**Files:**
- Modify: `frontend/src/features/vehicle/ManualCanControl.tsx`

**Interfaces:**
- Consumes: endpoint toggle con `{ pulse: true }` (Task 2); respuesta `{ queued: bool }` (Task 1).
- Produces: botón `hold` → clic abre modal → al confirmar hace `POST .../toggle { pulse: true }`;
  badge por botón `Encolado`→`Enviado OK`; toast en entrega.

- [ ] **Step 1: Sustituir press-and-hold por clic→modal→pulse**

En `ManualCanControl.tsx`:
- Eliminar `heldRef`, `handleHoldStart`, `handleHoldEnd` y el `useEffect` de OFF de seguridad (líneas 60-62, 127-159).
- Añadir estado del modal: `const [confirmBtn, setConfirmBtn] = useState<CanButton | null>(null)`.
- Añadir estado de feedback por botón: `const [queuedBtns, setQueuedBtns] = useState<Record<string, 'queued' | 'sent'>>({})`.
- En el render del botón, para `isHold` usar `onClick: () => setConfirmBtn(btn)` (en vez de los pointer handlers).
- Nueva función de envío con pulse:

```tsx
async function sendPulse(btn: CanButton) {
  setToggling(t => ({ ...t, [btn.id]: true }))
  try {
    const res = await apiClient.post<{ queued?: boolean }>(
      `/api/v1/vehicles/${vehicleId}/can-slots/${btn.slot_id}/buttons/${btn.id}/toggle`,
      { pulse: true },
    )
    if (res?.queued) {
      setQueuedBtns(q => ({ ...q, [btn.id]: 'queued' }))
      toast.info('Comando encolado: se enviará cuando el FMC reconecte')
    } else {
      toast.success('Comando enviado al FMC')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Error al enviar el comando')
  } finally {
    setToggling(t => ({ ...t, [btn.id]: false }))
  }
}
```

(Comprobar que `apiClient.post` admite tipo de retorno genérico; si no, tipar el resultado
con `as { queued?: boolean }`.)

- [ ] **Step 2: También encolar los toggles offline (reusar feedback)**

En `sendValue` (104), tras el `await apiClient.post(...)`, leer la respuesta y marcar encolado:

```tsx
const res = await apiClient.post<{ queued?: boolean }>(
  `/api/v1/vehicles/${vehicleId}/can-slots/${btn.slot_id}/buttons/${btn.id}/toggle`,
  value === null ? {} : { value },
)
if (res?.queued) {
  setQueuedBtns(q => ({ ...q, [btn.id]: 'queued' }))
  toast.info('Comando encolado: se enviará cuando el FMC reconecte')
}
```

- [ ] **Step 3: Detectar entrega y mostrar "Enviado OK"**

Añadir una query ligera de comandos recientes, activa solo si hay algún botón encolado,
que detecta cuando un `log` pasa a `confirmed` (disponible a todos los roles):

```tsx
const hasQueued = Object.values(queuedBtns).some(s => s === 'queued')
const { data: recent = [] } = useQuery<CommandLogEntry[]>({
  queryKey: ['manual-can-recent', vehicleId],
  queryFn: () => apiClient.get<CommandLogEntry[]>(
    `/api/v1/vehicles/${vehicleId}/commands?command_type=MANUAL_CAN&limit=10`),
  refetchInterval: hasQueued ? 8_000 : false,
  enabled: hasQueued,
})

useEffect(() => {
  if (!recent.length) return
  setQueuedBtns(prev => {
    const next = { ...prev }
    let changed = false
    // El backend no devuelve button_id en el log; emparejamos por param_id del botón.
    for (const btn of buttons) {
      if (prev[btn.id] !== 'queued') continue
      const slot = slots.find(s => s.id === btn.slot_id)
      // recent[] está ordenado desc por sent_at; el más reciente confirmado del param gana
      const hit = recent.find(r => r.status === 'confirmed' && r.command.includes(`setparam ${slotParam(slot)}:`))
      if (hit) { next[btn.id] = 'sent'; changed = true }
    }
    return changed ? next : prev
  })
}, [recent, buttons, slots])
```

Nota de implementación: `ManualCanSlot` (líneas 7-11) no incluye `param_id`. Para emparejar
por param hace falta exponerlo. Como alternativa más simple y sin depender de param_id,
emparejar por **desaparición del pendiente**: cuando el botón estaba `queued` y su
`current_bit` (de `can-buttons`) cambia al valor esperado, marcar `sent`. **Decisión:** usar
la alternativa simple para evitar tocar el tipo `ManualCanSlot`:

```tsx
// Reemplaza el bloque anterior: marca 'sent' cuando el backend confirma cualquier
// MANUAL_CAN reciente tras encolar (heurística suficiente para el feedback de UI).
useEffect(() => {
  if (!recent.length || !hasQueued) return
  const lastConfirmed = recent.find(r => r.status === 'confirmed')
  if (!lastConfirmed) return
  setQueuedBtns(prev => {
    const next: Record<string, 'queued' | 'sent'> = {}
    let changed = false
    for (const [id, st] of Object.entries(prev)) {
      if (st === 'queued') { next[id] = 'sent'; changed = true } else next[id] = st
    }
    return changed ? next : prev
  })
  toast.success('Comando entregado al FMC')
}, [recent, hasQueued])
```

- [ ] **Step 4: Badge en el botón y limpieza tras unos segundos**

En el render de cada botón, mostrar el estado de cola encima/junto al texto:

```tsx
{queuedBtns[btn.id] === 'queued' && (
  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--warn)' }}>⏳ Encolado</span>
)}
{queuedBtns[btn.id] === 'sent' && (
  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ok)' }}>✓ Enviado OK</span>
)}
```

Auto-limpiar el badge `sent` a los 5s:

```tsx
useEffect(() => {
  const sent = Object.entries(queuedBtns).filter(([, s]) => s === 'sent').map(([id]) => id)
  if (!sent.length) return
  const t = setTimeout(() => setQueuedBtns(q => {
    const next = { ...q }; sent.forEach(id => delete next[id]); return next
  }), 5_000)
  return () => clearTimeout(t)
}, [queuedBtns])
```

- [ ] **Step 5: Modal de confirmación**

Antes del `return` de cierre del componente (antes de `)` final), añadir el modal:

```tsx
{confirmBtn && (
  <div onClick={() => setConfirmBtn(null)} style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
      padding: 18, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontWeight: 700, color: 'var(--fg-primary)' }}>Confirmar envío</div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
        Vas a enviar un dato al equipo «{confirmBtn.label}» (reset de contador/horas).
        Si el FMC está offline, se enviará al reconectar. ¿Confirmar?
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => setConfirmBtn(null)} style={{
          padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
          background: 'var(--bg-elevated)', color: 'var(--fg-muted)', cursor: 'pointer' }}>
          Cancelar
        </button>
        <button onClick={() => { const b = confirmBtn; setConfirmBtn(null); void sendPulse(b) }}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--cmg-teal)',
          background: 'var(--cmg-teal)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
          Enviar
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Verificar typecheck/build**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errores. Verificar que `toast.info` existe en `shared/ui/Toast`; si no, usar
`toast.success`/`toast.error` disponibles.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/vehicle/ManualCanControl.tsx
git commit -m "feat(frontend): botones hold = reset con modal+pulse; badge encolado/enviado

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — Historial reciente solo para admin

**Files:**
- Modify: `frontend/src/features/vehicle/ManualCanControl.tsx`

**Interfaces:**
- Consumes: `useAuthStore` (patrón `s => s.user?.role === 'admin'`).
- Produces: el bloque "Historial reciente" (275-311) solo se renderiza y consulta para admin.

- [ ] **Step 1: Importar auth store y derivar isAdmin**

Añadir import: `import { useAuthStore } from '../auth/useAuthStore'`.
Dentro del componente: `const isAdmin = useAuthStore(s => s.user?.role === 'admin')`.

- [ ] **Step 2: Restringir query e UI del historial**

En la query `history` (70-77), añadir `enabled: isAdmin`.
En el render (275), cambiar `{history.length > 0 && (` por `{isAdmin && history.length > 0 && (`.

- [ ] **Step 3: Verificar typecheck/build**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/vehicle/ManualCanControl.tsx
git commit -m "feat(frontend): historial reciente Manual CAN visible solo para admin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Frontend — Quitar la pestaña vieja "Historial de comandos e incidencias"

**Files:**
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

**Interfaces:**
- Produces: se elimina el panel colapsable (480-525) y el estado `showBottomPanel` (56).
  Se CONSERVA la query `commandHistory` (149-154) porque la consume `ActivityDrawer` (643).

- [ ] **Step 1: Eliminar el panel y su botón**

En `VehicleDetailPage.tsx`, borrar el bloque completo desde el comentario
`{/* HISTORIAL DE COMANDOS */}` (479) hasta el cierre del `{showBottomPanel && (...)}` (525),
ambos inclusive.

- [ ] **Step 2: Eliminar el estado `showBottomPanel`**

Borrar la línea 56: `const [showBottomPanel, setShowBottomPanel] = useState(false)`.
(NO borrar `commandHistory` ni `firingAlerts`: `commandHistory` se pasa a `ActivityDrawer`
en la línea 643 y `firingAlerts`/`activeAlerts` se usan en el resto de la página.)

- [ ] **Step 3: Verificar typecheck/build y que no queden referencias colgantes**

Run: `cd frontend && grep -n "showBottomPanel" src/features/vehicle/VehicleDetailPage.tsx`
Expected: sin resultados.
Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errores. Si `CommandStatusBadge` (742) queda sin uso y el linter se queja,
dejarlo (lo puede usar `ActivityDrawer`); verificar con
`grep -rn "CommandStatusBadge" src/` antes de borrar nada.

- [ ] **Step 4: Build completo del frontend**

Run: `cd frontend && npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/vehicle/VehicleDetailPage.tsx
git commit -m "feat(frontend): quitar panel viejo 'Historial de comandos e incidencias'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Objetivo 1 (entrega diferida) → Tasks 1, 2, 3. ✓
- Objetivo 2 (hold = reset modal+pulse) → Task 2 (backend) + Task 5 (frontend). ✓
- Objetivo 3 (feedback badge+toast) → Task 5. ✓
- Objetivo 4 (historial solo-admin) → Task 6. ✓
- Objetivo 5 (quitar aviso rojo) → Task 4. ✓
- Objetivo 6 (quitar pestaña vieja) → Task 7. ✓
- Sin migración (status String) → respetado (Global Constraints). ✓
- Sin caducidad → el pending no lleva TTL (Tasks 1/2). ✓

**Placeholder scan:** sin "TBD"/"TODO"; cada paso de código incluye el código. El emparejamiento
del badge por param_id se resolvió eligiendo explícitamente la heurística simple (Task 5 Step 3).

**Type consistency:** `_send_manual_can_once` (definido Task 1) se consume en Task 2 con la misma
firma. `manual_can_pending` (hash, campos `type/commands/log_id/slot/value_hex`) se escribe en
Tasks 1/2 y se lee idéntico en Task 3. Respuesta `{queued}` producida en Task 1 y consumida en
Task 5. `state_key` = `vehicle:{id}:can_outputs` en backend y referenciado como literal en ingest
(Task 3) — coinciden.

**Riesgo conocido (documentado en spec):** la confirmación de varios pendientes simultáneos es
best-effort; el restore marca cada uno `confirmed` al entregarlo al socket (no espera el ACK real
del FMC), lo que casa con la semántica "dato enviado OK" del usuario.
