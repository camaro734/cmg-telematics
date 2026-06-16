"""Tests de los helpers puros de configuración Manual CAN (sin BD ni Redis)."""
import pytest

from app.services import manual_can_config as mc


def test_compute_bitmask_sets_and_clears_bit():
    base = bytes(8)
    on = mc.apply_bit(base, byte_index=0, bit_index=0, value=True)
    assert on.hex().upper() == "0100000000000000"
    off = mc.apply_bit(on, byte_index=0, bit_index=0, value=False)
    assert off == base


def test_apply_bit_handles_missing_state():
    on = mc.apply_bit(None, byte_index=2, bit_index=3, value=True)
    assert len(on) == 8
    assert mc.current_bit(on, 2, 3) is True


def test_current_bit_reads_bit():
    data = bytes([0b00000100, 0, 0, 0, 0, 0, 0, 0])
    assert mc.current_bit(data, 0, 2) is True
    assert mc.current_bit(data, 0, 1) is False
    assert mc.current_bit(None, 0, 0) is False


def test_role_can_press_admin_always():
    btn = {"allowed_roles": ["operator"], "function": "toggle"}
    assert mc.role_can_press(btn, "admin") is True
    assert mc.role_can_press(btn, "operator") is True
    assert mc.role_can_press(btn, "driver") is False
    assert mc.role_can_press(btn, "viewer") is False


def test_state_key():
    assert mc.state_key("abc") == "vehicle:abc:can_outputs"


def _slots():
    return [{"id": "s1", "slot": 0, "param_id": 16002, "description": "x"}]


def test_validate_config_ok():
    buttons = [{"id": "b1", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
                "label": "A", "function": "toggle", "allowed_roles": ["admin"],
                "sort_order": 0, "active": True}]
    mc.validate_config(_slots(), buttons)  # no lanza


def test_validate_config_rejects_duplicate_bit():
    buttons = [
        {"id": "b1", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
         "label": "A", "function": "toggle", "allowed_roles": ["admin"],
         "sort_order": 0, "active": True},
        {"id": "b2", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
         "label": "B", "function": "toggle", "allowed_roles": ["admin"],
         "sort_order": 1, "active": True},
    ]
    with pytest.raises(ValueError):
        mc.validate_config(_slots(), buttons)


def test_validate_config_rejects_button_unknown_slot():
    buttons = [{"id": "b1", "slot_id": "sX", "byte_index": 0, "bit_index": 0,
                "label": "A", "function": "toggle", "allowed_roles": ["admin"],
                "sort_order": 0, "active": True}]
    with pytest.raises(ValueError):
        mc.validate_config(_slots(), buttons)


def test_validate_config_rejects_bad_function():
    buttons = [{"id": "b1", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
                "label": "A", "function": "pulse", "allowed_roles": ["admin"],
                "sort_order": 0, "active": True}]
    with pytest.raises(ValueError):
        mc.validate_config(_slots(), buttons)


def test_validate_config_rejects_bad_role():
    buttons = [{"id": "b1", "slot_id": "s1", "byte_index": 0, "bit_index": 0,
                "label": "A", "function": "hold", "allowed_roles": ["superuser"],
                "sort_order": 0, "active": True}]
    with pytest.raises(ValueError):
        mc.validate_config(_slots(), buttons)


def test_validate_config_rejects_slot_out_of_range():
    slots = [{"id": "s1", "slot": 15, "param_id": 16002, "description": "x"}]
    with pytest.raises(ValueError):
        mc.validate_config(slots, [])
