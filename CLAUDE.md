# CMG Telematics Platform — Agente Orquestador
# Versión 2.0 — Sistema existente + mejora profesional + app nativa

═══════════════════════════════════════════════════════════════
## 1. IDENTIDAD Y ESTADO DEL PROYECTO
═══════════════════════════════════════════════════════════════

Plataforma SaaS de telemática industrial para CMG Metalhidráulica S.L. (Massanassa, Valencia).
VPS piloto: `213.210.20.183`
Stack: FastAPI + PostgreSQL/TimescaleDB + Redis + Next.js 16 + PWA
Protocolo hardware: Teltonika Codec 8 TCP sobre FMC650 → IFM CR2530 CAN J1939

### Estado actual ✅ (lo que YA EXISTE — no reescribir)

- [x] PostgreSQL/TimescaleDB nativo corriendo (puerto 5432)
- [x] Redis nativo corriendo (puerto 6379, DB=2)
- [x] Docker Compose levantado (Mosquitto MQTT)
- [x] Backend FastAPI+Uvicorn como systemd service (puerto 8010)
- [x] TCP Teltonika server puerto 5027 activo
- [x] Migraciones aplicadas — todas las tablas creadas
- [x] Hypertable telemetry_record con compresión automática
- [x] Simulador FMC650 conecta y envía datos con ACK correcto
- [x] Endpoint /health responde correctamente
- [x] Comando DOUT remoto funciona end-to-end
- [x] WebSocket /ws/fleet operativo (mensajes en tiempo real)
- [x] Frontend Next.js 16 corriendo en producción (puerto 3000)
- [x] PWA instalable (manifest.json + service worker)
- [x] Autenticación JWT con roles funcionando
- [x] Todas las páginas implementadas (15+ rutas)
- [x] Navegación móvil: bottom tab bar (5 tabs + sheet "Más")
- [x] Mapa con tiles CartoDB Voyager + marcadores SVG camión
- [x] Variable maps arquitectura two-scope (plantilla fabricante + excepción vehículo)
- [x] Admin variable-maps: UI con dos pestañas (Plantillas / Excepciones)
- [x] Admin vehículos: muestra jerarquía completa (fabricante → cliente → vehículo)
- [x] Código en GitHub (repo: camaro734/cmg-telematics)
- [x] FMC650 real conectado y transmitiendo (IMEI: 864275075510100, vehículo OT98976)
- [x] Ignición mapeada desde IO 239 con fallback a IO 1 (DIN1)
- [x] WebSocket con ping/keepalive cada 30s (elimina conexiones zombie)
- [x] Lógica online basada en last_seen (<10 min)
- [x] Motor de automatizaciones: reglas trigger→acción, sesiones con trazado GPS
- [x] Exportación PDF de sesiones con mapa real CartoDB
- [x] Entorno demo completo y aislado: 6 vehículos, alertas, automatizaciones
- [x] script `backend/scripts/seed_demo.py` idempotente para regenerar demo

═══════════════════════════════════════════════════════════════
## 2. ESTRUCTURA DE AGENTES ESPECIALIZADOS
═══════════════════════════════════════════════════════════════

Este proyecto tiene agentes en cada subdirectorio. Cuando trabajes en una
carpeta, lee su CLAUDE.md antes de tocar cualquier fichero.

```
/opt/cmg-telematics/
├── CLAUDE.md                         ← estás aquí (orquestador)
├── backend/
│   └── CLAUDE.md                     ← agente backend (FastAPI, DB, TCP server)
├── backend/app/services/teltonika/
│   └── CLAUDE.md                     ← agente protocolo Teltonika (crítico)
├── backend/app/models/
│   └── CLAUDE.md                     ← agente base de datos (TimescaleDB, esquemas)
├── backend/app/api/
│   └── CLAUDE.md                     ← agente API REST (endpoints, auth, permisos)
├── frontend/
│   └── CLAUDE.md                     ← agente frontend (Next.js, PWA, componentes)
├── tests/
│   └── CLAUDE.md                     ← agente testing (simulador FMC650, pytest)
└── agents/hydraulics/
    └── CLAUDE.md                     ← agente experto hidráulica (KPIs, alertas, desgaste)
```

Agentes Claude Code activos (en `.claude/agents/`):
- `hardware-teltonika-ifm` — Codec 8, IFM CR2530, CAN J1939, TimescaleDB schema
- `cmg-backend-architect` — FastAPI, endpoints, alertas, migraciones Alembic
- `cmg-dashboard-architect` — Jinja2/Next.js, Leaflet, Chart.js, WebSocket UI
- `cmg-alertas-predictivo` — Alertas deterministas, diagnóstico IA, informes, WhatsApp
- `cmg-mobile-agent` — React Native + Expo, pantallas, offline-first, push
- `uiux-cmg-telematics` — Design tokens, gauges SVG, dark mode industrial
- `mobile-native-architect` — Stack nativo iOS/Android completo

═══════════════════════════════════════════════════════════════
## 3. REFERENTES DEL SECTOR — APRENDE DE ELLOS Y SUPÉRALOS
═══════════════════════════════════════════════════════════════

Antes de diseñar cualquier pantalla o componente, considera estos referentes.
Cada uno aporta algo concreto que debemos implementar o superar.

### 3.1 Wecove / Cleveapp (competidor directo — maquinaria especial)
Sector: camiones sewer/vacuum, screed mixers, robots industriales.
Hardware: PC embarcado con CAN1/CAN2, 2 DIG I/O, RS232, GPS, 4G, WiFi.

QUÉ HACEN BIEN (replicar):
- Dashboard con mapa de 188+ vehículos en tiempo real
- App móvil para gestión de tareas: inicio/fin con timer, galería de fotos
  georreferenciadas (GPS+timestamp), informes de trabajo desde obra
- Notificaciones push de nuevas tareas asignadas
- POS móvil: el operador cierra y comparte informes desde el vehículo

QUÉ NOSOTROS TENEMOS Y WECOVE NO:
- Profundidad en datos hidráulicos (IFM CR2530 CAN real)
- Integración con ERP propio (FactuSOL, órdenes trabajo CMG Nexus)
- Diagnóstico predictivo con Claude API
- Multi-tenant real con jerarquía (CMG → fabricante → cliente → flota)

### 3.2 Samsara (referente UX — líder mundial)
Sector: flotas grandes, logística, construcción, manufacturing.

QUÉ COPIAR DE SAMSARA:
- "Single pane of glass": toda la operación en un dashboard
- Safety Inbox: bandeja centralizada de eventos por severidad con descripción
  en lenguaje legible (no códigos hex crudos) + acción recomendada
- Vehicle health alerts con fault codes legibles
- Powered equipment utilization report: ROI por vehículo, horas activo vs inactivo
- Driver app simplísima: el conductor ve solo lo que necesita en su turno
- Heat maps de zonas frecuentadas por la flota

QUÉ EVITAR:
- Rigidez en filtros de datos
- Precio prohibitivo para flotas pequeñas (nuestra ventaja)

### 3.3 Geotab / MyGeotab (referente en customización y datos)
Sector: flotas grandes, snow plows, hormigoneras, maquinaria especial.

QUÉ COPIAR DE GEOTAB:
- Dashboard completamente personalizable por rol: admin ve KPIs de flota,
  mecánico ve alertas de mantenimiento, conductor ve sus tareas del día
- Datos de motor ultra-detallados: todos los PIDs OBD disponibles
- API documentada y abierta como filosofía (integraciones futuras)
- Módulos verticales por sector → nuestra versión: módulos por tipo de vehículo
  (vacuum truck, barredora, cisterna)
- Informes programados automáticos por email a supervisores
- Comparativa de rendimiento entre vehículos similares

QUÉ EVITAR:
- Curva de aprendizaje demasiado alta

### 3.4 Wialon / Gurtam (referente en cobertura de dispositivos y UX de datos)
Sector: plataforma agnóstica, 3300+ tipos de dispositivos, 4M unidades.

QUÉ COPIAR DE WIALON:
- Sensor chart con un tap: toca cualquier sensor → abre su gráfica histórica
- Track building: recorrido del día con velocidad, paradas y eventos superpuestos
- Unit history timeline: eventos en orden cronológico con mapa sincronizado
- Geofences configurables: dentro/fuera de zona (más útil que dirección GPS)
- Comandos remotos desde app: solicitar foto, cambiar configuración del dispositivo

QUÉ EVITAR:
- Interfaz demasiado técnica para operadores sin formación
- Generalista: no tiene profundidad sectorial → nuestra ventaja es la especialización

### 3.5 HydraForce / Epec GlobE (referente en telemetría hidráulica)
Sector: maquinaria hidráulica móvil off-road, forestal, construcción.

QUÉ COPIAR/APLICAR A CMG:
- WebVisu: display-style widgets específicos para visualizar estados hidráulicos
- Modos de operación configurables remotamente: Novice / Expert / Maintenance
- Historial de fallos CAN con timestamp y contexto de operación
- Widget de estados hidráulicos específico por tipo de máquina:
  vacuum truck tiene su set de parámetros, barredora el suyo
- Diagnóstico remoto: conectar a CR2530 vía VPN y leer logs CAN

ESTE ES NUESTRO PUNTO DIFERENCIAL FRENTE A TODOS:
Los datos CAN del IFM CR2530 (presiones hidráulicas, niveles, válvulas
electrohidráulicas) son nuestra ventaja competitiva real. Máxima inversión
en profundidad de visualización de datos de maquinaria.

═══════════════════════════════════════════════════════════════
## 4. ROADMAP DE MEJORAS — APP WEB (Next.js existente)
═══════════════════════════════════════════════════════════════

### REGLA DE ORO: Lee el fichero antes de tocarlo. Siempre.
### Cambios incrementales. Nunca reemplazar un fichero entero.
### Mantener compatibilidad con todos los endpoints y layouts existentes.

### P1 — Design system base
Crear sistema de design tokens consistente con paleta industrial dark mode:
  --bg-primary: #0f1117      /* fondo principal */
  --bg-surface: #1a1d27      /* cards, panels */
  --bg-elevated: #22263a     /* modales, dropdowns */
  --color-brand: #2563eb     /* azul CMG */
  --color-ok: #22c55e        /* estado OK */
  --color-warn: #f59e0b      /* advertencia */
  --color-alert: #ef4444     /* alerta crítica */
  --color-offline: #6b7280   /* vehículo offline */
  Escala 4px base: 4, 8, 12, 16, 24, 32, 48, 64px

### P2 — Mapa de flota (inspirado en Samsara + Wialon)
Mejoras sobre el mapa CartoDB/Leaflet existente:
- Marcadores SVG custom por tipo de vehículo (vacuum/barredora/cisterna)
  con color según estado (verde/amarillo/rojo) y pulso en alertas activas
- Popup enriquecido: placa + estado motor + parámetro CAN crítico + tiempo
- Panel lateral colapsable: buscador, filtros tipo/estado, badge alertas
- Polyline de recorrido del día con gradiente de velocidad (como Wialon tracks)
- Clustering automático con Leaflet.markercluster

### P3 — Panel de telemetría por vehículo (inspirado en HydraForce WebVisu)
Widgets por tipo de vehículo:

Gauges circulares SVG animados (JS puro, sin framework):
  Vacuum trucks: presión bomba (0-250 mbar), nivel depósito (0-100%),
                  temperatura aceite (0-120°C), RPM motor (0-3000)
  Barredoras:    velocidad trabajo (0-20 km/h), presión agua (0-10 bar),
                  nivel agua (0-100%), RPM cepillos (0-1500)

Indicadores LED: PTO | Motor ON/OFF | GPS | Conexión | Alertas

Sensor chart (inspirado en Wialon): toca cualquier parámetro →
  abre gráfica Chart.js con selector de rango (1h/6h/24h/semana)
  + export CSV

Timeline de eventos del día: Motor ON ● Inicio tarea ● Alerta ● PTO ● Motor OFF

### P4 — Panel de alertas (inspirado en Samsara Safety Inbox)
- Lista tipo inbox ordenada por severidad
- Descripción legible: "Presión bomba vacuum: 235 mbar (límite: 220 mbar)"
  → NO mostrar códigos hex crudos a operadores
- Botón "Reconocer" con nota obligatoria + timestamp
- Web Notifications API para alertas críticas nuevas

### P5 — WebSockets (migrar a tiempo real si aún hay polling)
Patrón con reconexión exponencial:
```javascript
class TelemetrySocket {
  connect() { /* WS con backoff exponencial 1s → 30s max */ }
}
```
Indicador visual en header: ● En directo / ○ Reconectando / ✕ Sin conexión

### P6 — Módulo de mantenimiento (inspirado en Samsara + Geotab)
- Barra de progreso: "Próximo cambio aceite: 4.200 km de 5.000"
- Alerta proactiva 7 días antes del umbral
- Histórico de intervenciones con foto adjunta
- KPI: coste de mantenimiento acumulado por vehículo/mes

### P7 — Informe de utilización (inspirado en Geotab + Samsara)
Métricas: horas motor ON/OFF, horas PTO, km, ciclos vacuum/barrido,
  alertas, uptime %, eficiencia km trabajados / km totales
Formatos: PDF (ejecutivo) + CSV (datos brutos)
Envío programado automático por email al supervisor

═══════════════════════════════════════════════════════════════
## 5. APP NATIVA iOS + ANDROID — ESPECIFICACIÓN COMPLETA
═══════════════════════════════════════════════════════════════

La PWA existente se convierte en app nativa React Native + Expo.
Consume los MISMOS endpoints FastAPI que ya funcionan en la web.
NO se duplica lógica de negocio.

### Stack móvil
- React Native + Expo SDK (última versión estable)
- Expo Router v3 (file-based routing)
- React Query (TanStack) para data fetching + cache offline
- Zustand para estado global (auth, vehículo activo, filtros)
- react-native-maps (Google Maps Android / Apple Maps iOS)
- Victory Native XL + react-native-svg para gauges nativos (sin WebView)
- Expo Notifications (FCM + APNs)
- Expo Camera + ImagePicker para fotos georreferenciadas
- Expo SecureStore para JWT (NUNCA AsyncStorage para tokens)
- NetInfo para detección de conectividad

### Estructura de carpetas
```
mobile/
├── app/
│   ├── (auth)/login.tsx
│   └── (tabs)/
│       ├── index.tsx           # Dashboard: mapa flota
│       ├── vehicles.tsx        # Lista de vehículos
│       ├── tasks.tsx           # Mis tareas del día
│       ├── alerts.tsx          # Alertas activas (badge)
│       └── vehicle/[id]/
│           ├── index.tsx       # Estado + telemetría en tiempo real
│           ├── telemetry.tsx   # Panel maquinaria: gauges CAN
│           ├── history.tsx     # Histórico gráficas
│           └── maintenance.tsx # Mantenimiento del vehículo
├── components/
│   ├── gauges/        # CircularGauge, LevelGauge, LEDIndicator
│   ├── maps/          # FleetMap, VehicleMarker SVG
│   ├── telemetry/     # TelemetryCard, SensorChart, LiveIndicator
│   ├── alerts/        # AlertCard, AlertBadge
│   └── tasks/         # TaskCard, PhotoGallery
├── hooks/
│   ├── useVehicles.ts    # React Query: lista flota
│   ├── useTelemetry.ts   # WebSocket + fallback polling
│   ├── useAlerts.ts      # Alertas en tiempo real
│   ├── useTasks.ts       # Tareas asignadas
│   └── useOfflineQueue.ts
└── services/
    ├── api.ts            # Cliente axios con JWT automático + refresh
    ├── websocket.ts      # WebSocket manager con reconexión exponencial
    ├── notifications.ts  # Registro push + deep link handling
    └── offline.ts        # Cola persistente con FileSystem
```

### Pantallas clave

#### Dashboard — mapa flota
- react-native-maps con marcadores SVG custom por tipo y estado
- Animación pulso en vehículos con alerta activa
- Bottom sheet al tocar marcador: placa + estado motor + parámetro CAN crítico
- Header: contadores X online / Y alertas / Z offline
- Badge en tab alertas si hay alertas activas

#### Detalle vehículo — Telemetría en tiempo real
Layout vertical:
1. Mapa mini 200px — posición actual + recorrido del día
2. Fila LEDs — Motor | PTO | GPS | Conexión | Alertas
3. Grid 2×2 gauges Victory Native XL según tipo de vehículo:
   - Vacuum: presión bomba / RPM / nivel depósito / temp aceite
   - Barredora: velocidad trabajo / RPM cepillos / nivel agua / presión agua
4. ScrollView TelemetryCards — todos los parámetros CAN disponibles
   (valor actual + unidad + tendencia ↑↓→ + sparkline 30 min)

Indicador "EN DIRECTO" en header: verde=WS activo / amarillo=polling / rojo=sin datos

#### Ejecutar tarea (flujo Wecove Connect)
1. Iniciar → timestamp + GPS de inicio
2. En curso: timer HH:MM:SS + notas + cámara con GPS/timestamp incrustado
3. Si offline: fotos encolan en FileSystem + sincronización al reconectar
4. Finalizar → resumen + informe compartible por WhatsApp/email

#### Panel de alertas (Samsara Safety Inbox nativo)
- Descripción legible: "Presión bomba vacuum: 235 mbar (límite: 220 mbar)"
- Reconocer con nota obligatoria
- Botón "Crear OT" → ERP CMG Nexus

### Telemetría en tiempo real — hook
```typescript
export function useTelemetry(vehicleId: string) {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [status, setStatus] = useState<'connecting'|'live'|'polling'|'offline'>();
  useEffect(() => {
    const ws = new WebSocketManager({
      url: `wss://cmgnexus.es/ws/vehicles/${vehicleId}`,
      onMessage: (msg) => setData(JSON.parse(msg)),
      onConnect: () => setStatus('live'),
      onDisconnect: () => setStatus('polling'),
      reconnectDelay: 2000,
      maxReconnectDelay: 30000,
    });
    ws.connect();
    return () => ws.disconnect();
  }, [vehicleId]);
  return { data, status };
}
```

### Push notifications — tipos y deep links
- `ALERT_CRITICAL` → sonido + vibración → `/vehicle/[id]/alerts`
  Ejemplo: "🔴 MAT-4521 — Presión bomba 235 mbar"
- `ALERT_WARNING` → notificación estándar → `/alerts`
- `TASK_ASSIGNED` → sonido suave → `/task/[id]`
- `MAINTENANCE_DUE` → silent (solo badge) → `/vehicle/[id]/maintenance`
- `VEHICLE_OFFLINE` → notificación → `/vehicles`

### Offline first
- React Query cachea últimos datos → banner "Datos offline - última actualización hace X min"
- Cola de acciones pendientes (reconocer alerta, iniciar/finalizar tarea) → ejecutar al reconectar
- Fotos: Expo FileSystem → subida background con retry automático

═══════════════════════════════════════════════════════════════
## 6. ENDPOINTS API — CONTRATO BACKEND ↔ WEB/MÓVIL
═══════════════════════════════════════════════════════════════

Estos endpoints deben existir. Crear los que falten:

```
# Flota
GET  /api/v1/vehicles                           # Lista flota del tenant
GET  /api/v1/vehicles/{id}                      # Detalle vehículo
GET  /api/v1/vehicles/{id}/telemetry/latest     # Últimos valores CAN
GET  /api/v1/vehicles/{id}/telemetry/history    # Histórico ?from=&to=&params=
GET  /api/v1/vehicles/{id}/track/today          # Recorrido del día (GeoJSON)
GET  /api/v1/vehicles/{id}/status               # Online + motor + alertas activas

# Alertas
GET  /api/v1/alerts                             # ?tenant= &vehicle= &status=
GET  /api/v1/alerts/{id}                        # Detalle alerta con historial
POST /api/v1/alerts/{id}/acknowledge            # { note: string }
GET  /api/v1/alerts/stats                       # Contadores por severidad

# Tareas
GET  /api/v1/tasks                              # ?assigned_to= &date= &status=
GET  /api/v1/tasks/{id}                         # Detalle tarea
POST /api/v1/tasks/{id}/start                   # { gps_lat, gps_lng }
POST /api/v1/tasks/{id}/finish                  # { notes, gps_lat, gps_lng }
POST /api/v1/tasks/{id}/photos                  # Upload foto (multipart)
POST /api/v1/tasks                              # Crear tarea

# Mantenimiento
GET  /api/v1/maintenance/{vehicle_id}           # Registros + próximos
POST /api/v1/maintenance                        # Registrar intervención
GET  /api/v1/maintenance/upcoming               # Próximos por fecha/km

# WebSocket
WS   /ws/vehicles/{tenant_id}                   # Stream telemetría en tiempo real
  → { type: "telemetry", vehicle_id, data: {...}, ts }
  → { type: "alert", alert_id, severity, vehicle_id, message }
  → { type: "status", vehicle_id, online: bool, last_seen }
```

═══════════════════════════════════════════════════════════════
## 7. INFRAESTRUCTURA DEL VPS
═══════════════════════════════════════════════════════════════

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
- Admin: `admin@cmg.es` / `admin123` (role: superadmin — solo gestión técnica)
- DB: `cmg` / `cmg_pilot_2024` / `cmg_telematics`
- SECRET_KEY: en `/opt/cmg-telematics/backend/.env`

### Jerarquía de tenants actual

```
CMG Metalhidráulica S.L.  (superadmin — gestión técnica)
├── VACUUM  (fabricante real)
│   └── aguas de valencia
│       └── OT98976 · IMEI 864275075510100  ← FMC650 real en campo
│
└── Hidráulica Industrial S.L.  (fabricante demo)
    ├── Construcciones García S.L.   ← 3 vehículos demo
    └── Obras Públicas Levante S.A.  ← 3 vehículos demo
```

### Credenciales demo (para presentaciones a clientes)

| Rol | Email | Contraseña | Ve |
|-----|-------|-----------|-----|
| Admin fabricante demo | `admin@hidraulica-ind.es` | `Demo2024!` | 6 vehículos demo (aislado del real) |
| Operador demo García  | `operador@garcia.es`      | `Demo2024!` | 3 vehículos (Construcciones García) |
| Visualizador demo     | `vista@garcia.es`         | `Demo2024!` | solo lectura, García |
| Operador demo OPL     | `operador@obras-levante.es` | `Demo2024!` | 3 vehículos (OPL) |

> El usuario demo **no puede ver** OT98976 ni ningún dato real. Aislamiento garantizado por tenant.

### Regenerar entorno demo

```bash
cd /opt/cmg-telematics/backend
source venv/bin/activate
python scripts/seed_demo.py   # idempotente — no duplica si ya existe
```

═══════════════════════════════════════════════════════════════
## 8. COMANDOS ÚTILES GLOBALES
═══════════════════════════════════════════════════════════════

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

═══════════════════════════════════════════════════════════════
## 9. COMPORTAMIENTO DEL FMC650 EN CAMPO
═══════════════════════════════════════════════════════════════

- **Modo actual**: conecta al TCP cada ~5 min, manda registro, cierra conexión
  (modo "On Stop" con periodo 300s)
- **IO 239 = 1** → ignición ON; **IO 239 = 0** → ignición OFF
  (Ignition Source = DIN 1 en Teltonika Configurator, pin 15)
- **IO 200 = 0** → dispositivo activo; **IO 200 = 1** → sleep mode
- **ext_voltage_mv** → tensión batería externa (~12.4V parado, ~14.7V cargando)
- **K-Line (pin 20)** → solo para tacógrafo digital (VDO/Stoneridge), no es OBD general
- Para datos más frecuentes: `Data Acquisition → On Road Min Period` = 10-30s

═══════════════════════════════════════════════════════════════
## 10. REGLAS GLOBALES — APLICAN A TODOS LOS AGENTES
═══════════════════════════════════════════════════════════════

### Nunca hacer
- Nunca exponer puerto 5432 ni 6379 al exterior
- Nunca hacer SELECT sin filtro de tiempo en telemetry_record
- Nunca devolver datos de un tenant diferente al usuario autenticado
- Nunca usar threading — todo async/await
- Nunca hardcodear credenciales — siempre desde .env via settings
- Nunca romper el contrato del protocolo Codec 8 — el hardware en campo no se puede actualizar fácilmente
- Nunca editar en frontend sin hacer `npm run build` + `systemctl restart cmg-telematics-frontend` al final
- Nunca usar AsyncStorage para tokens JWT en la app móvil (usar SecureStore)
- Nunca usar WebView para gauges en app nativa (usar Victory Native XL + SVG)
- Nunca añadir dependencias npm/pip sin justificación escrita

### Siempre hacer
- Leer el CLAUDE.md del subdirectorio antes de editar ficheros en él
- Leer el fichero existente antes de modificarlo — cambios incrementales
- Ejecutar los tests de validación tras cada cambio significativo
- Loguear con nivel apropiado: DEBUG en desarrollo, INFO/ERROR en producción
- Mantener retrocompatibilidad de la API — los clientes en producción no se actualizan solos
- Verificar que el servicio systemd sigue activo tras cualquier cambio
- Tipos TypeScript en toda la app móvil (no `any` salvo fuerza mayor)
- Comentarios en español, código en inglés

### Cuando haya duda sobre una mejora
Pregunta: ¿Lo hace Samsara? ¿Lo hace Geotab? ¿Lo hace Wialon?
Si sí y nosotros no → impleméntalo.
Excepción: datos hidráulicos CAN (CR2530) → aquí somos mejores que todos.
Máxima inversión en profundidad de visualización de maquinaria.

═══════════════════════════════════════════════════════════════
## 11. ORDEN DE TRABAJO RECOMENDADO
═══════════════════════════════════════════════════════════════

### Sprint 1 — Bases (1-2 días)
- Web: design tokens + aplicar a layout base sin romper nada
- Mobile: inicializar Expo + Expo Router + cliente API + login con SecureStore

### Sprint 2 — Core (3-5 días)
- Web: mejorar mapa (marcadores custom, popup enriquecido, panel lateral)
- Mobile: dashboard con mapa + lista de vehículos + detalle con gauges Victory Native XL

### Sprint 3 — Tiempo real (2-3 días)
- Web: WebSockets si aún hay polling, indicador de conexión en header
- Mobile: useTelemetry con WS + fallback polling + LiveIndicator

### Sprint 4 — Alertas y tareas (3-4 días)
- Web: panel de alertas tipo Samsara Safety Inbox
- Mobile: tab alertas + flujo completo de ejecución de tarea con fotos georreferenciadas

### Sprint 5 — Mantenimiento e informes (2-3 días)
- Web: módulo mantenimiento + informe de utilización exportable PDF/CSV
- Mobile: pantalla mantenimiento + share de informe por WhatsApp

### Sprint 6 — Integraciones (2-3 días)
- ERP CMG Nexus: sincronización de OTs con alertas críticas
- Agente Taller WA: bridge telemetría → WhatsApp → respuesta técnico
- FactuSOL: exportación de informes de tarea cerrada como albarán

═══════════════════════════════════════════════════════════════
## 12. QUÉ FALTA / PRÓXIMOS PASOS
═══════════════════════════════════════════════════════════════

- [ ] Caddy: verificar proxy 80/443 → 3000/8010 desde exterior
- [ ] Configurar variable_map para las IOs del IFM CR2530 real (tenant VACUUM)
- [ ] Configurar alertas de umbrales reales (presión hidráulica, voltaje) en tenant VACUUM
- [ ] Reducir On Road Min Period a 10-30s en Teltonika Configurator para tracking en tiempo real
- [ ] Test de carga con múltiples dispositivos simultáneos
- [ ] Hypertable compression: verificar con `SELECT * FROM timescaledb_information.compression_settings`
- [ ] Inicializar proyecto Expo en `/opt/cmg-telematics/mobile/`
- [ ] Documentar todos los endpoints existentes en `docs/endpoints.md`
- [ ] Implementar endpoints faltantes del contrato (sección 6)
- [ ] Configurar FCM + APNs para push notifications móvil
