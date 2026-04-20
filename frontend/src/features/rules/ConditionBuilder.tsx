import type { CSSProperties } from 'react'
import type { ConditionDef, SensorDef } from '../../lib/types'

const SELECT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '6px 8px',
}
const INPUT: CSSProperties = {
  ...SELECT, width: 80,
}
const LABEL: CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)',
}

const OPS = ['>', '<', '>=', '<=', '==', '!='] as const
const CONDITION_TYPES = [
  { value: 'threshold',           label: 'Umbral' },
  { value: 'threshold_sustained', label: 'Umbral sostenido' },
  { value: 'accumulation',        label: 'Acumulador' },
  { value: 'trend_rising',        label: 'Tendencia' },
  { value: 'schedule',            label: 'Horario' },
  { value: 'composite',           label: 'Combinada (AND/OR)' },
] as const

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

interface Props {
  condition: ConditionDef
  sensors: SensorDef[]
  onChange: (cond: ConditionDef) => void
  depth?: number
}

// Solo sensores con unidad numérica (excluye LEDs booleanos)
function numericSensors(sensors: SensorDef[]): SensorDef[] {
  return sensors.filter(s => s.unit !== null)
}

function defaultCondition(type: ConditionDef['type'], sensors: SensorDef[]): ConditionDef {
  const firstKey = sensors[0]?.key ?? ''
  const firstNumericKey = numericSensors(sensors)[0]?.key ?? firstKey
  switch (type) {
    case 'threshold':           return { type, field: firstKey, op: '>', value: 0 }
    case 'threshold_sustained': return { type, field: firstKey, op: '>', value: 0, minutes: 5 }
    case 'accumulation':        return { type, field: firstNumericKey, limit: 100 }
    case 'trend_rising':        return { type, field: firstNumericKey, threshold: 1, window_minutes: 60 }
    case 'schedule':            return { type, field: firstKey, expected_outside: false, schedule: { type: 'always' } }
    case 'composite':
      return {
        type, op_composite: 'AND',
        conditions: [
          { type: 'threshold', field: firstKey, op: '>', value: 0 },
          { type: 'threshold', field: sensors[1]?.key ?? firstKey, op: '>', value: 0 },
        ],
      }
  }
}

// Renderiza los campos específicos de una condición no-composite
function SimpleCondition({ condition, sensors, onChange }: {
  condition: ConditionDef
  sensors: SensorDef[]
  onChange: (c: ConditionDef) => void
}) {
  const t = condition.type
  // Acumulador y tendencia solo permiten sensores con unidad numérica
  const sensorList = t === 'accumulation' || t === 'trend_rising' ? numericSensors(sensors) : sensors
  const unitLabel = sensors.find(s => s.key === condition.field)?.unit ?? ''

  const update = (patch: Partial<ConditionDef>) => onChange({ ...condition, ...patch })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {/* Selector de sensor — muestra el key como valor de opción (necesario para tests y compatibilidad con el modelo de datos) */}
      <select value={condition.field ?? ''} onChange={e => update({ field: e.target.value })} style={SELECT}>
        {sensorList.map(s => <option key={s.key} value={s.key}>{s.key}</option>)}
      </select>

      {/* Campos threshold y threshold_sustained */}
      {(t === 'threshold' || t === 'threshold_sustained') && (
        <>
          <select value={condition.op ?? '>'} onChange={e => update({ op: e.target.value as ConditionDef['op'] })} style={{ ...SELECT, width: 60 }}>
            {OPS.map(op => <option key={op} value={op}>{op}</option>)}
          </select>
          <input type="number" value={condition.value ?? 0} onChange={e => update({ value: parseFloat(e.target.value) || 0 })} style={INPUT} />
          {unitLabel && <span style={LABEL}>{unitLabel}</span>}
        </>
      )}

      {/* Campos adicionales para threshold_sustained: duración en minutos */}
      {t === 'threshold_sustained' && (
        <>
          <span style={LABEL}>durante</span>
          <input type="number" value={condition.minutes ?? 5} onChange={e => update({ minutes: parseInt(e.target.value) || 1 })} style={INPUT} min={1} />
          <span style={LABEL}>minutos</span>
        </>
      )}

      {/* Campos acumulador */}
      {t === 'accumulation' && (
        <>
          <span style={LABEL}>alcanza</span>
          <input type="number" value={condition.limit ?? 100} onChange={e => update({ limit: parseFloat(e.target.value) || 0 })} style={INPUT} />
          {unitLabel && <span style={LABEL}>{unitLabel}</span>}
        </>
      )}

      {/* Campos tendencia */}
      {t === 'trend_rising' && (
        <>
          <span style={LABEL}>pendiente &gt;</span>
          <input type="number" value={condition.threshold ?? 1} onChange={e => update({ threshold: parseFloat(e.target.value) || 0 })} style={INPUT} />
          <span style={LABEL}>en</span>
          <input type="number" value={condition.window_minutes ?? 60} onChange={e => update({ window_minutes: parseInt(e.target.value) || 1 })} style={INPUT} />
          <span style={LABEL}>min</span>
        </>
      )}

      {/* Campos horario: selector de días + rango horario */}
      {t === 'schedule' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {DAYS.map((d, i) => {
              const sched = condition.schedule
              const isTimeWindow = sched && 'days' in sched
              const active = isTimeWindow ? sched.days.includes(i) : true
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    const currentDays = isTimeWindow ? [...sched.days] : [0, 1, 2, 3, 4, 5, 6]
                    const newDays = active ? currentDays.filter(x => x !== i) : [...currentDays, i].sort()
                    update({
                      schedule: {
                        type: 'time_window',
                        days: newDays,
                        start: isTimeWindow ? sched.start : '08:00',
                        end: isTimeWindow ? sched.end : '18:00',
                      },
                    })
                  }}
                  style={{
                    width: 28, height: 28, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: active ? 'var(--accent-energy)' : 'var(--bg-elevated)',
                    color: active ? 'var(--bg-base)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
                  }}
                >{d}</button>
              )
            })}
          </div>
          {condition.schedule && 'start' in condition.schedule && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="time"
                value={condition.schedule.start}
                onChange={e => update({
                  schedule: {
                    ...(condition.schedule as { type: 'time_window'; days: number[]; start: string; end: string }),
                    start: e.target.value,
                  },
                })}
                style={{ ...SELECT, width: 110 }}
              />
              <span style={LABEL}>—</span>
              <input
                type="time"
                value={condition.schedule.end}
                onChange={e => update({
                  schedule: {
                    ...(condition.schedule as { type: 'time_window'; days: number[]; start: string; end: string }),
                    end: e.target.value,
                  },
                })}
                style={{ ...SELECT, width: 110 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ConditionBuilder({ condition, sensors, onChange, depth = 0 }: Props) {
  // Cambiar tipo borra los campos anteriores y aplica defaults
  const handleTypeChange = (newType: ConditionDef['type']) => {
    onChange(defaultCondition(newType, sensors))
  }

  // Envuelve la condición actual en un composite AND con una nueva condición threshold
  const addComposite = () => {
    onChange({
      type: 'composite',
      op_composite: 'AND',
      conditions: [
        condition,
        defaultCondition('threshold', sensors),
      ],
    })
  }

  // Extrae la primera sub-condición del composite
  const removeComposite = () => {
    if (condition.type === 'composite' && condition.conditions?.length) {
      onChange(condition.conditions[0])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Selector del tipo de condición */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={condition.type}
          onChange={e => handleTypeChange(e.target.value as ConditionDef['type'])}
          style={SELECT}
        >
          {CONDITION_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </select>
      </div>

      {/* Vista composite: dos sub-condiciones con operador AND/OR entre ellas */}
      {condition.type === 'composite' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid var(--bg-border)' }}>
          <SimpleCondition
            condition={condition.conditions?.[0] ?? defaultCondition('threshold', sensors)}
            sensors={sensors}
            onChange={sub => onChange({
              ...condition,
              conditions: [sub, condition.conditions?.[1] ?? defaultCondition('threshold', sensors)],
            })}
          />
          {/* Selector AND/OR + botón para deshacer composite */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['AND', 'OR'] as const).map(op => (
              <button
                key={op}
                type="button"
                onClick={() => onChange({ ...condition, op_composite: op })}
                style={{
                  padding: '3px 10px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 700,
                  background: condition.op_composite === op ? 'var(--accent-energy)' : 'var(--bg-elevated)',
                  color: condition.op_composite === op ? 'var(--bg-base)' : 'var(--text-muted)',
                }}
              >{op}</button>
            ))}
            <button
              type="button"
              onClick={removeComposite}
              style={{
                padding: '3px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
                background: 'none', color: 'var(--text-muted)',
                fontFamily: 'var(--font-ui)', fontSize: 11,
              }}
            >— quitar</button>
          </div>
          <SimpleCondition
            condition={condition.conditions?.[1] ?? defaultCondition('threshold', sensors)}
            sensors={sensors}
            onChange={sub => onChange({
              ...condition,
              conditions: [condition.conditions?.[0] ?? defaultCondition('threshold', sensors), sub],
            })}
          />
        </div>
      ) : (
        <>
          <SimpleCondition condition={condition} sensors={sensors} onChange={onChange} />
          {/* Botón para añadir segunda condición (solo en el nivel raíz) */}
          {depth === 0 && (
            <button
              type="button"
              onClick={addComposite}
              style={{
                alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12,
                fontFamily: 'var(--font-ui)', background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)', borderRadius: 6,
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >+ Añadir condición AND/OR</button>
          )}
        </>
      )}
    </div>
  )
}
