// Tipos globales — contratos con el backend FastAPI CMG Telematics

export interface User {
  id: number;
  email: string;
  role: 'superadmin' | 'admin' | 'operator' | 'viewer';
  full_name: string;
  tenant_id: number;
}

export interface DeviceInfo {
  imei: string;
  online: boolean;
  last_seen: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
}

export interface LastPosition {
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
  timestamp: string;
}

// Respuesta de GET /api/v1/dashboard/fleet
export interface FleetVehicle {
  vehicle_id: number;
  vehicle_name: string;
  license_plate: string;
  device: DeviceInfo;
  last_position: LastPosition | null;
  active_alerts: number;
}

export interface FleetResponse {
  fleet: FleetVehicle[];
}

// Respuesta de GET /api/v1/vehicles/{id}/last
export interface VehicleLastData {
  lat: number | null;
  lng: number | null;
  speed: number | null;
  ignition: boolean | null;
  ext_voltage_mv: number | null;
  ain1_mv: number | null;
  dout1: number | null;
  dout2: number | null;
  [key: string]: number | boolean | null | undefined;
}

export interface VehicleLastResponse {
  data: VehicleLastData;
  vehicle_name: string;
  imei: string;
  license_plate: string;
}

// Respuesta de GET /api/v1/vehicles/{id}/live-signals
export interface LiveSignal {
  io_key: string;
  display_name: string;
  converted_value: number | string | boolean | null;
  unit: string;
  data_type: string;
}

export interface LiveSignalsResponse {
  signals: LiveSignal[];
}

// Alertas
export type AlertLevel = 'critical' | 'high' | 'warning' | 'info';

export interface Alert {
  id: number;
  vehicle_id: number;
  vehicle_name: string;
  display_name: string;
  level: AlertLevel;
  converted_value: number | string | null;
  threshold: number | string | null;
  unit: string;
  fired_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
}

// Estado de conexión WebSocket
export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'offline';
