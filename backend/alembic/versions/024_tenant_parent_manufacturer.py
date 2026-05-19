"""Add parent_manufacturer_id to tenant

Revision ID: 024
Revises: 023
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '024'
down_revision = '023'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenant',
        sa.Column(
            'parent_manufacturer_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenant.id', ondelete='RESTRICT'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_tenant_parent_manufacturer_id',
        'tenant',
        ['parent_manufacturer_id'],
        postgresql_where=sa.text('parent_manufacturer_id IS NOT NULL'),
    )
    op.create_check_constraint(
        'chk_only_clients_have_manufacturer',
        'tenant',
        "parent_manufacturer_id IS NULL OR tier = 'client'",
    )


def downgrade():
    op.drop_constraint('chk_only_clients_have_manufacturer', 'tenant', type_='check')
    op.drop_index('ix_tenant_parent_manufacturer_id', 'tenant')
    op.drop_column('tenant', 'parent_manufacturer_id')
