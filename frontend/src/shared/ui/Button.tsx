import React from 'react'

interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Button({ children, onClick, type = 'button', variant = 'primary', disabled, size = 'md' }: ButtonProps) {
  const base: React.CSSProperties = {
    border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500, fontFamily: 'var(--font-sans)', transition: 'opacity 0.15s',
    opacity: disabled ? 0.5 : 1,
    padding: size === 'sm' ? '6px 14px' : '9px 20px',
    fontSize: size === 'sm' ? 12 : 14,
  }
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--cmg-teal)', color: '#fff' },
    danger:  { background: 'var(--danger)',   color: '#fff' },
    ghost:   { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border)' },
  }
  return <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>
}
