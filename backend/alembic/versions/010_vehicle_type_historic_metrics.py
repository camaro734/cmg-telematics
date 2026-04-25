"""add historic_metrics to vehicle_type

Revision ID: 010
Revises: 009
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("vehicle_type", sa.Column("historic_metrics", JSONB, nullable=False, server_default="[]"))

def downgrade():
    op.drop_column("vehicle_type", "historic_metrics")
