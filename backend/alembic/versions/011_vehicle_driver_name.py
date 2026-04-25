"""add driver_name to vehicle

Revision ID: 011
Revises: 010
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("vehicle", sa.Column("driver_name", sa.Text, nullable=True))

def downgrade():
    op.drop_column("vehicle", "driver_name")
