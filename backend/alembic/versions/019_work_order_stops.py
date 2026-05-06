"""add work_order_stop table

Revision ID: 019
Revises: 018
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '019'
down_revision = '018'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'work_order_stop',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('work_order_id', UUID(as_uuid=True),
                  sa.ForeignKey('work_order.id', ondelete='CASCADE'), nullable=False),
        sa.Column('order_index', sa.Integer, nullable=False, default=0),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('address', sa.String(500), nullable=True),
        sa.Column('lat', sa.Float, nullable=True),
        sa.Column('lon', sa.Float, nullable=True),
        sa.Column('arrival_radius_m', sa.Integer, nullable=False, server_default='150'),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('client_name', sa.String(200), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('arrived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('pto_minutes', sa.Float, nullable=True),
        sa.Column('fuel_l', sa.Float, nullable=True),
        sa.Column('rpm_avg', sa.Float, nullable=True),
        sa.Column('pump_minutes', sa.Float, nullable=True),
        sa.Column('pressure_min', sa.Float, nullable=True),
        sa.Column('pressure_max', sa.Float, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('pending','arrived','in_progress','done','skipped')",
            name='ck_work_order_stop_status',
        ),
    )
    op.create_index('ix_wos_work_order_id', 'work_order_stop', ['work_order_id'])
    op.create_index('ix_wos_order_index',   'work_order_stop', ['work_order_id', 'order_index'])


def downgrade():
    op.drop_table('work_order_stop')
