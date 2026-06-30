"""tenant: datos de contacto del emisor (razón social, teléfono, email, web) — aditivo.

Completa el membrete del EMISOR del reporte/parte: junto a los ya existentes
(name, brand_name, business_cif, business_address, logo_url) añade los datos de
contacto fiscales para una cabecera tipo factura.

ESTRICTAMENTE ADITIVA: solo ADD COLUMN nullable. No toca datos existentes ni
otras columnas; todos los tenants actuales siguen válidos con los nuevos = NULL.

Backup recomendado JUSTO ANTES de aplicar en producción:
  ops/backup_tenant_company_<fecha>.sql  (pg_dump -t tenant)

Revision ID: 064
Revises: 063
"""
from alembic import op
import sqlalchemy as sa

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Razón social fiscal (puede diferir del `name` comercial).
    op.add_column("tenant", sa.Column("business_legal_name", sa.String(200), nullable=True))
    # Contacto público de la empresa (distinto de notification_email, que es interno).
    op.add_column("tenant", sa.Column("business_phone", sa.String(40), nullable=True))
    op.add_column("tenant", sa.Column("business_email", sa.String(120), nullable=True))
    op.add_column("tenant", sa.Column("business_website", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "business_website")
    op.drop_column("tenant", "business_email")
    op.drop_column("tenant", "business_phone")
    op.drop_column("tenant", "business_legal_name")
