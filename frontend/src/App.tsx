import { lazy, Suspense, Component, type ReactNode, type ErrorInfo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'
import { SectionErrorBoundary } from './shared/ui/SectionErrorBoundary'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error('[EB]', e, info)
    // Chunk load failure after a new deploy — do one hard reload to fetch fresh assets
    const isChunkError = e.message?.includes('Failed to fetch dynamically imported module')
      || e.message?.includes('Importing a module script failed')
      || e.message?.includes('error loading dynamically imported module')
    if (isChunkError) {
      const reloaded = sessionStorage.getItem('chunk_reload')
      if (!reloaded) {
        sessionStorage.setItem('chunk_reload', '1')
        window.location.reload()
      }
    }
  }
  render() {
    if (this.state.error) {
      const msg = String(this.state.error)
      const isChunk = msg.includes('Failed to fetch dynamically imported module')
        || msg.includes('Importing a module script failed')
      if (isChunk) return (
        <div style={{ padding: 24, background: '#1C1917', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontSize: 15 }}>Actualizando la aplicación…</div>
          <button
            onClick={() => { sessionStorage.removeItem('chunk_reload'); window.location.reload() }}
            style={{ padding: '8px 20px', borderRadius: 8, background: '#F97316', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            Recargar
          </button>
        </div>
      )
      return (
        <div style={{ padding: 24, background: '#1C1917', color: '#ef4444', fontFamily: 'monospace', whiteSpace: 'pre-wrap', minHeight: '100vh' }}>
          <b>ERROR (ErrorBoundary):</b>{'\n'}{msg}{'\n'}{(this.state.error as Error).stack}
        </div>
      )
    }
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
const DriversPage      = lazy(() => import('./features/drivers/DriversPage'))
const WorkOrdersPage   = lazy(() => import('./features/work-orders/WorkOrdersPage'))
const ClientPortalPage = lazy(() => import('./features/portal/ClientPortalPage'))
const DashboardPage    = lazy(() => import('./features/dashboard/DashboardPage'))

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
      <Route path="/portal/:token" element={<Suspense fallback={<Loading />}><ClientPortalPage /></Suspense>} />
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
                <Route path="drivers"          element={<SectionErrorBoundary label="Drivers"><DriversPage /></SectionErrorBoundary>} />
                <Route path="work-orders"     element={<SectionErrorBoundary label="WorkOrders"><WorkOrdersPage /></SectionErrorBoundary>} />
                <Route path="dashboard"       element={<SectionErrorBoundary label="Dashboard"><DashboardPage /></SectionErrorBoundary>} />
                <Route path="*"                  element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
