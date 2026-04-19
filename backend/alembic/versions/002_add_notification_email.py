"""add notification_email to tenant

Revision ID: 002
Revises: 001
Create Date: 2026-04-19
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenant", sa.Column("notification_email", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "notification_email")
