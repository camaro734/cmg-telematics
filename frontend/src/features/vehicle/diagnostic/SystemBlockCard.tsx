import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../lib/types'
import { resolveRawValue, applyTransform, formatSensorValue } from '../../../lib/sensorValue'
import { blockDiagnostics, alertSensorKey } from '../../../lib/blockDiagnostics'
import { sensorSeverity } from '../../../lib/sensorSeverity'

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

// Color del VALOR del sensor: destacado en ok (fg-primary), acento en warn/crit.
const ZONE_VALUE: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--fg-primary)',
  nodata: 'var(--fg-dim)',
}

interface SystemBlockCardProps {
  block: SystemBlock
  schema: SensorDef[]
  status: VehicleStatus
  derived: Record<string, number | null>
  alerts: AlertInstanceEnrichedOut[]
  onDetailClick?: () => void
  isStale?: boolean
}

export function SystemBlockCard({ block, schema, status, derived, alerts, onDetailClick, isStale }: SystemBlockCardProps) {
  const { zone, phrase } = blockDiagnostics(block, schema, status, derived, alerts)
  const borderColor = isStale ? ZONE_BORDER.nodata : (ZONE_BORDER[zone] ?? ZONE_BORDER.ok)
  const phraseColor = isStale ? ZONE_TEXT.nodata : (ZONE_TEXT[zone] ?? ZONE_TEXT.ok)

  const maxShow = Math.min(block.key_count ?? 2, 2)
  const keySensors = block.key_sensor_keys
    .slice(0, maxShow)
    .map(k => schema.find(s => s.key === k))
    .filter((s): s is SensorDef => s != null)

  const blockAlertCount = alerts.filter(a => {
    const k = alertSensorKey(a, schema)
    return k !== null && block.sensor_keys.includes(k)
  }).length

  return (
    <div
      data-testid="system-block-card"
      onClick={onDetailClick}
      role={onDetailClick ? 'button' : undefined}
      tabIndex={onDetailClick ? 0 : undefined}
      onKeyDown={onDetailClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onDetailClick() } : undefined}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: onDetailClick ? 'pointer' : undefined,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i
          data-testid="block-icon"
          className={`ti ${block.icon}`}
          style={{ fontSize: 16, color: borderColor, width: 18, textAlign: 'center', flexShrink: 0 }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sensor-name)', fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.2, overflowWrap: 'break-word', minWidth: 0 }}>
            {block.name}
          </div>
          <div
            data-testid="block-phrase"
            style={{ fontSize: 'var(--fs-2xs)', color: phraseColor, marginTop: 2, fontFamily: 'var(--font-sans)' }}
          >
            {phrase}
          </div>
        </div>
        {blockAlertCount > 0 && (
          <span
            data-testid="block-alert-badge"
            style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-crit)', background: 'rgba(239,68,68,0.15)', borderRadius: 10, padding: '1px 5px', flexShrink: 0 }}
          >
            ⚠ {blockAlertCount}
          </span>
        )}
      </div>

      {/* Sensores clave — líneas compactas; minHeight reserva 2 filas para igualar altura de tarjetas */}
      {keySensors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 36 }}>
          {keySensors.map(sensor => {
            const raw = resolveRawValue(sensor, status, derived)
            const scaled = applyTransform(raw, sensor)
            const sz = sensorSeverity(sensor, scaled) ?? 'nodata'
            const dotColor = isStale ? ZONE_BORDER.nodata : (ZONE_BORDER[sz] ?? ZONE_BORDER.nodata)
            const noData = scaled === null
            const valueColor = isStale ? 'var(--fg-muted)' : (ZONE_VALUE[sz] ?? ZONE_VALUE.nodata)
            const formatted = formatSensorValue(scaled)
            return (
              <div
                key={sensor.key}
                data-testid="sensor-compact-row"
                style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-2xs)', color: 'var(--fg-muted)' }}>
                    {sensor.label}
                  </span>
                </span>
                {noData ? (
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-dim)', fontStyle: 'italic', flexShrink: 0 }}>
                    Sin datos
                  </span>
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-panel-value)', fontWeight: 600, color: valueColor, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {formatted}
                    {sensor.unit && (
                      <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 500, color: 'var(--fg-tertiary)', marginLeft: 2 }}>{sensor.unit}</span>
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
