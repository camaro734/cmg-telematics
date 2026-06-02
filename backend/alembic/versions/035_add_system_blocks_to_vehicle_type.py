"""add system_blocks to vehicle_type

Revision ID: 035
Revises: 034
Create Date: 2026-06-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '035'
down_revision = '034'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE vehicle_type ADD COLUMN IF NOT EXISTS system_blocks JSONB NOT NULL DEFAULT '[]'"
    )


def downgrade() -> None:
    op.drop_column('vehicle_type', 'system_blocks')
