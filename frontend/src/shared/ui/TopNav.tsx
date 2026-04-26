import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { useReportsTabStore, REPORTS_TABS } from '../../features/reports/useReportsTabStore'
import type { ReportsTab } from '../../features/reports/useReportsTabStore'
import { CmgMark } from './CmgLogo'
import { useIsMobile } from '../../lib/useIsMobile'
import {
  IconFlota,
  IconAlertas,
  IconMantenimiento,
  IconReportes,
  IconVehiculos,
  IconClientes,
  IconDispositivos,
  IconCanScanner,
  IconAjustes,
} from './icons'

// ── Module nav items ─────────────────────────────────────────────────────────

const MODULES = [
  { key: 'fleet',       label: 'Flota',        Icon: IconFlota,        to: '/fleet' },
  { key: 'alerts',      label: 'Alertas',       Icon: IconAlertas,      to: '/alerts' },
  { key: 'maintenance', label: 'Mantenimiento', Icon: IconMantenimiento, to: '/maintenance' },
  { key: 'reports',     label: 'Reportes',      Icon: IconReportes,     to: '/reports' },
] as const

const CMG_ADMIN_ITEMS = [
  { label: 'Clientes',            to: '/clientes',       Icon: IconClientes },
  { label: 'Flota (todos)',        to: '/vehiculos',      Icon: IconVehiculos },
  { label: 'Plantillas',          to: '/tipos-vehiculo', Icon: IconVehiculos },
  { label: 'Dispositivos',        to: '/devices',        Icon: IconDispositivos },
  { label: 'CAN Scanner',         to: '/can-scanner',    Icon: IconCanScanner },
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
  showAdmin: boolean
  userEmail: string | undefined
  onClose: () => void
  onLogout: () => void
  reportsTab?: string
  setReportsTab?: (tab: ReportsTab) => void
  isOnReports?: boolean
}

function MobileDrawer({
  visibleModules, adminItems, showAdmin,
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

        {/* Admin section */}
        {showAdmin && (
          <div style={{ borderTop: '1px solid var(--bg-border)', padding: '8px 0' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 16px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Administración</div>
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

// ── TopNav ───────────────────────────────────────────────────────────────────

export default function TopNav() {
  const { logoUrl, brandName, user, enabledModules, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const { tab: reportsTab, setTab: setReportsTab } = useReportsTabStore()
  const isMobile = useIsMobile()

  const isCmg   = user?.tenant_tier === 'cmg'
  const isAdmin  = user?.role === 'admin'
  const onReports = location.pathname === '/reports'

  const [adminOpen, setAdminOpen] = useState(false)
  const [userOpen,  setUserOpen]  = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const adminRef = useRef<HTMLDivElement>(null)
  const userRef  = useRef<HTMLDivElement>(null)

  useClickOutside(adminRef, () => setAdminOpen(false))
  useClickOutside(userRef,  () => setUserOpen(false))

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
        onClick={() => navigate('/fleet')}
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
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ height: isMobile ? 32 : 30, maxWidth: isMobile ? 120 : 160, objectFit: 'contain', display: 'block' }}/>
          : <CmgMark size={28}/>
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
              adminItems={CMG_ADMIN_ITEMS}
              showAdmin={isCmg && isAdmin}
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
              REPORTS_TABS.map(({ key, label }) => (
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
              ))
            ) : (
              visibleModules.map(({ key, label, Icon, to }) => (
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
              ))
            )}
          </div>

          {/* ── Desktop: Right-side controls ──────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

            {isCmg && isAdmin && (
              <div ref={adminRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setAdminOpen(o => !o); setUserOpen(false) }}
                  style={btnBase}
                >
                  <IconAjustes width={15} height={15}/>
                  Admin
                  <Chevron open={adminOpen}/>
                </button>
                {adminOpen && (
                  <DropdownMenu items={CMG_ADMIN_ITEMS} onClose={() => setAdminOpen(false)}/>
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
