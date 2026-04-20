import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage         = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage = lazy(() => import('./features/vehicle/VehicleDetailPage'))
const AlertsPage        = lazy(() => import('./features/alerts/AlertsPage'))
const SettingsPage      = lazy(() => import('./features/settings/SettingsPage'))
const RulesPage                  = lazy(() => import('./features/rules/RulesPage'))
const RuleFormPage               = lazy(() => import('./features/rules/RuleFormPage'))
const MaintenancePage            = lazy(() => import('./features/maintenance/MaintenancePage'))
const MaintenancePlanFormPage    = lazy(() => import('./features/maintenance/MaintenancePlanFormPage'))
const MaintenancePlanDetailPage  = lazy(() => import('./features/maintenance/MaintenancePlanDetailPage'))
const TenantsPage      = lazy(() => import('./features/clientes/TenantsPage'))
const TenantFormPage   = lazy(() => import('./features/clientes/TenantFormPage'))
const TenantDetailPage = lazy(() => import('./features/clientes/TenantDetailPage'))
const ReportsPage      = lazy(() => import('./features/reports/ReportsPage'))
const DevicesPage      = lazy(() => import('./features/devices/DevicesPage'))

function Loading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"        element={<FleetPage />} />
                <Route path="vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="alerts"       element={<AlertsPage />} />
                <Route path="settings"     element={<SettingsPage />} />
                <Route path="rules"              element={<RulesPage />} />
                <Route path="rules/new"          element={<RuleFormPage />} />
                <Route path="rules/:id"          element={<RuleFormPage />} />
                <Route path="maintenance"          element={<MaintenancePage />} />
                <Route path="maintenance/new"      element={<MaintenancePlanFormPage />} />
                <Route path="maintenance/:id"      element={<MaintenancePlanDetailPage />} />
                <Route path="maintenance/:id/edit" element={<MaintenancePlanFormPage />} />
                <Route path="clientes"          element={<TenantsPage />} />
                <Route path="clientes/new"      element={<TenantFormPage />} />
                <Route path="clientes/:id"      element={<TenantDetailPage />} />
                <Route path="clientes/:id/edit" element={<TenantFormPage />} />
                <Route path="reports"           element={<ReportsPage />} />
                <Route path="devices"          element={<DevicesPage />} />
                <Route path="*"                  element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
