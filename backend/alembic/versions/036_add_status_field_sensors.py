"""add ext_voltage and ignition sensors to all vehicle_types

Revision ID: 036
Revises: 035
Create Date: 2026-06-02

Idempotente: solo añade el sensor si la key no existe ya en sensor_schema.
Usa jsonb_build_object() para evitar JSON literal con ':' que SQLAlchemy
interpreta como bindparams.
"""
from alembic import op
import sqlalchemy as sa

revision = '036'
down_revision = '035'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE vehicle_type
        SET sensor_schema = sensor_schema || jsonb_build_array(
            jsonb_build_object(
                'key', 'ext_voltage',
                'label', 'Voltaje batería',
                'unit', 'V',
                'status_field', 'ext_voltage_mv',
                'scale', 0.001::float,
                'gauge_type', 'numeric',
                'visible_in_detail', true
            )
        )
        WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(sensor_schema) s
            WHERE s->>'key' = 'ext_voltage'
        )
    """))
    conn.execute(sa.text("""
        UPDATE vehicle_type
        SET sensor_schema = sensor_schema || jsonb_build_array(
            jsonb_build_object(
                'key', 'ignition',
                'label', 'Ignición',
                'unit', null::text,
                'status_field', 'ignition',
                'gauge_type', 'led',
                'visible_in_detail', true
            )
        )
        WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(sensor_schema) s
            WHERE s->>'key' = 'ignition'
        )
    """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE vehicle_type
        SET sensor_schema = (
            SELECT COALESCE(jsonb_agg(s ORDER BY idx), '[]'::jsonb)
            FROM jsonb_array_elements(sensor_schema) WITH ORDINALITY arr(s, idx)
            WHERE s->>'key' NOT IN ('ext_voltage', 'ignition')
        )
    """))
