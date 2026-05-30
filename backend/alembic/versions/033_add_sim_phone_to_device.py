"""add sim_phone to device

Revision ID: 033
Revises: 032
Create Date: 2026-05-30

"""
from alembic import op
import sqlalchemy as sa

revision = '033'
down_revision = '032'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: la columna puede existir ya si fue añadida manualmente
    op.execute(
        "ALTER TABLE device ADD COLUMN IF NOT EXISTS sim_phone VARCHAR(20)"
    )


def downgrade() -> None:
    op.drop_column('device', 'sim_phone')
