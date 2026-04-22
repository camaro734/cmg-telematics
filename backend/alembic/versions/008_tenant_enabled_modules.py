"""add enabled_modules to tenant

Revision ID: 008
Revises: 007
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("enabled_modules", sa.ARRAY(sa.Text()), nullable=False, server_default="{}"),
    )
    op.execute(
        "UPDATE tenant SET enabled_modules = ARRAY['fleet','alerts','maintenance','reports'] "
        "WHERE tier IN ('client', 'subclient')"
    )


def downgrade() -> None:
    op.drop_column("tenant", "enabled_modules")
