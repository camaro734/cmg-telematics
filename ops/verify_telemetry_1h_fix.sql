-- Verificación del fix de horas de motor/PTO (migración 066).
-- Solo SELECT: no modifica datos. Ejecutar DESPUÉS de aplicar la migración y de:
--   CALL refresh_continuous_aggregate('telemetry_1min', NULL, NULL);
--   CALL refresh_continuous_aggregate('telemetry_1h',   NULL, NULL);
--
-- Uso:
--   docker exec -i cmg-telematic1_postgres_1 psql -U cmg -d cmg_telematics -f - < ops/verify_telemetry_1h_fix.sql
--
-- Criterios de aceptación (deben dar todos 'OK'):
--   1) Ninguna hora supera 60 minutos de motor ni de PTO.
--   2) Ningún día supera 1440 minutos (24 h) de motor ni de PTO.
--   3) La media horaria de presión del agregado coincide con la media directa
--      calculada desde telemetry_record (sin regresión al pasar a 2 niveles).

\echo '== 1) Ninguna hora > 60 min de motor/PTO =='
SELECT CASE WHEN count(*) = 0 THEN 'OK'
            ELSE 'FALLO: ' || count(*) || ' horas con >60 min' END AS check_hora_max
FROM telemetry_1h
WHERE engine_on_minutes > 60 OR pto_active_minutes > 60;

\echo '== 2) Ningún día > 1440 min (24 h) de motor/PTO =='
SELECT CASE WHEN count(*) = 0 THEN 'OK'
            ELSE 'FALLO: ' || count(*) || ' días imposibles' END AS check_dia_max
FROM (
    SELECT time_bucket('1 day', bucket) AS day, vehicle_id,
           sum(engine_on_minutes) AS eng, sum(pto_active_minutes) AS pto
    FROM telemetry_1h
    GROUP BY day, vehicle_id
) d
WHERE d.eng > 1440 OR d.pto > 1440;

\echo '== 3) Media horaria de presión: agregado vs cálculo directo =='
WITH agg AS (
    SELECT bucket, vehicle_id, avg_pressure_1
    FROM telemetry_1h
    WHERE avg_pressure_1 IS NOT NULL
),
direct AS (
    SELECT time_bucket('1 hour', time) AS bucket, vehicle_id,
           avg((can_data->>'hydraulic_pressure_1')::float) AS avg_direct
    FROM telemetry_record
    WHERE can_data ? 'hydraulic_pressure_1'
    GROUP BY 1, 2
)
SELECT CASE WHEN count(*) = 0 THEN 'OK'
            ELSE 'FALLO: ' || count(*) || ' horas con media divergente' END AS check_avg
FROM agg a
JOIN direct d USING (bucket, vehicle_id)
WHERE abs(coalesce(a.avg_pressure_1, 0) - coalesce(d.avg_direct, 0)) > 1e-6;
