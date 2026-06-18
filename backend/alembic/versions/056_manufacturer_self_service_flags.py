"""manufacturer_self_service_flags: el fabricante puede gestionar sus clientes y traspasar vehículos.

Dos flags que CMG activa por fabricante. Por defecto false (no autogestiona hasta que CMG lo habilita).

Revision ID: 056
Revises: 055
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("manufacturer_can_manage_clients", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "tenant",
        sa.Column("manufacturer_can_transfer_vehicles", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tenant", "manufacturer_can_transfer_vehicles")
    op.drop_column("tenant", "manufacturer_can_manage_clients")
