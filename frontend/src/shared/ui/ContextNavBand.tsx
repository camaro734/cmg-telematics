import type { ComponentType } from 'react'
import { useIsMobile } from '../../lib/useIsMobile'

export interface ContextNavTab {
  key: string
  label: string
  icon?: string                                          // clase CSS, e.g. 'ti-chart-bar'
  Icon?: ComponentType<{ width?: number; height?: number }>  // componente SVG (Mantenimiento, Alertas)
  count?: number                                         // badge numérico opcional
}

interface ContextNavBandProps {
  tabs: ContextNavTab[]
  activeKey: string
  onChange: (key: string) => void
  offsetPx?: number  // desplazamiento izq. del segmentado en escritorio; 0 en móvil
}

export default function ContextNavBand({ tabs, activeKey, onChange, offsetPx = 0 }: ContextNavBandProps) {
  const isMobile = useIsMobile()

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-card)',
      flexShrink: 0,
      padding: '8px 20px',
    }}>
      <div style={{
        display: 'inline-flex',
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 3,
        gap: 2,
        marginLeft: isMobile ? 0 : offsetPx,
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
    </div>
  )
}
