"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getFleetAnalytics,
  getVehicleStats,
  getEcoDrivingScores,
  type FleetAnalytics,
  type VehicleStats,
  type EcoDrivingScore,
} from "@/lib/api";
import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Cell,
} from "recharts";

// ─── Period selector ──────────────────────────────────────────────────────────

const PERIODS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
  { label: "90d", hours: 2160 },
];

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          {label}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold text-white leading-none">{value}</span>
        {unit && (
          <span className="text-sm pb-0.5" style={{ color: "var(--muted)" }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl ${className ?? ""}`}
      style={{ background: "var(--card)" }}
    />
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

function ecoColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#84cc16";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

export default function AnalyticsPage() {
  const [hours, setHours] = useState(24);
  const [customHours, setCustomHours] = useState("");
  const [analytics, setAnalytics] = useState<FleetAnalytics | null>(null);
  const [vehicleStats, setVehicleStats] = useState<VehicleStats[]>([]);
  const [ecoScores, setEcoScores] = useState<EcoDrivingScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async (h: number) => {
    setLoading(true);
    setError("");
    try {
      const [a, vs, eco] = await Promise.all([
        getFleetAnalytics(h),
        getVehicleStats(h),
        getEcoDrivingScores(h),
      ]);
      setAnalytics(a);
      setVehicleStats(vs);
      setEcoScores(eco);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando analíticas");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and period change
  useEffect(() => {
    refresh(hours);
  }, [refresh, hours]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(() => refresh(hours), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh, hours]);

  const periodLabel = customHours
    ? `${hours}h personalizado`
    : PERIODS.find((p) => p.hours === hours)?.label ?? `${hours}h`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-bold text-white">Analíticas de Flota</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {lastUpdated
              ? `Actualizado: ${lastUpdated.toLocaleTimeString("es-ES")} — Periodo: últimas ${periodLabel}`
              : "Cargando..."}
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            {PERIODS.map((p) => (
              <button
                key={p.hours}
                onClick={() => { setHours(p.hours); setCustomHours(""); }}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                style={{
                  background: hours === p.hours && !customHours ? "var(--accent)" : "transparent",
                  color: hours === p.hours && !customHours ? "#fff" : "var(--muted)",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Custom hours input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const h = parseInt(customHours, 10);
              if (h > 0 && h <= 8760) setHours(h);
            }}
            className="flex items-center gap-1"
          >
            <input
              type="number"
              min={1}
              max={8760}
              placeholder="horas"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              className="w-20 px-2 py-1.5 rounded-lg text-sm text-white text-center"
              style={{ background: "var(--card)", border: `1px solid ${customHours ? "var(--accent)" : "var(--border)"}` }}
            />
            <button
              type="submit"
              disabled={!customHours}
              className="px-2 py-1.5 rounded-lg text-sm font-medium transition-opacity"
              style={{ background: "var(--accent)", color: "white", opacity: customHours ? 1 : 0.4 }}
            >
              →
            </button>
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {error && (
          <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "#450a0a", color: "#fca5a5" }}>
            {error}
          </div>
        )}

        {/* KPI Cards */}
        {loading || !analytics ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* 1 — Distance */}
            <KpiCard
              label="Km totales recorridos"
              value={analytics.total_distance_km.toFixed(1)}
              unit="km"
              color="var(--accent)"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <rect x="1" y="3" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M16 8h4l3 5v3h-7V8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="5.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              }
            />

            {/* 2 — Work hours */}
            <KpiCard
              label="Horas de trabajo"
              value={analytics.total_ignition_hours.toFixed(1)}
              unit="h"
              color="var(--warning)"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            />

            {/* 3 — Max speed */}
            <KpiCard
              label="Velocidad máxima"
              value={analytics.max_speed_kmh}
              unit="km/h"
              color="#f97316"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 12l-4-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                </svg>
              }
            />

            {/* 4 — Vehicles active */}
            <KpiCard
              label="Vehículos activos"
              value={analytics.vehicles_active}
              unit={`/ ${analytics.vehicles_total}`}
              color="var(--success)"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            />

            {/* 5 — Avg pressure */}
            <KpiCard
              label="Presión media"
              value={
                analytics.pressure_avg_bar != null
                  ? analytics.pressure_avg_bar.toFixed(1)
                  : "—"
              }
              unit={analytics.pressure_avg_bar != null ? "bar" : ""}
              color="#1D9E75"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path d="M12 22V12M12 12C12 7 7 4 7 4s1 5 5 8zM12 12C12 7 17 4 17 4s-1 5-5 8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="12" cy="22" r="1" fill="currentColor" />
                </svg>
              }
            />

            {/* 6 — Max pressure */}
            <KpiCard
              label="Presión máxima"
              value={
                analytics.pressure_max_bar != null
                  ? analytics.pressure_max_bar.toFixed(1)
                  : "—"
              }
              unit={analytics.pressure_max_bar != null ? "bar" : ""}
              color="#a855f7"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
            />

            {/* 7 — Avg eco score */}
            {(() => {
              const withData = ecoScores.filter(s => s.total_records > 0);
              const avg = withData.length > 0
                ? Math.round(withData.reduce((acc, s) => acc + s.score, 0) / withData.length)
                : null;
              const grade = avg == null ? "—" : avg >= 90 ? "A" : avg >= 75 ? "B" : avg >= 60 ? "C" : avg >= 40 ? "D" : "F";
              const color = avg != null ? ecoColor(avg) : "var(--muted)";
              return (
                <KpiCard
                  label="Puntuación media flota"
                  value={avg != null ? `${avg} (${grade})` : "—"}
                  unit={avg != null ? "pts" : ""}
                  color={color}
                  icon={
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  }
                />
              );
            })()}
          </div>
        )}

        {/* Charts row */}
        {!loading && vehicleStats.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Hours bar chart */}
            <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold text-white mb-4">Horas de trabajo por vehículo</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={vehicleStats.map(v => ({ name: v.vehicle_name.split(" ").slice(-2).join(" "), value: parseFloat(v.ignition_hours.toFixed(1)), online: v.online }))}
                  margin={{ top: 0, right: 0, left: -20, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "white" }}
                    formatter={(v: unknown) => [`${v} h`, "Horas"]}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {vehicleStats.map((v, i) => (
                      <Cell key={i} fill={v.online ? "var(--accent)" : "var(--muted)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Distance bar chart */}
            <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold text-white mb-4">Kilómetros estimados por vehículo</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={vehicleStats.map(v => ({ name: v.vehicle_name.split(" ").slice(-2).join(" "), value: parseFloat(v.distance_km.toFixed(1)) }))}
                  margin={{ top: 0, right: 0, left: -20, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "white" }}
                    formatter={(v: unknown) => [`${v} km`, "Distancia"]}
                  />
                  <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Vehicle comparison table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <div
            className="px-5 py-3 flex items-center justify-between border-b"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <h2 className="text-sm font-semibold text-white">Comparativa por vehículo</h2>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Ordenado por horas de trabajo
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
                  {["Vehículo", "Registros", "Horas trabajo", "Km est.", "V. máx.", "P. media (bar)", "Eco Score", "Estado"].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "var(--muted)" }}
                      >
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <td key={j} className="px-4 py-3">
                            <div
                              className="h-4 rounded animate-pulse"
                              style={{ background: "var(--border)", width: j === 0 ? "8rem" : "3rem" }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  : vehicleStats.map((v) => (
                      <tr
                        key={v.vehicle_id}
                        className="transition-colors"
                        style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={(e) =>
                          ((e.currentTarget as HTMLElement).style.background = "rgba(59,130,246,0.05)")
                        }
                        onMouseLeave={(e) =>
                          ((e.currentTarget as HTMLElement).style.background = "transparent")
                        }
                      >
                        <td className="px-4 py-3 font-medium text-white">
                          <Link
                            href={`/vehicles/${v.vehicle_id}`}
                            className="hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {v.vehicle_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--muted)" }}>
                          {v.records.toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--foreground)" }}>
                          {v.ignition_hours.toFixed(1)} h
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--foreground)" }}>
                          {v.distance_km.toFixed(1)} km
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--foreground)" }}>
                          {v.max_speed} km/h
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--foreground)" }}>
                          {v.avg_pressure_bar != null ? v.avg_pressure_bar.toFixed(1) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const es = ecoScores.find(s => s.vehicle_id === v.vehicle_id);
                            if (!es || es.total_records === 0) return <span style={{ color: "var(--muted)" }}>—</span>;
                            const c = ecoColor(es.score);
                            return (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold" style={{ color: c }}>{es.score}</span>
                                <span className="text-xs font-black px-1.5 py-0.5 rounded"
                                      style={{ color: c, background: `${c}20` }}>{es.grade}</span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              background: v.online
                                ? "rgba(34,197,94,0.15)"
                                : "rgba(100,116,139,0.15)",
                              color: v.online ? "var(--success)" : "var(--muted)",
                            }}
                          >
                            {v.online ? "EN LÍNEA" : "OFFLINE"}
                          </span>
                        </td>
                      </tr>
                    ))}

                {!loading && vehicleStats.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
                      Sin datos para el periodo seleccionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
