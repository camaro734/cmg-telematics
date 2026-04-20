"""add tenant_id to device

Revision ID: 005
Revises: 004
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device",
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_device_tenant_id", "device", ["tenant_id"])
    op.execute(
        """
        UPDATE device
        SET tenant_id = (
            SELECT tenant_id FROM vehicle WHERE vehicle.id = device.vehicle_id
        )
        WHERE vehicle_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_device_tenant_id", table_name="device")
    op.drop_column("device", "tenant_id")
