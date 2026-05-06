"""add work_order table

Revision ID: 016
Revises: 015
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '016'
down_revision = '015'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'work_order',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('vehicle_id', UUID(as_uuid=True), sa.ForeignKey('vehicle.id', ondelete='SET NULL'), nullable=True),
        sa.Column('driver_id', UUID(as_uuid=True), sa.ForeignKey('driver.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('priority', sa.String(10), nullable=False, server_default='normal'),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('location_address', sa.String(500), nullable=True),
        sa.Column('location_lat', sa.Float, nullable=True),
        sa.Column('location_lon', sa.Float, nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('pending','in_progress','done','cancelled')", name='ck_work_order_status'),
        sa.CheckConstraint("priority IN ('low','normal','high','urgent')", name='ck_work_order_priority'),
    )
    op.create_index('ix_work_order_tenant_id', 'work_order', ['tenant_id'])
    op.create_index('ix_work_order_vehicle_id', 'work_order', ['vehicle_id'])
    op.create_index('ix_work_order_status', 'work_order', ['status'])


def downgrade():
    op.drop_table('work_order')
