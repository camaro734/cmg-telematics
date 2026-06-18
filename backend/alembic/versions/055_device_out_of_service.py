"""device_out_of_service: estado 'fuera de servicio' para silenciar alerta de inactividad.

Un dispositivo fuera de servicio (desmontado / en reparación) no genera alerta de
'vehículo silencioso'. Es ortogonal a `active` (que significa dado de baja / oculto).
out_of_service_since sella el momento en que se marcó, para mostrar 'desde DD/MM'.

Revision ID: 055
Revises: 054
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device",
        sa.Column("out_of_service", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "device",
        sa.Column("out_of_service_since", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("device", "out_of_service_since")
    op.drop_column("device", "out_of_service")
