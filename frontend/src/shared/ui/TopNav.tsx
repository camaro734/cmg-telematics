import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
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

// ── Module nav items (filter by enabledModules unless CMG) ──────────────────

const MODULES = [
  { key: 'fleet',       label: 'Flota',        Icon: IconFlota,        to: '/fleet' },
  { key: 'alerts',      label: 'Alertas',       Icon: IconAlertas,      to: '/alerts' },
  { key: 'maintenance', label: 'Mantenimiento', Icon: IconMantenimiento, to: '/maintenance' },
  { key: 'reports',     label: 'Reportes',      Icon: IconReportes,     to: '/reports' },
] as const

// ── CMG-admin-only dropdown items ───────────────────────────────────────────

const CMG_ADMIN_ITEMS = [
  { label: 'Vehículos',         to: '/vehiculos',      Icon: IconVehiculos },
  { label: 'Tipos de vehículo', to: '/tipos-vehiculo', Icon: IconVehiculos },
  { label: 'Clientes',          to: '/clientes',       Icon: IconClientes },
  { label: 'Dispositivos',      to: '/devices',        Icon: IconDispositivos },
  { label: 'CAN Scanner',       to: '/can-scanner',    Icon: IconCanScanner },
  { label: 'Ajustes',          to: '/settings',        Icon: IconAjustes },
] as const

// ── Shared hook: close dropdown when clicking outside ───────────────────────

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

// ── Chevron ─────────────────────────────────────────────────────────────────

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

// ── Dropdown menu ────────────────────────────────────────────────────────────

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

// ── TopNav ───────────────────────────────────────────────────────────────────

export default function TopNav() {
  const { logoUrl, brandName, user, enabledModules, logout } = useAuthStore()
  const navigate = useNavigate()

  const isCmg   = user?.tenant_tier === 'cmg'
  const isAdmin  = user?.role === 'admin'

  const [adminOpen, setAdminOpen] = useState(false)
  const [userOpen,  setUserOpen]  = useState(false)

  const adminRef = useRef<HTMLDivElement>(null)
  const userRef  = useRef<HTMLDivElement>(null)

  useClickOutside(adminRef, () => setAdminOpen(false))
  useClickOutside(userRef,  () => setUserOpen(false))

  // Modules visible to current user
  const visibleModules = MODULES.filter(m => isCmg || enabledModules.includes(m.key))

  // ── Styles ──────────────────────────────────────────────────────────────

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
      zIndex: 100,
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
          marginRight: 8,
        }}
      >
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ height: 30, objectFit: 'contain' }}/>
          : <CmgMark size={28}/>
        }
      </button>

      {/* ── Module nav links (flex-grow center area) ───────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flex: 1,
      }}>
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
      </div>

      {/* ── Right-side controls ────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

        {/* Admin dropdown — only for CMG admins */}
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

        {/* User menu */}
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
    </nav>
  )
}
