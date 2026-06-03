import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../lib/types'
import { resolveRawValue, applyScaleOffset, formatSensorValue } from '../../../lib/sensorValue'
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
            const scaled = applyScaleOffset(raw, sensor.scale, sensor.offset)
            const sz = sensorSeverity(sensor, scaled) ?? 'nodata'
            const dotColor = isStale ? ZONE_BORDER.nodata : (ZONE_BORDER[sz] ?? ZONE_BORDER.nodata)
            const formatted = formatSensorValue(scaled) ?? '—'
            return (
              <div
                key={sensor.key}
                data-testid="sensor-compact-row"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)' }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sensor.label}:{' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: isStale ? 'var(--fg-muted)' : 'var(--fg-primary)' }}>
                    {formatted}{sensor.unit ? ` ${sensor.unit}` : ''}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
