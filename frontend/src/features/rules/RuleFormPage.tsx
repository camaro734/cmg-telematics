import type { CSSProperties } from 'react'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ConditionBuilder from './ConditionBuilder'
import VehicleFilterPicker from './VehicleFilterPicker'
import ActionsList from './ActionsList'
import EscalationBuilder from './EscalationBuilder'
import type { RuleOut, RuleCreate, ConditionDef, VehicleTypeOut, SensorDef } from '../../lib/types'

const SECTION: CSSProperties = {
  marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--bg-border)',
}
const LABEL: CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: 6,
}
const INPUT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const,
}
const SEV_BTN = (active: boolean, color: string): CSSProperties => ({
  padding: '6px 16px', fontSize: 12, fontFamily: 'var(--font-ui)', fontWeight: 600,
  border: `1px solid ${active ? color : 'var(--bg-border)'}`,
  borderRadius: 6, cursor: 'pointer',
  background: active ? color : 'var(--bg-elevated)',
  color: active ? 'var(--bg-base)' : 'var(--text-muted)',
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

// Combina sensores de todos los tipos de vehículo, deduplicando por key
function mergedSensors(vehicleTypes: VehicleTypeOut[]): SensorDef[] {
  const seen = new Set<string>()
  const result: SensorDef[] = []
  for (const vt of vehicleTypes) {
    for (const s of vt.sensor_schema) {
      if (!seen.has(s.key)) {
        seen.add(s.key)
        result.push(s)
      }
    }
  }
  return result
}

export default function RuleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id && id !== 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState<RuleCreate>(DEFAULT_FORM)
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError] = useState('')

  const { data: existingRule } = useQuery({
    queryKey: keys.rule(id!),
    queryFn: () => apiClient.get<RuleOut>(`/api/v1/rules/${id}`),
    enabled: isEdit,
    staleTime: Infinity,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
  })

  // Pre-cargar formulario cuando se obtiene la regla existente
  // Depende de existingRule?.id para no re-ejecutar si cambia la referencia del objeto
  useEffect(() => {
    if (existingRule) {
      setForm({
        name: existingRule.name,
        description: existingRule.description,
        severity: existingRule.severity,
        vehicle_filter: existingRule.vehicle_filter,
        condition: existingRule.condition,
        actions: existingRule.actions,
        escalation: existingRule.escalation,
        cooldown_minutes: existingRule.cooldown_minutes,
        active: existingRule.active,
      })
    }
  }, [existingRule?.id])

  const sensors: SensorDef[] = mergedSensors(vehicleTypes)

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit
      ? apiClient.put<RuleOut>(`/api/v1/rules/${id}`, form)
      : apiClient.post<RuleOut>('/api/v1/rules', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.rules() })
      navigate('/rules')
    },
    onError: (err) => setApiError((err as Error).message),
  })

  const handleSubmit = () => {
    if (!form.name.trim()) {
      setNameError('El nombre es obligatorio')
      return
    }
    setNameError('')
    setApiError('')
    mutate()
  }

  const update = <K extends keyof RuleCreate>(key: K, val: RuleCreate[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  return (
    <Shell title={isEdit ? 'Editar regla' : 'Nueva regla'}>
      <div style={{ padding: 24, maxWidth: 640, overflowY: 'auto', height: '100%' }}>

        {/* Identificación */}
        <div style={SECTION}>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>NOMBRE</label>
            <input
              type="text"
              value={form.name}
              onChange={e => { update('name', e.target.value); setNameError('') }}
              placeholder="Nombre de la regla"
              style={{ ...INPUT, borderColor: nameError ? 'var(--accent-crit)' : 'var(--bg-border)' }}
            />
            {nameError && (
              <div style={{ color: 'var(--accent-crit)', fontSize: 11, fontFamily: 'var(--font-ui)', marginTop: 4 }}>
                {nameError}
              </div>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>DESCRIPCIÓN (opcional)</label>
            <input
              type="text"
              value={form.description ?? ''}
              onChange={e => update('description', e.target.value || null)}
              placeholder="Descripción de la regla (opcional)"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>SEVERIDAD</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => update('severity', 'info')} style={SEV_BTN(form.severity === 'info', 'var(--accent-info)')}>Info</button>
              <button type="button" onClick={() => update('severity', 'warning')} style={SEV_BTN(form.severity === 'warning', 'var(--accent-warn)')}>Aviso</button>
              <button type="button" onClick={() => update('severity', 'critical')} style={SEV_BTN(form.severity === 'critical', 'var(--accent-crit)')}>Crítica</button>
            </div>
          </div>
        </div>

        {/* Alcance de vehículos */}
        <div style={SECTION}>
          <label style={LABEL}>ALCANCE DE VEHÍCULOS</label>
          <VehicleFilterPicker
            value={form.vehicle_filter}
            onChange={f => update('vehicle_filter', f)}
          />
        </div>

        {/* Condición */}
        <div style={SECTION}>
          <label style={LABEL}>CONDICIÓN</label>
          <ConditionBuilder
            condition={form.condition}
            sensors={sensors}
            onChange={c => update('condition', c)}
          />
        </div>

        {/* Acciones */}
        <div style={SECTION}>
          <label style={LABEL}>ACCIONES</label>
          <ActionsList
            value={form.actions}
            onChange={a => update('actions', a)}
          />
        </div>

        {/* Escalación */}
        <div style={SECTION}>
          <label style={LABEL}>ESCALACIÓN</label>
          <EscalationBuilder
            value={form.escalation}
            onChange={e => update('escalation', e)}
          />
        </div>

        {/* Configuración cooldown + activación */}
        <div style={{ marginBottom: 24 }}>
          <label style={LABEL}>CONFIGURACIÓN</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>No repetir antes de</span>
            <input
              type="number"
              value={form.cooldown_minutes}
              onChange={e => update('cooldown_minutes', parseInt(e.target.value) || 1)}
              style={{ ...INPUT, width: 80 }}
              min={1}
            />
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>minutos</span>
          </div>
          <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => update('active', e.target.checked)}
              style={{ accentColor: 'var(--accent-energy)' }}
            />
            Regla activa
          </label>
        </div>

        {apiError && (
          <div style={{ color: 'var(--accent-crit)', fontSize: 12, fontFamily: 'var(--font-ui)', marginBottom: 12 }}>
            {apiError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              padding: '8px 24px', fontSize: 13, fontFamily: 'var(--font-ui)', fontWeight: 600,
              background: 'var(--accent-energy)', border: 'none', borderRadius: 6,
              color: 'var(--bg-base)', cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            {isPending ? 'Guardando…' : 'Guardar regla'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/rules')}
            style={{
              padding: '8px 16px', fontSize: 13, fontFamily: 'var(--font-ui)',
              background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
              borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </Shell>
  )
}
