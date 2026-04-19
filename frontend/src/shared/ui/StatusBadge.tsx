type BadgeVariant = 'online' | 'offline' | 'pto' | 'warn' | 'crit'

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string; label: string }> = {
  online:  { bg: 'rgba(34,197,94,0.15)',  color: 'var(--accent-ok)',     label: 'EN LÍNEA' },
  offline: { bg: 'rgba(120,113,108,0.2)', color: 'var(--accent-off)',    label: 'OFFLINE' },
  pto:     { bg: 'rgba(249,115,22,0.15)', color: 'var(--accent-energy)', label: 'PTO' },
  warn:    { bg: 'rgba(234,179,8,0.15)',  color: 'var(--accent-warn)',   label: 'ADVERTENCIA' },
  crit:    { bg: 'rgba(239,68,68,0.15)',  color: 'var(--accent-crit)',   label: 'CRÍTICO' },
}

interface StatusBadgeProps {
  variant: BadgeVariant
  label?: string
  size?: 'sm' | 'md'
}

export default function StatusBadge({ variant, label, size = 'sm' }: StatusBadgeProps) {
  const s = VARIANT_STYLES[variant]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      background: s.bg,
      color: s.color,
      borderRadius: 100,
      padding: size === 'md' ? '4px 10px' : '2px 8px',
      fontSize: size === 'md' ? 12 : 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      fontFamily: 'var(--font-ui)',
    }}>
      <span style={{
        width: size === 'md' ? 7 : 5,
        height: size === 'md' ? 7 : 5,
        borderRadius: '50%',
        background: s.color,
        flexShrink: 0,
      }} />
      {label ?? s.label}
    </span>
  )
}
