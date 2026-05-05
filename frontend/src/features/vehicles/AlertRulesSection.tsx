import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, RuleOut } from '../../lib/types'

// ── Shared styles ──────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent-energy)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function AlertRulesSection({ typeId, selectedType }: Props) {
  const navigate = useNavigate()

  const { data: allRules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 60_000,
  })

  const typeRules = allRules.filter(
    r => r.vehicle_filter?.scope === 'type' && r.vehicle_filter?.vehicle_type_id === selectedType.id
  )

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
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-base)', borderRadius: 6, padding: '6px 10px' }}>
              <span style={{ fontSize: 12 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.severity === 'critical' ? 'var(--accent-crit)' : r.severity === 'warning' ? 'var(--accent-warn)' : 'var(--accent-info)', color: '#fff', fontWeight: 600, textTransform: 'uppercase' }}>
                  {r.severity}
                </span>
                <span style={{ fontSize: 10, color: r.active ? 'var(--accent-ok)' : 'var(--text-muted)' }}>
                  {r.active ? 'Activa' : 'Inactiva'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
