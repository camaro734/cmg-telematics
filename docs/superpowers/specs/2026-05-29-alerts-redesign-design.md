# Spec: Alertas — Rediseño, wizard de reglas y permisos

**Fecha:** 2026-05-29
**Estado:** Aprobado
**Sub-proyecto:** A (frontend únicamente)

---

## 1. Permisos de gestión de reglas

### Regla `canManageRules`

```ts
const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
```

| Rol + Tier | Acceso |
|---|---|
| admin + cmg | ✅ |
| admin + client | ✅ |
| admin + subclient | ❌ |
| operator / viewer / driver (cualquier tier) | ❌ |

### Puntos de aplicación

1. **`App.tsx`** — crear componente inline `RequireRules` que redirige a `/alerts` si `!canManageRules`. Envolver las rutas `/rules`, `/rules/new`, `/rules/:id`.
2. **`AlertsPage.tsx`** — reemplazar `isAdmin` por `canManageRules` para el tab "Reglas".
3. **`RulesPage.tsx`** — reemplazar `isAdmin` por `canManageRules` para el botón "Nueva regla" y acciones de editar/eliminar.
4. **`RuleFormPage.tsx`** — redirigir a `/alerts` si `!canManageRules` al montar.

---

## 2. Fix bug email en ActionsList

**Archivo:** `frontend/src/features/rules/ActionsList.tsx` línea ~66.

**Bug:** el `onChange` del checkbox de Email solo maneja el uncheck. Al marcar el checkbox, no se añade la acción email.

**Fix:**
```tsx
// Antes (roto):
onChange={e => { if (!e.target.checked) onChange(value.filter(a => a.type !== 'email')) }}

// Después (correcto):
onChange={e => {
  if (e.target.checked) {
    onChange([...value.filter(a => a.type !== 'email'), { type: 'email', recipients: [] }])
  } else {
    onChange(value.filter(a => a.type !== 'email'))
  }
}}
```

---

## 3. AlertsPage rediseño

**Archivo:** `frontend/src/features/alerts/AlertsPage.tsx`

### Header

```
[Alertas]   [● 3 activas]  (Chip danger)              [+ Nueva regla] (solo canManageRules)
```

### Tabs

`Activas` | `Historial` | `Reglas` (solo si canManageRules)

Tab activo: borde inferior teal, texto teal, peso 600. Inactivo: fg-muted.

### Tab "Activas"

- Usar `ActiveAlertsList` y `AlertHistory` existentes (no reescribir)
- Añadir contador `● N activas` en chip danger junto al título
- Botón "Exportar CSV" en el header derecho

### Tab "Historial"

- Usar `AlertHistory` existente
- Mover debajo de su propia tab (actualmente está como sección secundaria en el tab Activas)

### Tab "Reglas" (canManageRules únicamente)

- Lista inline de reglas (mover la lógica que actualmente era un redirect a /rules)
- Cada fila: chip de severidad (`--danger/--warn/--info`) + nombre + vehículos afectados + estado activo (toggle) + botones Editar / Eliminar
- Botón "+ Nueva regla" en el header general
- Reutilizar `AlertRulesSection` si existe, o construir inline con las queries ya disponibles
- Navegar a `/rules/new` o `/rules/:id` para crear/editar

---

## 4. RuleFormPage — wizard 5 pasos

**Archivo:** `frontend/src/features/rules/RuleFormPage.tsx`

### Estructura del wizard

El modal mantiene su overlay actual. Dentro, se reemplaza el scroll largo por un wizard con:
- **Barra de pasos** en el header (círculos numerados 1–5 conectados por línea, paso activo en teal)
- **Cuerpo** con solo el paso actual visible
- **Footer** con botones `← Anterior` / `Siguiente →` y `Guardar` en el paso 5

### Paso 1 — Identidad

**Título:** "Identificación de la regla"
**Descripción:** *"Ponle un nombre descriptivo y elige la urgencia. El nombre aparece en las notificaciones."*

Campos:
- **Nombre** — input texto, requerido
  - Ayuda: *"Ej: Presión bomba alta, Temperatura aceite, Parada fuera de zona"*
- **Descripción** — input texto, opcional
  - Ayuda: *"Nota interna. No se muestra en las notificaciones al operario."*
- **Severidad** — botones Info / Aviso / Crítica (igual que ahora)
  - Ayuda: *"Crítica activa el sonido en la app. Aviso solo notifica. Info es silenciosa."*

### Paso 2 — Vehículos

**Título:** "¿A qué vehículos aplica?"
**Descripción:** *"Puedes aplicar la regla a toda la flota, a un tipo de vehículo o a uno concreto."*

Usa `VehicleFilterPicker` existente.
Ayuda bajo el selector: *"Si seleccionas 'Todos', la regla se evalúa para cada vehículo de la flota."*

### Paso 3 — Condición

**Título:** "¿Cuándo se dispara?"
**Descripción:** *"Define la condición que activa la alerta. Se evalúa en cada paquete de telemetría recibido."*

Usa `ConditionBuilder` existente.
Ayudas contextuales por tipo de condición:
- `threshold`: *"El campo debe ser el nombre exacto del sensor CAN del vehículo. Ej: presion_bomba, temp_aceite, rpm_motor."*
- `threshold_sustained`: *"La condición debe mantenerse durante X minutos consecutivos antes de disparar."*
- `accumulation`: *"Suma el valor del sensor desde el último reset. Útil para horas de PTO o ciclos de trabajo."*
- `geofence`: *"La alerta se dispara cuando el vehículo entra o sale del polígono definido."*
- `schedule`: *"Se dispara si el vehículo reporta un valor inesperado fuera del horario configurado."*

### Paso 4 — Acciones y cooldown

**Título:** "¿Qué ocurre cuando se dispara?"
**Descripción:** *"Elige cómo se notifica. Puedes combinar varias acciones."*

Usa `ActionsList` (con el fix del email aplicado), `EscalationBuilder` y la sección de cooldown.

**Escalación** (bajo las acciones):
- Usa el componente `EscalationBuilder` existente
- Ayuda: *"La escalación envía una segunda notificación si la alerta no se reconoce en X minutos. Opcional."*

Ayudas de acciones:
- **In-app**: *"Aparece en la bandeja de alertas de la aplicación web y móvil."*
- **Email**: *"Envía un correo a los destinatarios configurados. Requiere que el administrador haya configurado el servidor SMTP en Ajustes."*
- **Webhook**: *"Llama a una URL externa con los datos de la alerta en JSON. Útil para integraciones con ERP o Slack."*
- **Cooldown**: *"Tiempo mínimo entre dos disparos de la misma regla para el mismo vehículo. Evita el spam de notificaciones."*

### Paso 5 — Revisar y guardar

**Título:** "Revisar y guardar"
**Descripción:** *"Comprueba que todo es correcto antes de activar la regla."*

Resumen visual de los 4 pasos anteriores (solo lectura):
- Nombre + severidad chip
- Alcance de vehículos
- Condición en lenguaje natural (ej: "presion_bomba > 250 durante 5 minutos")
- Acciones configuradas
- Cooldown

Toggle "Regla activa" (igual que ahora).
Botón "Guardar regla" (teal).

### Navegación del wizard

- `Siguiente →` valida el paso actual antes de avanzar (paso 1: nombre requerido; pasos 2-4: sin validación bloqueante)
- `← Anterior` no valida, retrocede siempre
- Click en número de paso: permite saltar si el paso destino ya fue visitado
- `✕` cierra el modal (navega a `/rules` o a la URL de origen)
- Estado del formulario se mantiene en memoria durante la navegación entre pasos

### Estado del wizard

```ts
const [step, setStep] = useState(1) // 1..5
const [visitedSteps, setVisitedSteps] = useState(new Set([1]))
```

---

## 5. Archivos a modificar

| Archivo | Cambio |
|---|---|
| `frontend/src/App.tsx` | Guard `RequireRules` en rutas /rules* |
| `frontend/src/features/alerts/AlertsPage.tsx` | Rediseño completo con tabs y header |
| `frontend/src/features/rules/RulesPage.tsx` | `canManageRules` en lugar de `isAdmin` |
| `frontend/src/features/rules/RuleFormPage.tsx` | Wizard 5 pasos |
| `frontend/src/features/rules/ActionsList.tsx` | Fix checkbox email |

---

## 6. Qué NO cambia

- Lógica de backend (endpoints de rules, alerts) — sin cambios
- `ConditionBuilder`, `VehicleFilterPicker`, `EscalationBuilder`, `ActiveAlertsList`, `AlertHistory` — sin cambios internos
- Rutas de URL — sin cambios
