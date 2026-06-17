# Corrección envío FMC650 → PLC (Manual CAN) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar que los botones Manual CAN lleguen al PLC CR2530, corrigiendo el `param_id` mal configurado y endureciendo el código para que un rechazo del FMC no vuelva a ocultarse ni a reintroducirse.

**Architecture:** El motor de transporte (backend → Redis → ingest → Codec 12 → FMC) es correcto; lo demostró una prueba con `param_id=16002` que conservó los 8 bytes. El fallo es de datos: las 5 plantillas usan `param_id=16000` (parámetro escalar del FMC, no registro de datos CAN), valor que el editor rellena por defecto. El plan (A) endurece el código para que un `WARNING/ERROR` del FMC se marque como fallo y el editor no sugiera un param inválido, (B) valida en vivo el mapeo CAN correcto, y (C) corrige las plantillas desde la UI.

**Tech Stack:** FastAPI + SQLAlchemy async (backend) · asyncio + asyncpg + redis (ingest-svc) · React 18 + TS + React Query (frontend) · Docker Compose.

## Global Constraints

- **ESTE SERVIDOR ES PRODUCCIÓN. No hay staging ni BD local.** La BD Docker = producción de Wasterent/PREZERO.
- Requieren confirmación explícita antes de ejecutar: cualquier `psql` no-SELECT, `docker compose down/restart`, `docker stop/rm`, modificar `.env`/`docker-compose.yml`.
- Comentarios en español, código en inglés. Type hints en toda función pública (Python); TS estricto, sin `any`.
- Todo async/await; nunca threading. No `print()` (usar logger/structlog). No `except:` desnudo.
- Deploy frontend/ingest/core-api: el bug `ContainerConfig` de compose v1.29.2 obliga a `docker stop+rm+run` (ver receta en `feedback_compose_deploy.md` / CLAUDE.md §DEPLOY). `docker-compose build` SÍ funciona.
- La respuesta de éxito del FMC al `setparam` tiene la forma `New value <param_id>:<valor>;`. Un rechazo contiene `WARNING`, `ERROR`, `Not supported` o `Unknown`.

---

## FASE A — Endurecer el código

### Task 1: Backend — clasificar la respuesta del FMC y marcar `failed` los rechazos

**Files:**
- Modify: `backend/app/services/manual_can_config.py` (añadir helper)
- Modify: `backend/app/api/v1/vehicles.py:1843-1859` (endpoint `send_manual_can_command`)
- Modify: `backend/app/api/v1/vehicles.py:2450-2466` (endpoint `toggle_manual_can_button`)
- Test: `backend/tests/test_manual_can_config.py` (test del helper puro)

**Interfaces:**
- Produces: `is_fmc_error_response(text: str) -> bool` en `app.services.manual_can_config`.

- [ ] **Step 1: Escribir el test que falla**

En `backend/tests/test_manual_can_config.py` (añadir al final, o crear si no existe el import):

```python
from app.services.manual_can_config import is_fmc_error_response


def test_is_fmc_error_response_detects_warning():
    assert is_fmc_error_response("WARNING: Not supported Param ID or Value detected") is True


def test_is_fmc_error_response_detects_error_and_unknown():
    assert is_fmc_error_response("ERROR: bad command") is True
    assert is_fmc_error_response("Unknown parameter") is True


def test_is_fmc_error_response_accepts_new_value_ack():
    assert is_fmc_error_response("New value 16002:00FFFFFFFFFFFFFF;") is False


def test_is_fmc_error_response_empty_is_not_error():
    # ACK Codec 12 presente sin texto (caso DOUT): no es un rechazo.
    assert is_fmc_error_response("") is False
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pytest backend/tests/test_manual_can_config.py -k is_fmc_error_response -xvs`
Expected: FAIL con `ImportError: cannot import name 'is_fmc_error_response'`.

- [ ] **Step 3: Implementar el helper**

En `backend/app/services/manual_can_config.py` (al final del módulo):

```python
# Marcadores de rechazo en la respuesta Codec 12 del FMC. El FMC confirma un
# setparam aceptado con "New value <id>:<valor>;"; cualquiera de estos textos
# significa que NO aplicó el comando aunque el ACK Codec 12 haya llegado.
_FMC_ERROR_MARKERS = ("WARNING", "ERROR", "NOT SUPPORTED", "UNKNOWN", "FAIL")


def is_fmc_error_response(text: str | None) -> bool:
    """True si la respuesta del FMC indica que rechazó el comando."""
    if not text:
        return False
    upper = text.upper()
    return any(marker in upper for marker in _FMC_ERROR_MARKERS)
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pytest backend/tests/test_manual_can_config.py -k is_fmc_error_response -xvs`
Expected: PASS (4 tests).

- [ ] **Step 5: Aplicar el helper en `toggle_manual_can_button`**

En `backend/app/api/v1/vehicles.py`, justo después de la comprobación `DISCONNECTED` (línea ~2456) y ANTES de marcar `confirmed` y del `hset`:

```python
        if is_fmc_error_response(fmc_response):
            command_log.status = "failed"
            command_log.response = fmc_response
            command_log.response_at = datetime.now(timezone.utc)
            await db.commit()
            logger.warning("Toggle Manual CAN rechazado por FMC %s: %r", imei, fmc_response)
            raise HTTPException(status_code=502, detail=f"El FMC rechazó el comando: {fmc_response}")
```

Asegurar el import al principio del bloque de imports de servicios del fichero:
`from app.services.manual_can_config import is_fmc_error_response` (junto a los demás imports de `manual_can_config`, si ya hay uno, añadir el nombre).

- [ ] **Step 6: Aplicar el helper en `send_manual_can_command`**

En `backend/app/api/v1/vehicles.py`, tras la comprobación `DISCONNECTED` (línea ~1850) y ANTES de calcular `latency_ms`/marcar `confirmed`:

```python
        if is_fmc_error_response(fmc_response):
            command_log.status = "failed"
            command_log.response = fmc_response
            command_log.response_at = datetime.now(timezone.utc)
            await db.commit()
            logger.warning("Manual CAN rechazado por FMC %s: %r", imei, fmc_response)
            raise HTTPException(status_code=502, detail=f"El FMC rechazó el comando: {fmc_response}")
```

- [ ] **Step 7: Verificar typecheck/imports**

Run: `cd backend && python -c "import app.api.v1.vehicles"`
Expected: sin error de import.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/manual_can_config.py backend/app/api/v1/vehicles.py backend/tests/test_manual_can_config.py
git commit -m "fix(manual-can): tratar WARNING/ERROR del FMC como fallo, no confirmed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ingest-svc — `_confirm_command` no marca `confirmed` un rechazo

**Files:**
- Modify: `services/ingest/src/codec8.py` (helper local, ingest no importa backend)
- Modify: `services/ingest/src/server.py:80-90` (`_confirm_command`)
- Test: `services/ingest/tests/test_fmc_response.py` (crear)

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `is_fmc_error_response(text: str | None) -> bool` en `src.codec8`.

- [ ] **Step 1: Escribir el test que falla**

Crear `services/ingest/tests/test_fmc_response.py`:

```python
from src.codec8 import is_fmc_error_response


def test_warning_is_error():
    assert is_fmc_error_response("WARNING: Not supported Param ID or Value detected") is True


def test_new_value_ack_is_ok():
    assert is_fmc_error_response("New value 16002:00FFFFFFFFFFFFFF;") is False


def test_empty_is_ok():
    assert is_fmc_error_response("") is False
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd services/ingest && python -m pytest tests/test_fmc_response.py -xvs`
Expected: FAIL con `ImportError`.

- [ ] **Step 3: Implementar el helper en codec8.py**

En `services/ingest/src/codec8.py` (al final del módulo):

```python
_FMC_ERROR_MARKERS = ("WARNING", "ERROR", "NOT SUPPORTED", "UNKNOWN", "FAIL")


def is_fmc_error_response(text: str | None) -> bool:
    """True si la respuesta Codec 12 del FMC indica rechazo del comando.

    El FMC confirma con 'New value <id>:<valor>;'; cualquier WARNING/ERROR
    significa que no aplicó el comando aunque el ACK Codec 12 haya llegado."""
    if not text:
        return False
    upper = text.upper()
    return any(marker in upper for marker in _FMC_ERROR_MARKERS)
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd services/ingest && python -m pytest tests/test_fmc_response.py -xvs`
Expected: PASS (3 tests).

- [ ] **Step 5: Usar el helper en `_confirm_command`**

En `services/ingest/src/server.py`, importar el helper (añadir al import existente de `src.codec8` en la línea 13):
`from src.codec8 import decode_packet, build_ack, build_codec12_command, parse_codec12_response, is_fmc_error_response`

Y reemplazar el cuerpo de `_confirm_command` (líneas 80-90):

```python
async def _confirm_command(log_id: str, response: str) -> None:
    """Actualiza un registro de comando con el ACK del dispositivo.

    Si el FMC respondió con WARNING/ERROR, el comando NO se aplicó: status=failed."""
    status = "failed" if is_fmc_error_response(response) else "confirmed"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.patch(
                f"{settings.core_api_url}/internal/commands/{log_id}/confirm",
                headers=_internal_headers(),
                json={"response": response, "status": status},
            )
    except Exception as e:
        logger.warning("No se pudo confirmar comando %s: %s", log_id, e)
```

- [ ] **Step 6: Commit**

```bash
git add services/ingest/src/codec8.py services/ingest/src/server.py services/ingest/tests/test_fmc_response.py
git commit -m "fix(ingest): _confirm_command marca failed si el FMC respondió WARNING/ERROR

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend — el editor de plantillas no sugiere `param_id=16000`

**Files:**
- Modify: `frontend/src/features/vehicles/ManualCanConfigSection.tsx:54-56` (`addSlot`)
- Modify: `frontend/src/features/vehicles/ManualCanConfigSection.tsx:44-51` (validación previa al guardado)
- Test: `frontend/src/features/vehicles/__tests__/ManualCanConfigSection.test.tsx` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `addSlot` crea slots con `param_id: 0`; el guardado se bloquea si algún slot tiene `param_id <= 0`.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/features/vehicles/__tests__/ManualCanConfigSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ManualCanConfigSection from '../ManualCanConfigSection'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { patch: vi.fn() } }))
vi.mock('../../../shared/ui/Toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

const TYPE = {
  id: 't1', name: 'Cisterna', manual_can_slots: [], manual_can_buttons: [],
} as never

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ManualCanConfigSection typeId="t1" selectedType={TYPE} />
    </QueryClientProvider>,
  )
}

describe('ManualCanConfigSection', () => {
  it('un slot recién añadido NO trae param_id 16000 por defecto y bloquea guardado', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /\+ slot/i }))
    // El input de param_id debe estar vacío o 0, nunca 16000.
    const paramInput = screen.getByTestId('slot-param-id-0') as HTMLInputElement
    expect(paramInput.value === '' || paramInput.value === '0').toBe(true)
    // Guardar con param_id inválido no debe llamar al API.
    await user.click(screen.getByRole('button', { name: /guardar configuración/i }))
    expect(apiClient.patch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd frontend && npx vitest run src/features/vehicles/__tests__/ManualCanConfigSection.test.tsx`
Expected: FAIL (param_id es 16000 / falta `data-testid` / el guardado llama al API).

- [ ] **Step 3: Cambiar el default y añadir `data-testid`**

En `ManualCanConfigSection.tsx:55`, cambiar:
```tsx
    setSlots(s => [...s, { id: crypto.randomUUID(), slot: 0, param_id: 16000, description: '' }])
```
por:
```tsx
    // Sin valor por defecto: el param_id del FMC debe introducirse a propósito
    // (16000 era un escalar inválido para salida CAN — ver plan 2026-06-17).
    setSlots(s => [...s, { id: crypto.randomUUID(), slot: 0, param_id: 0, description: '' }])
```

En el `<Input type="number" ...>` del param_id (línea ~122), añadir el testid (usar el índice del map del slot):
```tsx
                    <Input type="number" min={1} data-testid={`slot-param-id-${i}`} value={String(s.param_id)}
                      onChange={e => patchSlot(s.id, { param_id: num(e.target.value, 0) })} />
```
(Si el `.map` de slots no expone el índice `i`, cambiar `slots.map(s => ...)` por `slots.map((s, i) => ...)`.)

- [ ] **Step 4: Bloquear el guardado con param_id inválido**

Importar el toast al principio del fichero: `import { toast } from '../../shared/ui/Toast'`.

Reemplazar el `onClick` del botón Guardar (línea 96) por una función guarda con validación. Añadir antes del `return`:
```tsx
  function handleSave() {
    const bad = slots.find(s => !s.param_id || s.param_id <= 0)
    if (bad) {
      toast.error(`El slot ${bad.slot} no tiene un param_id válido del FMC`)
      return
    }
    mutation.mutate()
  }
```
Y el botón:
```tsx
        <button style={btnPrimary} onClick={handleSave} disabled={mutation.isPending}>
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `cd frontend && npx vitest run src/features/vehicles/__tests__/ManualCanConfigSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/vehicles/ManualCanConfigSection.tsx frontend/src/features/vehicles/__tests__/ManualCanConfigSection.test.tsx
git commit -m "fix(frontend): editor Manual CAN sin default 16000 y valida param_id

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## FASE B — Validación en vivo del mapeo CAN (runbook, no TDD)

### Task 4: Descubrir el `param_id` y byte/bit correcto de cada salida

**Files:** ninguno (procedimiento de diagnóstico en vivo). Produce el mapeo que consume la Task 5.

**Prerequisito:** un vehículo con FMC650 conectado (verificar `ingest:conn:{imei}` y `● FMC Online` en el detalle). Acceso al PLC/CR2530 para observar si la salida física se activa, o a la herramienta del PLC.

- [ ] **Step 1: Confirmar el formato que el FMC acepta**

Con el código de Fase A ya desplegado, lanzar un toggle y mirar el `command_log`:
```bash
docker exec cmg-telematic1_postgres_1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -F"|" -c "SELECT to_char(sent_at,'"'"'HH24:MI:SS'"'"'), status, command, response FROM command_log WHERE command_type='"'"'MANUAL_CAN'"'"' ORDER BY sent_at DESC LIMIT 5;"'
```
Expected: con `param_id=16000` el status ahora debe ser `failed` (response `New value 16000:1;` clasificado como… NOTA: `New value 16000:1;` NO contiene marcadores de error, así que se marcará `confirmed`. El truncado a `:1` es la pista de que el param es escalar, no de 8 bytes — comparar el valor devuelto con el enviado: si difieren, el param es incorrecto).

- [ ] **Step 2: Probar el param candidato 16002 y verificar eco de 8 bytes**

Configurar temporalmente un slot con `param_id=16002` (vía UI, Task 5 lo formaliza) y lanzar un toggle. En logs del ingest:
```bash
docker logs cmg-telematic1_ingest-svc_1 --since 5m 2>&1 | grep -iE "manual can|codec 12"
```
Expected (éxito real): `setparam 16002:01FFFFFFFFFFFFFF` → `New value 16002:01FFFFFFFFFFFFFF;` (eco de los 8 bytes idéntico = el FMC almacenó el payload completo).

- [ ] **Step 3: Confirmar recepción en el PLC**

Con el FMC almacenando los 8 bytes, verificar en el CR2530/PLC que la trama CAN llega y la salida se activa. Si NO llega aun con el eco correcto: falta habilitar la emisión CAN (otro `setparam` de "enable"/CAN ID/periodo). Documentar contra la doc Teltonika FMC650 (sección Manual/User CAN output) el conjunto de params necesario.

- [ ] **Step 4: Documentar el mapeo final**

Producir la tabla definitiva: por cada salida (Detener Bomba, Detener Depresor, Reset Transfer, Reset Bomba, Reset Depresor) → `param_id` del mensaje CAN, `byte_index`, `bit_index`, y `function` (toggle/hold). Anotar si varias salidas comparten un mensaje CAN (bits del mismo slot) o necesitan slots/param_id distintos. Guardar el mapeo en la memoria `project_manual_can_plc_bug.md`.

---

## FASE C — Aplicar la configuración corregida (UI)

### Task 5: Corregir las plantillas en Admin → Plantillas

**Files:** ninguno (cambio de datos vía UI). Consume el mapeo de la Task 4.

- [ ] **Step 1: Editar la plantilla**

En Admin → Plantillas → "Sistema vacío-presión (cisterna)" → sección "Botones CAN manual (FMC650 → CR2530)": ajustar cada slot al `param_id` validado y cada botón a su byte/bit. Guardar (el editor ya bloquea param_id inválido tras Task 3).

- [ ] **Step 2: Verificar persistencia en BD**

```bash
docker exec cmg-telematic1_postgres_1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SELECT manual_can_slots FROM vehicle_type WHERE name='"'"'Sistema vacío-presión (cisterna)'"'"';"'
```
Expected: `param_id` ya NO es 16000 en ningún slot.

- [ ] **Step 2b (si aplica): replicar a otras plantillas afectadas.** Repetir si hay más `vehicle_type` con `param_id=16000`.

- [ ] **Step 3: Prueba funcional end-to-end**

Desde el detalle de un vehículo de esa plantilla, accionar cada botón y verificar: (a) el PLC ejecuta la salida; (b) `command_log` muestra `confirmed` con `response` reflejando los 8 bytes; (c) un comando inválido se marca `failed` (regresión de Fase A).

- [ ] **Step 4: Cerrar**

Actualizar `project_manual_can_plc_bug.md` a resuelto con el mapeo final y la fecha.

---

## Notas de despliegue

- **Backend (Task 1)** y **ingest (Task 2)** requieren rebuild + swap del contenedor (`core-api`, `ingest-svc`) con la receta `docker run` (bug compose v1.29.2). core-api necesita `--env-file /opt/cmg-telematic1/.env -v cmg-telematic1_uploads_data:/app/uploads --network-alias core-api -p 127.0.0.1:8010:8010`.
- **Frontend (Task 3)** requiere rebuild + swap del contenedor `frontend` (sin volumen, sin ports, alias `frontend`).
- Fases B y C no requieren despliegue (config/diagnóstico).

## Limpieza opcional (fuera de alcance, anotar)

- El endpoint legacy `POST /vehicles/{id}/commands/manual-can` (payload fijo `01FF…`/`00FF…`) ya no lo usa el frontend. Evaluar deprecarlo en una tarea aparte para evitar payloads incoherentes con la ruta `/toggle`.
