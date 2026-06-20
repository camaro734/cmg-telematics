"""Location access grant: modelo escalonado de privacidad de ubicación.

Elimina el booleano hide_location_from_upstream (modelo binario) y crea la tabla
location_access_grant que permite permisos nivel a nivel (dueño → parent directo
→ su parent → CMG). Cada fila representa una concesión de UN eslabón a su parent.

Revision ID: 060
Revises: 059
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # DROP columna obsoleta (en producción 0 vehículos tenían el flag activo)
    op.drop_column("vehicle", "hide_location_from_upstream")

    # CREATE tabla de grants escalonados
    op.create_table(
        "location_access_grant",
        sa.Column(
            "vehicle_id",
            UUID(as_uuid=True),
            sa.ForeignKey("vehicle.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "granting_tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "granted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("vehicle_id", "granting_tenant_id"),
    )
    op.create_index(
        "ix_lag_vehicle_id",
        "location_access_grant",
        ["vehicle_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_lag_vehicle_id", "location_access_grant")
    op.drop_table("location_access_grant")
    op.add_column(
        "vehicle",
        sa.Column(
            "hide_location_from_upstream",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
