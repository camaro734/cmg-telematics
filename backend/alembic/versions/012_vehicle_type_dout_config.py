"""add dout_config to vehicle_type

Revision ID: 012
Revises: 011
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle_type",
        sa.Column("dout_config", JSONB, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("vehicle_type", "dout_config")
