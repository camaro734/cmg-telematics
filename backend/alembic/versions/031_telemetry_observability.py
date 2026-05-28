"""telemetry observability fields

Revision ID: 031
Revises: 030
Create Date: 2026-05-28

Añade campos de observabilidad para medir latencia del pipeline y
salud real de dispositivos:
- telemetry_record.received_at: timestamp servidor al insertar (vs time = reloj GPS)
- device.last_packet_at: último AVL real recibido (vs last_seen = TCP connect/disconnect)
- device.total_messages: contador acumulado de records recibidos
- device.last_codec: último codec usado (diagnóstico)
- device.iccid: ID de SIM (preparado, se rellena vía Codec 12 getparam en el futuro)

received_at sin DEFAULT a propósito: los chunks históricos quedan NULL
(honesto: no sabíamos cuándo llegaron), writer.py rellena los nuevos.
"""
from alembic import op
import sqlalchemy as sa

revision = '031'
down_revision = '030'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # telemetry_record: timestamp de llegada al servidor
    op.add_column('telemetry_record',
        sa.Column('received_at', sa.TIMESTAMP(timezone=True), nullable=True))

    # device: observabilidad real del dispositivo
    op.add_column('device',
        sa.Column('last_packet_at', sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column('device',
        sa.Column('total_messages', sa.BigInteger(), nullable=False, server_default='0'))
    op.add_column('device',
        sa.Column('last_codec', sa.String(length=10), nullable=True))
    op.add_column('device',
        sa.Column('iccid', sa.String(length=22), nullable=True))


def downgrade() -> None:
    op.drop_column('device', 'iccid')
    op.drop_column('device', 'last_codec')
    op.drop_column('device', 'total_messages')
    op.drop_column('device', 'last_packet_at')
    op.drop_column('telemetry_record', 'received_at')
