# Manual CAN Control — FMC650 + CR2530

## 1. Resumen

Control remoto de salidas hidráulicas (PTO, bombas) en vehículos equipados con FMC650 + CR2530. El sistema modifica dinámicamente el campo Data de un Manual CAN Command via `setparam` sobre Codec 12. El FMC650 publica la trama en su bus CAN2, donde el CR2530 (J1939 gateway) la lee y ejecuta la acción de activación/desactivación.

---

## 2. Arquitectura

```
┌─────────────┐
│   Frontend  │  VehicleDetailPage::ManualCanControl
└──────┬──────┘  POST /api/v1/vehicles/{id}/commands/manual-can
       │         { slot: 0, state: true }
       │
┌──────▼──────────────────────┐
│     core-api (FastAPI)      │
│  BLPOP command:{imei}:      │
│      response (18s)         │
└──────┬──────────────────────┘
       │ PUBLISH cmg:manual_can_commands
       │ { imei, command: "setparam 31412:01...", log_id }
       │
┌──────▼──────────────────────┐
│    ingest-svc (TCP:5027)    │  manual_can_listener
│                             │  Codec 12 → FMC650
└──────┬──────────────────────┘
       │ TCP response (Codec 12)
       │ parse_codec12_response() → LPUSH command:{imei}:response
       │
┌──────▼──────────────────────┐
│      FMC650 (Teltonika)     │  Manual CAN Command
│                             │  Target=CAN2, Data=campo dinámico
└──────┬──────────────────────┘
       │ CAN2 trama
       │
┌──────▼──────────────────────┐
│   CR2530 (IFM, CANopen)     │  J1939 gateway
│                             │  Activa relé PTO/bomba
└─────────────────────────────┘
```

---

## 3. Localizar param_id en el Configurator del FMC650

1. Conectar FMC650 via USB a PC.
2. Abrir Teltonika FMC650 Configurator.
3. Menú: **Manual CAN → Manual CAN Command [0]** (o el slot del PTO).
4. En la pestaña **Data**, cada campo tiene un **Parameter ID** (visible en tooltip o en la barra de estado).
   - Anotar ese ID: será el `param_id` en `vehicle_manual_can_slot`.
   - Ejemplo: ID 31412 = campo Data byte 0 del comando.

---

## 4. Dar de alta un vehículo

### SQL
```sql
INSERT INTO vehicle_manual_can_slot (vehicle_id, tenant_id, slot, param_id, description, active)
VALUES (
  'a1b2c3d4-e5f6-4a7b-8c9d-e0f1g2h3i4j5',  -- UUID del vehículo
  'x1y2z3w4-a5b6-4c7d-8e9f-g0h1i2j3k4l5',  -- UUID del tenant
  0,                                         -- slot 0-9
  31412,                                     -- param_id del FMC Configurator
  'PTO bomba hidráulica',                   -- descripción visible en UI
  true                                       -- activo
);
```

### Verificar
```bash
# Listar slots configurados para el vehículo
curl -H "Authorization: Bearer <JWT>" \
  https://cmgtrack.com/api/v1/vehicles/{vehicle_id}/manual-can-slots

# Estado del FMC (conectado, IMEI, last_seen)
curl -H "Authorization: Bearer <JWT>" \
  https://cmgtrack.com/api/v1/vehicles/{vehicle_id}/fmc-status
```

---

## 5. Flujo de un comando

1. Frontend: usuario hace click **ARRANCAR** (state=true).
2. POST `/api/v1/vehicles/{vehicle_id}/commands/manual-can` con `{slot: 0, state: true}`.
3. Backend:
   - Busca `vehicle_manual_can_slot` → obtiene `param_id`.
   - Construye hex: `state=true` → `"01FFFFFFFFFFFFFF"`.
   - Crea `CommandLog` (status=pending).
   - Publica en Redis: `cmg:manual_can_commands`.
4. Ingestor (manual_can_listener):
   - Lee del canal.
   - Busca IMEI en `_active_writers`.
   - Construye Codec 12: `setparam 31412:01FFFFFFFFFFFFFF`.
   - Escribe al TCP.
5. FMC650: recibe, ejecuta, responde Codec 12.
6. Ingestor: parsea respuesta → `LPUSH command:{imei}:response`.
7. Backend: `BLPOP` despierta, retorna respuesta síncrona al frontend.

### Códigos de error

| Código | Razón | Solución |
|--------|-------|----------|
| 200 | ✓ Confirmado | Comando ejecutado en FMC. |
| 400 | Slot/hex inválido | Revisar rango 0-9, hex 16 chars. |
| 403 | Rol insuficiente | Requiere admin/operator. |
| 404 | No configurado o cross-tenant | Falta fila en `vehicle_manual_can_slot` o vehículo de otro tenant. |
| 409 | Comando en vuelo | Esperar a que termine el anterior (max 18s). |
| 503 | FMC desconectado | Revisar conectividad GPRS, SIM, IMEI. |
| 504 | Timeout | FMC no respondió en 18s. Revisar firmware, Ignition ON. |

---

## 6. Configuración necesaria en el FMC650

Abierto el Configurator (paso 3 arriba):

- **Manual CAN Command [0]**
  - Target: **CAN2** (no CAN1)
  - CAN Type: J1939, extended ID, etc. (según CR2530)
  - CAN ID: configurar en el FMC según el comando.
  - Data: estructura inicial (modificable vía setparam).
  - Send Type: Periodic / On Event (según aplicación).
  - Send Period: 500–1000 ms típico.
  - Run On Startup: **Enable** (para que se ejecute al arrancar).

- **Firmware**: ≥ 03.01.00 requerido.
- **Ignition**: debe estar ON (motor en marcha) para que el FMC responda.

---

## 7. Troubleshooting

### FMC desconectado (503)
- **GPRS/4G**: revisar SIM, cobertura, APN.
- **IMEI**: confirmado en `device.imei`, nodo en red.
- **Power**: voltaje externo >7V, ignición encendida.

### Timeout (504)
- **Firmware outdated**: upgradearlo a ≥ 03.01.00.
- **Manual CAN Command**: verificar que esté **Enable**, Target=CAN2.
- **Ignition**: el motor debe estar en marcha (RPM > 200 raw).
- **Bus CAN2**: revisar continuidad, terminaciones 120Ω.

### Trama no llega al CR2530
- **Target**: FMC debe estar enviando a CAN2, no CAN1.
- **Baudrate**: CR2530 debe estar configurado a 250 kbps (estándar J1939).
- **CAN ID**: coincidir con lo que espera el CR2530.
- **Terminación del bus**: 120Ω en ambos extremos.

### Error 404 "no configurado"
- Ejecutar SQL del paso 4.
- Verificar UUIDs: `vehicle_id`, `tenant_id` correctos.
- Confirmar con GET `/manual-can-slots`.

---

## 8. Referencias

- **Teltonika FMC650**: [Manual de usuario](https://wiki.teltonika.lt/view/FMC650), Codec 12, Manual CAN, Parameter List.
- **IFM CR2530**: J1939 gateway, configuración en el manual de CR2530.
- **Código fuente**:
  - `services/ingest/src/codec8.py`: `parse_codec12_response()`, `build_setparam()`.
  - `services/ingest/src/server.py`: `manual_can_listener()`.
  - `backend/app/api/v1/vehicles.py`: endpoints `/commands/manual-can`, `/fmc-status`, `/manual-can-slots`.
  - `frontend/src/features/vehicle/ManualCanControl.tsx`: componente React.
