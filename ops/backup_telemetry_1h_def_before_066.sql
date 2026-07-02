-- Backup definición telemetry_1h ANTES de migración 066 (2026-07-02T06:52:21Z)
-- Rollback: alembic downgrade 065 (recrea este CAgg) o pegar la definición de migración 001.
 SELECT time_bucket('01:00:00'::interval, "time") AS bucket,
    vehicle_id,
    tenant_id,
    avg(((can_data ->> 'hydraulic_pressure_1'::text))::double precision) AS avg_pressure_1,
    max(((can_data ->> 'hydraulic_pressure_1'::text))::double precision) AS max_pressure_1,
    avg(((can_data ->> 'oil_temp_c'::text))::double precision) AS avg_oil_temp,
    max(((can_data ->> 'oil_temp_c'::text))::double precision) AS max_oil_temp,
    sum(
        CASE
            WHEN pto_active THEN 1
            ELSE 0
        END) AS pto_active_minutes,
    sum(
        CASE
            WHEN ignition THEN 1
            ELSE 0
        END) AS engine_on_minutes,
    count(*) AS record_count
   FROM telemetry_record
  GROUP BY (time_bucket('01:00:00'::interval, "time")), vehicle_id, tenant_id;
