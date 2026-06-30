"""Schemas del optimizador de rutas (stateless, no persiste)."""
import uuid
from typing import Literal

from pydantic import BaseModel, Field


class RoutePoint(BaseModel):
    """Origen o destino de una optimización.

    - ``base``: usa la base del tenant del usuario (tenant.base_lat/base_lon).
    - ``vehicle``: última posición conocida del camión (Redis), requiere vehicle_id.
    - ``coords`` / ``address``: coordenadas explícitas (lat/lon).
    """
    type: Literal["base", "vehicle", "coords", "address"]
    vehicle_id: uuid.UUID | None = None
    lat: float | None = None
    lon: float | None = None


class LatLon(BaseModel):
    lat: float
    lon: float


class OptimizeIn(BaseModel):
    origin: RoutePoint
    stops: list[LatLon]
    destination: RoutePoint
    # Índices 0-based de ``stops`` que están FIJAS (candado): mantienen su posición;
    # solo se reordenan las paradas libres entre ellas. Vacío = optimizar todas.
    pinned: list[int] = Field(default_factory=list)


class OptimizeOut(BaseModel):
    # Índices 0-based de `stops` (de la petición) en el orden óptimo.
    order: list[int]
    distance_m: float
    duration_s: float
    geometry: list[tuple[float, float]]  # [(lat, lon), ...] ya decodificada
