"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getVehicles, getLiveSignals, type Vehicle, type LiveSignal } from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage } from "@/lib/websocket";

// ── Named DB columns → numeric IO ID (for WebSocket matching) ───────────────
// WebSocket io_data uses numeric string keys; named_column rows use DB column names
const NAMED_COL_TO_IO: Record<string, string> = {
  "ignition":        "239",
  "movement":        "240",
  "speed":           "24",
  "ext_voltage_mv":  "66",
  "battery_mv":      "67",
  "battery_current": "68",
  "gsm_signal":      "21",
  "rssi":            "22",
  "odometer_m":      "16",
  "sleep_mode":      "200",
  "din1":            "1",
  "din2":            "2",
  "din3":            "3",
  "din4":            "4",
  "dout1_status":    "179",
  "dout2_status":    "180",
  "dout3_status":    "181",
  "dout4_status":    "182",
  "analog_1_mv":     "9",
  "analog_2_mv":     "10",
  "analog_3_mv":     "11",
  "dallas_temp_1":   "71",
};

// ── Known IO ID names (Teltonika standard + Manual CAN) ─────────────────────
const IO_NAMES: Record<string, string> = {
  "1": "DIN1 (Ignición fallback)", "2": "DIN2", "3": "DIN3", "4": "DIN4",
  "9": "AIN1 mV", "10": "AIN2 mV", "11": "AIN3 mV",
  "16": "Odómetro (m)", "21": "GSM Signal", "22": "RSSI",
  "24": "Velocidad (km/h)",
  "66": "Batería ext (mV)", "67": "Batería int (mV)", "68": "Corriente bat",
  "71": "Temperatura Dallas",
  "179": "DOUT1", "180": "DOUT2", "181": "DOUT3", "182": "DOUT4",
  "200": "Sleep mode", "239": "Ignición (IO239)", "240": "Movimiento",
  // Manual CAN slots 00–09 → AVL 145–154
  "145": "Manual CAN 00", "146": "Manual CAN 01", "147": "Manual CAN 02",
  "148": "Manual CAN 03", "149": "Manual CAN 04", "150": "Manual CAN 05",
  "151": "Manual CAN 06", "152": "Manual CAN 07", "153": "Manual CAN 08",
  "154": "Manual CAN 09",
  // Manual CAN slots 10–19 → AVL 380–389
  "380": "Manual CAN 10", "381": "Manual CAN 11", "382": "Manual CAN 12",
  "383": "Manual CAN 13", "384": "Manual CAN 14", "385": "Manual CAN 15",
  "386": "Manual CAN 16", "387": "Manual CAN 17", "388": "Manual CAN 18",
  "389": "Manual CAN 19",
};

type Filter = "all" | "configured" | "raw";

interface SignalRow {
  signal_key: string;     // unique row identifier ("io_key" or "io_key:bitN")
  io_key: string;         // actual device IO ID — used for display and WS matching
  ws_key: string;         // numeric string key used in WebSocket io_data
  display_name: string;
  raw_value: number | null;
  converted_value: number | null;
  unit: string;
  is_configured: boolean;
  source: string;
  scale_factor: number;
  offset: number;
  signal_type: "analog" | "digital";
  bit_index: number | null;
  changed_at: number | null; // timestamp ms of last change
}

// Apply the same conversion logic as backend: bit extraction for digital, scale+offset for all
function applyConversion(raw: number, scale: number, offset: number, signalType: "analog" | "digital", bitIndex: number | null): number {
  if (signalType === "digital" && bitIndex != null) {
    return ((Math.floor(raw) >> bitIndex) & 1) * scale + offset;
  }
  return raw * scale + offset;
}

function buildRows(signals: LiveSignal[], ioData: Record<string, number> | null): SignalRow[] {
  const rows = signals.map(s => {
    // For named_column rows the WS io_data uses the numeric IO ID, not the column name
    const ws_key = s.source === "named_column"
      ? (NAMED_COL_TO_IO[s.io_key] ?? s.io_key)
      : s.io_key;
    return {
      signal_key: s.signal_key ?? s.io_key,
      io_key: s.io_key,
      ws_key,
      display_name: s.display_name || IO_NAMES[ws_key] || IO_NAMES[s.io_key] || `IO ${s.io_key}`,
      raw_value: s.raw_value,
      converted_value: s.converted_value,
      unit: s.unit,
      is_configured: s.is_configured,
      source: s.source,
      scale_factor: s.scale_factor ?? 1,
      offset: s.offset ?? 0,
      signal_type: s.signal_type ?? "analog",
      bit_index: s.bit_index ?? null,
      changed_at: null,
    };
  });

  // Track io_keys already covered by configured rows
  const coveredIoKeys = new Set(rows.filter(r => r.is_configured).map(r => r.ws_key));

  // Add raw io_data keys with no variable_map at all
  const extra: SignalRow[] = [];
  if (ioData) {
    for (const [key, val] of Object.entries(ioData)) {
      if (!coveredIoKeys.has(key) && !rows.some(r => r.ws_key === key)) {
        extra.push({
          signal_key: key,
          io_key: key,
          ws_key: key,
          display_name: IO_NAMES[key] || `IO ${key}`,
          raw_value: val,
          converted_value: val,
          unit: "",
          is_configured: false,
          source: "io_data",
          scale_factor: 1,
          offset: 0,
          signal_type: "analog",
          bit_index: null,
          changed_at: null,
        });
      }
    }
  }

  return [...rows, ...extra];
}

export default function CanSnifferPage() {
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      if (raw) {
        const { role } = JSON.parse(raw);
        if (role !== "superadmin") router.replace("/dashboard");
      } else {
        router.replace("/login");
      }
    } catch {
      router.replace("/dashboard");
    }
  }, [router]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [selectedVehicleId_ws, setSelectedVehicleId_ws] = useState<string>("");
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const rowsRef = useRef<SignalRow[]>([]);
  rowsRef.current = rows;

  // Load vehicles
  useEffect(() => {
    getVehicles().then(vs => {
      setVehicles(vs);
      if (vs.length > 0) setSelectedVehicleId(vs[0].id);
    }).catch(() => {});
  }, []);

  // Load signals — silent=true skips the loading spinner (used on periodic refresh)
  const loadSignals = useCallback((vehicleId: string, silent = false) => {
    if (!vehicleId) return;
    if (!silent) setLoading(true);
    getLiveSignals(vehicleId).then(resp => {
      setRows(prev => {
        const fresh = buildRows(resp.signals, null);
        // Preserve changed_at from existing rows so flash indicators survive the refresh
        const prevByKey = new Map(prev.map(r => [r.signal_key, r]));
        return fresh.map(r => {
          const old = prevByKey.get(r.signal_key);
          return old ? { ...r, changed_at: old.changed_at } : r;
        });
      });
      setLastUpdate(resp.as_of ? new Date(resp.as_of) : new Date());
      setSelectedVehicleId_ws(vehicleId);
    }).catch(() => {
      if (!silent) setRows([]);
    }).finally(() => {
      if (!silent) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedVehicleId) loadSignals(selectedVehicleId);
  }, [selectedVehicleId, loadSignals]);

  // Periodic refresh every 30s — silent: no spinner, preserves flash state
  useEffect(() => {
    if (!selectedVehicleId) return;
    const id = setInterval(() => {
      if (!pausedRef.current) loadSignals(selectedVehicleId, true);
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedVehicleId, loadSignals]);

  // WebSocket: update rows on new telemetry
  const onTelemetry = useCallback((msg: WsTelemetryMessage) => {
    if (pausedRef.current) return;
    if (msg.vehicle_id !== selectedVehicleId_ws) return;

    setWsConnected(true);
    const now = Date.now();
    const io = msg.io_data || {};

    setRows(prev => {
      // Update all rows whose ws_key matches a value in io_data
      // Multiple rows can share the same ws_key (e.g. bit0 and bit1 of the same byte)
      const updated = prev.map(row => {
        if (!(row.ws_key in io)) return row;
        const newRaw = io[row.ws_key];
        const changed = newRaw !== row.raw_value;
        const newConverted = applyConversion(newRaw, row.scale_factor || 1, row.offset || 0, row.signal_type, row.bit_index);
        return {
          ...row,
          raw_value: newRaw,
          converted_value: newConverted,
          changed_at: changed ? now : row.changed_at,
        };
      });

      // Add brand-new io_data keys not represented by any row at all
      const existingWsKeys = new Set(prev.map(r => r.ws_key));
      const newRows: SignalRow[] = [];
      for (const [key, val] of Object.entries(io)) {
        if (!existingWsKeys.has(key)) {
          newRows.push({
            signal_key: key,
            io_key: key,
            ws_key: key,
            display_name: IO_NAMES[key] || `IO ${key}`,
            raw_value: val,
            converted_value: val,
            unit: "",
            is_configured: false,
            source: "io_data",
            scale_factor: 1,
            offset: 0,
            signal_type: "analog",
            bit_index: null,
            changed_at: now,
          });
        }
      }

      return [...updated, ...newRows];
    });

    setLastUpdate(new Date(msg.time));
  }, [selectedVehicleId_ws]);

  useFleetWebSocket(onTelemetry);

  // Filtered rows
  const filteredRows = rows.filter(r => {
    if (filter === "configured") return r.is_configured;
    if (filter === "raw") return !r.is_configured;
    return true;
  }).sort((a, b) => {
    // Configured first, then by io_key numeric, then by bit_index
    if (a.is_configured !== b.is_configured) return a.is_configured ? -1 : 1;
    const numA = parseInt(a.io_key) || 0;
    const numB = parseInt(b.io_key) || 0;
    if (numA !== numB) return numA - numB;
    return (a.bit_index ?? -1) - (b.bit_index ?? -1);
  });

  const FLASH_MS = 2000;

  return (
    <div className="p-4 md:p-6 max-w-none w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ background: "rgba(29,158,117,0.15)" }}>
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
                  stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">CAN Sniffer</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Monitor de señales en tiempo real · todos los IO del dispositivo
          </p>
        </div>

        {/* WS indicator */}
        <div className="ml-auto flex items-center gap-2">
          <span className="w-2 h-2 rounded-full"
            style={{ background: wsConnected ? "var(--success)" : "var(--muted)" }} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {wsConnected ? "WebSocket activo" : "Sin señal WebSocket"}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Vehicle selector */}
        <select
          value={selectedVehicleId}
          onChange={e => setSelectedVehicleId(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg flex-1 min-w-[180px]"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "white" }}
        >
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        {/* Filter */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {(["all", "configured", "raw"] as Filter[]).map(f => (
            <button key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background: filter === f ? "rgba(29,158,117,0.2)" : "var(--card)",
                color: filter === f ? "var(--accent)" : "var(--muted)",
              }}>
              {f === "all" ? "Todos" : f === "configured" ? "Configurados" : "Raw / CAN"}
            </button>
          ))}
        </div>

        {/* Pause/Resume */}
        <button
          onClick={() => setPaused(p => !p)}
          className="px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
          style={{
            background: paused ? "rgba(239,68,68,0.15)" : "rgba(29,158,117,0.15)",
            color: paused ? "#f87171" : "var(--accent)",
            border: `1px solid ${paused ? "rgba(239,68,68,0.3)" : "rgba(29,158,117,0.3)"}`,
          }}>
          {paused
            ? <><svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>Reanudar</>
            : <><svg width="12" height="12" fill="none" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>Pausar</>
          }
        </button>

        {/* Refresh */}
        <button
          onClick={() => loadSignals(selectedVehicleId)}
          disabled={loading}
          className="px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
          style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}>
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24"
               style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
            <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Actualizar
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-4">
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          <span className="text-white font-medium">{filteredRows.length}</span> señales
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          <span style={{ color: "var(--accent)" }} className="font-medium">
            {rows.filter(r => r.is_configured).length}
          </span> configuradas
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          <span className="text-white font-medium">
            {rows.filter(r => !r.is_configured).length}
          </span> raw
        </span>
        {lastUpdate && (
          <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>
            Última trama: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {/* Table header */}
        <div className="grid text-xs font-semibold uppercase tracking-wider px-4 py-2"
             style={{
               background: "var(--sidebar)",
               color: "var(--muted)",
               gridTemplateColumns: "80px 1fr 160px 110px 80px 90px",
               borderBottom: "1px solid var(--border)",
             }}>
          <span>IO ID</span>
          <span>Nombre / Descripción</span>
          <span className="text-right">Valor raw</span>
          <span className="text-right">Convertido</span>
          <span className="text-right">Unidad</span>
          <span className="text-right">Cambió</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--muted)" }}>
            Cargando señales...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-16 text-center" style={{ color: "var(--muted)" }}>
            <svg width="40" height="40" fill="none" viewBox="0 0 24 24" className="mx-auto mb-3 opacity-30">
              <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
                    stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <p className="text-sm">Sin señales. Selecciona un vehículo con dispositivo activo.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ "--tw-divide-opacity": 1 } as React.CSSProperties}>
            {filteredRows.map(row => {
              const sinceChange = row.changed_at ? Date.now() - row.changed_at : Infinity;
              const flashing = sinceChange < FLASH_MS;
              const isNull = row.raw_value == null;

              return (
                <SignalRowItem
                  key={row.signal_key}
                  row={row}
                  flashing={flashing}
                  isNull={isNull}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs" style={{ color: "var(--muted)" }}>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "rgba(29,158,117,0.12)", border: "1px solid rgba(29,158,117,0.3)" }} />
          Configurado en Variables IO
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "rgba(245,158,11,0.25)", border: "1px solid rgba(245,158,11,0.5)" }} />
          Cambió recientemente
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "transparent", border: "1px solid var(--border)" }} />
          IO sin configurar (raw)
        </div>
      </div>

      <style jsx>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// Separate component so it can re-render independently and trigger flash via CSS
function SignalRowItem({ row, flashing, isNull }: {
  row: SignalRow;
  flashing: boolean;
  isNull: boolean;
}) {
  const [flashActive, setFlashActive] = useState(flashing);
  const prevRaw = useRef(row.raw_value);

  useEffect(() => {
    if (row.raw_value !== prevRaw.current) {
      prevRaw.current = row.raw_value;
      setFlashActive(true);
      const t = setTimeout(() => setFlashActive(false), 2000);
      return () => clearTimeout(t);
    }
  }, [row.raw_value]);

  let bg = "transparent";
  if (flashActive) bg = "rgba(245,158,11,0.12)";
  else if (row.is_configured) bg = "rgba(29,158,117,0.06)";

  // For digital signals, show raw byte value + binary representation
  const formattedRaw = isNull ? "—"
    : row.signal_type === "digital" && typeof row.raw_value === "number"
      ? `${row.raw_value} (${row.raw_value.toString(2).padStart(8, "0")}b)`
      : typeof row.raw_value === "number" ? row.raw_value.toLocaleString() : String(row.raw_value);

  const formattedConverted = isNull ? "—"
    : row.converted_value != null ? Number(row.converted_value.toFixed(3)).toLocaleString() : "—";

  const sinceText = row.changed_at
    ? formatAgo(Date.now() - row.changed_at)
    : "—";

  return (
    <div
      className="grid items-center px-4 py-2.5 text-sm transition-colors"
      style={{
        gridTemplateColumns: "80px 1fr 160px 110px 80px 90px",
        background: bg,
        borderLeft: flashActive ? "2px solid var(--warning)"
          : row.is_configured ? "2px solid rgba(29,158,117,0.4)" : "2px solid transparent",
      }}
    >
      {/* IO Key */}
      <span className="font-mono text-xs font-bold" style={{ color: "var(--accent)" }}>
        {row.io_key}
      </span>

      {/* Name */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-white font-medium text-sm truncate">{row.display_name}</span>
          {row.is_configured && row.signal_type === "digital" && row.bit_index != null && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0"
              style={{ background: "rgba(245,158,11,0.15)", color: "var(--warning)" }}
            >
              bit {row.bit_index}
            </span>
          )}
        </div>
        {row.is_configured && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {row.source === "named_column" ? "columna" : "io_data"} · configurado
            {row.signal_type === "digital" && row.bit_index != null
              ? ` · digital bit${row.bit_index} de raw=${row.raw_value ?? "—"}`
              : ""}
          </span>
        )}
      </div>

      {/* Raw value */}
      <span className="text-right font-mono text-sm"
            style={{ color: isNull ? "var(--muted)" : flashActive ? "var(--warning)" : "white" }}>
        {formattedRaw}
      </span>

      {/* Converted */}
      <span className="text-right font-mono text-sm"
            style={{ color: isNull ? "var(--muted)" : "var(--success)" }}>
        {formattedConverted}
      </span>

      {/* Unit */}
      <span className="text-right text-xs" style={{ color: "var(--muted)" }}>
        {row.unit || "—"}
      </span>

      {/* Changed */}
      <span className="text-right text-xs" style={{ color: flashActive ? "var(--warning)" : "var(--muted)" }}>
        {sinceText}
      </span>
    </div>
  );
}

function formatAgo(ms: number): string {
  if (ms < 1000) return "ahora";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
