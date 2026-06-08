-- Backup de vehicle_type.historic_metrics antes de curación (2026-06-08)
-- Restaurar con: psql -U cmg -d cmg_telematics -f este_fichero

UPDATE vehicle_type
SET historic_metrics = '[{"key": "engine_on_minutes", "unit": "h", "color": "#22C55E", "group": null, "label": "Horas motor", "avl_id": 1, "transform": 0.01667, "chart_type": "bar", "show_in_pdf": false}]'::jsonb
WHERE id = '07f0774b-09ec-4179-ab7e-707263d82c5d'; -- Camión de basura

UPDATE vehicle_type
SET historic_metrics = '[{"key": "custom_avl_145", "unit": "h", "color": "#22C55E", "group": null, "label": "Horas Tranfer", "avl_id": 2, "transform": 1.0, "chart_type": "donut", "show_in_pdf": true}, {"key": "custom_avl_148", "unit": "min", "color": "#22C55E", "group": null, "label": "Minutos Bomba Agua", "avl_id": 148, "transform": 1.0, "chart_type": "line", "show_in_pdf": true}]'::jsonb
WHERE id = '608ba0fa-8160-4ac1-a9a9-447fb18d51b7'; -- Sistema vacío-presión (cisterna)
