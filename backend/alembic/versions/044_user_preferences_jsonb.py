"""Add preferences JSONB column to user table

Revision ID: 044
Revises: 043
Create Date: 2026-06-08

Columna preferences JSONB nullable para almacenar preferencias personales
por usuario (métricas históricas visibles/orden por tipo de vehículo).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '044'
down_revision = '043'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user', sa.Column('preferences', JSONB(), nullable=True))


def downgrade():
    op.drop_column('user', 'preferences')
