"""manual_can_button table + vehicle_manual_can_slot.current_value column.

Revision ID: 052
Revises: 051
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle_manual_can_slot",
        sa.Column("current_value", sa.LargeBinary, nullable=True),
    )

    op.create_table(
        "manual_can_button",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("slot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("byte_index", sa.SmallInteger, nullable=False),
        sa.Column("bit_index", sa.SmallInteger, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("sort_order", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["slot_id"], ["vehicle_manual_can_slot.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.CheckConstraint("byte_index >= 0 AND byte_index <= 7", name="ck_manual_can_button_byte_index"),
        sa.CheckConstraint("bit_index >= 0 AND bit_index <= 7", name="ck_manual_can_button_bit_index"),
        sa.UniqueConstraint("slot_id", "byte_index", "bit_index", name="uq_manual_can_button_bit"),
    )

    op.create_index("ix_manual_can_button_slot_id", "manual_can_button", ["slot_id"])
    op.create_index("ix_manual_can_button_tenant_id", "manual_can_button", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_manual_can_button_tenant_id", table_name="manual_can_button")
    op.drop_index("ix_manual_can_button_slot_id", table_name="manual_can_button")
    op.drop_table("manual_can_button")
    op.drop_column("vehicle_manual_can_slot", "current_value")
