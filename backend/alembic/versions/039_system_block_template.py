"""system_block_template table

Revision ID: 039
Revises: 038
Create Date: 2026-06-03

"""
import uuid
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '039'
down_revision = '038'
branch_labels = None
depends_on = None

# Plantillas de fábrica — idénticas al dict de seeds.
# Si el slug ya existe (p. ej. migración re-ejecutada), DO NOTHING.
_BUILTIN_TEMPLATES = [
    {
        "id": str(uuid.uuid4()),
        "slug": "vps_cuba",
        "name": "VPS Cuba",
        "description": "Cuba de vacío/presión (barredora aspiradora, limpieza viaria)",
        "blocks": [
            {"id": "block_motor",        "name": "Motor",        "icon": "ti-engine",            "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",    "name": "Eléctrico",    "icon": "ti-bolt",              "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible",  "name": "Combustible",  "icon": "ti-gas-station",       "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_hidraulico",   "name": "Hidráulico",   "icon": "ti-arrows-right-left", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_depresor",     "name": "Depresor",     "icon": "ti-ripple",            "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion", "name": "Localización", "icon": "ti-map-pin",           "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",    "name": "Seguridad",    "icon": "ti-shield",            "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",              "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "slug": "max_barredora",
        "name": "MAX Barredora",
        "description": "Barredora compacta / semipesada (cepillos laterales + aspiración central)",
        "blocks": [
            {"id": "block_motor",        "name": "Motor",        "icon": "ti-engine",           "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",    "name": "Eléctrico",    "icon": "ti-bolt",             "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible",  "name": "Combustible",  "icon": "ti-gas-station",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_cepillos",     "name": "Cepillos",     "icon": "ti-rotate-clockwise", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion", "name": "Localización", "icon": "ti-map-pin",          "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",    "name": "Seguridad",    "icon": "ti-shield",           "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",             "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "slug": "basura_recolectora",
        "name": "Basura Recolectora",
        "description": "Camión de recogida de residuos (compactador trasero)",
        "blocks": [
            {"id": "block_motor",        "name": "Motor",        "icon": "ti-engine",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",    "name": "Eléctrico",    "icon": "ti-bolt",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible",  "name": "Combustible",  "icon": "ti-gas-station", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_compactador",  "name": "Compactador",  "icon": "ti-box-model",   "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion", "name": "Localización", "icon": "ti-map-pin",     "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",    "name": "Seguridad",    "icon": "ti-shield",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "slug": "generico",
        "name": "Genérico",
        "description": "Plantilla base para cualquier tipo de vehículo",
        "blocks": [
            {"id": "block_motor",        "name": "Motor",        "icon": "ti-engine",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",    "name": "Eléctrico",    "icon": "ti-bolt",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible",  "name": "Combustible",  "icon": "ti-gas-station", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion", "name": "Localización", "icon": "ti-map-pin",     "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",    "name": "Seguridad",    "icon": "ti-shield",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
]


def upgrade() -> None:
    op.create_table(
        "system_block_template",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("blocks", JSONB, nullable=False, server_default="[]"),
        sa.Column("is_builtin", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_system_block_template_slug", "system_block_template", ["slug"])

    # Sembrar plantillas de fábrica — ON CONFLICT DO NOTHING para idempotencia.
    import json
    conn = op.get_bind()
    for tpl in _BUILTIN_TEMPLATES:
        conn.execute(
            sa.text(
                """
                INSERT INTO system_block_template (id, slug, name, description, blocks, is_builtin, created_at, updated_at)
                VALUES (:id, :slug, :name, :description, CAST(:blocks AS jsonb), true, now(), now())
                ON CONFLICT (slug) DO NOTHING
                """
            ),
            {
                "id": tpl["id"],
                "slug": tpl["slug"],
                "name": tpl["name"],
                "description": tpl["description"],
                "blocks": json.dumps(tpl["blocks"], ensure_ascii=False),
            },
        )


def downgrade() -> None:
    op.drop_index("ix_system_block_template_slug", table_name="system_block_template")
    op.drop_table("system_block_template")
