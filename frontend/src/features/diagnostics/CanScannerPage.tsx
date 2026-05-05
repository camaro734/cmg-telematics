import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { exportToCsv } from '../../lib/csvExport'
import { keys } from '../../lib/queryKeys'
import type { TenantOut, VehicleOut, VehicleTypeOut, SensorDef } from '../../lib/types'
import { AVL_NAMES } from '../../lib/avlNames'

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
  const queryClient = useQueryClient()
  const [tenantId, setTenantId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [, setTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Forzar re-render cada 30s para actualizar el indicador de antigüedad
  useEffect(() => {
    tickRef.current = setInterval(() => setTick(t => t + 1), 30_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])
  const [labelingKey, setLabelingKey] = useState<string | null>(null)
  const [labelMode, setLabelMode] = useState<'numeric' | 'bits'>('numeric')
  const [labelForm, setLabelForm] = useState({ label: '', unit: '' })
  const [bitForms, setBitForms] = useState<{ label: string; enabled: boolean }[]>(
    Array.from({ length: 8 }, () => ({ label: '', enabled: false }))
  )

  const patchSchemaMutation = useMutation({
    mutationFn: ({ id, schema }: { id: string; schema: SensorDef[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${id}/sensor-schema`, { sensor_schema: schema }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.vehicleTypes(), (old: VehicleTypeOut[] | undefined) =>
        old?.map(vt => vt.id === updated.id ? updated : vt) ?? [updated]
      )
      setLabelingKey(null)
    },
  })

  function openLabelModal(key: string) {
    // Pre-populate from existing sensor_schema if already defined
    const avlNum = parseInt(key.replace('avl_', ''))
    const existing = vehicleType?.sensor_schema ?? []
    const bitDefs = existing.filter(s => s.avl_id === avlNum && s.bit_index !== undefined)
    const numericDef = existing.find(s => s.avl_id === avlNum && s.bit_index === undefined)
    if (bitDefs.length) {
      const forms = Array.from({ length: 8 }, (_, i) => {
        const d = bitDefs.find(b => b.bit_index === i)
        return d ? { label: d.label, enabled: true } : { label: '', enabled: false }
      })
      setBitForms(forms)
      setLabelMode('bits')
    } else {
      setLabelForm({ label: numericDef?.label ?? '', unit: numericDef?.unit ?? '' })
      setLabelMode('numeric')
      setBitForms(Array.from({ length: 8 }, () => ({ label: '', enabled: false })))
    }
    setLabelingKey(key)
  }

  function saveLabel() {
    if (!vehicleType || !labelingKey) return
    const avlNum = parseInt(labelingKey.replace('avl_', ''))
    const existing = vehicleType.sensor_schema ?? []

    if (labelMode === 'numeric') {
      if (!labelForm.label.trim()) return
      const newDef: SensorDef = {
        key: labelingKey,
        label: labelForm.label.trim(),
        unit: labelForm.unit.trim() || null,
        avl_id: avlNum,
        gauge_type: 'numeric',
      }
      const updated = [...existing.filter(s => s.avl_id !== avlNum || s.bit_index !== undefined), newDef]
      patchSchemaMutation.mutate({ id: vehicleType.id, schema: updated })
    } else {
      const activeBits = bitForms.filter(b => b.enabled && b.label.trim())
      if (!activeBits.length) return
      const newDefs: SensorDef[] = bitForms
        .flatMap((b, i) => b.enabled && b.label.trim() ? [{
          key: `${labelingKey}_bit${i}`,
          label: b.label.trim(),
          unit: '0/1',
          avl_id: avlNum,
          bit_index: i,
          gauge_type: 'led' as const,
        }] : [])
      const updated = [...existing.filter(s => s.avl_id !== avlNum || s.bit_index === undefined), ...newDefs]
      patchSchemaMutation.mutate({ id: vehicleType.id, schema: updated })
    }
  }

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
    color: 'var(--text-primary)',
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
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: vehicleId ? 'pointer' : 'not-allowed' }}
          >
            ↻ Actualizar
          </button>

          <button
            onClick={() => setAutoRefresh(a => !a)}
            disabled={!vehicleId}
            style={{
              background: autoRefresh ? 'var(--accent-ok)' : 'var(--bg-elevated)',
              color: autoRefresh ? '#fff' : 'var(--text-primary)',
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
              style={{ padding: '6px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
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

        {labelingKey && vehicleType && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 420, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Etiquetar{' '}
                <span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent-energy)' }}>{labelingKey}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--accent-off)', lineHeight: 1.5 }}>
                Tipo de vehículo: <strong style={{ color: 'var(--text-primary)' }}>{vehicleType.name}</strong>.
                Los nombres serán visibles en todos los vehículos de este tipo.
              </div>

              {/* Selector de modo */}
              <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--bg-border)' }}>
                {(['numeric', 'bits'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setLabelMode(mode)}
                    style={{
                      flex: 1, padding: '7px 0', fontSize: 12, border: 'none', cursor: 'pointer',
                      background: labelMode === mode ? 'var(--accent-energy)' : 'var(--bg-elevated)',
                      color: labelMode === mode ? '#fff' : 'var(--accent-off)',
                      fontWeight: labelMode === mode ? 600 : 400,
                    }}
                  >
                    {mode === 'numeric' ? 'Valor numérico' : 'Campo de bits (ON/OFF)'}
                  </button>
                ))}
              </div>

              {labelMode === 'numeric' ? (
                <>
                  <input
                    autoFocus
                    placeholder="Nombre del sensor (ej. Presión hidráulica)"
                    value={labelForm.label}
                    onChange={e => setLabelForm(f => ({ ...f, label: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && saveLabel()}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '7px 10px', fontSize: 13 }}
                  />
                  <input
                    placeholder="Unidad (ej. bar, °C, %) — opcional"
                    value={labelForm.unit}
                    onChange={e => setLabelForm(f => ({ ...f, unit: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && saveLabel()}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '7px 10px', fontSize: 13 }}
                  />
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--accent-off)', marginBottom: 2 }}>
                    Activa los bits que quieras etiquetar (bit 0 = bit menos significativo):
                  </div>
                  {bitForms.map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={b.enabled}
                        onChange={e => setBitForms(f => f.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))}
                        style={{ accentColor: 'var(--accent-energy)', width: 14, height: 14, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-data)', color: 'var(--accent-off)', width: 34, flexShrink: 0 }}>
                        bit {i}
                      </span>
                      <input
                        disabled={!b.enabled}
                        placeholder={`Nombre (ej. Válvula ${i + 1} abierta)`}
                        value={b.label}
                        onChange={e => setBitForms(f => f.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                        style={{
                          flex: 1, background: 'var(--bg-elevated)', color: b.enabled ? 'var(--text-primary)' : 'var(--accent-off)',
                          border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px', fontSize: 12,
                          opacity: b.enabled ? 1 : 0.4,
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {patchSchemaMutation.isError && (
                <div style={{ fontSize: 11, color: 'var(--accent-crit)' }}>{(patchSchemaMutation.error as Error).message}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setLabelingKey(null)}
                  style={{ padding: '6px 14px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--bg-border)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={saveLabel}
                  disabled={patchSchemaMutation.isPending || (labelMode === 'numeric' ? !labelForm.label.trim() : !bitForms.some(b => b.enabled && b.label.trim()))}
                  style={{ padding: '6px 14px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600, opacity: patchSchemaMutation.isPending ? 0.7 : 1 }}
                >
                  {patchSchemaMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {latest && (() => {
          const ageMs = Date.now() - new Date(latest.time).getTime()
          const ageSec = Math.floor(ageMs / 1000)
          const ageMin = Math.floor(ageSec / 60)
          const ageLabel = ageSec < 60 ? 'hace menos de 1 min'
            : ageMin === 1 ? 'hace 1 min'
            : `hace ${ageMin} min`
          const ageColor = ageSec < 120 ? 'var(--accent-ok)'
            : ageSec < 600 ? 'var(--accent-warn)'
            : 'var(--accent-crit)'
          const isStale = ageSec >= 300   // > 5 min
          const isVeryStale = ageSec >= 600 // > 10 min
          return (
          <>
            {/* Banner de datos obsoletos */}
            {isStale && (
              <div style={{
                background: isVeryStale ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)',
                border: `1px solid ${isVeryStale ? 'var(--accent-crit)' : 'var(--accent-warn)'}`,
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: 13,
                color: isVeryStale ? 'var(--accent-crit)' : 'var(--accent-warn)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 16 }}>{isVeryStale ? '🔴' : '⚠️'}</span>
                <span>
                  <strong>Datos desactualizados ({ageLabel}).</strong>{' '}
                  {isVeryStale
                    ? 'El PLC o el dispositivo GPS probablemente está apagado o sin conexión.'
                    : 'El dispositivo no ha enviado datos recientes. Verifica la conexión.'}
                </span>
              </div>
            )}

            {/* Live snapshot */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: 16, opacity: isVeryStale ? 0.75 : 1 }}>
              <div style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>ESTADO ACTUAL — {new Date(latest.time).toLocaleString('es-ES')}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: ageColor,
                  background: `${ageColor}18`, border: `1px solid ${ageColor}`,
                  borderRadius: 4, padding: '1px 7px',
                }}>
                  {ageLabel}
                </span>
                {vehicleType && (
                  <span style={{ color: 'var(--accent-energy)', fontWeight: 400 }}>
                    Tipo: {vehicleType.name}
                  </span>
                )}
              </div>

              {/* Standard fields */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
                <Badge on={latest.ignition} label="Ignición" />
                <Badge on={latest.pto_active} label="PTO" />
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  Velocidad: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.speed_kmh?.toFixed(0) ?? '—'} km/h</strong>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  Voltaje ext: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.ext_voltage_mv != null ? `${(latest.ext_voltage_mv / 1000).toFixed(2)} V` : '—'}</strong>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  GPS: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.lat != null ? `${latest.lat.toFixed(5)}, ${latest.lon?.toFixed(5)}` : '—'}</strong>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  Altitud: <strong style={{ fontFamily: 'var(--font-data)' }}>{latest.altitude_m != null ? `${latest.altitude_m} m` : '—'}</strong>
                </span>
              </div>

              {/* CAN data grid */}
              {allCanKeys.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, opacity: isStale ? 0.7 : 1 }}>
                  {allCanKeys.map(key => {
                    const raw = latest.can_data[key]
                    const items = raw !== undefined ? resolveDisplayItems(key, raw, sensorsByAvlId) : []
                    return items.map((item, itemIdx) => (
                      <div key={`${key}-${itemIdx}`} style={{
                        background: 'var(--bg-elevated)',
                        border: `1px solid ${isVeryStale ? 'var(--bg-border)'
                          : raw !== undefined
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
                                 : item.source === 'std' ? 'var(--text-primary)'
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
                            <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-data)', color: 'var(--text-primary)' }}>
                              {raw !== undefined ? item.value.toFixed(item.value % 1 !== 0 ? 2 : 0) : '—'}
                            </span>
                          )}
                          {item.unit && <span style={{ fontSize: 10, color: 'var(--accent-off)' }}>{item.unit}</span>}
                        </div>
                        {item.source === 'raw' && vehicleType && (
                          <button
                            onClick={() => openLabelModal(key)}
                            style={{ fontSize: 9, color: 'var(--accent-info)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2, textAlign: 'left' }}
                          >
                            ✎ etiquetar
                          </button>
                        )}
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
          )
        })()}
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
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
}
