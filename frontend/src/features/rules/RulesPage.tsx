import type { CSSProperties } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { RuleOut } from '../../lib/types'

const SEVERITY_LABEL: Record<string, { label: string; color: string }> = {
  info:     { label: 'INFO',    color: 'var(--info)' },
  warning:  { label: 'AVISO',   color: 'var(--warn)' },
  critical: { label: 'CRÍTICA', color: 'var(--danger)' },
}

const SCOPE_LABEL: Record<string, string> = {
  all:     'Todos',
  vehicle: 'Vehículo',
  type:    'Tipo',
}

const TD: CSSProperties = {
  padding: '10px 12px', fontFamily: 'var(--font-sans)', fontSize: 13,
  color: 'var(--fg-primary)', borderBottom: '1px solid var(--bg-card)',
}
const TH: CSSProperties = {
  padding: '8px 12px', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)',
  letterSpacing: '0.05em', textAlign: 'left' as const,
}

export default function RulesPage() {
  const qc = useQueryClient()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.put<RuleOut>(`/api/v1/rules/${id}`, { active }),
    onSuccess: (updated) => {
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) =>
        prev.map(r => r.id === updated.id ? updated : r)
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/rules/${id}`),
    onSuccess: (_, id) => {
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) => prev.filter(r => r.id !== id))
      setConfirmDelete(null)
    },
  })

  return (
    <Shell title="Reglas">
      <div style={{ padding: 24, maxWidth: 1100, overflowY: 'auto', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.06em' }}>
            REGLAS DE ALERTA
          </span>
          {isAdmin && <Link
            to="/rules/new"
            style={{
              padding: '6px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
              background: 'var(--cmg-teal)', border: 'none', borderRadius: 6,
              color: 'var(--bg-base)', textDecoration: 'none', fontWeight: 600,
            }}
          >
            + Nueva regla
          </Link>}
        </div>

        {rules.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontSize: 13, padding: '20px 0' }}>
            Sin reglas configuradas. <Link to="/rules/new" style={{ color: 'var(--cmg-teal)' }}>Crea la primera.</Link>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Nombre', 'Alcance', 'Tipo condición', 'Severidad', 'Activa', ''].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => {
                  const sev = SEVERITY_LABEL[rule.severity] ?? { label: rule.severity, color: 'var(--fg-muted)' }
                  const isConfirming = confirmDelete === rule.id
                  return (
                    <tr key={rule.id}>
                      <td style={TD}>
                        <Link to={`/rules/${rule.id}`} style={{ color: 'var(--cmg-teal)', textDecoration: 'none' }}>
                          {rule.name}
                        </Link>
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-muted)' }}>
                        {SCOPE_LABEL[rule.vehicle_filter.scope] ?? rule.vehicle_filter.scope}
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-muted)' }}>
                        {rule.condition.type}
                      </td>
                      <td style={TD}>
                        <span style={{ color: sev.color, fontWeight: 600, fontSize: 11 }}>{sev.label}</span>
                      </td>
                      <td style={TD}>
                        <input
                          type="checkbox"
                          checked={rule.active}
                          onChange={() => toggleMutation.mutate({ id: rule.id, active: !rule.active })}
                          style={{ accentColor: 'var(--cmg-teal)', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                        {isAdmin && (isConfirming ? (
                          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}>
                            ¿Eliminar?{' '}
                            <button onClick={() => deleteMutation.mutate(rule.id)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 }}>Sí</button>
                            {' / '}
                            <button onClick={() => setConfirmDelete(null)} style={{ color: 'var(--fg-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 }}>No</button>
                          </span>
                        ) : (
                          <>
                            <Link to={`/rules/${rule.id}`} style={{ color: 'var(--fg-muted)', marginRight: 12, fontSize: 13 }} title="Editar regla">✎</Link>
                            <button
                              onClick={() => setConfirmDelete(rule.id)}
                              style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
                              title="Eliminar regla"
                            >✕</button>
                          </>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  )
}
