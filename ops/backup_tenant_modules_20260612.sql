-- Backup de enabled_modules de todos los tenants antes del backfill de módulos cliente
-- Generado: 2026-06-12
-- Restaurar: UPDATE tenant t SET enabled_modules = b.enabled_modules
--            FROM tenant_modules_bkp_20260612 b WHERE t.id = b.id;

BEGIN;
CREATE TABLE IF NOT EXISTS tenant_modules_bkp_20260612 AS
    SELECT id, name, tier, enabled_modules FROM tenant;
COMMIT;
