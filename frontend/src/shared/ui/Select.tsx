import React, { forwardRef, useState, useId } from 'react'

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  error?: string
  helperText?: string
  size?: 'sm' | 'md'
  children: React.ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, size = 'md', style, id: propId, onFocus, onBlur, children, ...rest }, ref) => {
    const [focused, setFocused] = useState(false)
    const autoId = useId()
    const selectId = propId ?? autoId
    const descId = `${selectId}-desc`

    const isSm = size === 'sm'
    const hasDesc = !!error || !!helperText

    const selectStyle: React.CSSProperties = {
      background: 'var(--bg-elevated)',
      border: `1px solid ${error ? 'var(--danger)' : focused ? 'var(--cmg-teal)' : 'var(--border)'}`,
      borderRadius: 6,
      color: 'var(--fg-primary)',
      fontSize: isSm ? 12 : 13,
      fontFamily: 'var(--font-sans)',
      padding: isSm ? '5px 8px' : '8px 10px',
      boxSizing: 'border-box',
      width: '100%',
      cursor: 'pointer',
      outline: 'none',
      ...style,
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label && (
          <label htmlFor={selectId} style={{ color: 'var(--fg-muted)', fontSize: isSm ? 12 : 13 }}>
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          style={selectStyle}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasDesc ? descId : undefined}
          onFocus={(e) => { setFocused(true); onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); onBlur?.(e) }}
          {...rest}
        >
          {children}
        </select>
        {(error || helperText) && (
          <p id={descId} role={error ? 'alert' : undefined}
            style={{ margin: 0, fontSize: 11, color: error ? 'var(--danger)' : 'var(--fg-muted)' }}>
            {error ?? helperText}
          </p>
        )}
      </div>
    )
  }
)

Select.displayName = 'Select'
