"""
Tests unitarios para _is_accumulator_channel.

Verifica que los canales del sensor_schema del IFM CR2530 que son
acumuladores monótonos o running-maxima quedan excluidos del endpoint
GET /work-orders/vehicle-signals/{vehicle_id}.

No requiere BD ni fixtures asíncronos — prueba la función pura directamente.
"""
import pytest
from app.api.v1.work_orders import _is_accumulator_channel


# ── Acumuladores de tiempo (min_* / minutos_*) ────────────────────────────────

def test_min_prefix_es_acumulador():
    assert _is_accumulator_channel({"key": "min_bomba_de_agua",    "unit": "Min"}) is True
    assert _is_accumulator_channel({"key": "min_depresor",         "unit": "Min"}) is True


def test_minutos_prefix_es_acumulador():
    assert _is_accumulator_channel({"key": "minutos_transfer",     "unit": "Min"}) is True


def test_unit_min_sin_prefijo_es_acumulador():
    # Un canal con unit=Min aunque la key no encaje con los prefijos conocidos
    assert _is_accumulator_channel({"key": "tiempo_bomba",         "unit": "Min"}) is True


# ── Running maxima (pico_maximo_* / maximas_*) ────────────────────────────────

def test_pico_maximo_es_acumulador():
    assert _is_accumulator_channel({"key": "pico_maximo_presion_agua",      "unit": "bar"}) is True
    assert _is_accumulator_channel({"key": "pico_maximo_depresor_soplando", "unit": "bar"}) is True
    assert _is_accumulator_channel({"key": "pico_maximo_vacio_depresor",    "unit": "bar"}) is True


def test_maximas_prefix_es_acumulador():
    assert _is_accumulator_channel({"key": "maximas_rpm_trabajo",  "unit": "rpm"}) is True


# ── Odómetros y acumuladores de por vida (claves exactas) ─────────────────────

def test_kilometros_totales_es_acumulador():
    assert _is_accumulator_channel({"key": "avl_10314", "unit": "km"}) is True


def test_combustible_total_es_acumulador():
    assert _is_accumulator_channel({"key": "avl_10315", "unit": "L"}) is True


# ── Contador de eventos (unit=Veces) ─────────────────────────────────────────

def test_veces_unit_es_acumulador():
    assert _is_accumulator_channel({"key": "cantidad_veces_nivel_en_minimo", "unit": "Veces"}) is True


# ── Señales instantáneas — NO deben ser excluidas ─────────────────────────────

def test_nivel_cisterna_es_instantaneo():
    assert _is_accumulator_channel({"key": "nivel_de_cisterna",    "unit": "%"})   is False


def test_rpm_motor_instantaneo_no_es_running_max():
    """avl_10309 es RPM actual — distinto de maximas_rpm_trabajo (running max)."""
    assert _is_accumulator_channel({"key": "avl_10309",            "unit": "rpm"}) is False


def test_temperatura_instantanea():
    assert _is_accumulator_channel({"key": "avl_10310",            "unit": "ºC"})  is False


def test_nivel_combustible_instantaneo():
    assert _is_accumulator_channel({"key": "avl_10311",            "unit": "%"})   is False


def test_estado_pto_instantaneo():
    assert _is_accumulator_channel({"key": "avl_10313",            "unit": None})  is False


def test_bomba_encendida_instantanea():
    assert _is_accumulator_channel({"key": "bomba_encendida",      "unit": None})  is False


def test_depresor_encendido_instantaneo():
    assert _is_accumulator_channel({"key": "depresor_encendido",   "unit": None})  is False


def test_presion_viva_no_confundida_con_pico():
    """Una clave con 'presion' sin prefijo pico_maximo_ es instantánea."""
    assert _is_accumulator_channel({"key": "presion_linea1",       "unit": "bar"}) is False


def test_ext_voltage_instantaneo():
    assert _is_accumulator_channel({"key": "ext_voltage",          "unit": "V"})   is False
