type MaintStatus = 'ok' | 'próximo' | 'vencido'

const CONFIG: Record<MaintStatus, { label: string; color: string; bg: string }> = {
  ok:        { label: 'Al día',  color: 'var(--accent-ok)',   bg: 'rgba(34,197,94,0.12)'  },
  'próximo': { label: 'Próximo', color: 'var(--accent-warn)', bg: 'rgba(234,179,8,0.12)'  },
  vencido:   { label: 'Vencido', color: 'var(--accent-crit)', bg: 'rgba(239,68,68,0.12)'  },
}

interface Props {
  status: MaintStatus
  size?: 'sm' | 'md'
}

export function MaintenanceStatusBadge({ status, size = 'md' }: Props) {
  const cfg = CONFIG[status] ?? CONFIG.ok
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'sm' ? '1px 6px' : '2px 8px',
      borderRadius: 4,
      fontSize: size === 'sm' ? 10 : 11,
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      color: cfg.color,
      background: cfg.bg,
    }}>
      {cfg.label}
    </span>
  )
}
