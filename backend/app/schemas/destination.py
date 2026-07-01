import uuid
from datetime import datetime
from pydantic import BaseModel


class DestinationIn(BaseModel):
    lat: float
    lon: float
    label: str


class RouteInfo(BaseModel):
    distance_m: float
    duration_s: float
    geometry: list[tuple[float, float]]


class DestinationOut(BaseModel):
    vehicle_id: uuid.UUID
    label: str
    lat: float
    lon: float
    status: str
    assigned_at: datetime
    arrived_at: datetime | None = None
    route: RouteInfo | None = None          # ruta restante desde la posición actual
    remaining_distance_m: float | None = None
    remaining_duration_s: float | None = None


class ReverseGeoOut(BaseModel):
    # Dirección textual de una coordenada; address None/"" si Nominatim no resuelve.
    address: str | None = None
