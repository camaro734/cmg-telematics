"""add FK constraints: maintenance_plan.tenant_id -> tenant.id, maintenance_log.plan_id ON DELETE SET NULL

Revision ID: 004
Revises: 003
"""
from alembic import op

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Issue 1: maintenance_plan.tenant_id had no FK — add it
    op.create_foreign_key(
        'fk_maintenance_plan_tenant_id',
        'maintenance_plan', 'tenant',
        ['tenant_id'], ['id'],
        ondelete='CASCADE',
    )

    # Issue 2: maintenance_log.plan_id FK existed but without ON DELETE SET NULL
    # (PostgreSQL defaulted to RESTRICT). Drop and recreate with correct behaviour.
    op.drop_constraint('maintenance_log_plan_id_fkey', 'maintenance_log', type_='foreignkey')
    op.create_foreign_key(
        'fk_maintenance_log_plan_id',
        'maintenance_log', 'maintenance_plan',
        ['plan_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    # Restore original plan_id FK (RESTRICT — PostgreSQL default)
    op.drop_constraint('fk_maintenance_log_plan_id', 'maintenance_log', type_='foreignkey')
    op.create_foreign_key(
        'maintenance_log_plan_id_fkey',
        'maintenance_log', 'maintenance_plan',
        ['plan_id'], ['id'],
    )

    # Remove tenant FK from maintenance_plan
    op.drop_constraint('fk_maintenance_plan_tenant_id', 'maintenance_plan', type_='foreignkey')
