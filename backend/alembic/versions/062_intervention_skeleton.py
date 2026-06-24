"""intervención: esqueleto sobre work_cycle/work_cycle_definition (aditivo).

Añade a work_cycle_definition la configuración de la regla de intervención
(fin configurable, ventana de fusión, radio de seguridad) y a work_cycle la
asociación opcional a una OT/parada + estado de asignación.

ESTRICTAMENTE ADITIVA: solo ADD COLUMN (nullable o con server_default),
CREATE INDEX y ADD CONSTRAINT (check). No toca datos existentes; las 2
definiciones y 22 ciclos actuales siguen válidos sin cambios.

Backup recomendado JUSTO ANTES de aplicar en producción:
  ops/backup_work_cycle_def_and_cycle_<fecha>.sql
  (pg_dump -t work_cycle_definition -t work_cycle)

Revision ID: 062
Revises: 061
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- work_cycle_definition: configuración de la regla de intervención ---
    op.add_column(
        "work_cycle_definition",
        sa.Column("end_trigger_type", sa.String(30), nullable=True),
    )  # NULL = fin implícito (cuando el disparador de inicio deja de cumplirse) = comportamiento actual
    op.add_column(
        "work_cycle_definition",
        sa.Column("end_trigger_config", sa.dialects.postgresql.JSONB(),
                  nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "work_cycle_definition",
        sa.Column("merge_window_seconds", sa.Integer(), nullable=False, server_default="300"),
    )
    op.add_column(
        "work_cycle_definition",
        sa.Column("safety_radius_m", sa.Integer(), nullable=False, server_default="150"),
    )

    # --- work_cycle: asociación opcional a OT + estado de asignación ---
    op.add_column(
        "work_cycle",
        sa.Column("work_order_id", UUID(as_uuid=True),
                  sa.ForeignKey("work_order.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "work_cycle",
        sa.Column("work_order_stop_id", UUID(as_uuid=True),
                  sa.ForeignKey("work_order_stop.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "work_cycle",
        sa.Column("assignment_status", sa.String(20), nullable=False, server_default="sin_asignar"),
    )
    op.create_index("ix_work_cycle_work_order_id", "work_cycle", ["work_order_id"])
    op.create_check_constraint(
        "ck_work_cycle_assignment_status",
        "work_cycle",
        "assignment_status IN ('sin_asignar', 'auto', 'pending', 'manual')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_work_cycle_assignment_status", "work_cycle", type_="check")
    op.drop_index("ix_work_cycle_work_order_id", "work_cycle")
    op.drop_column("work_cycle", "assignment_status")
    op.drop_column("work_cycle", "work_order_stop_id")
    op.drop_column("work_cycle", "work_order_id")
    op.drop_column("work_cycle_definition", "safety_radius_m")
    op.drop_column("work_cycle_definition", "merge_window_seconds")
    op.drop_column("work_cycle_definition", "end_trigger_config")
    op.drop_column("work_cycle_definition", "end_trigger_type")
