"""vehicle_type: manual_can_slots + manual_can_buttons JSONB.

La definición de slots y botones Manual CAN pasa a la plantilla (vehicle_type),
heredada por todos los vehículos del tipo. El estado runtime de las salidas se
guarda por vehículo en Redis (no en BD).

Revision ID: 053
Revises: 052
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle_type",
        sa.Column("manual_can_slots", JSONB(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "vehicle_type",
        sa.Column("manual_can_buttons", JSONB(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("vehicle_type", "manual_can_buttons")
    op.drop_column("vehicle_type", "manual_can_slots")
