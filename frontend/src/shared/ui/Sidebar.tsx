import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
import { Chip } from './Chip'
import { Input } from './Input'

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="var(--fg-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
import {
  IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes,
  IconClientes, IconReportes, IconDispositivos, IconCanScanner,
  IconVehiculos, IconConductores, IconOrdenes,
} from './icons'
import { apiClient } from '../../lib/apiClient'

const STORAGE_KEY = 'cmg_sidebar_expanded'

const ROLE_COLORS: Record<string, string> = {
  admin:    'var(--role-admin)',
  operator: 'var(--role-operator)',
  viewer:   'var(--role-viewer)',
  driver:   'var(--role-driver)',
}

function useActiveAlertCount() {
  const { data } = useQuery({
    queryKey: ['alerts', 'active-count'],
    queryFn: async () => {
      const [firing, escalated] = await Promise.all([
        apiClient.get<unknown[]>('/api/v1/alerts?status=firing&limit=200'),
        apiClient.get<unknown[]>('/api/v1/alerts?status=escalated&limit=200'),
      ])
      return (firing?.length ?? 0) + (escalated?.length ?? 0)
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
  return data ?? 0
}

interface NavItemDef {
  to: string
  Icon: React.FC<{ width: number; height: number }>
  label: string
  badge?: number
}

function SidebarItem({ item, expanded }: { item: NavItemDef; expanded: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={!expanded ? item.label : undefined}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center',
        gap: 12, padding: '8px 12px',
        borderRadius: 8, fontSize: 13, fontWeight: 500,
        color: isActive ? 'var(--cmg-teal)' : 'var(--fg-tertiary)',
        background: isActive ? 'var(--cmg-teal-soft)' : 'transparent',
        textDecoration: 'none', marginBottom: 2,
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap', overflow: 'hidden',
        justifyContent: expanded ? 'flex-start' : 'center',
      })}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement
        if (!el.getAttribute('aria-current')) {
          el.style.background = 'var(--bg-hover)'
          el.style.color = 'var(--fg-primary)'
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement
        if (!el.getAttribute('aria-current')) {
          el.style.background = 'transparent'
          el.style.color = 'var(--fg-tertiary)'
        }
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <item.Icon width={20} height={20} />
        {item.badge != null && item.badge > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -8,
            background: 'var(--danger)', color: '#fff',
            borderRadius: 99, fontSize: 9, fontWeight: 700,
            lineHeight: 1, padding: '2px 4px',
            minWidth: 14, textAlign: 'center',
          }}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </div>
      {expanded && (
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
        </span>
      )}
    </NavLink>
  )
}

interface NavSection {
  label: string
  items: NavItemDef[]
}

export default function Sidebar() {
  const { logoUrl, brandName, user, logout } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'
  const alertCount = useActiveAlertCount()
  const [search, setSearch] = useState('')

  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true'
  )

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', expanded ? '240px' : '64px')
  }, [expanded])

  useEffect(() => {
    const handler = () => setExpanded(localStorage.getItem(STORAGE_KEY) === 'true')
    window.addEventListener('cmg_sidebar_change', handler)
    return () => window.removeEventListener('cmg_sidebar_change', handler)
  }, [])

  const toggle = () => {
    const next = !expanded
    localStorage.setItem(STORAGE_KEY, String(next))
    setExpanded(next)
    if (next) setSearch('')
  }

  const sections: NavSection[] = [
    {
      label: 'Monitorización',
      items: [
        { to: '/fleet',       Icon: IconFlota,         label: 'Flota' },
        { to: '/alerts',      Icon: IconAlertas,        label: 'Alertas',       badge: alertCount || undefined },
        { to: '/maintenance', Icon: IconMantenimiento,  label: 'Mantenimiento' },
        ...(isAdmin ? [
          { to: '/rules',   Icon: IconReglas,   label: 'Reglas' },
          { to: '/reports', Icon: IconReportes, label: 'Reportes' },
        ] : []),
      ],
    },
    {
      label: 'Operaciones',
      items: (isAdmin || user?.role === 'operator') ? [
        { to: '/work-orders', Icon: IconOrdenes,     label: 'Órdenes de trabajo' },
        { to: '/drivers',     Icon: IconConductores, label: 'Conductores' },
      ] : [],
    },
    ...(isCmg ? [{
      label: 'Administración',
      items: [
        { to: '/clientes',       Icon: IconClientes,    label: 'Clientes' },
        ...(isAdmin ? [
          { to: '/vehiculos',      Icon: IconVehiculos,   label: 'Vehículos' },
          { to: '/tipos-vehiculo', Icon: IconVehiculos,   label: 'Plantillas' },
          { to: '/settings',       Icon: IconAjustes,     label: 'Ajustes' },
        ] : []),
        { to: '/devices',     Icon: IconDispositivos, label: 'Dispositivos' },
        { to: '/can-scanner', Icon: IconCanScanner,   label: 'CAN Scanner' },
      ],
    }] : [{
      label: 'Configuración',
      items: isAdmin ? [{ to: '/settings', Icon: IconAjustes, label: 'Ajustes' }] : [],
    }]),
  ]

  const allItems = sections.flatMap(s => s.items)
  const filtered = search.trim()
    ? allItems.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : null

  const initials = (user?.email ?? 'U')
    .split('@')[0].split('.').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: 'var(--sidebar-w)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 100, overflow: 'hidden',
      transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      {/* Logo */}
      <div style={{
        height: 'var(--topbar-h)',
        display: 'flex', alignItems: 'center',
        padding: expanded ? '0 16px' : '0',
        justifyContent: expanded ? 'flex-start' : 'center',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0, gap: 10,
      }}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 30, height: 30, objectFit: 'contain' }} />
          : <CmgMark size={30} />
        }
        {expanded && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brandName ?? 'CMG Track'}
          </span>
        )}
      </div>

      {/* Search */}
      {expanded && (
        <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
          <Input
            size="sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            prefix={<SearchIcon />}
            style={{ borderRadius: 'var(--r-md)' }}
          />
        </div>
      )}

      {/* Nav */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {filtered ? (
          <div style={{ padding: '0 8px' }}>
            {filtered.map(item => <SidebarItem key={item.to} item={item} expanded={expanded} />)}
            {filtered.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--fg-dim)', padding: '8px 6px' }}>Sin resultados</p>
            )}
          </div>
        ) : (
          sections.map(section => {
            if (section.items.length === 0) return null
            return (
              <div key={section.label} style={{ marginBottom: 8 }}>
                {expanded && (
                  <p style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                    padding: '8px 20px 4px', margin: 0,
                  }}>
                    {section.label}
                  </p>
                )}
                <div style={{ padding: '0 8px' }}>
                  {section.items.map(item => <SidebarItem key={item.to} item={item} expanded={expanded} />)}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Toggle */}
      <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={toggle}
          title={expanded ? 'Colapsar menú' : 'Expandir menú'}
          style={{
            width: '100%', height: 40,
            display: 'flex', alignItems: 'center',
            justifyContent: expanded ? 'flex-end' : 'center',
            padding: expanded ? '0 16px' : '0',
            background: 'transparent', border: 'none',
            color: 'var(--fg-dim)', cursor: 'pointer', fontSize: 16,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-tertiary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)' }}
        >
          {expanded ? '‹' : '›'}
        </button>

        {/* User footer */}
        <div style={{
          padding: expanded ? '10px 12px' : '10px 0',
          borderTop: '1px solid var(--border-soft)',
          display: 'flex', alignItems: 'center',
          gap: 10, justifyContent: expanded ? 'flex-start' : 'center',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'var(--cmg-teal-soft)', color: 'var(--cmg-teal)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
          }}>
            {initials}
          </div>
          {expanded && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--fg-secondary)',
                  margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {user?.email}
                </p>
                <Chip color={ROLE_COLORS[user?.role ?? 'viewer'] ?? 'var(--fg-dim)'} soft size="sm">
                  {user?.role ?? 'viewer'}
                </Chip>
              </div>
              <button
                onClick={logout}
                title="Cerrar sesión"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-dim)', padding: 4, flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
