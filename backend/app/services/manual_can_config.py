"""Helpers puros para la configuración Manual CAN en plantillas (vehicle_type).

La definición de slots/botones vive en `vehicle_type.manual_can_slots` y
`vehicle_type.manual_can_buttons` (JSONB). El estado runtime de las salidas vive
en Redis, en un hash por vehículo. Estas funciones no tocan BD ni Redis: encapsulan
la lógica testeable (cálculo de bits, permisos por rol, validación de config)."""
from __future__ import annotations

VALID_ROLES = {"admin", "operator", "viewer", "driver"}
VALID_FUNCTIONS = {"toggle", "hold"}


def state_key(vehicle_id) -> str:
    """Clave del hash Redis con el estado de salidas de un vehículo.

    Campo = número de slot (str); valor = 8 bytes en hex (16 chars)."""
    return f"vehicle:{vehicle_id}:can_outputs"


def apply_bit(data: bytes | None, byte_index: int, bit_index: int, value: bool) -> bytes:
    """Devuelve el bitmask de 8 bytes con el bit indicado puesto a `value`."""
    raw = bytearray(data if data and len(data) == 8 else bytes(8))
    if value:
        raw[byte_index] |= 1 << bit_index
    else:
        raw[byte_index] &= ~(1 << bit_index)
    return bytes(raw)


def current_bit(data: bytes | None, byte_index: int, bit_index: int) -> bool:
    """Estado actual de un bit dentro del bitmask (False si no hay estado)."""
    if not data or len(data) <= byte_index:
        return False
    return bool(data[byte_index] & (1 << bit_index))


def role_can_press(button: dict, role: str) -> bool:
    """admin siempre puede; el resto solo si su rol está en allowed_roles."""
    if role == "admin":
        return True
    return role in (button.get("allowed_roles") or [])


def validate_config(slots: list[dict], buttons: list[dict]) -> None:
    """Valida la coherencia de la config de una plantilla. Lanza ValueError."""
    slot_numbers: set[int] = set()
    slot_ids: set[str] = set()
    for s in slots:
        n = s["slot"]
        if not (0 <= n <= 9):
            raise ValueError(f"slot fuera de rango: {n}")
        if n in slot_numbers:
            raise ValueError(f"slot duplicado: {n}")
        if int(s["param_id"]) <= 0:
            raise ValueError("param_id debe ser > 0")
        slot_numbers.add(n)
        slot_ids.add(str(s["id"]))

    seen_bits: set[tuple] = set()
    for b in buttons:
        if str(b["slot_id"]) not in slot_ids:
            raise ValueError(f"botón referencia slot inexistente: {b['slot_id']}")
        if not (0 <= b["byte_index"] <= 7) or not (0 <= b["bit_index"] <= 7):
            raise ValueError("byte_index/bit_index fuera de rango 0-7")
        if b.get("function") not in VALID_FUNCTIONS:
            raise ValueError(f"function inválida: {b.get('function')}")
        roles = b.get("allowed_roles") or []
        if any(r not in VALID_ROLES for r in roles):
            raise ValueError("allowed_roles contiene un rol inválido")
        key = (str(b["slot_id"]), b["byte_index"], b["bit_index"])
        if key in seen_bits:
            raise ValueError(f"bit duplicado en slot {b['slot_id']}: {key}")
        seen_bits.add(key)
