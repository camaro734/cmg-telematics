"""client_can_actuate_controls: permiso por cliente para accionar controles (DOUT/Manual CAN).

Por defecto false: los clientes que cuelgan de un fabricante solo ven telemetría hasta que
CMG les concede el control, cliente a cliente. No afecta a cmg/manufacturer ni a clientes
directos de CMG (eximidos en la lógica de autorización). Additive y reversible.

Revision ID: 058
Revises: 057
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("can_actuate_controls", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tenant", "can_actuate_controls")
