"""hide_location_from_upstream: oculta coordenadas del vehículo a usuarios upstream.

El dueño del vehículo (vehicle.tenant_id == user.tenant_id) siempre ve la ubicación.
Con este flag activo, NADIE por encima del dueño (fabricante, CMG) recibe lat/lon,
speed_kmh, heading ni altitude_m en ningún endpoint. Los datos se guardan en BD; el
filtro es de acceso en el momento de servir la respuesta, no de descarte en ingest.
Additive y reversible.

Revision ID: 059
Revises: 058
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle",
        sa.Column(
            "hide_location_from_upstream",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("vehicle", "hide_location_from_upstream")
