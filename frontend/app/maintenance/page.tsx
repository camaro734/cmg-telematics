"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Modal from "@/components/Modal";
import { exportExcel, exportPdf } from "@/lib/export";
import {
  maintenance,
  getVehicles,
  getLiveSignals,
  type MaintenanceTaskOut,
  type MaintenanceLogCreate,
  type IoKeyOption,
  type Vehicle,
  type LiveSignal,
} from "@/lib/api";

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string; color: string }> = {
    overdue: { label: "Vencida", bg: "rgba(239,68,68,0.15)", color: "#f87171" },
    warning: { label: "Próxima", bg: "rgba(251,146,60,0.15)", color: "#fb923c" },
    ok:      { label: "Al día",  bg: "rgba(34,197,94,0.15)", color: "var(--success)" },
  };
  const c = config[status] ?? config.ok;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

// ─── Trigger type label ───────────────────────────────────────────────────────
function triggerLabel(type: string): string {
  return { km: "Por km", hours: "Por horas", days: "Por días", date: "Fecha fija" }[type] ?? type;
}

// ─── Engine hours progress bar ────────────────────────────────────────────────
function HoursProgress({ task }: { task: MaintenanceTaskOut }) {
  if (task.trigger_type !== "hours") return null;
  const current = task.current_hours ?? 0;
  const due = task.next_due_hours;
  const dateDue = task.next_due_date;

  const pct = due ? Math.min(100, (current / due) * 100) : 0;
  const color = pct >= 100 ? "#f87171" : pct >= 80 ? "#fb923c" : "var(--success)";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs font-mono">
        <span style={{ color: color }}>{current.toFixed(1)}h</span>
        {due != null && <span style={{ color: "var(--muted)" }}>/ {due.toLocaleString("es-ES")}h</span>}
      </div>
      {due != null && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)", width: "100px" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
      {dateDue && (
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          hasta {new Date(dateDue).toLocaleDateString("es-ES")}
        </div>
      )}
    </div>
  );
}

// ─── Format next due ──────────────────────────────────────────────────────────
function formatNextDue(task: MaintenanceTaskOut): string {
  if (task.trigger_type === "km" && task.next_due_km != null)
    return `${task.next_due_km.toLocaleString("es-ES")} km`;
  if (task.trigger_type === "hours")
    return ""; // shown via HoursProgress
  if ((task.trigger_type === "days" || task.trigger_type === "date") && task.next_due_date)
    return new Date(task.next_due_date).toLocaleDateString("es-ES");
  return "—";
}

// ─── Field helper ─────────────────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{hint}</p>}
    </div>
  );
}

const INPUT_CLASS = "w-full px-3 py-2.5 rounded-lg text-sm text-white";
const INPUT_STYLE = { background: "var(--sidebar)", border: "1px solid var(--border)" };

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MaintenancePage() {
  const searchParams = useSearchParams();
  const vehicleIdParam = searchParams.get("vehicle_id");

  const [tasks, setTasks] = useState<MaintenanceTaskOut[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [ioKeys, setIoKeys] = useState<IoKeyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveSignals, setLiveSignals] = useState<LiveSignal[] | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(false);

  // Summary counts
  const overdue = tasks.filter(t => t.status === "overdue").length;
  const warning = tasks.filter(t => t.status === "warning").length;
  const ok = tasks.filter(t => t.status === "ok").length;

  // Filters
  const [filterVehicle, setFilterVehicle] = useState(vehicleIdParam ?? "");
  const [filterStatus, setFilterStatus] = useState("");

  // Create task modal
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    vehicle_id: "",
    name: "",
    description: "",
    trigger_type: "km",
    interval_value: "",
    next_due_km: "",
    next_due_hours: "",
    next_due_date: "",
    next_due_date_fallback: "", // calendar fallback for "hours" tasks
    warn_before: "50",
    pto_io_key: "ignition",
  });

  // Complete task modal
  const [completing, setCompleting] = useState<MaintenanceTaskOut | null>(null);
  const [completeForm, setCompleteForm] = useState({ notes: "", odometer_km: "" });
  const [completeError, setCompleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: { vehicle_id?: string; status?: string } = {};
      if (filterVehicle) params.vehicle_id = filterVehicle;
      if (filterStatus) params.status = filterStatus;
      const [t, v] = await Promise.all([maintenance.listTasks(params), getVehicles()]);
      setTasks(t);
      setVehicles(v);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [filterVehicle, filterStatus]);

  useEffect(() => { load(); }, [load]);

  // Load IO keys once
  useEffect(() => {
    maintenance.fetchIoKeys().then(setIoKeys).catch(() => {});
  }, []);

  // Pre-fill vehicle when coming from vehicle detail
  useEffect(() => {
    if (vehicleIdParam) setFilterVehicle(vehicleIdParam);
  }, [vehicleIdParam]);

  useEffect(() => {
    if (!createForm.vehicle_id || createForm.trigger_type !== "hours") {
      setLiveSignals(null);
      return;
    }
    setLoadingSignals(true);
    getLiveSignals(createForm.vehicle_id)
      .then(res => {
        // Only boolean/digital signals make sense for hour counting
        const boolSignals = res.signals.filter(
          s => s.data_type === "boolean" ||
            ["ignition","din1","din2","din3","din4","dout1","dout2","dout3","dout4"].includes(s.io_key)
        );
        setLiveSignals(boolSignals);
      })
      .catch(() => setLiveSignals([]))
      .finally(() => setLoadingSignals(false));
  }, [createForm.vehicle_id, createForm.trigger_type]);

  async function handleCreate() {
    setCreateError("");
    try {
      const body: Record<string, unknown> = {
        vehicle_id: createForm.vehicle_id,
        name: createForm.name,
        trigger_type: createForm.trigger_type,
        warn_before: parseFloat(createForm.warn_before) || 50,
      };
      if (createForm.description) body.description = createForm.description;
      if (createForm.interval_value) body.interval_value = parseFloat(createForm.interval_value);
      if (createForm.trigger_type === "km" && createForm.next_due_km)
        body.next_due_km = parseFloat(createForm.next_due_km);
      if (createForm.trigger_type === "hours") {
        if (createForm.next_due_hours) body.next_due_hours = parseFloat(createForm.next_due_hours);
        // calendar fallback: use explicit date or default to 1 year from today
        if (createForm.next_due_date_fallback) {
          body.next_due_date = createForm.next_due_date_fallback;
        } else {
          const oneYear = new Date();
          oneYear.setFullYear(oneYear.getFullYear() + 1);
          body.next_due_date = oneYear.toISOString().split("T")[0];
        }
        body.pto_io_key = createForm.pto_io_key;
      }
      if ((createForm.trigger_type === "days" || createForm.trigger_type === "date") && createForm.next_due_date)
        body.next_due_date = createForm.next_due_date;

      await maintenance.createTask(body as Parameters<typeof maintenance.createTask>[0]);
      setShowCreate(false);
      await load();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Error");
    }
  }

  async function handleComplete() {
    if (!completing) return;
    setCompleteError("");
    try {
      const body: MaintenanceLogCreate = {
        task_id: completing.id,
        performed_at: new Date().toISOString(),
        notes: completeForm.notes || undefined,
        odometer_km: completeForm.odometer_km ? parseFloat(completeForm.odometer_km) : undefined,
      };
      await maintenance.completeTask(body);
      setCompleting(null);
      await load();
    } catch (e: unknown) {
      setCompleteError(e instanceof Error ? e.message : "Error");
    }
  }

  function openCreate() {
    setLiveSignals(null);
    const firstVehicle = vehicles[0];
    setCreateForm({
      vehicle_id: filterVehicle || firstVehicle?.id || "",
      name: "",
      description: "",
      trigger_type: "km",
      interval_value: "",
      next_due_km: "",
      next_due_hours: "",
      next_due_date: "",
      next_due_date_fallback: "",
      warn_before: "50",
      pto_io_key: "ignition",
    });
    setCreateError("");
    setShowCreate(true);
  }

  function openComplete(task: MaintenanceTaskOut) {
    setCompleting(task);
    setCompleteForm({ notes: "", odometer_km: "" });
    setCompleteError("");
  }

  const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]));
  const ioKeyLabel = (key: string) =>
    ioKeys.find(k => k.key === key)?.label ?? key;

  const statusLabel = (s: string) =>
    s === "overdue" ? "Vencida" : s === "warning" ? "Aviso" : "OK";

  const triggerLabelEs = (type: string) =>
    ({ km: "Kilómetros", hours: "Horas", days: "Días", date: "Fecha" }[type] ?? type);

  function handleExportExcel() {
    const rows = tasks.map((t) => ({
      "Vehículo": t.vehicle_name ?? vehicleMap[t.vehicle_id] ?? "—",
      "Tarea": t.name,
      "Tipo activación": triggerLabelEs(t.trigger_type),
      "Intervalo": t.interval_value != null
        ? `${t.interval_value} ${t.trigger_type === "km" ? "km" : t.trigger_type === "hours" ? "h" : "días"}`
        : "—",
      "Estado": statusLabel(t.status),
      "Próximo vencimiento": formatNextDue(t) || (t.trigger_type === "hours" && t.next_due_hours != null ? `${t.next_due_hours} h` : "—"),
      "Horas actuales": t.current_hours != null ? t.current_hours.toFixed(1) : "—",
      "Último mantenimiento": t.last_maintenance_at
        ? new Date(t.last_maintenance_at).toLocaleDateString("es-ES")
        : "—",
    }));
    const now = new Date().toLocaleDateString("es-ES").replace(/\//g, "-");
    exportExcel(
      [{ name: "Mantenimiento", rows }],
      `mantenimiento-${now}.xlsx`
    );
  }

  async function handleExportPdf() {
    const now = new Date().toLocaleString("es-ES");
    const summary = `Total tareas: ${tasks.length} | Vencidas: ${overdue} | Avisos: ${warning} | OK: ${ok}`;
    await exportPdf(
      "Informe de Mantenimiento",
      `Fecha: ${now}`,
      [
        { text: summary },
        {
          title: "Tareas de Mantenimiento",
          table: {
            head: [["Vehículo", "Tarea", "Tipo activación", "Intervalo", "Estado", "Próximo vencimiento", "Horas actuales", "Último mantenimiento"]],
            body: tasks.map((t) => [
              t.vehicle_name ?? vehicleMap[t.vehicle_id] ?? "—",
              t.name,
              triggerLabelEs(t.trigger_type),
              t.interval_value != null
                ? `${t.interval_value} ${t.trigger_type === "km" ? "km" : t.trigger_type === "hours" ? "h" : "días"}`
                : "—",
              statusLabel(t.status),
              formatNextDue(t) || (t.trigger_type === "hours" && t.next_due_hours != null ? `${t.next_due_hours} h` : "—"),
              t.current_hours != null ? t.current_hours.toFixed(1) : "—",
              t.last_maintenance_at
                ? new Date(t.last_maintenance_at).toLocaleDateString("es-ES")
                : "—",
            ]),
          },
        },
      ],
      `informe-mantenimiento-${now.replace(/[/:, ]/g, "-")}.pdf`
    );
  }

  return (
    <div className="px-6 py-6 max-w-none w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white">Mantenimiento</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Seguimiento de tareas de mantenimiento preventivo de la flota
          </p>
        </div>
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
          <button onClick={openCreate}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style={{ background: "var(--accent)" }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Nueva tarea
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryCard label="Vencidas" count={overdue} color="#f87171" bg="rgba(239,68,68,0.1)" />
        <SummaryCard label="Próximas" count={warning} color="#fb923c" bg="rgba(251,146,60,0.1)" />
        <SummaryCard label="Al día"   count={ok}      color="var(--success)" bg="rgba(34,197,94,0.1)" />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap mb-4">
        <select
          value={filterVehicle}
          onChange={e => setFilterVehicle(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">Todos los vehículos</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">Todos los estados</option>
          <option value="overdue">Vencidas</option>
          <option value="warning">Próximas</option>
          <option value="ok">Al día</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs px-3 py-2 rounded-lg mb-4"
             style={{ background: "#450a0a", color: "#fca5a5" }}>{error}</div>
      )}

      {/* Tasks table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Vehículo", "Tarea", "Tipo", "Progreso / Vencimiento", "Estado", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold"
                      style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, i) => (
                <tr key={task.id}
                    style={{
                      background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                      borderBottom: "1px solid var(--border)",
                    }}>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {task.vehicle_name ?? vehicleMap[task.vehicle_id] ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-sm">{task.name}</div>
                    {task.description && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                        {task.description}
                      </div>
                    )}
                    {task.trigger_type === "hours" && task.pto_io_key && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                        Señal: {ioKeyLabel(task.pto_io_key)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {triggerLabel(task.trigger_type)}
                    {task.interval_value != null && (
                      <span className="ml-1">
                        (c/ {task.interval_value}
                        {task.trigger_type === "km" ? " km" : task.trigger_type === "hours" ? " h" : " días"})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {task.trigger_type === "hours" ? (
                      <HoursProgress task={task} />
                    ) : (
                      <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                        {formatNextDue(task)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openComplete(task)}
                      className="text-xs px-3 py-1 rounded-lg font-medium text-white"
                      style={{ background: "var(--accent)" }}
                    >
                      Completar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length === 0 && (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">🔧</div>
              <div className="text-sm font-semibold mb-1 text-white">
                No hay tareas de mantenimiento programadas
              </div>
              <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                Crea una tarea para comenzar el seguimiento preventivo de tu flota
              </div>
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Nueva tarea
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Create task modal ── */}
      {showCreate && (
        <Modal title="Nueva tarea de mantenimiento" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <Field label="Vehículo">
              <select
                value={createForm.vehicle_id}
                onChange={e => setCreateForm(f => ({ ...f, vehicle_id: e.target.value }))}
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              >
                <option value="">Selecciona un vehículo</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>

            <Field label="Nombre de la tarea">
              <input
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Cambio aceite hidráulico"
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
            </Field>

            <Field label="Descripción (opcional)">
              <textarea
                value={createForm.description}
                onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Notas adicionales..."
                rows={2}
                className={`${INPUT_CLASS} resize-none`}
                style={INPUT_STYLE}
              />
            </Field>

            <Field label="Tipo de vencimiento">
              <select
                value={createForm.trigger_type}
                onChange={e => setCreateForm(f => ({ ...f, trigger_type: e.target.value }))}
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              >
                <option value="km">Por km</option>
                <option value="hours">Por horas de motor / toma de fuerza</option>
                <option value="days">Por días</option>
                <option value="date">Fecha fija</option>
              </select>
            </Field>

            {/* Hours-specific fields */}
            {createForm.trigger_type === "hours" && (
              <>
                <Field
                  label="Señal de la toma de fuerza (PTO)"
                  hint={
                    loadingSignals
                      ? "Cargando señales del dispositivo..."
                      : liveSignals && liveSignals.length > 0
                        ? `${liveSignals.length} señales digitales detectadas`
                        : "Escribe el nombre de la señal manualmente"
                  }
                >
                  {liveSignals && liveSignals.length > 0 ? (
                    <select
                      value={createForm.pto_io_key}
                      onChange={e => setCreateForm(f => ({ ...f, pto_io_key: e.target.value }))}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    >
                      {liveSignals.filter(s => s.is_configured).length > 0 && (
                        <optgroup label="Señales configuradas">
                          {liveSignals.filter(s => s.is_configured).map(s => (
                            <option key={s.io_key} value={s.io_key}>
                              {s.display_name}
                              {s.raw_value !== null ? ` (activa: ${s.raw_value === 1 ? "SÍ" : "NO"})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {liveSignals.filter(s => !s.is_configured).length > 0 && (
                        <optgroup label="Señales sin configurar">
                          {liveSignals.filter(s => !s.is_configured).map(s => (
                            <option key={s.io_key} value={s.io_key}>
                              IO {s.io_key}
                              {s.raw_value !== null ? ` (${s.raw_value === 1 ? "SÍ" : "NO"})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  ) : (
                    <>
                      <input
                        list="io-key-suggestions"
                        value={createForm.pto_io_key}
                        onChange={e => setCreateForm(f => ({ ...f, pto_io_key: e.target.value }))}
                        placeholder="Ej: dout1, ignition, din2..."
                        className={INPUT_CLASS}
                        style={INPUT_STYLE}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <datalist id="io-key-suggestions">
                        {ioKeys.map(k => (
                          <option key={k.key} value={k.key}>{k.label}</option>
                        ))}
                      </datalist>
                    </>
                  )}
                </Field>

                <Field label="Umbral de horas (p.ej. 1000h)">
                  <input
                    type="number"
                    value={createForm.next_due_hours}
                    onChange={e => setCreateForm(f => ({ ...f, next_due_hours: e.target.value }))}
                    placeholder="1000"
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                </Field>

                <Field
                  label="Límite por fecha (opcional)"
                  hint="Vence también en esta fecha, lo que ocurra primero. Si se deja en blanco, se aplica 1 año automáticamente."
                >
                  <input
                    type="date"
                    value={createForm.next_due_date_fallback}
                    onChange={e => setCreateForm(f => ({ ...f, next_due_date_fallback: e.target.value }))}
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                </Field>
              </>
            )}

            <Field label={`Intervalo (${createForm.trigger_type === "km" ? "km" : createForm.trigger_type === "hours" ? "horas" : "días"})`}>
              <input
                type="number"
                value={createForm.interval_value}
                onChange={e => setCreateForm(f => ({ ...f, interval_value: e.target.value }))}
                placeholder={createForm.trigger_type === "km" ? "500" : createForm.trigger_type === "hours" ? "1000" : "90"}
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
            </Field>

            {createForm.trigger_type === "km" && (
              <Field label="Próximo vencimiento (km)">
                <input
                  type="number"
                  value={createForm.next_due_km}
                  onChange={e => setCreateForm(f => ({ ...f, next_due_km: e.target.value }))}
                  placeholder="Ej: 15000"
                  className={INPUT_CLASS}
                  style={INPUT_STYLE}
                />
              </Field>
            )}

            {(createForm.trigger_type === "days" || createForm.trigger_type === "date") && (
              <Field label="Fecha de vencimiento">
                <input
                  type="date"
                  value={createForm.next_due_date}
                  onChange={e => setCreateForm(f => ({ ...f, next_due_date: e.target.value }))}
                  className={INPUT_CLASS}
                  style={INPUT_STYLE}
                />
              </Field>
            )}

            <Field label={`Avisar con antelación (${createForm.trigger_type === "km" ? "km" : createForm.trigger_type === "hours" ? "h" : "días"})`}>
              <input
                type="number"
                value={createForm.warn_before}
                onChange={e => setCreateForm(f => ({ ...f, warn_before: e.target.value }))}
                placeholder="50"
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
            </Field>

            {createError && (
              <div className="text-xs px-3 py-2 rounded-lg"
                   style={{ background: "#450a0a", color: "#fca5a5" }}>{createError}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowCreate(false)}
                      className="flex-1 py-2.5 rounded-lg text-sm"
                      style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                Cancelar
              </button>
              <button onClick={handleCreate}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                      style={{ background: "var(--accent)" }}>
                Crear tarea
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Complete task modal ── */}
      {completing && (
        <Modal title={`Completar: ${completing.name}`} onClose={() => setCompleting(null)}>
          <div className="space-y-4">
            <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "var(--sidebar)", color: "var(--muted)" }}>
              <span className="font-medium text-white">
                {completing.vehicle_name ?? vehicleMap[completing.vehicle_id] ?? "Vehículo"}
              </span>
              {" · "}
              {triggerLabel(completing.trigger_type)}
              {completing.trigger_type === "hours" && completing.current_hours != null && (
                <span> · <span className="text-white font-mono">{completing.current_hours.toFixed(1)}h</span> acumuladas</span>
              )}
              {completing.trigger_type !== "hours" && (
                <>{" · "}Vence: {formatNextDue(completing)}</>
              )}
            </div>

            {completing.trigger_type === "hours" && (
              <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(29,158,117,0.1)", color: "#34d399" }}>
                Al marcar como completado, el contador de horas se reiniciará desde este momento.
              </div>
            )}

            <Field label="Lectura odómetro (km, opcional)"
                   hint="Si no se indica, se usa el odómetro del GPS.">
              <input
                type="number"
                step="0.1"
                value={completeForm.odometer_km}
                onChange={e => setCompleteForm(f => ({ ...f, odometer_km: e.target.value }))}
                placeholder="Lectura actual del odómetro"
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
            </Field>

            <Field label="Notas (opcional)">
              <textarea
                value={completeForm.notes}
                onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Ej: Aceite Castrol 15W-40, filtro original..."
                rows={3}
                className={`${INPUT_CLASS} resize-none`}
                style={INPUT_STYLE}
              />
            </Field>

            {completeError && (
              <div className="text-xs px-3 py-2 rounded-lg"
                   style={{ background: "#450a0a", color: "#fca5a5" }}>{completeError}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setCompleting(null)}
                      className="flex-1 py-2.5 rounded-lg text-sm"
                      style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                Cancelar
              </button>
              <button onClick={handleComplete}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                      style={{ background: "var(--success)" }}>
                Marcar completado
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SummaryCard({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-4"
         style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
           style={{ background: bg }}>
        <span className="text-lg font-bold" style={{ color }}>{count}</span>
      </div>
      <div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
        <div className="text-sm font-semibold" style={{ color }}>
          {count === 1 ? "1 tarea" : `${count} tareas`}
        </div>
      </div>
    </div>
  );
}
