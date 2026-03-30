"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getFleet, alerts as alertsApi, geofences as geofencesApi, maintenance, getRecentEvents, type FleetVehicle, type GeofenceOut, type EventEntry } from "@/lib/api";
import StatCard from "@/components/StatCard";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage } from "@/lib/websocket";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/toast";

const FleetMap = dynamic(() => import("@/components/FleetMap"), { ssr: false });

export default function DashboardPage() {
  const router = useRouter();
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [geofenceList, setGeofenceList] = useState<GeofenceOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [wsLive, setWsLive] = useState(false);
  const [activeAlertCount, setActiveAlertCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"fleet" | "events">("fleet");
  const { toasts, addToast, dismiss } = useToast();

  const refreshAlertCount = useCallback(async () => {
    try {
      const data = await alertsApi.activeCount();
      setActiveAlertCount(data.count);
    } catch {
      // non-critical — ignore
    }
  }, []);

  const refreshMaintenance = useCallback(async () => {
    try {
      const summary = await maintenance.summary();
      setOverdueCount(summary.overdue);
    } catch {
      // non-critical — ignore
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const data = await getRecentEvents(24);
      setEvents(data);
    } catch {
      // non-critical — ignore
    }
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
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando flota");
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

  // Refresh alert count every 60 seconds, events every 2 minutes
  useEffect(() => {
    const interval = setInterval(refreshAlertCount, 60_000);
    return () => clearInterval(interval);
  }, [refreshAlertCount]);

  useEffect(() => {
    const interval = setInterval(refreshEvents, 120_000);
    return () => clearInterval(interval);
  }, [refreshEvents]);

  useFleetWebSocket(
    useCallback((msg: WsTelemetryMessage) => {
      setWsLive(true);
      setLastUpdated(new Date());
      setFleet(prev => prev.map(v => {
        if (v.vehicle_id !== msg.vehicle_id) return v;
        return {
          ...v,
          last_position: {
            time: msg.time,
            lat: msg.lat,
            lng: msg.lng,
            speed: msg.speed,
            ignition: msg.ignition,
            ext_voltage_mv: msg.ext_voltage_mv,
            dout1: msg.dout1,
            dout2: msg.dout2,
            io_data: msg.io_data,
          },
        };
      }));
    }, []),
    useCallback((alert: WsAlertMessage) => {
      addToast({
        level: alert.level as 'high' | 'low',
        title: `Alerta ${alert.level === 'high' ? 'ALTA' : 'BAJA'} — ${alert.display_name}`,
        message: `${alert.converted_value.toFixed(1)} ${alert.unit} (umbral: ${alert.threshold} ${alert.unit})`,
      });
      setActiveAlertCount(prev => prev + 1);
    }, [addToast]),
  );

  const online = fleet.filter(v => v.device?.online).length;
  const withPosition = fleet.filter(v => v.device?.online && v.last_position?.lat != null).length;
  const ignitionOn = fleet.filter(v => v.last_position?.ignition).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b"
           style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-white">Panel de Flota</h1>
            {wsLive && (
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--success)" }}>
                <span style={{ fontSize: 10 }}>●</span>
                En vivo
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {lastUpdated ? `Actualizado: ${lastUpdated.toLocaleTimeString("es-ES")}` : "Cargando..."}
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 px-6 pt-4">
        <StatCard
          label="En línea"
          value={online}
          unit={`/ ${fleet.length}`}
          color="var(--success)"
          icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>}
        />
        <StatCard
          label="Con GPS"
          value={withPosition}
          color="var(--accent)"
          icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
              stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>}
        />
        <StatCard
          label="Ignición ON"
          value={ignitionOn}
          color="var(--warning)"
          icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>}
        />
        <div
          className="cursor-pointer"
          onClick={() => router.push("/alerts")}
          title="Ver alertas activas"
        >
          <StatCard
            label="Alertas activas"
            value={activeAlertCount}
            color={activeAlertCount > 0 ? "#ef4444" : "var(--muted)"}
            icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>}
          />
        </div>
        <div
          className="cursor-pointer"
          onClick={() => router.push("/maintenance")}
          title="Ver tareas de mantenimiento"
        >
          <StatCard
            label="Mant. vencido"
            value={overdueCount}
            color={overdueCount > 0 ? "#f97316" : "var(--muted)"}
            icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>}
          />
        </div>
      </div>

      {/* Analytics shortcut */}
      <div className="px-6 pt-1 pb-0 flex justify-end">
        <Link
          href="/analytics"
          className="text-xs transition-colors"
          style={{ color: "var(--muted)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
        >
          Ver analíticas →
        </Link>
      </div>

      {error && (
        <div className="mx-6 mt-3 px-4 py-3 rounded-lg text-sm" style={{ background: "#450a0a", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />

      {/* Main: map + list */}
      <div className="flex flex-1 gap-4 px-6 py-4 min-h-0">
        {/* Map */}
        <div className="flex-1 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {loading ? (
            <div className="h-full flex items-center justify-center" style={{ color: "var(--muted)" }}>
              Cargando mapa...
            </div>
          ) : (
            <FleetMap fleet={fleet} selectedId={selectedId} onSelect={setSelectedId} geofences={geofenceList} />
          )}
        </div>

        {/* Right sidebar: fleet list + events feed */}
        <div className="flex flex-col" style={{ width: 280 }}>
          {/* Tabs */}
          <div className="flex rounded-lg mb-2 p-0.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            {(["fleet", "events"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: sidebarTab === tab ? "var(--accent)" : "transparent",
                  color: sidebarTab === tab ? "#fff" : "var(--muted)",
                }}
              >
                {tab === "fleet" ? `Flota (${fleet.length})` : `Actividad`}
              </button>
            ))}
          </div>

          {/* Fleet list */}
          {sidebarTab === "fleet" && (
            <div className="flex flex-col gap-2 overflow-y-auto flex-1">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-xl h-24 animate-pulse"
                         style={{ background: "var(--card)" }} />
                  ))
                : fleet.map(vehicle => (
                    <VehicleCard
                      key={vehicle.vehicle_id}
                      vehicle={vehicle}
                      selected={selectedId === vehicle.vehicle_id}
                      onSelect={() => setSelectedId(
                        selectedId === vehicle.vehicle_id ? null : vehicle.vehicle_id
                      )}
                    />
                  ))
              }
            </div>
          )}

          {/* Events feed */}
          {sidebarTab === "events" && (
            <div className="flex flex-col gap-1 overflow-y-auto flex-1">
              {events.length === 0 ? (
                <div className="text-xs text-center py-6" style={{ color: "var(--muted)" }}>
                  Sin actividad en las últimas 24h
                </div>
              ) : events.slice(0, 50).map((ev, i) => {
                const icons: Record<string, string> = {
                  ignition_on: "🟢",
                  ignition_off: "⭕",
                  alert: "⚠️",
                  geofence_enter: "📍",
                  geofence_exit: "🚪",
                };
                const colors: Record<string, string> = {
                  danger: "#ef4444",
                  warning: "#f97316",
                  info: "var(--muted)",
                };
                return (
                  <div
                    key={i}
                    className="rounded-lg px-3 py-2"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm leading-none mt-0.5">{icons[ev.event_type] ?? "●"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: colors[ev.severity] ?? "var(--muted)" }}>
                          {ev.vehicle_name}
                        </div>
                        <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                          {ev.detail ?? ev.event_type.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)", fontSize: 10 }}>
                          {new Date(ev.event_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VehicleCard({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: FleetVehicle;
  selected: boolean;
  onSelect: () => void;
}) {
  const online = vehicle.device?.online ?? false;
  const pos = vehicle.last_position;
  const noSignal = online && vehicle.device?.last_seen
    && (Date.now() - new Date(vehicle.device.last_seen).getTime()) > 5 * 60 * 1000;

  // AIN1 → presión hidráulica (mV × 0.006 = bar)
  const ain1 = pos?.io_data?.["9"];
  const pressure = ain1 != null ? (ain1 * 0.006).toFixed(0) : null;

  return (
    <div
      className="rounded-xl p-4 cursor-pointer transition-all"
      style={{
        background: selected ? "rgba(59,130,246,0.12)" : "var(--card)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
      }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <Link
            href={`/vehicles/${vehicle.vehicle_id}`}
            onClick={e => e.stopPropagation()}
            className="text-sm font-semibold text-white hover:underline"
          >
            {vehicle.vehicle_name}
          </Link>
          {vehicle.license_plate && (
            <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              {vehicle.license_plate}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: online ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                  color: online ? "var(--success)" : "var(--muted)",
                }}>
            {online ? "EN LÍNEA" : "OFFLINE"}
          </span>
          {noSignal && (
            <span className="text-xs" style={{ color: "var(--warning)" }}>Sin señal</span>
          )}
        </div>
      </div>

      {pos && (
        <div className="grid grid-cols-2 gap-1 text-xs" style={{ color: "var(--muted)" }}>
          <span>🚀 {pos.speed ?? "–"} km/h</span>
          <span>⚡ {pos.ext_voltage_mv ? (pos.ext_voltage_mv / 1000).toFixed(1) + "V" : "–"}</span>
          {pressure && <span>🔧 {pressure} bar</span>}
          <span>{pos.ignition ? "🔑 Ignición ON" : "⭕ Ignición OFF"}</span>
        </div>
      )}

      {!pos && (
        <div className="text-xs" style={{ color: "var(--muted)" }}>Sin datos de posición</div>
      )}
    </div>
  );
}
