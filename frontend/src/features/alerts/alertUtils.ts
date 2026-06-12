import type { AlertInstanceOut, RuleOut } from '../../lib/types'

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'h PTO',
  engine_hours: 'h motor',
  calendar_days: 'días',
}

export interface AlertDisplay {
  title: string
  detail: string | null
  severity: 'critical' | 'warning' | null
}

export function getAlertDisplay(alert: AlertInstanceOut, rules: RuleOut[]): AlertDisplay {
  const tv = alert.trigger_value

  // Silencio: trigger_value tiene last_seen + silence_hours + last_ignition
  if (tv && 'last_seen' in tv && 'silence_hours' in tv) {
    const lastSeen = new Date(tv.last_seen as string)
    const hours = Number(tv.silence_hours).toFixed(1)
    const ign = tv.last_ignition as string
    const dateStr = lastSeen.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
    return {
      title: 'Vehículo silencioso',
      detail: `Sin señal desde ${dateStr} (${hours} h) · ignición ${ign}`,
      severity: 'critical',
    }
  }

  // Mantenimiento: trigger_value tiene plan_id + plan_name + threshold_type + current + limit
  if (tv && 'plan_id' in tv && 'plan_name' in tv) {
    const planName = tv.plan_name as string
    const thType = tv.threshold_type as string
    const current = Math.round(Number(tv.current))
    const limit = Number(tv.limit)
    const unit = THRESHOLD_LABEL[thType] ?? thType
    return {
      title: `Mantenimiento vencido: ${planName}`,
      detail: `${unit} ${current}/${limit}`,
      severity: 'critical',
    }
  }

  // Regla de usuario: buscar por rule_id en la lista de reglas pasada
  const rule = rules.find(r => r.id === alert.rule_id)
  if (rule) {
    return { title: rule.name, detail: null, severity: rule.severity as 'critical' | 'warning' | null }
  }

  // Fallback para cualquier alerta de sistema no identificada: clave-valor formateado
  const detail = tv && typeof tv === 'object'
    ? Object.entries(tv)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')
    : null

  return { title: 'Alerta del sistema', detail, severity: 'warning' }
}
