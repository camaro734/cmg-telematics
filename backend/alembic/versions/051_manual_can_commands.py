"""command_log extend + vehicle_manual_can_slot table for Manual CAN setparam commands.

Revision ID: 051
Revises: 050
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TABLE command_log — añadir columnas para Manual CAN + auditoría mejorada
    op.add_column(
        "command_log",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_command_log_user_id",
        "command_log", "user",
        ["user_id"], ["id"],
        ondelete="SET NULL"
    )

    op.add_column(
        "command_log",
        sa.Column("command_type", sa.String(20), nullable=False, server_default="DOUT")
    )

    op.add_column(
        "command_log",
        sa.Column("param_id", sa.Integer, nullable=True)
    )

    op.add_column(
        "command_log",
        sa.Column("param_value", sa.String(16), nullable=True)
    )

    op.add_column(
        "command_log",
        sa.Column("response_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.add_column(
        "command_log",
        sa.Column("latency_ms", sa.Integer, nullable=True)
    )

    op.add_column(
        "command_log",
        sa.Column("imei_snapshot", sa.String(20), nullable=True)
    )

    # Índice para búsqueda rápida por IMEI + timestamp
    op.create_index(
        "ix_command_log_imei_sent",
        "command_log",
        ["imei_snapshot", sa.desc("sent_at")],
        postgresql_where=sa.text("imei_snapshot IS NOT NULL")
    )

    # CREATE TABLE vehicle_manual_can_slot
    op.create_table(
        "vehicle_manual_can_slot",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vehicle_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slot", sa.SmallInteger, nullable=False),
        sa.Column("param_id", sa.Integer, nullable=False),
        sa.Column("description", sa.String(100), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["vehicle_id"], ["vehicle.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("vehicle_id", "slot", name="uq_vehicle_slot"),
        sa.CheckConstraint("slot >= 0 AND slot <= 9", name="ck_manual_can_slot_range")
    )

    op.create_index(
        "ix_vehicle_manual_can_slot_vehicle",
        "vehicle_manual_can_slot",
        ["vehicle_id"]
    )


def downgrade() -> None:
    # DROP TABLE vehicle_manual_can_slot
    op.drop_index("ix_vehicle_manual_can_slot_vehicle")
    op.drop_table("vehicle_manual_can_slot")

    # ALTER TABLE command_log — eliminar columnas y índice
    op.drop_index("ix_command_log_imei_sent")
    op.drop_constraint("fk_command_log_user_id", "command_log", type_="foreignkey")
    op.drop_column("command_log", "imei_snapshot")
    op.drop_column("command_log", "latency_ms")
    op.drop_column("command_log", "response_at")
    op.drop_column("command_log", "param_value")
    op.drop_column("command_log", "param_id")
    op.drop_column("command_log", "command_type")
    op.drop_column("command_log", "user_id")
