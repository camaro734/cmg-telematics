import { useState } from 'react'
import { useGeocode } from '../fleet/useDestination'
import type { GeoResult } from '../../lib/types'

/**
 * Autocompletado de direcciones sobre el geocoder de Valhalla (backend).
 * Reutiliza el hook `useGeocode` (mismo endpoint /api/v1/geocode que el panel de
 * flota) y expone una caja de texto + dropdown de resultados. Al elegir uno,
 * devuelve `{ label, lat, lon }` al padre.
 */
export function AddressAutocomplete({
  value, onChange, onSelect, placeholder = 'Escribe una dirección…',
}: {
  value: string
  onChange: (q: string) => void
  onSelect: (r: GeoResult) => void
  placeholder?: string
}) {
  const geocode = useGeocode()
  const [results, setResults] = useState<GeoResult[]>([])
  const [open, setOpen] = useState(false)

  async function search() {
    const q = value.trim()
    if (!q) return
    try {
      const r = await geocode.mutateAsync(q)
      setResults(r)
      setOpen(true)
    } catch {
      setResults([])
      setOpen(true)
    }
  }

  function pick(r: GeoResult) {
    onSelect(r)
    setResults([])
    setOpen(false)
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-lg)', color: 'var(--fg-primary)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 'var(--space-3) 40px var(--space-3) var(--space-4)', width: '100%',
    boxSizing: 'border-box', outline: 'none',
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(false) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
      />
      <button
        type="button"
        onClick={search}
        disabled={geocode.isPending}
        aria-label="Buscar dirección"
        style={{
          position: 'absolute', right: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cmg-teal)',
          fontSize: 'var(--fs-lg)', padding: 4, lineHeight: 1,
        }}
      >
        {geocode.isPending ? '…' : '🔍'}
      </button>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 600,
          borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)',
          background: 'var(--bg-elevated)', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lon}-${i}`}
              type="button"
              onClick={() => pick(r)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: 'var(--space-3) var(--space-4)', background: 'none',
                border: 'none', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
                color: 'var(--fg-primary)', fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)',
                cursor: 'pointer', lineHeight: 1.4,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      {open && !geocode.isPending && results.length === 0 && (
        <p style={{ margin: 'var(--space-2) 0 0', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
          Sin resultados — prueba con otra dirección.
        </p>
      )}
    </div>
  )
}
