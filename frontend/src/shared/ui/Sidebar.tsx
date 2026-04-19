import { NavLink } from 'react-router-dom'
import logo from '../../assets/logo.png'

const NAV_ITEMS = [
  { to: '/fleet', icon: '🚛', label: 'Flota', active: true },
  { to: '/alerts', icon: '🔔', label: 'Alertas', active: false },
  { to: '/rules', icon: '⚙️', label: 'Reglas', active: false },
]

export default function Sidebar() {
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
      {/* Logo — triangle mark only (left crop of horizontal logo) */}
      <div style={{ width: 40, height: 26, marginBottom: 16, overflow: 'hidden', borderRadius: 4 }}>
        <img
          src={logo}
          alt="CMG Hidráulica"
          style={{ height: 26, width: 'auto', display: 'block' }}
        />
      </div>

      {NAV_ITEMS.map(({ to, icon, label, active }) =>
        active ? (
          <NavLink
            key={to}
            to={to}
            title={label}
            style={({ isActive }) => ({
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
              background: isActive ? 'rgba(110,197,177,0.15)' : 'transparent',
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              transition: 'background 0.15s',
            })}
          >
            {icon}
          </NavLink>
        ) : (
          <div
            key={to}
            title={`${label} — disponible en próxima versión`}
            style={{
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
              color: 'var(--bg-border)',
              cursor: 'not-allowed',
            }}
          >
            {icon}
          </div>
        )
      )}

      {/* Settings stub at bottom */}
      <div style={{ marginTop: 'auto' }}>
        <div
          title="Ajustes — disponible en próxima versión"
          style={{
            width: 36, height: 36,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
            color: 'var(--bg-border)',
            cursor: 'not-allowed',
          }}
        >⚙</div>
      </div>
    </nav>
  )
}
