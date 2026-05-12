"""Tighten telemetry_1h continuous aggregate refresh policy

Antes: refresh cada 1h, end_offset 1h → la hora en curso nunca aparecía en reportes.
Ahora: refresh cada 15 min, end_offset 5 min → reportes con datos casi en tiempo real.

revision = '020'
down_revision = '019'
"""
from alembic import op


revision = '020'
down_revision = '019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT remove_continuous_aggregate_policy('telemetry_1h', if_exists => true);")
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1h',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '5 minutes',
            schedule_interval => INTERVAL '15 minutes');
    """)


def downgrade() -> None:
    op.execute("SELECT remove_continuous_aggregate_policy('telemetry_1h', if_exists => true);")
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1h',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour');
    """)
