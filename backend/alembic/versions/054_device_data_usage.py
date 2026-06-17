"""device_data_usage: histórico mensual de bytes transmitidos por dispositivo.

Feature autocontenida para estimar el consumo de la tarjeta SIM. Una fila por
dispositivo y mes natural (year_month = 'YYYY-MM'). El total acumulado se calcula
como SUM(bytes) sobre todas las filas del dispositivo.

Revision ID: 054
Revises: 053
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_data_usage",
        sa.Column("device_id", UUID(as_uuid=True), nullable=False),
        sa.Column("year_month", sa.String(length=7), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["device_id"], ["device.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("device_id", "year_month"),
    )


def downgrade() -> None:
    op.drop_table("device_data_usage")
