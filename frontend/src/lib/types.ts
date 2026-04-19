// Matches backend app/schemas/auth.py + app/schemas/vehicle.py + app/schemas/alert.py + app/schemas/tenant.py

export interface CurrentUser {
  user_id: string
  tenant_id: string
  tenant_tier: 'cmg' | 'client' | 'subclient'
  role: 'admin' | 'operator' | 'viewer' | 'driver'
  email: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface VehicleOut {
  id: string
  tenant_id: string
  vehicle_type_id: string
  name: string
  license_plate: string | null
  vin: string | null
  year: number | null
  active: boolean
  created_at: string
}

export interface VehicleStatus {
  vehicle_id: string
  online: boolean
  last_seen: string | null
  lat: number | null
  lon: number | null
  speed_kmh: number | null
  ignition: boolean | null
  pto_active: boolean | null
  can_data: Record<string, unknown> | null
}

export interface TrackPoint {
  time: string
  lat: number | null
  lon: number | null
}

export interface KpiHour {
  bucket: string
  avg_pressure_1: number | null
  max_pressure_1: number | null
  avg_oil_temp: number | null
  max_oil_temp: number | null
  pto_active_minutes: number | null
  engine_on_minutes: number | null
  record_count: number | null
}

export interface BrandTokens {
  brand_name?: string
  brand_color?: string
  logo_url?: string
  [key: string]: string | undefined
}

export interface TenantOut {
  id: string
  parent_id: string | null
  tier: string
  name: string
  slug: string
  active: boolean
  brand_name: string | null
  brand_color: string | null
  logo_url: string | null
  custom_domain: string | null
  brand_tokens: BrandTokens | null
  created_at: string
}

export interface SensorDef {
  key: string
  label: string
  unit: string | null
  min?: number
  max?: number
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led'
  warn_above?: number
  alert_above?: number
  warn_below?: number
  alert_below?: number
  avl_id?: number
  scale?: number
  kpi_key?: string
}

export interface WsMessage {
  type: 'telemetry'
  data: VehicleStatus
}

export interface VehicleTypeOut {
  id: string
  slug: string
  name: string
  sensor_schema: SensorDef[]
}

export interface AlertInstanceOut {
  id: string
  rule_id: string
  vehicle_id: string
  tenant_id: string
  triggered_at: string
  resolved_at: string | null
  status: 'firing' | 'acknowledged' | 'resolved' | 'escalated'
  trigger_value: Record<string, unknown> | null
  ack_by_user_id: string | null
  ack_at: string | null
  ack_note: string | null
}

export interface SettingsOut {
  tenant_id: string
  notification_email: string | null
}

export type RuleSeverity = 'info' | 'warning' | 'critical'
export type ConditionOp = '>' | '<' | '>=' | '<=' | '==' | '!='

export interface ScheduleWindow {
  type: 'always'
}
export interface ScheduleTimeWindow {
  type: 'time_window'
  days: number[]
  start: string
  end: string
}

export interface ConditionDef {
  type: 'threshold' | 'threshold_sustained' | 'accumulation' | 'trend_rising' | 'schedule' | 'composite'
  field?: string
  op?: ConditionOp
  value?: number
  minutes?: number
  limit?: number
  threshold?: number
  window_minutes?: number
  expected_outside?: boolean
  schedule?: ScheduleWindow | ScheduleTimeWindow
  op_composite?: 'AND' | 'OR'
  conditions?: ConditionDef[]
}

export interface ActionDef {
  type: 'email' | 'webhook' | 'in_app' | 'push' | 'sms'
  recipients?: string[]
  url?: string
  method?: 'POST' | 'GET'
}

export interface EscalationStep {
  delay_minutes: number
  actions: ActionDef[]
}

export interface VehicleFilter {
  scope: 'all' | 'vehicle' | 'type'
  vehicle_id?: string
  vehicle_type_id?: string
}

export interface RuleOut {
  id: string
  tenant_id: string
  name: string
  description: string | null
  active: boolean
  severity: RuleSeverity
  vehicle_filter: VehicleFilter
  condition: ConditionDef
  actions: ActionDef[]
  escalation: EscalationStep[]
  cooldown_minutes: number
  created_at: string
}

export interface RuleCreate {
  name: string
  description?: string | null
  severity: RuleSeverity
  vehicle_filter: VehicleFilter
  condition: ConditionDef
  actions: ActionDef[]
  escalation: EscalationStep[]
  cooldown_minutes: number
  active: boolean
}
