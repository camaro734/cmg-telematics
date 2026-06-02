import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../lib/types'
import { resolveRawValue } from '../../../lib/sensorValue'
import { blockDiagnostics } from '../../../lib/blockDiagnostics'
import { DiagnosticSensor } from './DiagnosticSensor'

const ZONE_BORDER: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--accent-ok)',
  nodata: 'var(--accent-off)',
}

const ZONE_TEXT: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--fg-muted)',
  nodata: 'var(--fg-dim)',
}

interface SystemBlockCardProps {
  block: SystemBlock
  schema: SensorDef[]
  status: VehicleStatus
  derived: Record<string, number | null>
  alerts: AlertInstanceEnrichedOut[]
}

export function SystemBlockCard({ block, schema, status, derived, alerts }: SystemBlockCardProps) {
  const { zone, phrase } = blockDiagnostics(block, schema, status, derived, alerts)
  const borderColor = ZONE_BORDER[zone] ?? ZONE_BORDER.ok
  const phraseColor = ZONE_TEXT[zone] ?? ZONE_TEXT.ok

  const keySensors = block.key_sensor_keys
    .map(k => schema.find(s => s.key === k))
    .filter((s): s is SensorDef => s != null)

  return (
    <div
      data-testid="system-block-card"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i
          data-testid="block-icon"
          className={`ti ${block.icon}`}
          style={{ fontSize: 16, color: borderColor, width: 18, textAlign: 'center', flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.2, overflowWrap: 'break-word', minWidth: 0 }}>
            {block.name}
          </div>
          <div
            data-testid="block-phrase"
            style={{ fontSize: 10, color: phraseColor, marginTop: 2, fontFamily: 'var(--font-sans)' }}
          >
            {phrase}
          </div>
        </div>
      </div>

      {/* Sensores clave */}
      {keySensors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keySensors.map(sensor => (
            <DiagnosticSensor
              key={sensor.key}
              sensor={sensor}
              raw={resolveRawValue(sensor, status, derived)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
