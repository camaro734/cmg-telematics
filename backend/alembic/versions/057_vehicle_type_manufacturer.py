"""vehicle_type_manufacturer: asigna plantillas (tipos de vehículo) a fabricantes.

Tabla de asociación. Lista blanca: el fabricante solo ve en el desplegable de
creación de vehículos las plantillas que CMG le asigne. Sus subclientes heredan
el alcance vía tenant.parent_manufacturer_id. Additive y reversible.

Revision ID: 057
Revises: 056
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_type_manufacturer",
        sa.Column("vehicle_type_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["vehicle_type_id"], ["vehicle_type.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("vehicle_type_id", "tenant_id", name="pk_vehicle_type_manufacturer"),
    )
    # Índice por tenant: el filtro del desplegable consulta por fabricante.
    op.create_index(
        "ix_vehicle_type_manufacturer_tenant_id",
        "vehicle_type_manufacturer",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_vehicle_type_manufacturer_tenant_id", table_name="vehicle_type_manufacturer")
    op.drop_table("vehicle_type_manufacturer")
