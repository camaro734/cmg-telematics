"""Add user_id FK to driver for 1:1 relationship with User

Revision ID: 029
Revises: 028
Create Date: 2026-05-19

Phase 2 enabler: links Driver entity to User for authentication.
Nullable to allow existing drivers without User; Phase 5 will migrate
or create User accounts for existing drivers.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('driver',
        sa.Column('user_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_driver_user_id', 'driver', ['user_id'],
        unique=True, postgresql_where=sa.text('user_id IS NOT NULL'))


def downgrade():
    op.drop_index('ix_driver_user_id', 'driver')
    op.drop_column('driver', 'user_id')
