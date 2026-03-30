"use client";

import { useEffect, useState, useCallback } from "react";
import {
  alerts as alertsApi,
  alertRules,
  maintenance,
  getVehicles,
  getLiveSignals,
  notificationConfig,
  admin,
  type AlertLogOut,
  type AlertRuleOut,
  type IoKeyOption,
  type ConditionOption,
  type Vehicle,
  type LiveSignal,
  type NotificationConfig,
  type UserOut,
} from "@/lib/api";
import { useFleetWebSocket, type WsTelemetryMessage, type WsAlertMessage } from "@/lib/websocket";
import Toast from "@/components/Toast";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/toast";
import { exportExcel } from "@/lib/export";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const LEVEL_ES: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const CONDITION_ES: Record<string, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  eq: "=",
  neq: "≠",
};

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

// ─── Notifications tab sub-components ────────────────────────────────────────

const PROVIDERS = [
  { label: "Personalizado", host: "", port: 587, tls: true, ssl: false },
  { label: "Gmail", host: "smtp.gmail.com", port: 587, tls: true, ssl: false },
  { label: "Outlook / Hotmail", host: "smtp-mail.outlook.com", port: 587, tls: true, ssl: false },
  { label: "Yahoo", host: "smtp.mail.yahoo.com", port: 587, tls: true, ssl: false },
];

const PORT_PRESETS = [
  { port: 25, tls: false, ssl: false },
  { port: 465, tls: false, ssl: true },
  { port: 587, tls: true, ssl: false },
  { port: 2525, tls: true, ssl: false },
];

const DEFAULT_NOTIF_CONFIG: NotificationConfig = {
  id: "00000000-0000-0000-0000-000000000000",
  tenant_id: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_password: "",
  smtp_from: "",
  smtp_from_name: "CMG Telematics",
  smtp_tls: true,
  smtp_ssl: false,
  notify_level_high: true,
  notify_level_medium: false,
  notify_level_low: false,
  active: false,
};

const NOTIFY_ROLES = ["superadmin", "admin", "operator"];

const notifInputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "white",
  fontSize: 14,
  outline: "none",
};

function NotifToggle({
  checked,
  onChange,
  label,
  description,
  accent,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  accent?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer py-2">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {description}
          </div>
        )}
      </div>
      <div
        onClick={() => onChange(!checked)}
        className="relative flex-shrink-0"
        style={{ width: 44, height: 24 }}
      >
        <div
          className="rounded-full transition-colors duration-200"
          style={{
            width: 44,
            height: 24,
            background: checked ? (accent || "var(--accent)") : "rgba(255,255,255,0.1)",
          }}
        />
        <div
          className="absolute top-0.5 rounded-full transition-transform duration-200"
          style={{
            width: 20,
            height: 20,
            background: "white",
            left: 2,
            transform: checked ? "translateX(20px)" : "translateX(0)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        />
      </div>
    </label>
  );
}

function NotifFieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function NotificationsTabContent() {
  const [cfg, setCfg] = useState<NotificationConfig>(DEFAULT_NOTIF_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [recipients, setRecipients] = useState<UserOut[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [c, users] = await Promise.all([
        notificationConfig.get(),
        admin.listUsers(),
      ]);
      setCfg(c);
      setRecipients(users.filter((u: UserOut) => u.active && NOTIFY_ROLES.includes(u.role)));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function toggleRecipient(user: UserOut) {
    setTogglingId(user.id);
    try {
      await admin.toggleNotifyEmail(user.id, !user.notify_email);
      setRecipients(prev => prev.map(u => u.id === user.id ? { ...u, notify_email: !u.notify_email } : u));
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  }

  function applyProvider(idx: number) {
    const p = PROVIDERS[idx];
    setCfg(prev => ({
      ...prev,
      smtp_host: p.host,
      smtp_port: p.port,
      smtp_tls: p.tls,
      smtp_ssl: p.ssl,
    }));
  }

  function applyPortPreset(p: typeof PORT_PRESETS[0]) {
    setCfg(prev => ({ ...prev, smtp_port: p.port, smtp_tls: p.tls, smtp_ssl: p.ssl }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const saved = await notificationConfig.save({
        smtp_host: cfg.smtp_host,
        smtp_port: cfg.smtp_port,
        smtp_user: cfg.smtp_user,
        smtp_password: cfg.smtp_password,
        smtp_from: cfg.smtp_from,
        smtp_from_name: cfg.smtp_from_name,
        smtp_tls: cfg.smtp_tls,
        smtp_ssl: cfg.smtp_ssl,
        notify_level_high: cfg.notify_level_high,
        notify_level_medium: cfg.notify_level_medium,
        notify_level_low: cfg.notify_level_low,
        active: cfg.active,
      });
      setCfg(saved);
      setSaveMsg({ type: "ok", text: "Configuración guardada correctamente." });
    } catch (e: unknown) {
      setSaveMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testEmail.trim()) return;
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await notificationConfig.test(testEmail.trim());
      setTestMsg({ type: "ok", text: res.message });
    } catch (e: unknown) {
      setTestMsg({ type: "err", text: e instanceof Error ? e.message : "Error al enviar correo de prueba." });
    } finally {
      setTesting(false);
    }
  }

  const card: React.CSSProperties = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 24,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: 16,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 300, color: "var(--muted)" }}>
        Cargando configuración...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, padding: "0 0 48px" }}>
      <div className="space-y-5">
        {/* Enable toggle + recipients */}
        <div style={card}>
          <NotifToggle
            checked={cfg.active}
            onChange={v => setCfg(prev => ({ ...prev, active: v }))}
            label="Activar notificaciones por email"
            description="Cuando se dispare una alerta, se enviará un correo a los usuarios de abajo."
          />
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Destinatarios ({recipients.length})
            </p>
            {recipients.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No hay usuarios con acceso a esta flota. Crea usuarios en{" "}
                <a href="/admin/users" style={{ color: "var(--accent)" }}>Administración → Usuarios</a>.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {recipients.map(u => (
                  <div key={u.id} className="flex items-center gap-2 py-1">
                    <div className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        width: 28, height: 28,
                        background: u.notify_email ? "rgba(29,158,117,0.15)" : "rgba(255,255,255,0.05)",
                        color: u.notify_email ? "var(--accent)" : "var(--muted)",
                        transition: "all 0.2s",
                      }}>
                      {u.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm" style={{ color: u.notify_email ? "white" : "var(--muted)" }}>{u.full_name}</span>
                      <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>{u.email}</span>
                    </div>
                    <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                      {u.role}
                    </span>
                    {/* Toggle email */}
                    <button
                      onClick={() => toggleRecipient(u)}
                      disabled={togglingId === u.id}
                      title={u.notify_email ? "Desactivar email para este usuario" : "Activar email para este usuario"}
                      className="flex-shrink-0 rounded-full transition-colors duration-200"
                      style={{
                        width: 36, height: 20, padding: 0, border: "none", cursor: "pointer",
                        background: u.notify_email ? "var(--accent)" : "rgba(255,255,255,0.1)",
                        opacity: togglingId === u.id ? 0.5 : 1,
                        position: "relative",
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", background: "white",
                        position: "absolute", top: 2,
                        left: u.notify_email ? 18 : 2,
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
              Para añadir más destinatarios, crea usuarios con rol <strong style={{ color: "white" }}>operador</strong> o <strong style={{ color: "white" }}>admin</strong> en{" "}
              <a href="/admin/users" style={{ color: "var(--accent)" }}>Administración → Usuarios</a>.
            </p>
          </div>
        </div>

        {/* Provider presets */}
        <div style={card}>
          <p style={sectionTitle}>Proveedor de email</p>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => applyProvider(i)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: cfg.smtp_host === p.host
                    ? "rgba(29,158,117,0.2)"
                    : "rgba(255,255,255,0.06)",
                  border: `1px solid ${cfg.smtp_host === p.host ? "rgba(29,158,117,0.5)" : "var(--border)"}`,
                  color: cfg.smtp_host === p.host ? "#1D9E75" : "var(--muted)",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {cfg.smtp_host === "smtp.gmail.com" && (
            <p className="text-xs mt-3 p-2 rounded" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
              Gmail requiere una <strong>contraseña de aplicación</strong> si tienes 2FA activado. Genérala en myaccount.google.com/apppasswords.
            </p>
          )}
        </div>

        {/* SMTP Settings */}
        <div style={card}>
          <p style={sectionTitle}>Configuración SMTP</p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr auto" }}>
            <NotifFieldGroup label="Servidor SMTP (host)">
              <input
                style={notifInputStyle}
                placeholder="smtp.ejemplo.com"
                value={cfg.smtp_host}
                onChange={e => setCfg(prev => ({ ...prev, smtp_host: e.target.value }))}
              />
            </NotifFieldGroup>
            <NotifFieldGroup label="Puerto">
              <div className="flex flex-col gap-1">
                <input
                  style={{ ...notifInputStyle, width: 90 }}
                  type="number"
                  value={cfg.smtp_port}
                  onChange={e => setCfg(prev => ({ ...prev, smtp_port: Number(e.target.value) }))}
                />
                <div className="flex gap-1 flex-wrap">
                  {PORT_PRESETS.map(p => (
                    <button
                      key={p.port}
                      onClick={() => applyPortPreset(p)}
                      className="text-xs px-2 py-0.5 rounded transition-colors"
                      style={{
                        background: cfg.smtp_port === p.port
                          ? "rgba(29,158,117,0.2)"
                          : "rgba(255,255,255,0.06)",
                        border: `1px solid ${cfg.smtp_port === p.port ? "rgba(29,158,117,0.4)" : "var(--border)"}`,
                        color: cfg.smtp_port === p.port ? "#1D9E75" : "var(--muted)",
                      }}
                    >
                      {p.port}
                    </button>
                  ))}
                </div>
              </div>
            </NotifFieldGroup>
          </div>

          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <NotifFieldGroup label="Usuario SMTP">
              <input
                style={notifInputStyle}
                placeholder="usuario@ejemplo.com"
                value={cfg.smtp_user}
                onChange={e => setCfg(prev => ({ ...prev, smtp_user: e.target.value }))}
                autoComplete="username"
              />
            </NotifFieldGroup>
            <NotifFieldGroup label="Contraseña">
              <div className="relative">
                <input
                  style={{ ...notifInputStyle, paddingRight: 40 }}
                  type={showPassword ? "text" : "password"}
                  placeholder={cfg.smtp_password === "••••••••" ? "Guardada (dejar en blanco para mantener)" : "Contraseña SMTP"}
                  value={cfg.smtp_password === "••••••••" ? "" : cfg.smtp_password}
                  onChange={e => setCfg(prev => ({ ...prev, smtp_password: e.target.value }))}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 4 }}
                >
                  {showPassword ? (
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  )}
                </button>
              </div>
            </NotifFieldGroup>
          </div>

          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <NotifFieldGroup label="Email remitente">
              <input
                style={notifInputStyle}
                placeholder="alertas@miempresa.es"
                value={cfg.smtp_from}
                onChange={e => setCfg(prev => ({ ...prev, smtp_from: e.target.value }))}
              />
            </NotifFieldGroup>
            <NotifFieldGroup label="Nombre remitente">
              <input
                style={notifInputStyle}
                placeholder="CMG Telematics"
                value={cfg.smtp_from_name}
                onChange={e => setCfg(prev => ({ ...prev, smtp_from_name: e.target.value }))}
              />
            </NotifFieldGroup>
          </div>

          <div className="grid gap-0 mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <NotifToggle
              checked={cfg.smtp_tls}
              onChange={v => setCfg(prev => ({ ...prev, smtp_tls: v }))}
              label="STARTTLS"
              description="Cifrado TLS al conectar (puerto 587). Desactivar si usas SSL directo."
            />
            <NotifToggle
              checked={cfg.smtp_ssl}
              onChange={v => setCfg(prev => ({ ...prev, smtp_ssl: v }))}
              label="SSL directo"
              description="Conexión SSL desde el inicio (puerto 465). No compatible con STARTTLS."
            />
          </div>
        </div>

        {/* Alert level toggles */}
        <div style={card}>
          <p style={sectionTitle}>Niveles que generan email</p>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            <NotifToggle
              checked={cfg.notify_level_high}
              onChange={v => setCfg(prev => ({ ...prev, notify_level_high: v }))}
              label="Alertas ALTAS"
              description="Situaciones críticas: presión excesiva, fallo de sistema, etc."
              accent="#ef4444"
            />
            <NotifToggle
              checked={cfg.notify_level_medium}
              onChange={v => setCfg(prev => ({ ...prev, notify_level_medium: v }))}
              label="Alertas MEDIAS"
              description="Advertencias: valores próximos al límite, batería baja, etc."
              accent="#f59e0b"
            />
            <NotifToggle
              checked={cfg.notify_level_low}
              onChange={v => setCfg(prev => ({ ...prev, notify_level_low: v }))}
              label="Alertas BAJAS"
              description="Información: eventos de rutina que requieren atención menor."
              accent="#3b82f6"
            />
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity"
            style={{
              background: "var(--accent)",
              color: "white",
              opacity: saving ? 0.6 : 1,
              border: "none",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
          {saveMsg && (
            <span
              className="text-sm"
              style={{ color: saveMsg.type === "ok" ? "var(--accent)" : "#ef4444" }}
            >
              {saveMsg.text}
            </span>
          )}
        </div>

        {/* Test email section */}
        <div style={card}>
          <p style={sectionTitle}>Enviar correo de prueba</p>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
            Envía un correo de prueba usando la configuración SMTP actual para verificar que está funcionando correctamente. La configuración debe estar guardada y activa.
          </p>
          <div className="flex gap-3 items-start flex-wrap">
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                style={notifInputStyle}
                type="email"
                placeholder="tu@email.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTest()}
              />
            </div>
            <button
              onClick={handleTest}
              disabled={testing || !testEmail.trim()}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity flex-shrink-0"
              style={{
                background: "rgba(29,158,117,0.15)",
                color: "#1D9E75",
                border: "1px solid rgba(29,158,117,0.3)",
                opacity: testing || !testEmail.trim() ? 0.5 : 1,
                cursor: testing || !testEmail.trim() ? "not-allowed" : "pointer",
              }}
            >
              {testing ? "Enviando..." : "Enviar prueba"}
            </button>
          </div>
          {testMsg && (
            <p
              className="text-sm mt-3 p-3 rounded-lg"
              style={{
                background: testMsg.type === "ok" ? "rgba(29,158,117,0.1)" : "rgba(239,68,68,0.1)",
                color: testMsg.type === "ok" ? "#1D9E75" : "#ef4444",
                border: `1px solid ${testMsg.type === "ok" ? "rgba(29,158,117,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}
            >
              {testMsg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [tab, setTab] = useState<"history" | "rules" | "notifications">("history");

  // Role check — only admin/superadmin can create/delete rules and see notifications tab
  const [userRole, setUserRole] = useState<string | null>(null);
  const [canManageRules, setCanManageRules] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      const role = raw ? JSON.parse(raw).role : null;
      setUserRole(role);
      setCanManageRules(role === "admin" || role === "superadmin");
    } catch {
      setUserRole(null);
      setCanManageRules(false);
    }
  }, []);

  const isAdminOrSuperadmin = userRole === "admin" || userRole === "superadmin";

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
  const [liveSignals, setLiveSignals] = useState<LiveSignal[] | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(false);

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

  useEffect(() => {
    if (!createForm.vehicle_id) {
      setLiveSignals(null);
      return;
    }
    setLoadingSignals(true);
    getLiveSignals(createForm.vehicle_id)
      .then(res => setLiveSignals(res.signals))
      .catch(() => setLiveSignals([]))
      .finally(() => setLoadingSignals(false));
  }, [createForm.vehicle_id]);

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
    setLiveSignals(null);
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
    <div className="px-6 py-6 max-w-none w-full">
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
        ) : tab !== "notifications" ? (
          <button onClick={() => { setLoadingAlerts(true); loadAlerts(); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Actualizar
          </button>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 p-1 rounded-lg w-fit" style={{ background: "var(--card)" }}>
        {[
          { key: "history", label: "Historial" },
          { key: "rules",   label: `Reglas (${rules.length})` },
          ...(isAdminOrSuperadmin ? [{ key: "notifications", label: "Notificaciones" }] : []),
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "history" | "rules" | "notifications")}
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
            <button
              onClick={() => {
                exportExcel(
                  [
                    {
                      name: "Historial Alertas",
                      rows: alertList.map(a => ({
                        "Vehículo": a.vehicle_name ?? a.vehicle_id.slice(0, 8),
                        "Señal": a.display_name,
                        "Nivel": LEVEL_ES[a.level] ?? a.level,
                        "Valor": a.converted_value,
                        "Umbral": a.threshold,
                        "Unidad": a.unit ?? "",
                        "Disparada": formatDateTime(a.fired_at),
                        "Resuelta": a.resolved_at ? formatDateTime(a.resolved_at) : "Activa",
                        "Reconocida": a.acknowledged_at ? formatDateTime(a.acknowledged_at) : "-",
                      })),
                    },
                    {
                      name: "Reglas Activas",
                      rows: rules.map(r => ({
                        "Nombre": r.name,
                        "Señal": r.display_name,
                        "Condición": CONDITION_ES[r.condition] ?? r.condition,
                        "Umbral": r.threshold,
                        "Unidad": r.unit ?? "",
                        "Nivel": LEVEL_ES[r.level] ?? r.level,
                        "Vehículo": r.vehicle_name ?? "Todos",
                        "Activa": r.active ? "Sí" : "No",
                      })),
                    },
                  ],
                  `alertas_${new Date().toISOString().slice(0, 10)}.xlsx`
                );
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Exportar Excel
            </button>
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
          {!loadingRules && rules.length > 0 && (
            <div className="flex justify-end mb-3">
              <button
                onClick={() => {
                  exportExcel(
                    [
                      {
                        name: "Reglas Activas",
                        rows: rules.map(r => ({
                          "Nombre": r.name,
                          "Señal": r.display_name,
                          "Condición": CONDITION_ES[r.condition] ?? r.condition,
                          "Umbral": r.threshold,
                          "Unidad": r.unit ?? "",
                          "Nivel": LEVEL_ES[r.level] ?? r.level,
                          "Vehículo": r.vehicle_name ?? "Todos",
                          "Activa": r.active ? "Sí" : "No",
                        })),
                      },
                      {
                        name: "Historial Alertas",
                        rows: alertList.map(a => ({
                          "Vehículo": a.vehicle_name ?? a.vehicle_id.slice(0, 8),
                          "Señal": a.display_name,
                          "Nivel": LEVEL_ES[a.level] ?? a.level,
                          "Valor": a.converted_value,
                          "Umbral": a.threshold,
                          "Unidad": a.unit ?? "",
                          "Disparada": formatDateTime(a.fired_at),
                          "Resuelta": a.resolved_at ? formatDateTime(a.resolved_at) : "Activa",
                          "Reconocida": a.acknowledged_at ? formatDateTime(a.acknowledged_at) : "-",
                        })),
                      },
                    ],
                    `reglas_alertas_${new Date().toISOString().slice(0, 10)}.xlsx`
                  );
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Exportar Excel
              </button>
            </div>
          )}
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

      {/* ── NOTIFICATIONS TAB ── */}
      {tab === "notifications" && isAdminOrSuperadmin && (
        <NotificationsTabContent />
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

            <Field
              label="Variable del FMC650 / PLC"
              hint={
                createForm.vehicle_id
                  ? loadingSignals
                    ? "Cargando señales del dispositivo..."
                    : liveSignals && liveSignals.length > 0
                      ? `${liveSignals.length} señales detectadas en este vehículo`
                      : "Sin datos recientes — escribe el IO key manualmente"
                  : "Selecciona un vehículo para ver sus señales activas, o escribe el key manualmente"
              }
            >
              {createForm.vehicle_id && liveSignals && liveSignals.length > 0 ? (
                <select
                  value={createForm.io_key}
                  onChange={e => {
                    const sig = liveSignals.find(s => s.io_key === e.target.value);
                    setCreateForm(f => ({
                      ...f,
                      io_key: e.target.value,
                      display_name: sig?.display_name || f.display_name || e.target.value,
                      scale_factor: sig ? String(sig.scale_factor) : f.scale_factor,
                      offset: sig ? String(sig.offset) : f.offset,
                      unit: sig?.unit || f.unit,
                    }));
                  }}
                  className={INPUT_CLASS}
                  style={INPUT_STYLE}
                >
                  <option value="">— Selecciona una señal —</option>
                  {liveSignals.filter(s => s.is_configured).length > 0 && (
                    <optgroup label="Señales configuradas">
                      {liveSignals.filter(s => s.is_configured).map(s => (
                        <option key={s.io_key} value={s.io_key}>
                          {s.display_name}
                          {s.converted_value !== null
                            ? ` — ${s.converted_value} ${s.unit}`.trimEnd()
                            : s.raw_value !== null ? ` — ${s.raw_value} (raw)` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liveSignals.filter(s => !s.is_configured).length > 0 && (
                    <optgroup label="Señales sin configurar (IO ID)">
                      {liveSignals.filter(s => !s.is_configured).map(s => (
                        <option key={s.io_key} value={s.io_key}>
                          IO {s.io_key}
                          {s.raw_value !== null ? ` — valor actual: ${s.raw_value}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              ) : (
                <>
                  <input
                    list="rule-io-key-suggestions"
                    value={createForm.io_key}
                    onChange={e => setCreateForm(f => ({
                      ...f,
                      io_key: e.target.value,
                      display_name: f.display_name || e.target.value,
                    }))}
                    placeholder="Ej: ain1_mv, dout1, 300..."
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <datalist id="rule-io-key-suggestions">
                    {ioKeys.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </datalist>
                </>
              )}
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
