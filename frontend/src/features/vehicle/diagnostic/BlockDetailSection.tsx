import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../lib/types'
import { alertSensorKey } from '../../../lib/blockDiagnostics'
import { resolveRawValue, applyScaleOffset, formatSensorValue } from '../../../lib/sensorValue'
import { sensorSeverity } from '../../../lib/sensorSeverity'
import { SensorMiniChart } from './SensorMiniChart'

interface BlockDetailSectionProps {
  block: SystemBlock
  schema: SensorDef[]
  status: VehicleStatus
  derived: Record<string, number | null>
  alerts: AlertInstanceEnrichedOut[]
  vehicleId: string
}

const ZONE_VALUE_COLOR: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--fg-primary)',
  nodata: 'var(--fg-dim)',
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--accent-crit)',
  warning: 'var(--warn)',
  info: 'var(--info)',
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Crítico',
  warning: 'Aviso',
  info: 'Info',
}

export function BlockDetailSection({
  block, schema, status, derived, alerts, vehicleId,
}: BlockDetailSectionProps) {
  const sensors = block.sensor_keys
    .map(k => schema.find(s => s.key === k))
    .filter((s): s is SensorDef => s != null)

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
          fontFamily: 'var(--font-sans)', fontSize: 13,
          fontWeight: 700, color: 'var(--fg-primary)',
        }}>
          {block.name}
        </span>
      </div>

      {/* Todos los sensores del bloque */}
      {sensors.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
        }}>
          {sensors.map(sensor => {
            const raw = resolveRawValue(sensor, status, derived)
            const scaled = applyScaleOffset(raw, sensor.scale, sensor.offset)
            const zone = sensorSeverity(sensor, scaled) ?? 'nodata'
            const valueColor = ZONE_VALUE_COLOR[zone] ?? ZONE_VALUE_COLOR.nodata
            const formatted = formatSensorValue(scaled) ?? '—'
            return (
              <div
                key={sensor.key}
                data-testid="sensor-detail-card"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>
                  {sensor.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: valueColor, lineHeight: 1.1 }}>
                  {formatted}
                  {sensor.unit && (
                    <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4, color: 'var(--fg-tertiary)' }}>
                      {sensor.unit}
                    </span>
                  )}
                </div>
                {sensor.avl_id != null ? (
                  <SensorMiniChart
                    sensor={sensor}
                    vehicleId={vehicleId}
                    status={status}
                    derived={derived}
                  />
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 4, fontStyle: 'italic' }}>
                    Sin histórico
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Alertas activas del bloque */}
      {blockAlerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Alertas activas
          </div>
          {blockAlerts.map(a => (
            <div
              key={a.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--font-sans)' }}
            >
              <span style={{
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                color: SEVERITY_COLOR[a.severity] ?? 'var(--fg-muted)',
                background: `color-mix(in srgb, ${SEVERITY_COLOR[a.severity] ?? 'var(--fg-muted)'} 15%, transparent)`,
                borderRadius: 4, padding: '2px 6px',
              }}>
                {SEVERITY_LABEL[a.severity] ?? a.severity}
              </span>
              <span style={{
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', color: 'var(--fg-primary)',
              }}>
                {a.rule_name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--fg-dim)', flexShrink: 0 }}>
                {new Date(a.triggered_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
