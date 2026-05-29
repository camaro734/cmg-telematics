"""system_settings table for global CMG configuration

Revision ID: 032
Revises: 031
Create Date: 2026-05-29

Tabla genérica clave/valor JSONB para configuración global del sistema.
Primera clave: 'smtp' — servidor de correo para alertas.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('key', sa.Text(), primary_key=True, nullable=False),
        sa.Column('value', JSONB(), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True),
                  server_default=sa.text('NOW()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('system_settings')
