"""Add driver-specific fields to user

Revision ID: 028
Revises: 027
"""

import sqlalchemy as sa
from alembic import op

revision = '028'
down_revision = '027'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user', sa.Column('driver_dni', sa.String(20), nullable=True))
    op.add_column('user', sa.Column('driver_license', sa.String(20), nullable=True))
    op.add_column('user', sa.Column('driver_license_expiry', sa.Date(), nullable=True))
    op.add_column('user', sa.Column('mobile_device_id', sa.String(100), nullable=True))
    op.add_column('user', sa.Column('last_mobile_login', sa.TIMESTAMP(timezone=True), nullable=True))

    op.create_index('ix_user_driver_dni', 'user', ['driver_dni'], unique=True,
                    postgresql_where=sa.text('driver_dni IS NOT NULL'))


def downgrade():
    op.drop_index('ix_user_driver_dni', 'user')
    op.drop_column('user', 'last_mobile_login')
    op.drop_column('user', 'mobile_device_id')
    op.drop_column('user', 'driver_license_expiry')
    op.drop_column('user', 'driver_license')
    op.drop_column('user', 'driver_dni')
