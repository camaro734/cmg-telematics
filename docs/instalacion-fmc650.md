# Estándar de cableado Teltonika FMC650 — CMG

## Entradas digitales (DIN)

| Puerto | Señal         | AVL ID | Notas                              |
|--------|---------------|--------|------------------------------------|
| DIN1   | Ignición      | avl_1  | Contacto llave / señal ACC         |
| DIN2   | PTO           | avl_2  | Toma de fuerza (power take-off)    |

Este es el estándar Teltonika por defecto y el utilizado en todos los
vehículos CMG instalados desde la primera unidad.

## Lógica de detección en software

**Ignición** (prioridad decreciente):
1. RPM CAN > 200 raw (avl_30, avl_36, avl_85, avl_269, avl_10309)
2. DIN1 = 1 (avl_1) — fallback cuando no hay CAN de RPM
3. avl_239 (CAN ignition signal directo)

**PTO** (prioridad decreciente):
1. avl_179 (CAN PTO signal directo)
2. DIN2 = 1 (avl_2) — fallback cuando no hay CAN de PTO

## Ficheros afectados

- `services/ingest/src/writer.py` — `_compute_ignition()`, `write_record()`
- `services/ingest/src/publisher.py` — `_compute_ignition()`, `_compute_pto()`
- `backend/app/api/v1/vehicles.py` — `_ignition_from_can()`, fallbacks PTO en bulk/detail

## Historial

| Fecha      | Evento                                                              |
|------------|---------------------------------------------------------------------|
| 2026-05-13 | Recableado físico documentado en CLAUDE.md (DIN1↔DIN2 swap)        |
| 2026-05-19 | Auditoría detecta que el swap solo se aplicó a los comentarios,     |
|            | no a la lógica real del código                                      |
| 2026-05-25 | Bug corregido — código alineado con cableado físico real            |

> **Nota:** Los registros históricos en `telemetry_record` anteriores
> a 2026-05-25 tienen ignición/PTO interpretados con el mapeo incorrecto.
> El rereprocesado está fuera de alcance.
