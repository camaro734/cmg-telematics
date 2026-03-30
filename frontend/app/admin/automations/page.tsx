"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  automations, variableMaps, getVehicles, admin,
  type AutomationRuleOut,
  type AutomationSessionOut,
  type AutomationAction,
  type AutomationActionType,
  type TenantOut,
  type Vehicle,
} from "@/lib/api";
import { exportExcel, exportPdf, exportSessionPdf } from "@/lib/export";

// ─── Standard Teltonika IO keys ───────────────────────────────────────────────
const STANDARD_IO = [
  { key: "ignition",       label: "Ignición (IO 239)",        group: "Estado vehículo" },
  { key: "din1",           label: "Entrada digital 1 (DIN1)", group: "Estado vehículo" },
  { key: "din2",           label: "Entrada digital 2 (DIN2)", group: "Estado vehículo" },
  { key: "din3",           label: "Entrada digital 3 (DIN3)", group: "Estado vehículo" },
  { key: "din4",           label: "Entrada digital 4 (DIN4)", group: "Estado vehículo" },
  { key: "dout1",          label: "Salida digital 1 (DOUT1)", group: "Estado vehículo" },
  { key: "dout2",          label: "Salida digital 2 (DOUT2)", group: "Estado vehículo" },
  { key: "dout3",          label: "Salida digital 3 (DOUT3)", group: "Estado vehículo" },
  { key: "dout4",          label: "Salida digital 4 (DOUT4)", group: "Estado vehículo" },
  { key: "speed",          label: "Velocidad (km/h)",         group: "GPS" },
  { key: "ain1_mv",        label: "Analógica 1 (mV)",         group: "Analógicas" },
  { key: "ain2_mv",        label: "Analógica 2 (mV)",         group: "Analógicas" },
  { key: "ain3_mv",        label: "Analógica 3 (mV)",         group: "Analógicas" },
  { key: "ext_voltage_mv", label: "Tensión externa (mV)",     group: "Alimentación" },
  { key: "battery_mv",     label: "Batería interna (mV)",     group: "Alimentación" },
];
const BOOLEAN_KEYS = new Set(["ignition","din1","din2","din3","din4","dout1","dout2","dout3","dout4"]);

const CONDITION_LABELS: Record<string, string> = {
  gt: "> Mayor que", lt: "< Menor que",
  gte: "≥ Mayor o igual", lte: "≤ Menor o igual",
  eq: "= Igual a", neq: "≠ Distinto de",
};
const TYPE_LABELS: Record<string, string> = { cmg: "CMG", manufacturer: "Fabricante", end_client: "Cliente final" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}
function durStr(start: string, end: string | null) {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
           style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
             style={{ borderColor: "var(--border)" }}>
          <h2 className="font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Variable option type ─────────────────────────────────────────────────────
interface VarOption { key: string; label: string; group: string; unit?: string }

// ─── Rule form ────────────────────────────────────────────────────────────────
interface FormState {
  tenant_id: string;
  vehicle_id: string;        // "" = all vehicles of tenant
  name: string;
  description: string;
  io_key: string;            // "" or "__custom__" or real key
  io_key_custom: string;
  condition: string;
  threshold: string;
  scale_factor: string;
  offset: string;
  action_type: string;
  action_label: string;
  action_color: string;
}

function RuleForm({
  initial, tenants, allVehicles, actionTypes, varOptionsByTenant, onSave, onCancel, saving,
}: {
  initial?: Partial<FormState>;
  tenants: TenantOut[];
  allVehicles: Vehicle[];
  actionTypes: AutomationActionType[];
  varOptionsByTenant: Record<string, VarOption[]>;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    tenant_id: tenants[0]?.id ?? "",
    vehicle_id: "",
    name: "", description: "",
    io_key: "", io_key_custom: "",
    condition: "eq", threshold: "1",
    scale_factor: "1", offset: "0",
    action_type: "track_position",
    action_label: "", action_color: "#3b82f6",
    ...initial,
  });

  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  // Vehicles filtered by selected tenant
  const tenantVehicles = allVehicles.filter(v => v.tenant_id === form.tenant_id);

  // Variable options: standard + configured for this tenant
  const varOptions: VarOption[] = [
    ...STANDARD_IO,
    ...(varOptionsByTenant[form.tenant_id] ?? []),
  ];
  const groups: Record<string, VarOption[]> = {};
  for (const o of varOptions) {
    if (!groups[o.group]) groups[o.group] = [];
    groups[o.group].push(o);
  }

  const isCustom = form.io_key === "__custom__";
  const effectiveKey = isCustom ? form.io_key_custom : form.io_key;
  const selectedOption = varOptions.find(o => o.key === effectiveKey);

  const inputCls = "w-full px-3 py-2 rounded-lg text-sm text-white outline-none";
  const inputSt = { background: "var(--background)", border: "1px solid var(--border)" };
  const lblCls = "block text-xs font-medium mb-1";
  const lblSt = { color: "var(--muted)" };

  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ ...form, io_key: effectiveKey }); }} className="space-y-4">

      {/* ── Cliente destino ── */}
      <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(29,158,117,0.06)", border: "1px solid rgba(29,158,117,0.2)" }}>
        <p className="text-xs font-semibold" style={{ color: "var(--accent)" }}>¿Para qué cliente es esta regla?</p>
        <div>
          <label className={lblCls} style={lblSt}>Cliente (tenant) *</label>
          <select required value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value, vehicle_id: "" }))}
            className={inputCls} style={inputSt}>
            <option value="">— Selecciona cliente —</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({TYPE_LABELS[t.type] ?? t.type})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={lblCls} style={lblSt}>Vehículo concreto (opcional)</label>
          <select value={form.vehicle_id} onChange={set("vehicle_id")} className={inputCls} style={inputSt}>
            <option value="">Todos los vehículos del cliente</option>
            {tenantVehicles.map(v => (
              <option key={v.id} value={v.id}>{v.name}{v.license_plate ? ` — ${v.license_plate}` : ""}</option>
            ))}
          </select>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {tenantVehicles.length === 0
              ? "Este cliente no tiene vehículos asignados todavía"
              : `${tenantVehicles.length} vehículo(s) disponible(s)`}
          </p>
        </div>
      </div>

      {/* ── Nombre ── */}
      <div>
        <label className={lblCls} style={lblSt}>Nombre de la regla *</label>
        <input required value={form.name} onChange={set("name")} className={inputCls} style={inputSt}
          placeholder="Ej: Rastrear cuando bomba hidráulica activa" />
      </div>

      <hr style={{ borderColor: "var(--border)" }} />
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Condición de disparo</p>

      {/* Variable selector */}
      <div>
        <label className={lblCls} style={lblSt}>Variable *</label>
        <select value={form.io_key} onChange={set("io_key")} className={inputCls} style={inputSt}>
          <option value="">— Selecciona una variable —</option>
          {Object.entries(groups).map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map(o => (
                <option key={o.key} value={o.key}>
                  {o.label}{o.unit ? ` [${o.unit}]` : ""}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Personalizado">
            <option value="__custom__">✏ Introducir manualmente...</option>
          </optgroup>
        </select>
        {selectedOption && (
          <p className="text-xs mt-1 px-1" style={{ color: "var(--accent)" }}>
            {selectedOption.label}{selectedOption.unit ? ` — unidad: ${selectedOption.unit}` : ""}
          </p>
        )}
      </div>

      {isCustom && (
        <div>
          <label className={lblCls} style={lblSt}>ID de variable *</label>
          <input required value={form.io_key_custom} onChange={set("io_key_custom")}
            className={inputCls} style={inputSt} placeholder="Ej: io_300, ain1_mv, din1" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lblCls} style={lblSt}>Condición *</label>
          <select required value={form.condition} onChange={set("condition")} className={inputCls} style={inputSt}>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={lblCls} style={lblSt}>
            Valor{selectedOption?.unit ? ` (${selectedOption.unit})` : ""} *
          </label>
          <input required type="number" step="any" value={form.threshold} onChange={set("threshold")}
            className={inputCls} style={inputSt} />
        </div>
      </div>

      {!BOOLEAN_KEYS.has(effectiveKey) && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lblCls} style={lblSt}>Factor escala</label>
            <input type="number" step="any" value={form.scale_factor} onChange={set("scale_factor")}
              className={inputCls} style={inputSt} />
          </div>
          <div>
            <label className={lblCls} style={lblSt}>Offset</label>
            <input type="number" step="any" value={form.offset} onChange={set("offset")}
              className={inputCls} style={inputSt} />
          </div>
        </div>
      )}

      <hr style={{ borderColor: "var(--border)" }} />
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Acción automática</p>

      <div>
        <label className={lblCls} style={lblSt}>¿Qué hacer cuando se activa? *</label>
        <select required value={form.action_type} onChange={set("action_type")} className={inputCls} style={inputSt}>
          {actionTypes.map(a => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>
        {actionTypes.find(a => a.type === form.action_type) && (
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {actionTypes.find(a => a.type === form.action_type)!.description}
          </p>
        )}
      </div>

      {form.action_type === "track_position" && (
        <div className="rounded-xl p-3 space-y-3" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
          <p className="text-xs font-medium text-white">Configuración del rastreo</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lblCls} style={lblSt}>Etiqueta de sesión</label>
              <input value={form.action_label} onChange={set("action_label")}
                className={inputCls} style={inputSt} placeholder={form.name || "Ej: Bomba activa"} />
            </div>
            <div>
              <label className={lblCls} style={lblSt}>Color en mapa</label>
              <input type="color" value={form.action_color} onChange={set("action_color")}
                className="w-full h-9 rounded-lg cursor-pointer"
                style={{ background: "var(--background)", border: "1px solid var(--border)", padding: 2 }} />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--muted)" }}>
          Cancelar
        </button>
        <button type="submit" disabled={saving || !form.tenant_id || !effectiveKey}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: "var(--accent)", opacity: saving || !form.tenant_id || !effectiveKey ? 0.6 : 1 }}>
          {saving ? "Guardando..." : "Guardar regla"}
        </button>
      </div>
    </form>
  );
}

// ─── Sessions panel ───────────────────────────────────────────────────────────
function SessionsPanel({ rule, onClose }: { rule: AutomationRuleOut; onClose: () => void }) {
  const [sessions, setSessions] = useState<AutomationSessionOut[] | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  useEffect(() => {
    automations.listSessions(rule.id).then(setSessions).catch(() => setSessions([]));
  }, [rule.id]);

  async function handlePdfSession(s: AutomationSessionOut) {
    if (pdfLoadingId) return;
    setPdfLoadingId(s.id);
    try {
      const positions = await automations.getSessionPositions(s.id);
      await exportSessionPdf({
        vehicleName: rule.vehicle_name ?? "Vehículo",
        ruleName: rule.name,
        ioKey: rule.io_key,
        condition: rule.condition,
        threshold: rule.threshold,
        session: {
          id: s.id,
          label: s.label,
          color: s.color,
          started_at: s.started_at,
          ended_at: s.ended_at,
          position_count: s.position_count,
        },
        positions: positions.map(p => ({ time: p.time, lat: p.lat, lng: p.lng, speed: p.speed })),
      });
    } catch { alert("Error generando el PDF de la sesión"); }
    finally { setPdfLoadingId(null); }
  }

  function durMinutes(start: string, end: string | null): number {
    const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
    return Math.floor(ms / 60000);
  }

  function handleExcelSessions() {
    if (!sessions || sessions.length === 0) return;
    const rows = sessions.map((s, i) => ({
      "Sesión": i + 1,
      "Inicio": fmtDate(s.started_at),
      "Fin": s.ended_at ? fmtDate(s.ended_at) : "En curso",
      "Duración (min)": durMinutes(s.started_at, s.ended_at),
      "Posiciones": s.position_count,
    }));
    exportExcel(
      [{ name: "Sesiones", rows }],
      `sesiones_${rule.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  async function handlePdfSessions() {
    if (!sessions || sessions.length === 0) return;
    const totalMin = sessions.reduce((acc, s) => acc + durMinutes(s.started_at, s.ended_at), 0);
    const totalPos = sessions.reduce((acc, s) => acc + s.position_count, 0);
    const condLabel = CONDITION_LABELS[rule.condition] ?? rule.condition;
    await exportPdf(
      `Informe de Automatización: ${rule.name}`,
      `Regla: ${rule.io_key} ${condLabel} ${rule.threshold} | Acción: track_position`,
      [
        {
          title: "Resumen de Sesiones",
          text: `Total sesiones: ${sessions.length} | Tiempo total activa: ${totalMin} min | Total posiciones: ${totalPos}`,
        },
        {
          title: "Historial de Sesiones",
          table: {
            head: [["Nº", "Inicio", "Fin", "Duración", "Posiciones"]],
            body: sessions.map((s, i) => [
              i + 1,
              fmtDate(s.started_at),
              s.ended_at ? fmtDate(s.ended_at) : "En curso",
              durStr(s.started_at, s.ended_at),
              s.position_count,
            ]),
          },
        },
      ],
      `informe_${rule.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  return (
    <Modal title={`Sesiones — ${rule.name}`} onClose={onClose}>
      {!sessions && <p className="text-sm py-4 text-center" style={{ color: "var(--muted)" }}>Cargando...</p>}
      {sessions?.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>
          Aún no hay sesiones para esta regla.
        </p>
      )}
      {sessions && sessions.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs flex-1" style={{ color: "var(--muted)" }}>
              {sessions.length} sesión(es) registrada(s)
            </span>
            <button
              onClick={handleExcelSessions}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ background: "rgba(34,197,94,0.1)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.2)" }}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Excel
            </button>
            <button
              onClick={handlePdfSessions}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M14 2v6h6M9 13h1a2 2 0 010 4H9v-4zM15 13v4M15 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              PDF
            </button>
          </div>
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="rounded-xl p-3" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color ?? "#3b82f6" }} />
                  <span className="text-sm font-medium text-white">{s.label ?? rule.name}</span>
                  {!s.ended_at && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: "rgba(34,197,94,0.15)", color: "var(--success)" }}>Activa</span>
                  )}
                  {s.position_count > 0 && (
                    <button
                      onClick={() => handlePdfSession(s)}
                      disabled={pdfLoadingId === s.id}
                      className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)", opacity: pdfLoadingId === s.id ? 0.5 : 1 }}
                      title="Descargar PDF con mapa de esta sesión"
                    >
                      <svg width="11" height="11" fill="none" viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        <path d="M14 2v6h6M9 13h1a2 2 0 010 4H9v-4zM15 13v4M15 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {pdfLoadingId === s.id ? "..." : "PDF"}
                    </button>
                  )}
                </div>
                <div className="text-xs space-y-0.5" style={{ color: "var(--muted)" }}>
                  <div>Inicio: {fmtDate(s.started_at)}</div>
                  {s.ended_at && <div>Fin: {fmtDate(s.ended_at)}</div>}
                  <div>Duración: {durStr(s.started_at, s.ended_at)} · {s.position_count} posiciones</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AutomationsPage() {
  const router = useRouter();
  const [rules, setRules] = useState<AutomationRuleOut[]>([]);
  const [actionTypes, setActionTypes] = useState<AutomationActionType[]>([]);
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([]);
  const [varOptionsByTenant, setVarOptionsByTenant] = useState<Record<string, { key: string; label: string; group: string; unit?: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AutomationRuleOut | null>(null);
  const [viewingSessions, setViewingSessions] = useState<AutomationRuleOut | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AutomationRuleOut | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      if (!raw || JSON.parse(raw).role !== "superadmin") {
        router.replace("/dashboard"); return;
      }
    } catch { router.replace("/dashboard"); return; }

    Promise.all([
      automations.list(),
      automations.listActionTypes(),
      admin.listTenants(),
      getVehicles(),
    ]).then(async ([r, at, ts, vehicles]) => {
      setRules(r);
      setActionTypes(at);
      setTenants(ts);
      setAllVehicles(vehicles);

      // Load variable maps for each tenant (using first vehicle per tenant as proxy)
      const byTenant: Record<string, { key: string; label: string; group: string; unit?: string }[]> = {};
      const vehicleByTenant: Record<string, string> = {};
      for (const v of vehicles) {
        if (!vehicleByTenant[v.tenant_id]) vehicleByTenant[v.tenant_id] = v.id;
      }
      await Promise.all(Object.entries(vehicleByTenant).map(async ([tid, vid]) => {
        try {
          const maps = await variableMaps.listResolved(vid);
          const stdKeys = new Set(STANDARD_IO.map(o => o.key));
          byTenant[tid] = maps
            .filter(m => !stdKeys.has(m.io_key))
            .map(m => ({ key: m.io_key, label: m.display_name, group: "Variables configuradas", unit: m.unit || undefined }));
        } catch { /* no maps */ }
      }));
      setVarOptionsByTenant(byTenant);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [router]);

  // Helper: tenant name for a rule
  const tenantName = (tid: string) => tenants.find(t => t.id === tid)?.name ?? "—";

  function ruleToForm(r: AutomationRuleOut): Partial<FormState> {
    const trackAction = r.actions.find(a => a.type === "track_position");
    const stdOrConfigured = [...STANDARD_IO, ...(varOptionsByTenant[r.tenant_id] ?? [])];
    const isKnown = stdOrConfigured.some(o => o.key === r.io_key);
    return {
      tenant_id: r.tenant_id,
      vehicle_id: r.vehicle_id ?? "",
      name: r.name, description: r.description ?? "",
      io_key: isKnown ? r.io_key : "__custom__",
      io_key_custom: isKnown ? "" : r.io_key,
      condition: r.condition, threshold: String(r.threshold),
      scale_factor: String(r.scale_factor), offset: String(r.offset),
      action_type: r.actions[0]?.type ?? "track_position",
      action_label: (trackAction?.params?.label as string) ?? "",
      action_color: (trackAction?.params?.color as string) ?? "#3b82f6",
    };
  }

  function buildActions(form: FormState): AutomationAction[] {
    if (form.action_type === "track_position") {
      return [{ type: "track_position", params: { label: form.action_label || form.name, color: form.action_color } }];
    }
    return [{ type: form.action_type, params: {} }];
  }

  async function handleCreate(form: FormState) {
    setSaving(true);
    try {
      const r = await automations.create({
        tenant_id: form.tenant_id,
        vehicle_id: form.vehicle_id || null,
        name: form.name,
        description: form.description || undefined,
        io_key: form.io_key,
        condition: form.condition,
        threshold: parseFloat(form.threshold),
        scale_factor: parseFloat(form.scale_factor),
        offset: parseFloat(form.offset),
        actions: buildActions(form),
      });
      setRules(prev => [r, ...prev]);
      setShowCreate(false);
    } catch { alert("Error creando la regla"); }
    finally { setSaving(false); }
  }

  async function handleUpdate(form: FormState) {
    if (!editing) return;
    setSaving(true);
    try {
      const hadVehicle = !!editing.vehicle_id;
      const r = await automations.update(editing.id, {
        tenant_id: form.tenant_id,
        // If was vehicle-specific and now cleared → send clear_vehicle flag
        clear_vehicle: hadVehicle && !form.vehicle_id,
        vehicle_id: form.vehicle_id || undefined,
        name: form.name,
        description: form.description || undefined,
        io_key: form.io_key,
        condition: form.condition,
        threshold: parseFloat(form.threshold),
        scale_factor: parseFloat(form.scale_factor),
        offset: parseFloat(form.offset),
        actions: buildActions(form),
      });
      setRules(prev => prev.map(x => x.id === r.id ? r : x));
      setEditing(null);
    } catch { alert("Error actualizando la regla"); }
    finally { setSaving(false); }
  }

  async function handleDelete(rule: AutomationRuleOut) {
    try {
      await automations.delete(rule.id);
      setRules(prev => prev.filter(r => r.id !== rule.id));
    } catch { alert("Error eliminando la regla"); }
    finally { setConfirmDelete(null); }
  }

  async function handleToggle(rule: AutomationRuleOut) {
    try {
      const r = await automations.update(rule.id, { active: !rule.active });
      setRules(prev => prev.map(x => x.id === r.id ? r : x));
    } catch { alert("Error actualizando la regla"); }
  }

  function handleExportRulesExcel() {
    const rows = rules.map(rule => ({
      "Nombre": rule.name,
      "Cliente": tenantName(rule.tenant_id),
      "Vehículo": rule.vehicle_name ?? "(todos los vehículos)",
      "Variable (io_key)": rule.io_key,
      "Condición": CONDITION_LABELS[rule.condition] ?? rule.condition,
      "Umbral": rule.threshold,
      "Acciones": rule.actions.map(a => a.type).join(", "),
      "Activa": rule.active ? "Sí" : "No",
      "Creada": fmtDate(rule.created_at),
    }));
    exportExcel(
      [{ name: "Reglas", rows }],
      `automatizaciones_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-none w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Automatizaciones</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
            Reglas por cliente — acciones automáticas cuando una variable se activa
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rules.length > 0 && (
            <button
              onClick={handleExportRulesExcel}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: "rgba(34,197,94,0.1)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.2)" }}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Exportar Excel
            </button>
          )}
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: "var(--accent)" }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Nueva regla
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-16" style={{ color: "var(--muted)" }}>Cargando...</div>}

      {!loading && rules.length === 0 && (
        <div className="rounded-2xl p-12 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" className="mx-auto mb-4" style={{ color: "var(--muted)" }}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-white font-medium mb-1">No hay reglas de automatización</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Crea la primera regla para un cliente</p>
        </div>
      )}

      {!loading && rules.length > 0 && (
        <div className="space-y-3">
          {rules.map(rule => {
            const trackAction = rule.actions.find(a => a.type === "track_position");
            const color = (trackAction?.params?.color as string) ?? "#3b82f6";
            const varLabel = [...STANDARD_IO, ...(varOptionsByTenant[rule.tenant_id] ?? [])].find(o => o.key === rule.io_key)?.label ?? rule.io_key;
            const actionLabel = actionTypes.find(a => a.type === rule.actions[0]?.type)?.label ?? rule.actions[0]?.type;

            return (
              <div key={rule.id} className="rounded-2xl p-4"
                   style={{ background: "var(--card)", border: "1px solid var(--border)", opacity: rule.active ? 1 : 0.55 }}>
                <div className="flex items-start gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0 mt-1" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{rule.name}</span>
                      {!rule.active && (
                        <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(100,116,139,0.2)", color: "var(--muted)" }}>Inactiva</span>
                      )}
                    </div>

                    {/* Client badge */}
                    <div className="flex items-center gap-1.5 mt-1">
                      <svg width="11" height="11" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)" }}>
                        <path d="M3 21h18M9 8h1m-1 4h1m-1 4h1m4-8h1m-1 4h1m-1 4h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"
                              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      </svg>
                      <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                        {tenantName(rule.tenant_id)}
                        {rule.vehicle_name && ` → ${rule.vehicle_name}`}
                        {!rule.vehicle_id && " (todos los vehículos)"}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-xs px-2 py-1 rounded-lg font-mono"
                            style={{ background: "rgba(59,130,246,0.12)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.2)" }}>
                        {varLabel} {CONDITION_LABELS[rule.condition] ?? rule.condition} {rule.threshold}
                      </span>
                      <span className="text-xs px-2 py-1 rounded-lg"
                            style={{ background: "rgba(29,158,117,0.12)", color: "var(--accent)", border: "1px solid rgba(29,158,117,0.2)" }}>
                        → {actionLabel}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleToggle(rule)} title={rule.active ? "Desactivar" : "Activar"}
                      className="p-2 rounded-lg" style={{ color: rule.active ? "var(--success)" : "var(--muted)" }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                        <path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button onClick={() => setViewingSessions(rule)} title="Ver sesiones"
                      className="p-2 rounded-lg" style={{ color: "var(--muted)" }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </button>
                    <button onClick={() => setEditing(rule)} title="Editar"
                      className="p-2 rounded-lg" style={{ color: "var(--muted)" }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button onClick={() => setConfirmDelete(rule)} title="Eliminar"
                      className="p-2 rounded-lg" style={{ color: "var(--danger)" }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <Modal title="Nueva regla de automatización" onClose={() => setShowCreate(false)}>
          <RuleForm tenants={tenants} allVehicles={allVehicles} actionTypes={actionTypes}
            varOptionsByTenant={varOptionsByTenant}
            onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={saving} />
        </Modal>
      )}

      {editing && (
        <Modal title="Editar regla" onClose={() => setEditing(null)}>
          <RuleForm initial={ruleToForm(editing)} tenants={tenants} allVehicles={allVehicles}
            actionTypes={actionTypes} varOptionsByTenant={varOptionsByTenant}
            onSave={handleUpdate} onCancel={() => setEditing(null)} saving={saving} />
        </Modal>
      )}

      {viewingSessions && (
        <SessionsPanel rule={viewingSessions} onClose={() => setViewingSessions(null)} />
      )}

      {confirmDelete && (
        <Modal title="Eliminar regla" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
            ¿Eliminar <strong className="text-white">{confirmDelete.name}</strong>? Se perderán todas las sesiones registradas.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--muted)" }}>
              Cancelar
            </button>
            <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: "var(--danger)" }}>
              Eliminar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
