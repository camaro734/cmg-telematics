import type { CSSProperties } from 'react'
import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ConditionBuilder from './ConditionBuilder'
import VehicleFilterPicker from './VehicleFilterPicker'
import ActionsList from './ActionsList'
import EscalationBuilder from './EscalationBuilder'
import { Chip } from '../../shared/ui/Chip'
import { useAuthStore } from '../auth/useAuthStore'
import { Input } from '../../shared/ui/Input'
import type { RuleOut, RuleCreate, ConditionDef, VehicleTypeOut, VehicleOut, SensorDef } from '../../lib/types'

const LABEL: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: 6,
}
const HELP: CSSProperties = {
  fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)', marginTop: 5, lineHeight: 1.5,
}
const SEV_BTN = (active: boolean, color: string): CSSProperties => ({
  padding: '6px 16px', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 600,
  border: `1px solid ${active ? color : 'var(--border)'}`,
  borderRadius: 6, cursor: 'pointer',
  background: active ? color : 'var(--bg-elevated)',
  color: active ? '#fff' : 'var(--fg-muted)',
  transition: 'all 0.15s',
})

const DEFAULT_CONDITION: ConditionDef = { type: 'threshold', field: '', op: '>', value: 0 }
const DEFAULT_FORM: RuleCreate = {
  name: '', description: null, severity: 'warning',
  vehicle_filter: { scope: 'all' },
  condition: DEFAULT_CONDITION,
  actions: [{ type: 'in_app' }],
  escalation: [],
  cooldown_minutes: 30,
  active: true,
}

function conditionSummary(c: ConditionDef): string {
  if (!c) return '—'
  switch (c.type) {
    case 'threshold': return c.field ? `${c.field} ${c.op ?? '>'} ${c.value}` : 'Sin configurar'
    case 'threshold_sustained': return c.field ? `${c.field} ${c.op ?? '>'} ${c.value} durante ${(c as any).duration_minutes ?? '?'} min` : 'Sin configurar'
    case 'accumulation': return c.field ? `Acumulado ${c.field} >= ${c.value}` : 'Sin configurar'
    case 'geofence': return `Geocerca — ${(c as any).action === 'enter' ? 'al entrar' : 'al salir'}`
    case 'schedule': return 'Fuera de horario programado'
    default: return c.type
  }
}

function filterSummary(f: RuleCreate['vehicle_filter']): string {
  if (f.scope === 'all') return 'Todos los vehículos'
  if (f.scope === 'type') return `Tipo de vehículo${f.vehicle_type_id ? '' : ' (sin seleccionar)'}`
  if (f.scope === 'vehicle') return `Vehículo concreto${f.vehicle_id ? '' : ' (sin seleccionar)'}`
  return '—'
}

const CONDITION_HELP: Record<string, string> = {
  threshold: 'El campo debe ser el nombre exacto del sensor CAN del vehículo. Ej: presion_bomba, temp_aceite, rpm_motor.',
  threshold_sustained: 'La condición debe mantenerse durante X minutos consecutivos antes de disparar la alerta.',
  accumulation: 'Suma el valor del sensor desde el último reset. Útil para horas de PTO, ciclos de trabajo o km recorridos.',
  geofence: 'La alerta se dispara cuando el vehículo cruza el límite del polígono definido.',
  schedule: 'Se dispara si el vehículo está activo fuera del horario configurado — ideal para detectar uso no autorizado.',
  composite: 'Combina varias condiciones con AND/OR. Útil para alertas que requieren múltiples señales simultáneas.',
  trend_rising: 'Detecta una tendencia de subida en el sensor. Útil para alertas tempranas antes de alcanzar el umbral crítico.',
}

// Tipos de condición que requieren un campo/variable para funcionar
const NEEDS_FIELD_TYPES = new Set(['threshold', 'threshold_sustained', 'accumulation', 'trend_rising', 'schedule'])
function condNeedsField(cond: ConditionDef): boolean { return NEEDS_FIELD_TYPES.has(cond.type) }

function mergedSensors(vehicleTypes: VehicleTypeOut[]): SensorDef[] {
  const seen = new Set<string>()
  const result: SensorDef[] = []
  for (const vt of vehicleTypes) {
    for (const s of vt.sensor_schema) {
      if (!seen.has(s.key)) { seen.add(s.key); result.push(s) }
    }
  }
  return result
}

const STEP_LABELS = ['Identidad', 'Vehículos', 'Condición', 'Acciones', 'Revisar']
const SEV_COLORS: Record<string, string> = { info: 'var(--info)', warning: 'var(--warn)', critical: 'var(--danger)' }

export default function RuleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id && id !== 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()

  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  useEffect(() => { if (user && !canManageRules) navigate('/alerts', { replace: true }) }, [user])

  const [form, setForm] = useState<RuleCreate>({
    ...DEFAULT_FORM,
    vehicle_filter: {
      scope: searchParams.get('type_id') ? 'type' : searchParams.get('vehicle_id') ? 'vehicle' : 'all',
      vehicle_id: searchParams.get('vehicle_id') ?? '',
      vehicle_type_id: searchParams.get('type_id') ?? '',
    },
    condition: searchParams.get('condition_type') === 'geofence'
      ? { type: 'geofence', polygon: [], action: 'enter' } as unknown as ConditionDef
      : DEFAULT_CONDITION,
  })
  const [step, setStep] = useState(1)
  const [visitedSteps, setVisitedSteps] = useState(new Set([1]))
  const [nameError, setNameError] = useState('')
  const [condError, setCondError] = useState('')
  const [apiError, setApiError] = useState('')

  const { data: existingRule } = useQuery({
    queryKey: keys.rule(id!),
    queryFn: () => apiClient.get<RuleOut>(`/api/v1/rules/${id}`),
    enabled: isEdit,
    staleTime: 60_000,
  })
  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
  })
  const { data: selectedVehicle } = useQuery({
    queryKey: keys.vehicle(form.vehicle_filter.vehicle_id ?? ''),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${form.vehicle_filter.vehicle_id}`),
    enabled: form.vehicle_filter.scope === 'vehicle' && !!form.vehicle_filter.vehicle_id,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (existingRule) {
      setForm({
        name: existingRule.name, description: existingRule.description,
        severity: existingRule.severity, vehicle_filter: existingRule.vehicle_filter,
        condition: existingRule.condition, actions: existingRule.actions,
        escalation: existingRule.escalation, cooldown_minutes: existingRule.cooldown_minutes,
        active: existingRule.active,
      })
    }
  }, [existingRule?.id])

  const sensors: SensorDef[] = useMemo(() => {
    const { scope, vehicle_type_id, vehicle_id } = form.vehicle_filter
    if (scope === 'type' && vehicle_type_id)
      return vehicleTypes.find(vt => vt.id === vehicle_type_id)?.sensor_schema ?? []
    if (scope === 'vehicle' && vehicle_id && selectedVehicle)
      return vehicleTypes.find(vt => vt.id === selectedVehicle.vehicle_type_id)?.sensor_schema ?? mergedSensors(vehicleTypes)
    return mergedSensors(vehicleTypes)
  }, [vehicleTypes, form.vehicle_filter, selectedVehicle])

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit
      ? apiClient.put<RuleOut>(`/api/v1/rules/${id}`, form)
      : apiClient.post<RuleOut>('/api/v1/rules', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.rules() }); navigate('/alerts', { state: { tab: 'reglas' } }) },
    onError: (err) => setApiError((err as Error).message),
  })

  const update = <K extends keyof RuleCreate>(key: K, val: RuleCreate[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const goTo = (s: number) => {
    if (s < 1 || s > 5) return
    if (s > step && step === 1 && !form.name.trim()) { setNameError('El nombre es obligatorio'); return }
    if (s > step && step === 3 && condNeedsField(form.condition) && !form.condition.field) {
      setCondError('Elige una variable para la condición'); return
    }
    setNameError('')
    setCondError('')
    setStep(s)
    setVisitedSteps(prev => new Set([...prev, s]))
  }

  return (
    <Shell title={isEdit ? 'Editar regla' : 'Nueva regla'}>
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24,
      }}>
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14,
          width: '100%', maxWidth: 660, maxHeight: '92vh', overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column',
        }}>

          {/* Header con stepper */}
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
                {isEdit ? 'Editar regla' : 'Nueva regla de alerta'}
              </span>
              <button
                onClick={() => navigate('/alerts', { state: { tab: 'reglas' } })}
                style={{ background: 'transparent', border: 'none', color: 'var(--fg-dim)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
              >✕</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center' }}>
              {STEP_LABELS.map((label, i) => {
                const s = i + 1
                const active = s === step
                const done = visitedSteps.has(s) && s !== step
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', flex: s < 5 ? 1 : 0 }}>
                    <button
                      onClick={() => visitedSteps.has(s) && goTo(s)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: visitedSteps.has(s) ? 'pointer' : 'default', padding: '0 4px' }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', fontSize: 12, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: active ? 'var(--cmg-teal)' : done ? 'var(--cmg-teal-soft)' : 'var(--bg-elevated)',
                        color: active ? '#fff' : done ? 'var(--cmg-teal)' : 'var(--fg-dim)',
                        border: active ? 'none' : done ? '1px solid var(--cmg-teal-line)' : '1px solid var(--border)',
                        transition: 'all 0.15s',
                      }}>
                        {done ? '✓' : s}
                      </div>
                      <span style={{ fontSize: 10, color: active ? 'var(--cmg-teal)' : 'var(--fg-dim)', whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 400 }}>
                        {label}
                      </span>
                    </button>
                    {s < 5 && <div style={{ flex: 1, height: 1, background: visitedSteps.has(s + 1) ? 'var(--cmg-teal-line)' : 'var(--border)', marginBottom: 16 }} />}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cuerpo del paso */}
          <div style={{ padding: 24, flex: 1 }}>

            {step === 1 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  Ponle un nombre descriptivo y elige la urgencia. El nombre aparece en las notificaciones al operario.
                </p>
                <div style={{ marginBottom: 16 }}>
                  <label style={LABEL}>NOMBRE *</label>
                  <Input type="text" value={form.name} onChange={e => { update('name', e.target.value); setNameError('') }}
                    placeholder="Ej: Presión bomba alta, Temperatura aceite, Parada fuera de zona"
                    error={nameError || undefined}
                    helperText={'Ej: "Presión bomba vacuum alta", "Motor en marcha fuera de horario", "Batería baja"'}
                    autoFocus />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={LABEL}>DESCRIPCIÓN (opcional)</label>
                  <Input type="text" value={form.description ?? ''} onChange={e => update('description', e.target.value || null)}
                    placeholder="Nota interna sobre esta regla"
                    helperText="Nota interna. No se muestra en las notificaciones al operario." />
                </div>
                <div>
                  <label style={LABEL}>SEVERIDAD</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['info', 'warning', 'critical'] as const).map(s => (
                      <button key={s} type="button" onClick={() => update('severity', s)} style={SEV_BTN(form.severity === s, SEV_COLORS[s])}>
                        {s === 'info' ? 'Info' : s === 'warning' ? 'Aviso' : 'Crítica'}
                      </button>
                    ))}
                  </div>
                  <p style={HELP}>
                    <strong style={{ color: 'var(--danger)' }}>Crítica</strong> activa sonido en la app. &nbsp;
                    <strong style={{ color: 'var(--warn)' }}>Aviso</strong> notifica silenciosamente. &nbsp;
                    <strong style={{ color: 'var(--info)' }}>Info</strong> solo registra, sin notificación activa.
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  ¿A qué vehículos aplica esta regla? Puedes aplicarla a toda la flota, a un tipo de vehículo o a uno concreto.
                </p>
                <VehicleFilterPicker value={form.vehicle_filter} onChange={f => update('vehicle_filter', f)} />
                <p style={{ ...HELP, marginTop: 14 }}>
                  Si seleccionas "Todos los vehículos", la regla se evalúa para cada vehículo de tu flota en cada paquete de telemetría recibido.
                </p>
              </div>
            )}

            {step === 3 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  Define cuándo debe dispararse la alerta. Se evalúa en cada paquete de telemetría recibido del vehículo.
                </p>
                <ConditionBuilder
                  condition={form.condition}
                  sensors={sensors}
                  onChange={c => { update('condition', c); if (condError) setCondError('') }}
                />
                {condError && (
                  <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, fontFamily: 'var(--font-sans)' }}>
                    {condError}
                  </div>
                )}
                {form.condition?.type && CONDITION_HELP[form.condition.type] && (
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--info)', fontSize: 14, flexShrink: 0, lineHeight: 1.6 }}>ⓘ</span>
                    <p style={{ ...HELP, margin: 0 }}>{CONDITION_HELP[form.condition.type]}</p>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  ¿Qué ocurre cuando se dispara? Puedes combinar varias notificaciones.
                </p>
                <ActionsList value={form.actions} onChange={a => update('actions', a)} />
                <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 8, marginBottom: 20 }}>
                  <p style={{ ...HELP, margin: 0 }}>
                    <strong style={{ color: 'var(--fg-tertiary)' }}>In-app:</strong> aparece en la bandeja de alertas del panel web y la app móvil.<br/>
                    <strong style={{ color: 'var(--fg-tertiary)' }}>Email:</strong> envía correo a los destinatarios configurados. Requiere configurar el servidor SMTP en Ajustes → Correo.<br/>
                    <strong style={{ color: 'var(--fg-tertiary)' }}>Webhook:</strong> llama a una URL externa con los datos de la alerta en JSON. Útil para integraciones con ERP o Slack.
                  </p>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ ...LABEL, textTransform: 'uppercase' as const }}>ESCALACIÓN (opcional)</label>
                  <p style={{ ...HELP, marginBottom: 10 }}>Envía una segunda notificación si la alerta no se reconoce pasado X minutos. Útil para alertas críticas.</p>
                  <EscalationBuilder value={form.escalation} onChange={e => update('escalation', e)} />
                </div>
                <div>
                  <label style={LABEL}>COOLDOWN — NO REPETIR ANTES DE</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Input type="number" value={form.cooldown_minutes}
                      onChange={e => update('cooldown_minutes', parseInt(e.target.value) || 1)}
                      style={{ width: 80 }} min={1} />
                    <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>minutos</span>
                  </div>
                  <p style={HELP}>Tiempo mínimo entre dos disparos de la misma regla para el mismo vehículo. Evita el spam de notificaciones. Recomendado: 30 min para avisos, 5–10 min para críticos.</p>
                </div>
              </div>
            )}

            {step === 5 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  Revisa la configuración antes de guardar.
                </p>
                {[
                  { label: 'Nombre', value: form.name || '—' },
                  { label: 'Descripción', value: form.description || 'Sin descripción' },
                  { label: 'Severidad', value: <Chip color={SEV_COLORS[form.severity] ?? 'var(--info)'} soft size="sm">{form.severity === 'info' ? 'Info' : form.severity === 'warning' ? 'Aviso' : 'Crítica'}</Chip> },
                  { label: 'Vehículos', value: filterSummary(form.vehicle_filter) },
                  { label: 'Condición', value: conditionSummary(form.condition) },
                  { label: 'Acciones', value: form.actions.map(a => a.type).join(', ') || '—' },
                  { label: 'Cooldown', value: `${form.cooldown_minutes} minutos` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                    <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, minWidth: 120 }}>{label}</span>
                    <span style={{ fontSize: 13, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', textAlign: 'right' as const }}>{value}</span>
                  </div>
                ))}
                <div style={{ marginTop: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
                    <input type="checkbox" checked={form.active} onChange={e => update('active', e.target.checked)}
                      style={{ accentColor: 'var(--cmg-teal)', width: 16, height: 16 }} />
                    Activar regla inmediatamente al guardar
                  </label>
                  <p style={{ ...HELP, paddingLeft: 24 }}>Si la desmarcas, la regla se guarda pero no evaluará condiciones hasta que la actives.</p>
                </div>
                {apiError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 12 }}>{apiError}</div>}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', flexShrink: 0, background: 'var(--bg-surface)' }}>
            <button type="button" onClick={() => step > 1 ? goTo(step - 1) : navigate('/alerts', { state: { tab: 'reglas' } })}
              style={{ padding: '8px 16px', fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
              {step > 1 ? '← Anterior' : 'Cancelar'}
            </button>
            {step < 5 ? (
              <button type="button" onClick={() => goTo(step + 1)}
                style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, background: 'var(--cmg-teal)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                Siguiente →
              </button>
            ) : (
              <button type="button" disabled={isPending}
                onClick={() => {
                  setApiError('')
                  if (!form.name.trim()) { setNameError('El nombre es obligatorio'); goTo(1); return }
                  if (condNeedsField(form.condition) && !form.condition.field) { setCondError('Elige una variable'); goTo(3); return }
                  mutate()
                }}
                style={{ padding: '8px 24px', fontSize: 13, fontWeight: 600, background: 'var(--cmg-teal)', border: 'none', borderRadius: 6, color: '#fff', cursor: isPending ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)' }}>
                {isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear regla'}
              </button>
            )}
          </div>

        </div>
      </div>
    </Shell>
  )
}
