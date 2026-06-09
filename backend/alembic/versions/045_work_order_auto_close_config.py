"""Add auto_close_config JSONB column to work_order

Revision ID: 045
Revises: 044
Create Date: 2026-06-09

Columna nullable que almacena la configuración de cierre automático de paradas
por geocerca + señal CAN. NULL = feature desactivada para esa orden.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '045'
down_revision = '044'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_order', sa.Column('auto_close_config', JSONB(), nullable=True))


def downgrade():
    op.drop_column('work_order', 'auto_close_config')
