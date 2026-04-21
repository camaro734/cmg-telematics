"""create work_cycle_definition and work_cycle

Revision ID: 006
Revises: 005
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_cycle_definition",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "vehicle_type_id", UUID(as_uuid=True),
            sa.ForeignKey("vehicle_type.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "tenant_id", UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("trigger_type", sa.String(30), nullable=False),
        sa.Column("trigger_config", JSONB, nullable=False, server_default="'{}'"),
        sa.Column("snapshot_fields", JSONB, nullable=False, server_default="'[]'"),
        sa.Column("aggregate_fields", JSONB, nullable=False, server_default="'[]'"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_wcd_vehicle_type_id", "work_cycle_definition", ["vehicle_type_id"])
    op.create_index("ix_wcd_tenant_id", "work_cycle_definition", ["tenant_id"])

    op.create_table(
        "work_cycle",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "vehicle_id", UUID(as_uuid=True),
            sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "definition_id", UUID(as_uuid=True),
            sa.ForeignKey("work_cycle_definition.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "tenant_id", UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("cycle_data", JSONB, nullable=False, server_default="'{}'"),
        sa.Column("lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("lon", sa.Numeric(9, 6), nullable=True),
    )
    op.create_index("ix_wc_vehicle_id", "work_cycle", ["vehicle_id"])
    op.create_index("ix_wc_definition_id", "work_cycle", ["definition_id"])
    op.create_index("ix_wc_tenant_id", "work_cycle", ["tenant_id"])
    op.create_index("ix_wc_started_at", "work_cycle", ["started_at"])


def downgrade() -> None:
    op.drop_table("work_cycle")
    op.drop_table("work_cycle_definition")
