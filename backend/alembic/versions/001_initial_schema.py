# backend/alembic/versions/001_initial_schema.py
"""initial schema with TimescaleDB

Revision ID: 001
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")

    op.create_table(
        "tenant",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tier", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("brand_name", sa.String(200), nullable=True),
        sa.Column("brand_color", sa.String(7), nullable=True),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("custom_domain", sa.String(200), unique=True, nullable=True),
        sa.Column("brand_tokens", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("tier IN ('cmg','client','subclient')", name="ck_tenant_tier"),
    )

    op.create_table(
        "user",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(254), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(256), nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="viewer"),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("notify_email", sa.Boolean, server_default="true"),
        sa.Column("notify_push", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('admin','operator','viewer','driver')", name="ck_user_role"),
    )
    op.create_index("ix_user_email", "user", ["email"])

    op.create_table(
        "permission_grant",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("grantor_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("grantee_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), nullable=True),
        sa.Column("allowed_actions", ARRAY(sa.String), nullable=False),
        sa.Column("constraints", JSONB, nullable=True),
        sa.Column("granted_by_user", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.UniqueConstraint("grantor_id", "grantee_id", "resource_type", "resource_id", name="uq_grant"),
    )

    op.create_table(
        "vehicle_type",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(50), unique=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("sensor_schema", JSONB, nullable=False, server_default="[]"),
    )

    op.create_table(
        "vehicle",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_type_id", UUID(as_uuid=True), sa.ForeignKey("vehicle_type.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("license_plate", sa.String(20), nullable=True),
        sa.Column("vin", sa.String(17), unique=True, nullable=True),
        sa.Column("year", sa.SmallInteger, nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "device",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="SET NULL"), nullable=True),
        sa.Column("imei", sa.String(15), unique=True, nullable=False),
        sa.Column("model", sa.String(50), server_default="FMC650"),
        sa.Column("firmware_ver", sa.String(20), nullable=True),
        sa.Column("online", sa.Boolean, server_default="false"),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_device_imei", "device", ["imei"])

    op.create_table(
        "telemetry_record",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", UUID(as_uuid=True), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("lat", sa.Float, nullable=True),
        sa.Column("lon", sa.Float, nullable=True),
        sa.Column("speed_kmh", sa.Float, nullable=True),
        sa.Column("heading", sa.SmallInteger, nullable=True),
        sa.Column("altitude_m", sa.Float, nullable=True),
        sa.Column("ignition", sa.Boolean, nullable=True),
        sa.Column("pto_active", sa.Boolean, nullable=True),
        sa.Column("ext_voltage_mv", sa.Integer, nullable=True),
        sa.Column("can_data", JSONB, nullable=True),
    )
    op.execute("ALTER TABLE telemetry_record ADD PRIMARY KEY (time, device_id);")
    op.execute("SELECT create_hypertable('telemetry_record', 'time', chunk_time_interval => INTERVAL '1 day');")
    op.execute("""
        ALTER TABLE telemetry_record SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'vehicle_id,tenant_id'
        );
    """)
    op.execute("SELECT add_compression_policy('telemetry_record', INTERVAL '7 days');")
    op.execute("CREATE INDEX ix_telemetry_vehicle_time ON telemetry_record (vehicle_id, time DESC);")
    op.execute("CREATE INDEX ix_telemetry_tenant_time  ON telemetry_record (tenant_id, time DESC);")

    op.create_table(
        "alert_rule",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("vehicle_filter", JSONB, nullable=False, server_default='{"scope":"all"}'),
        sa.Column("condition", JSONB, nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="warning"),
        sa.Column("actions", JSONB, nullable=False, server_default="[]"),
        sa.Column("escalation", JSONB, nullable=False, server_default="[]"),
        sa.Column("schedule", JSONB, nullable=False, server_default='{"type":"always"}'),
        sa.Column("cooldown_minutes", sa.Integer, server_default="30"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.CheckConstraint("severity IN ('info','warning','critical')", name="ck_rule_severity"),
    )
    op.execute("""
        CREATE OR REPLACE FUNCTION notify_rule_change() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_notify('rules_changed', row_to_json(NEW)::text);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER alert_rule_changed
          AFTER INSERT OR UPDATE OR DELETE ON alert_rule
          FOR EACH ROW EXECUTE FUNCTION notify_rule_change();
    """)

    op.create_table(
        "alert_instance",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("rule_id", UUID(as_uuid=True), sa.ForeignKey("alert_rule.id"), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="firing"),
        sa.Column("trigger_value", JSONB, nullable=True),
        sa.Column("ack_by_user_id", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("ack_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_note", sa.String(1000), nullable=True),
        sa.CheckConstraint("status IN ('firing','acknowledged','resolved','escalated')", name="ck_alert_status"),
    )

    op.create_table(
        "maintenance_plan",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("trigger_condition", JSONB, nullable=False),
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("warn_before_pct", sa.Integer, server_default="10"),
        sa.Column("active", sa.Boolean, server_default="true"),
    )

    op.create_table(
        "maintenance_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("maintenance_plan.id"), nullable=True),
        sa.Column("performed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("performed_by", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("reset_counters", ARRAY(sa.String), nullable=True),
        sa.Column("cost_eur", sa.Numeric(10, 2), nullable=True),
        sa.Column("photo_urls", ARRAY(sa.String), nullable=True),
    )

    op.execute("""
        CREATE MATERIALIZED VIEW telemetry_1h
        WITH (timescaledb.continuous) AS
        SELECT
            time_bucket('1 hour', time)                         AS bucket,
            vehicle_id, tenant_id,
            avg((can_data->>'hydraulic_pressure_1')::float)     AS avg_pressure_1,
            max((can_data->>'hydraulic_pressure_1')::float)     AS max_pressure_1,
            avg((can_data->>'oil_temp_c')::float)               AS avg_oil_temp,
            max((can_data->>'oil_temp_c')::float)               AS max_oil_temp,
            sum(CASE WHEN pto_active THEN 1 ELSE 0 END)         AS pto_active_minutes,
            sum(CASE WHEN ignition   THEN 1 ELSE 0 END)         AS engine_on_minutes,
            count(*)                                            AS record_count
        FROM telemetry_record
        GROUP BY bucket, vehicle_id, tenant_id
        WITH NO DATA;
    """)
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1h',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour');
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_1h CASCADE;")
    op.drop_table("maintenance_log")
    op.drop_table("maintenance_plan")
    op.drop_table("alert_instance")
    op.execute("DROP TRIGGER IF EXISTS alert_rule_changed ON alert_rule;")
    op.execute("DROP FUNCTION IF EXISTS notify_rule_change;")
    op.drop_table("alert_rule")
    op.drop_table("telemetry_record")
    op.drop_table("device")
    op.drop_table("vehicle")
    op.drop_table("vehicle_type")
    op.drop_table("permission_grant")
    op.drop_table("user")
    op.drop_table("tenant")
