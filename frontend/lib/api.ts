const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cmg_token");
}

export function saveToken(token: string) {
  localStorage.setItem("cmg_token", token);
}

export function clearToken() {
  localStorage.removeItem("cmg_token");
  localStorage.removeItem("cmg_user");
}

/** Decode JWT payload without verifying signature (client-side only). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/** Returns true if the token expires within the next 5 minutes. */
function tokenExpiresSoon(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  const expiresAt = payload.exp * 1000; // ms
  return Date.now() > expiresAt - 5 * 60 * 1000;
}

let _refreshPromise: Promise<void> | null = null;

async function maybeRefreshToken(): Promise<void> {
  const token = getToken();
  if (!token || !tokenExpiresSoon(token)) return;

  // Avoid multiple concurrent refresh calls
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        saveToken(data.access_token);
      }
      // If refresh fails we let the next real request surface the 401
    } catch {
      // network error — ignore, let next request handle it
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  await maybeRefreshToken();
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (Array.isArray(err.detail)) {
      const messages = err.detail.map((e: { loc?: string[]; msg: string }) => {
        const field = e.loc ? e.loc.filter((p: string) => p !== "body").join(".") : "";
        return field ? `${field}: ${e.msg}` : e.msg;
      });
      throw new Error(messages.join(" · "));
    }
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

// ─── Auth / Profile ───────────────────────────────────────────────────────────

export interface MeResponse {
  id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string;
  active: boolean;
}

export async function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/v1/auth/me");
}

export async function updateMe(fullName: string): Promise<MeResponse> {
  return request<MeResponse>("/api/v1/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ full_name: fullName }),
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ detail: string }> {
  return request<{ detail: string }>("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

// Auth
export async function login(email: string, password: string) {
  const data = await request<{
    access_token: string;
    user_id: string;
    email: string;
    role: string;
  }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveToken(data.access_token);
  // Fetch full profile to store full_name for sidebar display
  try {
    const me = await request<MeResponse>("/api/v1/auth/me");
    localStorage.setItem("cmg_user", JSON.stringify({
      email: data.email,
      role: data.role,
      full_name: me.full_name,
      tenant_id: me.tenant_id,
    }));
  } catch {
    localStorage.setItem("cmg_user", JSON.stringify({ email: data.email, role: data.role }));
  }
  return data;
}

// Fleet
export async function getFleet() {
  return request<{
    fleet: FleetVehicle[];
    total: number;
  }>("/api/v1/dashboard/fleet");
}

// Vehicles
export async function getVehicles() {
  return request<Vehicle[]>("/api/v1/vehicles");
}

export interface LiveSignal {
  io_key: string;
  display_name: string;
  raw_value: number | null;
  converted_value: number | null;
  unit: string;
  scale_factor: number;
  offset: number;
  data_type: string; // "boolean" | "gauge" | "counter" | "hours"
  is_configured: boolean;
  source: string; // "named_column" | "io_data"
}

export interface LiveSignalsResponse {
  vehicle_id: string;
  device_id: string | null;
  imei: string | null;
  as_of: string | null;
  signals: LiveSignal[];
}

export function getLiveSignals(vehicleId: string): Promise<LiveSignalsResponse> {
  return request<LiveSignalsResponse>(`/api/v1/vehicles/${vehicleId}/live-signals`);
}

export async function getLastTelemetry(vehicleId: string) {
  return request<LastTelemetry>(`/api/v1/vehicles/${vehicleId}/last`);
}

export async function getTelemetryHistory(vehicleId: string, hours = 24) {
  return request<TelemetryHistory>(`/api/v1/vehicles/${vehicleId}/telemetry?hours=${hours}`);
}

export async function getTrips(vehicleId: string, start: string, end: string) {
  return request<Trip[]>(
    `/api/v1/vehicles/${vehicleId}/trips?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  )
}

export async function getTripTrack(vehicleId: string, tripNum: number, start: string, end: string) {
  return request<TrackPoint[]>(
    `/api/v1/vehicles/${vehicleId}/trips/${tripNum}/track?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  )
}

// Commands
export async function sendCommand(imei: string, output: string, value: boolean) {
  return request<{ command_id: string; status: string; command: string }>(
    "/api/v1/commands/send",
    {
      method: "POST",
      body: JSON.stringify({ imei, output, value, duration_seconds: 0 }),
    }
  );
}

export async function getCommandStatus(commandId: string) {
  return request<CommandStatus>(`/api/v1/commands/${commandId}/status`);
}

export interface CommandHistoryEntry {
  id: string;
  command: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
  error_message: string | null;
  issued_by_email: string | null;
  issued_by_name: string | null;
}

export async function getCommandHistory(vehicleId: string, limit = 10) {
  return request<CommandHistoryEntry[]>(
    `/api/v1/commands/history?vehicle_id=${vehicleId}&limit=${limit}`
  );
}

// Analytics
export async function getFleetAnalytics(hours: number = 24) {
  return request<FleetAnalytics>(`/api/v1/dashboard/analytics?hours=${hours}`);
}

export async function getVehicleStats(hours: number = 24) {
  return request<VehicleStats[]>(`/api/v1/dashboard/vehicle-stats?hours=${hours}`);
}

// Health
export async function getHealth() {
  return request<{ status: string; tcp_server: string; db: string; redis: string }>("/health");
}

// Types
export interface FleetVehicle {
  vehicle_id: string;
  vehicle_name: string;
  license_plate: string | null;
  device?: {
    imei: string;
    online: boolean;
    last_seen: string | null;
  };
  last_position?: {
    time: string;
    lat: number | null;
    lng: number | null;
    speed: number | null;
    ignition: boolean | null;
    ext_voltage_mv: number | null;
    dout1: boolean | null;
    dout2: boolean | null;
    io_data: Record<string, number> | null;
  };
}

export interface Vehicle {
  id: string;
  name: string;
  license_plate: string | null;
  tenant_id: string;
  device_imei: string | null;
  device_online: boolean | null;
}

export interface LastTelemetry {
  device_id: string;
  imei: string;
  vehicle_name?: string;
  license_plate?: string | null;
  online: boolean;
  last_seen: string | null;
  data: {
    time: string;
    lat: number | null;
    lng: number | null;
    speed: number | null;
    altitude: number | null;
    satellites: number | null;
    ignition: boolean | null;
    ext_voltage_mv: number | null;
    dout1: boolean | null;
    dout2: boolean | null;
    dout3: boolean | null;
    dout4: boolean | null;
    io_data: Record<string, number> | null;
  } | null;
}

export interface TelemetryHistory {
  device_id: string;
  imei: string;
  from: string;
  buckets: TelemetryBucket[];
}

export interface TelemetryBucket {
  bucket: string;
  lat: number | null;
  lng: number | null;
  max_speed: number | null;
  avg_speed: number | null;
  ignition: boolean | null;
  ext_voltage_mv: number | null;
  dout1: boolean | null;
  dout2: boolean | null;
  ain1_mv: number | null;
  ain2_mv: number | null;
  record_count: number;
}

export interface Trip {
  trip_num: number
  start_time: string
  end_time: string
  duration_seconds: number
  max_speed: number
  avg_speed: number
  distance_km: number
  record_count: number
  start_lat: number | null
  start_lng: number | null
  end_lat: number | null
  end_lng: number | null
}

export interface TrackPoint {
  time: string
  lat: number
  lng: number
  speed: number
}

export interface CommandStatus {
  id: string;
  command: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
  error_message: string | null;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface TenantOut {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  active: boolean;
  brand_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  custom_domain: string | null;
}

export interface UserOut {
  id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string;
  active: boolean;
  notify_email: boolean;
}

export interface VehicleAdminOut {
  id: string;
  name: string;
  license_plate: string | null;
  tenant_id: string;
  tenant_name: string;
  manufacturer_id: string | null;
  manufacturer_name: string;
  device_imei: string | null;
  device_online: boolean | null;
}

// ─── Variable Maps ────────────────────────────────────────────────────────────

export interface VariableMapOut {
  id: string;
  vehicle_id: string | null;
  tenant_id: string | null;
  scope: "manufacturer" | "vehicle";
  io_key: string;
  display_name: string;
  unit: string | null;
  scale_factor: number;
  offset: number;
  alert_low: number | null;
  alert_high: number | null;
  data_type: string;
  created_at: string;
}

export const variableMaps = {
  list: (params: { vehicle_id?: string; tenant_id?: string }) => {
    const qs = new URLSearchParams();
    if (params.vehicle_id) qs.set("vehicle_id", params.vehicle_id);
    if (params.tenant_id) qs.set("tenant_id", params.tenant_id);
    return request<VariableMapOut[]>(`/api/v1/variable-maps?${qs.toString()}`);
  },
  listResolved: (vehicle_id: string) =>
    request<VariableMapOut[]>(`/api/v1/variable-maps/resolved?vehicle_id=${vehicle_id}`),
  create: (body: {
    vehicle_id?: string;
    tenant_id?: string;
    io_key: string;
    display_name: string;
    unit?: string;
    scale_factor?: number;
    offset?: number;
    alert_low?: number | null;
    alert_high?: number | null;
    data_type?: string;
  }) =>
    request<VariableMapOut>("/api/v1/variable-maps", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: object) =>
    request<VariableMapOut>(`/api/v1/variable-maps/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  delete: (id: string) =>
    request<void>(`/api/v1/variable-maps/${id}`, { method: "DELETE" }),
};

// ─── Alerts ──────────────────────────────────────────────────────────────────

export interface AlertLogOut {
  id: string;
  device_id: string;
  vehicle_id: string;
  io_key: string;
  display_name: string;
  level: string; // "high" | "low"
  raw_value: number;
  converted_value: number;
  threshold: number;
  unit: string;
  fired_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
  vehicle_name: string | null;
}

export interface AlertRuleOut {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  name: string;
  description: string | null;
  io_key: string;
  display_name: string;
  condition: string; // "gt" | "lt" | "gte" | "lte" | "eq" | "neq"
  threshold: number;
  scale_factor: number;
  offset: number;
  unit: string;
  level: string; // "high" | "medium" | "low"
  cooldown_minutes: number;
  active: boolean;
  created_at: string;
  vehicle_name: string | null;
}

export interface ConditionOption {
  key: string;
  label: string;
}

export const alerts = {
  list: (params?: {
    vehicle_id?: string;
    level?: string;
    active_only?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.vehicle_id) qs.set("vehicle_id", params.vehicle_id);
    if (params?.level) qs.set("level", params.level);
    if (params?.active_only) qs.set("active_only", "true");
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return request<AlertLogOut[]>(`/api/v1/alerts${query ? "?" + query : ""}`);
  },
  activeCount: () =>
    request<{ count: number }>("/api/v1/alerts/active/count"),
  acknowledge: (id: string) =>
    request<{ id: string; acknowledged_at: string }>(
      `/api/v1/alerts/${id}/acknowledge`,
      { method: "POST" }
    ),
};

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface FleetAnalytics {
  period_hours: number;
  total_distance_km: number;
  total_ignition_hours: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  total_records: number;
  vehicles_active: number;
  vehicles_total: number;
  pressure_avg_bar: number | null;
  pressure_max_bar: number | null;
}

export interface VehicleStats {
  vehicle_id: string;
  vehicle_name: string;
  records: number;
  ignition_hours: number;
  distance_km: number;
  max_speed: number;
  avg_pressure_bar: number | null;
  online: boolean;
}

// ─── Geofences ───────────────────────────────────────────────────────────────

export interface GeofenceOut {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  shape_type: "circle" | "polygon";
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  polygon_points: Array<{ lat: number; lng: number }> | null;
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

export interface GeofenceEventOut {
  id: string;
  geofence_id: string;
  geofence_name: string;
  vehicle_id: string;
  vehicle_name: string | null;
  device_id: string;
  event_type: "enter" | "exit";
  occurred_at: string;
  lat: number;
  lng: number;
}

export const geofences = {
  list: () => request<GeofenceOut[]>("/api/v1/geofences"),
  create: (body: {
    name: string;
    description?: string;
    shape_type: "circle" | "polygon";
    center_lat?: number;
    center_lng?: number;
    radius_m?: number;
    polygon_points?: Array<{ lat: number; lng: number }>;
    alert_on_enter?: boolean;
    alert_on_exit?: boolean;
  }) =>
    request<GeofenceOut>("/api/v1/geofences", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: object) =>
    request<GeofenceOut>(`/api/v1/geofences/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  delete: (id: string) =>
    request<void>(`/api/v1/geofences/${id}`, { method: "DELETE" }),
  listEvents: (params?: { vehicle_id?: string; geofence_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.vehicle_id) qs.set("vehicle_id", params.vehicle_id);
    if (params?.geofence_id) qs.set("geofence_id", params.geofence_id);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<GeofenceEventOut[]>(`/api/v1/geofences/events${query ? "?" + query : ""}`);
  },
};

// ─── Eco-Driving ─────────────────────────────────────────────────────────────

export interface EcoDrivingEvent {
  event_type: string; // "speeding" | "harsh_braking" | "harsh_acceleration" | "idling"
  count: number;
  penalty: number;
}

export interface EcoDrivingScore {
  vehicle_id: string;
  vehicle_name: string;
  period_hours: number;
  score: number;       // 0-100
  grade: string;       // A/B/C/D/F
  events: EcoDrivingEvent[];
  total_records: number;
  distance_km: number;
  ignition_hours: number;
}

export async function getEcoDrivingScores(hours: number = 24, vehicleId?: string) {
  const qs = new URLSearchParams();
  qs.set("hours", String(hours));
  if (vehicleId) qs.set("vehicle_id", vehicleId);
  return request<EcoDrivingScore[]>(`/api/v1/ecodriving/scores?${qs.toString()}`);
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

export interface MaintenanceTaskOut {
  id: string;
  vehicle_id: string;
  name: string;
  description: string | null;
  trigger_type: string; // "km" | "hours" | "days" | "date"
  interval_value: number | null;
  next_due_km: number | null;
  next_due_hours: number | null;
  next_due_date: string | null;
  warn_before: number;
  active: boolean;
  created_at: string;
  status: string; // "ok" | "warning" | "overdue"
  vehicle_name: string | null;
  pto_io_key: string; // IO signal used to count engine hours
  current_hours: number | null; // accumulated hours since last maintenance
  last_maintenance_at: string | null; // when last maintenance was done
}

export interface IoKeyOption {
  key: string;
  label: string;
}

export interface MaintenanceLogOut {
  id: string;
  task_id: string;
  vehicle_id: string;
  performed_at: string;
  performed_by: string | null;
  notes: string | null;
  odometer_km: number | null;
  created_at: string;
}

export interface MaintenanceLogCreate {
  task_id: string;
  performed_at: string;
  notes?: string;
  odometer_km?: number;
}

export interface MaintenanceSummary {
  overdue: number;
  warning: number;
  ok: number;
}

export const maintenance = {
  listTasks: (params?: { vehicle_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.vehicle_id) qs.set("vehicle_id", params.vehicle_id);
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString();
    return request<MaintenanceTaskOut[]>(`/api/v1/maintenance/tasks${query ? "?" + query : ""}`);
  },
  createTask: (body: {
    vehicle_id: string;
    name: string;
    description?: string;
    trigger_type: string;
    interval_value?: number;
    next_due_km?: number;
    next_due_hours?: number;
    next_due_date?: string;
    warn_before?: number;
    pto_io_key?: string;
  }) =>
    request<MaintenanceTaskOut>("/api/v1/maintenance/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  fetchIoKeys: () => request<IoKeyOption[]>("/api/v1/maintenance/io-keys"),
  updateTask: (id: string, body: object) =>
    request<MaintenanceTaskOut>(`/api/v1/maintenance/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTask: (id: string) =>
    request<void>(`/api/v1/maintenance/tasks/${id}`, { method: "DELETE" }),

  listLogs: (params?: { vehicle_id?: string; task_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.vehicle_id) qs.set("vehicle_id", params.vehicle_id);
    if (params?.task_id) qs.set("task_id", params.task_id);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<MaintenanceLogOut[]>(`/api/v1/maintenance/logs${query ? "?" + query : ""}`);
  },
  completeTask: (body: MaintenanceLogCreate) =>
    request<MaintenanceLogOut>("/api/v1/maintenance/logs", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  summary: () => request<MaintenanceSummary>("/api/v1/maintenance/summary"),
};

export async function uploadLogo(file: File): Promise<{ url: string }> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/upload/logo`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchMyBranding(): Promise<{
  tenant_id: string | null;
  brand_name: string;
  brand_color: string;
  logo_url: string | null;
  is_custom: boolean;
}> {
  return request("/api/v1/branding/me");
}

export const admin = {
  // Tenants
  listTenants: () => request<TenantOut[]>("/api/v1/admin/tenants"),
  createTenant: (body: { name: string; type: string; parent_id?: string }) =>
    request<TenantOut>("/api/v1/admin/tenants", { method: "POST", body: JSON.stringify(body) }),
  updateTenant: (id: string, body: object) =>
    request<TenantOut>(`/api/v1/admin/tenants/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Users
  listUsers: () => request<UserOut[]>("/api/v1/admin/users"),
  createUser: (body: { email: string; password: string; full_name: string; role: string; tenant_id: string }) =>
    request<UserOut>("/api/v1/admin/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: object) =>
    request<UserOut>(`/api/v1/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  toggleNotifyEmail: (id: string, value: boolean) =>
    request(`/api/v1/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ notify_email: value }) }),

  // Vehicles
  listVehicles: () => request<VehicleAdminOut[]>("/api/v1/admin/vehicles"),
  createVehicle: (body: { name: string; license_plate?: string; tenant_id?: string; manufacturer_id?: string; imei?: string }) =>
    request("/api/v1/admin/vehicles", { method: "POST", body: JSON.stringify(body) }),
  updateVehicle: (id: string, body: object) =>
    request(`/api/v1/admin/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};

// ─── Events feed ─────────────────────────────────────────────────────────────

export interface EventEntry {
  event_time: string;
  event_type: string; // "ignition_on" | "ignition_off" | "alert" | "geofence_enter" | "geofence_exit"
  vehicle_id: string;
  vehicle_name: string;
  detail: string | null;
  severity: string; // "info" | "warning" | "danger"
}

export async function getRecentEvents(hours = 24, vehicleId?: string): Promise<EventEntry[]> {
  const qs = new URLSearchParams({ hours: String(hours) });
  if (vehicleId) qs.set("vehicle_id", vehicleId);
  return request<EventEntry[]>(`/api/v1/events?${qs.toString()}`);
}

// ─── Notification Config ──────────────────────────────────────────────────────

export interface NotificationConfig {
  id: string;
  tenant_id: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  smtp_from_name: string;
  smtp_tls: boolean;
  smtp_ssl: boolean;
  notify_level_high: boolean;
  notify_level_medium: boolean;
  notify_level_low: boolean;
  active: boolean;
}

export const notificationConfig = {
  get: () => request<NotificationConfig>("/api/v1/notification-config"),
  save: (data: Partial<NotificationConfig>) =>
    request<NotificationConfig>("/api/v1/notification-config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  test: (email: string) =>
    request<{ status: string; message: string }>("/api/v1/notification-config/test", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
};

// ─── Alert Rules ──────────────────────────────────────────────────────────────

export const alertRules = {
  list: (params?: { vehicle_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.vehicle_id) qs.set("vehicle_id", params.vehicle_id);
    const q = qs.toString();
    return request<AlertRuleOut[]>(`/api/v1/alert-rules${q ? "?" + q : ""}`);
  },
  create: (body: {
    vehicle_id?: string | null;
    name: string;
    description?: string;
    io_key: string;
    display_name: string;
    condition: string;
    threshold: number;
    scale_factor?: number;
    offset?: number;
    unit?: string;
    level: string;
    cooldown_minutes?: number;
  }) =>
    request<AlertRuleOut>("/api/v1/alert-rules", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<{
    name: string;
    description: string;
    io_key: string;
    display_name: string;
    condition: string;
    threshold: number;
    scale_factor: number;
    offset: number;
    unit: string;
    level: string;
    cooldown_minutes: number;
    active: boolean;
  }>) =>
    request<AlertRuleOut>(`/api/v1/alert-rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  delete: (id: string) =>
    request<void>(`/api/v1/alert-rules/${id}`, { method: "DELETE" }),
  listConditions: () => request<ConditionOption[]>("/api/v1/alert-rules/conditions"),
};
