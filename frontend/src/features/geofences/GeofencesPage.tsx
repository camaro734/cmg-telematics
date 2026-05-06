import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { RuleOut, VehicleOut, VehicleTypeOut } from '../../lib/types'

// SVG preview of a geofence polygon (normalized lat/lon → pixel space)
function PolygonPreview({ polygon }: { polygon: [number, number][] }) {
  const W = 88, H = 64, PAD = 8
  if (polygon.length < 3) {
    return (
      <div style={{ width: W, height: H, background: 'var(--bg-elevated)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Sin forma</span>
      </div>
    )
  }
  const lats = polygon.map(p => p[0])
  const lons = polygon.map(p => p[1])
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const toXY = ([lat, lon]: [number, number]): [number, number] => {
    const x = maxLon === minLon ? W / 2 : PAD + (lon - minLon) / (maxLon - minLon) * (W - 2 * PAD)
    const y = maxLat === minLat ? H / 2 : PAD + (maxLat - lat) / (maxLat - minLat) * (H - 2 * PAD)
    return [x, y]
  }
  const projected = polygon.map(toXY)
  const points = projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} style={{ background: 'var(--bg-elevated)', borderRadius: 6, flexShrink: 0, border: '1px solid var(--bg-border)' }}>
      <polygon points={points} fill="rgba(249,115,22,0.18)" stroke="#F97316" strokeWidth="1.5" />
      {projected.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.5" fill="#F97316" />)}
    </svg>
  )
}

export default function GeofencesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: allRules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 30_000,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.rules() })
      setDeletingId(null)
    },
  })

  const geofences = allRules.filter(r => (r.condition as any)?.type === 'geofence')

  function scopeLabel(rule: RuleOut): string {
    const f = rule.vehicle_filter
    if (!f || f.scope === 'all') return 'Todos los vehículos'
    if (f.scope === 'type') {
      const vt = vehicleTypes.find(t => t.id === (f as any).vehicle_type_id)
      return `Tipo: ${vt?.name ?? (f as any).vehicle_type_id}`
    }
    if (f.scope === 'vehicle') {
      const v = vehicles.find(v => v.id === (f as any).vehicle_id)
      return `Vehículo: ${(v as any)?.name ?? (v as any)?.plate ?? (f as any).vehicle_id}`
    }
    return 'Desconocido'
  }

  function handleDelete(rule: RuleOut) {
    if (!window.confirm(`¿Eliminar la geocerca "${rule.name}"?`)) return
    setDeletingId(rule.id)
    deleteMutation.mutate(rule.id)
  }

  const btnNew: React.CSSProperties = {
    background: 'var(--accent-energy)', color: '#fff', border: 'none',
    borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }

  return (
    <Shell title="Geocercas">
      <div style={{ padding: '20px 24px', maxWidth: 820 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Geocercas</h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Zonas geográficas que generan alertas cuando un vehículo entra o sale de ellas
            </p>
          </div>
          <button style={btnNew} onClick={() => navigate('/rules/new?condition_type=geofence')}>
            + Nueva geocerca
          </button>
        </div>

        {/* Empty state */}
        {geofences.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px dashed var(--bg-border)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 12 }}>
              <polygon points="12,3 20,8 20,16 12,21 4,16 4,8" strokeDasharray="2 1.5" />
              <circle cx="12" cy="12" r="2" fill="var(--text-muted)" stroke="none" />
            </svg>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 4px' }}>No hay geocercas configuradas</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              Dibuja una zona en el mapa para monitorizar entradas y salidas de tus vehículos
            </p>
            <button style={btnNew} onClick={() => navigate('/rules/new?condition_type=geofence')}>
              + Crear primera geocerca
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {geofences.map(rule => {
              const cond = rule.condition as any
              const polygon: [number, number][] = cond.polygon ?? []
              const action: string = cond.action ?? 'enter'
              const isDeleting = deletingId === rule.id

              return (
                <div key={rule.id} style={{
                  background: 'var(--bg-surface)', borderRadius: 10,
                  border: '1px solid var(--bg-border)', padding: '14px 16px',
                  display: 'flex', gap: 14, alignItems: 'center',
                }}>
                  <PolygonPreview polygon={polygon} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{rule.name}</span>
                      <span style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase',
                        background: rule.active ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
                        color: rule.active ? 'var(--accent-ok)' : 'var(--text-muted)',
                        border: `1px solid ${rule.active ? 'rgba(34,197,94,0.4)' : 'var(--bg-border)'}`,
                      }}>
                        {rule.active ? 'Activa' : 'Inactiva'}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase',
                        background: rule.severity === 'critical' ? 'rgba(239,68,68,0.15)' : rule.severity === 'warning' ? 'rgba(234,179,8,0.15)' : 'rgba(56,189,248,0.15)',
                        color: rule.severity === 'critical' ? 'var(--accent-crit)' : rule.severity === 'warning' ? 'var(--accent-warn)' : 'var(--accent-info)',
                      }}>
                        {rule.severity}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Dispara al{' '}
                        <b style={{ color: action === 'enter' ? 'var(--accent-ok)' : 'var(--accent-warn)' }}>
                          {action === 'enter' ? 'entrar en la zona' : 'salir de la zona'}
                        </b>
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--bg-border)' }}>•</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{scopeLabel(rule)}</span>
                      <span style={{ fontSize: 10, color: 'var(--bg-border)' }}>•</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{polygon.length} vértices</span>
                    </div>
                    {rule.description && (
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>{rule.description}</p>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                      onClick={() => navigate(`/rules/${rule.id}`)}
                    >
                      Editar
                    </button>
                    <button
                      style={{ background: 'transparent', color: 'var(--accent-crit)', border: '1px solid var(--accent-crit)', borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer', fontWeight: 500, opacity: isDeleting ? 0.5 : 1 }}
                      onClick={() => handleDelete(rule)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? '...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Shell>
  )
}
