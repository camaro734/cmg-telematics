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


async def valhalla_route_multi(
    points: list[tuple[float, float]],
    valhalla_url: str | None = None,
) -> RouteResult:
    """Ruta coche que pasa por ``points`` (>=2) EN ORDEN. points = [(lat, lon), ...].

    Concatena la geometría de todos los ``legs`` y suma el resumen total. Útil
    para dibujar la ruta base→paradas→base de una orden ya guardada (sin reordenar).
    """
    if len(points) < 2:
        raise ValueError("se necesitan al menos 2 puntos para una ruta")
    base = valhalla_url or settings.valhalla_url
    payload = {
        "locations": [{"lat": p[0], "lon": p[1]} for p in points],
        "costing": "auto",
        "directions_options": {"units": "kilometers"},
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
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


async def valhalla_optimize(
    origin: tuple[float, float],
    stops: list[tuple[float, float]],
    dest: tuple[float, float],
    valhalla_url: str | None = None,
) -> tuple[list[int], RouteResult]:
    """Optimiza el orden de ``stops`` por camino más corto entre ``origin`` y ``dest``.

    Valhalla ``/optimized_route`` ANCLA el primer y último ``location`` (origen y
    destino) y reordena solo los intermedios. Devuelve:
    - ``order``: índices 0-based de ``stops`` en el orden óptimo.
    - ``RouteResult``: geometría completa (concatenada) + distancia/tiempo totales.
    """
    base = valhalla_url or settings.valhalla_url
    locations = [origin, *stops, dest]
    payload = {
        "locations": [{"lat": p[0], "lon": p[1]} for p in locations],
        "costing": "auto",
        "directions_options": {"units": "kilometers"},
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f"{base}/optimized_route", json=payload)
        resp.raise_for_status()
        data = resp.json()
    trip = data["trip"]
    # original_index de la salida: el primero es el origen y el último el destino
    # (anclados); los intermedios son las paradas en orden óptimo. Restamos 1 para
    # pasar del índice en `locations` al índice 0-based dentro de `stops`.
    out_indices = [loc["original_index"] for loc in trip["locations"]]
    order = [idx - 1 for idx in out_indices[1:-1]]
    geometry: list[tuple[float, float]] = []
    for leg in trip.get("legs", []):
        geometry.extend(_decode_polyline6(leg["shape"]))
    result = RouteResult(
        distance_m=trip["summary"]["length"] * 1000.0,
        duration_s=trip["summary"]["time"],
        geometry=geometry,
    )
    return order, result


async def valhalla_optimize_pinned(
    origin: tuple[float, float],
    stops: list[tuple[float, float]],
    dest: tuple[float, float],
    pinned: list[int],
    *,
    optimize_fn=valhalla_optimize,
    route_fn=valhalla_route_multi,
) -> tuple[list[int], RouteResult]:
    """Optimiza el orden de ``stops`` RESPETANDO las paradas fijas.

    ``stops`` llega en el orden de visita actual. ``pinned`` = índices 0-based de
    ``stops`` que NO se mueven (la cita "a una hora"). Las fijas parten la lista en
    tramos; cada tramo de paradas LIBRES entre dos anclas (origen, fija o destino)
    se optimiza por separado con ``optimize_fn``; los tramos SIN libres se resuelven
    con una ruta multipunto directa (``route_fn``). Luego se concatenan orden,
    geometría y totales. Como las libres nunca cruzan una fija, el índice absoluto
    de cada fija se preserva.

    Devuelve el MISMO contrato que :func:`valhalla_optimize`: ``order`` = índices
    0-based de ``stops`` en el nuevo orden de visita global. Sin fijas → equivale a
    una sola llamada a ``optimize_fn`` (comportamiento idéntico al no-fijo).

    ``optimize_fn``/``route_fn`` son inyectables para poder testear la segmentación
    sin un servidor Valhalla.
    """
    n = len(stops)
    # Saneamos: índices válidos, sin duplicados, en orden.
    pins = sorted({i for i in pinned if 0 <= i < n})

    # Sin fijas: una sola optimización de todas las paradas (idéntico al actual).
    if not pins:
        return await optimize_fn(origin, stops, dest)

    # Puntos de corte: -1 = origen, n = destino; entre ellos van las fijas.
    cuts = [-1, *pins, n]
    order: list[int] = []
    geometry: list[tuple[float, float]] = []
    distance_m = 0.0
    duration_s = 0.0

    for k in range(len(cuts) - 1):
        left_cut, right_cut = cuts[k], cuts[k + 1]
        left = origin if left_cut == -1 else stops[left_cut]
        right = dest if right_cut == n else stops[right_cut]
        # Índices de stops libres estrictamente entre las dos anclas (todos libres:
        # no hay otras fijas en medio porque `pins` las contiene todas).
        free = list(range(left_cut + 1, right_cut))

        if free:
            local_order, res = await optimize_fn(left, [stops[i] for i in free], right)
            order.extend(free[t] for t in local_order)
        else:
            res = await route_fn([left, right])

        geometry.extend(res.geometry)
        distance_m += res.distance_m
        duration_s += res.duration_s

        # Tras el tramo, intercalamos la fija que lo cierra (salvo si es el destino).
        if right_cut != n:
            order.append(right_cut)

    return order, RouteResult(distance_m=distance_m, duration_s=duration_s, geometry=geometry)


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
