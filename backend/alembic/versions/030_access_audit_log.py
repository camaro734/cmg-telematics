"""Add access_audit_log hypertable for RGPD compliance

Revision ID: 030
Revises: 029
Create Date: 2026-05-19

Records every cross-tenant access from CMG admins or Manufacturers
to vehicles/data belonging to Client tenants. Required for:
- RGPD compliance (Art. 30 + Art. 32 audit trail)
- DPA accountability (proving who accessed what and when)
- Client transparency (clients can review who from CMG/manufacturer
  has accessed their data)

Hypertable because volume will grow significantly.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'access_audit_log',
        sa.Column('id', postgresql.UUID(as_uuid=True),
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('time', sa.TIMESTAMP(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_tenant_tier', sa.String(20), nullable=False),
        sa.Column('target_vehicle_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('target_tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('operation', sa.String(20), nullable=False),
        sa.Column('scope', sa.String(20), nullable=False),
        sa.Column('justification', sa.Text(), nullable=True),
        sa.Column('endpoint', sa.String(200), nullable=True),
        sa.Column('ip_address', sa.String(50), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id', 'time'),
    )

    op.create_index(
        'ix_access_audit_target_tenant_time',
        'access_audit_log',
        ['target_tenant_id', sa.text('time DESC')],
    )
    op.create_index(
        'ix_access_audit_user_time',
        'access_audit_log',
        ['user_id', sa.text('time DESC')],
    )

    op.execute("""
        SELECT create_hypertable('access_audit_log', 'time',
                                 chunk_time_interval => interval '7 days',
                                 if_not_exists => TRUE);
    """)

    op.execute("""
        ALTER TABLE access_audit_log SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'target_tenant_id'
        );
    """)

    op.execute("""
        SELECT add_compression_policy('access_audit_log', INTERVAL '30 days');
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS access_audit_log CASCADE;")
