-- Relabel PTO en vehicle_type 'Sistema vacío-presión (cisterna)' (2026-06-09)
-- Cambios:
--   avl_10313: "Estado PTO" → "Estado PTO (J1939)"   (byte J1939, valores 0-255)
--   pto_activado: "PTO Activado" → "PTO Activado (IFM)"  (salida digital IFM CR2530, avl 385 bit 0)

UPDATE vehicle_type
SET sensor_schema = (
    SELECT jsonb_agg(
        CASE
            WHEN elem->>'key' = 'avl_10313'
                THEN jsonb_set(elem, '{label}', '"Estado PTO (J1939)"')
            WHEN elem->>'key' = 'pto_activado'
                THEN jsonb_set(elem, '{label}', '"PTO Activado (IFM)"')
            ELSE elem
        END
    )
    FROM jsonb_array_elements(sensor_schema) AS elem
)
WHERE name = 'Sistema vacío-presión (cisterna)';
