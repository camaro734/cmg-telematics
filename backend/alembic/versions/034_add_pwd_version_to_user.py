"""add pwd_version to user

Revision ID: 034
Revises: 033
Create Date: 2026-05-31

"""
from alembic import op
import sqlalchemy as sa

revision = '034'
down_revision = '033'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user',
        sa.Column('pwd_version', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('user', 'pwd_version')
