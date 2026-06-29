"""tenant: base de la empresa (dirección + lat/lon) — aditivo.

Añade a tenant la ubicación de la BASE del cliente: dirección de salida/llegada
por defecto que usará la optimización de rutas. Una base por tenant.

ESTRICTAMENTE ADITIVA: solo ADD COLUMN nullable. No toca datos existentes ni
otras columnas; todos los tenants actuales siguen válidos con base_* = NULL.

Backup recomendado JUSTO ANTES de aplicar en producción:
  ops/backup_tenant_base_<fecha>.sql  (pg_dump -t tenant)

Revision ID: 063
Revises: 062
"""
from alembic import op
import sqlalchemy as sa

revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dirección textual de la base (geocodificada por el admin del cliente).
    op.add_column("tenant", sa.Column("base_address", sa.String(300), nullable=True))
    # Coordenadas de la base (origen/destino por defecto para optimizar rutas).
    op.add_column("tenant", sa.Column("base_lat", sa.Float(), nullable=True))
    op.add_column("tenant", sa.Column("base_lon", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "base_lon")
    op.drop_column("tenant", "base_lat")
    op.drop_column("tenant", "base_address")
