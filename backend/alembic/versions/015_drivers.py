"""add driver and vehicle_driver_assignment tables

Revision ID: 015
Revises: 014
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'driver',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('full_name', sa.String(200), nullable=False),
        sa.Column('phone', sa.String(30), nullable=True),
        sa.Column('license_number', sa.String(50), nullable=True),
        sa.Column('license_expiry', sa.Date, nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('active', sa.Boolean, default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_driver_tenant_id', 'driver', ['tenant_id'])

    op.create_table(
        'vehicle_driver_assignment',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('vehicle_id', UUID(as_uuid=True), sa.ForeignKey('vehicle.id', ondelete='CASCADE'), nullable=False),
        sa.Column('driver_id', UUID(as_uuid=True), sa.ForeignKey('driver.id', ondelete='CASCADE'), nullable=False),
        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_vda_vehicle_id', 'vehicle_driver_assignment', ['vehicle_id'])
    op.create_index('ix_vda_driver_id', 'vehicle_driver_assignment', ['driver_id'])


def downgrade():
    op.drop_table('vehicle_driver_assignment')
    op.drop_table('driver')
