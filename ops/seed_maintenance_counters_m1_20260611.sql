-- Seed reproducible de maintenance_counters en vehicle_type — M1 2026-06-11
-- Solo tipos ya implementados en _COUNTER_COLUMNS + calendar_days.
-- Los contadores PLC (pump/depressor/transfer/odometer) se añaden en M2.

UPDATE vehicle_type
SET maintenance_counters = '[
  {"type": "pto_hours",     "label": "Horas PTO",    "unit": "h",    "source_type": "telemetry_1h", "source_key": "pto_active_minutes",  "semantics": "sum"},
  {"type": "engine_hours",  "label": "Horas motor",  "unit": "h",    "source_type": "telemetry_1h", "source_key": "engine_on_minutes",   "semantics": "sum"},
  {"type": "calendar_days", "label": "Calendario",   "unit": "días", "source_type": "calendar",     "source_key": null,                  "semantics": null}
]'::jsonb
WHERE slug IN ('camion_de_basura', 'vacuum-pressure');
