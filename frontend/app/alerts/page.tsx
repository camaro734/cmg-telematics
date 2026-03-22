"use client";

import { useEffect, useState, useCallback } from "react";
import {
  alerts as alertsApi,
  alertRules,
  maintenance,
  getVehicles,
  type AlertLogOut,
  type AlertRuleOut,
  type IoKeyOption,
  type ConditionOption,
  type Vehicle,
} from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage } from "@/lib/websocket";
import Toast from "@/components/Toast";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function LevelBadge({ level }: { level: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    high:   { label: "ALTA",   bg: "rgba(239,68,68,0.15)",   color: "#ef4444" },
    medium: { label: "MEDIA",  bg: "rgba(251,146,60,0.15)",  color: "#fb923c" },
    low:    { label: "BAJA",   bg: "rgba(245,158,11,0.15)",  color: "#f59e0b" },
  };
  const c = cfg[level] ?? cfg.low;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

function StatusBadge({ alert }: { alert: AlertLogOut }) {
  if (alert.resolved_at)
    return <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(100,116,139,0.15)", color: "var(--muted)" }}>Resuelta</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.15)", color: "var(--success)" }}>Activa</span>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{hint}</p>}
    </div>
  );
}

const INPUT_CLASS = "w-full px-3 py-2.5 rounded-lg text-sm text-white";
const INPUT_STYLE = { background: "var(--sidebar)", border: "1px solid var(--border)" };

// ─── Rule row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  conditionLabel,
  onDelete,
  canManage,
}: {
  rule: AlertRuleOut;
  conditionLabel: (k: string) => string;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td className="px-4 py-3">
        <div className="font-medium text-white text-sm">{rule.name}</div>
        {rule.description && <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{rule.description}</div>}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
        {rule.vehicle_name ?? <span className="italic">Toda la flota</span>}
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-white font-medium">{rule.display_name}</div>
        <div className="text-xs font-mono mt-0.5" style={{ color: "var(--muted)" }}>{rule.io_key}</div>
      </td>
      <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--muted)" }}>
        {conditionLabel(rule.condition)} {rule.threshold}{rule.unit ? ` ${rule.unit}` : ""}
        {(rule.scale_factor !== 1.0 || rule.offset !== 0.0) && (
          <div className="text-xs mt-0.5">×{rule.scale_factor}{rule.offset !== 0 ? ` +${rule.offset}` : ""}</div>
        )}
      </td>
      <td className="px-4 py-3"><LevelBadge level={rule.level} /></td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>{rule.cooldown_minutes} min</td>
      <td className="px-4 py-3">
        {canManage && (
          <button
            onClick={() => onDelete(rule.id)}
            className="text-xs px-3 py-1 rounded font-medium"
            style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            Eliminar
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [tab, setTab] = useState<"history" | "rules">("history");

  // Role check — only admin/superadmin can create/delete rules
  const [canManageRules, setCanManageRules] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      const role = raw ? JSON.parse(raw).role : null;
      setCanManageRules(role === "admin" || role === "superadmin");
    } catch { setCanManageRules(false); }
  }, []);

  // History state
  const [alertList, setAlertList] = useState<AlertLogOut[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  // Rules state
  const [rules, setRules] = useState<AlertRuleOut[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [conditions, setConditions] = useState<ConditionOption[]>([]);
  const [ioKeys, setIoKeys] = useState<IoKeyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    vehicle_id: "",
    name: "",
    description: "",
    io_key: "",
    display_name: "",
    condition: "gt",
    threshold: "",
    scale_factor: "1",
    offset: "0",
    unit: "",
    level: "high",
    cooldown_minutes: "60",
  });

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await alertsApi.list({
        vehicle_id: vehicleFilter || undefined,
        level: levelFilter || undefined,
        active_only: activeOnly || undefined,
        limit: 100,
      });
      setAlertList(data);
    } catch (e) {
      console.error("Error loading alerts", e);
    } finally {
      setLoadingAlerts(false);
    }
  }, [vehicleFilter, levelFilter, activeOnly]);

  const loadRules = useCallback(async () => {
    try {
      const data = await alertRules.list();
      setRules(data);
    } catch (e) {
      console.error("Error loading rules", e);
    } finally {
      setLoadingRules(false);
    }
  }, []);

  useEffect(() => {
    setLoadingAlerts(true);
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  useEffect(() => {
    Promise.all([
      getVehicles(),
      alertRules.listConditions(),
      maintenance.fetchIoKeys(),
    ]).then(([v, c, k]) => {
      setVehicles(v);
      setConditions(c);
      setIoKeys(k);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(loadAlerts, 30_000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  const { toasts, addToast, dismiss } = useToast();
  useFleetWebSocket(
    useCallback((_msg: WsTelemetryMessage) => {}, []),
    useCallback((alert: WsAlertMessage) => {
      addToast({
        level: alert.level as "high" | "low",
        title: `Nueva alerta — ${alert.display_name}`,
        message: `${alert.converted_value.toFixed(1)} ${alert.unit} (umbral: ${alert.threshold} ${alert.unit})`,
      });
      loadAlerts();
    }, [addToast, loadAlerts]),
  );

  async function handleAcknowledge(id: string) {
    setAcknowledging(id);
    try {
      await alertsApi.acknowledge(id);
      await loadAlerts();
    } finally {
      setAcknowledging(null);
    }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("¿Eliminar esta regla de alerta?")) return;
    try {
      await alertRules.delete(id);
      await loadRules();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateRule() {
    setCreateError("");
    // Frontend validation
    const missing: string[] = [];
    if (!createForm.name.trim()) missing.push("Nombre");
    if (!createForm.io_key.trim()) missing.push("Variable del FMC650");
    if (!createForm.display_name.trim()) missing.push("Nombre para mostrar");
    if (createForm.threshold === "" || isNaN(parseFloat(createForm.threshold))) missing.push("Umbral");
    if (missing.length > 0) {
      setCreateError(`Campos obligatorios: ${missing.join(", ")}`);
      return;
    }
    try {
      await alertRules.create({
        vehicle_id: createForm.vehicle_id || null,
        name: createForm.name,
        description: createForm.description || undefined,
        io_key: createForm.io_key,
        display_name: createForm.display_name || createForm.io_key,
        condition: createForm.condition,
        threshold: parseFloat(createForm.threshold),
        scale_factor: parseFloat(createForm.scale_factor) || 1,
        offset: parseFloat(createForm.offset) || 0,
        unit: createForm.unit,
        level: createForm.level,
        cooldown_minutes: parseInt(createForm.cooldown_minutes) || 60,
      });
      setShowCreate(false);
      await loadRules();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Error al crear");
    }
  }

  function openCreate() {
    setCreateForm({
      vehicle_id: "", name: "", description: "",
      io_key: "", display_name: "", condition: "gt",
      threshold: "", scale_factor: "1", offset: "0",
      unit: "", level: "high", cooldown_minutes: "60",
    });
    setCreateError("");
    setShowCreate(true);
  }

  const activeCount = alertList.filter((a) => !a.resolved_at).length;
  const conditionLabel = (k: string) =>
    conditions.find(c => c.key === k)?.label?.split(" ").slice(1).join(" ") ?? k;

  return (
    <div className="px-6 py-6 max-w-6xl">
      <Toast toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-white">Alertas</h1>
            {activeCount > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                    style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
                {activeCount} activa{activeCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Historial de alertas y configuración de reglas por variable IO
          </p>
        </div>
        {tab === "rules" && canManageRules ? (
          <button onClick={openCreate}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style={{ background: "var(--accent)" }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Nueva regla
          </button>
        ) : (
          <button onClick={() => { setLoadingAlerts(true); loadAlerts(); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Actualizar
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 p-1 rounded-lg w-fit" style={{ background: "var(--card)" }}>
        {[
          { key: "history", label: "Historial" },
          { key: "rules",   label: `Reglas (${rules.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "history" | "rules")}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
            style={tab === t.key
              ? { background: "var(--accent)", color: "#fff" }
              : { color: "var(--muted)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm text-white"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <option value="">Todos los vehículos</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm text-white"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <option value="">Todos los niveles</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </select>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer"
                   style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}>
              <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
              Solo activas
            </label>
          </div>

          {loadingAlerts ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />)}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                    {["Fecha", "Vehículo", "Variable", "Nivel", "Valor", "Umbral", "Estado", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {alertList.map((alert, i) => (
                    <tr key={alert.id}
                        style={{
                          background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                          borderBottom: "1px solid var(--border)",
                          opacity: alert.resolved_at ? 0.7 : 1,
                        }}>
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--muted)" }}>
                        {formatDateTime(alert.fired_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        {alert.vehicle_name ?? alert.vehicle_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-white">
                        {alert.display_name}
                        <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>({alert.io_key})</span>
                      </td>
                      <td className="px-4 py-3"><LevelBadge level={alert.level} /></td>
                      <td className="px-4 py-3 font-mono text-white">
                        {alert.converted_value.toFixed(2)}
                        {alert.unit && <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>{alert.unit}</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                        {alert.threshold}{alert.unit && ` ${alert.unit}`}
                      </td>
                      <td className="px-4 py-3"><StatusBadge alert={alert} /></td>
                      <td className="px-4 py-3">
                        {!alert.resolved_at && !alert.acknowledged_at && (
                          <button onClick={() => handleAcknowledge(alert.id)}
                                  disabled={acknowledging === alert.id}
                                  className="text-xs px-3 py-1 rounded font-medium"
                                  style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.3)", opacity: acknowledging === alert.id ? 0.5 : 1 }}>
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
                  <div className="text-sm font-semibold mb-1" style={{ color: "var(--success)" }}>Sin alertas activas</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {activeOnly ? "No hay alertas activas" : "No hay alertas registradas"}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>Actualización automática cada 30 segundos</p>
        </>
      )}

      {/* ── RULES TAB ── */}
      {tab === "rules" && (
        <>
          {loadingRules ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />)}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                    {["Nombre", "Vehículo", "Variable", "Condición", "Nivel", "Cooldown", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <RuleRow key={rule.id} rule={rule} conditionLabel={conditionLabel} onDelete={handleDeleteRule} canManage={canManageRules} />
                  ))}
                </tbody>
              </table>
              {rules.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-3xl mb-3">🔔</div>
                  <div className="text-sm font-semibold mb-1 text-white">Sin reglas de alerta</div>
                  <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                    {canManageRules
                      ? "Crea una regla para recibir alertas cuando una variable cruce un umbral"
                      : "El administrador de tu cuenta puede configurar reglas de alerta"}
                  </div>
                  {canManageRules && (
                    <button onClick={openCreate}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                            style={{ background: "var(--accent)" }}>
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Nueva regla
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Create rule modal ── */}
      {showCreate && (
        <Modal title="Nueva regla de alerta" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">

            <Field label="Nombre de la regla">
              <input value={createForm.name}
                     onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                     placeholder="Ej: Presión hidráulica alta"
                     className={INPUT_CLASS} style={INPUT_STYLE} />
            </Field>

            <Field label="Vehículo (opcional — vacío = toda la flota)">
              <select value={createForm.vehicle_id}
                      onChange={e => setCreateForm(f => ({ ...f, vehicle_id: e.target.value }))}
                      className={INPUT_CLASS} style={INPUT_STYLE}>
                <option value="">Toda la flota (del tenant)</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>

            <Field label="Variable del FMC650 / PLC"
                   hint="Nombre de la columna en telemetría (ain1_mv, dout1, ignition...) o ID numérico del IO (300, 9...)">
              <input list="rule-io-key-suggestions"
                     value={createForm.io_key}
                     onChange={e => setCreateForm(f => ({
                       ...f,
                       io_key: e.target.value,
                       display_name: f.display_name || e.target.value,
                     }))}
                     placeholder="Ej: ain1_mv, dout1, 300..."
                     className={INPUT_CLASS} style={INPUT_STYLE}
                     autoComplete="off" spellCheck={false} />
              <datalist id="rule-io-key-suggestions">
                {ioKeys.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </datalist>
            </Field>

            <Field label="Nombre para mostrar en alertas">
              <input value={createForm.display_name}
                     onChange={e => setCreateForm(f => ({ ...f, display_name: e.target.value }))}
                     placeholder="Ej: Presión hidráulica"
                     className={INPUT_CLASS} style={INPUT_STYLE} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Condición">
                <select value={createForm.condition}
                        onChange={e => setCreateForm(f => ({ ...f, condition: e.target.value }))}
                        className={INPUT_CLASS} style={INPUT_STYLE}>
                  {conditions.length > 0 ? (
                    conditions.map(c => <option key={c.key} value={c.key}>{c.label}</option>)
                  ) : (
                    <>
                      <option value="gt">&gt; Mayor que</option>
                      <option value="lt">&lt; Menor que</option>
                      <option value="gte">≥ Mayor o igual</option>
                      <option value="lte">≤ Menor o igual</option>
                      <option value="eq">= Igual a</option>
                      <option value="neq">≠ Distinto de</option>
                    </>
                  )}
                </select>
              </Field>

              <Field label="Umbral">
                <input type="number" step="any"
                       value={createForm.threshold}
                       onChange={e => setCreateForm(f => ({ ...f, threshold: e.target.value }))}
                       placeholder="Ej: 300"
                       className={INPUT_CLASS} style={INPUT_STYLE} />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Factor escala" hint="valor_real = raw × factor + offset">
                <input type="number" step="any"
                       value={createForm.scale_factor}
                       onChange={e => setCreateForm(f => ({ ...f, scale_factor: e.target.value }))}
                       className={INPUT_CLASS} style={INPUT_STYLE} />
              </Field>
              <Field label="Offset">
                <input type="number" step="any"
                       value={createForm.offset}
                       onChange={e => setCreateForm(f => ({ ...f, offset: e.target.value }))}
                       className={INPUT_CLASS} style={INPUT_STYLE} />
              </Field>
              <Field label="Unidad">
                <input value={createForm.unit}
                       onChange={e => setCreateForm(f => ({ ...f, unit: e.target.value }))}
                       placeholder="bar, V, °C..."
                       className={INPUT_CLASS} style={INPUT_STYLE} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nivel de alerta">
                <select value={createForm.level}
                        onChange={e => setCreateForm(f => ({ ...f, level: e.target.value }))}
                        className={INPUT_CLASS} style={INPUT_STYLE}>
                  <option value="high">Alta (rojo)</option>
                  <option value="medium">Media (naranja)</option>
                  <option value="low">Baja (amarillo)</option>
                </select>
              </Field>
              <Field label="Cooldown (minutos)" hint="Tiempo mínimo entre alertas repetidas">
                <input type="number" min="1"
                       value={createForm.cooldown_minutes}
                       onChange={e => setCreateForm(f => ({ ...f, cooldown_minutes: e.target.value }))}
                       className={INPUT_CLASS} style={INPUT_STYLE} />
              </Field>
            </div>

            <Field label="Descripción (opcional)">
              <textarea value={createForm.description}
                        onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Notas adicionales sobre esta regla..."
                        rows={2}
                        className={`${INPUT_CLASS} resize-none`} style={INPUT_STYLE} />
            </Field>

            {createError && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>{createError}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowCreate(false)}
                      className="flex-1 py-2.5 rounded-lg text-sm"
                      style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                Cancelar
              </button>
              <button onClick={handleCreateRule}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                      style={{ background: "var(--accent)" }}>
                Crear regla
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
