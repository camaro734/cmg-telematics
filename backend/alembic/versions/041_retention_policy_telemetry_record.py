"""retention policy 90 days on telemetry_record

Revision ID: 041
Revises: 040
Create Date: 2026-06-07

"""
from alembic import op

revision = '041'
down_revision = '040'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "SELECT add_retention_policy('telemetry_record', drop_after => INTERVAL '90 days')"
    )


def downgrade():
    op.execute(
        "SELECT remove_retention_policy('telemetry_record', if_exists => TRUE)"
    )
