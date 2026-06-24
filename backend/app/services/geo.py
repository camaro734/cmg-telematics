"""Helpers geográficos puros y compartidos.

Centraliza la distancia haversine para no reimplementarla en cada módulo.
Espejo de ``rules-engine/src/field_ops._haversine_m`` (el detector vive en el
servicio backend y no puede importar del paquete del rules-engine, asyncpg).
"""
import math


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos puntos GPS (lat, lon)."""
    radius = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
