interface TabItem {
  id: string
  label: string
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onTabChange: (id: string) => void
}

export default function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--bg-border)',
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            style={{
              padding: '8px 20px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              letterSpacing: '0.05em',
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: isActive
                ? '2px solid var(--accent-energy)'
                : '2px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
              outline: 'none',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
