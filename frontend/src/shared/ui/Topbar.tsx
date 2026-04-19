import { useAuthStore } from '../../features/auth/useAuthStore'

interface TopbarProps {
  title: string
}

export default function Topbar({ title }: TopbarProps) {
  const { user, brandName, logout } = useAuthStore()

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: 'var(--sidebar-w)',
      right: 0,
      height: 'var(--topbar-h)',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--bg-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 12,
      zIndex: 99,
    }}>
      <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{title}</span>

      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {brandName ?? 'CMG Telematics'}
      </span>

      <span style={{
        fontSize: 12,
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-data)',
      }}>
        {user?.email}
      </span>

      <button
        onClick={logout}
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          padding: '4px 10px',
          border: '1px solid var(--bg-border)',
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        Salir
      </button>
    </header>
  )
}
