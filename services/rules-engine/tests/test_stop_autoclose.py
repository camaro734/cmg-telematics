"""
Tests unitarios para stop_autoclose._eval_stop_window.

Todos los tests son síncronos y prueban la función pura _eval_stop_window
con telemetría sintética. No requieren BD ni Redis.

Coordenadas de referencia: stop en (0.0, 0.0) — ecuador, simplifica la geometría.
  1 grado lat ≈ 111 320 m → 100 m ≈ 0.000898°
  INSIDE       (0.000, 0.000)  →   0 m  (dentro de 100 m)
  INSIDE_CLOSE (0.0008, 0.000) →  ~89 m  (dentro de 100 m)
  JITTER       (0.00105, 0.00) → ~117 m  (fuera de 100 m, dentro de 120 m con exit_margin=20)
  OUTSIDE      (0.002, 0.000)  → ~222 m  (claramente fuera)
"""
from datetime import datetime, timezone

import pytest

from src.stop_autoclose import _eval_stop_window, _resolve_signal

# ── Helpers ──────────────────────────────────────────────────────────────────

STOP_LAT, STOP_LON = 0.0, 0.0
INSIDE       = (0.0,     0.0)
INSIDE_CLOSE = (0.0008,  0.0)
JITTER       = (0.00105, 0.0)   # fuera del radio nominal pero dentro con exit_margin=20
OUTSIDE      = (0.002,   0.0)

DEFAULT_CFG = {
    "enabled":             True,
    "service_signal_key":  "pto_active",
    "signal_op":           "==",
    "signal_value":        True,
    "min_active_seconds":  60,
    "min_inactive_seconds": 60,
    "exit_margin_m":       20,
}


def _t(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc)


def make_row(epoch: float, lat: float, lon: float, pto: bool = False,
             can_data: dict | None = None) -> dict:
    return {
        "time":       _t(epoch),
        "lat":        lat,
        "lon":        lon,
        "pto_active": pto,
        "ignition":   False,
        "speed_kmh":  0.0,
        "can_data":   can_data or {},
    }


def make_stop(
    status: str = "pending",
    lat: float = STOP_LAT,
    lon: float = STOP_LON,
    radius: int = 100,
    arrived_at: datetime | None = None,
    started_at: datetime | None = None,
) -> dict:
    return {
        "id":               "test-stop-1",
        "status":           status,
        "lat":              lat,
        "lon":              lon,
        "arrival_radius_m": radius,
        "arrived_at":       arrived_at,
        "started_at":       started_at,
        "order_created_at": _t(0),
    }


# ── Test 1: servicio normal → in_progress y done en los time correctos ────────

def test_servicio_normal():
    """
    T=0:    dentro, PTO off → pending→arrived
    T=1-61: dentro, PTO on (61 s ≥ min_active=60) → arrived→in_progress en T=1
    T=62-122: dentro, PTO off (61 s ≥ min_inactive=60) → done; completed_at=T=61
    """
    rows = (
        [make_row(0, *INSIDE, pto=False)] +
        [make_row(t, *INSIDE, pto=True)  for t in range(1,  62)] +
        [make_row(t, *INSIDE, pto=False) for t in range(62, 123)]
    )
    stop = make_stop()
    now  = _t(130)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd is not None
    assert upd["status"] == "done"
    assert upd["arrived_at"].timestamp()   == 0.0
    assert upd["started_at"].timestamp()   == 1.0
    assert upd["completed_at"].timestamp() == 61.0


# ── Test 2: solo pasaba (geocerca sin señal) → no arranca ─────────────────────

def test_solo_pasaba():
    """Vehículo dentro de la geocerca pero sin PTO → arrived, nunca in_progress."""
    rows = [make_row(t, *INSIDE, pto=False) for t in range(200)]
    stop = make_stop()
    now  = _t(200)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd is not None
    assert upd["status"] == "arrived"
    assert "started_at"   not in upd or upd.get("started_at") is None


# ── Test 3: señal activa fuera de geocerca → no arranca ───────────────────────

def test_fuera_geocerca():
    """PTO activo pero fuera de la geocerca → sin transición (permanece pending)."""
    rows = [make_row(t, *OUTSIDE, pto=True) for t in range(200)]
    stop = make_stop()
    now  = _t(200)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd is None   # no hay cambio de estado


# ── Test 4: pausa breve a media faena → sigue in_progress ────────────────────

def test_pausa_breve():
    """
    Stop ya en in_progress. PTO off durante 30 s (< min_inactive=60) → permanece
    in_progress; sin transición a done.
    """
    rows = (
        [make_row(t, *INSIDE, pto=True)  for t in range(101)] +
        [make_row(t, *INSIDE, pto=False) for t in range(101, 131)]
    )
    stop = make_stop(
        status     = "in_progress",
        arrived_at = _t(0),
        started_at = _t(0),
    )
    now = _t(130)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd is None   # sin cambio — sigue in_progress


# ── Test 5: jitter GPS en el borde → sin flapping (histéresis exit_margin) ───

def test_jitter_gps_borde():
    """
    Vehículo entra (0 m), luego oscila en ~117 m (fuera del radio nominal 100 m
    pero dentro del radio de salida 120 m con exit_margin=20). geo_inside debe
    permanecer True y el servicio arrancar sin interrupciones.
    """
    rows = (
        [make_row(0, *INSIDE, pto=True)] +           # entra y PTO on
        [make_row(t, *JITTER, pto=True) for t in range(1, 70)] +   # jitter
        [make_row(t, *INSIDE, pto=True) for t in range(70, 140)]   # vuelve dentro
    )
    stop = make_stop()
    now  = _t(140)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd is not None
    # Con histéresis el servicio arranca (in_progress a T=60 desde signal_start=0)
    assert upd.get("status") == "in_progress"
    assert upd["started_at"].timestamp() == 0.0   # signal_start desde T=0


# ── Test 6: pico de ruido en la señal (un punto) → no dispara ────────────────

def test_pico_ruido_senal():
    """
    Stop en arrived. Un solo punto con PTO on (spike de 1 s) no cumple
    min_active_seconds=60 → permanece arrived.
    """
    rows = [
        make_row(0, *INSIDE, pto=False),
        make_row(1, *INSIDE, pto=True),    # spike — 1 s
        make_row(2, *INSIDE, pto=False),   # apaga antes de cumplir el mínimo
        *[make_row(t, *INSIDE, pto=False) for t in range(3, 100)],
    ]
    stop = make_stop(status="arrived", arrived_at=_t(0))
    now  = _t(100)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd is None   # sin cambio — sigue arrived


# ── Test 7: registros desordenados → estado correcto ─────────────────────────

def test_registros_desordenados():
    """
    Registros insertados en orden de recepción (buffer offline), ordenados por
    device-time antes de pasarlos al evaluador (como hace la query ORDER BY time ASC).
    El resultado debe ser idéntico al caso ordenado.
    """
    INSIDE_ = INSIDE

    # Datos "tal como llegarían a la BD" (orden de recepción, mezclados)
    reception_order = [
        make_row(80,  *INSIDE_, pto=True),
        make_row(90,  *INSIDE_, pto=False),
        make_row(10,  *INSIDE_, pto=True),
        make_row(0,   *INSIDE_, pto=False),
        make_row(150, *INSIDE_, pto=False),
        make_row(70,  *INSIDE_, pto=True),
        make_row(20,  *INSIDE_, pto=True),
        make_row(100, *INSIDE_, pto=False),
        make_row(30,  *INSIDE_, pto=True),
        make_row(40,  *INSIDE_, pto=True),
        make_row(50,  *INSIDE_, pto=True),
        make_row(60,  *INSIDE_, pto=True),
        make_row(110, *INSIDE_, pto=False),
        make_row(120, *INSIDE_, pto=False),
        make_row(130, *INSIDE_, pto=False),
        make_row(140, *INSIDE_, pto=False),
    ]

    # La query del sweep hace ORDER BY time ASC — simulamos eso:
    rows = sorted(reception_order, key=lambda r: r["time"])

    stop = make_stop()
    now  = _t(160)

    upd = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)

    # T=0 arrive; signal_start=T=10; in_progress at T=70 (60 s); last_active=T=80;
    # signal_off=T=90; done at T=150 (60 s); completed_at=T=80.
    assert upd is not None
    assert upd["status"]             == "done"
    assert upd["started_at"].timestamp()   == 10.0
    assert upd["completed_at"].timestamp() == 80.0


# ── Test 8: hueco de cobertura → NO cierra durante el hueco; cierra al reanudar

def test_hueco_cobertura():
    """
    Fase 1: rows T=0–141, now = T=141+3h (MUDO: 3h > freshness=2h).
      El algoritmo calcula done pero el guardado de cierre lo revierte → in_progress.
    Fase 2: rows T=0–200 (vehículo reanudó), now = T=200 (fresco).
      El algoritmo cierra correctamente; completed_at = T=80 (último punto activo).
    """
    INSIDE_ = INSIDE
    freshness_s = 7200  # 2 h

    rows_fase1 = (
        [make_row(t, *INSIDE_, pto=True)  for t in range(81)] +    # T=0..80 PTO on
        [make_row(t, *INSIDE_, pto=False) for t in range(81, 142)] # T=81..141 PTO off (61 s)
    )

    # ── Fase 1: durante el hueco ──────────────────────────────────────────────
    stop = make_stop()
    now_stale = _t(141 + 3 * 3600)   # 3 h después del último punto → MUDO

    upd1 = _eval_stop_window(rows_fase1, stop, DEFAULT_CFG, now_stale, freshness_s)

    # El guardado de cierre impide done; el stop pasa a in_progress (pending→…→in_progress)
    assert upd1 is not None
    assert upd1["status"] == "in_progress"
    assert "completed_at" not in upd1 or upd1.get("completed_at") is None

    # ── Fase 2: vehículo reanuda, reevaluamos con datos frescos ──────────────
    rows_fase2 = rows_fase1 + [make_row(t, *INSIDE_, pto=False) for t in range(142, 201)]

    stop_p2 = make_stop(
        status     = "in_progress",
        arrived_at = _t(0),
        started_at = _t(0),
    )
    now_fresh = _t(200)

    upd2 = _eval_stop_window(rows_fase2, stop_p2, DEFAULT_CFG, now_fresh, freshness_s)

    assert upd2 is not None
    assert upd2["status"]             == "done"
    assert upd2["completed_at"].timestamp() == 80.0


# ── Test 9: idempotencia — dos pasadas → sin doble transición ─────────────────

def test_idempotencia():
    """
    Primera pasada: calcula la transición y devuelve updates.
    Segunda pasada con el stop ya en el estado final: devuelve None.
    """
    rows = (
        [make_row(0, *INSIDE, pto=False)] +
        [make_row(t, *INSIDE, pto=True)  for t in range(1,  62)] +
        [make_row(t, *INSIDE, pto=False) for t in range(62, 123)]
    )
    stop = make_stop()
    now  = _t(130)

    upd1 = _eval_stop_window(rows, stop, DEFAULT_CFG, now, freshness_seconds=7200)
    assert upd1 is not None
    assert upd1["status"] == "done"

    # Simulamos el estado en BD tras aplicar upd1
    stop_final = make_stop(
        status     = "done",
        arrived_at = upd1.get("arrived_at"),
        started_at = upd1.get("started_at"),
    )
    stop_final["completed_at"] = upd1.get("completed_at")  # campo extra para la comprobación interna

    upd2 = _eval_stop_window(rows, stop_final, DEFAULT_CFG, now, freshness_seconds=7200)

    assert upd2 is None   # ya está en done — sin cambio


# ── Test adicional: _resolve_signal con señal CAN analógica ──────────────────

def test_resolve_signal_can_analogico():
    """service_signal_key apunta a can_data (avl_150 > 50 bar)."""
    cfg = {
        "service_signal_key": "avl_150",
        "signal_op":          ">",
        "signal_value":       50,
    }
    row_activo = {"time": _t(0), "lat": 0.0, "lon": 0.0,
                  "pto_active": False, "can_data": {"avl_150": 80}}
    row_inactivo = {"time": _t(1), "lat": 0.0, "lon": 0.0,
                    "pto_active": False, "can_data": {"avl_150": 20}}
    row_sin_senal = {"time": _t(2), "lat": 0.0, "lon": 0.0,
                     "pto_active": False, "can_data": {}}

    assert _resolve_signal(cfg, row_activo)   is True
    assert _resolve_signal(cfg, row_inactivo) is False
    assert _resolve_signal(cfg, row_sin_senal) is False
