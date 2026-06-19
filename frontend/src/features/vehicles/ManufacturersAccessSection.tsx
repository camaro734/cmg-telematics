import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { toast } from '../../shared/ui/Toast'
import type { VehicleTypeOut, TenantOut } from '../../lib/types'

// Asigna qué fabricantes ven esta plantilla en el desplegable de creación de
// vehículos. Lista blanca estricta: sin asignación, el fabricante no la ve.
// Solo CMG admin renderiza esta sección (gateada en VehicleTypesPage).
export default function ManufacturersAccessSection({
  typeId,
  selectedType,
}: {
  typeId: string
  selectedType: VehicleTypeOut
}) {
  const qc = useQueryClient()

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 60_000,
  })
  const manufacturers = tenants.filter(t => t.tier === 'manufacturer')

  const [selected, setSelected] = useState<Set<string>>(
    new Set(selectedType.manufacturer_ids ?? []),
  )

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}`, { manufacturer_ids: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      toast.success('Fabricantes con acceso actualizados')
    },
    onError: (err: Error) => toast.error(err.message || 'No se pudo guardar la asignación'),
  })

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const initial = new Set(selectedType.manufacturer_ids ?? [])
  const dirty =
    initial.size !== selected.size || [...selected].some(id => !initial.has(id))

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 4 }}>
        Fabricantes con acceso
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
        Los fabricantes marcados (y sus clientes) verán esta plantilla al crear vehículos. Si no marcas
        ninguno, solo CMG y los clientes directos de CMG pueden usarla.
      </div>

      {manufacturers.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No hay fabricantes registrados.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {manufacturers.map(m => (
            <label
              key={m.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
            >
              <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
              <span style={{ color: 'var(--fg-primary)' }}>{m.name}</span>
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate([...selected])}
          style={{
            background: dirty ? 'var(--cmg-teal)' : 'var(--bg-elevated)',
            color: dirty ? '#fff' : 'var(--fg-muted)',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: dirty && !saveMutation.isPending ? 'pointer' : 'default',
          }}
        >
          {saveMutation.isPending ? 'Guardando…' : 'Guardar asignación'}
        </button>
      </div>
    </div>
  )
}
