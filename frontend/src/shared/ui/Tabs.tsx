import type { CSSProperties } from 'react'

export interface TabItem {
  id: string
  label: string
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onTabChange: (id: string) => void
}

const containerStyle: CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid var(--bg-border)',
}

const TAB_BASE: CSSProperties = {
  padding: '8px 20px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-ui)',
  letterSpacing: '0.05em',
  background: 'none',
  border: 'none',
  marginBottom: -1,
  cursor: 'pointer',
  outline: 'none',
  transition: 'color 0.15s',
}

export default function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div role="tablist" style={containerStyle}>
      {tabs.map(tab => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            style={{
              ...TAB_BASE,
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid var(--accent-energy)' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
