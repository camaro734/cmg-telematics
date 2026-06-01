import React, { forwardRef, useState, useId } from 'react'

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  label?: string
  error?: string
  helperText?: string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  mono?: boolean
  size?: 'sm' | 'md'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, prefix, suffix, mono, size = 'md', style, id: propId, onFocus, onBlur, ...rest }, ref) => {
    const [focused, setFocused] = useState(false)
    const autoId = useId()
    const inputId = propId ?? autoId
    const descId = `${inputId}-desc`

    const isSm = size === 'sm'

    const wrapperStyle: React.CSSProperties = {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      background: 'var(--bg-elevated)',
      border: `1px solid ${error ? 'var(--danger)' : focused ? 'var(--cmg-teal)' : 'var(--border)'}`,
      borderRadius: 6,
      width: '100%',
      boxSizing: 'border-box',
      ...style,
    }

    const padV = isSm ? 5 : 8
    const padH = isSm ? 8 : 10

    const nativeInputStyle: React.CSSProperties = {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: isSm ? 'var(--fg-secondary)' : 'var(--fg-primary)',
      fontSize: isSm ? 12 : 13,
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      padding: `${padV}px ${suffix ? Math.round(padH * 0.4) : padH}px ${padV}px ${prefix ? Math.round(padH * 0.4) : padH}px`,
      boxSizing: 'border-box',
      width: '100%',
      minWidth: 0,
    }

    const hasDesc = !!error || !!helperText

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label && (
          <label htmlFor={inputId} style={{ color: 'var(--fg-muted)', fontSize: isSm ? 12 : 13 }}>
            {label}
          </label>
        )}
        <div style={wrapperStyle}>
          {prefix && (
            <span style={{ display: 'flex', alignItems: 'center', paddingLeft: padH, color: 'var(--fg-dim)', flexShrink: 0 }}>
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            style={nativeInputStyle}
            aria-invalid={error ? true : undefined}
            aria-describedby={hasDesc ? descId : undefined}
            onFocus={(e) => { setFocused(true); onFocus?.(e) }}
            onBlur={(e) => { setFocused(false); onBlur?.(e) }}
            {...rest}
          />
          {suffix && (
            <span style={{ display: 'flex', alignItems: 'center', paddingRight: padH, color: 'var(--fg-dim)', flexShrink: 0 }}>
              {suffix}
            </span>
          )}
        </div>
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

Input.displayName = 'Input'
