# Tests Frontend Arreglados

**Fecha:** 2026-04-30
**Tests arreglados:** 30 de 30 tests fallidos
**Estado final:** 152/152 tests pasan (32 archivos)

---

## Archivos modificados

### 1. `frontend/src/features/rules/__tests__/RulesPage.test.tsx`
**Cambio:** Mock de `useAuthStore` actualizado para incluir `enabledModules: []`, `logoUrl`, `brandName` y `logout`.
**Causa del fallo:** `TopNav` (usado via `Shell`) llama `enabledModules.includes(m.key)` pero el mock no incluía `enabledModules`, resultando en `TypeError: Cannot read properties of undefined (reading 'includes')`.

### 2. `frontend/src/features/rules/__tests__/RuleFormPage.test.tsx`
**Cambio:** Mismo que RulesPage — mock de `useAuthStore` con campos completos.
**Causa del fallo:** Idéntica a RulesPage.

### 3. `frontend/src/features/maintenance/__tests__/MaintenancePage.test.tsx`
**Cambio:** Mock de `useAuthStore` con `enabledModules: []` y campos del store.
**Causa del fallo:** Idéntica a las anteriores.

### 4. `frontend/src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx`
**Cambio:** Mock de `useAuthStore` con campos completos del store.
**Causa del fallo:** Idéntica a las anteriores.

### 5. `frontend/src/features/clientes/__tests__/TenantsPage.test.tsx`
**Cambio:** Objeto `cmgUser` ampliado con `enabledModules`, `logoUrl`, `brandName`, `logout` y sub-objeto `user` con los campos del usuario real.
**Causa del fallo:** `mockReturnValue(cmgUser)` sin `enabledModules` hacía explotar `TopNav`.

### 6. `frontend/src/features/clientes/__tests__/TenantDetailPage.test.tsx`
**Cambio:** Mismo patrón que TenantsPage.
**Causa del fallo:** Idéntica a TenantsPage.

### 7. `frontend/src/features/settings/__tests__/SettingsPage.test.tsx`
**Cambios:**
- Añadida función helper `makeStoreMock()` que soporta tanto llamadas sin selector (`useAuthStore()`) como con selector (`useAuthStore(s => s.user)`), porque `NotificationSettings` usa la forma selectora.
- Tests usan `mockImplementation(makeStoreMock(...))` en lugar de `mockReturnValue(...)`.
- Mock de `apiClient.get` separado por ruta para devolver arrays vacíos cuando `UsersSection` pide `/users` (evita error `users.map is not a function`).
**Causa del fallo:** `NotificationSettings` llama `useAuthStore(s => s.user)` con selector; el mock básico no lo soportaba.

### 8. `frontend/src/features/vehicle/__tests__/KpiChart.test.tsx`
**Cambios:**
- QueryKey corregido de `['vehicles', 'v1', 'kpis', 24]` a `['vehicles', 'v1', 'kpis', 168]` (el componente usa `period='semana'` = 168h por defecto, no 24h).
- Texto buscado corregido: `sin datos` → `Sin datos para el período seleccionado`.
- Etiquetas de botones corregidas: `7d` → `7 días`, `30d` → `30 días` (el componente renderiza texto completo, no abreviaciones).
- Nombre del test `cambia el rango al hacer clic en 7d` → `cambia el rango al hacer clic en 7 días`.
**Causa del fallo:** QueryKey desincronizado con el componente actual (el componente cambió su período por defecto y el texto de los botones).

### 9. `frontend/src/features/reports/__tests__/ReportsPage.test.tsx`
**Cambio:** Reescritura completa de 5 tests para reflejar la estructura actual de `ReportsPage`.
**Causa del fallo:** La página fue rediseñada completamente — ya no existe tab "HOME" con lista de vehículos. La página actual tiene selector de vehículo + tabs (historico/mantenimiento/rutas/alertas). Los tests antiguos buscaban `Flota`, `WAS-001`, `Sin vehículos` que ya no existen.
**Tests nuevos que reemplazan los anteriores:**
  - `renderiza la página mostrando el título Reportes`
  - `muestra selector de vehículo con placeholder`
  - `muestra mensaje de selección cuando no hay vehículo elegido`
  - `CMG admin ve selector de cliente en la barra`
  - `client admin no ve selector de cliente`

---

## Arreglos en CI (`.github/workflows/ci.yml`)

**Cambios:**
- `branches: [main, develop]` → `branches: [main, master, develop]` en el trigger `push`
- `branches: [main]` → `branches: [main, master]` en el trigger `pull_request`
- Condición del smoke test actualizada para ejecutarse también en pushes a `master`

**Causa:** El repositorio usa la rama `master` pero el CI solo escuchaba `main` y `develop`.
