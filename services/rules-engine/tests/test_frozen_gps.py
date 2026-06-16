"""
Backtest determinista del detector frozen_gps con datos REALES del FUSO 3.5
(vehicle_id 9130e55d-4504-4a8b-9bde-75d07dd253e9, 2026-06-15).

Dos ventanas extraidas directamente de telemetry_record:

  A) 13:21–14:05 UTC — Static Navigation activo.
     El dispositivo teletransporta ~1.6 km con speed_kmh=0 a las 13:37 y ~1.5
     km a las 13:54. El detector debe encontrar >= 2 saltos y DISPARAR.

  B) 09:00–09:30 UTC — vehiculo legitimamente parado.
     Una unica coordenada repetida (39.4063916, -0.3857833). 0 saltos.
     El detector NO debe disparar.

No requiere BD ni Redis — valida la logica pura de _count_jumps.
"""
import pytest

from src.frozen_gps import _count_jumps, _haversine_m, _JUMP_M, _MIN_JUMPS


# ── Helper ────────────────────────────────────────────────────────────────────

def _r(lat: float, lon: float, speed: float = 0) -> dict:
    """Crea un record minimo compatible con _count_jumps (time no se usa en la logica)."""
    return {"lat": lat, "lon": lon, "speed_kmh": speed, "time": None}


# ── Datos reales ventana A: Static Navigation activo (13:21–14:05 UTC) ────────
#
# Registros extraidos de BD. Solo se incluyen los puntos relevantes:
# suficientes para cubrir la ventana y los dos saltos reales.
#
# Salto 1: 13:37:16 → 13:37:28
#   (39.4063916, -0.3857833) → (39.3932133, -0.3954833)  ~1 594 m, speed=0
# Salto 2: 13:53:55 → 13:54:01
#   (39.3932133, -0.3954833) → (39.4063183, -0.3858616)  ~1 483 m, speed=0

STATIC_NAV_RECORDS = [
    # Bloque 1: posicion congelada (base de operaciones)
    _r(39.4063916, -0.3857833),   # 13:21:38
    _r(39.4063916, -0.3857833),   # 13:22:07
    _r(39.4063916, -0.3857833),   # 13:25:07
    _r(39.4063916, -0.3857833),   # 13:30:38
    _r(39.4063916, -0.3857833),   # 13:35:38
    _r(39.4063916, -0.3857833),   # 13:36:47
    _r(39.4063916, -0.3857833),   # 13:37:16  <- ultimo antes del salto
    # SALTO 1: 1 594 m, speed=0
    _r(39.3932133, -0.3954833),   # 13:37:28  <- teletransporte
    _r(39.3932133, -0.3954833),   # 13:37:46
    _r(39.3932133, -0.3954833),   # 13:43:14
    _r(39.3932133, -0.3954833),   # 13:48:14
    _r(39.3932133, -0.3954833),   # 13:53:14
    _r(39.3932133, -0.3954833),   # 13:53:55  <- ultimo antes del salto
    # SALTO 2: 1 483 m, speed=0
    _r(39.4063183, -0.3858616),   # 13:54:01  <- teletransporte
    _r(39.4063183, -0.3858616),   # 13:54:24
    _r(39.4063183, -0.3858616),   # 13:57:42
    _r(39.4063183, -0.3858616),   # 14:01:53
]

# ── Datos reales ventana B: parado real (09:00–09:30 UTC) ─────────────────────
# Una unica coordenada repetida durante 30 min. 0 saltos esperados.

PARKED_RECORDS = [
    _r(39.4063916, -0.3857833),   # 09:00:25
    _r(39.4063916, -0.3857833),   # 09:00:55
    _r(39.4063916, -0.3857833),   # 09:01:25
    _r(39.4063916, -0.3857833),   # 09:02:25
    _r(39.4063916, -0.3857833),   # 09:05:17
    _r(39.4063916, -0.3857833),   # 09:10:17
    _r(39.4063916, -0.3857833),   # 09:15:17
    _r(39.4063916, -0.3857833),   # 09:20:17
    _r(39.4063916, -0.3857833),   # 09:25:17
]


# ── Sanity checks de distancia ────────────────────────────────────────────────

def test_salto1_distancia_real():
    """El primer teletransporte real mide > 300 m (real: ~1 594 m)."""
    dist = _haversine_m(39.4063916, -0.3857833, 39.3932133, -0.3954833)
    assert dist > _JUMP_M
    assert dist > 1_400  # al menos 1.4 km


def test_salto2_distancia_real():
    """El segundo teletransporte real mide > 300 m (real: ~1 483 m)."""
    dist = _haversine_m(39.3932133, -0.3954833, 39.4063183, -0.3858616)
    assert dist > _JUMP_M
    assert dist > 1_300  # al menos 1.3 km


# ── Backtest ventana Static Nav ───────────────────────────────────────────────

def test_static_nav_detecta_exactamente_dos_saltos():
    """El detector encuentra los 2 saltos reales del FUSO (ninguno mas)."""
    jumps = _count_jumps(STATIC_NAV_RECORDS)
    assert len(jumps) == 2


def test_static_nav_dispara():
    """La condicion de disparo (>= _MIN_JUMPS) se cumple con datos reales."""
    jumps = _count_jumps(STATIC_NAV_RECORDS)
    assert len(jumps) >= _MIN_JUMPS


def test_static_nav_distancias_correctas():
    """Los dos saltos detectados tienen la distancia esperada (> 1 km)."""
    jumps = _count_jumps(STATIC_NAV_RECORDS)
    for jump in jumps:
        assert jump["dist_m"] > 1_000, f"Salto demasiado corto: {jump['dist_m']:.0f} m"


# ── Backtest ventana parado ───────────────────────────────────────────────────

def test_parked_no_dispara():
    """Vehiculo parado con una sola coordenada: 0 saltos, no debe disparar."""
    jumps = _count_jumps(PARKED_RECORDS)
    assert len(jumps) == 0


# ── Tests de logica de la funcion ─────────────────────────────────────────────

def test_speed_positivo_no_cuenta():
    """Un salto de > 300 m con speed_kmh > 0 no es Static Navigation."""
    records = [
        _r(39.4063916, -0.3857833, speed=0),
        _r(39.3932133, -0.3954833, speed=30),   # conduccion normal
        _r(39.3932133, -0.3954833, speed=0),
        _r(39.4063183, -0.3858616, speed=25),   # conduccion normal
    ]
    assert len(_count_jumps(records)) == 0


def test_desplazamiento_pequeno_no_cuenta():
    """Un desplazamiento < 300 m con speed=0 no es un teletransporte."""
    records = [
        _r(39.4063916, -0.3857833),
        _r(39.4065200, -0.3857833),  # ~143 m al norte
    ]
    assert len(_count_jumps(records)) == 0


def test_un_solo_salto_no_dispara():
    """Un solo salto no alcanza el umbral _MIN_JUMPS."""
    records = [
        _r(39.4063916, -0.3857833),
        _r(39.3932133, -0.3954833),  # salto 1 (~1.6 km, speed=0)
        _r(39.3932133, -0.3954833),
        _r(39.3932133, -0.3954833),
    ]
    jumps = _count_jumps(records)
    assert len(jumps) == 1
    assert len(jumps) < _MIN_JUMPS


def test_lista_vacia_no_falla():
    assert _count_jumps([]) == []


def test_un_registro_no_falla():
    assert _count_jumps([_r(39.4, -0.38)]) == []


def test_none_lat_lon_ignorado():
    """Registros con lat/lon None se saltan sin error."""
    records = [
        {"lat": None, "lon": None, "speed_kmh": 0, "time": None},
        _r(39.4063916, -0.3857833),
        {"lat": None, "lon": -0.39, "speed_kmh": 0, "time": None},
        _r(39.3932133, -0.3954833),
    ]
    jumps = _count_jumps(records)
    # El salto None→valid y valid→None se ignoran; solo cuenta valid→valid > 300 m
    assert isinstance(jumps, list)
