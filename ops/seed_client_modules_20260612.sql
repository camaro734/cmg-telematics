-- Backfill: asignar módulos por defecto a todos los tenants tier=client con módulos vacíos.
-- DEFAULT_CLIENT_MODULES = {alerts, fleet, maintenance, reports, work-orders}
-- Idempotente: solo actualiza si enabled_modules = '{}'
-- Generado: 2026-06-12

BEGIN;
UPDATE tenant
SET enabled_modules = '{alerts,fleet,maintenance,reports,work-orders}'
WHERE tier = 'client'
  AND enabled_modules = '{}';
COMMIT;
