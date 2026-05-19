"""Auto-sync vehicle.manufacturer_tenant_id from tenant.parent_manufacturer_id

Revision ID: 026
Revises: 025
"""

from alembic import op

revision = '026'
down_revision = '025'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_vehicle_manufacturer()
        RETURNS TRIGGER AS $$
        BEGIN
          SELECT parent_manufacturer_id INTO NEW.manufacturer_tenant_id
          FROM tenant WHERE id = NEW.tenant_id;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_vehicle_manufacturer_sync
          BEFORE INSERT OR UPDATE OF tenant_id ON vehicle
          FOR EACH ROW EXECUTE FUNCTION sync_vehicle_manufacturer();
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS trg_vehicle_manufacturer_sync ON vehicle")
    op.execute("DROP FUNCTION IF EXISTS sync_vehicle_manufacturer()")
