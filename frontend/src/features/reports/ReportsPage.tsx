import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { TenantOut, VehicleOut } from '../../lib/types'

function getPreviousMonth(): { year: number; month: number } {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

const MONTHS = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export default function ReportsPage() {
  const user = useAuthStore(s => s.user)
  const isCmg = user?.tenant_tier === 'cmg'

  const previousMonth = getPreviousMonth()
  const [year, setYear] = useState(previousMonth.year)
  const [month, setMonth] = useState(previousMonth.month)
  const [tenantId, setTenantId] = useState('')
  const [vehicleIds, setVehicleIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    enabled: isCmg,
    staleTime: 60_000,
  })

  const effectiveTenantId = isCmg ? tenantId : (user?.tenant_id ?? '')

  const { data: vehicles = [] } = useQuery<VehicleOut[]>({
    queryKey: isCmg
      ? keys.vehiclesByTenant(effectiveTenantId)
      : keys.vehicles(),
    queryFn: () =>
      isCmg
        ? apiClient.get<VehicleOut[]>(`/api/v1/vehicles?tenant_id=${effectiveTenantId}`)
        : apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    enabled: !isCmg || Boolean(effectiveTenantId),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!isCmg || tenantId || tenants.length === 0) return
    const firstClient = tenants.find(t => t.tier !== 'cmg')
    if (firstClient) setTenantId(firstClient.id)
  }, [isCmg, tenants, tenantId])

  function toggleVehicle(id: string) {
    setVehicleIds(ids =>
      ids.includes(id) ? ids.filter(v => v !== id) : ids.length < 15 ? [...ids, id] : ids
    )
  }

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      vehicleIds.forEach(id => params.append('vehicle_ids', id))
      if (isCmg && effectiveTenantId) params.set('tenant_id', effectiveTenantId)
      const blob = await apiClient.getBlob(`/api/v1/reports/monthly?${params}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe-${year}-${String(month).padStart(2, '0')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) {
      console.error('report generation failed', err)
      setError('Error al generar el informe. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    width: '100%',
  } as const

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: 'var(--text-muted)',
    marginBottom: 4,
  } as const

  return (
    <Shell title="Reportes">
      <div style={{ padding: 24, maxWidth: 560 }}>
        <div style={{ marginBottom: 20, color: 'var(--text-muted)', fontSize: 13 }}>
          Genera el informe mensual de operaciones en PDF: flota, alertas, mantenimiento y mapas GPS.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tenant selector — CMG admin only */}
          {isCmg && (
            <div>
              <label style={labelStyle}>Cliente</label>
              <select
                value={tenantId}
                onChange={e => { setTenantId(e.target.value); setVehicleIds([]) }}
                style={inputStyle}
              >
                <option value="">— Selecciona un cliente —</option>
                {tenants.filter(t => t.tier !== 'cmg').map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Period */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Año</label>
              <input
                type="number"
                min={2020}
                max={2100}
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Mes</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))} style={inputStyle}>
                {MONTHS.slice(1).map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vehicle multi-select */}
          {vehicles.length > 0 && (
            <div>
              <label style={labelStyle}>
                Vehículos ({vehicleIds.length > 0 ? `${vehicleIds.length} seleccionados` : 'todos los activos, máx. 15'})
              </label>
              <div style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                maxHeight: 200,
                overflowY: 'auto',
                padding: 4,
              }}>
                {vehicles.map(v => (
                  <label
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={vehicleIds.includes(v.id)}
                      onChange={() => toggleVehicle(v.id)}
                      disabled={!vehicleIds.includes(v.id) && vehicleIds.length >= 15}
                    />
                    {v.name}
                    {v.license_plate && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {v.license_plate}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {vehicleIds.length >= 15 && (
                <div style={{ fontSize: 11, color: 'var(--accent-warn)', marginTop: 4 }}>
                  Máximo 15 vehículos por informe.
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--accent-crit)',
              color: 'var(--accent-crit)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleGenerate}
            disabled={loading || (isCmg && !effectiveTenantId)}
            style={{
              background: loading || (isCmg && !effectiveTenantId) ? 'var(--bg-elevated)' : 'var(--accent-energy)',
              color: loading || (isCmg && !effectiveTenantId) ? 'var(--text-muted)' : '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || (isCmg && !effectiveTenantId) ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Generando…' : '↓ Generar PDF'}
          </button>
        </div>
      </div>
    </Shell>
  )
}
