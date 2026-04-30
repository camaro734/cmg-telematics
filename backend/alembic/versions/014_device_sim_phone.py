"""add sim_phone to device

Revision ID: 014
Revises: 013
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa

revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('device', sa.Column('sim_phone', sa.String(20), nullable=True))

def downgrade():
    op.drop_column('device', 'sim_phone')
