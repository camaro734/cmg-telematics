import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../lib/types'
import { alertSensorKey } from '../../../lib/blockDiagnostics'
import { resolveRawValue } from '../../../lib/sensorValue'
import { DiagnosticSensor } from './DiagnosticSensor'
import { SensorMiniChart } from './SensorMiniChart'

interface BlockDetailSectionProps {
  block: SystemBlock
  schema: SensorDef[]
  status: VehicleStatus
  derived: Record<string, number | null>
  alerts: AlertInstanceEnrichedOut[]
  vehicleId: string
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
          {sensors.map(sensor => (
            <div
              key={sensor.key}
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
              <DiagnosticSensor
                sensor={sensor}
                raw={resolveRawValue(sensor, status, derived)}
              />
              <SensorMiniChart
                sensor={sensor}
                vehicleId={vehicleId}
                status={status}
                derived={derived}
              />
            </div>
          ))}
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
