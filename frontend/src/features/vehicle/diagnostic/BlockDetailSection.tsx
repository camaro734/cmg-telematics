import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../lib/types'
import { alertSensorKey } from '../../../lib/blockDiagnostics'
import { resolveRawValue, applyTransform, formatSensorValue, bitValue } from '../../../lib/sensorValue'
import { sortByOrder, moveItem } from '../../../lib/sensorOrder'
import { sensorSeverity } from '../../../lib/sensorSeverity'
import { SensorMiniChart } from './SensorMiniChart'
import { SensorDetailModal } from './SensorDetailModal'

interface BlockDetailSectionProps {
  block: SystemBlock
  schema: SensorDef[]
  status: VehicleStatus
  derived: Record<string, number | null>
  alerts: AlertInstanceEnrichedOut[]
  vehicleId: string
  isStale?: boolean
  /** Orden de tarjetas guardado por el usuario (keys de sensor). */
  order?: string[]
  /** Modo "Ordenar": activa arrastrar y soltar las tarjetas. */
  editMode?: boolean
  /** Se llama al soltar con el nuevo orden de keys de ESTE bloque. */
  onReorder?: (keys: string[]) => void
}

const ZONE_VALUE_COLOR: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--fg-primary)',
  nodata: 'var(--fg-dim)',
}


export function BlockDetailSection({
  block, schema, status, derived, alerts, vehicleId, isStale,
  order, editMode, onReorder,
}: BlockDetailSectionProps) {
  const [modalSensor, setModalSensor] = useState<SensorDef | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)

  const sensors = sortByOrder(
    block.sensor_keys
      .map(k => schema.find(s => s.key === k))
      .filter((s): s is SensorDef => s != null),
    order,
    s => s.key,
  )

  function handleDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey || !onReorder) { setDragKey(null); return }
    const keys = sensors.map(s => s.key)
    const from = keys.indexOf(dragKey)
    const to = keys.indexOf(targetKey)
    setDragKey(null)
    if (from === -1 || to === -1) return
    onReorder(moveItem(keys, from, to))
  }

  const blockAlerts = alerts.filter(a => {
    const key = alertSensorKey(a, schema)
    return key !== null && block.sensor_keys.includes(key)
  })

  return (
    <div
      id={`block-detail-${block.id}`}
      data-testid="block-detail-section"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        scrollMarginTop: 12,
      }}
    >
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i
          className={`ti ${block.icon}`}
          style={{ fontSize: 16, color: 'var(--cmg-teal)', width: 18, textAlign: 'center', flexShrink: 0 }}
        />
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sensor-name)',
          fontWeight: 700, color: 'var(--fg-primary)',
        }}>
          {block.name}
        </span>
      </div>

      {/* Todos los sensores del bloque */}
      {sensors.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}>
          {sensors.map(sensor => {
            const raw = resolveRawValue(sensor, status, derived)
            const scaled = applyTransform(raw, sensor)
            const zone = sensorSeverity(sensor, scaled) ?? 'nodata'
            const valueColor = isStale ? ZONE_VALUE_COLOR.nodata : (ZONE_VALUE_COLOR[zone] ?? ZONE_VALUE_COLOR.nodata)
            const formatted = formatSensorValue(scaled) ?? '—'
            return (
              <div
                key={sensor.key}
                data-testid="sensor-detail-card"
                draggable={editMode === true}
                onClick={editMode ? undefined : (sensor.avl_id != null ? () => setModalSensor(sensor) : undefined)}
                onDragStart={editMode ? () => setDragKey(sensor.key) : undefined}
                onDragOver={editMode ? (e) => e.preventDefault() : undefined}
                onDrop={editMode ? () => handleDrop(sensor.key) : undefined}
                onDragEnd={editMode ? () => setDragKey(null) : undefined}
                style={{
                  background: 'var(--bg-card)',
                  border: dragKey === sensor.key ? '1px dashed var(--cmg-teal)' : '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  cursor: editMode ? 'grab' : (sensor.avl_id != null ? 'pointer' : 'default'),
                  opacity: editMode && dragKey === sensor.key ? 0.5 : 1,
                }}
              >
                <div style={{ fontSize: 'var(--fs-sensor-name)', fontWeight: 600, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {editMode && <span style={{ color: 'var(--fg-dim)', cursor: 'grab' }}>⠿</span>}
                  {sensor.label}
                </div>
                {sensor.gauge_type === 'led' ? (() => {
                  // Sensor on/off → piloto LED (verde ON / gris OFF). Clic abre la
                  // gráfica de escalón (veces en ON + tiempo) si tiene histórico.
                  const on = bitValue(raw, sensor.bit_index)
                  const lit = !isStale && on === true
                  const dotColor = lit ? 'var(--ok)' : (isStale || on === null ? 'var(--offline)' : 'var(--fg-dim)')
                  const label = on === null ? '—' : on ? 'ON' : 'OFF'
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        background: dotColor,
                        boxShadow: lit ? '0 0 8px var(--ok)' : 'none',
                        border: '1px solid var(--border)',
                      }} />
                      <span style={{
                        fontSize: 'var(--fs-sensor-hero)', fontWeight: 700, fontFamily: 'var(--font-mono)',
                        color: lit ? 'var(--ok)' : 'var(--fg-dim)', lineHeight: 1,
                      }}>
                        {label}
                      </span>
                      {sensor.avl_id != null && !editMode && (
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)' }}>ver gráfica →</span>
                      )}
                    </div>
                  )
                })() : sensor.avl_id != null ? (
                  // Sensores CAN: SensorMiniChart renderiza valor actual + sparkline
                  <SensorMiniChart
                    sensor={sensor}
                    vehicleId={vehicleId}
                    status={status}
                    derived={derived}
                    isStale={isStale}
                  />
                ) : (
                  // Sensores de sistema (sin histórico CAN): valor + indicador
                  <>
                    <div style={{ fontSize: 'var(--fs-sensor-hero)', fontWeight: 'var(--fw-sensor-hero)' as React.CSSProperties['fontWeight'], fontFamily: 'var(--font-mono)', color: valueColor, lineHeight: 1.1 }}>
                      {formatted}
                      {sensor.unit && (
                        <span style={{ fontSize: 'var(--fs-panel-label)', fontWeight: 600, marginLeft: 4, color: 'var(--fg-tertiary)' }}>
                          {sensor.unit}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)', marginTop: 4, fontStyle: 'italic' }}>
                      Sin histórico
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalSensor && (
        <SensorDetailModal
          sensor={modalSensor}
          vehicleId={vehicleId}
          onClose={() => setModalSensor(null)}
        />
      )}

      {/* Alertas del bloque — contador clicable */}
      {blockAlerts.length > 0 ? (
        <Link
          to={`/alerts?vehicle=${vehicleId}`}
          data-testid="block-alerts-link"
          style={{ fontSize: 'var(--fs-meta)', fontWeight: 600, color: 'var(--accent-crit)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-sans)' }}
        >
          ⚠ {blockAlerts.length} alerta{blockAlerts.length > 1 ? 's' : ''} en este bloque →
        </Link>
      ) : (
        <div
          data-testid="block-no-alerts"
          style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)' }}
        >
          Sin alertas en este bloque
        </div>
      )}
    </div>
  )
}
