// Matches backend app/schemas/auth.py + app/schemas/vehicle.py + app/schemas/alert.py + app/schemas/tenant.py

export interface CurrentUser {
  user_id: string
  tenant_id: string
  tenant_tier: 'cmg' | 'client' | 'subclient' | 'manufacturer'
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
  manufacturer_tenant_id: string | null
  vehicle_type_id: string
  name: string
  license_plate: string | null
  vin: string | null
  driver_name: string | null
  year: number | null
  active: boolean
  created_at: string
}

export interface VehicleReassignOut {
  vehicle_id: string
  from_tenant_id: string
  to_tenant_id: string
  reassigned_at: string
  alert_rules_deactivated: number
  grants_revoked: number
  device_moved: boolean
  device_imei: string | null
}

export interface VehicleStatus {
  vehicle_id: string
  online: boolean
  last_seen: string | null
  device_last_seen: string | null
  lat: number | null
  lon: number | null
  speed_kmh: number | null
  heading: number | null
  ignition: boolean | null
  pto_active: boolean | null
  ext_voltage_mv: number | null
  can_data: Record<string, unknown> | null
  dout_state: Record<number, boolean>
  device_out_of_service?: boolean
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
  command_type?: 'DOUT' | 'MANUAL_CAN' | 'RAW'
  status: 'pending' | 'sent' | 'failed' | 'confirmed' | 'timeout' | 'disconnected' | 'error'
  sent_at: string
  response: string | null
  error_message: string | null
  latency_ms?: number | null
}

export interface FmcStatus {
  connected: boolean
  imei: string
  last_seen: string | null
}

export interface ManualCanCommandResponse {
  ok: boolean
  command_log_id: string
  imei: string
  command_sent: string
  fmc_response: string | null
  latency_ms: number | null
  status: 'confirmed' | 'timeout' | 'disconnected'
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

export type SensorIcon =
  | 'pressure' | 'temperature' | 'fuel' | 'water' | 'engine'
  | 'speed' | 'voltage' | 'pump' | 'valve' | 'rpm' | 'flow'
  | 'counter' | 'toggle'

export interface TenantOut {
  id: string
  parent_id: string | null
  parent_manufacturer_id: string | null
  tier: string
  name: string
  slug: string
  active: boolean
  brand_name: string | null
  brand_color: string | null
  logo_url: string | null
  custom_domain: string | null
  brand_tokens: BrandTokens | null
  business_cif: string | null
  business_address: string | null
  manufacturer_can_view_operations: boolean
  manufacturer_can_view_can_data: boolean
  manufacturer_can_create_rules: boolean
  manufacturer_can_manage_clients: boolean
  manufacturer_can_transfer_vehicles: boolean
  can_actuate_controls: boolean
  created_at: string
  enabled_modules: string[]
}

// Transformación de un sensor: mapeo de la señal cruda a su valor físico.
// 'linear_range' = interpolación lineal de 2 puntos (entrada → salida),
// p. ej. 4-20 mA (4000–20000 crudo) → −1..10 bar. Unión etiquetada
// extensible a tablas multipunto no lineales sin migración.
export type SensorTransform =
  | { type: 'linear_range'; in_min: number; in_max: number; out_min: number; out_max: number }
  | { type: 'minutes_to_hours' }   // contador en minutos → horas decimales (÷60)
// futuro: | { type: 'points'; points: [number, number][] }

export interface SensorDef {
  key: string
  label: string
  unit: string | null
  min?: number
  max?: number
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led' | 'tank' | 'gauge_arc' | 'counter'
  warn_above?: number
  alert_above?: number
  warn_below?: number
  alert_below?: number
  avl_id?: number
  scale?: number
  offset?: number
  kpi_key?: string
  status_field?: string
  bit_index?: number
  invalid_values?: number[]
  derivative?: boolean
  visible_in_detail?: boolean
  show_in_popup?: boolean
  transform?: SensorTransform
  icon?: SensorIcon
  color?: string
  widget_size?: 'sm' | 'md' | 'lg'
  category?: 'maquina' | 'chasis'
}

export type WsMessage =
  | { type: 'telemetry'; data: VehicleStatus }
  | { type: 'alert'; data: { action: 'fired' | 'silence' | 'resolved'; tenant_id: string; alert_id: string; vehicle_id?: string } }
  | { type: 'connected'; tenant_id: string; data?: never }

export interface DoutSlot {
  slot: number
  label: string
  enabled: boolean
  sensor_key?: string
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

export type PdfMetricKey =
  | 'pto_minutes' | 'pressure_min' | 'pressure_max' | 'rpm_avg' | 'pump_minutes' | 'fuel_l'
export type PdfMetricFormat = 'integer' | 'decimal1' | 'decimal2'

export interface PdfMetricItem {
  key: PdfMetricKey
  label: string
  unit: string
  format: PdfMetricFormat
}

export interface SystemBlock {
  id: string
  name: string
  icon: string
  sensor_keys: string[]
  key_sensor_keys: string[]
  key_count: number
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
  pdf_metrics: PdfMetricItem[]
  system_blocks: SystemBlock[]
  manual_can_slots: ManualCanSlotCfg[]
  manual_can_buttons: ManualCanButtonCfg[]
  // Fabricantes con acceso a esta plantilla (solo poblado para CMG admin).
  manufacturer_ids?: string[]
}

export interface ManualCanSlotCfg {
  id: string
  slot: number
  param_id: number
  description: string
}

export interface ManualCanButtonCfg {
  id: string
  slot_id: string
  byte_index: number
  bit_index: number
  label: string
  function: 'toggle' | 'hold'
  allowed_roles: string[]
  sort_order: number
  active: boolean
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

export interface AlertInstanceEnrichedOut extends AlertInstanceOut {
  rule_name: string
  vehicle_name: string
  severity: RuleSeverity
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
  value?: number | boolean
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

export interface AutoCloseConfig {
  enabled: boolean
  service_signal_key: string
  signal_op: string
  signal_value: boolean | number
  min_active_seconds: number
  min_inactive_seconds: number
  exit_margin_m: number
}

export interface AutoCloseSignal {
  key: string
  label: string
  signal_type: 'bool' | 'numeric'
  recommended_for_service: boolean
}

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
  final_client_name: string | null
  final_client_address: string | null
  doc_number: string | null
  created_by: string | null
  created_at: string
  auto_close_config: AutoCloseConfig | null
  vehicle_name: string | null
  driver_name: string | null
}

export interface WorkOrderTelemetryDetail {
  stops: Array<{
    id: string
    order_index: number
    address: string | null
    client_name: string | null
    arrived_at: string | null
    completed_at: string | null
    telemetry: {
      pto_minutes: number | null
      pressure_min: number | null
      pressure_max: number | null
      rpm_avg: number | null
      pump_minutes: number | null
      fuel_l: number | null
    }
  }>
  pdf_metric_keys: string[]
}

export type WorkOrderStopStatus = 'pending' | 'arrived' | 'in_progress' | 'done' | 'skipped'

export interface WorkOrderStopOut {
  id: string
  work_order_id: string
  order_index: number
  title: string
  address: string | null
  lat: number | null
  lon: number | null
  arrival_radius_m: number
  notes: string | null
  client_name: string | null
  status: WorkOrderStopStatus
  arrived_at: string | null
  started_at: string | null
  completed_at: string | null
  pto_minutes: number | null
  fuel_l: number | null
  rpm_avg: number | null
  pump_minutes: number | null
  pressure_min: number | null
  pressure_max: number | null
  created_at: string
}

export interface WorkOrderStopCreate {
  order_index?: number
  title: string
  address?: string | null
  lat?: number | null
  lon?: number | null
  arrival_radius_m?: number
  notes?: string | null
  client_name?: string | null
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
  archived_at: string | null
  alert_count: number
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
  type: string
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
  owner_tenant_id: string
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

export interface MaintenanceCounter {
  type: string
  label: string
  unit: string
  source_type: string
  source_key: string
  semantics: string
}

export interface MaintenanceProjectionThreshold {
  type: string
  current: number
  limit: number
  pct: number
  days_remaining: number | null
}

export interface MaintenanceProjectionOut {
  status: 'ok' | 'próximo' | 'vencido'
  thresholds: MaintenanceProjectionThreshold[]
}

export interface TenantCreate {
  parent_id: string | null
  tier: 'client' | 'manufacturer'
  name: string
  slug: string
}

export interface TenantUpdate {
  name?: string
  slug?: string
  active?: boolean
  enabled_modules?: string[]
  business_cif?: string | null
  business_address?: string | null
  manufacturer_can_view_operations?: boolean
  manufacturer_can_view_can_data?: boolean
  manufacturer_can_create_rules?: boolean
  manufacturer_can_manage_clients?: boolean
  manufacturer_can_transfer_vehicles?: boolean
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
  sim_phone: string | null
  active: boolean
  out_of_service?: boolean
  out_of_service_since?: string | null
  created_at: string
  total_bytes: number
  month_bytes: number
}

export interface DataUsageMonth {
  year_month: string
  bytes: number
}

export interface DeviceCreate {
  imei: string
  model?: string
  firmware_ver?: string | null
  tenant_id?: string | null
  sim_phone?: string | null
}

export interface DeviceTransfer {
  target_tenant_id: string
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

export interface TripPoint {
  t: string
  lat: number
  lon: number
}

export interface Trip {
  index: number
  start: string
  end: string
  duration_s: number
  distance_km: number
  moving_time_s: number
  avg_speed_kmh: number
  max_speed_kmh: number
  points: TripPoint[]
}

export interface DayTripTotals {
  trips: number
  distance_km: number
  route_time_s: number
  avg_speed_kmh: number
}

export interface DayTrips {
  date: string
  trips: Trip[]
  totals: DayTripTotals
}

export interface SmtpConfig {
  host: string
  port: number
  user: string
  password_set: boolean
  from_addr: string
  tls: boolean
}

export interface SmtpConfigUpdate {
  host: string
  port: number
  user: string
  password: string
  from_addr: string
  tls: boolean
}

export interface MetricTypePreferences {
  keys: string[]
}

export interface UserPreferences {
  historic_metrics: Record<string, MetricTypePreferences>
  // Orden de tarjetas de sensores por tipo de vehículo: {vehicle_type_id: [keys]}
  sensor_order?: Record<string, string[]>
}

export interface MetricTypePatch {
  keys: string[] | null
}

export interface PreferencesPatch {
  historic_metrics?: Record<string, MetricTypePatch>
  sensor_order?: Record<string, string[] | null>
}

export interface MyProfile {
  tenant_id: string
  tier: string
  enabled_modules: string[]
  manufacturer_can_manage_clients: boolean
  manufacturer_can_transfer_vehicles: boolean
  can_actuate_controls: boolean
}
