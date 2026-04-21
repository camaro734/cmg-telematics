import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { exportToCsv } from '../../lib/csvExport'
import type { TenantOut, VehicleOut } from '../../lib/types'

// Mapa de AVL IDs conocidos → nombre legible + unidad
const AVL_NAMES: Record<string, { name: string; unit: string }> = {
  avl_1:   { name: 'DIN 1', unit: '0/1' },
  avl_2:   { name: 'DIN 2', unit: '0/1' },
  avl_3:   { name: 'DIN 3', unit: '0/1' },
  avl_4:   { name: 'DIN 4', unit: '0/1' },
  avl_9:   { name: 'AIN 1', unit: 'V ×0.001' },
  avl_10:  { name: 'AIN 2', unit: 'V ×0.001' },
  avl_11:  { name: 'AIN 3', unit: 'V ×0.001' },
  avl_245: { name: 'AIN 4', unit: 'V ×0.001' },
  avl_24:  { name: 'Speed (GPS)', unit: 'km/h' },
  avl_66:  { name: 'External Voltage', unit: 'mV' },
  avl_70:  { name: 'PCB Temperature', unit: '°C ×0.1' },
  avl_80:  { name: 'Wheel Speed (CAN)', unit: 'km/h' },
  avl_83:  { name: 'PTO State (alt)', unit: '0/1' },
  avl_85:  { name: 'Engine Load', unit: '%' },
  avl_86:  { name: 'Total Fuel Used', unit: 'L' },
  avl_87:  { name: 'Fuel Level', unit: '%' },
  avl_88:  { name: 'Engine RPM', unit: 'rpm' },
  avl_104: { name: 'Engine Hours', unit: 'h' },
  avl_127: { name: 'Coolant Temp', unit: '°C' },
  avl_135: { name: 'Fuel Rate', unit: 'L/h' },
  avl_139: { name: 'Gross Weight', unit: 'kg' },
  avl_179: { name: 'PTO State', unit: '0/1' },
  avl_239: { name: 'Ignition', unit: '0/1' },
}

interface CanRecord {
  time: string
  lat: number | null
  lon: number | null
  speed_kmh: number | null
  heading: number | null
  altitude_m: number | null
  ignition: boolean | null
  pto_active: boolean | null
  ext_voltage_mv: number | null
  can_data: Record<string, number>
}

function Badge({ on, label }: { on: boolean | null; label: string }) {
  const color = on == null ? 'var(--accent-off)' : on ? 'var(--accent-ok)' : 'var(--accent-off)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color }}>{label}: {on == null ? '—' : on ? 'ON' : 'OFF'}</span>
    </span>
  )
}

export default function CanScannerPage() {
  const [tenantId, setTenantId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: ['tenants'],
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 60_000,
  })

  const clientTenants = tenants.filter(t => t.tier !== 'cmg')

  const { data: vehicles = [] } = useQuery<VehicleOut[]>({
    queryKey: ['vehicles', tenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles?tenant_id=${tenantId}`),
    enabled: !!tenantId,
    staleTime: 30_000,
  })

  const { data: records = [], isLoading, dataUpdatedAt } = useQuery<CanRecord[]>({
    queryKey: ['can-scan', vehicleId, refreshCount],
    queryFn: () => apiClient.get<CanRecord[]>(`/api/v1/diagnostics/can-scan?vehicle_id=${vehicleId}&limit=30`),
    enabled: !!vehicleId,
    staleTime: 0,
  })

  // Auto-refresh cada 5s
  useEffect(() => {
    if (autoRefresh && vehicleId) {
      intervalRef.current = setInterval(() => setRefreshCount(c => c + 1), 5000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, vehicleId])

  const latest = records[0] ?? null

  // Unión de todas las claves can_data vistas en los registros
  const allCanKeys = Array.from(
    new Set(records.flatMap(r => Object.keys(r.can_data)))
  ).sort((a, b) => {
    const na = parseInt(a.replace('avl_', ''))
    const nb = parseInt(b.replace('avl_', ''))
    return na - nb
  })

  function handleExport() {
    const rows = records.map(r => {
      const row: Record<string, string | number | boolean | null | undefined> = {
        time: r.time,
        lat: r.lat,
        lon: r.lon,
        speed_kmh: r.speed_kmh,
        heading: r.heading,
        altitude_m: r.altitude_m,
        ignition: r.ignition,
        pto_active: r.pto_active,
        ext_voltage_mv: r.ext_voltage_mv,
      }
      for (const key of allCanKeys) {
        const meta = AVL_NAMES[key]
        const header = meta ? `${meta.name} (${key})` : key
        row[header] = r.can_data[key] ?? null
      }
      return row
    })
    const date = new Date().toISOString().slice(0, 10)
    exportToCsv(`can_scan_${vehicleId}_${date}.csv`, rows)
  }

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)',
    color: 'var(--text-primary, #E7E5E4)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
  } as const

  return (
    <Shell title="CAN Scanner">
      <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={tenantId} onChange={e => { setTenantId(e.target.value); setVehicleId('') }} style={inputStyle}>
            <option value="">— Selecciona cliente —</option>
            {clientTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} disabled={!tenantId} style={inputStyle}>
            <option value="">— Selecciona vehículo —</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} {v.license_plate ? `(${v.license_plate})` : ''}</option>)}
          </select>

          <button
            onClick={() => setRefreshCount(c => c + 1)}
            disabled={!vehicleId}
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: vehicleId ? 'pointer' : 'not-allowed' }}
          >
            ↻ Actualizar
          </button>

          <button
            onClick={() => setAutoRefresh(a => !a)}
            disabled={!vehicleId}
            style={{
              background: autoRefresh ? 'var(--accent-ok)' : 'var(--bg-elevated)',
              color: autoRefresh ? '#fff' : 'var(--text-primary, #E7E5E4)',
              border: '1px solid var(--bg-border)',
              borderRadius: 6, padding: '6px 14px', fontSize: 13,
              cursor: vehicleId ? 'pointer' : 'not-allowed',
              fontWeight: autoRefresh ? 600 : 400,
            }}
          >
            {autoRefresh ? '⏸ Auto (5s)' : '▶ Auto (5s)'}
          </button>

          {records.length > 0 && (
            <button
              onClick={handleExport}
              style={{ padding: '6px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
            >
              Exportar CSV
            </button>
          )}

          {dataUpdatedAt > 0 && (
            <span style={{ fontSize: 11, color: 'var(--accent-off)' }}>
              Última actualización: {new Date(dataUpdatedAt).toLocaleTimeString('es-ES')}
            </span>
          )}
        </div>

        {!vehicleId && (
          <div style={{ color: 'var(--accent-off)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
            Selecciona un cliente y un vehículo para ver los datos CAN en tiempo real.
          </div>
        )}

        {vehicleId && isLoading && (
          <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>Cargando datos…</div>
        )}

        {vehicleId && !isLoading && records.length === 0 && (
          <div style={{ color: 'var(--accent-off)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
            Sin datos en las últimas 2 horas para este vehículo.
          </div>
        )}

        {latest && (
          <>
            {/* Live snapshot */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 12 }}>
                ESTADO ACTUAL — {new Date(latest.time).toLocaleString('es-ES')}
              </div>

              {/* Standard fields */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
                <Badge on={latest.ignition} label="Ignición" />
                <Badge on={latest.pto_active} label="PTO" />
                <span style={{ fontSize: 12, color: 'var(--text-primary, #E7E5E4)' }}>
                  Velocidad: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.speed_kmh?.toFixed(0) ?? '—'} km/h</strong>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary, #E7E5E4)' }}>
                  Voltaje ext: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.ext_voltage_mv != null ? `${(latest.ext_voltage_mv / 1000).toFixed(2)} V` : '—'}</strong>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary, #E7E5E4)' }}>
                  GPS: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.lat != null ? `${latest.lat.toFixed(5)}, ${latest.lon?.toFixed(5)}` : '—'}</strong>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary, #E7E5E4)' }}>
                  Altitud: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.altitude_m != null ? `${latest.altitude_m} m` : '—'}</strong>
                </span>
              </div>

              {/* CAN data grid */}
              {allCanKeys.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                  {allCanKeys.map(key => {
                    const meta = AVL_NAMES[key]
                    const value = latest.can_data[key]
                    const isNew = value !== undefined
                    return (
                      <div key={key} style={{
                        background: 'var(--bg-elevated)',
                        border: `1px solid ${isNew ? 'var(--accent-energy)' : 'var(--bg-border)'}`,
                        borderRadius: 6,
                        padding: '7px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 11, color: 'var(--accent-energy)', fontWeight: 600 }}>
                            {meta ? meta.name : key.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--accent-off)', fontFamily: 'var(--font-data)' }}>
                            {key}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-data)', color: isNew ? 'var(--text-primary, #E7E5E4)' : 'var(--accent-off)' }}>
                            {isNew ? String(value) : '—'}
                          </span>
                          {meta && <span style={{ fontSize: 10, color: 'var(--accent-off)' }}>{meta.unit}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--accent-off)' }}>
                  Sin datos can_data. Solo llegan los campos estándar (ignición, PTO, voltaje).
                  Verifica que los IO elements están activados en el Configurator del FMC650.
                </div>
              )}
            </div>

            {/* History table */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bg-border)', fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.05em' }}>
                ÚLTIMOS {records.length} REGISTROS (2 horas)
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)' }}>
                      <th style={th}>Hora</th>
                      <th style={th}>Ign</th>
                      <th style={th}>PTO</th>
                      <th style={th}>km/h</th>
                      <th style={th}>Volt (V)</th>
                      <th style={th}>Lat</th>
                      <th style={th}>Lon</th>
                      {allCanKeys.map(k => (
                        <th key={k} style={th} title={AVL_NAMES[k]?.name}>
                          {AVL_NAMES[k]?.name ?? k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--bg-elevated)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ ...td, fontFamily: 'var(--font-data)', whiteSpace: 'nowrap' }}>
                          {new Date(r.time).toLocaleTimeString('es-ES')}
                        </td>
                        <td style={{ ...td, color: r.ignition ? 'var(--accent-ok)' : 'var(--accent-off)' }}>
                          {r.ignition == null ? '—' : r.ignition ? '●' : '○'}
                        </td>
                        <td style={{ ...td, color: r.pto_active ? 'var(--accent-energy)' : 'var(--accent-off)' }}>
                          {r.pto_active == null ? '—' : r.pto_active ? '●' : '○'}
                        </td>
                        <td style={{ ...td, fontFamily: 'var(--font-data)' }}>{r.speed_kmh?.toFixed(0) ?? '—'}</td>
                        <td style={{ ...td, fontFamily: 'var(--font-data)' }}>
                          {r.ext_voltage_mv != null ? (r.ext_voltage_mv / 1000).toFixed(2) : '—'}
                        </td>
                        <td style={{ ...td, fontFamily: 'var(--font-data)' }}>{r.lat?.toFixed(5) ?? '—'}</td>
                        <td style={{ ...td, fontFamily: 'var(--font-data)' }}>{r.lon?.toFixed(5) ?? '—'}</td>
                        {allCanKeys.map(k => (
                          <td key={k} style={{ ...td, fontFamily: 'var(--font-data)' }}>
                            {r.can_data[k] !== undefined ? String(r.can_data[k]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  color: 'var(--accent-off)',
  fontWeight: 600,
  borderBottom: '1px solid var(--bg-border)',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '5px 10px',
  color: 'var(--text-primary, #E7E5E4)',
  whiteSpace: 'nowrap',
}
