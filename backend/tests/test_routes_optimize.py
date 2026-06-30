"""Tests de la optimización de rutas que RESPETA las paradas fijas (candado).

Cubren la segmentación por tramos de ``valhalla_optimize_pinned`` sin tocar el
servidor Valhalla: se inyectan funciones deterministas en lugar de las reales.

Convención de los fakes:
- ``fake_optimize(origin, stops, dest)`` **invierte** el orden local de las
  paradas (así se ve claramente que un tramo SÍ se reordena) y devuelve totales
  y geometría predecibles.
- ``fake_route(points)`` resuelve un tramo SIN libres (ruta multipunto directa).
"""
from app.services.routing import RouteResult, valhalla_optimize_pinned

# Coordenadas de juguete; el valor no importa, solo la identidad para trazar.
ORIGIN = (0.0, 0.0)
DEST = (9.0, 9.0)


def _stops(n: int) -> list[tuple[float, float]]:
    return [(float(i + 1), float(i + 1)) for i in range(n)]


async def fake_optimize(origin, stops, dest):
    """Invierte el orden local de `stops`; totales y geometría deterministas."""
    order = list(reversed(range(len(stops))))
    res = RouteResult(
        distance_m=len(stops) * 100.0,
        duration_s=len(stops) * 10.0,
        geometry=[origin, *stops, dest],
    )
    return order, res


async def fake_route(points):
    """Tramo sin libres: ruta directa entre dos (o más) anclas."""
    return RouteResult(
        distance_m=(len(points) - 1) * 100.0,
        duration_s=(len(points) - 1) * 10.0,
        geometry=list(points),
    )


async def _run(stops, pinned):
    return await valhalla_optimize_pinned(
        ORIGIN, stops, DEST, pinned,
        optimize_fn=fake_optimize, route_fn=fake_route,
    )


async def test_sin_fijas_equivale_a_optimizar_todo():
    """Regresión: sin candados, una sola optimización de TODAS las paradas."""
    stops = _stops(5)
    order, res = await _run(stops, [])
    assert order == [4, 3, 2, 1, 0]               # reverse de todas
    assert sorted(order) == list(range(5))         # permutación válida
    assert res.distance_m == 500.0                 # única llamada: 5 * 100
    assert res.duration_s == 50.0
    assert len(res.geometry) == 7                  # origin + 5 stops + dest


async def test_una_fija_mantiene_su_posicion():
    """La parada fija (índice 2) no se mueve; las libres se reordenan alrededor."""
    stops = _stops(5)
    order, res = await _run(stops, [2])
    assert order == [1, 0, 2, 4, 3]
    assert order[2] == 2                            # la fija sigue en su sitio
    assert sorted(order) == list(range(5))
    # Dos tramos optimizados de 2 stops cada uno.
    assert res.distance_m == 400.0
    assert res.duration_s == 40.0
    assert len(res.geometry) == 8                   # 4 + 4


async def test_dos_fijas_adyacentes():
    """Dos fijas seguidas: el tramo entre ellas no tiene libres (ruta directa)."""
    stops = _stops(4)
    order, res = await _run(stops, [1, 2])
    assert order == [0, 1, 2, 3]
    assert order[1] == 1 and order[2] == 2          # ambas fijas en su sitio
    assert sorted(order) == list(range(4))
    # tramo0 optimize(1)=100 + tramo1 route(2 pts)=100 + tramo2 optimize(1)=100
    assert res.distance_m == 300.0


async def test_fija_en_primera_posicion():
    """Fija en el índice 0: el tramo origen→fija no tiene libres (ruta directa)."""
    stops = _stops(3)
    order, res = await _run(stops, [0])
    assert order == [0, 2, 1]
    assert order[0] == 0
    assert sorted(order) == list(range(3))


async def test_fija_en_ultima_posicion():
    """Fija en el último índice: el tramo fija→destino no tiene libres."""
    stops = _stops(3)
    order, res = await _run(stops, [2])
    assert order == [1, 0, 2]
    assert order[2] == 2
    assert sorted(order) == list(range(3))


async def test_todas_fijas_conserva_el_orden():
    """Todas fijas: nada se reordena; todos los tramos son rutas directas."""
    stops = _stops(3)
    order, res = await _run(stops, [0, 1, 2])
    assert order == [0, 1, 2]
    # 4 tramos directos de 2 puntos: 4 * 100
    assert res.distance_m == 400.0


async def test_indices_fijos_invalidos_se_ignoran():
    """Índices fuera de rango o duplicados se sanean sin romper."""
    stops = _stops(3)
    order, _ = await _run(stops, [2, 2, 99, -1])
    assert order == [1, 0, 2]                        # equivale a pinned=[2]
    assert sorted(order) == list(range(3))
