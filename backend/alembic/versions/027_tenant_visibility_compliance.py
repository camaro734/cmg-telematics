"""Add visibility flags for manufacturer and compliance_level

Revision ID: 027
Revises: 026
"""

import sqlalchemy as sa
from alembic import op

revision = '027'
down_revision = '026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenant',
        sa.Column('manufacturer_can_view_operations', sa.Boolean(), server_default='false', nullable=False),
    )
    op.add_column(
        'tenant',
        sa.Column('manufacturer_can_view_can_data', sa.Boolean(), server_default='true', nullable=False),
    )
    op.add_column(
        'tenant',
        sa.Column('manufacturer_can_create_rules', sa.Boolean(), server_default='true', nullable=False),
    )
    op.add_column(
        'tenant',
        sa.Column(
            'compliance_level',
            sa.String(20),
            server_default='standard',
            nullable=False,
        ),
    )
    op.create_check_constraint(
        'chk_compliance_level',
        'tenant',
        "compliance_level IN ('standard', 'enhanced', 'defense')",
    )


def downgrade():
    op.drop_constraint('chk_compliance_level', 'tenant', type_='check')
    op.drop_column('tenant', 'compliance_level')
    op.drop_column('tenant', 'manufacturer_can_create_rules')
    op.drop_column('tenant', 'manufacturer_can_view_can_data')
    op.drop_column('tenant', 'manufacturer_can_view_operations')
