import { useQuery } from '@tanstack/react-query'
import type { MaintenanceCounter, MaintenanceThreshold } from '../../lib/types'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

const FALLBACK_OPTIONS = [
  { value: 'pto_hours',     label: 'Horas PTO',      unit: 'horas' },
  { value: 'engine_hours',  label: 'Horas motor',     unit: 'horas' },
  { value: 'calendar_days', label: 'Días calendario', unit: 'días'  },
]

interface Props {
  thresholds: MaintenanceThreshold[]
  onChange: (thresholds: MaintenanceThreshold[]) => void
  vehicleId?: string
}

export default function ThresholdBuilder({ thresholds, onChange, vehicleId }: Props) {
  const { data: counters = [] } = useQuery<MaintenanceCounter[]>({
    queryKey: keys.maintenanceCounterTypes(vehicleId ?? ''),
    queryFn: () => apiClient.get<MaintenanceCounter[]>(`/api/v1/maintenance/counter-types/${vehicleId}`),
    enabled: Boolean(vehicleId),
    staleTime: 300_000,
  })

  const typeOptions = counters.length > 0
    ? counters.map(c => ({ value: c.type, label: c.label, unit: c.unit }))
    : FALLBACK_OPTIONS

  const unitFor = (type: string) =>
    typeOptions.find(o => o.value === type)?.unit ?? type

  const defaultType = typeOptions[0]?.value ?? 'pto_hours'

  function add() {
    onChange([...thresholds, { type: defaultType, value: 500 }])
  }

  function remove(i: number) {
    onChange(thresholds.filter((_, idx) => idx !== i))
  }

  function update(i: number, field: keyof MaintenanceThreshold, val: string) {
    const next = thresholds.map((t, idx) =>
      idx === i ? { ...t, [field]: field === 'value' ? Number(val) : val } : t
    )
    onChange(next)
  }

  return (
    <div>
      {thresholds.map((t, i) => (
        <div key={`${t.type}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Select
            value={t.type}
            onChange={e => update(i, 'type', e.target.value)}
            disabled={!vehicleId}
            title={!vehicleId ? 'Selecciona un vehículo primero' : undefined}
          >
            {typeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            {/* Preservar tipo guardado si no está en el catálogo actual */}
            {!typeOptions.find(o => o.value === t.type) && (
              <option value={t.type}>{t.type}</option>
            )}
          </Select>
          <Input
            type="number"
            value={t.value}
            min={1}
            onChange={e => update(i, 'value', e.target.value)}
            style={{ width: 90 }}
          />
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{unitFor(t.type)}</span>
          {thresholds.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}
              title="Eliminar umbral"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={!vehicleId}
        style={{
          background: 'none',
          border: '1px dashed var(--border)',
          color: 'var(--fg-muted)',
          borderRadius: 6,
          padding: '5px 12px',
          fontSize: 12,
          cursor: vehicleId ? 'pointer' : 'not-allowed',
          opacity: vehicleId ? 1 : 0.5,
        }}
      >
        + Añadir umbral
      </button>
      {!vehicleId && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-muted)' }}>
          Selecciona un vehículo para ver los contadores disponibles
        </p>
      )}
    </div>
  )
}
