"""index on alert_instance (vehicle_id, rule_id, status)

Revision ID: 043
Revises: 042
Create Date: 2026-06-07

Necesario para que el sweep de vehículo mudo pueda deduplicar y resolver
alertas de silencio sin seq-scan sobre alert_instance.
"""
from alembic import op

revision = '043'
down_revision = '042'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX ix_alert_instance_vehicle_rule_status "
        "ON alert_instance (vehicle_id, rule_id, status)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_alert_instance_vehicle_rule_status")
