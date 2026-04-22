"""add maintenance_templates to vehicle_type and document_url to maintenance_log

Revision ID: 009
Revises: 008
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle_type",
        sa.Column(
            "maintenance_templates",
            JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "maintenance_log",
        sa.Column("document_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("maintenance_log", "document_url")
    op.drop_column("vehicle_type", "maintenance_templates")
