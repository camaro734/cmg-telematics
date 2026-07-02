"""fix telemetry_1h: engine_on_minutes/pto_active_minutes eran CONTEO DE REGISTROS.

## Causa raíz
La definición original de `telemetry_1h` (migración 001) calculaba:

    sum(CASE WHEN ignition   THEN 1 ELSE 0 END) AS engine_on_minutes
    sum(CASE WHEN pto_active THEN 1 ELSE 0 END) AS pto_active_minutes

Eso NO son minutos: suma 1 por CADA registro con el flag activo. Solo sería
correcto si el FMC650 emitiera exactamente 1 registro/minuto. En realidad emite
por evento/CAN/movimiento (cadencia ~4 s de mediana ≈ 15 registros/minuto), de
modo que las "horas de motor" salían infladas ~10-15×. Ejemplo real (vehículo
#F97316, 2026-07-01): 35h36m de motor en un solo día (imposible; real ≈ 3h52m).
El gráfico horario mostraba 600-750 "minutos" por hora (eran registros/hora).

Afecta a los 4 consumidores de estas columnas: reportes (PDF + /kpis), KPIs de
flota y acumuladores de mantenimiento predictivo. Por eso el arreglo va en la
FUENTE (el continuous aggregate), no en cada consumidor.

## Solución: agregado jerárquico de 2 niveles
TimescaleDB no admite `count(distinct)` dentro de un continuous aggregate, así
que "minutos distintos con actividad" se obtiene en dos pasos:

  - `telemetry_1min`: por minuto, guarda el flag encendido/apagado (max de 0/1 →
    1 si el motor estuvo encendido en ALGÚN momento de ese minuto) y los
    parciales (sum/count/max) de presión y temperatura para poder recomponer las
    medias horarias sin error de "media de medias".
  - `telemetry_1h`: rollup horario sobre `telemetry_1min`. Ahora
    engine_on_minutes = sum(engine_on) = nº de minutos distintos con motor
    encendido (máx 60/hora, máx 1440/día). Las columnas y tipos que consumen los
    endpoints (avg_pressure_1, max_pressure_1, avg_oil_temp, max_oil_temp,
    pto_active_minutes, engine_on_minutes, record_count) se conservan idénticas,
    así que NINGÚN consumidor cambia.

Validado read-only sobre datos reales: la media horaria vía parciales coincide
exactamente con la media directa (0 discrepancias en 14 horas) y los minutos
quedan ≤ 60/hora.

## ⚠️ Al APLICAR en producción (fuera de esta migración)
1. `CREATE ... WITH NO DATA` no rellena el histórico. Tras `alembic upgrade`,
   ejecutar (FUERA de transacción; refresh_continuous_aggregate no puede correr
   dentro de un bloque transaccional):

       CALL refresh_continuous_aggregate('telemetry_1min', NULL, NULL);
       CALL refresh_continuous_aggregate('telemetry_1h',   NULL, NULL);

2. `telemetry_1h` se reconstruye desde `telemetry_record` (retención 90 días):
   los rollups horarios de más de 90 días atrás no se pueden recomputar. Con el
   volumen actual (~2 semanas de datos) no hay pérdida relevante.
3. Verificación: backend/scripts/verify_telemetry_1h_fix.sql

Revision ID: 066
Revises: 065
"""
from alembic import op

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Fuera con el agregado horario defectuoso (arrastra sus políticas).
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_1h CASCADE;")

    # 2) Nivel 1 — minuto: flag on/off por minuto + parciales para medias exactas.
    op.execute("""
        CREATE MATERIALIZED VIEW telemetry_1min
        WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
        SELECT
            time_bucket('1 minute', time)                        AS bucket,
            vehicle_id, tenant_id,
            max(CASE WHEN ignition   THEN 1 ELSE 0 END)          AS engine_on,
            max(CASE WHEN pto_active THEN 1 ELSE 0 END)          AS pto_on,
            sum((can_data->>'hydraulic_pressure_1')::float)      AS sum_pressure_1,
            count((can_data->>'hydraulic_pressure_1')::float)    AS cnt_pressure_1,
            max((can_data->>'hydraulic_pressure_1')::float)      AS max_pressure_1,
            sum((can_data->>'oil_temp_c')::float)                AS sum_oil_temp,
            count((can_data->>'oil_temp_c')::float)              AS cnt_oil_temp,
            max((can_data->>'oil_temp_c')::float)                AS max_oil_temp,
            count(*)                                             AS record_count
        FROM telemetry_record
        GROUP BY 1, 2, 3
        WITH NO DATA;
    """)
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1min',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '5 minutes',
            schedule_interval => INTERVAL '15 minutes');
    """)
    op.execute("SELECT add_retention_policy('telemetry_1min', INTERVAL '1 year');")

    # 3) Nivel 2 — hora: rollup sobre el minuto. engine_on_minutes/pto_active_minutes
    #    ahora son MINUTOS reales (≤60/hora). Columnas idénticas a las que ya
    #    consumen los endpoints; la media se recompone con sum(parciales)/sum(cuenta).
    op.execute("""
        CREATE MATERIALIZED VIEW telemetry_1h
        WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
        SELECT
            time_bucket('1 hour', bucket)                        AS bucket,
            vehicle_id, tenant_id,
            sum(sum_pressure_1) / nullif(sum(cnt_pressure_1), 0) AS avg_pressure_1,
            max(max_pressure_1)                                  AS max_pressure_1,
            sum(sum_oil_temp)   / nullif(sum(cnt_oil_temp), 0)   AS avg_oil_temp,
            max(max_oil_temp)                                    AS max_oil_temp,
            sum(pto_on)                                          AS pto_active_minutes,
            sum(engine_on)                                       AS engine_on_minutes,
            sum(record_count)                                    AS record_count
        FROM telemetry_1min
        GROUP BY 1, 2, 3
        WITH NO DATA;
    """)
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1h',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '10 minutes',
            schedule_interval => INTERVAL '15 minutes');
    """)
    op.execute("SELECT add_retention_policy('telemetry_1h', INTERVAL '1 year');")


def downgrade() -> None:
    # Restaura el estado previo: agregado horario de un solo nivel (con el conteo
    # defectuoso original) directamente sobre telemetry_record, y elimina el minuto.
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_1h CASCADE;")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_1min CASCADE;")
    op.execute("""
        CREATE MATERIALIZED VIEW telemetry_1h
        WITH (timescaledb.continuous) AS
        SELECT
            time_bucket('1 hour', time)                         AS bucket,
            vehicle_id, tenant_id,
            avg((can_data->>'hydraulic_pressure_1')::float)     AS avg_pressure_1,
            max((can_data->>'hydraulic_pressure_1')::float)     AS max_pressure_1,
            avg((can_data->>'oil_temp_c')::float)               AS avg_oil_temp,
            max((can_data->>'oil_temp_c')::float)               AS max_oil_temp,
            sum(CASE WHEN pto_active THEN 1 ELSE 0 END)         AS pto_active_minutes,
            sum(CASE WHEN ignition   THEN 1 ELSE 0 END)         AS engine_on_minutes,
            count(*)                                            AS record_count
        FROM telemetry_record
        GROUP BY bucket, vehicle_id, tenant_id
        WITH NO DATA;
    """)
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1h',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour');
    """)
