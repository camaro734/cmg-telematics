# PLAN-VPS-1MES — Entrega Cliente VPS como Fabricante

**Cliente:** VACUUM PRESURE SYSTEMS (VPS)
**Modelo:** Fabricante (fabrica camiones cisterna y los vende; va a tener varios clientes propios usando CMG Track)
**Plazo:** 1 mes
**Estado actual:** acuerdo firme

---

## Resumen ejecutivo

Toda la jerarquía v2 que construimos en Fase 1, 2 y 3 fue para este momento. VPS es el primer cliente real del modelo Fabricante. En 4 semanas hay que:

- Migrar VPS de tier=client a tier=manufacturer (incluye sus vehículos)
- Arreglar los 6 bugs críticos/importantes de la auditoría
- Migrar endpoints clave al helper v2 (que respeten la jerarquía)
- Crear UI específica de Fabricante (dashboard, sus vehículos, sus clientes)
- Implementar facturación por dispositivo
- Pulir telemetría CAN profunda (diferenciador competitivo)
- Llegar al día del contrato con datos demo coherentes + documentación

---

## Semana 1 — Estabilizar + base jerárquica

**Objetivo:** que cuando VPS entre por primera vez, NADA se le rompa.

### Día 1 (hoy)
- Migración SQL: VPS tier=client → tier=manufacturer
- Fix WeasyPrint async (30 min) — PDFs no congelan el event loop
- Verificación: camión de prueba sigue mandando, mapa fluido

### Día 2
- Fix Rules-engine XACK (45 min) — alertas no se pierden silenciosamente
- Migrar GET /vehicles y GET /vehicles/{id} al helper v2 (2h)

### Día 3
- Migrar GET /vehicles/{id}/track al helper v2 (1h)
- Migrar GET /alerts al helper v2 (1h)
- Migrar GET /maintenance-log al helper v2 (1h)

### Día 4
- Endpoint y lógica para que manufacturer cree sus tier=client sub-tenants (3h)
- Test: VPS crea un cliente operador desde su cuenta

### Día 5
- Notify-svc XACK fix + activar SMTP (1.5h)
  ⚠️  PREREQUISITO: aplicar el fix del Commit 2 en notify-svc ANTES de
  configurar SMTP_HOST. El bug de XACK-on-error existe en el código pero
  es inofensivo con stream vacío. En cuanto llegue el primer email real,
  un fallo SMTP haría XACK igualmente y la alerta se perdería.
  Ver sección PENDIENTE al final de este documento.
- Quitar password seed hardcodeado (30 min)
- Smoke test general

---

## Semana 2 — UI del Fabricante

**Objetivo:** que VPS tenga vista propia, no la de cliente operador.

### Día 1-2
- Dashboard Fabricante (KPIs propios: total dispositivos activos, sus clientes, alertas globales)

### Día 3
- Vista "Mis vehículos" filtrada por manufacturer_tenant_id
- Detalle de vehículo con info técnica visible al fabricante

### Día 4
- Vista "Mis clientes" (tier=client bajo VPS)
- Detalle cliente: estado, dispositivos, contacto

### Día 5
- Branding por herencia (logo VPS visible a sus clientes)
- Validación general semana 2

---

## Semana 3 — Facturación + telemetría avanzada

**Objetivo:** modelo de negocio operativo + datos profundos visibles.

### Día 1
- Endpoint y vista de facturación por dispositivo activo
- Migración 029-tipo: manufacturer_subscription (annual_base_eur, monthly_per_device_eur)

### Día 2-3
- Pulir presentación de telemetría CAN profunda (presiones, PTO, RPM)
- Vistas claras de los slots Extended 380-389

### Día 4
- Analítica básica por vehículo (tendencias)
- Comparativa entre vehículos (cliente final)

### Día 5
- Rate limit portal (1h)
- Validación general semana 3

---

## Semana 4 — Ensayo + datos demo + cierre

**Objetivo:** llegar al día del contrato con confianza.

### Día 1-2
- Datos demo coherentes: VPS + 1-2 clientes ficticios + vehículos
- Limpiar BD de cualquier residuo de test

### Día 3
- Documentación cliente: 1-2 páginas (cómo entrar, cómo crear cliente, cómo ver flota)
- Vídeo o screenshots si conviene

### Día 4
- Ensayo end-to-end del flujo completo
- Lista de cualquier bug residual encontrado

### Día 5
- Fixes finales
- Producto listo

---

## Riesgos identificados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Bug imprevisto en migración endpoints v2 | Alto | Hacer uno a uno, verificar cada uno |
| Datos demo poco realistas | Medio | Crear con datos coherentes (rutas, alertas, partes) |
| Cliente pide algo no en plan | Medio | Negociar prioridades antes de empezar |
| Fallo de hardware (FMC650, IFM) | Bajo | Sistema de buffer offline ya validado |

---

## Lo que NO está en el plan (queda para después)

- Refactor de ReportsPage (1196 líneas)
- Eliminar helper v1 (queda coexistiendo con v2)
- UI para crear conductores desde el fabricante
- Multi-idioma
- App móvil (sigue en TestFlight)
- Endpoint Codec 12 TCP (escritura remota IFM)

---

## PENDIENTE — notify-svc XACK fix (aplazado de Día 2 Semana 1)

**Por qué se aplazó:** notify-svc no ha procesado ningún mensaje real
(0 alertas en BD, SMTP_HOST vacío). Riesgo en producción actual = 0.

**Qué hay que hacer cuando se configure SMTP:**

Aplicar en `services/notify/src/main.py` el mismo patrón del Commit 2
de rules-engine (commit 1ff93de):

1. `import socket` en imports stdlib
2. `CONSUMER_NAME = socket.gethostname()` (estable entre reinicios)
3. Nueva función `_drain_pending()` llamada al arranque de `_process_stream`
4. Quitar `await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)` del
   except en `_process_stream` (líneas 97-99 actuales)

**Stream afectado:** `alerts.fire` / consumer group `notify-workers`

**Referencia:** Auditoría 2026-05-19, critical fix #2 de 6.
El fix de rules-engine (mismo bug) está en commits 130004d + 1ff93de.

---

**Última actualización:** 2026-05-22 (sesión)
