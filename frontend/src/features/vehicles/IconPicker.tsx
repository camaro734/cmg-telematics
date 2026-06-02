import { useState, useMemo } from 'react'

// Catálogo curado de iconos Tabler para bloques de sistemas industriales
export const ICON_CATALOG: { key: string; label: string }[] = [
  { key: 'ti-engine',           label: 'Motor' },
  { key: 'ti-bolt',             label: 'Eléctrico' },
  { key: 'ti-gas-station',      label: 'Combustible' },
  { key: 'ti-droplet',          label: 'Líquido' },
  { key: 'ti-wind',             label: 'Neumático' },
  { key: 'ti-ripple',           label: 'Vacío/Depresor' },
  { key: 'ti-arrows-right-left','label': 'Hidráulico' },
  { key: 'ti-rotate-clockwise', label: 'Cepillos/Rotación' },
  { key: 'ti-box-model',        label: 'Compactador' },
  { key: 'ti-map-pin',          label: 'Localización' },
  { key: 'ti-shield',           label: 'Seguridad' },
  { key: 'ti-tool',             label: 'Mantenimiento' },
  { key: 'ti-battery',          label: 'Batería' },
  { key: 'ti-gauge',            label: 'Presión/Medidor' },
  { key: 'ti-thermometer',      label: 'Temperatura' },
  { key: 'ti-activity',         label: 'Actividad/PTO' },
  { key: 'ti-truck',            label: 'Vehículo' },
  { key: 'ti-settings',         label: 'Configuración' },
  { key: 'ti-alarm',            label: 'Alarma' },
  { key: 'ti-wifi',             label: 'Conectividad' },
  { key: 'ti-clock',            label: 'Tiempo/Horas' },
  { key: 'ti-chart-bar',        label: 'Estadísticas' },
  { key: 'ti-water',            label: 'Agua/Cisterna' },
  { key: 'ti-flame',            label: 'Temperatura alta' },
  { key: 'ti-lock',             label: 'Bloqueo/Control' },
  { key: 'ti-refresh',          label: 'Ciclos' },
  { key: 'ti-cpu',              label: 'CAN/ECU' },
  { key: 'ti-circle-check',     label: 'Estado OK' },
  { key: 'ti-circle-x',        label: 'Fallo' },
  { key: 'ti-info-circle',      label: 'Info' },
]

interface Props {
  value: string
  onChange: (icon: string) => void
}

export default function IconPicker({ value, onChange }: Props) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(
    () => search.trim()
      ? ICON_CATALOG.filter(i =>
          i.label.toLowerCase().includes(search.toLowerCase()) ||
          i.key.toLowerCase().includes(search.toLowerCase())
        )
      : ICON_CATALOG,
    [search]
  )

  const selected = ICON_CATALOG.find(i => i.key === value)

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
          color: 'var(--fg-primary)', fontSize: 13, width: '100%',
        }}
      >
        <i className={`ti ${value}`} style={{ fontSize: 16, color: 'var(--cmg-teal)' }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{selected?.label ?? value}</span>
        <span style={{ color: 'var(--offline)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          data-testid="icon-picker-dropdown"
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 100,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 12, width: 280, marginTop: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <input
            autoFocus
            placeholder="Buscar icono…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '5px 8px', color: 'var(--fg-primary)',
              fontSize: 12, marginBottom: 10, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
            {filtered.map(icon => (
              <button
                key={icon.key}
                type="button"
                title={icon.label}
                onClick={() => { onChange(icon.key); setOpen(false); setSearch('') }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', border: 'none',
                  background: icon.key === value ? 'color-mix(in srgb, var(--cmg-teal) 20%, transparent)' : 'transparent',
                  outline: icon.key === value ? '1px solid var(--cmg-teal)' : 'none',
                  color: 'var(--fg-primary)',
                }}
              >
                <i className={`ti ${icon.key}`} style={{ fontSize: 18 }} />
                <span style={{ fontSize: 9, color: 'var(--offline)', lineHeight: 1.2, textAlign: 'center' }}>
                  {icon.label}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <span style={{ gridColumn: '1 / -1', color: 'var(--offline)', fontSize: 12, textAlign: 'center', padding: 8 }}>
                Sin resultados
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
