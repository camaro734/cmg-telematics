export type BadgeVariant = 'online' | 'offline' | 'pto' | 'warn' | 'crit'

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string; label: string }> = {
  online:  { bg: 'var(--ok-soft)',        color: 'var(--ok)',        label: 'EN LÍNEA' },
  offline: { bg: 'var(--offline-soft)',   color: 'var(--offline)',   label: 'OFFLINE' },
  pto:     { bg: 'var(--cmg-teal-soft)',  color: 'var(--cmg-teal)', label: 'PTO' },
  warn:    { bg: 'var(--warn-soft)',      color: 'var(--warn)',      label: 'ADVERTENCIA' },
  crit:    { bg: 'var(--danger-soft)',    color: 'var(--danger)',    label: 'CRÍTICO' },
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
      fontFamily: 'var(--font-sans)',
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
