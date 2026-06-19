import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import { Input } from '../../shared/ui/Input'
import type { TenantOut } from '../../lib/types'

// Gestión CMG: concede a clientes concretos de un fabricante el permiso para accionar
// controles (DOUT / Manual CAN). Búsqueda server-side (escala a muchos clientes): no
// carga todo de golpe, filtra por nombre/slug en el backend con debounce.
export default function ClientActuationSection({ manufacturerId }: { manufacturerId: string }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const listKey = ['tenants', 'actuation', manufacturerId, debouncedQ] as const
  const { data: clients = [], isFetching } = useQuery<TenantOut[]>({
    queryKey: listKey,
    queryFn: () => {
      const params = new URLSearchParams({ manufacturer_id: manufacturerId, limit: '50' })
      if (debouncedQ) params.set('q', debouncedQ)
      return apiClient.get<TenantOut[]>(`/api/v1/tenants?${params.toString()}`)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ clientId, next }: { clientId: string; next: boolean }) =>
      apiClient.patch<TenantOut>(`/api/v1/tenants/${clientId}`, { can_actuate_controls: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants', 'actuation', manufacturerId] })
      toast.success('Permiso de controles actualizado')
    },
    onError: (err: Error) => toast.error(err.message || 'No se pudo actualizar el permiso'),
  })

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 12 }}>
        Por defecto los clientes de este fabricante solo ven telemetría. Marca aquí quién puede,
        además, accionar los controles del vehículo (salidas DOUT y comandos Manual CAN).
      </p>

      <Input
        size="sm"
        placeholder="Buscar cliente por nombre…"
        value={q}
        onChange={e => setQ(e.target.value)}
        prefix="🔍"
      />

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {clients.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '8px 0' }}>
            {isFetching ? 'Buscando…' : debouncedQ ? 'Sin resultados.' : 'Este fabricante no tiene clientes.'}
          </div>
        ) : (
          clients.map(c => {
            const pending = toggleMutation.isPending && toggleMutation.variables?.clientId === c.id
            return (
              <label
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  padding: '8px 10px', borderRadius: 6, background: 'var(--bg-card)',
                  border: '1px solid var(--border)', opacity: pending ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!c.can_actuate_controls}
                  disabled={pending}
                  onChange={e => toggleMutation.mutate({ clientId: c.id, next: e.target.checked })}
                />
                <span style={{ fontSize: 13, color: 'var(--fg-primary)' }}>{c.name}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                  {c.tier}
                </span>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
