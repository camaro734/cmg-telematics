import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
import { IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes, IconClientes, IconReportes, IconDispositivos, IconCanScanner, IconVehiculos } from './icons'
import { apiClient } from '../../lib/apiClient'

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

const NAV_ITEMS = [
  { to: '/fleet',       Icon: IconFlota,         label: 'Flota',         active: true },
  { to: '/alerts',      Icon: IconAlertas,        label: 'Alertas',       active: true },
  { to: '/maintenance', Icon: IconMantenimiento,  label: 'Mantenimiento', active: true },
  { to: '/rules',       Icon: IconReglas,         label: 'Reglas',        active: true },
]

function navLinkStyle({ isActive }: { isActive: boolean }) {
  return {
    width: 36, height: 36,
    borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
    background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
    transition: 'background 0.15s, color 0.15s',
  } as const
}

export default function Sidebar() {
  const { logoUrl, brandName, user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'
  const alertCount = useActiveAlertCount()

  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: 'var(--sidebar-w)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--bg-border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: 4,
      zIndex: 100,
    }}>
      <div style={{ marginBottom: 16 }} title={brandName ?? 'CMG Telematic'}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 30, height: 30, objectFit: 'contain' }}/>
          : <CmgMark size={30}/>
        }
      </div>

      {NAV_ITEMS.map(({ to, Icon, label, active }) =>
        active ? (
          <NavLink key={to} to={to} title={label} style={navLinkStyle}>
            <div style={{ position: 'relative' }}>
              <Icon width={20} height={20}/>
              {label === 'Alertas' && alertCount > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -8,
                  background: 'var(--accent-crit)',
                  color: '#fff', borderRadius: 99,
                  fontSize: 9, fontWeight: 700, lineHeight: 1,
                  padding: '2px 4px', minWidth: 14, textAlign: 'center',
                }}>
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </div>
          </NavLink>
        ) : (
          <div
            key={to}
            title={`${label} — disponible en próxima versión`}
            style={{
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--bg-border)',
              cursor: 'not-allowed',
            }}
          >
            <Icon width={20} height={20}/>
          </div>
        )
      )}

      {isCmg && isAdmin && (
        <NavLink to="/vehiculos" title="Vehículos" style={navLinkStyle}>
          <IconVehiculos width={20} height={20}/>
        </NavLink>
      )}

      {isCmg && isAdmin && (
        <NavLink to="/tipos-vehiculo" title="Plantillas" style={navLinkStyle}>
          <IconVehiculos width={20} height={20}/>
        </NavLink>
      )}

      {isCmg && (
        <NavLink to="/clientes" title="Clientes" style={navLinkStyle}>
          <IconClientes width={20} height={20}/>
        </NavLink>
      )}

      {isCmg && (
        <NavLink to="/devices" title="Dispositivos" style={navLinkStyle}>
          <IconDispositivos width={20} height={20}/>
        </NavLink>
      )}

      {isCmg && (
        <NavLink to="/can-scanner" title="CAN Scanner" style={navLinkStyle}>
          <IconCanScanner width={20} height={20}/>
        </NavLink>
      )}

      {isAdmin && (
        <NavLink to="/reports" title="Reportes" style={navLinkStyle}>
          <IconReportes width={20} height={20}/>
        </NavLink>
      )}

      <div style={{ marginTop: 'auto' }}>
        {isAdmin && (
          <NavLink to="/settings" title="Ajustes" style={navLinkStyle}>
            <IconAjustes width={20} height={20}/>
          </NavLink>
        )}
      </div>
    </nav>
  )
}
