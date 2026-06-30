"""work_order: CIF y contacto del cliente final (destinatario) — aditivo.

Completa el bloque DESTINATARIO del reporte/parte: junto a los ya existentes
(final_client_name, final_client_address) añade CIF y contacto para una cabecera
tipo factura.

ESTRICTAMENTE ADITIVA: solo ADD COLUMN nullable. No toca datos existentes ni
otras columnas; todas las órdenes actuales siguen válidas con los nuevos = NULL.

Backup recomendado JUSTO ANTES de aplicar en producción:
  ops/backup_work_order_final_client_<fecha>.sql  (pg_dump -t work_order)

Revision ID: 065
Revises: 064
"""
from alembic import op
import sqlalchemy as sa

revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("work_order", sa.Column("final_client_cif", sa.String(20), nullable=True))
    op.add_column("work_order", sa.Column("final_client_phone", sa.String(40), nullable=True))
    op.add_column("work_order", sa.Column("final_client_email", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("work_order", "final_client_email")
    op.drop_column("work_order", "final_client_phone")
    op.drop_column("work_order", "final_client_cif")
