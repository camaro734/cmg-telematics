import type { CSSProperties } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

interface DeleteModal {
  rule: RuleOut
  confirmPurge: boolean
}

export default function RulesTab() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<DeleteModal | null>(null)

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
    mutationFn: ({ id, purge }: { id: string; purge: boolean }) =>
      apiClient.delete<{ archived?: boolean; alert_count?: number } | undefined>(
        `/api/v1/rules/${id}${purge ? '?purge=true' : ''}`
      ),
    onSuccess: (_, { id }) => {
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) => prev.filter(r => r.id !== id))
      setConfirmDelete(null)
      setDeleteModal(null)
    },
  })

  const handleDeleteClick = (rule: RuleOut) => {
    if (rule.alert_count > 0) {
      setDeleteModal({ rule, confirmPurge: false })
    } else {
      setConfirmDelete(rule.id)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.06em' }}>
          REGLAS DE ALERTA
        </span>
        {canManageRules && (
          <Link
            to="/rules/new"
            style={{
              padding: '6px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
              background: 'var(--cmg-teal)', border: 'none', borderRadius: 6,
              color: 'var(--bg-base)', textDecoration: 'none', fontWeight: 600,
            }}
          >
            + Nueva regla
          </Link>
        )}
      </div>

      {rules.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontSize: 13, padding: '20px 0' }}>
          Sin reglas configuradas.{' '}
          {canManageRules && (
            <Link to="/rules/new" style={{ color: 'var(--cmg-teal)' }}>Crea la primera.</Link>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nombre', 'Alcance', 'Tipo condición', 'Severidad', 'Alertas', 'Activa', ''].map(h => (
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
                    <td style={{ ...TD, color: 'var(--fg-muted)', fontFamily: 'var(--font-data)' }}>
                      {rule.alert_count > 0 ? rule.alert_count : '—'}
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
                      {canManageRules && (isConfirming ? (
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}>
                          ¿Eliminar?{' '}
                          <button
                            onClick={() => deleteMutation.mutate({ id: rule.id, purge: false })}
                            style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 }}
                          >Sí</button>
                          {' / '}
                          <button
                            onClick={() => setConfirmDelete(null)}
                            style={{ color: 'var(--fg-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 }}
                          >No</button>
                        </span>
                      ) : (
                        <>
                          <Link to={`/rules/${rule.id}`} style={{ color: 'var(--fg-muted)', marginRight: 12, fontSize: 13 }} title="Editar regla">✎</Link>
                          <button
                            onClick={() => handleDeleteClick(rule)}
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

      {/* Modal de archivo/eliminación para reglas con alertas */}
      {deleteModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setDeleteModal(null)}
        >
          <div
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 28, maxWidth: 420, width: '90%',
            }}
            onClick={e => e.stopPropagation()}
          >
            {!deleteModal.confirmPurge ? (
              <>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--fg-primary)', marginBottom: 8 }}>
                  <strong>{deleteModal.rule.name}</strong>
                </p>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', marginBottom: 20 }}>
                  Esta regla tiene <strong style={{ color: 'var(--fg-primary)' }}>{deleteModal.rule.alert_count} alertas</strong> asociadas
                  y no puede eliminarse directamente.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    onClick={() => deleteMutation.mutate({ id: deleteModal.rule.id, purge: false })}
                    disabled={deleteMutation.isPending}
                    style={{
                      padding: '9px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
                      background: 'var(--cmg-teal)', color: '#fff',
                      border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    Archivar (recomendado)
                    <span style={{ display: 'block', fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                      Desactiva la regla y oculta las alertas. Recuperable.
                    </span>
                  </button>
                  <button
                    onClick={() => setDeleteModal({ ...deleteModal, confirmPurge: true })}
                    style={{
                      padding: '9px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
                      background: 'var(--bg-card)', color: 'var(--danger)',
                      border: '1px solid var(--danger)', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    Eliminar definitivamente
                    <span style={{ display: 'block', fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                      Borra la regla y sus {deleteModal.rule.alert_count} alertas. Irreversible.
                    </span>
                  </button>
                  <button
                    onClick={() => setDeleteModal(null)}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
                      background: 'none', color: 'var(--fg-muted)', border: 'none', cursor: 'pointer',
                    }}
                  >Cancelar</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>
                  Confirmar eliminación definitiva
                </p>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', marginBottom: 20 }}>
                  Se borrarán permanentemente la regla <strong style={{ color: 'var(--fg-primary)' }}>{deleteModal.rule.name}</strong> y
                  sus <strong style={{ color: 'var(--fg-primary)' }}>{deleteModal.rule.alert_count} alertas</strong>. Esta acción no se puede deshacer.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => deleteMutation.mutate({ id: deleteModal.rule.id, purge: true })}
                    disabled={deleteMutation.isPending}
                    style={{
                      flex: 1, padding: '9px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
                      background: 'var(--danger)', color: '#fff',
                      border: 'none', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    {deleteMutation.isPending ? 'Eliminando…' : 'Confirmar eliminación'}
                  </button>
                  <button
                    onClick={() => setDeleteModal({ ...deleteModal, confirmPurge: false })}
                    style={{
                      padding: '9px 16px', fontSize: 13, fontFamily: 'var(--font-sans)',
                      background: 'var(--bg-card)', color: 'var(--fg-muted)',
                      border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                    }}
                  >Volver</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
