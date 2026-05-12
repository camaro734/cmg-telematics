import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import type { VehicleTypeOut, RuleOut } from '../../lib/types'

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent-energy)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--bg-border)',
  borderRadius: 5, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
}
const btnDanger: React.CSSProperties = {
  background: 'transparent', color: 'var(--accent-crit)', border: '1px solid var(--accent-crit)',
  borderRadius: 5, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
}

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function AlertRulesSection({ typeId, selectedType }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirmAsk = useConfirm()

  const { data: allRules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => apiClient.delete(`/api/v1/rules/${ruleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rules() }),
  })

  const typeRules = allRules.filter(
    r => r.vehicle_filter?.scope === 'type' && (r.vehicle_filter as any)?.vehicle_type_id === selectedType.id
  )

  async function handleDelete(r: RuleOut) {
    const ok = await confirmAsk({
      title: 'Eliminar regla', message: `¿Eliminar la regla "${r.name}"?`,
      confirmLabel: 'Eliminar', kind: 'danger',
    })
    if (!ok) return
    deleteMutation.mutate(r.id)
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Reglas de alerta
        </span>
        <button style={btnPrimary} onClick={() => navigate(`/rules/new?type_id=${typeId}`)}>+ Nueva regla</button>
      </div>
      {typeRules.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin reglas configuradas para este tipo</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {typeRules.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-base)', borderRadius: 6, padding: '6px 10px', gap: 8 }}>
              <span style={{ fontSize: 12, flex: 1 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.severity === 'critical' ? 'var(--accent-crit)' : r.severity === 'warning' ? 'var(--accent-warn)' : 'var(--accent-info)', color: '#fff', fontWeight: 600, textTransform: 'uppercase' }}>
                  {r.severity}
                </span>
                <span style={{ fontSize: 10, color: r.active ? 'var(--accent-ok)' : 'var(--text-muted)' }}>
                  {r.active ? 'Activa' : 'Inactiva'}
                </span>
                <button style={btnGhost} onClick={() => navigate(`/rules/${r.id}`)}>Editar</button>
                <button style={btnDanger} onClick={() => handleDelete(r)} disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? '…' : 'Eliminar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
