"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getFleet, alerts as alertsApi, geofences as geofencesApi, maintenance,
  getRecentEvents,
  type FleetVehicle, type GeofenceOut, type EventEntry, type AlertLogOut,
} from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage, type WsStatus } from "@/lib/websocket";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/toast";

const FleetMap = dynamic(() => import("@/components/FleetMap"), { ssr: false });

const ONLINE_MS = 10 * 60 * 1000;
function isOnlineNow(v: FleetVehicle) {
  return !!v.device?.last_seen && Date.now() - new Date(v.device.last_seen).getTime() < ONLINE_MS;
}

const EVENT_CFG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  ignition_on:    {
    icon: <svg width="8" height="8" fill="none" viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" fill="currentColor"/></svg>,
    color: "#22c55e", bg: "rgba(34,197,94,0.15)",
  },
  ignition_off:   {
    icon: <svg width="8" height="8" fill="none" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg>,
    color: "#64748b", bg: "rgba(100,116,139,0.15)",
  },
  alert:          {
    icon: <svg width="8" height="8" fill="none" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>,
    color: "#ef4444", bg: "rgba(239,68,68,0.15)",
  },
  geofence_enter: {
    icon: <svg width="8" height="8" fill="none" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" opacity=".8"/></svg>,
    color: "#3b82f6", bg: "rgba(59,130,246,0.15)",
  },
  geofence_exit:  {
    icon: <svg width="8" height="8" fill="none" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" strokeWidth="2" fill="none"/></svg>,
    color: "#f59e0b", bg: "rgba(245,158,11,0.15)",
  },
};

export default function DashboardPage() {
  const router = useRouter();

  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [geofenceList, setGeofenceList] = useState<GeofenceOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"fleet" | "events">("fleet");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "moving">("all");
  const [activeAlertCount, setActiveAlertCount] = useState(0);
  const [alertVehicleIds, setAlertVehicleIds] = useState<string[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const { toasts, addToast, dismiss } = useToast();

  // On mobile, collapse panel by default
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setPanelOpen(false);
    }
  }, []);

  const refreshAlertCount = useCallback(async () => {
    try {
      const [countData, activeAlerts] = await Promise.all([
        alertsApi.activeCount(),
        alertsApi.list({ active_only: true, limit: 100 }).catch(() => [] as AlertLogOut[]),
      ]);
      setActiveAlertCount(countData.count);
      setAlertVehicleIds([...new Set(activeAlerts.map(a => a.vehicle_id))]);
    } catch { /* non-critical */ }
  }, []);

  const refreshMaintenance = useCallback(async () => {
    try {
      const summary = await maintenance.summary();
      setOverdueCount(summary.overdue);
    } catch { /* non-critical */ }
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const data = await getRecentEvents(24);
      setEvents(data);
    } catch { /* non-critical */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [fleetData, geofenceData] = await Promise.all([
        getFleet(),
        geofencesApi.list().catch(() => [] as GeofenceOut[]),
      ]);
      setFleet(fleetData.fleet);
      setGeofenceList(geofenceData);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshAlertCount();
    refreshMaintenance();
    refreshEvents();
  }, [refresh, refreshAlertCount, refreshMaintenance, refreshEvents]);

  useEffect(() => {
    const t = setInterval(refreshAlertCount, 60_000);
    return () => clearInterval(t);
  }, [refreshAlertCount]);

  useEffect(() => {
    const t = setInterval(refreshEvents, 120_000);
    return () => clearInterval(t);
  }, [refreshEvents]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
      if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.metaKey) setPanelOpen(o => !o);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useFleetWebSocket(
    useCallback((msg: WsTelemetryMessage) => {
      setLastUpdated(new Date());
      setFleet(prev => prev.map(v => {
        if (v.vehicle_id !== msg.vehicle_id) return v;
        return {
          ...v,
          device: v.device ? { ...v.device, last_seen: msg.time } : undefined,
          last_position: {
            time: msg.time, lat: msg.lat, lng: msg.lng, speed: msg.speed,
            ignition: msg.ignition, ext_voltage_mv: msg.ext_voltage_mv,
            dout1: msg.dout1, dout2: msg.dout2, io_data: msg.io_data,
          },
        };
      }));
    }, []),
    useCallback((alert: WsAlertMessage) => {
      addToast({
        level: alert.level as "high" | "low",
        title: `Alerta ${alert.level === "high" ? "ALTA" : "BAJA"} — ${alert.display_name}`,
        message: `${alert.converted_value.toFixed(1)} ${alert.unit} (umbral: ${alert.threshold} ${alert.unit})`,
      });
      setActiveAlertCount(prev => prev + 1);
      setAlertVehicleIds(prev => prev.includes(alert.vehicle_id) ? prev : [...prev, alert.vehicle_id]);
    }, [addToast]),
    useCallback((status: WsStatus) => setWsStatus(status), []),
  );

  // Derived state
  const onlineCount = fleet.filter(isOnlineNow).length;
  const movingCount = fleet.filter(v => isOnlineNow(v) && v.last_position?.ignition && (v.last_position?.speed ?? 0) > 3).length;

  const filtered = fleet.filter(v => {
    const online = isOnlineNow(v);
    if (filter === "online" && !online) return false;
    if (filter === "moving" && !(v.last_position?.ignition && (v.last_position?.speed ?? 0) > 3)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        v.vehicle_name.toLowerCase().includes(q) ||
        (v.license_plate ?? "").toLowerCase().includes(q) ||
        (v.device?.imei ?? "").includes(q)
      );
    }
    return true;
  });

  const selectedVehicle = selectedId ? fleet.find(v => v.vehicle_id === selectedId) ?? null : null;

  return (
    <div className="flex flex-col h-full">
      <Toast toasts={toasts} onDismiss={dismiss} />

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0 border-b"
        style={{ background: "var(--sidebar)", borderColor: "var(--border)", minHeight: 44 }}
      >
        {/* Toggle panel button */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted)" }}
          title={`${panelOpen ? "Ocultar" : "Mostrar"} panel [B]`}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="18" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="13" y="3" width="8" height="18" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>

        <h1 className="text-sm font-bold text-white flex-shrink-0 hidden sm:block">Flota en vivo</h1>

        {/* WS status */}
        <span
          className="flex items-center gap-1 text-xs flex-shrink-0"
          style={{
            color: wsStatus === "connected" ? "var(--success)"
                 : wsStatus === "connecting" ? "var(--warning)"
                 : "var(--muted)",
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%", display: "inline-block",
            background: wsStatus === "connected" ? "var(--success)"
                      : wsStatus === "connecting" ? "var(--warning)" : "#64748b",
            animation: wsStatus === "connected" ? "pulse 2s infinite" : "none",
          }} />
          <span className="hidden sm:inline">
            {wsStatus === "connected" ? "En directo" : wsStatus === "connecting" ? "Conectando..." : "Sin conexión"}
          </span>
        </span>

        {/* KPI chips */}
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto min-w-0">
          <KpiChip
            label={`${onlineCount}/${fleet.length} En línea`}
            color="var(--success)"
            dot
          />
          <KpiChip
            label={`${movingCount} En mov.`}
            color="var(--accent)"
          />
          <KpiChip
            label={`${activeAlertCount} Alertas`}
            color={activeAlertCount > 0 ? "#ef4444" : "var(--muted)"}
            urgent={activeAlertCount > 0}
            onClick={() => router.push("/alerts")}
          />
          {overdueCount > 0 && (
            <KpiChip
              label={`${overdueCount} Vencido`}
              color="#f97316"
              urgent
              onClick={() => router.push("/maintenance")}
            />
          )}
        </div>

        {/* Last updated */}
        {lastUpdated && (
          <span className="text-xs flex-shrink-0 hidden md:block" style={{ color: "var(--muted)" }}>
            {lastUpdated.toLocaleTimeString("es-ES")}
          </span>
        )}

        {/* Refresh */}
        <button
          onClick={refresh}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted)" }}
          title="Actualizar"
        >
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
            <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left panel ────────────────────────────────────────────────────── */}
        {panelOpen && (
          <div
            className="flex flex-col flex-shrink-0 border-r overflow-hidden"
            style={{ width: 240, borderColor: "var(--border)", background: "var(--sidebar)" }}
          >
            {/* Tabs */}
            <div className="flex p-2 gap-1 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              {(["fleet", "events"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: sidebarTab === tab ? "var(--accent)" : "rgba(255,255,255,0.05)",
                    color: sidebarTab === tab ? "#fff" : "var(--muted)",
                  }}
                >
                  {tab === "fleet" ? `Vehículos (${fleet.length})` : "Actividad"}
                </button>
              ))}
            </div>

            {/* Fleet tab */}
            {sidebarTab === "fleet" && (
              <>
                {/* Search */}
                <div className="px-2 pt-2 pb-1 flex-shrink-0">
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2" width="11" height="11"
                         fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)" }}>
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                      <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs text-white"
                      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                    />
                  </div>
                </div>

                {/* Filter pills */}
                <div className="flex gap-1 px-2 pb-2 flex-shrink-0">
                  {(["all", "online", "moving"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className="flex-1 py-1 rounded-full text-xs font-medium transition-colors"
                      style={{
                        background: filter === f ? "rgba(29,158,117,0.2)" : "rgba(255,255,255,0.04)",
                        color: filter === f ? "var(--accent)" : "var(--muted)",
                        border: `1px solid ${filter === f ? "rgba(29,158,117,0.4)" : "var(--border)"}`,
                      }}
                    >
                      {f === "all" ? "Todos" : f === "online" ? "En línea" : "Mov."}
                    </button>
                  ))}
                </div>

                {/* Vehicle list */}
                <div className="flex flex-col overflow-y-auto flex-1 px-2 pb-2 gap-1">
                  {filtered.length === 0 && (
                    <div className="text-xs text-center py-6" style={{ color: "var(--muted)" }}>
                      Sin resultados
                    </div>
                  )}
                  {filtered.map(v => {
                    const online = isOnlineNow(v);
                    const pos = v.last_position;
                    const isSelected = v.vehicle_id === selectedId;
                    const hasAlert = alertVehicleIds.includes(v.vehicle_id);
                    return (
                      <button
                        key={v.vehicle_id}
                        onClick={() => setSelectedId(isSelected ? null : v.vehicle_id)}
                        className="rounded-xl p-3 text-left transition-all w-full"
                        style={{
                          background: isSelected ? "rgba(29,158,117,0.12)" : "var(--card)",
                          border: `1px solid ${isSelected ? "var(--accent)" : hasAlert ? "#ef444466" : "var(--border)"}`,
                        }}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-semibold text-white truncate pr-1">{v.vehicle_name}</span>
                          <span
                            className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                            style={{ background: hasAlert ? "#ef4444" : online ? "var(--success)" : "#64748b" }}
                          />
                        </div>
                        {v.license_plate && (
                          <div className="text-xs" style={{ color: "var(--muted)", fontSize: 10 }}>{v.license_plate}</div>
                        )}
                        {pos && online && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs" style={{ color: pos.speed && pos.speed > 3 ? "var(--success)" : "var(--muted)", fontSize: 10 }}>
                              {pos.speed ?? 0} km/h
                            </span>
                            <span className="text-xs" style={{ color: pos.ignition ? "var(--success)" : "var(--muted)", fontSize: 10 }}>
                              {pos.ignition ? "IGN ON" : "IGN OFF"}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Events tab */}
            {sidebarTab === "events" && (
              <div className="flex flex-col overflow-y-auto flex-1 p-2 relative">
                {events.length === 0 ? (
                  <div className="text-xs text-center py-6" style={{ color: "var(--muted)" }}>
                    Sin actividad en las últimas 24h
                  </div>
                ) : (
                  <div className="relative pl-7">
                    <div className="absolute left-3 top-2 bottom-2 w-px" style={{ background: "var(--border)" }} />
                    {events.slice(0, 60).map((ev, i) => {
                      const cfg = EVENT_CFG[ev.event_type] ?? { icon: <svg width="6" height="6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>, color: "var(--muted)", bg: "var(--card)" };
                      return (
                        <div key={i} className="relative mb-2">
                          <div
                            className="absolute -left-4 top-2 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}` }}
                          >
                            {cfg.icon}
                          </div>
                          <div className="rounded-lg px-3 py-2" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                            <div className="text-xs font-semibold text-white truncate">{ev.vehicle_name}</div>
                            <div className="text-xs truncate" style={{ color: cfg.color }}>
                              {ev.detail ?? ev.event_type.replace(/_/g, " ")}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: "var(--muted)", fontSize: 10 }}>
                              {new Date(ev.event_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Map ───────────────────────────────────────────────────────────── */}
        <div className="flex-1 relative min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--muted)" }}>
              Cargando mapa...
            </div>
          ) : (
            <FleetMap
              fleet={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              geofences={geofenceList}
              alertVehicleIds={alertVehicleIds}
            />
          )}
        </div>

        {/* ── Right detail panel ────────────────────────────────────────────── */}
        {selectedVehicle && <VehicleDetailPanel vehicle={selectedVehicle} alertVehicleIds={alertVehicleIds} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

// ── KPI chip ─────────────────────────────────────────────────────────────────
function KpiChip({
  label, color, dot, urgent, onClick,
}: {
  label: string;
  color: string;
  dot?: boolean;
  urgent?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
      style={{
        background: urgent ? `${color}22` : "rgba(255,255,255,0.06)",
        color,
        border: `1px solid ${urgent ? `${color}44` : "var(--border)"}`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {dot && (
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      )}
      {label}
    </Tag>
  );
}

// ── Vehicle detail panel ──────────────────────────────────────────────────────
function VehicleDetailPanel({
  vehicle: v, alertVehicleIds, onClose,
}: {
  vehicle: FleetVehicle;
  alertVehicleIds: string[];
  onClose: () => void;
}) {
  const online = isOnlineNow(v);
  const pos = v.last_position;
  const pressure = pos?.io_data?.["9"] != null ? (pos.io_data["9"] * 0.006).toFixed(1) : null;
  const isMoving = pos?.ignition && (pos?.speed ?? 0) > 3;
  const hasAlert = alertVehicleIds.includes(v.vehicle_id);

  return (
    <div
      className="flex-shrink-0 overflow-y-auto border-l"
      style={{ width: 248, borderColor: "var(--border)", background: "var(--sidebar)" }}
    >
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-start justify-between mb-1">
          <div className="font-semibold text-white text-sm leading-tight">{v.vehicle_name}</div>
          <button onClick={onClose} style={{ color: "var(--muted)", flexShrink: 0, padding: 2 }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {v.license_plate && (
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{v.license_plate}</div>
        )}
        <div className="flex flex-wrap gap-1">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: online ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
              color: online ? "var(--success)" : "var(--muted)",
            }}
          >
            {online ? "En línea" : "Offline"}
          </span>
          {hasAlert && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
              Alerta activa
            </span>
          )}
        </div>
      </div>

      {pos ? (
        <div className="p-4 space-y-3">
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Velocidad", value: `${pos.speed ?? 0} km/h`, color: isMoving ? "#3b82f6" : "var(--muted)" },
              { label: "Ignición",  value: pos.ignition ? "ON" : "OFF", color: pos.ignition ? "var(--success)" : "var(--muted)" },
              ...(pressure ? [{ label: "Presión", value: `${pressure} bar`, color: "var(--warning)" }] : []),
              { label: "Voltaje", value: pos.ext_voltage_mv ? `${(pos.ext_voltage_mv / 1000).toFixed(1)} V` : "–", color: "white" },
            ].map(item => (
              <div key={item.label} className="rounded-lg p-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="text-xs mb-0.5" style={{ color: "var(--muted)", fontSize: 10 }}>{item.label}</div>
                <div className="text-sm font-semibold" style={{ color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Coordinates */}
          {pos.lat != null && pos.lng != null && (
            <div className="text-xs space-y-0.5 px-1" style={{ color: "var(--muted)", fontSize: 10 }}>
              <div>Lat {pos.lat.toFixed(5)} · Lng {pos.lng.toFixed(5)}</div>
              <div>Actualizado: {new Date(pos.time).toLocaleTimeString("es-ES")}</div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-1.5 pt-1">
            <Link
              href={`/vehicles/${v.vehicle_id}`}
              className="text-center text-xs py-2 rounded-lg font-medium"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Ver detalle →
            </Link>
            <Link
              href={`/trips?vehicle=${v.vehicle_id}`}
              className="text-center text-xs py-1.5 rounded-lg"
              style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}
            >
              Ver rutas
            </Link>
            {pos.lat != null && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lng}&zoom=16`}
                target="_blank" rel="noreferrer"
                className="text-center text-xs py-1.5 rounded-lg"
                style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Abrir en OSM ↗
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 text-xs text-center" style={{ color: "var(--muted)" }}>
          Sin datos de telemetría
        </div>
      )}
    </div>
  );
}
