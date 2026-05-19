"""Add manufacturer_tenant_id to vehicle (denormalized for performance)

Revision ID: 025
Revises: 024
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '025'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'vehicle',
        sa.Column(
            'manufacturer_tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenant.id', ondelete='RESTRICT'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_vehicle_manufacturer_tenant_id',
        'vehicle',
        ['manufacturer_tenant_id'],
        postgresql_where=sa.text('manufacturer_tenant_id IS NOT NULL'),
    )


def downgrade():
    op.drop_index('ix_vehicle_manufacturer_tenant_id', 'vehicle')
    op.drop_column('vehicle', 'manufacturer_tenant_id')
