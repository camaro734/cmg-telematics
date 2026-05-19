"""Add manufacturer tier to tenant tier check constraint

Revision ID: 023
Revises: 022
Create Date: 2026-05-19

NOTE: la spec asume un enum PostgreSQL tenant_tier_enum, pero el schema real usa
VARCHAR(20) con CHECK constraint ck_tenant_tier. Se adapta la migración para
hacer DROP + CREATE del constraint en lugar de ALTER TYPE.
"""

from alembic import op

revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_tenant_tier', 'tenant', type_='check')
    op.create_check_constraint(
        'ck_tenant_tier',
        'tenant',
        "tier IN ('cmg', 'manufacturer', 'client', 'subclient')",
    )


def downgrade():
    op.drop_constraint('ck_tenant_tier', 'tenant', type_='check')
    op.create_check_constraint(
        'ck_tenant_tier',
        'tenant',
        "tier IN ('cmg', 'client', 'subclient')",
    )
