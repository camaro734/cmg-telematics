import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { GrantOut, GrantCreate } from '../../lib/types'

const GRANT_TYPES = [
  { resource_type: 'maintenance', label: 'Registrar intervenciones de mantenimiento', allowed_actions: ['log'] },
  { resource_type: 'vehicles', label: 'Ver datos CAN (campos visibles)', allowed_actions: ['view'] },
]

interface Props { tenantId: string }

export default function GrantsSection({ tenantId }: Props) {
  const qc = useQueryClient()
  const [selectedIdx, setSelectedIdx] = useState(0)

  const { data: grants = [] } = useQuery({
    queryKey: keys.clienteGrants(tenantId),
    queryFn: () => apiClient.get<GrantOut[]>(`/api/v1/grants?grantee_id=${tenantId}`),
  })

  const createMutation = useMutation({
    mutationFn: (payload: GrantCreate) => apiClient.post<GrantOut>('/api/v1/grants', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteGrants(tenantId) }),
  })

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => apiClient.delete(`/api/v1/grants/${grantId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteGrants(tenantId) }),
  })

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Tipo', 'Acciones', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--fg-muted)', fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grants.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: '10px', color: 'var(--fg-muted)', fontSize: 13 }}>Sin grants activos</td>
            </tr>
          ) : grants.map(g => (
            <tr key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 10px', color: 'var(--fg-primary)', fontSize: 13 }}>{g.resource_type}</td>
              <td style={{ padding: '8px 10px', color: 'var(--fg-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {g.allowed_actions.join(', ')}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <button
                  onClick={() => revokeMutation.mutate(g.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}
                >
                  Revocar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={selectedIdx}
          onChange={e => setSelectedIdx(Number(e.target.value))}
          style={{
            flex: 1, padding: '7px 10px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--fg-primary)', fontSize: 13,
          }}
        >
          {GRANT_TYPES.map((g, i) => <option key={i} value={i}>{g.label}</option>)}
        </select>
        <button
          onClick={() => createMutation.mutate({
            grantee_id: tenantId,
            resource_type: GRANT_TYPES[selectedIdx].resource_type,
            allowed_actions: GRANT_TYPES[selectedIdx].allowed_actions,
          })}
          disabled={createMutation.isPending}
          style={{
            background: 'var(--cmg-teal)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Añadir
        </button>
      </div>
    </div>
  )
}
