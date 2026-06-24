"""Cliente del motor de rutas Valhalla (autoalojado, red interna)."""
import httpx
from pydantic import BaseModel

from app.core.config import settings


class RouteResult(BaseModel):
    distance_m: float
    duration_s: float
    geometry: list[tuple[float, float]]  # lista de (lat, lon)


def _decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Decodifica una polyline de Valhalla (precisión 6) a (lat, lon)."""
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        for _unit in range(2):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else (result >> 1)
            if _unit == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lat / 1e6, lon / 1e6))
    return coords


async def valhalla_route(
    origin: tuple[float, float],
    dest: tuple[float, float],
    valhalla_url: str | None = None,
) -> RouteResult:
    """Calcula ruta coche origen→destino. origin/dest = (lat, lon)."""
    base = valhalla_url or settings.valhalla_url
    payload = {
        "locations": [
            {"lat": origin[0], "lon": origin[1]},
            {"lat": dest[0], "lon": dest[1]},
        ],
        "costing": "auto",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(f"{base}/route", json=payload)
        resp.raise_for_status()
        data = resp.json()
    trip = data["trip"]
    geometry: list[tuple[float, float]] = []
    for leg in trip.get("legs", []):
        geometry.extend(_decode_polyline6(leg["shape"]))
    return RouteResult(
        distance_m=trip["summary"]["length"] * 1000.0,
        duration_s=trip["summary"]["time"],
        geometry=geometry,
    )


async def valhalla_trace_distance_m(
    trace: list[tuple[float, float]],
    valhalla_url: str | None = None,
) -> float:
    """Distancia recorrida (metros) de una traza GPS por map-matching de Valhalla.

    Usa ``/trace_route`` (shape_match=map_snap) para encajar la traza a la red viaria.
    ``trace`` = lista de (lat, lon). Lanza si la traza es insuficiente o Valhalla falla;
    el llamante decide el fallback (haversine).
    """
    if len(trace) < 2:
        raise ValueError("traza insuficiente para map-matching")
    base = valhalla_url or settings.valhalla_url
    payload = {
        "shape": [{"lat": p[0], "lon": p[1]} for p in trace],
        "costing": "auto",
        "shape_match": "map_snap",
        "directions_options": {"units": "kilometers"},
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f"{base}/trace_route", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return float(data["trip"]["summary"]["length"]) * 1000.0
