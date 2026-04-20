# Sprint 12 — White-label Runtime Design

**Fecha:** 2026-04-20
**Estado:** Aprobado

## Objetivo

Hacer que `brand_tokens` del tenant se apliquen como CSS variables globales en el frontend en tiempo real. El backend ya almacena y sirve los tokens; falta que el frontend los inyecte correctamente en el DOM y los re-aplique cuando el usuario los cambia sin necesidad de re-login.

## Contexto

### Qué ya existe

- `GET/PUT /api/v1/tenants/{id}/brand-tokens` — endpoints operativos
- `useAuthStore.applyBrandTokens(tokens)` — función ya existente, llamada en `LoginPage` tras login
- `useAuthStore.{ brandName, logoUrl }` — estado en Zustand, ya consumido en `Sidebar`
- `BrandTokensEditor` — componente de edición con preview local en `TenantDetailPage`
- `Sidebar` — ya muestra `logoUrl`; usa `var(--accent-energy)` para el color activo

### Bug activo

`applyBrandTokens` itera las claves de `BrandTokens` buscando las que empiecen por `--`, pero las claves reales son `brand_color`, `logo_url`, `brand_name`. El bucle nunca ejecuta `setProperty`. El color nunca se aplica al DOM.

Adicionalmente, el color de fondo del ítem activo en `Sidebar` está hardcodeado como `rgba(249,115,22,0.15)` — el naranja por defecto — en lugar de derivarse de `--accent-energy`, por lo que no cambia con el white-label.

## Alcance

### Incluido

- Mapeo explícito `brand_color` → `--accent-energy` en `applyBrandTokens`
- Re-aplicación inmediata al guardar (solo para el usuario que guarda, solo si edita su propio tenant)
- Tooltip con `brand_name` en el logo del Sidebar
- Sustitución del `rgba` hardcodeado en Sidebar por `color-mix`
- Tests unitarios

### Excluido

- Push en tiempo real a otros usuarios del tenant (suficiente con re-login)
- Variables adicionales (`--bg-base`, `--bg-surface`) — solo `--accent-energy`
- `document.title` dinámico
- Sub-clientes / herencia de tokens

## Diseño

### 1. `useAuthStore.ts` — fix `applyBrandTokens`

Reemplazar el bucle dead-code por mapeo explícito:

```ts
applyBrandTokens: (tokens) => {
  const root = document.documentElement
  if (tokens.brand_color && /^#[0-9a-fA-F]{6}$/.test(tokens.brand_color)) {
    root.style.setProperty('--accent-energy', tokens.brand_color)
  }
  const safeLogoUrl = tokens.logo_url?.startsWith('https://') ? tokens.logo_url : get().logoUrl
  set({
    brandName: tokens.brand_name ?? get().brandName,
    logoUrl: safeLogoUrl,
  })
},
```

La validación de formato hex (`/^#[0-9a-fA-F]{6}$/`) preserva la seguridad anterior.

### 2. `useAuthStore.ts` — reset en logout

Al hacer logout, eliminar la CSS var del DOM para que el próximo usuario que abra la misma pestaña parta del tema CMG por defecto:

```ts
logout: () => {
  document.documentElement.style.removeProperty('--accent-energy')
  set({ accessToken: null, user: null, brandName: null, logoUrl: null })
},
```

### 3. `BrandTokensEditor.tsx` — re-apply al guardar

En `useMutation.onSuccess`, si el tenant editado coincide con el tenant del usuario logado, aplicar los tokens inmediatamente:

```ts
const mutation = useMutation({
  mutationFn: (payload: BrandTokens) =>
    apiClient.put(`/api/v1/tenants/${tenantId}/brand-tokens`, { brand_tokens: payload }),
  onSuccess: (_, payload) => {
    qc.invalidateQueries({ queryKey: keys.tenantBrandTokens(tenantId) })
    const { user, applyBrandTokens } = useAuthStore.getState()
    if (user?.tenant_id === tenantId) applyBrandTokens(payload)
  },
})
```

Esto cubre el caso de un admin de cliente que edita su propia marca en `/settings`. Un admin CMG editando la marca de Wasterent no afecta su propia sesión (correcto: CMG tiene su propia identidad visual).

### 4. `Sidebar.tsx` — tooltip + color activo

**Tooltip:** añadir `title` al contenedor del logo:

```tsx
<div style={{ marginBottom: 16 }} title={brandName ?? 'CMG Telematic'}>
  {logoUrl ? <img .../> : <CmgMark size={30}/>}
</div>
```

**Color activo:** sustituir `rgba(249,115,22,0.15)` (hardcoded en 3 `NavLink`) por:

```ts
background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
```

`color-mix` está soportado en Chrome 111+, Firefox 113+, Safari 16.2+ — adecuado para un SaaS B2B industrial.

## Tests

| Fichero | Caso |
|---------|------|
| `useAuthStore.test.ts` (nuevo) | `applyBrandTokens({ brand_color: '#3056D3' })` → `document.documentElement.style.getPropertyValue('--accent-energy') === '#3056D3'` |
| `useAuthStore.test.ts` | Color inválido (`#ZZZZZZ`) → no llama a `setProperty` |
| `BrandTokensEditor.test.tsx` (modificar) | `onSuccess` con `tenantId === user.tenant_id` → llama a `applyBrandTokens` |
| `BrandTokensEditor.test.tsx` | `onSuccess` con `tenantId !== user.tenant_id` → no llama a `applyBrandTokens` |

## Ficheros modificados

| Fichero | Acción |
|---------|--------|
| `frontend/src/features/auth/useAuthStore.ts` | Fix `applyBrandTokens` + reset CSS var en `logout` |
| `frontend/src/features/clientes/BrandTokensEditor.tsx` | Re-apply en `onSuccess` |
| `frontend/src/shared/ui/Sidebar.tsx` | Tooltip + `color-mix` |
| `frontend/src/features/auth/useAuthStore.test.ts` | Crear — tests `applyBrandTokens` |
| `frontend/src/features/clientes/__tests__/BrandTokensEditor.test.tsx` | Ampliar — casos re-apply |
