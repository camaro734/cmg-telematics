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
  driver_name: string | null
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
  ext_voltage_mv: number | null
  can_data: Record<string, unknown> | null
  dout_state: Record<number, boolean>
}

export interface TrackPoint {
  time: string
  lat: number | null
  lon: number | null
  speed_kmh?: number | null
}

export interface CommandLogEntry {
  id: string
  device_id: string
  vehicle_id: string
  tenant_id: string
  command: string
  status: 'pending' | 'sent' | 'failed' | 'confirmed'
  sent_at: string
  response: string | null
  error_message: string | null
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
  enabled_modules: string[]
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
  offset?: number
  kpi_key?: string
  bit_index?: number
  visible_in_detail?: boolean
}

export interface WsMessage {
  type: 'telemetry'
  data: VehicleStatus
}

export interface DoutSlot {
  slot: number
  label: string
  enabled: boolean
}

export interface HistoricMetricItem {
  key: string
  label: string
  color: string
  unit: string
  transform: number
  avl_id?: number
  chart_type?: 'line' | 'donut' | 'bar'
  show_in_pdf?: boolean
  group?: string | null
}

export interface VehicleTypeOut {
  id: string
  slug: string
  name: string
  sensor_schema: SensorDef[]
  icon_url: string | null
  maintenance_templates: MaintenanceTemplateItem[]
  historic_metrics: HistoricMetricItem[]
  dout_config: DoutSlot[]
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
  type: 'threshold' | 'threshold_sustained' | 'accumulation' | 'trend_rising' | 'schedule' | 'composite' | 'geofence'
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
  // geofence
  polygon?: [number, number][]
  action?: 'enter' | 'exit'
}

export type WorkOrderStatus   = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface WorkOrderOut {
  id: string
  tenant_id: string
  title: string
  description: string | null
  vehicle_id: string | null
  driver_id: string | null
  status: WorkOrderStatus
  priority: WorkOrderPriority
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  location_address: string | null
  location_lat: number | null
  location_lon: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  vehicle_name: string | null
  driver_name: string | null
}

export interface DriverOut {
  id: string
  tenant_id: string
  full_name: string
  phone: string | null
  license_number: string | null
  license_expiry: string | null  // ISO date
  notes: string | null
  active: boolean
  created_at: string
  current_vehicle_name: string | null
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

export interface MaintenanceThreshold {
  type: 'pto_hours' | 'engine_hours' | 'calendar_days'
  value: number
}

export interface TriggerCondition {
  thresholds: MaintenanceThreshold[]
  op: 'OR'
}

export interface MaintenanceTemplateItem {
  name: string
  thresholds: MaintenanceThreshold[]
  warn_before_pct: number
}

export interface ThresholdProgress {
  type: string
  current: number
  limit: number
  pct: number
}

export interface MaintenanceProgress {
  status: 'ok' | 'próximo' | 'vencido'
  thresholds: ThresholdProgress[]
}

export interface MaintenancePlanOut {
  id: string
  vehicle_id: string
  vehicle_name: string
  tenant_id: string
  name: string
  trigger_condition: TriggerCondition
  warn_before_pct: number
  active: boolean
  created_at: string
  progress: MaintenanceProgress
}

export interface MaintenancePlanCreate {
  vehicle_id: string
  name: string
  trigger_condition: TriggerCondition
  warn_before_pct: number
  active: boolean
}

export interface MaintenancePlanUpdate {
  name?: string
  trigger_condition?: TriggerCondition
  warn_before_pct?: number
  active?: boolean
}

export interface MaintenanceLogOut {
  id: string
  plan_id: string | null
  vehicle_id: string
  performed_at: string
  performed_by_email: string | null
  description: string | null
  reset_counters: string[]
  cost_eur: number | null
  document_url: string | null
}

export interface MaintenanceLogCreate {
  performed_at: string
  description?: string
  reset_counters: string[]
  cost_eur?: number
}

export interface TenantCreate {
  parent_id: string
  tier: 'client'
  name: string
  slug: string
}

export interface TenantUpdate {
  name?: string
  slug?: string
  active?: boolean
  enabled_modules?: string[]
}

export interface UserOut {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'viewer' | 'driver'
  active: boolean
  created_at: string
}

export interface UserCreate {
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'viewer' | 'driver'
  password: string
}

export interface UserUpdate {
  full_name?: string
  role?: 'admin' | 'operator' | 'viewer' | 'driver'
  active?: boolean
  password?: string
}

export interface GrantOut {
  id: string
  grantor_id: string
  grantee_id: string
  resource_type: string
  resource_id: string | null
  allowed_actions: string[]
  constraints: Record<string, unknown> | null
  granted_at: string
  expires_at: string | null
  active: boolean
}

export interface GrantCreate {
  grantee_id: string
  resource_type: string
  resource_id?: string | null
  allowed_actions: string[]
  constraints?: Record<string, unknown> | null
  expires_at?: string | null
}

export interface VehicleCreate {
  vehicle_type_id: string
  name: string
  license_plate?: string | null
  vin?: string | null
  driver_name?: string | null
  year?: number | null
  tenant_id?: string | null
}

export interface VehicleUpdate {
  name?: string | null
  license_plate?: string | null
  vin?: string | null
  driver_name?: string | null
  year?: number | null
  vehicle_type_id?: string | null
}

export interface DeviceOut {
  id: string
  tenant_id: string | null
  vehicle_id: string | null
  imei: string
  model: string
  firmware_ver: string | null
  online: boolean
  last_seen: string | null
  active: boolean
  created_at: string
}

export interface DeviceCreate {
  imei: string
  model?: string
  firmware_ver?: string | null
  tenant_id: string
}

export interface DeviceAssignVehicle {
  vehicle_id: string | null
}

export interface WorkCycleDefinition {
  id: string
  vehicle_type_id: string
  tenant_id: string | null
  name: string
  trigger_type: 'pto_change' | 'threshold_exceeded' | 'sensor_pulse' | 'ignition_period'
  trigger_config: Record<string, unknown>
  snapshot_fields: string[]
  aggregate_fields: string[]
  active: boolean
  created_at: string
}

export interface WorkCycleDefinitionCreate {
  vehicle_type_id: string
  name: string
  trigger_type: string
  trigger_config?: Record<string, unknown>
  snapshot_fields?: string[]
  aggregate_fields?: string[]
}

export interface WorkCycle {
  id: string
  vehicle_id: string
  definition_id: string
  tenant_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  cycle_data: Record<string, unknown>
  lat: number | null
  lon: number | null
}

export interface MaterialItem {
  name: string
  quantity: number
  unit: string
}

export interface WorkReportOut {
  id: string
  work_order_id: string
  tenant_id: string
  vehicle_id: string | null
  driver_id: string | null
  description: string | null
  work_duration_minutes: number | null
  photo_urls: string[]
  signature_url: string | null
  materials_used: MaterialItem[]
  created_at: string
}
