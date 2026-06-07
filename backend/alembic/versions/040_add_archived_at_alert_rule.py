"""add archived_at to alert_rule

Revision ID: 040
Revises: 039
Create Date: 2026-06-06

"""
from alembic import op
import sqlalchemy as sa


revision = '040'
down_revision = '039'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'alert_rule',
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column('alert_rule', 'archived_at')
