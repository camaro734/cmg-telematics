"""add invalid_values to RPM, Combustible and AdBlue J1939 sensors

Revision ID: 038
Revises: 037
Create Date: 2026-06-02

Idempotente: solo añade invalid_values si el sensor aún no lo tiene.
- avl_10309 (RPM Motor):          raw 65534/65535 → J1939 0xFFFE/0xFFFF SPN 2 bytes
- avl_10311 (Nivel Combustible):  raw 254/255 → J1939 0xFE/0xFF SPN 1 byte
- avl_10312 (Nivel AdBlue):       raw 254/255 → J1939 0xFE/0xFF SPN 1 byte
"""
from alembic import op
import sqlalchemy as sa

revision = '038'
down_revision = '037'
branch_labels = None
depends_on = None

_AVL_SENTINELS = [
    (10309, [65534, 65535]),
    (10311, [254, 255]),
    (10312, [254, 255]),
]


def upgrade() -> None:
    conn = op.get_bind()
    for avl_id, sentinels in _AVL_SENTINELS:
        array_expr = ", ".join(str(v) for v in sentinels)
        conn.execute(sa.text(f"""
            UPDATE vehicle_type
            SET sensor_schema = (
                SELECT jsonb_agg(
                    CASE
                        WHEN (s->>'avl_id')::int = {avl_id}
                             AND (s->'invalid_values') IS NULL
                        THEN s || jsonb_build_object(
                                 'invalid_values',
                                 jsonb_build_array({array_expr})
                             )
                        ELSE s
                    END
                )
                FROM jsonb_array_elements(sensor_schema) s
            )
            WHERE name = 'Sistema vacío-presión (cisterna)'
        """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE vehicle_type
        SET sensor_schema = (
            SELECT jsonb_agg(
                CASE
                    WHEN (s->>'avl_id')::int IN (10309, 10311, 10312)
                    THEN s - 'invalid_values'
                    ELSE s
                END
            )
            FROM jsonb_array_elements(sensor_schema) s
        )
        WHERE name = 'Sistema vacío-presión (cisterna)'
    """))
