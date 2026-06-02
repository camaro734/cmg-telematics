"""add invalid_values to J1939 sentinel sensors in Sistema vacio-presion

Revision ID: 037
Revises: 036
Create Date: 2026-06-02

Idempotente: || en JSONB sobreescribe la clave con el mismo valor si ya existe.
- avl_10310 (Temperatura Refrigerante): raw=0 → J1939 SPN no inicializado → -40°C
- avl_10313 (Estado PTO): raw=254/255 → J1939 0xFE/0xFF no disponible → 255
"""
from alembic import op
import sqlalchemy as sa

revision = '037'
down_revision = '036'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Temperatura Refrigerante: filtrar raw=0 (J1939 "not initialized")
    conn.execute(sa.text("""
        UPDATE vehicle_type
        SET sensor_schema = (
            SELECT jsonb_agg(
                CASE
                    WHEN (s->>'avl_id')::int = 10310
                    THEN s || jsonb_build_object('invalid_values', jsonb_build_array(0))
                    ELSE s
                END
            )
            FROM jsonb_array_elements(sensor_schema) s
        )
        WHERE name = 'Sistema vacío-presión (cisterna)'
    """))
    # Estado PTO: filtrar raw=254,255 (J1939 0xFE error indicator / 0xFF not available)
    conn.execute(sa.text("""
        UPDATE vehicle_type
        SET sensor_schema = (
            SELECT jsonb_agg(
                CASE
                    WHEN (s->>'avl_id')::int = 10313
                    THEN s || jsonb_build_object('invalid_values', jsonb_build_array(254, 255))
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
            SELECT jsonb_agg(s - 'invalid_values')
            FROM jsonb_array_elements(sensor_schema) s
        )
        WHERE name = 'Sistema vacío-presión (cisterna)'
    """))
