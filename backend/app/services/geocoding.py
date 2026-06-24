"""Cliente de geocoding Nominatim (búsqueda de ubicación por texto)."""
import httpx
from pydantic import BaseModel

from app.core.config import settings


class GeoResult(BaseModel):
    label: str
    lat: float
    lon: float


async def nominatim_search(
    query: str,
    limit: int = 5,
    nominatim_url: str | None = None,
) -> list[GeoResult]:
    """Busca ubicaciones por texto libre. Devuelve hasta `limit` resultados."""
    base = nominatim_url or settings.nominatim_url
    params = {"q": query, "format": "json", "limit": limit}
    headers = {"User-Agent": "cmg-telematics/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base}/search", params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    return [
        GeoResult(label=item["display_name"], lat=float(item["lat"]), lon=float(item["lon"]))
        for item in data
    ]


async def nominatim_reverse(
    lat: float,
    lon: float,
    nominatim_url: str | None = None,
) -> str | None:
    """Geocodificación inversa: (lat, lon) → dirección legible. None si falla."""
    base = nominatim_url or settings.nominatim_url
    params = {"lat": lat, "lon": lon, "format": "json"}
    headers = {"User-Agent": "cmg-telematics/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base}/reverse", params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    return data.get("display_name")
