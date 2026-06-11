"""Tests para _should_emit: throttling con paso libre para cambios de estado."""
from app.api.v1.ws import _should_emit


def test_first_time_always_emits():
    assert _should_emit("v1", True, False, {}, {}, 100.0) is True


def test_same_state_within_window_suppressed():
    last_sent = {"v1": 99.5}
    last_state = {"v1": (True, False)}
    assert _should_emit("v1", True, False, last_sent, last_state, 100.0, throttle_s=2.0) is False


def test_same_state_after_window_emits():
    last_sent = {"v1": 97.0}
    last_state = {"v1": (True, False)}
    assert _should_emit("v1", True, False, last_sent, last_state, 100.0, throttle_s=2.0) is True


def test_online_change_always_emits():
    """online True→False es una desconexión: siempre pasa."""
    last_sent = {"v1": 99.9}
    last_state = {"v1": (True, False)}
    assert _should_emit("v1", False, False, last_sent, last_state, 100.0, throttle_s=2.0) is True


def test_ignition_change_always_emits():
    """Cambio de ignición: siempre pasa aunque esté dentro del throttle."""
    last_sent = {"v1": 99.9}
    last_state = {"v1": (True, False)}  # ignition was False
    assert _should_emit("v1", True, True, last_sent, last_state, 100.0, throttle_s=2.0) is True


def test_burst_same_vehicle_throttled():
    """Ráfaga de N mensajes del mismo vehículo: sólo el 1.º pasa por throttle."""
    last_sent: dict = {}
    last_state: dict = {}
    emitted = 0
    for i in range(20):
        now = 100.0 + i * 0.1  # mensajes cada 100 ms, throttle 2 s
        if _should_emit("v1", True, False, last_sent, last_state, now, throttle_s=2.0):
            last_sent["v1"] = now
            last_state["v1"] = (True, False)
            emitted += 1
    assert emitted == 1  # solo el primero en la ventana de 2 s


def test_state_change_resets_throttle():
    """Tras un cambio de estado, la siguiente ráfaga vuelve a throttlear desde cero."""
    last_sent: dict = {"v1": 0.0}
    last_state: dict = {"v1": (True, False)}
    # El cambio de ignición pasa
    assert _should_emit("v1", True, True, last_sent, last_state, 1.0, throttle_s=2.0) is True
    last_sent["v1"] = 1.0
    last_state["v1"] = (True, True)
    # Inmediatamente después, el mismo estado queda throttleado
    assert _should_emit("v1", True, True, last_sent, last_state, 1.1, throttle_s=2.0) is False
