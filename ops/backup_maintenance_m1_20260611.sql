-- Backup pre-M1 (Mantenimiento v2, Pieza M1) — 2026-06-11
-- Estado de vehicle_type y maintenance_plan antes de la migración 046.
-- Reproducir: psql -U cmg -d cmg_telematics -f este_archivo

-- vehicle_type (maintenance_templates — columna existente; maintenance_counters aún no existe)
-- id: 07f0774b (camion_de_basura) → maintenance_templates = []
-- id: 608ba0fa (vacuum-pressure)  → maintenance_templates = [{"name":"Cambiar aceite caja Transfer","thresholds":[{"type":"pto_hours","value":100.0}],"warn_before_pct":10}]

-- maintenance_plan (2 filas antes de añadir owner_tenant_id)
-- id: 51fdf6bd | name: Cambiar aceite caja Transfer | tenant_id: 998886ef | trigger: pto_hours 100h | vehicle: ot1234
-- id: 1acc22c0 | name: Cambiar aceite caja Transfer | tenant_id: 998886ef | trigger: pto_hours 500h | vehicle: FUSO 3.5

-- Para revertir el seed de maintenance_counters si es necesario:
UPDATE vehicle_type SET maintenance_counters = '[]'::jsonb
WHERE slug IN ('camion_de_basura', 'vacuum-pressure');

-- Para revertir owner_tenant_id (tras DROP COLUMN en downgrade de alembic):
-- No aplica — la migración maneja el rollback.
