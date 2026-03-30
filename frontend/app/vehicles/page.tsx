"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getFleet, type FleetVehicle } from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage } from "@/lib/websocket";

const ONLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

function isOnlineNow(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS;
}

function timeSince(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: online ? "var(--success)" : "var(--muted)" }}
      />
      <span className="text-xs" style={{ color: online ? "var(--success)" : "var(--muted)" }}>
        {online ? "En línea" : "Offline"}
      </span>
    </span>
  );
}

export default function VehiclesPage() {
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  // Recalculate online status every 60s without API call
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await getFleet();
      setFleet(data.fleet);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFleetWebSocket(
    useCallback((msg: WsTelemetryMessage) => {
      setLastUpdated(new Date());
      setFleet(prev => prev.map(v => {
        if (v.vehicle_id !== msg.vehicle_id) return v;
        return {
          ...v,
          device: v.device ? { ...v.device, last_seen: msg.time } : undefined,
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
    }, [])
  );

  const filtered = fleet.filter(v => {
    const matchSearch =
      v.vehicle_name.toLowerCase().includes(search.toLowerCase()) ||
      (v.license_plate ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (v.device?.imei ?? "").includes(search);
    const online = isOnlineNow(v.device?.last_seen);
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "online" && online) ||
      (filterStatus === "offline" && !online);
    return matchSearch && matchStatus;
  });

  const onlineCount = fleet.filter(v => isOnlineNow(v.device?.last_seen)).length;
  const movingCount = fleet.filter(v => {
    if (!isOnlineNow(v.device?.last_seen)) return false;
    return v.last_position?.ignition && (v.last_position?.speed ?? 0) > 3;
  }).length;

  return (
    <div className="px-6 py-6 max-w-none w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-bold text-white">Vehículos</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {onlineCount} en línea · {movingCount} en movimiento · {fleet.length} total
            {lastUpdated && ` · ${lastUpdated.toLocaleTimeString("es-ES")}`}
          </p>
        </div>
        <button
          onClick={refresh}
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

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)" }}>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Buscar vehículo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 rounded-lg text-sm text-white"
            style={{ background: "var(--card)", border: "1px solid var(--border)", width: 220 }}
          />
        </div>

        {(["all", "online", "offline"] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: filterStatus === s ? "rgba(59,130,246,0.15)" : "var(--card)",
              border: `1px solid ${filterStatus === s ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
              color: filterStatus === s ? "#60a5fa" : "var(--muted)",
            }}
          >
            {s === "all" ? "Todos" : s === "online" ? "En línea" : "Offline"}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--card)" }} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Vehículo", "IMEI", "Estado", "Velocidad", "Presión", "Encendido", "Última señal", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => {
                const pos = v.last_position;
                const online = isOnlineNow(v.device?.last_seen);
                const ignition = online ? pos?.ignition : false;
                const isMoving = online && ignition && (pos?.speed ?? 0) > 3;
                return (
                  <tr
                    key={v.vehicle_id}
                    style={{
                      background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white text-sm">{v.vehicle_name}</div>
                      {v.license_plate && (
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{v.license_plate}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                      {v.device?.imei ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {v.device ? (
                        <StatusDot online={online} />
                      ) : (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>Sin dispositivo</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pos && online ? (
                        <span className="font-mono text-sm" style={{ color: isMoving ? "var(--success)" : "var(--muted)" }}>
                          {pos.speed ?? 0} km/h
                        </span>
                      ) : <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {pos?.io_data?.["9"] != null ? (
                        <span className="font-mono text-sm" style={{ color: "var(--warning)" }}>
                          {(pos.io_data["9"] * 0.006).toFixed(0)} bar
                        </span>
                      ) : <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: ignition ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.1)",
                          color: ignition ? "var(--success)" : "var(--muted)",
                        }}
                      >
                        {ignition ? "ON" : "OFF"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                      {v.device?.last_seen ? (
                        <span title={new Date(v.device.last_seen).toLocaleString("es-ES")}>
                          hace {timeSince(v.device.last_seen)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/vehicles/${v.vehicle_id}`}
                          className="text-xs px-2.5 py-1 rounded font-medium"
                          style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.25)" }}
                        >
                          Detalle
                        </Link>
                        <Link
                          href={`/trips?vehicle=${v.vehicle_id}`}
                          className="text-xs px-2.5 py-1 rounded font-medium"
                          style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}
                        >
                          Rutas
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-10">
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {search ? "Sin resultados para la búsqueda" : "No hay vehículos registrados"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
