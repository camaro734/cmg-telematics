import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { exportToCsv } from '../../lib/csvExport'
import { keys } from '../../lib/queryKeys'
import type { TenantOut, VehicleOut, VehicleTypeOut, SensorDef } from '../../lib/types'

// Mapa de AVL IDs conocidos → nombre legible + unidad
const AVL_NAMES: Record<string, { name: string; unit: string }> = {
  avl_1:   { name: 'DIN 1', unit: '0/1' },
  avl_2:   { name: 'DIN 2', unit: '0/1' },
  avl_3:   { name: 'DIN 3', unit: '0/1' },
  avl_4:   { name: 'DIN 4', unit: '0/1' },
  avl_6:   { name: 'Dallas Temp 5', unit: '°C ×0.1' },
  avl_8:   { name: 'Dallas Temp 6', unit: '°C ×0.1' },
  avl_9:   { name: 'AIN 1', unit: 'V ×0.001' },
  avl_10:  { name: 'AIN 2', unit: 'V ×0.001' },
  avl_11:  { name: 'AIN 3', unit: 'V ×0.001' },
  avl_14:  { name: 'Engine Worktime', unit: 'min' },
  avl_16:  { name: 'Total Mileage (counted)', unit: 'm' },
  avl_17:  { name: 'Fuel Consumed (counted)', unit: 'L ×0.1' },
  avl_18:  { name: 'Fuel Rate', unit: 'L/h ×0.1' },
  avl_19:  { name: 'AdBlue Level', unit: '%' },
  avl_20:  { name: 'AdBlue Level', unit: 'L ×0.1' },
  avl_21:  { name: 'GSM Signal', unit: '0–5' },
  avl_23:  { name: 'Engine Load', unit: '%' },
  avl_24:  { name: 'Speed (CAN)', unit: 'km/h' },
  avl_25:  { name: 'Engine Temp', unit: '°C ×0.1' },
  avl_30:  { name: 'Vehicle Speed', unit: 'km/h' },
  avl_31:  { name: 'Accelerator Pedal', unit: '%' },
  avl_33:  { name: 'Fuel Consumed', unit: 'L ×0.1' },
  avl_34:  { name: 'Fuel Level', unit: 'L ×0.1' },
  avl_35:  { name: 'Engine RPM', unit: 'rpm' },
  avl_36:  { name: 'Total Mileage', unit: 'm' },
  avl_37:  { name: 'Fuel Level', unit: '%' },
  avl_66:  { name: 'External Voltage', unit: 'mV' },
  avl_67:  { name: 'Battery Voltage', unit: 'mV' },
  avl_68:  { name: 'Battery Current', unit: 'mA' },
  avl_70:  { name: 'PCB Temperature', unit: '°C ×0.1' },
  avl_71:  { name: 'GNSS Status', unit: '0–5' },
  avl_72:  { name: 'Dallas Temp 1', unit: '°C ×0.1' },
  avl_73:  { name: 'Dallas Temp 2', unit: '°C ×0.1' },
  avl_74:  { name: 'Dallas Temp 3', unit: '°C ×0.1' },
  avl_75:  { name: 'Dallas Temp 4', unit: '°C ×0.1' },
  avl_78:  { name: 'iButton', unit: '' },
  avl_79:  { name: 'Brake Switch', unit: '0/1' },
  avl_80:  { name: 'Wheel Speed (CAN)', unit: 'km/h' },
  avl_81:  { name: 'Cruise Control', unit: '0/1' },
  avl_82:  { name: 'Clutch Switch', unit: '0/1' },
  avl_83:  { name: 'PTO State (alt)', unit: '0/1' },
  avl_84:  { name: 'Accel. Pedal Pos.', unit: '%' },
  avl_85:  { name: 'Engine Load', unit: '%' },
  avl_86:  { name: 'Total Fuel Used', unit: 'L' },
  avl_87:  { name: 'Fuel Level (J1939)', unit: '%' },
  avl_88:  { name: 'Engine RPM (J1939)', unit: 'rpm' },
  avl_104: { name: 'Engine Hours', unit: 'h' },
  avl_113: { name: 'Service Distance', unit: 'km' },
  avl_127: { name: 'Coolant Temp', unit: '°C' },
  avl_135: { name: 'Fuel Rate (J1939)', unit: 'L/h' },
  avl_139: { name: 'Gross Weight', unit: 'kg' },
  avl_176: { name: 'DTC Errors Count', unit: '' },
  avl_179: { name: 'PTO State', unit: '0/1' },
  avl_180: { name: 'Digital Output 2', unit: '0/1' },
  avl_181: { name: 'GNSS PDOP', unit: '×0.1' },
  avl_182: { name: 'GNSS HDOP', unit: '×0.1' },
  avl_199: { name: 'Trip Odometer', unit: 'm' },
  avl_200: { name: 'Sleep Mode', unit: '' },
  avl_205: { name: 'GSM Cell ID', unit: '' },
  avl_206: { name: 'GSM Area Code', unit: '' },
  avl_239: { name: 'Ignition', unit: '0/1' },
  avl_240: { name: 'Movement', unit: '0/1' },
  avl_245: { name: 'AIN 4', unit: 'V ×0.001' },
}

type ResolvedSensor = {
  label: string
  unit: string
  value: number
  isBit: boolean
  source: 'custom' | 'std' | 'raw'
}

function resolveDisplayItems(
  key: string,
  raw: number,
  sensorsByAvlId: Record<number, SensorDef[]>
): ResolvedSensor[] {
  const avlNum = parseInt(key.replace('avl_', ''))
  const customs = sensorsByAvlId[avlNum]
  if (customs?.length) {
    return customs.map(def => ({
      label: def.label,
      unit: def.unit ?? '',
      value: def.bit_index !== undefined ? (raw >> def.bit_index) & 1 : (def.scale !== undefined ? raw * def.scale : raw),
      isBit: def.bit_index !== undefined,
      source: 'custom' as const,
    }))
  }
  const std = AVL_NAMES[key]
  if (std) return [{ label: std.name, unit: std.unit, value: raw, isBit: false, source: 'std' as const }]
  return [{ label: key.toUpperCase(), unit: '', value: raw, isBit: false, source: 'raw' as const }]
}

function resolveColumnHeader(key: string, sensorsByAvlId: Record<number, SensorDef[]>): string {
  const avlNum = parseInt(key.replace('avl_', ''))
  const customs = sensorsByAvlId[avlNum]
  if (customs?.length === 1) return customs[0].label
  if (customs?.length) return `${customs[0].label} (+${customs.length - 1})`
  return AVL_NAMES[key]?.name ?? key
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
    queryKey: keys.tenants(),
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

  const { data: vehicleTypes = [] } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
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

  const selectedVehicle = vehicles.find(v => v.id === vehicleId)
  const vehicleType = vehicleTypes.find(vt => vt.id === selectedVehicle?.vehicle_type_id)

  const sensorsByAvlId = useMemo((): Record<number, SensorDef[]> => {
    const map: Record<number, SensorDef[]> = {}
    for (const s of (vehicleType?.sensor_schema ?? [])) {
      if (s.avl_id === undefined) continue
      if (!map[s.avl_id]) map[s.avl_id] = []
      map[s.avl_id].push(s as SensorDef)
    }
    return map
  }, [vehicleType])

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
        const raw = r.can_data[key] ?? null
        const items = raw !== null ? resolveDisplayItems(key, raw, sensorsByAvlId) : []
        if (items.length <= 1) {
          const header = items[0]?.label ? `${items[0].label} (${key})` : key
          row[header] = items[0]?.isBit ? (items[0].value === 1 ? 'ON' : 'OFF') : (raw ?? null)
        } else {
          for (const item of items) {
            row[`${item.label} (${key})`] = item.isBit ? (item.value === 1 ? 'ON' : 'OFF') : item.value
          }
        }
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
                {vehicleType && (
                  <span style={{ marginLeft: 12, color: 'var(--accent-energy)', fontWeight: 400 }}>
                    Tipo: {vehicleType.name}
                  </span>
                )}
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
                    const raw = latest.can_data[key]
                    const items = raw !== undefined ? resolveDisplayItems(key, raw, sensorsByAvlId) : []
                    return items.map((item, itemIdx) => (
                      <div key={`${key}-${itemIdx}`} style={{
                        background: 'var(--bg-elevated)',
                        border: `1px solid ${raw !== undefined
                          ? item.source === 'custom' ? 'var(--accent-energy)'
                          : 'var(--bg-border)'
                          : 'var(--bg-border)'}`,
                        borderRadius: 6,
                        padding: '7px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 600,
                            color: item.source === 'custom' ? 'var(--accent-energy)'
                                 : item.source === 'std' ? 'var(--text-primary, #E7E5E4)'
                                 : 'var(--accent-off)',
                          }}>
                            {item.label}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--accent-off)', fontFamily: 'var(--font-data)' }}>
                            {key}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {item.isBit ? (
                            <span style={{
                              fontSize: 12, fontWeight: 700,
                              color: item.value === 1 ? 'var(--accent-ok)' : 'var(--accent-off)',
                              fontFamily: 'var(--font-data)',
                            }}>
                              {item.value === 1 ? '● ON' : '○ OFF'}
                            </span>
                          ) : (
                            <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-data)', color: 'var(--text-primary, #E7E5E4)' }}>
                              {raw !== undefined ? item.value.toFixed(item.value % 1 !== 0 ? 2 : 0) : '—'}
                            </span>
                          )}
                          {item.unit && <span style={{ fontSize: 10, color: 'var(--accent-off)' }}>{item.unit}</span>}
                        </div>
                      </div>
                    ))
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
                        <th key={k} style={th} title={k}>
                          {resolveColumnHeader(k, sensorsByAvlId)}
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
