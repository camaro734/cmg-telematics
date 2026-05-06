# FIX — Reportes: precarga de filtros y rango personalizado

## PROBLEMA 1 — Filtros no se precargan al navegar desde detalle de vehículo

**Causa raíz:** `location.state` se leía correctamente, pero cuando el usuario CMG navegaba desde `VehicleDetailPage` sin incluir `tenantId` en el state, el selector de vehículos nunca se cargaba (la query de vehículos requiere `tenant_id` para usuarios CMG).

**Fix aplicado:**

1. Refactor del ref de estado inicial: `fromVehicleId` → `fromState` (captura el objeto completo del state de navegación una sola vez).
2. Nueva query React Query `['reports-nav-vehicle', vehicleId]`: cuando el usuario es CMG, llega `vehicleId` pero NO `tenantId` en el state, hace `GET /api/v1/vehicles/:id` para resolver el `tenant_id`.
3. `useEffect` sobre `navVehicle.tenant_id` → llama `setTenantId` cuando llega la respuesta.
4. El `useEffect` de inicialización sigue leyendo `state.tenantId` primero (si lo pasan, no hace la llamada extra).

**Archivos modificados:**
- `frontend/src/features/reports/ReportsPage.tsx` — componente principal `ReportsPage()`

---

## PROBLEMA 2 — Selector de rango de fechas personalizado

**Feature añadida:**

1. **Tipo `Period`:** añadido `'custom'` → `type Period = 'dia' | 'semana' | 'mes' | 'custom'`
2. **`PERIOD_HOURS`:** cambiado a `Record<Exclude<Period, 'custom'>, number>` para que TypeScript no permita acceso directo con `'custom'`.
3. **Helper `periodToHours(period, customFrom, customTo)`:** calcula las horas del rango personalizado (ms → horas, mínimo 1h). Usado en `HistoricoTab` en lugar de `PERIOD_HOURS[period]` directamente.
4. **Botón "Personalizado"** en `SelectorBar`: añadido al lado de "Mes". Al pulsar, aparecen dos inputs `type="date"` (Desde / Hasta).
5. **Validación 90 días:** al cambiar cualquiera de las fechas, se comprueba que el rango no supere 90 días y se ajusta el extremo contrario automáticamente.
6. **Estado** en el componente principal: `customFrom` (últimos 7 días por defecto) y `customTo` (hoy).
7. **Queries `HistoricoTab`** actualizadas:
   - KPIs: cuando `period === 'custom'` usa `?from=...&to=...` en lugar de `?hours=...`
   - AVL-series: mismo cambio, dentro del `Promise.all` de múltiples AVL IDs
   - `queryKey` incluye `${customFrom}_${customTo}` cuando es custom (cache correcto)

**Archivos modificados:**
- `frontend/src/features/reports/ReportsPage.tsx`

---

## Verificación

```bash
cd frontend && npx tsc -b --noEmit   # sin errores TypeScript
```

El `npm run build` falla por permisos en `/dist` (el directorio pertenece al contenedor Docker), no por errores de código.
