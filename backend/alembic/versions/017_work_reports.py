"""add work_report table

Revision ID: 017
Revises: 016
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'work_report',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('work_order_id', UUID(as_uuid=True), sa.ForeignKey('work_order.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('vehicle_id', UUID(as_uuid=True), sa.ForeignKey('vehicle.id', ondelete='SET NULL'), nullable=True),
        sa.Column('driver_id', UUID(as_uuid=True), sa.ForeignKey('driver.id', ondelete='SET NULL'), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('work_duration_minutes', sa.Integer, nullable=True),
        sa.Column('photo_urls', JSONB, server_default=sa.text("'[]'"), nullable=False),
        sa.Column('signature_url', sa.Text, nullable=True),
        sa.Column('materials_used', JSONB, server_default=sa.text("'[]'"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_work_report_tenant_id', 'work_report', ['tenant_id'])
    op.create_index('ix_work_report_work_order_id', 'work_report', ['work_order_id'])


def downgrade():
    op.drop_table('work_report')
