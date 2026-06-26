"""Tests de la segmentación de rutas (_segment_trips).

Función pura: no toca BD ni red. Verifica que las rutas se cortan por paradas
reales (>2 min dentro de un radio) y que los periodos sin desplazamiento no
generan ruta. Cubre los dos síntomas reportados:
  - "marca una ruta y el vehículo no se ha movido del sitio"
  - "en una misma ruta varias rutas partidas"
"""
from datetime import datetime, timedelta, timezone

from app.api.v1.vehicles import _segment_trips

_T0 = datetime(2026, 6, 26, 8, 0, 0, tzinfo=timezone.utc)

# ~0.0009° de latitud ≈ 100 m; 0.00018° ≈ 20 m (dentro del radio de 40 m).
_LAT = 39.40
_LON = -0.40


def _row(secs: float, lat: float, lon: float, speed: float = 20.0, ignition: bool = True) -> dict:
    """Fila cruda como la devuelve el SELECT de get_vehicle_trips."""
    return {
        "time": _T0 + timedelta(seconds=secs),
        "lat": lat,
        "lon": lon,
        "ignition": ignition,
        "speed_kmh": speed,
    }


def _moving(start_s: float, count: int, step_s: float, lat0: float, lon0: float, dlat: float):
    """Genera `count` puntos que avanzan en latitud (vehículo en marcha)."""
    return [_row(start_s + i * step_s, lat0 + i * dlat, lon0) for i in range(count)]


def test_vehiculo_parado_todo_el_tiempo_no_genera_ruta():
    # Encendido pero sin moverse del sitio (depresor trabajando parado): mismo punto.
    rows = [_row(i * 30, _LAT, _LON, speed=0.0) for i in range(20)]  # 10 min en un punto
    trips, totals = _segment_trips(rows)
    assert trips == []
    assert totals.trips == 0
    assert totals.distance_km == 0.0


def test_jitter_gps_parado_no_genera_ruta():
    # Parado con ruido de GPS dentro del radio de 40 m → no es una ruta.
    rows = []
    for i in range(20):
        jitter = 0.0001 if i % 2 else -0.0001  # ~±11 m
        rows.append(_row(i * 30, _LAT + jitter, _LON, speed=0.0))
    trips, _ = _segment_trips(rows)
    assert trips == []


def test_recorrido_continuo_es_una_sola_ruta():
    # Avanza de forma continua: una única ruta.
    rows = _moving(0, 30, 20, _LAT, _LON, 0.0009)  # 30 puntos, ~3 km
    trips, totals = _segment_trips(rows)
    assert len(trips) == 1
    assert totals.trips == 1
    assert trips[0].distance_km > 2.0


def test_parada_corta_no_parte_la_ruta():
    # Movimiento, 1 min parado (semáforo) y sigue: debe seguir siendo UNA ruta.
    rows = _moving(0, 10, 20, _LAT, _LON, 0.0009)          # tramo 1
    last = rows[-1]
    plat, plon = last["lat"], last["lon"]
    pausa = [_row(200 + i * 20, plat, plon, speed=0.0) for i in range(1, 4)]  # ~60 s parado
    cont = _moving(280, 10, 20, plat, plon, 0.0009)        # tramo 2
    trips, _ = _segment_trips(rows + pausa + cont)
    assert len(trips) == 1


def test_parada_larga_parte_la_ruta_en_dos():
    # Movimiento, >2 min parado en el mismo sitio, y sigue: dos rutas.
    rows = _moving(0, 10, 20, _LAT, _LON, 0.0009)
    last = rows[-1]
    plat, plon = last["lat"], last["lon"]
    # 200 s parado dentro del radio (> _STOP_MIN_S = 120 s)
    pausa = [_row(200 + i * 20, plat, plon, speed=0.0) for i in range(1, 12)]
    cont = _moving(460, 10, 20, plat, plon, 0.0009)
    trips, totals = _segment_trips(rows + pausa + cont)
    assert len(trips) == 2
    assert totals.trips == 2
    assert trips[0].index == 1 and trips[1].index == 2


def test_hueco_de_telemetria_parte_la_ruta():
    # Apaga el motor (sin telemetría) y reaparece lejos: dos rutas distintas.
    tramo1 = _moving(0, 10, 20, _LAT, _LON, 0.0009)
    # >10 min de hueco y posición distante.
    tramo2 = _moving(1500, 10, 20, _LAT + 0.05, _LON + 0.05, 0.0009)
    trips, _ = _segment_trips(tramo1 + tramo2)
    assert len(trips) == 2


def test_filas_sin_coordenadas_se_ignoran():
    rows = _moving(0, 10, 20, _LAT, _LON, 0.0009)
    rows.insert(5, {"time": _T0 + timedelta(seconds=95), "lat": None, "lon": None,
                    "ignition": True, "speed_kmh": 0.0})
    trips, _ = _segment_trips(rows)
    assert len(trips) == 1
