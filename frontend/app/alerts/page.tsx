"use client";

import { useEffect, useState, useCallback } from "react";
import { alerts as alertsApi, getVehicles, type AlertLogOut, type Vehicle } from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage } from "@/lib/websocket";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/toast";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LevelBadge({ level }: { level: string }) {
  if (level === "high") {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-semibold"
        style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
      >
        ALTA
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-semibold"
      style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
    >
      BAJA
    </span>
  );
}

function StatusBadge({ alert }: { alert: AlertLogOut }) {
  if (alert.resolved_at) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{ background: "rgba(100,116,139,0.15)", color: "var(--muted)" }}
      >
        Resuelta
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: "rgba(34,197,94,0.15)", color: "var(--success)" }}
    >
      Activa
    </span>
  );
}

export default function AlertsPage() {
  const [alertList, setAlertList] = useState<AlertLogOut[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  // Filters
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, vData] = await Promise.all([
        alertsApi.list({
          vehicle_id: vehicleFilter || undefined,
          level: levelFilter || undefined,
          active_only: activeOnly || undefined,
          limit: 100,
        }),
        getVehicles(),
      ]);
      setAlertList(data);
      setVehicles(vData);
    } catch (e) {
      console.error("Error loading alerts", e);
    } finally {
      setLoading(false);
    }
  }, [vehicleFilter, levelFilter, activeOnly]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const { toasts, addToast, dismiss } = useToast();

  // Live updates via WebSocket — new alert triggers immediate reload + toast
  useFleetWebSocket(
    useCallback((_msg: WsTelemetryMessage) => {}, []),
    useCallback((alert: WsAlertMessage) => {
      addToast({
        level: alert.level as 'high' | 'low',
        title: `Nueva alerta — ${alert.display_name}`,
        message: `${alert.converted_value.toFixed(1)} ${alert.unit} (umbral: ${alert.threshold} ${alert.unit})`,
      });
      load();
    }, [addToast, load]),
  );

  async function handleAcknowledge(id: string) {
    setAcknowledging(id);
    try {
      await alertsApi.acknowledge(id);
      await load();
    } catch (e) {
      console.error("Error acknowledging alert", e);
    } finally {
      setAcknowledging(null);
    }
  }

  const activeCount = alertList.filter((a) => !a.resolved_at).length;

  return (
    <div className="px-6 py-6 max-w-6xl">
      <Toast toasts={toasts} onDismiss={dismiss} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-white">Alertas</h1>
            {activeCount > 0 && (
              <span
                className="text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}
              >
                {activeCount} activa{activeCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Historial de alertas de umbral por variable IO
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">Todos los vehículos</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">Todos los niveles</option>
          <option value="high">Alta</option>
          <option value="low">Baja</option>
        </select>

        <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer"
               style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          Solo activas
        </label>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Fecha", "Vehículo", "Variable", "Nivel", "Valor", "Umbral", "Estado", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-xs font-semibold"
                    style={{ color: "var(--muted)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alertList.map((alert, i) => (
                <tr
                  key={alert.id}
                  style={{
                    background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                    borderBottom: "1px solid var(--border)",
                    opacity: alert.resolved_at ? 0.7 : 1,
                  }}
                >
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {formatDateTime(alert.fired_at)}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    {alert.vehicle_name ?? alert.vehicle_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-white">
                    {alert.display_name}
                    <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>
                      ({alert.io_key})
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <LevelBadge level={alert.level} />
                  </td>
                  <td className="px-4 py-3 font-mono text-white">
                    {alert.converted_value.toFixed(2)}
                    {alert.unit && (
                      <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>
                        {alert.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                    {alert.level === "high" ? ">" : "<"} {alert.threshold}
                    {alert.unit && ` ${alert.unit}`}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge alert={alert} />
                  </td>
                  <td className="px-4 py-3">
                    {!alert.resolved_at && !alert.acknowledged_at && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        disabled={acknowledging === alert.id}
                        className="text-xs px-3 py-1 rounded font-medium"
                        style={{
                          background: "rgba(59,130,246,0.15)",
                          color: "#60a5fa",
                          border: "1px solid rgba(59,130,246,0.3)",
                          opacity: acknowledging === alert.id ? 0.5 : 1,
                        }}
                      >
                        {acknowledging === alert.id ? "..." : "Confirmar"}
                      </button>
                    )}
                    {alert.acknowledged_at && !alert.resolved_at && (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>Confirmada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {alertList.length === 0 && (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">✓</div>
              <div className="text-sm font-semibold mb-1" style={{ color: "var(--success)" }}>
                Sin alertas activas
              </div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {activeOnly
                  ? "No hay alertas activas en este momento"
                  : vehicleFilter
                  ? "No hay alertas registradas para este vehículo"
                  : "No hay alertas registradas en el sistema"}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
        Actualización automática cada 30 segundos
      </p>
    </div>
  );
}
