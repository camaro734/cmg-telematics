"""Transformación de la señal cruda de un sensor a su valor físico.

Espejo de `frontend/src/lib/sensorValue.ts::applyTransform` — misma matemática
para garantizar que pantalla, exportaciones y reportes muestren lo mismo.
'linear_range' = interpolación lineal de 2 puntos (entrada → salida);
sin transform cae al modo legado scale/offset. Sin recorte fuera de rango.
"""
from __future__ import annotations


def apply_transform(raw: float | None, sensor: dict) -> float | None:
    """Aplica la transformación del sensor al valor crudo.

    :param raw: valor crudo (p. ej. lectura CAN) o None.
    :param sensor: dict de SensorDef; usa ``transform`` o ``scale``/``offset``.
    :returns: valor físico transformado, o None si no hay dato / es degenerado.
    """
    if raw is None:
        return None
    transform = sensor.get("transform")
    if isinstance(transform, dict) and transform.get("type") == "linear_range":
        span = transform["in_max"] - transform["in_min"]
        if span == 0:
            return None
        # 4-20 mA: raw=0 = 0 mA = lazo sin señal (p. ej. PLC arrancando) → sin lectura.
        if transform["in_min"] > 0 and raw == 0:
            return None
        return (raw - transform["in_min"]) * (transform["out_max"] - transform["out_min"]) / span + transform["out_min"]
    scale = sensor.get("scale")
    offset = sensor.get("offset")
    return raw * (scale if scale is not None else 1) + (offset if offset is not None else 0)
