"""vehicles: backfill manufacturer_tenant_id + actualizar trigger para tier=manufacturer

Revision ID: 049
Revises: 048
Create Date: 2026-06-11

Cambios:
- Actualiza la función sync_vehicle_manufacturer (creada en 026) para que
  los vehículos en un tenant de tier='manufacturer' reciban
  manufacturer_tenant_id = su propio tenant.id (antes quedaban NULL porque
  manufacturer.parent_manufacturer_id = NULL).
- Backfill: rellena los vehicles existentes con manufacturer_tenant_id NULL
  que sí deberían tenerlo:
    · Tenant tier='manufacturer' → manufacturer_tenant_id = tenant.id
    · Tenant con parent_manufacturer_id → manufacturer_tenant_id = parent_manufacturer_id
"""
from alembic import op

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Actualizar función del trigger para manejar también tier=manufacturer
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_vehicle_manufacturer()
        RETURNS TRIGGER AS $$
        DECLARE
            v_parent_mfr uuid;
            v_tier       text;
        BEGIN
            SELECT parent_manufacturer_id, tier
            INTO   v_parent_mfr, v_tier
            FROM   tenant
            WHERE  id = NEW.tenant_id;

            IF v_parent_mfr IS NOT NULL THEN
                NEW.manufacturer_tenant_id := v_parent_mfr;
            ELSIF v_tier = 'manufacturer' THEN
                NEW.manufacturer_tenant_id := NEW.tenant_id;
            ELSE
                NEW.manufacturer_tenant_id := NULL;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # 2. Backfill: vehículos en tenants de tier=manufacturer
    op.execute("""
        UPDATE vehicle v
        SET    manufacturer_tenant_id = v.tenant_id
        FROM   tenant t
        WHERE  v.tenant_id = t.id
          AND  v.manufacturer_tenant_id IS NULL
          AND  t.tier = 'manufacturer';
    """)

    # 3. Backfill: vehículos en tenants client/subclient con parent_manufacturer_id
    op.execute("""
        UPDATE vehicle v
        SET    manufacturer_tenant_id = t.parent_manufacturer_id
        FROM   tenant t
        WHERE  v.tenant_id = t.id
          AND  v.manufacturer_tenant_id IS NULL
          AND  t.parent_manufacturer_id IS NOT NULL;
    """)


def downgrade():
    # Revertir la función al comportamiento original (026)
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_vehicle_manufacturer()
        RETURNS TRIGGER AS $$
        BEGIN
            SELECT parent_manufacturer_id INTO NEW.manufacturer_tenant_id
            FROM   tenant WHERE id = NEW.tenant_id;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # No revertimos el backfill de datos (safe: NULL era el estado original
    # y no hay forma fiable de distinguir qué fue backfill vs ya existente)
