"""Índices en tenant_id para tablas que filtran masivamente por tenant.

Postgres no indexa las FK por defecto; sin estos índices los WHERE tenant_id=...
hacen seq-scan conforme crece el número de tenants/registros.

Tablas afectadas (las que aún no tienen índice tenant_id):
- vehicle
- maintenance_plan
- alert_instance
- alert_rule
- geofence

Las tablas device, driver, work_order y work_report ya tienen su índice.

CONCURRENTLY para no bloquear escrituras en producción — requiere COMMIT antes
de cada CREATE INDEX (autocommit dentro de la transacción de Alembic).

revision = '022'
down_revision = '021'
"""
from alembic import op
from sqlalchemy import text


revision = '022'
down_revision = '021'
branch_labels = None
depends_on = None


_TABLES = (
    'vehicle',
    'maintenance_plan',
    'alert_instance',
    'alert_rule',
)


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY no puede ejecutarse dentro de una transacción.
    conn = op.get_bind()
    conn.execute(text("COMMIT"))
    for table in _TABLES:
        conn.execute(text(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_{table}_tenant_id ON {table}(tenant_id);"
        ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("COMMIT"))
    for table in _TABLES:
        conn.execute(text(
            f"DROP INDEX CONCURRENTLY IF EXISTS ix_{table}_tenant_id;"
        ))
