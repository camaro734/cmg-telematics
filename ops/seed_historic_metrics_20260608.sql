-- Curación catálogo vehicle_type.historic_metrics (2026-06-08)
-- Corrige misconfiguraciones (avl_id:1 en basura, avl_id:2 en cisterna)
-- e instala catálogo de 5 métricas por tipo aprobado en FASE 1.
-- Aplicado en producción: 2026-06-08

UPDATE vehicle_type
SET historic_metrics = '[
  {"key":"engine_on_minutes","label":"Horas motor","unit":"h","color":"#22C55E","transform":0.01667,"chart_type":"bar","show_in_pdf":false,"group":null},
  {"key":"pto_active_minutes","label":"Horas PTO","unit":"h","color":"#3B82F6","transform":0.01667,"chart_type":"bar","show_in_pdf":false,"group":null},
  {"key":"custom_avl_145","label":"Temperatura aceite","unit":"°C","color":"#EF4444","transform":1,"avl_id":145,"chart_type":"line","show_in_pdf":false,"group":null},
  {"key":"custom_avl_146","label":"Presión hidráulica","unit":"bar","color":"#F59E0B","transform":1,"avl_id":146,"chart_type":"line","show_in_pdf":false,"group":null},
  {"key":"custom_avl_149","label":"Ciclos de recogida","unit":"cont.","color":"#8B5CF6","transform":1,"avl_id":149,"chart_type":"bar","show_in_pdf":false,"group":null}
]'::jsonb
WHERE id = '07f0774b-09ec-4179-ab7e-707263d82c5d'; -- Camión de basura

UPDATE vehicle_type
SET historic_metrics = '[
  {"key":"engine_on_minutes","label":"Horas motor","unit":"h","color":"#22C55E","transform":0.01667,"chart_type":"bar","show_in_pdf":false,"group":null},
  {"key":"pto_active_minutes","label":"Horas sistema","unit":"h","color":"#3B82F6","transform":0.01667,"chart_type":"bar","show_in_pdf":false,"group":null},
  {"key":"custom_avl_154","label":"Nivel de cisterna","unit":"%","color":"#06B6D4","transform":1,"avl_id":154,"chart_type":"line","show_in_pdf":false,"group":null},
  {"key":"custom_avl_148","label":"Min. bomba agua","unit":"min","color":"#0EA5E9","transform":1,"avl_id":148,"chart_type":"line","show_in_pdf":false,"group":null},
  {"key":"custom_avl_152","label":"Pico presión agua","unit":"bar","color":"#F59E0B","transform":1,"avl_id":152,"chart_type":"line","show_in_pdf":false,"group":null}
]'::jsonb
WHERE id = '608ba0fa-8160-4ac1-a9a9-447fb18d51b7'; -- Sistema vacío-presión (cisterna)
