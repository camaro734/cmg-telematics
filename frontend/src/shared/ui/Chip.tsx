import React from 'react'

interface ChipProps {
  children: React.ReactNode
  color?: string
  soft?: boolean
  dot?: boolean
  size?: 'sm' | 'md'
  onClick?: () => void
}

export function Chip({
  children,
  color = 'var(--fg-tertiary)',
  soft,
  dot,
  size = 'md',
  onClick,
}: ChipProps) {
  const padding = size === 'sm' ? '2px 7px' : '3px 9px'
  const fontSize = size === 'sm' ? 10 : 11
  const bg = soft ? `${color}22` : 'rgba(255,255,255,0.04)'
  const border = soft ? `1px solid ${color}44` : '1px solid var(--border)'

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding, fontSize, fontWeight: 600, borderRadius: 9999,
        color, background: bg, border,
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap', userSelect: 'none',
        lineHeight: 1.4,
      }}
    >
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: color, flexShrink: 0, display: 'inline-block',
        }} />
      )}
      {children}
    </span>
  )
}
