import { useState, useMemo } from 'react'
import { Sparkline } from '../../shared/ui/Sparkline'
import { Chip } from '../../shared/ui/Chip'

type Filter = 'all' | 'online' | 'moving'

export interface VehicleEntry {
  id: string
  plate: string
  name?: string
  online: boolean
  moving?: boolean
  speed?: number
  speedHistory?: number[]
}

interface VehicleListPanelProps {
  vehicles: VehicleEntry[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function VehicleListPanel({ vehicles, selectedId, onSelect }: VehicleListPanelProps) {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    let list = vehicles
    if (filter === 'online') list = list.filter(v => v.online)
    if (filter === 'moving') list = list.filter(v => v.moving)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v =>
        v.plate.toLowerCase().includes(q) || (v.name ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [vehicles, filter, search])

  const statusColor = (v: VehicleEntry) => {
    if (!v.online) return 'var(--offline)'
    if (v.moving) return 'var(--cmg-teal)'
    return 'var(--ok)'
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Mostrar lista de vehículos"
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 400,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)', padding: '6px 10px',
          color: 'var(--fg-tertiary)', cursor: 'pointer',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
          <line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Flota ({vehicles.filter(v => v.online).length}/{vehicles.length})
      </button>
    )
  }

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, bottom: 0,
      width: 280, zIndex: 400,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>Vehículos</span>
          <button onClick={() => setOpen(false)} title="Colapsar panel"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-dim)', padding: 2, fontSize: 16 }}>
            ‹
          </button>
        </div>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--fg-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar matrícula..."
            style={{
              width: '100%', padding: '5px 8px 5px 26px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)', color: 'var(--fg-secondary)',
              fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'online', 'moving'] as Filter[]).map(f => (
            <Chip key={f} size="sm"
              color={filter === f ? 'var(--cmg-teal)' : 'var(--fg-dim)'}
              soft={filter === f}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'Todos' : f === 'online' ? 'En línea' : 'En mov.'}
            </Chip>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(v => (
          <button key={v.id} onClick={() => onSelect(v.id)}
            style={{
              width: '100%', padding: '9px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
              background: v.id === selectedId ? 'var(--cmg-teal-soft)' : 'transparent',
              borderLeft: v.id === selectedId ? '2px solid var(--cmg-teal)' : '2px solid transparent',
              border: 'none', borderBottom: '1px solid var(--border-soft)',
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { if (v.id !== selectedId) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { if (v.id !== selectedId) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: statusColor(v), display: 'inline-block' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.plate}
              </p>
              {v.name && (
                <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.name}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <Sparkline values={v.speedHistory ?? []} w={48} h={16}
                color={v.moving ? 'var(--cmg-teal)' : 'var(--offline)'} />
              {v.moving && v.speed != null && (
                <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
                  {v.speed} km/h
                </span>
              )}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p style={{ padding: 16, fontSize: 12, color: 'var(--fg-dim)', textAlign: 'center' }}>Sin vehículos</p>
        )}
      </div>
    </div>
  )
}
