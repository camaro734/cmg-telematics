"""maintenance: foto de contadores en maintenance_log al registrar intervención

Revision ID: 047
Revises: 046
Create Date: 2026-06-11

Cambios:
- maintenance_log.counter_readings JSONB nullable
  Captura el valor actual de cada contador del plan en el momento de la
  intervención (audit trail). Los valores son los crudos del sensor:
  minutos para acumuladores CAN, horas para telemetry_1h, null para calendar.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "maintenance_log",
        sa.Column("counter_readings", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("maintenance_log", "counter_readings")
