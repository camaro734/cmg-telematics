"""vehicle_destination: destino activo por vehículo (rutas + ETA en vivo).

Revision ID: 061
Revises: 060
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_destination",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("assigned_by", UUID(as_uuid=True), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("arrived_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("vehicle_id", name="uq_vehicle_destination_vehicle_id"),
    )
    op.create_index("ix_vehicle_destination_tenant_id", "vehicle_destination", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_vehicle_destination_tenant_id", "vehicle_destination")
    op.drop_table("vehicle_destination")
