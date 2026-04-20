import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
import { IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes, IconClientes } from './icons'

const NAV_ITEMS = [
  { to: '/fleet',       Icon: IconFlota,         label: 'Flota',         active: true },
  { to: '/alerts',      Icon: IconAlertas,        label: 'Alertas',       active: true },
  { to: '/maintenance', Icon: IconMantenimiento,  label: 'Mantenimiento', active: true },
  { to: '/rules',       Icon: IconReglas,         label: 'Reglas',        active: true },
]

export default function Sidebar() {
  const { logoUrl, brandName, user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'

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
          <NavLink
            key={to}
            to={to}
            title={label}
            style={({ isActive }) => ({
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
              transition: 'background 0.15s, color 0.15s',
            })}
          >
            <Icon width={20} height={20}/>
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

      {isCmg && (
        <NavLink
          to="/clientes"
          title="Clientes"
          style={({ isActive }) => ({
            width: 36, height: 36,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
            background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
            transition: 'background 0.15s, color 0.15s',
          })}
        >
          <IconClientes width={20} height={20}/>
        </NavLink>
      )}

      <div style={{ marginTop: 'auto' }}>
        {isAdmin ? (
          <NavLink
            to="/settings"
            title="Ajustes"
            style={({ isActive }) => ({
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
              transition: 'background 0.15s, color 0.15s',
            })}
          >
            <IconAjustes width={20} height={20}/>
          </NavLink>
        ) : null}
      </div>
    </nav>
  )
}
