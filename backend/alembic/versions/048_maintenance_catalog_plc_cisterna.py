"""maintenance: catálogo PLC ampliado para cisterna (vacuum-pressure)

Revision ID: 048
Revises: 047
Create Date: 2026-06-11

Cambios:
- Actualiza maintenance_counters de vehicle_type 'vacuum-pressure' con los 4
  nuevos contadores CAN confirmados por análisis de telemetría real (90d):
    pump_hours     → avl_148, sum de deltas positivos
    depressor_hours → avl_150, sum de deltas positivos
    transfer_hours  → avl_146, sum de deltas positivos
    odometer_km    → avl_10314, max-min en ventana (excluye ceros de arranque)
- camion_de_basura conserva solo pto_hours/engine_hours/calendar_days;
  sus AVL IDs tienen semántica de presión/cantidad, no acumuladores de tiempo.
"""
import json
from alembic import op

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None

_CISTERNA_COUNTERS_M2 = json.dumps([
    {
        "type": "pto_hours",
        "label": "Horas PTO",
        "unit": "h",
        "source_type": "telemetry_1h",
        "source_key": "pto_active_minutes",
        "semantics": "sum",
    },
    {
        "type": "engine_hours",
        "label": "Horas motor",
        "unit": "h",
        "source_type": "telemetry_1h",
        "source_key": "engine_on_minutes",
        "semantics": "sum",
    },
    {
        "type": "calendar_days",
        "label": "Calendario",
        "unit": "días",
        "source_type": "calendar",
        "source_key": None,
        "semantics": None,
    },
    {
        "type": "pump_hours",
        "label": "Horas bomba",
        "unit": "h",
        "source_type": "can_data",
        "source_key": "avl_148",
        "semantics": "sum",
    },
    {
        "type": "depressor_hours",
        "label": "Horas depresor",
        "unit": "h",
        "source_type": "can_data",
        "source_key": "avl_150",
        "semantics": "sum",
    },
    {
        "type": "transfer_hours",
        "label": "Horas transferencia",
        "unit": "h",
        "source_type": "can_data",
        "source_key": "avl_146",
        "semantics": "sum",
    },
    {
        "type": "odometer_km",
        "label": "Kilómetros totales",
        "unit": "km",
        "source_type": "can_data",
        "source_key": "avl_10314",
        "semantics": "max_minus_min",
    },
])

_M1_SEED = json.dumps([
    {
        "type": "pto_hours",
        "label": "Horas PTO",
        "unit": "h",
        "source_type": "telemetry_1h",
        "source_key": "pto_active_minutes",
        "semantics": "sum",
    },
    {
        "type": "engine_hours",
        "label": "Horas motor",
        "unit": "h",
        "source_type": "telemetry_1h",
        "source_key": "engine_on_minutes",
        "semantics": "sum",
    },
    {
        "type": "calendar_days",
        "label": "Calendario",
        "unit": "días",
        "source_type": "calendar",
        "source_key": None,
        "semantics": None,
    },
])


def upgrade() -> None:
    # Solo actualiza cisterna; camion_de_basura mantiene el seed de M1.
    op.execute(
        f"UPDATE vehicle_type SET maintenance_counters = '{_CISTERNA_COUNTERS_M2}'::jsonb "
        "WHERE slug = 'vacuum-pressure'"
    )


def downgrade() -> None:
    op.execute(
        f"UPDATE vehicle_type SET maintenance_counters = '{_M1_SEED}'::jsonb "
        "WHERE slug = 'vacuum-pressure'"
    )
