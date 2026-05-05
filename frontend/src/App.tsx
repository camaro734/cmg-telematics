import { lazy, Suspense, Component, type ReactNode, type ErrorInfo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'
import { SectionErrorBoundary } from './shared/ui/SectionErrorBoundary'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error('[EB]', e, info) }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, background: '#1C1917', color: '#ef4444', fontFamily: 'monospace', whiteSpace: 'pre-wrap', minHeight: '100vh' }}>
        <b>ERROR (ErrorBoundary):</b>{'\n'}{String(this.state.error)}{'\n'}{(this.state.error as Error).stack}
      </div>
    )
    return this.props.children
  }
}

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
const CanScannerPage   = lazy(() => import('./features/diagnostics/CanScannerPage'))
const VehiclesPage     = lazy(() => import('./features/vehicles/VehiclesPage'))
const VehicleTypesPage = lazy(() => import('./features/vehicles/VehicleTypesPage'))

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
            <ErrorBoundary>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"        element={<SectionErrorBoundary label="Fleet"><FleetPage /></SectionErrorBoundary>} />
                <Route path="vehicles/:id" element={<SectionErrorBoundary label="VehicleDetail"><VehicleDetailPage /></SectionErrorBoundary>} />
                <Route path="alerts"       element={<SectionErrorBoundary label="Alerts"><AlertsPage /></SectionErrorBoundary>} />
                <Route path="settings"     element={<SectionErrorBoundary label="Settings"><SettingsPage /></SectionErrorBoundary>} />
                <Route path="rules"              element={<SectionErrorBoundary label="Rules"><RulesPage /></SectionErrorBoundary>} />
                <Route path="rules/new"          element={<SectionErrorBoundary label="RuleForm"><RuleFormPage /></SectionErrorBoundary>} />
                <Route path="rules/:id"          element={<SectionErrorBoundary label="RuleForm"><RuleFormPage /></SectionErrorBoundary>} />
                <Route path="maintenance"          element={<SectionErrorBoundary label="Maintenance"><MaintenancePage /></SectionErrorBoundary>} />
                <Route path="maintenance/new"      element={<SectionErrorBoundary label="MaintenanceForm"><MaintenancePlanFormPage /></SectionErrorBoundary>} />
                <Route path="maintenance/:id"      element={<SectionErrorBoundary label="MaintenanceDetail"><MaintenancePlanDetailPage /></SectionErrorBoundary>} />
                <Route path="maintenance/:id/edit" element={<SectionErrorBoundary label="MaintenanceForm"><MaintenancePlanFormPage /></SectionErrorBoundary>} />
                <Route path="clientes"          element={<SectionErrorBoundary label="Clientes"><TenantsPage /></SectionErrorBoundary>} />
                <Route path="clientes/new"      element={<SectionErrorBoundary label="ClienteForm"><TenantFormPage /></SectionErrorBoundary>} />
                <Route path="clientes/:id"      element={<SectionErrorBoundary label="ClienteDetail"><TenantDetailPage /></SectionErrorBoundary>} />
                <Route path="clientes/:id/edit" element={<SectionErrorBoundary label="ClienteForm"><TenantFormPage /></SectionErrorBoundary>} />
                <Route path="reports"           element={<SectionErrorBoundary label="Reports"><ReportsPage /></SectionErrorBoundary>} />
                <Route path="vehiculos"         element={<SectionErrorBoundary label="Vehiculos"><VehiclesPage /></SectionErrorBoundary>} />
                <Route path="tipos-vehiculo"   element={<SectionErrorBoundary label="TiposVehiculo"><VehicleTypesPage /></SectionErrorBoundary>} />
                <Route path="devices"          element={<SectionErrorBoundary label="Devices"><DevicesPage /></SectionErrorBoundary>} />
                <Route path="can-scanner"      element={<SectionErrorBoundary label="CanScanner"><CanScannerPage /></SectionErrorBoundary>} />
                <Route path="*"                  element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
