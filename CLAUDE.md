# CMG Telematics — Agente Orquestador

## Identidad del proyecto

Plataforma SaaS de telemática industrial para CMG Metalhidráulica S.L. (Massanassa, Valencia).
VPS piloto: `213.210.20.183`
Stack: FastAPI + PostgreSQL/TimescaleDB + Redis + Next.js 16 + PWA
Protocolo hardware: Teltonika Codec 8 TCP sobre FMC650 → IFM CR2530 CAN J1939

## Estructura de agentes especializados

Este proyecto tiene agentes en cada subdirectorio. Cuando trabajes en una
carpeta, lee su CLAUDE.md antes de tocar cualquier fichero.

```
/opt/cmg-telematics/
├── CLAUDE.md                    ← estás aquí (orquestador)
├── backend/
│   └── CLAUDE.md                ← agente backend (FastAPI, DB, TCP server)
├── backend/app/services/teltonika/
│   └── CLAUDE.md                ← agente protocolo Teltonika (crítico)
├── backend/app/models/
│   └── CLAUDE.md                ← agente base de datos (TimescaleDB, esquemas)
├── backend/app/api/
│   └── CLAUDE.md                ← agente API REST (endpoints, auth, permisos)
├── frontend/
│   └── CLAUDE.md                ← agente frontend (Next.js, PWA, componentes)
└── tests/
    └── CLAUDE.md                ← agente testing (simulador FMC650, pytest)
```

## Reglas globales — aplican a todos los agentes

### Nunca hacer
- Nunca exponer puerto 5432 ni 6379 al exterior
- Nunca hacer SELECT sin filtro de tiempo en telemetry_record
- Nunca devolver datos de un tenant diferente al usuario autenticado
- Nunca usar threading — todo async/await
- Nunca hardcodear credenciales — siempre desde .env via settings
- Nunca romper el contrato del protocolo Codec 8 — el hardware en campo no se puede actualizar fácilmente
- Nunca editar en frontend sin hacer `npm run build` + `systemctl restart cmg-telematics-frontend` al final

### Siempre hacer
- Leer el CLAUDE.md del subdirectorio antes de editar ficheros en él
- Ejecutar los tests de validación tras cada cambio significativo
- Loguear con nivel apropiado: DEBUG en desarrollo, INFO/ERROR en producción
- Mantener retrocompatibilidad de la API — los clientes en producción no se actualizan solos
- Verificar que el servicio systemd sigue activo tras cualquier cambio

## Comandos útiles globales

```bash
# Estado general del sistema
systemctl status cmg-telematics          # backend FastAPI (puerto 8010)
systemctl status cmg-telematics-frontend # frontend Next.js (puerto 3000)
curl http://localhost:8010/health

# Logs en tiempo real
journalctl -u cmg-telematics -f
journalctl -u cmg-telematics-frontend -f

# Conectar a PostgreSQL/TimescaleDB (instalación nativa en VPS)
PGPASSWORD=cmg_pilot_2024 psql -U cmg -d cmg_telematics -h localhost

# Lanzar simulador FMC650
cd /opt/cmg-telematics && python3 tests/simulate_fmc650.py

# Ciclo de trabajo frontend (OBLIGATORIO tras cualquier cambio)
cd /opt/cmg-telematics/frontend
npm run build
systemctl restart cmg-telematics-frontend

# Reiniciar backend tras cambios Python
systemctl restart cmg-telematics
journalctl -u cmg-telematics -f
```

## Infraestructura del VPS

### Servicios nativos (sin Docker)
- **PostgreSQL 16** con extensión TimescaleDB → puerto 5432 (solo localhost)
- **Redis** → puerto 6379, DB=2 (solo localhost)
- **Caddy** → puertos 80/443 (reverse proxy HTTPS)

### Servicios Docker
- **cmg-mosquitto** → MQTT broker puertos 1883, 9001

### Servicios systemd propios
- **cmg-telematics** → FastAPI+Uvicorn puerto 8010 + TCP Teltonika puerto 5027
- **cmg-telematics-frontend** → Next.js producción puerto 3000

### Credenciales piloto
- Admin: `admin@cmg.es` / `admin123` (role: superadmin)
- DB: `cmg` / `cmg_pilot_2024` / `cmg_telematics`
- SECRET_KEY: en `/opt/cmg-telematics/backend/.env`

## Estado actual del piloto ✅

- [x] PASO 0: Reconocimiento VPS completado
- [x] PostgreSQL/TimescaleDB nativo corriendo (puerto 5432)
- [x] Redis nativo corriendo (puerto 6379, DB=2)
- [x] Docker Compose levantado (Mosquitto MQTT)
- [x] Backend instalado y corriendo como systemd service (puerto 8010)
- [x] Puerto 5027 TCP abierto y escuchando (Teltonika TCP server)
- [x] Migraciones aplicadas — 12 tablas creadas
- [x] Hypertable telemetry_record con compresión automática
- [x] Simulador FMC650 conecta y envía datos con ACK correcto
- [x] Datos aparecen en PostgreSQL/TimescaleDB
- [x] Endpoint /health responde correctamente
- [x] Comando DOUT remoto funciona end-to-end (setdigout confirmado)
- [x] WebSocket /ws/fleet operativo (mensajes de telemetría en tiempo real)
- [x] Frontend Next.js 16 corriendo en producción (puerto 3000)
- [x] PWA instalable (manifest.json + service worker)
- [x] Autenticación JWT con roles funcionando
- [x] Todas las páginas implementadas (15 rutas)
- [x] Navegación móvil: bottom tab bar (5 tabs + sheet "Más")
- [x] Mapa con tiles CartoDB Voyager (moderno, gratuito)
- [x] Marcadores de vehículos con icono de camión SVG
- [x] Variable maps arquitectura two-scope (plantilla fabricante + excepción vehículo)
- [x] Admin variable-maps: UI con dos pestañas (Plantillas / Excepciones)
- [x] Admin vehículos: muestra jerarquía completa (fabricante → cliente → vehículo)
- [x] Código en GitHub (repo: camaro734/cmg-telematics)

## Qué falta / próximos pasos sugeridos

- [ ] Caddy: verificar proxy 80/443 → 3000/8010 desde exterior
- [ ] Conectar dispositivo FMC650 real (piloto en campo)
- [ ] Configurar variable_map para las IOs del IFM CR2530 real
- [ ] Crear tenant/usuario real para el cliente piloto
- [ ] Configurar alertas de umbrales reales (presión hidráulica, voltaje)
- [ ] Test de carga con múltiples dispositivos simultáneos
- [ ] Hypertable compression: verificar con `SELECT * FROM timescaledb_information.compression_settings`
