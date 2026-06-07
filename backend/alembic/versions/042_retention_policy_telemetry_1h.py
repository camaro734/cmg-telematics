"""retention policy 1 year on telemetry_1h continuous aggregate

Revision ID: 042
Revises: 041
Create Date: 2026-06-07

"""
from alembic import op

revision = '042'
down_revision = '041'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "SELECT add_retention_policy('telemetry_1h', drop_after => INTERVAL '1 year')"
    )


def downgrade():
    op.execute(
        "SELECT remove_retention_policy('telemetry_1h', if_exists => TRUE)"
    )
