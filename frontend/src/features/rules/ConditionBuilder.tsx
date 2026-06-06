import type { CSSProperties } from 'react'
import type { ConditionDef, SensorDef } from '../../lib/types'
import GeofenceMapEditor from '../../shared/ui/GeofenceMapEditor'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

const LABEL: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)',
}

const OPS = ['>', '<', '>=', '<=', '==', '!='] as const
const CONDITION_TYPES = [
  { value: 'threshold',           label: 'Umbral' },
  { value: 'threshold_sustained', label: 'Umbral sostenido' },
  { value: 'accumulation',        label: 'Acumulador' },
  { value: 'trend_rising',        label: 'Tendencia' },
  { value: 'schedule',            label: 'Horario' },
  { value: 'composite',           label: 'Combinada (AND/OR)' },
  { value: 'geofence',            label: 'Zona geográfica' },
] as const

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

// Campos top-level que el engine resuelve directamente (no pasan por can_data)
const GENERAL_NUMERIC = [
  { key: 'speed_kmh', label: 'Velocidad', unit: 'km/h' },
] as const

const GENERAL_BOOLEAN = [
  { key: 'ignition',   label: 'Ignición' },
  { key: 'pto_active', label: 'Toma de fuerza' },
] as const

const BOOLEAN_FIELDS = new Set(['ignition', 'pto_active'])

interface Props {
  condition: ConditionDef
  sensors: SensorDef[]
  onChange: (cond: ConditionDef) => void
  depth?: number
}

// Devuelve la clave can_data que usa el engine: avl_{id} si tiene avl_id, si no sensor.key
function sensorFieldKey(s: SensorDef): string {
  return s.avl_id != null ? `avl_${s.avl_id}` : s.key
}

// Siempre arranca con field vacío — el usuario debe elegir explícitamente
function defaultCondition(type: ConditionDef['type']): ConditionDef {
  switch (type) {
    case 'threshold':           return { type, field: '', op: '>', value: 0 }
    case 'threshold_sustained': return { type, field: '', op: '>', value: 0, minutes: 5 }
    case 'accumulation':        return { type, field: '', limit: 100 }
    case 'trend_rising':        return { type, field: '', threshold: 1, window_minutes: 60 }
    case 'schedule':            return { type, field: '', expected_outside: false, schedule: { type: 'always' } }
    case 'geofence':            return { type, polygon: [], action: 'enter' }
    case 'composite':
      return {
        type, op_composite: 'AND',
        conditions: [
          { type: 'threshold', field: '', op: '>', value: 0 },
          { type: 'threshold', field: '', op: '>', value: 0 },
        ],
      }
  }
}

function SimpleCondition({ condition, sensors, onChange }: {
  condition: ConditionDef
  sensors: SensorDef[]
  onChange: (c: ConditionDef) => void
}) {
  const t = condition.type

  // Solo sensores con avl_id son resolvibles por el engine (los que solo tienen kpi_key quedan fuera)
  const avlSensors = sensors.filter(s => s.avl_id != null)
  // Para acumulador/tendencia solo tiene sentido valores numéricos
  const sensorList = (t === 'accumulation' || t === 'trend_rising')
    ? avlSensors.filter(s => s.unit !== null)
    : avlSensors

  // Para accumulation/trend: solo speed_kmh del grupo general (ignition/pto son booleanos)
  const showBooleanGeneral = t !== 'accumulation' && t !== 'trend_rising'

  const isBoolean = BOOLEAN_FIELDS.has(condition.field ?? '')

  // Etiqueta de unidad del campo seleccionado
  const unitLabel = GENERAL_NUMERIC.find(f => f.key === condition.field)?.unit
    ?? sensors.find(s => sensorFieldKey(s) === condition.field)?.unit
    ?? ''

  const update = (patch: Partial<ConditionDef>) => onChange({ ...condition, ...patch })

  const handleFieldChange = (newField: string) => {
    if (BOOLEAN_FIELDS.has(newField)) {
      // Al elegir campo booleano: fijar op == y valor true por defecto
      update({ field: newField, op: '==', value: true })
    } else {
      update({ field: newField })
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {/* Selector de variable agrupado */}
      <Select
        value={condition.field ?? ''}
        onChange={e => handleFieldChange(e.target.value)}
        style={{ background: 'var(--bg-card)' }}
      >
        <option value="" disabled>— Selecciona variable —</option>
        <optgroup label="Telemetría general">
          {GENERAL_NUMERIC.map(f => (
            <option key={f.key} value={f.key}>{f.label} ({f.unit})</option>
          ))}
          {showBooleanGeneral && GENERAL_BOOLEAN.map(f => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </optgroup>
        {sensorList.length > 0 && (
          <optgroup label="Sensores del vehículo">
            {sensorList.map(s => (
              <option key={s.key} value={sensorFieldKey(s)}>
                {s.label || s.key}{s.unit ? ` (${s.unit})` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </Select>

      {/* Campos threshold / threshold_sustained — numérico */}
      {(t === 'threshold' || t === 'threshold_sustained') && !isBoolean && (
        <>
          <Select
            value={condition.op ?? '>'}
            onChange={e => update({ op: e.target.value as ConditionDef['op'] })}
            style={{ background: 'var(--bg-card)', width: 60 }}
          >
            {OPS.map(op => <option key={op} value={op}>{op}</option>)}
          </Select>
          <Input
            type="number"
            value={typeof condition.value === 'number' ? condition.value : 0}
            onChange={e => update({ value: parseFloat(e.target.value) || 0 })}
            style={{ background: 'var(--bg-card)', width: 80 }}
          />
          {unitLabel && <span style={LABEL}>{unitLabel}</span>}
        </>
      )}

      {/* Toggle activo/inactivo para campos booleanos (ignition, pto_active) */}
      {(t === 'threshold' || t === 'threshold_sustained') && isBoolean && (
        <div style={{ display: 'flex', gap: 4 }}>
          {([{ v: true, label: 'Activo' }, { v: false, label: 'Inactivo' }] as const).map(({ v, label }) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => update({ value: v, op: '==' })}
              style={{
                padding: '4px 14px', fontSize: 12, fontFamily: 'var(--font-sans)',
                border: 'none', borderRadius: 4, cursor: 'pointer',
                background: condition.value === v ? 'var(--cmg-teal)' : 'var(--bg-card)',
                color: condition.value === v ? '#fff' : 'var(--fg-muted)',
              }}
            >{label}</button>
          ))}
        </div>
      )}

      {/* Duración adicional para threshold_sustained */}
      {t === 'threshold_sustained' && (
        <>
          <span style={LABEL}>durante</span>
          <Input
            type="number"
            value={condition.minutes ?? 5}
            onChange={e => update({ minutes: parseInt(e.target.value) || 1 })}
            style={{ background: 'var(--bg-card)', width: 80 }}
            min={1}
          />
          <span style={LABEL}>minutos</span>
        </>
      )}

      {/* Acumulador */}
      {t === 'accumulation' && (
        <>
          <span style={LABEL}>alcanza</span>
          <Input
            type="number"
            value={condition.limit ?? 100}
            onChange={e => update({ limit: parseFloat(e.target.value) || 0 })}
            style={{ background: 'var(--bg-card)', width: 80 }}
          />
          {unitLabel && <span style={LABEL}>{unitLabel}</span>}
        </>
      )}

      {/* Tendencia */}
      {t === 'trend_rising' && (
        <>
          <span style={LABEL}>pendiente &gt;</span>
          <Input
            type="number"
            value={condition.threshold ?? 1}
            onChange={e => update({ threshold: parseFloat(e.target.value) || 0 })}
            style={{ background: 'var(--bg-card)', width: 80 }}
          />
          <span style={LABEL}>en</span>
          <Input
            type="number"
            value={condition.window_minutes ?? 60}
            onChange={e => update({ window_minutes: parseInt(e.target.value) || 1 })}
            style={{ background: 'var(--bg-card)', width: 80 }}
          />
          <span style={LABEL}>min</span>
        </>
      )}

      {/* Horario: selector de días + rango horario */}
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
                    background: active ? 'var(--cmg-teal)' : 'var(--bg-card)',
                    color: active ? 'var(--bg-base)' : 'var(--fg-muted)',
                    fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
                  }}
                >{d}</button>
              )
            })}
          </div>
          {condition.schedule && 'start' in condition.schedule && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                type="time"
                value={condition.schedule.start}
                onChange={e => update({
                  schedule: {
                    ...(condition.schedule as { type: 'time_window'; days: number[]; start: string; end: string }),
                    start: e.target.value,
                  },
                })}
                style={{ background: 'var(--bg-card)', width: 110 }}
              />
              <span style={LABEL}>—</span>
              <Input
                type="time"
                value={condition.schedule.end}
                onChange={e => update({
                  schedule: {
                    ...(condition.schedule as { type: 'time_window'; days: number[]; start: string; end: string }),
                    end: e.target.value,
                  },
                })}
                style={{ background: 'var(--bg-card)', width: 110 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ConditionBuilder({ condition, sensors, onChange, depth = 0 }: Props) {
  const handleTypeChange = (newType: ConditionDef['type']) => {
    onChange(defaultCondition(newType))
  }

  const addComposite = () => {
    onChange({
      type: 'composite',
      op_composite: 'AND',
      conditions: [condition, defaultCondition('threshold')],
    })
  }

  const removeComposite = () => {
    if (condition.type === 'composite' && condition.conditions?.length) {
      onChange(condition.conditions[0])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Selector del tipo de condición */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select
          value={condition.type}
          style={{ background: 'var(--bg-card)' }}
          onChange={e => handleTypeChange(e.target.value as ConditionDef['type'])}
        >
          {CONDITION_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </Select>
      </div>

      {condition.type === 'geofence' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={LABEL}>Disparar al</span>
            <Select
              value={condition.action ?? 'enter'}
              style={{ background: 'var(--bg-card)' }}
              onChange={e => onChange({ ...condition, action: e.target.value as 'enter' | 'exit' })}
            >
              <option value="enter">entrar en la zona</option>
              <option value="exit">salir de la zona</option>
            </Select>
          </div>
          <GeofenceMapEditor
            polygon={condition.polygon ?? []}
            onChange={poly => onChange({ ...condition, polygon: poly })}
          />
          {(condition.polygon?.length ?? 0) < 3 && (
            <span style={{ ...LABEL, color: 'var(--warn)', fontSize: 11 }}>
              El polígono necesita al menos 3 vértices para ser válido.
            </span>
          )}
        </div>
      ) : condition.type === 'composite' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
          <SimpleCondition
            condition={condition.conditions?.[0] ?? defaultCondition('threshold')}
            sensors={sensors}
            onChange={sub => onChange({
              ...condition,
              conditions: [sub, condition.conditions?.[1] ?? defaultCondition('threshold')],
            })}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {(['AND', 'OR'] as const).map(op => (
              <button
                key={op}
                type="button"
                onClick={() => onChange({ ...condition, op_composite: op })}
                style={{
                  padding: '3px 10px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700,
                  background: condition.op_composite === op ? 'var(--cmg-teal)' : 'var(--bg-card)',
                  color: condition.op_composite === op ? 'var(--bg-base)' : 'var(--fg-muted)',
                }}
              >{op}</button>
            ))}
            <button
              type="button"
              onClick={removeComposite}
              style={{
                padding: '3px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
                background: 'none', color: 'var(--fg-muted)',
                fontFamily: 'var(--font-sans)', fontSize: 11,
              }}
            >— quitar</button>
          </div>
          <SimpleCondition
            condition={condition.conditions?.[1] ?? defaultCondition('threshold')}
            sensors={sensors}
            onChange={sub => onChange({
              ...condition,
              conditions: [condition.conditions?.[0] ?? defaultCondition('threshold'), sub],
            })}
          />
        </div>
      ) : (
        <>
          <SimpleCondition condition={condition} sensors={sensors} onChange={onChange} />
          {depth === 0 && (
            <button
              type="button"
              onClick={addComposite}
              style={{
                alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12,
                fontFamily: 'var(--font-sans)', background: 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--fg-muted)', cursor: 'pointer',
              }}
            >+ Añadir condición AND/OR</button>
          )}
        </>
      )}
    </div>
  )
}
