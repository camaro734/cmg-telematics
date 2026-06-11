"""maintenance: catálogo de contadores por tipo + owner_tenant_id en plan

Revision ID: 046
Revises: 045
Create Date: 2026-06-11

Cambios:
- vehicle_type.maintenance_counters JSONB NOT NULL DEFAULT '[]'
  Seed: tipos ya implementados (pto_hours, engine_hours, calendar_days) en los
  dos tipos vivos. Los contadores PLC entran en M2.
- maintenance_plan.owner_tenant_id UUID FK tenant NOT NULL
  Backfill: tenant_id del propio plan (propietario inicial = tenant del vehículo).
"""
import json
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "046"
down_revision = "045"
branch_labels = None
depends_on = None

_COUNTER_SEED = json.dumps([
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
    # ── vehicle_type.maintenance_counters ─────────────────────────────────────
    op.add_column(
        "vehicle_type",
        sa.Column(
            "maintenance_counters",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )
    # Seed solo para los tipos con implementación confirmada.
    # _COUNTER_SEED es una constante de migración (solo double quotes JSON),
    # sin entrada de usuario → interpolación segura.
    op.execute(
        f"UPDATE vehicle_type SET maintenance_counters = '{_COUNTER_SEED}'::jsonb"
        " WHERE slug IN ('camion_de_basura', 'vacuum-pressure')"
    )

    # ── maintenance_plan.owner_tenant_id ──────────────────────────────────────
    # Paso 1: añadir nullable para poder hacer el backfill
    op.add_column(
        "maintenance_plan",
        sa.Column(
            "owner_tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # Paso 2: backfill — propietario inicial = tenant del vehículo
    op.execute(
        "UPDATE maintenance_plan SET owner_tenant_id = tenant_id"
    )
    # Paso 3: hacer NOT NULL ahora que todas las filas tienen valor
    op.alter_column("maintenance_plan", "owner_tenant_id", nullable=False)

    # Índice para la consulta "planes del propietario"
    op.create_index(
        "ix_maintenance_plan_owner_tenant_id",
        "maintenance_plan",
        ["owner_tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_maintenance_plan_owner_tenant_id", table_name="maintenance_plan")
    op.drop_column("maintenance_plan", "owner_tenant_id")
    op.drop_column("vehicle_type", "maintenance_counters")
