import type { ComponentType, ReactNode } from 'react'

export interface ContextNavTab {
  key: string
  label: string
  icon?: string                                               // clase CSS, e.g. 'ti-chart-bar'
  Icon?: ComponentType<{ width?: number; height?: number }>  // componente SVG (Mantenimiento, Alertas)
  count?: number                                              // badge numérico opcional
}

interface ContextNavBandProps {
  tabs: ContextNavTab[]
  activeKey: string
  onChange: (key: string) => void
  leftSlot?: ReactNode   // control contextual antes del segmentado (extremo izquierdo)
  rightSlot?: ReactNode  // controles contextuales alineados a la derecha de la barra
}

export default function ContextNavBand({ tabs, activeKey, onChange, leftSlot, rightSlot }: ContextNavBandProps) {
  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-card)',
      flexShrink: 0,
      padding: '8px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>

      {/* leftSlot — extremo izquierdo (selector de vehículo, etc.) */}
      {leftSlot}

      {/* Segmentado */}
      <div style={{
        display: 'inline-flex',
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 3,
        gap: 2,
        flexShrink: 0,
      }}>
        {tabs.map(({ key, label, icon, Icon, count }) => {
          const active = key === activeKey
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 7,
                border: 'none',
                background: active ? 'var(--cmg-teal)' : 'transparent',
                color: active ? 'var(--bg-base)' : 'var(--fg-muted)',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {Icon
                ? <Icon width={15} height={15} />
                : icon
                  ? <i className={`ti ${icon}`} style={{ fontSize: 15 }} />
                  : null
              }
              {label}
              {count != null && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: active ? 'rgba(255,255,255,0.25)' : 'var(--bg-elevated)',
                  color: 'inherit',
                  borderRadius: 8,
                  padding: '1px 5px',
                  marginLeft: 2,
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* rightSlot — toma el espacio restante; pdfSlot dentro usa marginLeft:auto para ir al extremo */}
      {rightSlot && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          minWidth: 0,
        }}>
          {rightSlot}
        </div>
      )}

    </div>
  )
}
