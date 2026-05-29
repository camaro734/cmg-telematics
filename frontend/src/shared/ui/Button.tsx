import React from 'react'

interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'teal'
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  leftIcon?: React.ReactNode
  full?: boolean
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  size = 'md',
  leftIcon,
  full,
}: ButtonProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    transition: 'opacity 0.15s, background 0.15s',
    opacity: disabled ? 0.5 : 1,
    width: full ? '100%' : undefined,
    ...(size === 'sm' ? { padding: '6px 14px', fontSize: 12, borderRadius: 6, gap: 6 } : {}),
    ...(size === 'md' ? { padding: '9px 20px', fontSize: 14, borderRadius: 8, gap: 8 } : {}),
    ...(size === 'lg' ? { padding: '12px 18px', fontSize: 14, borderRadius: 10, gap: 8 } : {}),
  }

  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--cmg-teal)', color: '#fff', border: '1px solid transparent' },
    secondary: { background: 'rgba(255,255,255,0.05)', color: 'var(--fg-tertiary)', border: '1px solid var(--border)' },
    danger: { background: 'var(--danger)', color: '#fff', border: '1px solid transparent' },
    ghost: { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid transparent' },
    teal: { background: 'var(--cmg-teal-soft)', color: 'var(--cmg-teal)', border: '1px solid var(--cmg-teal-line)' },
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={(e) => {
        if (disabled) return
        if (variant === 'primary') e.currentTarget.style.background = 'var(--cmg-teal-hover)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        if (variant === 'primary') e.currentTarget.style.background = 'var(--cmg-teal)'
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.filter = 'brightness(0.92)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.filter = ''
      }}
      style={{ ...base, ...variants[variant] }}
    >
      {leftIcon}
      {children}
    </button>
  )
}
