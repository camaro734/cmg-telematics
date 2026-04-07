"use client";

import { useEffect, useState, useCallback, use } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  getLastTelemetry, getTelemetryHistory, sendCommand, getTrips, getTripTrack,
  getCommandHistory, getLiveSignals, automations,
  maintenance, getEcoDrivingScores,
  type LastTelemetry, type TelemetryHistory, type Trip, type TrackPoint,
  type MaintenanceTaskOut, type EcoDrivingScore, type CommandHistoryEntry,
  type LiveSignal, type AutomationSessionOut, type AutomationPositionOut,
} from "@/lib/api";
import Link from "next/link";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage, type WsStatus } from "@/lib/websocket";
import CircularGauge, { type GaugeZone } from "@/components/CircularGauge";
import Toast from "@/components/Toast";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/toast";
import { exportExcel, exportSessionPdf } from "@/lib/export";

const TripMap = dynamic(() => import("@/components/TripMap"), { ssr: false });
const VehiclePositionMap = dynamic(() => import("@/components/VehiclePositionMap"), { ssr: false });
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [last, setLast] = useState<LastTelemetry | null>(null);
  const [history, setHistory] = useState<TelemetryHistory | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [cmdState, setCmdState] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});
  const [liveSignals, setLiveSignals] = useState<LiveSignal[]>([]);
  const { toasts, addToast, dismiss } = useToast();
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [activeTab, setActiveTab] = useState<'estado' | 'historico' | 'mantenimiento' | 'rutas'>('estado');
  const [sensorModal, setSensorModal] = useState<{ label: string; unit: string; dataKey: string; color: string } | null>(null);

  // Maintenance state
  const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTaskOut[]>([]);

  // Command history state
  const [cmdHistory, setCmdHistory] = useState<CommandHistoryEntry[]>([]);

  const refreshCmdHistory = useCallback(() => {
    getCommandHistory(id, 10).then(setCmdHistory).catch(() => {});
  }, [id]);

  // Eco-driving state
  const [ecoScore, setEcoScore] = useState<EcoDrivingScore | null>(null);

  // Automation state
  const [autoSessions, setAutoSessions] = useState<AutomationSessionOut[]>([]);
  const [autoRules, setAutoRules] = useState<{ id: string; name: string; io_key: string; condition: string; threshold: number; actions: { type: string; params: Record<string, unknown> }[] }[]>([]);
  const [userRole, setUserRole] = useState("");
  const [autoMapSession, setAutoMapSession] = useState<AutomationSessionOut | null>(null);
  const [autoMapPositions, setAutoMapPositions] = useState<AutomationPositionOut[]>([]);
  const [autoMapLoading, setAutoMapLoading] = useState(false);

  // Trips state
  const defaultEnd = new Date();
  const defaultStart = new Date(defaultEnd.getTime() - 7 * 24 * 3600 * 1000);
  const [tripStart, setTripStart] = useState(defaultStart.toISOString().slice(0, 10));
  const [tripEnd, setTripEnd] = useState(defaultEnd.toISOString().slice(0, 10));
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsSearched, setTripsSearched] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [l, h, ls] = await Promise.all([
        getLastTelemetry(id),
        getTelemetryHistory(id, hours),
        getLiveSignals(id),
      ]);
      setLast(l);
      setHistory(h);
      setLiveSignals(ls.signals.filter(s => s.is_configured && s.raw_value !== null));
    } catch {
      // silence
    } finally {
      setLoading(false);
    }
  }, [id, hours]);

  useEffect(() => {
    maintenance.listTasks({ vehicle_id: id }).then(setMaintenanceTasks).catch(() => {});
  }, [id]);

  useEffect(() => {
    refreshCmdHistory();
  }, [refreshCmdHistory]);

  useEffect(() => {
    getEcoDrivingScores(24, id)
      .then(scores => setEcoScore(scores[0] ?? null))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserRole(parsed.role ?? "");
      }
    } catch { /* ignore */ }
    // All roles can see automation rules + sessions for their vehicles
    automations.list({ vehicle_id: id }).then(setAutoRules).catch(() => {});
    automations.listSessionsByVehicle(id, 10).then(setAutoSessions).catch(() => {});
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFleetWebSocket(
    useCallback((msg: WsTelemetryMessage) => {
      if (msg.vehicle_id !== id) return;
      setLast(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          data: {
            time: msg.time,
            lat: msg.lat,
            lng: msg.lng,
            speed: msg.speed,
            ignition: msg.ignition,
            ext_voltage_mv: msg.ext_voltage_mv,
            dout1: msg.dout1,
            dout2: msg.dout2,
            altitude: prev.data?.altitude ?? null,
            satellites: prev.data?.satellites ?? null,
            dout3: prev.data?.dout3 ?? null,
            dout4: prev.data?.dout4 ?? null,
            io_data: msg.io_data,
          },
        };
      });
    }, [id]),
    useCallback((alert: WsAlertMessage) => {
      if (alert.vehicle_id !== id) return;
      addToast({
        level: alert.level as 'high' | 'low',
        title: `Alerta ${alert.level === 'high' ? 'ALTA' : 'BAJA'} — ${alert.display_name}`,
        message: `${alert.converted_value.toFixed(1)} ${alert.unit} (umbral: ${alert.threshold} ${alert.unit})`,
      });
    }, [id, addToast]),
    useCallback((status: WsStatus) => setWsStatus(status), []),
  );

  const handleExport = async () => {
    const token = localStorage.getItem("cmg_token");
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const url = `/api/v1/vehicles/${id}/export?start=${start.toISOString()}&end=${end.toISOString()}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `telemetry_${id}_${hours}h.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  async function toggleDout(output: string, currentValue: boolean | null) {
    if (!last?.imei) return;
    const key = output;
    setCmdState(s => ({ ...s, [key]: "sending" }));
    try {
      await sendCommand(last.imei, output, !currentValue);
      setCmdState(s => ({ ...s, [key]: "sent" }));
      setTimeout(() => setCmdState(s => ({ ...s, [key]: "idle" })), 3000);
      // Refresh command history after sending
      setTimeout(refreshCmdHistory, 500);
    } catch {
      setCmdState(s => ({ ...s, [key]: "error" }));
      setTimeout(() => setCmdState(s => ({ ...s, [key]: "idle" })), 3000);
      setTimeout(refreshCmdHistory, 500);
    }
  }

  const handleSearchTrips = async () => {
    setLoadingTrips(true);
    setTripsSearched(true);
    setSelectedTrip(null);
    setTrackPoints([]);
    try {
      const startIso = new Date(tripStart + "T00:00:00").toISOString();
      const endIso = new Date(tripEnd + "T23:59:59").toISOString();
      const result = await getTrips(id, startIso, endIso);
      setTrips(result);
    } catch {
      setTrips([]);
    } finally {
      setLoadingTrips(false);
    }
  };

  const handleSelectTrip = async (trip: Trip) => {
    if (selectedTrip?.trip_num === trip.trip_num) {
      setSelectedTrip(null);
      setTrackPoints([]);
      return;
    }
    setSelectedTrip(trip);
    setTrackPoints([]);
    try {
      const startIso = new Date(tripStart + "T00:00:00").toISOString();
      const endIso = new Date(tripEnd + "T23:59:59").toISOString();
      const points = await getTripTrack(id, trip.trip_num, startIso, endIso);
      setTrackPoints(points);
    } catch {
      setTrackPoints([]);
    }
  };

  // Transform history for charts
  const chartData = (history?.buckets ?? []).map(b => ({
    time: new Date(b.bucket).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    velocidad: b.avg_speed ?? 0,
    presion: b.ain1_mv != null ? +(b.ain1_mv * 0.006).toFixed(1) : null,
    voltaje: b.ext_voltage_mv != null ? +(b.ext_voltage_mv / 1000).toFixed(2) : null,
  }));

  const d = last?.data;
  const online = last?.online ?? false;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--muted)" }}>
        Cargando...
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-none w-full">
      <Toast toasts={toasts} onDismiss={dismiss} />
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} style={{ color: "var(--muted)" }}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-xs mb-1" style={{ color: "var(--muted)" }}>
            <Link href="/dashboard" style={{ color: "var(--muted)" }} className="hover:underline">Flota</Link>
            <span>/</span>
            <Link href="/vehicles" style={{ color: "var(--muted)" }} className="hover:underline">Vehículos</Link>
            <span>/</span>
            <span className="text-white">{last?.vehicle_name ?? (last?.imei ? `IMEI ${last.imei}` : id.slice(0, 8))}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-bold text-white">{last?.vehicle_name ?? "Detalle de vehículo"}</h1>
            <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: online ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                    color: online ? "var(--success)" : "var(--muted)",
                  }}>
              {online ? "EN LÍNEA" : "OFFLINE"}
            </span>
            {/* Live indicator */}
            <span className="flex items-center gap-1.5 text-xs"
                  style={{ color: wsStatus === 'connected' ? "var(--success)" : wsStatus === 'connecting' ? "var(--warning)" : "var(--muted)" }}>
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: wsStatus === 'connected' ? "var(--success)" : wsStatus === 'connecting' ? "var(--warning)" : "#64748b",
                animation: wsStatus === 'connected' ? 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' : 'none',
              }} />
              {wsStatus === 'connected' ? 'En directo' : wsStatus === 'connecting' ? 'Conectando...' : 'Sin conexión'}
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {last?.license_plate && <span>{last.license_plate} · </span>}IMEI: {last?.imei ?? id}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {([
          { key: 'estado', label: 'Estado' },
          { key: 'historico', label: 'Histórico' },
          { key: 'mantenimiento', label: 'Mantenimiento' },
          { key: 'rutas', label: 'Rutas' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: activeTab === tab.key ? "var(--accent)" : "transparent",
              color: activeTab === tab.key ? "white" : "var(--muted)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: ESTADO ── */}
      {activeTab === 'estado' && (<>

      {/* Gauges principales */}
      {d && (() => {
        const speedZones: GaugeZone[] = [
          { from: 0, to: 60,  color: "#22c55e" },
          { from: 60, to: 90, color: "#f59e0b" },
          { from: 90, to: 120, color: "#ef4444" },
        ];
        const voltZones: GaugeZone[] = [
          { from: 10, to: 11.5, color: "#ef4444" },
          { from: 11.5, to: 12.5, color: "#f59e0b" },
          { from: 12.5, to: 15, color: "#22c55e" },
          { from: 15, to: 16,   color: "#f59e0b" },
        ];
        const voltValue = d.ext_voltage_mv != null ? d.ext_voltage_mv / 1000 : null;
        // First numeric live signal as pressure gauge (if available)
        const pressSignal = liveSignals.find(s => s.data_type !== "boolean" && s.converted_value !== null);
        const pressMax = pressSignal ? Math.max(300, (pressSignal.converted_value ?? 0) * 1.5) : 300;
        const pressZones: GaugeZone[] = [
          { from: 0, to: pressMax * 0.65, color: "#22c55e" },
          { from: pressMax * 0.65, to: pressMax * 0.85, color: "#f59e0b" },
          { from: pressMax * 0.85, to: pressMax, color: "#ef4444" },
        ];
        return (
          <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-sm font-semibold text-white">Telemetría en tiempo real</h2>
              {wsStatus === 'connected' && (
                <span className="text-xs flex items-center gap-1" style={{ color: "var(--success)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block", animation: "pulse 2s infinite" }} />
                  En directo
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
              <CircularGauge
                value={d.speed ?? 0}
                min={0} max={120}
                label="Velocidad"
                unit="km/h"
                zones={speedZones}
                size={120}
              />
              <CircularGauge
                value={voltValue}
                min={10} max={16}
                label="Voltaje"
                unit="V"
                zones={voltZones}
                size={120}
              />
              {pressSignal && (
                <CircularGauge
                  value={typeof pressSignal.converted_value === 'number' ? pressSignal.converted_value : null}
                  min={0} max={pressMax}
                  label={pressSignal.display_name}
                  unit={pressSignal.unit ?? ""}
                  zones={pressZones}
                  size={120}
                />
              )}
              {/* Ignition LED indicator */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 120 }}>
                <div style={{
                  width: 120, height: 120,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: d.ignition ? "rgba(34,197,94,0.2)" : "rgba(100,116,139,0.15)",
                    border: `3px solid ${d.ignition ? "#22c55e" : "#475569"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: d.ignition ? "0 0 16px #22c55e66" : "none",
                  }}>
                    <span style={{ fontSize: 16 }}>{d.ignition ? "▶" : "⏹"}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: d.ignition ? "#22c55e" : "#64748b" }}>
                    {d.ignition ? "ON" : "OFF"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: -4, textAlign: "center" }}>
                  Ignición
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Status cards */}
      {d ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoCard label="Velocidad" value={`${d.speed ?? "–"} km/h`}
            onClick={chartData.some(p => p.velocidad != null) ? () => setSensorModal({ label: "Velocidad", unit: "km/h", dataKey: "velocidad", color: "#3b82f6" }) : undefined} />
          <InfoCard label="Alimentación" value={d.ext_voltage_mv ? `${(d.ext_voltage_mv/1000).toFixed(1)} V` : "–"}
            onClick={chartData.some(p => p.voltaje != null) ? () => setSensorModal({ label: "Tensión de alimentación", unit: "V", dataKey: "voltaje", color: "#22c55e" }) : undefined} />
          <InfoCard label="Satélites" value={`${d.satellites ?? "–"}`} />
          <InfoCard label="Latitud" value={d.lat?.toFixed(5) ?? "–"} />
          <InfoCard label="Longitud" value={d.lng?.toFixed(5) ?? "–"} />
          <InfoCard label="Altitud" value={`${d.altitude ?? "–"} m`} />
          <InfoCard label="Ignición" value={d.ignition ? "ON" : "OFF"}
                    color={d.ignition ? "var(--success)" : "var(--muted)"} />
        </div>
      ) : (
        <div className="rounded-xl p-6 text-center" style={{ background: "var(--card)", color: "var(--muted)" }}>
          Sin datos de telemetría disponibles
        </div>
      )}

      {/* Señales CAN configuradas via variable maps */}
      {liveSignals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {liveSignals.map(s => (
            <InfoCard
              key={s.io_key}
              label={s.display_name}
              value={
                s.data_type === "boolean"
                  ? (s.converted_value ? "ON" : "OFF")
                  : s.converted_value !== null
                    ? `${s.converted_value}${s.unit ? ` ${s.unit}` : ""}`
                    : "–"
              }
              color={s.data_type === "boolean" ? (s.converted_value ? "var(--success)" : "var(--muted)") : "var(--warning)"}
              onClick={
                s.data_type !== "boolean"
                  ? () => setSensorModal({ label: s.display_name, unit: s.unit ?? "", dataKey: "presion", color: "#f59e0b" })
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Live position map */}
      {d?.lat != null && d?.lng != null && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold text-white">Posición actual</h2>
            <a
              href={`https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}&zoom=16`}
              target="_blank"
              rel="noreferrer"
              className="text-xs"
              style={{ color: "var(--muted)" }}
            >
              Ver en mapa ↗
            </a>
          </div>
          <VehiclePositionMap
            lat={d.lat}
            lng={d.lng}
            speed={d.speed ?? 0}
            ignition={d.ignition ?? false}
            height="240px"
          />
        </div>
      )}

      {/* DOUT control */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold text-white mb-4">Control remoto de salidas digitales</h2>
        {!online && (
          <div className="text-xs px-3 py-2 rounded-lg mb-4"
               style={{ background: "#450a0a", color: "#fca5a5" }}>
            El dispositivo está desconectado. Los comandos se enviarán cuando vuelva a conectarse.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["DOUT1", "DOUT2", "DOUT3", "DOUT4"] as const).map((dout, i) => {
            const key = `dout${i + 1}` as keyof typeof d;
            const val = d ? (d[key] as boolean | null) : null;
            const state = cmdState[dout] ?? "idle";
            return (
              <DoutButton
                key={dout}
                label={dout}
                active={val ?? false}
                state={state}
                onToggle={() => toggleDout(dout, val)}
              />
            );
          })}
        </div>
      </div>

      {/* ── Command history ── */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Historial de comandos</h2>
          <button
            onClick={refreshCmdHistory}
            className="text-xs px-2 py-1 rounded"
            style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}
          >
            Actualizar
          </button>
        </div>
        {cmdHistory.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
            No hay comandos enviados para este vehículo
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Fecha/hora", "Comando", "Estado", "Enviado por"].map(h => (
                    <th key={h} className="text-left pb-2 pr-3 font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmdHistory.map((cmd, i) => {
                  const statusMap: Record<string, { bg: string; color: string; label: string }> = {
                    sent:      { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa",        label: "Enviado" },
                    confirmed: { bg: "rgba(34,197,94,0.15)",   color: "var(--success)", label: "Confirmado" },
                    failed:    { bg: "rgba(239,68,68,0.15)",   color: "#f87171",        label: "Error" },
                    pending:   { bg: "rgba(251,146,60,0.15)",  color: "#fb923c",        label: "Pendiente" },
                    timeout:   { bg: "rgba(100,116,139,0.15)", color: "var(--muted)",   label: "Timeout" },
                  };
                  const sc = statusMap[cmd.status] ?? statusMap.pending;
                  return (
                    <tr key={cmd.id} style={{ borderBottom: i < cmdHistory.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                        {new Date(cmd.created_at).toLocaleString("es-ES", {
                          day: "2-digit", month: "2-digit",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 pr-3 font-mono text-white">{cmd.command}</td>
                      <td className="py-2 pr-3">
                        <span className="px-1.5 py-0.5 rounded-full text-xs font-medium"
                              style={{ background: sc.bg, color: sc.color }}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="py-2" style={{ color: "var(--muted)" }}>
                        {cmd.issued_by_name || cmd.issued_by_email || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>)} {/* end TAB: ESTADO */}

      {/* ── TAB: HISTÓRICO ── */}
      {activeTab === 'historico' && (<>

      {/* Chart controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-white">Histórico</h2>
        <div className="flex gap-1">
          {[6, 24, 48, 168].map(h => (
            <button key={h} onClick={() => setHours(h)}
                    className="px-2 py-1 rounded text-xs transition-colors"
                    style={{
                      background: hours === h ? "var(--accent)" : "var(--card)",
                      color: hours === h ? "white" : "var(--muted)",
                      border: "1px solid var(--border)",
                    }}>
              {h === 168 ? "7d" : `${h}h`}
            </button>
          ))}
        </div>
        <button
          onClick={handleExport}
          className="px-3 py-1 rounded text-xs transition-colors ml-auto"
          style={{
            background: "var(--card)",
            color: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          Exportar CSV
        </button>
      </div>

      {/* Velocity chart */}
      {chartData.length > 0 ? (
        <>
          <ChartCard title="Velocidad media (km/h)">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" stroke="var(--muted)" tick={{ fontSize: 10 }} />
              <YAxis stroke="var(--muted)" tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Line type="monotone" dataKey="velocidad" stroke="#3b82f6" strokeWidth={2} dot={false} name="km/h" />
            </LineChart>
          </ChartCard>

          {chartData.some(d => d.presion != null) && (
            <ChartCard title="Presión hidráulica AIN1 (bar)">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--muted)" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="presion" stroke="#f59e0b" strokeWidth={2} dot={false} name="bar" />
              </LineChart>
            </ChartCard>
          )}

          {chartData.some(d => d.voltaje != null) && (
            <ChartCard title="Tensión de alimentación (V)">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--muted)" tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="voltaje" stroke="#22c55e" strokeWidth={2} dot={false} name="V" connectNulls />
              </LineChart>
            </ChartCard>
          )}
        </>
      ) : (
        <div className="rounded-xl p-6 text-center" style={{ background: "var(--card)", color: "var(--muted)" }}>
          No hay datos históricos para el período seleccionado
        </div>
      )}

      {/* ── Eco-driving score ── */}
      {ecoScore && (
        <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Puntuacion de conduccion</h2>
            <Link href="/ecodriving"
                  className="text-xs px-3 py-1 rounded-lg"
                  style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
              Ver flota
            </Link>
          </div>
          <EcoDrivingWidget score={ecoScore} />
        </div>
      )}

      </>)} {/* end TAB: HISTÓRICO */}

      {/* ── TAB: MANTENIMIENTO ── */}
      {activeTab === 'mantenimiento' && (<>

      {/* ── Maintenance section ── */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Mantenimiento</h2>
          <Link href={`/maintenance?vehicle_id=${id}`}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
            Ver todo
          </Link>
        </div>
        {maintenanceTasks.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
            No hay tareas de mantenimiento registradas.{" "}
            <Link href={`/maintenance?vehicle_id=${id}`} style={{ color: "var(--accent)" }}>
              Crear tarea
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {maintenanceTasks.slice(0, 5).map(task => {
              const statusColors: Record<string, { bg: string; color: string; label: string }> = {
                overdue: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Vencida" },
                warning: { bg: "rgba(251,146,60,0.15)", color: "#fb923c", label: "Próxima" },
                ok:      { bg: "rgba(34,197,94,0.15)", color: "var(--success)", label: "Al día" },
              };
              const sc = statusColors[task.status] ?? statusColors.ok;
              const nextDue = task.trigger_type === "km" && task.next_due_km != null
                ? `${task.next_due_km.toLocaleString("es-ES")} km`
                : (task.trigger_type === "hours" && task.next_due_hours != null)
                ? `${task.next_due_hours.toLocaleString("es-ES")} h`
                : task.next_due_date
                ? new Date(task.next_due_date).toLocaleDateString("es-ES")
                : "—";
              return (
                <div key={task.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                  <div>
                    <div className="text-sm font-medium text-white">{task.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      Vence: {nextDue}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: sc.bg, color: sc.color }}>
                    {sc.label}
                  </span>
                </div>
              );
            })}
            {maintenanceTasks.length > 5 && (
              <div className="text-xs text-center pt-1" style={{ color: "var(--muted)" }}>
                y {maintenanceTasks.length - 5} más —{" "}
                <Link href={`/maintenance?vehicle_id=${id}`} style={{ color: "var(--accent)" }}>
                  Ver todas
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      </>)} {/* end TAB: MANTENIMIENTO */}

      {/* ── TAB: RUTAS ── */}
      {activeTab === 'rutas' && (<>

      {/* ── Automation section ── */}
      {autoRules.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Automatizaciones</h2>
            <div className="flex items-center gap-2">
              {autoSessions.length > 0 && (
                <button
                  onClick={() => exportExcel([{
                    name: "Sesiones",
                    rows: autoSessions.map(s => {
                      const ms2 = (s.ended_at ? new Date(s.ended_at) : new Date()).getTime() - new Date(s.started_at).getTime();
                      return {
                        "Regla": s.label ?? "—",
                        "Inicio": new Date(s.started_at).toLocaleString("es-ES"),
                        "Fin": s.ended_at ? new Date(s.ended_at).toLocaleString("es-ES") : "En curso",
                        "Duración (min)": Math.floor(ms2 / 60000),
                        "Posiciones": s.position_count,
                      };
                    }),
                  }], `sesiones_${last?.vehicle_name ?? id}_${new Date().toISOString().slice(0,10)}.xlsx`)}
                  className="text-xs px-2 py-1 rounded flex items-center gap-1"
                  style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}
                >
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Excel
                </button>
              )}
              {userRole === "superadmin" && (
                <Link href="/admin/automations"
                      className="text-xs px-2 py-1 rounded-lg"
                      style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                  Gestionar
                </Link>
              )}
            </div>
          </div>

          {/* Configured rules */}
          <div className="space-y-2 mb-4">
            {autoRules.map(rule => {
              const trackAction = rule.actions.find((a: { type: string }) => a.type === "track_position");
              const color = (trackAction?.params?.color as string) ?? "#3b82f6";
              const activeSession = autoSessions.find(s => s.rule_id === rule.id && !s.ended_at);
              return (
                <div key={rule.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{rule.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {rule.io_key} {rule.condition} {rule.threshold}
                    </div>
                  </div>
                  {activeSession ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 flex items-center gap-1"
                          style={{ background: "rgba(34,197,94,0.15)", color: "var(--success)" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                      Activa
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "rgba(100,116,139,0.08)", color: "var(--muted)" }}>
                      En espera
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Recent sessions */}
          {autoSessions.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                Últimas sesiones
              </p>
              <div className="space-y-1.5">
                {autoSessions.slice(0, 5).map(s => {
                  const ms = (s.ended_at ? new Date(s.ended_at) : new Date()).getTime() - new Date(s.started_at).getTime();
                  const mins = Math.floor(ms / 60000);
                  const dur = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`;
                  const isSelected = autoMapSession?.id === s.id;
                  return (
                    <div key={s.id} className="rounded-lg text-xs overflow-hidden"
                         style={{ border: `1px solid ${isSelected ? (s.color ?? "#3b82f6") : "var(--border)"}` }}>
                      <div className="flex items-center gap-3 px-3 py-2"
                           style={{ background: isSelected ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.03)" }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color ?? "#3b82f6" }} />
                        <span className="flex-1 text-white truncate">{s.label ?? "Sesión"}</span>
                        <span style={{ color: "var(--muted)" }}>
                          {new Date(s.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                          {" · "}{dur}{" · "}{s.position_count} pos.
                        </span>
                        {!s.ended_at && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: "rgba(34,197,94,0.15)", color: "var(--success)" }}>En curso</span>
                        )}
                        {s.position_count > 0 && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={async () => {
                                if (isSelected) { setAutoMapSession(null); setAutoMapPositions([]); return; }
                                setAutoMapSession(s);
                                setAutoMapLoading(true);
                                try {
                                  const pts = await automations.getSessionPositions(s.id);
                                  setAutoMapPositions(pts);
                                } catch { setAutoMapPositions([]); }
                                finally { setAutoMapLoading(false); }
                              }}
                              className="px-2 py-0.5 rounded font-medium"
                              style={{ background: isSelected ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.07)", color: "var(--accent)", fontSize: 11 }}
                            >
                              {isSelected ? "Cerrar" : "Ver mapa"}
                            </button>
                            <button
                              title="Exportar PDF con mapa"
                              onClick={async () => {
                                const rule = autoRules.find(r => r.id === s.rule_id);
                                let pts = isSelected ? autoMapPositions : [];
                                if (!isSelected && s.position_count > 0) {
                                  try { pts = await automations.getSessionPositions(s.id); } catch { pts = []; }
                                }
                                await exportSessionPdf({
                                  vehicleName: last?.vehicle_name ?? id,
                                  licensePlate: last?.license_plate,
                                  ruleName: s.label ?? rule?.name ?? "Automatización",
                                  ioKey: rule?.io_key ?? "—",
                                  condition: rule?.condition ?? "eq",
                                  threshold: rule?.threshold ?? 0,
                                  session: s,
                                  positions: pts,
                                });
                              }}
                              className="px-1.5 py-0.5 rounded font-medium"
                              style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11 }}
                            >
                              PDF
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Inline map for selected session */}
                      {isSelected && (
                        <div style={{ height: 280, background: "#111" }}>
                          {autoMapLoading ? (
                            <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--muted)" }}>
                              Cargando posiciones…
                            </div>
                          ) : autoMapPositions.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--muted)" }}>
                              Sin posiciones registradas
                            </div>
                          ) : (
                            <TripMap
                              points={autoMapPositions.map(p => ({ lat: p.lat, lng: p.lng, speed: p.speed ?? 0 }))}
                              height="280px"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {autoSessions.length === 0 && (
            <p className="text-xs text-center py-2" style={{ color: "var(--muted)" }}>
              Aún no se ha registrado ninguna sesión para este vehículo
            </p>
          )}
        </div>
      )}

      {/* ── Trip history section ── */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold text-white mb-4">Historial de trayectos</h2>

        {/* Date range picker */}
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <label className="text-xs" style={{ color: "var(--muted)" }}>Desde</label>
          <input
            type="date"
            value={tripStart}
            onChange={e => setTripStart(e.target.value)}
            className="px-2 py-1 rounded text-xs text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          />
          <label className="text-xs" style={{ color: "var(--muted)" }}>Hasta</label>
          <input
            type="date"
            value={tripEnd}
            onChange={e => setTripEnd(e.target.value)}
            className="px-2 py-1 rounded text-xs text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          />
          <button
            onClick={handleSearchTrips}
            disabled={loadingTrips}
            className="px-3 py-1 rounded text-xs font-semibold transition-colors"
            style={{
              background: "var(--accent)",
              color: "white",
              opacity: loadingTrips ? 0.6 : 1,
              cursor: loadingTrips ? "wait" : "pointer",
            }}
          >
            {loadingTrips ? "Buscando..." : "Buscar trayectos"}
          </button>
        </div>

        {/* Results */}
        {tripsSearched && !loadingTrips && trips.length === 0 && (
          <div className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
            No se encontraron trayectos en este período
          </div>
        )}

        {trips.length > 0 && (
          <div className="space-y-2">
            {trips.map(trip => {
              const isSelected = selectedTrip?.trip_num === trip.trip_num;
              return (
                <div key={trip.trip_num}>
                  <button
                    onClick={() => handleSelectTrip(trip)}
                    className="w-full text-left rounded-lg px-4 py-3 transition-colors"
                    style={{
                      background: isSelected ? "rgba(59,130,246,0.12)" : "var(--sidebar)",
                      border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold px-2 py-0.5 rounded"
                              style={{ background: "var(--accent)", color: "white" }}>
                          #{trip.trip_num}
                        </span>
                        <div>
                          <div className="text-xs font-semibold text-white">
                            {new Date(trip.start_time).toLocaleString("es-ES", {
                              day: "2-digit", month: "2-digit", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                            {" → "}
                            {new Date(trip.end_time).toLocaleString("es-ES", {
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                            Duración: {formatDuration(trip.duration_seconds)}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-4 text-right">
                        <div>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Máx. vel.</div>
                          <div className="text-sm font-semibold text-white">{trip.max_speed} km/h</div>
                        </div>
                        <div>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Media</div>
                          <div className="text-sm font-semibold text-white">{trip.avg_speed.toFixed(1)} km/h</div>
                        </div>
                        <div>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Registros</div>
                          <div className="text-sm font-semibold text-white">{trip.record_count}</div>
                        </div>
                        <div className="flex items-center" style={{ color: "var(--muted)" }}>
                          <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                               style={{ transform: isSelected ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded trip map */}
                  {isSelected && (
                    <div className="mt-1 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                      {trackPoints.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-xs" style={{ color: "var(--muted)", background: "var(--sidebar)" }}>
                          Cargando ruta...
                        </div>
                      ) : (
                        <TripMap points={trackPoints} height="300px" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      </>)} {/* end TAB: RUTAS */}

      {/* ── Sensor chart modal ── */}
      {sensorModal && (
        <Modal
          title={`${sensorModal.label} — Últimas ${hours}h`}
          onClose={() => setSensorModal(null)}
          maxWidth="max-w-2xl"
        >
          {chartData.length === 0 || !chartData.some(p => p[sensorModal.dataKey as keyof typeof p] != null) ? (
            <div className="text-center py-10 space-y-2">
              <div className="text-2xl">📈</div>
              <div className="text-sm font-medium text-white">{sensorModal.label}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                Histórico disponible en la pestaña <span className="font-semibold text-white">Histórico</span>
              </div>
            </div>
          ) : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="time" stroke="var(--muted)" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--muted)" }}
                    formatter={(val) => [`${val} ${sensorModal!.unit}`, sensorModal!.label]}
                  />
                  <Line
                    type="monotone"
                    dataKey={sensorModal.dataKey}
                    stroke={sensorModal.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: sensorModal.color }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex justify-end mt-4">
            <button
              onClick={() => setSensorModal(null)}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function InfoCard({ label, value, color, onClick }: { label: string; value: string; color?: string; onClick?: () => void }) {
  return (
    <div
      className="rounded-xl p-3 transition-colors"
      onClick={onClick}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        cursor: onClick ? "pointer" : "default",
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.2)"; }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
        {onClick && (
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)", flexShrink: 0 }}>
            <path d="M18 20H4V6M20 4L4 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div className="text-sm font-semibold" style={{ color: color || "white" }}>{value}</div>
    </div>
  );
}

function DoutButton({
  label, active, state, onToggle,
}: {
  label: string;
  active: boolean;
  state: "idle" | "sending" | "sent" | "error";
  onToggle: () => void;
}) {
  const bg = state === "error" ? "var(--danger)"
    : state === "sent" ? "var(--success)"
    : active ? "rgba(59,130,246,0.2)"
    : "var(--sidebar)";

  const borderColor = active ? "var(--accent)" : "var(--border)";
  const textColor = state === "error" ? "white"
    : state === "sent" ? "white"
    : active ? "#60a5fa" : "var(--muted)";

  return (
    <button
      onClick={onToggle}
      disabled={state === "sending"}
      className="rounded-xl p-3 flex flex-col items-center gap-2 transition-all"
      style={{ background: bg, border: `1px solid ${borderColor}`, cursor: state === "sending" ? "wait" : "pointer" }}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center"
           style={{ background: active ? "var(--accent)" : "var(--border)" }}>
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
          <path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" stroke={active ? "white" : "var(--muted)"}
                strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-xs font-semibold" style={{ color: textColor }}>{label}</span>
      <span className="text-xs" style={{ color: textColor }}>
        {state === "sending" ? "..." : state === "sent" ? "✓ Enviado" : state === "error" ? "Error" : active ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h3 className="text-xs font-semibold mb-4" style={{ color: "var(--muted)" }}>{title}</h3>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ecoScoreColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#84cc16";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

function EcoDrivingWidget({ score }: { score: EcoDrivingScore }) {
  const color = ecoScoreColor(score.score);
  const speeding = score.events.find(e => e.event_type === "speeding")?.count ?? 0;
  const braking  = score.events.find(e => e.event_type === "harsh_braking")?.count ?? 0;
  const accel    = score.events.find(e => e.event_type === "harsh_acceleration")?.count ?? 0;
  const idling   = score.events.find(e => e.event_type === "idling")?.count ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Score circle */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center justify-center rounded-xl w-16 h-16"
             style={{ background: `${color}1a`, border: `2px solid ${color}` }}>
          <span className="text-2xl font-black leading-none" style={{ color }}>{score.score}</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>pts</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-4xl font-black leading-none" style={{ color }}>{score.grade}</span>
          <span className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>nota</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex-1 min-w-32">
        <div className="flex justify-between text-xs mb-1" style={{ color: "var(--muted)" }}>
          <span>Puntuacion</span>
          <span style={{ color }}>{score.score}/100</span>
        </div>
        <div className="rounded-full h-2 overflow-hidden" style={{ background: "var(--border)" }}>
          <div className="h-full rounded-full" style={{ width: `${score.score}%`, background: color }} />
        </div>
        <div className="flex gap-3 mt-2 flex-wrap">
          {speeding > 0 && <span className="text-xs" style={{ color: "#ef4444" }}>⚡ {speeding} excesos</span>}
          {braking > 0  && <span className="text-xs" style={{ color: "#ef4444" }}>🛑 {braking} frenos</span>}
          {accel > 0    && <span className="text-xs" style={{ color: "#ef4444" }}>🚀 {accel} aceler.</span>}
          {idling > 0   && <span className="text-xs" style={{ color: "#f97316" }}>💤 {idling} ralentis</span>}
          {score.total_records === 0 && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>Sin datos en las ultimas 24h</span>
          )}
        </div>
      </div>
    </div>
  );
}
