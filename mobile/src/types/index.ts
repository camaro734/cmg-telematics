export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface LoginResponse extends AuthTokens {
  logo_url: string | null;
  brand_name: string;
  user_id: string;
  tenant_id: string;
  role: string;
  email: string;
}

export type VehicleStatus = 'online' | 'offline' | 'moving' | 'idle';

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  status: VehicleStatus;
  tenant_id: string;
  vehicle_type_id: string;
  device_id: string | null;
  last_seen: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
}

export interface VehicleStatusData {
  vehicle_id: string;
  ts: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  ignition: boolean;
  pto_active: boolean;
  power_voltage: number | null;
  gsm_signal: number | null;
  can_data: Record<string, number | boolean | null>;
  dout_state: Record<string, boolean>;
  status: VehicleStatus;
}

export interface Alert {
  id: string;
  rule_id: string;
  vehicle_id: string;
  vehicle_name: string;
  rule_name: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'firing' | 'acknowledged' | 'resolved' | 'escalated';
  triggered_at: string;
  resolved_at: string | null;
  ack_at: string | null;
  ack_note: string | null;
  trigger_value: Record<string, unknown> | null;
}

export type WorkOrderStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkOrder {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lon: number | null;
  notes: string | null;
  created_at: string;
}

export interface Driver {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  license_number: string | null;
  license_expiry: string | null;
  notes: string | null;
  active: boolean;
  current_vehicle_id: string | null;
  current_vehicle_name: string | null;
}

export interface KpiData {
  date: string;
  engine_hours: number;
  pto_hours: number;
  distance_km: number;
  fuel_l: number | null;
}

export interface TrackPoint {
  ts: string;
  lat: number;
  lng: number;
  speed: number;
}

export interface DoutConfig {
  channel: number;
  label: string;
}
