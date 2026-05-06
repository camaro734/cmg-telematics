# Fix: GPS Noise + PTO Fallback
**Fecha:** 2026-04-30

---

## BUG 1 — GPS noise en mapa cuando vehículo está parado

**Síntoma:** Líneas erráticas en el mapa cuando el vehículo está detenido. El FMC650 envía puntos GPS cada 30 s aunque esté parado, y los últimos puntos antes de parar más los del reposo creaban una "cola" de líneas.

**Ficheros modificados:**
- `frontend/src/features/vehicle/TrackMap.tsx`
- `frontend/src/lib/types.ts`

**Fix aplicado:**

`TrackMap.tsx`:
- Umbral de distancia mínima: 15 m → **25 m**
- Nuevo filtro de velocidad: si `speed_kmh <= 2` en el punto actual Y en el punto anterior, Y distancia `<= 25 m`, el segmento se descarta (solo se mantiene el punto más reciente)
- El marcador de posición actual se mantiene siempre (ya existía fuera del condicional, se dejó intacto)
- El fit-bounds usa el array filtrado

`types.ts`:
- Añadido `speed_kmh?: number | null` a `TrackPoint` para que el filtro pueda leer el campo que el backend ya devuelve

**Resultado:** build `npm run build` exitoso — 950 módulos, 0 errores.

---

## BUG 2 — PTO muestra OFF aunque DIN2=1 / AVL179=1

**Síntoma:** El StatusCard de PTO mostraba OFF aunque el vehículo tenía la toma de fuerza activa. El campo `pto_active` en Redis podía estar desactualizado (escrito por una versión anterior del publisher).

**Ficheros modificados:**
- `backend/app/api/v1/vehicles.py`
- `frontend/src/features/vehicle/VehicleDetailPage.tsx`

**Fix aplicado:**

`vehicles.py` (endpoint `GET /vehicles/{id}/status`, líneas ~459–482):
```python
# Fallback: Redis puede tener pto_active=false de una versión anterior del publisher.
# Si AVL 2 (DIN2) o AVL 179 (estado J1939 PTO) están activos, corregimos el valor.
if not pto_active and can_data:
    if can_data.get("avl_2") == 1 or can_data.get("avl_179") == 1:
        pto_active = True
```
La corrección se aplica antes de construir y retornar el `VehicleStatus`.

`VehicleDetailPage.tsx` (StatusCard PTO, línea ~318):
- Condición de activación ampliada:
  `status.pto_active || status.can_data?.avl_2 === 1 || status.can_data?.avl_179 === 1`
- Aplica tanto al `value` (boolean) como al `color` del badge

**Fuentes de fallback en orden de prioridad:**
1. `pto_active` del hash Redis (valor calculado por publisher)
2. `can_data.avl_2 === 1` — DIN2 directo del FMC650
3. `can_data.avl_179 === 1` — estado PTO por J1939 CAN bus

---

## Verificación

| Cambio | Estado |
|--------|--------|
| Frontend `npm run build` | ✅ 0 errores, 950 módulos |
| Backend vehicles.py | ✅ Aplicado, requiere restart `core-api` |

**Pendiente:**
- Reiniciar el contenedor `core-api` para que el fix del backend entre en efecto:
  ```bash
  docker compose restart core-api
  ```
