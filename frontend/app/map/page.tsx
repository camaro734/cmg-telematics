"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getFleet, geofences as geofencesApi, type FleetVehicle, type GeofenceOut } from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage } from "@/lib/websocket";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/toast";

// Dynamic import — Leaflet no es SSR-compatible
const MapView = dynamic(() => import("@/components/FleetMap"), { ssr: false });

export default function MapPage() {
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [geofenceList, setGeofenceList] = useState<GeofenceOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsLive, setWsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"all" | "online" | "moving">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toasts, addToast, dismiss } = useToast();

  const refresh = useCallback(async () => {
    try {
      const [fleetData, geoData] = await Promise.all([
        getFleet(),
        geofencesApi.list().catch(() => [] as GeofenceOut[]),
      ]);
      setFleet(fleetData.fleet);
      setGeofenceList(geoData);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useFleetWebSocket(
    useCallback((msg: WsTelemetryMessage) => {
      setWsLive(true);
      setLastUpdated(new Date());
      setFleet(prev => prev.map(v => {
        if (v.vehicle_id !== msg.vehicle_id) return v;
        return {
          ...v,
          device: v.device ? { ...v.device, online: true, last_seen: msg.time } : undefined,
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
    }, [addToast]),
  );

  const filtered = fleet.filter(v => {
    if (filter === "online") return v.device?.online;
    if (filter === "moving") return v.last_position?.ignition && (v.last_position?.speed ?? 0) > 3;
    return true;
  });

  const onlineCount  = fleet.filter(v => v.device?.online).length;
  const movingCount  = fleet.filter(v => v.last_position?.ignition && (v.last_position?.speed ?? 0) > 3).length;
  const withGps      = fleet.filter(v => v.last_position?.lat != null).length;

  return (
    <div className="flex flex-col h-full">
      <Toast toasts={toasts} onDismiss={dismiss} />
      {/* Topbar */}
      <div
        className="flex items-center justify-between px-5 py-2.5 flex-shrink-0 border-b"
        style={{ background: "var(--sidebar)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-white">Mapa en vivo</h1>
          {wsLive && (
            <span className="flex items-center gap-1 text-xs" style={{ color: "var(--success)" }}>
              <span style={{ fontSize: 8 }}>●</span> En vivo
            </span>
          )}
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {lastUpdated ? lastUpdated.toLocaleTimeString("es-ES") : ""}
          </span>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {([
            { key: "all",    label: `Todos (${fleet.length})` },
            { key: "online", label: `En línea (${onlineCount})` },
            { key: "moving", label: `En movimiento (${movingCount})` },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={{
                background: filter === f.key ? "var(--accent)" : "rgba(255,255,255,0.06)",
                color: filter === f.key ? "#fff" : "var(--muted)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {withGps} con GPS · {fleet.length} total
        </div>
      </div>

      {/* Map area + vehicle panel */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="flex items-center justify-center h-full" style={{ color: "var(--muted)" }}>
              Cargando mapa...
            </div>
          ) : (
            <MapView
              fleet={filtered}
              geofences={geofenceList}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {/* Vehicle detail panel */}
        {selectedId && (() => {
          const v = fleet.find(f => f.vehicle_id === selectedId);
          if (!v) return null;
          const pos = v.last_position;
          const pressure = pos?.io_data?.["9"] != null ? (pos.io_data["9"] * 0.006).toFixed(1) : null;
          const isMoving = pos?.ignition && (pos?.speed ?? 0) > 3;
          return (
            <div
              className="flex-shrink-0 overflow-y-auto"
              style={{ width: 260, borderLeft: "1px solid var(--border)", background: "var(--sidebar)" }}
            >
              <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between mb-1">
                  <div className="font-semibold text-white text-sm leading-tight">{v.vehicle_name}</div>
                  <button
                    onClick={() => setSelectedId(null)}
                    style={{ color: "var(--muted)" }}
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                {v.license_plate && (
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{v.license_plate}</div>
                )}
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block"
                  style={{
                    background: v.device?.online ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                    color: v.device?.online ? "var(--success)" : "var(--muted)",
                  }}
                >
                  {v.device?.online ? "En línea" : "Offline"}
                </span>
              </div>

              {pos ? (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Velocidad", value: `${pos.speed ?? 0} km/h`, hi: isMoving },
                      { label: "Ignición",  value: pos.ignition ? "ON" : "OFF", ok: pos.ignition },
                      ...(pressure ? [{ label: "Presión", value: `${pressure} bar` }] : []),
                      { label: "Voltaje",   value: pos.ext_voltage_mv ? `${(pos.ext_voltage_mv/1000).toFixed(1)}V` : "—" },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg p-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                        <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{item.label}</div>
                        <div
                          className="text-sm font-semibold"
                          style={{ color: item.hi ? "#3b82f6" : item.ok ? "var(--success)" : "var(--foreground)" }}
                        >
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {pos.lat != null && pos.lng != null && (
                    <div className="text-xs space-y-1" style={{ color: "var(--muted)" }}>
                      <div>Lat: {pos.lat?.toFixed(5)}</div>
                      <div>Lng: {pos.lng?.toFixed(5)}</div>
                      <div>Actualizado: {new Date(pos.time).toLocaleTimeString("es-ES")}</div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-1">
                    <Link
                      href={`/vehicles/${v.vehicle_id}`}
                      className="text-center text-xs py-2 rounded-lg font-medium"
                      style={{ background: "var(--accent)", color: "white" }}
                    >
                      Ver detalle
                    </Link>
                    <Link
                      href={`/trips?vehicle=${v.vehicle_id}`}
                      className="text-center text-xs py-2 rounded-lg font-medium"
                      style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}
                    >
                      Ver rutas
                    </Link>
                    {pos.lat != null && (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lng}&zoom=16`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-center text-xs py-2 rounded-lg font-medium"
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
        })()}
      </div>
    </div>
  );
}
