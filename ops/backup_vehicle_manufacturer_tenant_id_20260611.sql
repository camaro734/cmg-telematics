-- Backup del estado de vehicle.manufacturer_tenant_id antes de migración 049
-- Generado: 2026-06-11
-- Restaurar valores: UPDATE vehicle v SET manufacturer_tenant_id = b.manufacturer_tenant_id
--                    FROM vehicle_mfr_tid_bkp_20260611 b WHERE v.id = b.id;

BEGIN;
CREATE TABLE IF NOT EXISTS vehicle_mfr_tid_bkp_20260611 AS
    SELECT id, tenant_id, manufacturer_tenant_id FROM vehicle;
COMMIT;
