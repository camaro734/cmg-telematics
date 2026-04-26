"""create command_log table

Revision ID: 013
Revises: 012
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "command_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", UUID(as_uuid=True), sa.ForeignKey("device.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("command", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("response", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
    )
    op.create_index("ix_command_log_vehicle_id", "command_log", ["vehicle_id"])
    op.create_index("ix_command_log_device_id", "command_log", ["device_id"])
    op.create_index("ix_command_log_sent_at", "command_log", ["sent_at"])


def downgrade() -> None:
    op.drop_index("ix_command_log_sent_at", "command_log")
    op.drop_index("ix_command_log_device_id", "command_log")
    op.drop_index("ix_command_log_vehicle_id", "command_log")
    op.drop_table("command_log")
