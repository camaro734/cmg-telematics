# backend/app/seeds/system_block_templates.py
# Plantillas de bloques del panel de diagnóstico.
# sensor_keys vacíos: el admin los rellena una vez asignado el tipo concreto.
from typing import Any

SYSTEM_BLOCK_TEMPLATES: dict[str, dict[str, Any]] = {
    "vps_cuba": {
        "id": "vps_cuba",
        "label": "VPS Cuba",
        "description": "Cuba de vacío/presión (barredora aspiradora, limpieza viaria)",
        "blocks": [
            {"id": "block_motor",       "name": "Motor",        "icon": "ti-engine",       "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",   "name": "Eléctrico",    "icon": "ti-bolt",         "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible", "name": "Combustible",  "icon": "ti-gas-station",  "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_hidraulico",  "name": "Hidráulico",   "icon": "ti-arrows-right-left", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_depresor",    "name": "Depresor",     "icon": "ti-ripple",       "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion","name": "Localización", "icon": "ti-map-pin",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",   "name": "Seguridad",    "icon": "ti-shield",       "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",         "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
    "max_barredora": {
        "id": "max_barredora",
        "label": "MAX Barredora",
        "description": "Barredora compacta / semipesada (cepillos laterales + aspiración central)",
        "blocks": [
            {"id": "block_motor",       "name": "Motor",        "icon": "ti-engine",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",   "name": "Eléctrico",    "icon": "ti-bolt",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible", "name": "Combustible",  "icon": "ti-gas-station", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_cepillos",    "name": "Cepillos",     "icon": "ti-rotate-clockwise", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion","name": "Localización", "icon": "ti-map-pin",     "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",   "name": "Seguridad",    "icon": "ti-shield",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
    "basura_recolectora": {
        "id": "basura_recolectora",
        "label": "Basura Recolectora",
        "description": "Camión de recogida de residuos (compactador trasero)",
        "blocks": [
            {"id": "block_motor",       "name": "Motor",        "icon": "ti-engine",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",   "name": "Eléctrico",    "icon": "ti-bolt",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible", "name": "Combustible",  "icon": "ti-gas-station", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_compactador", "name": "Compactador",  "icon": "ti-box-model",   "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion","name": "Localización", "icon": "ti-map-pin",     "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",   "name": "Seguridad",    "icon": "ti-shield",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
    "generico": {
        "id": "generico",
        "label": "Genérico",
        "description": "Plantilla base para cualquier tipo de vehículo",
        "blocks": [
            {"id": "block_motor",       "name": "Motor",        "icon": "ti-engine",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_electrico",   "name": "Eléctrico",    "icon": "ti-bolt",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_combustible", "name": "Combustible",  "icon": "ti-gas-station", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_localizacion","name": "Localización", "icon": "ti-map-pin",     "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_seguridad",   "name": "Seguridad",    "icon": "ti-shield",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
            {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
        ],
    },
}
