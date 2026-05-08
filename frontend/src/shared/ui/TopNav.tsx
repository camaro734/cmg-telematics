import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { useReportsTabStore, REPORTS_TABS } from '../../features/reports/useReportsTabStore'
import type { ReportsTab } from '../../features/reports/useReportsTabStore'
// CmgMark removed — fallback now uses the CMG Track PNG directly
import { useIsMobile } from '../../lib/useIsMobile'
import { useTenantContext } from '../../lib/useTenantContext'
import { apiClient } from '../../lib/apiClient'
import type { TenantOut } from '../../lib/types'
import {
  IconDashboard,
  IconFlota,
  IconAlertas,
  IconMantenimiento,
  IconReportes,
  IconVehiculos,
  IconClientes,
  IconDispositivos,
  IconCanScanner,
  IconAjustes,
  IconOrdenes,
  IconConductores,
  IconGeocercas,
} from './icons'

// ── Module nav items ─────────────────────────────────────────────────────────

const MODULES = [
  { key: 'dashboard',   label: 'Dashboard',     Icon: IconDashboard,    to: '/dashboard' },
  { key: 'fleet',       label: 'Flota',          Icon: IconFlota,        to: '/fleet' },
  { key: 'alerts',      label: 'Alertas',        Icon: IconAlertas,      to: '/alerts' },
  { key: 'maintenance', label: 'Mantenimiento',  Icon: IconMantenimiento, to: '/maintenance' },
  { key: 'reports',     label: 'Reportes',       Icon: IconReportes,     to: '/reports' },
] as const

// Accesible para admin y operator de cualquier tenant
const OPERATOR_ITEMS = [
  { label: 'Órdenes de trabajo', to: '/work-orders', Icon: IconOrdenes },
  { label: 'Conductores',        to: '/drivers',      Icon: IconConductores },
  { label: 'Geocercas',          to: '/geofences',    Icon: IconGeocercas },
] as const

// Items completos del dropdown "Admin" para tier=cmg
const CMG_ADMIN_ITEMS = [
  { label: 'Clientes',            to: '/clientes',       Icon: IconClientes },
  { label: 'Flota (todos)',        to: '/vehiculos',      Icon: IconVehiculos },
  { label: 'Plantillas',          to: '/tipos-vehiculo', Icon: IconVehiculos },
  { label: 'Dispositivos',        to: '/devices',        Icon: IconDispositivos },
  { label: 'CAN Scanner',         to: '/can-scanner',    Icon: IconCanScanner },
  { label: 'Ajustes',             to: '/settings',       Icon: IconAjustes },
] as const

// Subset para tier=client: solo gestión de subclientes propios + ajustes
const CLIENT_ADMIN_ITEMS = [
  { label: 'Mis clientes',        to: '/clientes',       Icon: IconClientes },
  { label: 'Ajustes',             to: '/settings',       Icon: IconAjustes },
] as const

// ── Shared hook: close dropdown when clicking outside ────────────────────────

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onClose])
}

// ── Chevron ──────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <polyline points="2,4 6,8 10,4"/>
    </svg>
  )
}

// ── Hamburger icon ───────────────────────────────────────────────────────────

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      {open ? (
        <>
          <line x1="4" y1="4" x2="18" y2="18"/>
          <line x1="18" y1="4" x2="4" y2="18"/>
        </>
      ) : (
        <>
          <line x1="3" y1="7" x2="19" y2="7"/>
          <line x1="3" y1="11" x2="19" y2="11"/>
          <line x1="3" y1="15" x2="19" y2="15"/>
        </>
      )}
    </svg>
  )
}

// ── Desktop dropdown menu ────────────────────────────────────────────────────

interface DropdownMenuProps {
  items: ReadonlyArray<{ label: string; to: string; Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>> }>
  onClose: () => void
}

function DropdownMenu({ items, onClose }: DropdownMenuProps) {
  return (
    <div style={{
      position: 'absolute',
      top: 'calc(100% + 6px)',
      right: 0,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--bg-border)',
      borderRadius: 8,
      minWidth: 200,
      padding: '4px 0',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      zIndex: 200,
    }}>
      {items.map(({ label, to, Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onClose}
          style={({ isActive }) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
            textDecoration: 'none',
            background: isActive ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
            transition: 'background 0.12s, color 0.12s',
          })}
        >
          {Icon && <Icon width={15} height={15}/>}
          {label}
        </NavLink>
      ))}
    </div>
  )
}

// ── Mobile drawer ────────────────────────────────────────────────────────────

interface MobileDrawerProps {
  visibleModules: typeof MODULES[number][]
  adminItems: typeof CMG_ADMIN_ITEMS
  adminLabel: string
  operatorItems: typeof OPERATOR_ITEMS
  showAdmin: boolean
  showOperator: boolean
  userEmail: string | undefined
  onClose: () => void
  onLogout: () => void
  reportsTab?: string
  setReportsTab?: (tab: ReportsTab) => void
  isOnReports?: boolean
}

function MobileDrawer({
  visibleModules, adminItems, adminLabel, operatorItems, showAdmin, showOperator,
  userEmail, onClose, onLogout,
  reportsTab, setReportsTab, isOnReports,
}: MobileDrawerProps) {
  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 1100,
          top: 'var(--topbar-h)',
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 'var(--topbar-h)',
        left: 0,
        right: 0,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--bg-border)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - var(--topbar-h))',
        overflowY: 'auto',
      }}>
        {/* Reports sub-tabs if on reports page */}
        {isOnReports && setReportsTab && (
          <div style={{ borderBottom: '1px solid var(--bg-border)', padding: '8px 0' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 16px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sección de reportes</div>
            {REPORTS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setReportsTab(key as ReportsTab); onClose() }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: '12px 16px',
                  background: reportsTab === key ? 'color-mix(in srgb, var(--accent-energy) 12%, transparent)' : 'transparent',
                  borderLeft: `3px solid ${reportsTab === key ? 'var(--accent-energy)' : 'transparent'}`,
                  color: reportsTab === key ? 'var(--accent-energy)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 14,
                  fontWeight: reportsTab === key ? 600 : 400,
                  textAlign: 'left',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Main modules */}
        <div style={{ padding: '8px 0' }}>
          {visibleModules.map(({ key, label, Icon, to }) => (
            <NavLink
              key={key}
              to={to}
              onClick={onClose}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 16px',
                color: isActive ? 'var(--accent-energy)' : 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: 15,
                fontWeight: isActive ? 600 : 400,
                background: isActive ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
                borderLeft: `3px solid ${isActive ? 'var(--accent-energy)' : 'transparent'}`,
              })}
            >
              <Icon width={18} height={18}/>
              {label}
            </NavLink>
          ))}
        </div>

        {/* Operator section */}
        {showOperator && (
          <div style={{ borderTop: '1px solid var(--bg-border)', padding: '8px 0' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 16px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operaciones</div>
            {operatorItems.map(({ label, to, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
                  borderLeft: `3px solid ${isActive ? 'var(--accent-energy)' : 'transparent'}`,
                })}
              >
                <Icon width={16} height={16}/>
                {label}
              </NavLink>
            ))}
          </div>
        )}

        {/* Admin section */}
        {showAdmin && (
          <div style={{ borderTop: '1px solid var(--bg-border)', padding: '8px 0' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 16px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{adminLabel}</div>
            {adminItems.map(({ label, to, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
                  borderLeft: `3px solid ${isActive ? 'var(--accent-energy)' : 'transparent'}`,
                })}
              >
                <Icon width={16} height={16}/>
                {label}
              </NavLink>
            ))}
          </div>
        )}

        {/* User footer */}
        <div style={{ borderTop: '1px solid var(--bg-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{userEmail ?? '—'}</span>
          <button
            onClick={() => { onLogout(); onClose() }}
            style={{
              fontSize: 13, color: 'var(--accent-crit)',
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-ui)', fontWeight: 600, padding: '4px 8px',
            }}
          >
            Salir
          </button>
        </div>
      </div>
    </>
  )
}

// ── Tenant selector (CMG admin only) ────────────────────────────────────────

function TenantSelector() {
  const { activeTenantId, activeTenantName, setActiveTenant } = useTenantContext()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants', 'selector'],
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants?limit=200'),
  })

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 6,
    border: activeTenantId ? '1px solid var(--accent-energy)' : '1px solid var(--bg-border)',
    background: activeTenantId ? 'color-mix(in srgb, var(--accent-energy) 12%, transparent)' : 'transparent',
    color: activeTenantId ? 'var(--accent-energy)' : 'var(--text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
  }

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '8px 14px',
    background: active ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
    border: 'none',
    color: active ? 'var(--accent-energy)' : 'var(--text-primary)',
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s',
  })

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={btnStyle}>
        <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="2"/>
          <path d="M5 3v10M2 7h13"/>
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
          {activeTenantName ?? 'Todos los clientes'}
        </span>
        <Chevron open={open}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--bg-border)',
          borderRadius: 8,
          minWidth: 230,
          maxHeight: 340,
          overflowY: 'auto',
          padding: '4px 0',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 200,
        }}>
          <button style={itemStyle(!activeTenantId)} onClick={() => { setActiveTenant(null, null); setOpen(false) }}>
            Todos los clientes
          </button>
          <div style={{ height: 1, background: 'var(--bg-border)', margin: '4px 0' }}/>
          {tenants.map(t => (
            <button key={t.id} style={itemStyle(activeTenantId === t.id)} onClick={() => { setActiveTenant(t.id, t.name); setOpen(false) }}>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TopNav ───────────────────────────────────────────────────────────────────

export default function TopNav() {
  const { logoUrl, brandName, user, enabledModules, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const { tab: reportsTab, setTab: setReportsTab } = useReportsTabStore()
  const isMobile = useIsMobile()

  const isCmg   = user?.tenant_tier === 'cmg'
  const isClient = user?.tenant_tier === 'client'
  const isAdmin  = user?.role === 'admin'
  const canManageClients = (isCmg || isClient) && isAdmin
  const onReports = location.pathname === '/reports'

  const [adminOpen,    setAdminOpen]    = useState(false)
  const [operatorOpen, setOperatorOpen] = useState(false)
  const [userOpen,     setUserOpen]     = useState(false)
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [logoImgError, setLogoImgError] = useState(false)

  const adminRef    = useRef<HTMLDivElement>(null)
  const operatorRef = useRef<HTMLDivElement>(null)
  const userRef     = useRef<HTMLDivElement>(null)

  useClickOutside(adminRef,    () => setAdminOpen(false))
  useClickOutside(operatorRef, () => setOperatorOpen(false))
  useClickOutside(userRef,     () => setUserOpen(false))

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  const visibleModules = MODULES.filter(m => isCmg || enabledModules.includes(m.key))

  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid var(--bg-border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s',
    whiteSpace: 'nowrap',
  }

  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 'var(--topbar-h, 52px)',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--bg-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 8,
      zIndex: 1000,
      fontFamily: 'var(--font-ui)',
    }}>

      {/* ── Logo ──────────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/dashboard')}
        title={brandName ?? 'CMG Telematic'}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          marginRight: isMobile ? 0 : 8,
        }}
      >
        {logoUrl && !logoImgError
          ? <img
              src={logoUrl}
              alt="logo"
              onError={() => setLogoImgError(true)}
              style={{ width: isMobile ? 130 : 160, height: isMobile ? 46 : 52, objectFit: 'contain', objectPosition: 'left center', display: 'block' }}
            />
          : <img
              src="/static/logos/cmgtrack.png"
              alt="CMG Track"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              style={{ width: isMobile ? 130 : 160, height: isMobile ? 46 : 52, objectFit: 'contain', objectPosition: 'left center', display: 'block' }}
            />
        }
      </button>

      {/* ── Mobile: hamburger ─────────────────────────────────────────── */}
      {isMobile ? (
        <>
          <div style={{ flex: 1 }}/>
          <button
            onClick={() => setDrawerOpen(o => !o)}
            style={{
              background: 'none',
              border: '1px solid var(--bg-border)',
              borderRadius: 6,
              padding: '5px 8px',
              color: drawerOpen ? 'var(--accent-energy)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
            aria-label="Menú"
          >
            <HamburgerIcon open={drawerOpen}/>
          </button>

          {drawerOpen && (
            <MobileDrawer
              visibleModules={visibleModules as unknown as typeof MODULES[number][]}
              adminItems={(isCmg ? CMG_ADMIN_ITEMS : CLIENT_ADMIN_ITEMS) as unknown as typeof CMG_ADMIN_ITEMS}
              adminLabel={isCmg ? 'Administración' : 'Mis clientes'}
              operatorItems={OPERATOR_ITEMS}
              showAdmin={canManageClients}
              showOperator={isAdmin || user?.role === 'operator'}
              userEmail={user?.email}
              onClose={() => setDrawerOpen(false)}
              onLogout={logout}
              reportsTab={reportsTab}
              setReportsTab={setReportsTab}
              isOnReports={onReports}
            />
          )}
        </>
      ) : (
        <>
          {/* ── Desktop: Nav links ─────────────────────────────────────── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flex: 1,
          }}>
            {onReports ? (
              <>
                <NavLink
                  to="/fleet"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '0 12px 0 4px',
                    height: 'var(--topbar-h, 52px)',
                    color: 'var(--text-muted)',
                    textDecoration: 'none',
                    fontSize: 13,
                    borderRight: '1px solid var(--bg-border)',
                    marginRight: 4,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-energy)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  ← Flota
                </NavLink>
                {REPORTS_TABS.map(({ key, label }) => (
                  <button
                  key={key}
                  onClick={() => setReportsTab(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 14px',
                    height: 'var(--topbar-h, 52px)',
                    background: 'none',
                    border: 'none',
                    borderBottom: reportsTab === key
                      ? '2px solid var(--accent-energy)'
                      : '2px solid transparent',
                    color: reportsTab === key ? 'var(--accent-energy)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 13,
                    fontWeight: reportsTab === key ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.04em',
                  }}
                >
                  {label}
                </button>
              ))}
              </>
            ) : (
              <>
                {visibleModules.map(({ key, label, Icon, to }) => (
                  <NavLink
                    key={key}
                    to={to}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '0 12px',
                      height: 'var(--topbar-h, 52px)',
                      color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
                      borderBottom: isActive
                        ? '2px solid var(--accent-energy)'
                        : '2px solid transparent',
                      textDecoration: 'none',
                      fontSize: 13,
                      fontWeight: isActive ? 500 : 400,
                      transition: 'color 0.15s, border-color 0.15s',
                      whiteSpace: 'nowrap',
                    })}
                  >
                    <Icon width={16} height={16}/>
                    {label}
                  </NavLink>
                ))}
              </>
            )}
          </div>

          {/* ── Desktop: Right-side controls ──────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

            {canManageClients && <TenantSelector />}

            {(isAdmin || user?.role === 'operator') && (
              <div ref={operatorRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setOperatorOpen(o => !o); setAdminOpen(false); setUserOpen(false) }}
                  style={btnBase}
                >
                  <IconOrdenes width={15} height={15}/>
                  Operaciones
                  <Chevron open={operatorOpen}/>
                </button>
                {operatorOpen && (
                  <DropdownMenu items={OPERATOR_ITEMS as unknown as typeof CMG_ADMIN_ITEMS} onClose={() => setOperatorOpen(false)}/>
                )}
              </div>
            )}

            {canManageClients && (
              <div ref={adminRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setAdminOpen(o => !o); setOperatorOpen(false); setUserOpen(false) }}
                  style={btnBase}
                >
                  <IconAjustes width={15} height={15}/>
                  {isCmg ? 'Admin' : 'Mis clientes'}
                  <Chevron open={adminOpen}/>
                </button>
                {adminOpen && (
                  <DropdownMenu
                    items={isCmg ? CMG_ADMIN_ITEMS : CLIENT_ADMIN_ITEMS}
                    onClose={() => setAdminOpen(false)}
                  />
                )}
              </div>
            )}

            <div ref={userRef} style={{ position: 'relative' }}>
              <button
                onClick={() => { setUserOpen(o => !o); setAdminOpen(false) }}
                style={btnBase}
              >
                <span style={{
                  display: 'inline-block',
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {user?.email ?? '—'}
                </span>
                <Chevron open={userOpen}/>
              </button>

              {userOpen && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--bg-border)',
                  borderRadius: 8,
                  minWidth: 180,
                  padding: '4px 0',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  zIndex: 200,
                }}>
                  <div style={{
                    padding: '8px 14px 6px',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--bg-border)',
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {user?.email}
                  </div>
                  <button
                    onClick={() => { setUserOpen(false); logout() }}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 14px',
                      background: 'none',
                      border: 'none',
                      textAlign: 'left',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 13,
                      color: 'var(--accent-crit)',
                      cursor: 'pointer',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-crit) 10%, transparent)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  )
}
