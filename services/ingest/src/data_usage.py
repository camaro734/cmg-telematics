"""Captura del consumo de datos por dispositivo para estimar el gasto de la SIM.

Módulo autocontenido: NO reutiliza update_device_last_packet ni el contador
total_messages. Solo escribe en device_data_usage (histórico mensual de bytes).
"""
import asyncpg

# UPSERT del acumulado del mes en curso. El device se resuelve por IMEI y el
# mes (year_month) se calcula en hora local de Madrid para casar con la
# facturación del operador. Si el IMEI no existe, el SELECT no devuelve filas.
_UPSERT_SQL = """
    INSERT INTO device_data_usage (device_id, year_month, bytes)
    SELECT d.id, to_char(now() AT TIME ZONE 'Europe/Madrid', 'YYYY-MM'), $2
    FROM device d
    WHERE d.imei = $1
    ON CONFLICT (device_id, year_month)
    DO UPDATE SET bytes = device_data_usage.bytes + EXCLUDED.bytes
"""


async def record_device_data_usage(
    conn: asyncpg.Connection, imei: str, packet_bytes: int
) -> None:
    """Suma packet_bytes al acumulado del mes en curso del dispositivo.

    packet_bytes = tamaño del frame Codec 8 recibido (cabecera + payload + CRC).
    No-op si packet_bytes <= 0.
    """
    if packet_bytes <= 0:
        return
    await conn.execute(_UPSERT_SQL, imei, packet_bytes)
