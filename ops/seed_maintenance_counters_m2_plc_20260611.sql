-- Seed reproducible: catálogo PLC ampliado para vacuum-pressure (M2, 2026-06-11)
-- Aplicado por migración 048. Idempotente.
-- camion_de_basura no recibe contadores PLC: sus AVL IDs son presión/cantidad, no acumuladores.

UPDATE vehicle_type
SET maintenance_counters = '[
  {"type":"pto_hours","label":"Horas PTO","unit":"h","source_type":"telemetry_1h","source_key":"pto_active_minutes","semantics":"sum"},
  {"type":"engine_hours","label":"Horas motor","unit":"h","source_type":"telemetry_1h","source_key":"engine_on_minutes","semantics":"sum"},
  {"type":"calendar_days","label":"Calendario","unit":"días","source_type":"calendar","source_key":null,"semantics":null},
  {"type":"pump_hours","label":"Horas bomba","unit":"h","source_type":"can_data","source_key":"avl_148","semantics":"sum"},
  {"type":"depressor_hours","label":"Horas depresor","unit":"h","source_type":"can_data","source_key":"avl_150","semantics":"sum"},
  {"type":"transfer_hours","label":"Horas transferencia","unit":"h","source_type":"can_data","source_key":"avl_146","semantics":"sum"},
  {"type":"odometer_km","label":"Kilómetros totales","unit":"km","source_type":"can_data","source_key":"avl_10314","semantics":"max_minus_min"}
]'::jsonb
WHERE slug = 'vacuum-pressure';
