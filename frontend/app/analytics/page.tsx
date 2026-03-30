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
import { exportExcel, exportPdf } from "@/lib/export";

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

// ─── Eco-Driving helpers ──────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#84cc16";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

function scoreBackground(score: number): string {
  if (score >= 90) return "rgba(34,197,94,0.12)";
  if (score >= 75) return "rgba(132,204,22,0.12)";
  if (score >= 60) return "rgba(234,179,8,0.12)";
  if (score >= 40) return "rgba(249,115,22,0.12)";
  return "rgba(239,68,68,0.12)";
}

function eventCount(score: EcoDrivingScore, type: string): number {
  return score.events.find(e => e.event_type === type)?.count ?? 0;
}

// ─── EventPill ───────────────────────────────────────────────────────────────

function EventPill({
  icon,
  label,
  active,
  danger,
  warn,
}: {
  icon: string;
  label: string;
  active: boolean;
  danger?: boolean;
  warn?: boolean;
}) {
  const activeColor = danger ? "#ef4444" : warn ? "#f97316" : "var(--muted)";
  const activeBg    = danger ? "rgba(239,68,68,0.1)" : warn ? "rgba(249,115,22,0.1)" : "transparent";
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium"
      style={{
        background: active ? activeBg : "var(--sidebar)",
        color: active ? activeColor : "var(--muted)",
        border: `1px solid ${active ? activeColor : "var(--border)"}`,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

// ─── ScoreCard ────────────────────────────────────────────────────────────────

function ScoreCard({ score }: { score: EcoDrivingScore }) {
  const color = scoreColor(score.score);
  const bg = scoreBackground(score.score);
  const speeding   = eventCount(score, "speeding");
  const braking    = eventCount(score, "harsh_braking");
  const accel      = eventCount(score, "harsh_acceleration");
  const idling     = eventCount(score, "idling");

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Vehicle name */}
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/vehicles/${score.vehicle_id}`}
          className="text-sm font-semibold text-white hover:underline leading-tight"
          style={{ color: "var(--accent)" }}
        >
          {score.vehicle_name}
        </Link>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: bg, color }}
        >
          {score.period_hours >= 168 ? `${score.period_hours / 24}d` : `${score.period_hours}h`}
        </span>
      </div>

      {/* Big score + grade */}
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center justify-center rounded-xl w-20 h-20 flex-shrink-0"
             style={{ background: bg, border: `2px solid ${color}` }}>
          <span className="text-3xl font-black leading-none" style={{ color }}>
            {score.score}
          </span>
          <span className="text-xs font-semibold mt-0.5" style={{ color: "var(--muted)" }}>pts</span>
        </div>
        <div className="flex flex-col items-center justify-center">
          <span className="text-5xl font-black leading-none" style={{ color }}>
            {score.grade}
          </span>
          <span className="text-xs mt-1" style={{ color: "var(--muted)" }}>nota</span>
        </div>
      </div>

      {/* Event counters */}
      {score.total_records > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          <EventPill icon="🚀" label={`${accel} aceler.`} active={accel > 0} danger />
          <EventPill icon="🛑" label={`${braking} frenos`} active={braking > 0} danger />
          <EventPill icon="⚡" label={`${speeding} excesos`} active={speeding > 0} danger />
          <EventPill icon="💤" label={`${idling} ralentís`} active={idling > 0} warn />
        </div>
      ) : (
        <div className="text-xs text-center py-2" style={{ color: "var(--muted)" }}>
          Sin datos de telemetría en este período
        </div>
      )}

      {/* Distance & hours */}
      {score.total_records > 0 && (
        <div className="flex gap-3 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex-1 text-center">
            <div className="text-sm font-semibold text-white">{score.distance_km.toFixed(1)}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>km est.</div>
          </div>
          <div className="w-px" style={{ background: "var(--border)" }} />
          <div className="flex-1 text-center">
            <div className="text-sm font-semibold text-white">{score.ignition_hours.toFixed(1)}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>h ignición</div>
          </div>
          <div className="w-px" style={{ background: "var(--border)" }} />
          <div className="flex-1 text-center">
            <div className="text-sm font-semibold text-white">{score.total_records.toLocaleString("es-ES")}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>registros</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RankingTable ─────────────────────────────────────────────────────────────

function RankingTable({ scores }: { scores: EcoDrivingScore[] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div
        className="px-5 py-3 border-b"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <h2 className="text-sm font-semibold text-white">Ranking de conductores</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
              {[
                "Pos.", "Vehículo", "Puntuación", "Nota",
                "Exc. vel.", "Frenos br.", "Aceler. br.", "Ralentí",
                "Km", "Horas",
              ].map(col => (
                <th
                  key={col}
                  className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--muted)" }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scores.map((s, idx) => {
              const color = scoreColor(s.score);
              return (
                <tr
                  key={s.vehicle_id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(59,130,246,0.05)")}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                >
                  {/* Pos */}
                  <td className="px-3 py-3">
                    <span
                      className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center"
                      style={{
                        background: idx === 0 ? "rgba(234,179,8,0.2)" : idx === 1 ? "rgba(148,163,184,0.2)" : idx === 2 ? "rgba(180,83,9,0.2)" : "var(--sidebar)",
                        color: idx === 0 ? "#eab308" : idx === 1 ? "#94a3b8" : idx === 2 ? "#b45309" : "var(--muted)",
                      }}
                    >
                      {idx + 1}
                    </span>
                  </td>
                  {/* Vehicle */}
                  <td className="px-3 py-3 font-medium">
                    <Link
                      href={`/vehicles/${s.vehicle_id}`}
                      className="hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {s.vehicle_name}
                    </Link>
                  </td>
                  {/* Score with progress bar */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="relative rounded-full overflow-hidden h-1.5 flex-1"
                        style={{ background: "var(--border)", minWidth: 60 }}
                      >
                        <div
                          className="absolute left-0 top-0 h-full rounded-full transition-all"
                          style={{ width: `${s.score}%`, background: color }}
                        />
                      </div>
                      <span className="text-xs font-bold w-8 text-right" style={{ color }}>
                        {s.score}
                      </span>
                    </div>
                  </td>
                  {/* Grade */}
                  <td className="px-3 py-3">
                    <span
                      className="text-sm font-black px-2 py-0.5 rounded"
                      style={{ color, background: scoreBackground(s.score) }}
                    >
                      {s.grade}
                    </span>
                  </td>
                  {/* Events */}
                  <td className="px-3 py-3" style={{ color: eventCount(s, "speeding") > 0 ? "#ef4444" : "var(--muted)" }}>
                    {eventCount(s, "speeding")}
                  </td>
                  <td className="px-3 py-3" style={{ color: eventCount(s, "harsh_braking") > 0 ? "#ef4444" : "var(--muted)" }}>
                    {eventCount(s, "harsh_braking")}
                  </td>
                  <td className="px-3 py-3" style={{ color: eventCount(s, "harsh_acceleration") > 0 ? "#ef4444" : "var(--muted)" }}>
                    {eventCount(s, "harsh_acceleration")}
                  </td>
                  <td className="px-3 py-3" style={{ color: eventCount(s, "idling") > 0 ? "#f97316" : "var(--muted)" }}>
                    {eventCount(s, "idling")}
                  </td>
                  {/* Distance & hours */}
                  <td className="px-3 py-3" style={{ color: "var(--foreground)" }}>
                    {s.distance_km.toFixed(1)}
                  </td>
                  <td className="px-3 py-3" style={{ color: "var(--foreground)" }}>
                    {s.ignition_hours.toFixed(1)}
                  </td>
                </tr>
              );
            })}
            {scores.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
                  Sin datos de conducción para el período seleccionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── ecoColor (for analytics KPI card) ───────────────────────────────────────

function ecoColor(score: number): string {
  return scoreColor(score);
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<"analytics" | "ecodriving">("analytics");
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

  // Eco-driving derived values
  const withData = ecoScores.filter(s => s.total_records > 0);
  const avgScore = withData.length > 0
    ? Math.round(withData.reduce((acc, s) => acc + s.score, 0) / withData.length)
    : null;

  function handleExportExcel() {
    const now = new Date().toLocaleDateString("es-ES");
    const periodLabel2 = customHours
      ? `${hours}h personalizado`
      : PERIODS.find((p) => p.hours === hours)?.label ?? `${hours}h`;

    const kpiRows = analytics
      ? [
          {
            "Período (h)": analytics.period_hours,
            "Distancia total (km)": analytics.total_distance_km.toFixed(1),
            "Horas encendido": analytics.total_ignition_hours.toFixed(1),
            "Vel. media (km/h)": analytics.avg_speed_kmh?.toFixed(1) ?? "—",
            "Vel. máx. (km/h)": analytics.max_speed_kmh,
            "Vehículos activos": analytics.vehicles_active,
            "Vehículos totales": analytics.vehicles_total,
            "Presión media (bar)": analytics.pressure_avg_bar != null ? analytics.pressure_avg_bar.toFixed(1) : "—",
          },
        ]
      : [];

    const vehicleRows = vehicleStats.map((v) => ({
      "Vehículo": v.vehicle_name,
      "Registros": v.records,
      "H.Encendido": v.ignition_hours.toFixed(1),
      "Distancia km": v.distance_km.toFixed(1),
      "Vel.Máx km/h": v.max_speed,
      "P.Media bar": v.avg_pressure_bar != null ? v.avg_pressure_bar.toFixed(1) : "—",
      "Online": v.online ? "Sí" : "No",
    }));

    const ecoRows = ecoScores.map((s) => ({
      "Vehículo": s.vehicle_name,
      "Puntuación": s.score,
      "Nota": s.grade,
      "Eventos": s.events.reduce((acc, e) => acc + e.count, 0),
      "Distancia km": s.distance_km.toFixed(1),
      "H.Encendido": s.ignition_hours.toFixed(1),
    }));

    exportExcel(
      [
        { name: "KPIs", rows: kpiRows },
        { name: "Vehículos", rows: vehicleRows },
        { name: "Eco-Driving", rows: ecoRows },
      ],
      `analiticas-flota-${periodLabel2}-${now.replace(/\//g, "-")}.xlsx`
    );
  }

  async function handleExportPdf() {
    const now = new Date().toLocaleString("es-ES");
    const periodLabel2 = customHours
      ? `${hours}h personalizado`
      : PERIODS.find((p) => p.hours === hours)?.label ?? `${hours}h`;

    const kpiText = analytics
      ? `Distancia: ${analytics.total_distance_km.toFixed(1)} km | H. encendido: ${analytics.total_ignition_hours.toFixed(1)} h | Vel. media: ${analytics.avg_speed_kmh?.toFixed(1) ?? "—"} km/h | Activos: ${analytics.vehicles_active}/${analytics.vehicles_total}`
      : "Sin datos";

    await exportPdf(
      "Informe de Flota",
      `Período: ${periodLabel2} | Fecha: ${now}`,
      [
        { text: kpiText },
        {
          title: "Estadísticas por Vehículo",
          table: {
            head: [["Vehículo", "Registros", "H.Encendido", "Distancia km", "Vel.Máx km/h", "P.Media bar", "Online"]],
            body: vehicleStats.map((v) => [
              v.vehicle_name,
              v.records,
              v.ignition_hours.toFixed(1),
              v.distance_km.toFixed(1),
              v.max_speed,
              v.avg_pressure_bar != null ? v.avg_pressure_bar.toFixed(1) : "—",
              v.online ? "Sí" : "No",
            ]),
          },
        },
        {
          title: "Eco-Driving",
          table: {
            head: [["Vehículo", "Puntuación", "Nota", "Eventos", "Distancia km", "H.Encendido"]],
            body: ecoScores.map((s) => [
              s.vehicle_name,
              s.score,
              s.grade,
              s.events.reduce((acc, e) => acc + e.count, 0),
              s.distance_km.toFixed(1),
              s.ignition_hours.toFixed(1),
            ]),
          },
        },
      ],
      `informe-flota-${periodLabel2}-${now.replace(/[/:, ]/g, "-")}.pdf`
    );
  }

  return (
    <div className="flex flex-col h-full w-full max-w-none">
      {/* Header */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-bold text-white">
            {activeTab === "analytics" ? "Analíticas de Flota" : "Conducción Eficiente"}
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {lastUpdated
              ? `Actualizado: ${lastUpdated.toLocaleTimeString("es-ES")} — Periodo: últimas ${periodLabel}`
              : "Cargando..."}
            {activeTab === "ecodriving" && avgScore != null && ` — Puntuación media flota: `}
            {activeTab === "ecodriving" && avgScore != null && (
              <span style={{ color: scoreColor(avgScore), fontWeight: 700 }}>
                {avgScore} ({avgScore >= 90 ? "A" : avgScore >= 75 ? "B" : avgScore >= 60 ? "C" : avgScore >= 40 ? "D" : "F"})
              </span>
            )}
          </p>
        </div>

        {/* Right side: tab switcher + period selector */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tab switcher */}
          <div
            className="flex items-center gap-1 p-1 rounded-lg"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <button
              onClick={() => setActiveTab("analytics")}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={{
                background: activeTab === "analytics" ? "var(--accent)" : "transparent",
                color: activeTab === "analytics" ? "#fff" : "var(--muted)",
              }}
            >
              Analíticas
            </button>
            <button
              onClick={() => setActiveTab("ecodriving")}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={{
                background: activeTab === "ecodriving" ? "var(--accent)" : "transparent",
                color: activeTab === "ecodriving" ? "#fff" : "var(--muted)",
              }}
            >
              Eco-Driving
            </button>
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

          {/* Export buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M14 2v6h6M8 13h8M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Excel
            </button>
            <button
              onClick={handleExportPdf}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M14 2v6h6M9 13h1.5a1.5 1.5 0 010 3H9v-3zm0 3v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              PDF
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {error && (
          <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "#450a0a", color: "#fca5a5" }}>
            {error}
          </div>
        )}

        {/* ── ANALYTICS TAB ──────────────────────────────────────────────────── */}
        {activeTab === "analytics" && (
          <>
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
                  const withDataKpi = ecoScores.filter(s => s.total_records > 0);
                  const avg = withDataKpi.length > 0
                    ? Math.round(withDataKpi.reduce((acc, s) => acc + s.score, 0) / withDataKpi.length)
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
          </>
        )}

        {/* ── ECO-DRIVING TAB ────────────────────────────────────────────────── */}
        {activeTab === "ecodriving" && (
          <>
            {/* Score cards grid */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-64" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ecoScores.map(s => (
                  <ScoreCard key={s.vehicle_id} score={s} />
                ))}
              </div>
            )}

            {/* Ranking table */}
            {!loading && <RankingTable scores={ecoScores} />}
          </>
        )}
      </div>
    </div>
  );
}
