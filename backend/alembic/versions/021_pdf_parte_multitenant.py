"""pdf parte trabajo multitenant - cliente final + branding + doc_number

Añade los campos necesarios para emitir el PDF de parte de servicio
con branding del tenant emisor, métricas configurables por tipo de
vehículo, datos del cliente final, firma o motivo de no firma, y
numeración secuencial independiente por tenant.

Revision ID: 021
Revises: 020
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade():
    # tenant: datos legales del emisor (aparecen en cabecera "Emite" del PDF)
    op.add_column('tenant', sa.Column('business_cif', sa.String(20), nullable=True))
    op.add_column('tenant', sa.Column('business_address', sa.String(300), nullable=True))

    # vehicle_type: métricas configurables que aparecen en la tabla de paradas del PDF
    op.add_column(
        'vehicle_type',
        sa.Column('pdf_metrics', JSONB, nullable=False, server_default="'[]'::jsonb"),
    )

    # work_order: datos del cliente final + número de documento (asignado al cerrar)
    op.add_column('work_order', sa.Column('final_client_name', sa.String(200), nullable=True))
    op.add_column('work_order', sa.Column('final_client_address', sa.String(300), nullable=True))
    op.add_column('work_order', sa.Column('doc_number', sa.String(40), nullable=True))
    # Índice único por tenant+doc_number, parcial (solo donde doc_number no es null)
    op.create_index(
        'work_order_doc_number_idx',
        'work_order',
        ['tenant_id', 'doc_number'],
        unique=True,
        postgresql_where=sa.text('doc_number IS NOT NULL'),
    )

    # work_report: firmante (nombre + DNI) o motivo de no firma
    # signature_url ya existe — se reinterpreta semánticamente como firma del cliente
    op.add_column('work_report', sa.Column('client_signee_name', sa.String(200), nullable=True))
    op.add_column('work_report', sa.Column('client_signee_dni', sa.String(20), nullable=True))
    op.add_column('work_report', sa.Column('unsigned_reason', sa.String(200), nullable=True))

    # Tabla counter para asignación atómica de doc_number por (tenant, año)
    op.create_table(
        'tenant_doc_counter',
        sa.Column(
            'tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('year', sa.Integer, nullable=False),
        sa.Column('last_seq', sa.Integer, nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('tenant_id', 'year'),
    )


def downgrade():
    op.drop_table('tenant_doc_counter')
    op.drop_column('work_report', 'unsigned_reason')
    op.drop_column('work_report', 'client_signee_dni')
    op.drop_column('work_report', 'client_signee_name')
    op.drop_index('work_order_doc_number_idx', table_name='work_order')
    op.drop_column('work_order', 'doc_number')
    op.drop_column('work_order', 'final_client_address')
    op.drop_column('work_order', 'final_client_name')
    op.drop_column('vehicle_type', 'pdf_metrics')
    op.drop_column('tenant', 'business_address')
    op.drop_column('tenant', 'business_cif')
