"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { getVehicles, getTrips, getTripTrack, type Vehicle, type Trip, type TrackPoint } from "@/lib/api";

const TripMap = dynamic(() => import("@/components/TripMap"), { ssr: false });

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export default function TripsPage() {
  const searchParams = useSearchParams();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState(searchParams.get("vehicle") ?? "");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsError, setTripsError] = useState("");

  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [loadingTrack, setLoadingTrack] = useState(false);

  // Auto-load trips when vehicle is pre-selected via URL param
  const autoLoaded = useRef(false);

  useEffect(() => {
    const vehicleParam = searchParams.get("vehicle");
    getVehicles().then((vs) => {
      setVehicles(vs);
      if (!vehicleParam && vs.length > 0) setSelectedVehicle(vs[0].id);
    });
  }, [searchParams]);

  // Trigger auto-load on mount when vehicle param is present
  useEffect(() => {
    if (autoLoaded.current) return;
    const vehicleParam = searchParams.get("vehicle");
    if (!vehicleParam) return;
    autoLoaded.current = true;
    // Small delay to let state initialize
    const t = setTimeout(() => {
      setLoadingTrips(true);
      setTripsError("");
      const start = new Date(startDate + "T00:00:00").toISOString();
      const end = new Date(endDate + "T23:59:59").toISOString();
      getTrips(vehicleParam, start, end)
        .then(setTrips)
        .catch(e => setTripsError(e instanceof Error ? e.message : "Error cargando rutas"))
        .finally(() => setLoadingTrips(false));
    }, 100);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTrips = useCallback(async () => {
    if (!selectedVehicle) return;
    setLoadingTrips(true);
    setTripsError("");
    setTrips([]);
    setSelectedTrip(null);
    setTrackPoints([]);
    try {
      const start = new Date(startDate + "T00:00:00").toISOString();
      const end = new Date(endDate + "T23:59:59").toISOString();
      const data = await getTrips(selectedVehicle, start, end);
      setTrips(data);
    } catch (e) {
      setTripsError(e instanceof Error ? e.message : "Error cargando rutas");
    } finally {
      setLoadingTrips(false);
    }
  }, [selectedVehicle, startDate, endDate]);

  async function handleSelectTrip(trip: Trip) {
    setSelectedTrip(trip);
    setTrackPoints([]);
    setLoadingTrack(true);
    try {
      const start = new Date(startDate + "T00:00:00").toISOString();
      const end = new Date(endDate + "T23:59:59").toISOString();
      const points = await getTripTrack(selectedVehicle, trip.trip_num, start, end);
      setTrackPoints(points);
    } catch (e) {
      console.error("Error loading track", e);
    } finally {
      setLoadingTrack(false);
    }
  }

  const totalKm = trips.reduce((sum, t) => sum + t.distance_km, 0);
  const totalHours = trips.reduce((sum, t) => sum + t.duration_seconds / 3600, 0);

  function exportTripsCsv() {
    const header = "Ruta,Inicio,Fin,Duración (min),Distancia (km),Vel. máx (km/h),Vel. media (km/h),Registros";
    const rows = trips.map(t =>
      [
        t.trip_num,
        t.start_time,
        t.end_time,
        (t.duration_seconds / 60).toFixed(0),
        t.distance_km.toFixed(2),
        t.max_speed,
        t.avg_speed.toFixed(0),
        t.record_count,
      ].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const vehicle = vehicles.find(v => v.id === selectedVehicle);
    a.href = url;
    a.download = `rutas_${vehicle?.name ?? selectedVehicle}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-6 py-6 max-w-none w-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-white">Historial de Rutas</h1>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          Rutas detectadas por ciclos encendido/apagado
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={selectedVehicle}
          onChange={(e) => setSelectedVehicle(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">Seleccionar vehículo</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        />

        <button
          onClick={loadTrips}
          disabled={!selectedVehicle || loadingTrips}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
          style={{
            background: "var(--accent)",
            color: "white",
            opacity: !selectedVehicle || loadingTrips ? 0.5 : 1,
          }}
        >
          {loadingTrips ? "Cargando..." : "Buscar rutas"}
        </button>
      </div>

      {tripsError && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
          {tripsError}
        </div>
      )}

      <div className="flex gap-5" style={{ minHeight: 520 }}>
        {/* Trip list */}
        <div className="flex-shrink-0" style={{ width: 340 }}>
          {/* Summary strip */}
          {trips.length > 0 && (
            <>
              <div className="flex gap-3 mb-2">
                <div className="flex-1 rounded-lg px-3 py-2 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="text-lg font-bold text-white">{trips.length}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>Rutas</div>
                </div>
                <div className="flex-1 rounded-lg px-3 py-2 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="text-lg font-bold text-white">{totalKm.toFixed(0)}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>km est.</div>
                </div>
                <div className="flex-1 rounded-lg px-3 py-2 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="text-lg font-bold text-white">{totalHours.toFixed(1)}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>horas</div>
                </div>
              </div>
              <button
                onClick={exportTripsCsv}
                className="w-full flex items-center justify-center gap-2 mb-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Exportar CSV
              </button>
            </>
          )}

          <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 480 }}>
            {loadingTrips ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--card)" }} />
              ))
            ) : trips.length === 0 && !loadingTrips ? (
              <div className="rounded-xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <svg width="36" height="36" fill="none" viewBox="0 0 24 24" className="mx-auto mb-2" style={{ color: "var(--muted)" }}>
                  <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <div className="text-sm font-medium text-white mb-1">Sin rutas</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {selectedVehicle
                    ? "No se detectaron rutas en el período seleccionado"
                    : "Selecciona un vehículo y pulsa Buscar"}
                </div>
              </div>
            ) : (() => {
              // Group trips by calendar day
              const maxDist = Math.max(...trips.map(t => t.distance_km), 1);
              const groups: { day: string; trips: Trip[] }[] = [];
              trips.forEach(trip => {
                const day = new Date(trip.start_time).toLocaleDateString("es-ES", {
                  weekday: "long", day: "2-digit", month: "long",
                });
                const last = groups[groups.length - 1];
                if (last && last.day === day) last.trips.push(trip);
                else groups.push({ day, trips: [trip] });
              });
              return groups.map(group => (
                <div key={group.day}>
                  {/* Day header */}
                  <div className="px-1 py-1.5 flex items-center gap-2">
                    <div className="h-px flex-1" style={{ background: "var(--border)" }} />
                    <span className="text-xs font-semibold capitalize flex-shrink-0"
                          style={{ color: "var(--muted)" }}>
                      {group.day}
                    </span>
                    <div className="h-px flex-1" style={{ background: "var(--border)" }} />
                  </div>
                  {group.trips.map(trip => {
                    const isActive = selectedTrip?.trip_num === trip.trip_num;
                    const distKm = trip.distance_km;
                    const distPct = (distKm / maxDist) * 100;
                    const speedColor = trip.max_speed >= 100 ? "#ef4444" : trip.max_speed >= 70 ? "#f59e0b" : "#22c55e";
                    return (
                      <button
                        key={trip.trip_num}
                        onClick={() => handleSelectTrip(trip)}
                        className="w-full text-left rounded-xl p-3 transition-colors mb-1"
                        style={{
                          background: isActive ? "rgba(59,130,246,0.12)" : "var(--card)",
                          border: `1px solid ${isActive ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                        }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold" style={{ color: isActive ? "#60a5fa" : "var(--accent)" }}>
                            Ruta #{trip.trip_num}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded font-mono font-bold"
                                style={{ background: `${speedColor}22`, color: speedColor, fontSize: 10 }}>
                            {trip.max_speed} km/h
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs mb-2" style={{ color: "var(--muted)" }}>
                          <span>{formatDateTime(trip.start_time)}</span>
                          <span>→</span>
                          <span>{formatDateTime(trip.end_time)}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs mb-2" style={{ color: "var(--muted)" }}>
                          <span className="flex items-center gap-1">
                            <svg width="10" height="10" fill="none" viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                              <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                            {formatDuration(trip.duration_seconds)}
                          </span>
                          <span className="flex items-center gap-1">
                            <svg width="10" height="10" fill="none" viewBox="0 0 24 24">
                              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" strokeWidth="2"/>
                            </svg>
                            ~{distKm.toFixed(1)} km
                          </span>
                          <span className="flex items-center gap-1">
                            <svg width="10" height="10" fill="none" viewBox="0 0 24 24">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                            </svg>
                            {trip.avg_speed.toFixed(0)} km/h media
                          </span>
                        </div>
                        {/* Distance bar */}
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                          <div className="h-full rounded-full"
                               style={{ width: `${distPct}%`, background: isActive ? "#3b82f6" : "var(--accent)" }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Map panel */}
        <div className="flex-1 rounded-xl overflow-hidden relative" style={{ border: "1px solid var(--border)", minHeight: 460 }}>
          {selectedTrip ? (
            <>
              {loadingTrack && (
                <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
                  <div className="text-sm text-white">Cargando ruta...</div>
                </div>
              )}
              {trackPoints.length > 0 && (
                <TripMap
                  key={selectedTrip.trip_num}
                  points={trackPoints}
                  height="100%"
                />
              )}
              {!loadingTrack && trackPoints.length === 0 && (
                <div className="flex items-center justify-center h-full" style={{ background: "var(--card)" }}>
                  <div className="text-sm" style={{ color: "var(--muted)" }}>Sin coordenadas GPS para esta ruta</div>
                </div>
              )}

              {/* Speed legend */}
              <div className="absolute bottom-3 left-3 z-[500] rounded-lg px-2.5 py-2 text-xs"
                   style={{ background: "rgba(15,17,26,0.85)", border: "1px solid var(--border)" }}>
                <div className="text-xs font-semibold text-white mb-1.5">Velocidad</div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: "rgb(34,197,94)" }} />
                  <span style={{ color: "var(--muted)" }}>0 km/h</span>
                </div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: "rgb(250,204,11)" }} />
                  <span style={{ color: "var(--muted)" }}>60 km/h</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: "rgb(239,68,68)" }} />
                  <span style={{ color: "var(--muted)" }}>120+ km/h</span>
                </div>
              </div>

              {/* Trip stats overlay */}
              {selectedTrip && (
                <div className="absolute top-3 right-3 z-[500] rounded-lg px-3 py-2 text-xs"
                     style={{ background: "rgba(15,17,26,0.9)", border: "1px solid var(--border)" }}>
                  <div className="font-semibold text-white mb-1">Ruta #{selectedTrip.trip_num}</div>
                  <div style={{ color: "var(--muted)" }}>Inicio: {formatDateTime(selectedTrip.start_time)}</div>
                  <div style={{ color: "var(--muted)" }}>Fin: {formatDateTime(selectedTrip.end_time)}</div>
                  <div style={{ color: "var(--muted)" }}>Duración: {formatDuration(selectedTrip.duration_seconds)}</div>
                  <div style={{ color: "var(--muted)" }}>Vel. máx: {selectedTrip.max_speed} km/h</div>
                  <div style={{ color: "var(--muted)" }}>Vel. media: {selectedTrip.avg_speed.toFixed(0)} km/h</div>
                  <div style={{ color: "var(--muted)" }}>{selectedTrip.record_count} registros</div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full" style={{ background: "var(--card)" }}>
              <svg width="48" height="48" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)", marginBottom: 12 }}>
                <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <div className="text-sm font-medium" style={{ color: "var(--muted)" }}>
                {trips.length > 0 ? "Selecciona una ruta para ver el recorrido" : "Busca rutas para empezar"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
