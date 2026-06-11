"""manufacturer_can_view_operations: cambiar default a true y actualizar tenants cliente existentes.

Revision ID: 050
Revises: 049
Create Date: 2026-06-11
"""
from alembic import op

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cambiar server default a true para nuevos tenants cliente
    op.execute(
        "ALTER TABLE tenant ALTER COLUMN manufacturer_can_view_operations SET DEFAULT true"
    )
    # Activar el flag en todos los tenants cliente existentes
    op.execute(
        "UPDATE tenant SET manufacturer_can_view_operations = true WHERE tier = 'client'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE tenant ALTER COLUMN manufacturer_can_view_operations SET DEFAULT false"
    )
    op.execute(
        "UPDATE tenant SET manufacturer_can_view_operations = false WHERE tier = 'client'"
    )
