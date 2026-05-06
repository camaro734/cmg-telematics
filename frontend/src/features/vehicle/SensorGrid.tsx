import type { SensorDef } from '../../lib/types'
import CircularGauge from '../../shared/ui/gauges/CircularGauge'
import BatteryGauge from '../../shared/ui/gauges/BatteryGauge'
import LinearGauge from '../../shared/ui/gauges/LinearGauge'
import NumericDisplay from '../../shared/ui/gauges/NumericDisplay'

interface SensorGridProps {
  sensorSchema: SensorDef[]
  canData: Record<string, unknown>
  derivedValues?: Partial<Record<string, number | null>>
}

// Sensor cuya unidad de medida son minutos → formatear como min/h
function isMinuteSensor(label: string): boolean {
  const u = label.toUpperCase()
  return u.includes('MIN') || u.includes('MINUTO')
}

// Sensor que es un contador discreto de eventos (no magnitud física)
function isCounterSensor(label: string): boolean {
  const u = label.toUpperCase()
  return u.includes('CANTIDAD') || u.includes('VECES') || u.includes('CICLO') || u.includes('CONTAD')
}

// Convierte minutos brutos a string legible: "54 min" o "1h 23 min"
function formatMinutes(minutes: number): { main: string; unit: string } {
  const rounded = Math.round(minutes)
  if (rounded < 60) return { main: String(rounded), unit: 'min' }
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  return m === 0 ? { main: String(h), unit: 'h' } : { main: `${h}h ${m}`, unit: 'min' }
}

function getSensorValue(
  sensor: SensorDef,
  canData: Record<string, unknown>,
  derived: Partial<Record<string, number | null>>,
): number | null {
  let value: number | null = null

  if (sensor.kpi_key) {
    value = derived[sensor.kpi_key] ?? null
  } else if (sensor.avl_id != null) {
    const raw = canData[`avl_${sensor.avl_id}`]
    if (typeof raw !== 'number') {
      if (import.meta.env.DEV && raw != null) {
        console.warn(`SensorGrid: avl_${sensor.avl_id} tipo inesperado "${typeof raw}"`)
      }
      return null
    }
    value = (sensor.scale != null ? raw * sensor.scale : raw) + (sensor.offset ?? 0)
  }

  if (value === null) return null

  // Valor centinela uint16 "sin dato"
  if (value === 65535) return null

  const unitU = (sensor.unit ?? '').toUpperCase()
  const labelU = sensor.label.toUpperCase()
  if ((unitU === 'RPM' || labelU.includes('RPM')) && value > 9000) return null
  if (
    (unitU === 'BAR' || labelU.includes('BAR') || labelU.includes('PRESION') || labelU.includes('PRESIÓN')) &&
    value > 500
  ) return null
  if (value < 0 && (sensor.min == null || sensor.min >= 0) && sensor.offset == null) return null

  return value
}

const sunit = (s: SensorDef) => s.unit ?? ''

// ─── Sub-componentes inline ───────────────────────────────────────────────────

// Card para contadores de tiempo: muestra "54 min" o "1h 23 min"
function TimeCard({ label, value }: { label: string; value: number | null }) {
  const fmt = value !== null ? formatMinutes(value) : null
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${fmt ? 'color-mix(in srgb, var(--accent-info) 25%, var(--bg-border))' : 'var(--bg-border)'}`,
      borderRadius: 7,
      padding: '5px 9px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      position: 'relative' as const,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 8,
          color: 'var(--text-muted)',
          letterSpacing: '0.8px',
          textTransform: 'uppercase' as const,
          lineHeight: 1.3,
          wordBreak: 'break-word' as const,
        }}>
          {label}
        </div>
        {fmt && <span className="live-dot" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{
          fontFamily: 'var(--font-data)',
          fontSize: 15,
          fontWeight: 700,
          color: fmt ? 'var(--accent-info)' : 'var(--accent-off)',
          lineHeight: 1,
        }}>
          {fmt ? fmt.main : '—'}
        </span>
        {fmt && (
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-muted)' }}>
            {fmt.unit}
          </span>
        )}
      </div>
    </div>
  )
}

// Card para contadores de eventos: muestra entero con fondo diferenciado
function CounterCard({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  const display = value !== null
    ? (Number.isInteger(value) ? String(value) : Math.round(value).toString())
    : '—'
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${value !== null ? 'color-mix(in srgb, var(--accent-energy) 25%, var(--bg-border))' : 'var(--bg-border)'}`,
      borderRadius: 7,
      padding: '5px 9px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 8,
          color: 'var(--text-muted)',
          letterSpacing: '0.8px',
          textTransform: 'uppercase' as const,
          lineHeight: 1.3,
          wordBreak: 'break-word' as const,
          textAlign: 'center' as const,
          flex: 1,
        }}>
          {label}
        </div>
        {value !== null && <span className="live-dot" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{
          fontFamily: 'var(--font-data)',
          fontSize: 15,
          fontWeight: 700,
          color: value !== null ? 'var(--accent-energy)' : 'var(--accent-off)',
          lineHeight: 1,
        }}>
          {display}
        </span>
        {unit && value !== null && (
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-muted)' }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}

// Indicador LED: badge ON/OFF horizontal
function LedIndicator({ sensor, canData }: { sensor: SensorDef; canData: Record<string, unknown> }) {
  const raw = sensor.avl_id != null ? canData[`avl_${sensor.avl_id}`] : undefined
  const num = raw != null ? Number(raw) : 0
  const active = raw != null && (sensor.bit_index != null ? ((num >> sensor.bit_index) & 1) === 1 : num === 1)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      background: 'var(--bg-elevated)',
      borderRadius: 6,
      padding: '6px 10px',
      border: `1px solid ${active ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
    }}>
      <span style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 10,
        color: 'var(--text-muted)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
        wordBreak: 'break-word' as const,
        lineHeight: 1.3,
        flex: 1,
      }}>
        {sensor.label}
      </span>
      <span style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        fontWeight: 600,
        background: active ? 'color-mix(in srgb, var(--accent-ok) 15%, transparent)' : 'transparent',
        color: active ? 'var(--accent-ok)' : 'var(--accent-off)',
        border: `1px solid ${active ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
        flexShrink: 0,
      }}>
        {active ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

const groupTitleStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: 'var(--accent-off)',
  letterSpacing: '1px',
  textTransform: 'uppercase',
  marginBottom: 8,
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--bg-elevated)',
  margin: '2px 0',
}

export default function SensorGrid({ sensorSchema, canData, derivedValues = {} }: SensorGridProps) {
  // Grupo 1: gauges visuales (circular / linear / battery)
  const visualSensors = sensorSchema.filter(
    s => s.gauge_type === 'circular' || s.gauge_type === 'linear' || s.gauge_type === 'battery',
  )
  // Grupo 2: indicadores LED ON/OFF
  const ledSensors = sensorSchema.filter(s => s.gauge_type === 'led')
  // Resto: numeric y tipos no reconocidos
  const restSensors = sensorSchema.filter(
    s => s.gauge_type !== 'circular' && s.gauge_type !== 'linear' && s.gauge_type !== 'battery' && s.gauge_type !== 'led',
  )
  // Grupo 3: contadores de tiempo (etiqueta contiene MIN/MINUTO)
  const timeSensors = restSensors.filter(s => isMinuteSensor(s.label))
  // Grupo 4: contadores de eventos discretos
  const counterSensors = restSensors.filter(s => !isMinuteSensor(s.label) && isCounterSensor(s.label))
  // Grupo 5: valores numéricos genéricos
  const numericSensors = restSensors.filter(s => !isMinuteSensor(s.label) && !isCounterSensor(s.label))

  const activeGroups = [visualSensors, ledSensors, timeSensors, counterSensors, numericSensors].filter(
    g => g.length > 0,
  ).length
  const showTitles = activeGroups > 1

  const renderVisual = (sensor: SensorDef) => {
    const value = getSensorValue(sensor, canData, derivedValues)
    if (sensor.gauge_type === 'circular') {
      return (
        <CircularGauge
          key={sensor.key}
          size={100}
          value={value}
          min={sensor.min ?? 0}
          max={sensor.max ?? 100}
          unit={sunit(sensor)}
          label={sensor.label}
          warnAbove={sensor.warn_above}
          alertAbove={sensor.alert_above}
          warnBelow={sensor.warn_below}
          alertBelow={sensor.alert_below}
        />
      )
    }
    if (sensor.gauge_type === 'battery') {
      return (
        <BatteryGauge
          key={sensor.key}
          value={value}
          min={sensor.min ?? 0}
          max={sensor.max ?? 100}
          label={sensor.label}
          unit={sunit(sensor)}
          warnBelow={sensor.warn_below}
          alertBelow={sensor.alert_below}
        />
      )
    }
    return (
      <LinearGauge
        key={sensor.key}
        value={value}
        min={sensor.min ?? 0}
        max={sensor.max ?? 100}
        unit={sunit(sensor)}
        label={sensor.label}
        warnBelow={sensor.warn_below}
        alertBelow={sensor.alert_below}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Grupo 1: Presiones y niveles — gauges uniformes en grid */}
      {visualSensors.length > 0 && (
        <div>
          {showTitles && <div style={groupTitleStyle}>Presiones y Niveles</div>}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 7,
          }}>
            {visualSensors.map(renderVisual)}
          </div>
        </div>
      )}

      {/* Grupo 2: Indicadores LED */}
      {ledSensors.length > 0 && (
        <>
          {showTitles && <div style={dividerStyle} />}
          <div>
            {showTitles && <div style={groupTitleStyle}>Indicadores</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ledSensors.map(s => <LedIndicator key={s.key} sensor={s} canData={canData} />)}
            </div>
          </div>
        </>
      )}

      {/* Grupo 3: Contadores de tiempo — cards con valor min/h */}
      {timeSensors.length > 0 && (
        <>
          {showTitles && <div style={dividerStyle} />}
          <div>
            {showTitles && <div style={groupTitleStyle}>Contadores de Tiempo</div>}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 6,
            }}>
              {timeSensors.map(s => (
                <TimeCard
                  key={s.key}
                  label={s.label}
                  value={getSensorValue(s, canData, derivedValues)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Grupo 4: Contadores de eventos — entero grande con fondo diferenciado */}
      {counterSensors.length > 0 && (
        <>
          {showTitles && <div style={dividerStyle} />}
          <div>
            {showTitles && <div style={groupTitleStyle}>Contadores</div>}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 6,
            }}>
              {counterSensors.map(s => (
                <CounterCard
                  key={s.key}
                  label={s.label}
                  value={getSensorValue(s, canData, derivedValues)}
                  unit={sunit(s)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Grupo 5: Valores numéricos genéricos */}
      {numericSensors.length > 0 && (
        <>
          {showTitles && <div style={dividerStyle} />}
          <div>
            {showTitles && <div style={groupTitleStyle}>Valores</div>}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 10,
            }}>
              {numericSensors.map(s => (
                <NumericDisplay
                  key={s.key}
                  value={getSensorValue(s, canData, derivedValues)}
                  unit={sunit(s)}
                  label={s.label}
                />
              ))}
            </div>
          </div>
        </>
      )}

    </div>
  )
}
