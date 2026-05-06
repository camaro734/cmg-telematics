"""add portal_access_token to tenant

Revision ID: 018
Revises: 017
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa

revision = '018'
down_revision = '017'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tenant', sa.Column('portal_access_token', sa.String(64), nullable=True, unique=True))
    op.create_index('ix_tenant_portal_access_token', 'tenant', ['portal_access_token'], unique=True)


def downgrade():
    op.drop_index('ix_tenant_portal_access_token', table_name='tenant')
    op.drop_column('tenant', 'portal_access_token')
