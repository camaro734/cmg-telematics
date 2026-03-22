"use client";

import { useEffect, useState, useCallback } from "react";
import { notificationConfig, NotificationConfig, admin, UserOut } from "@/lib/api";

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

const DEFAULT_CONFIG: NotificationConfig = {
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

function Toggle({
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

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "white",
  fontSize: 14,
  outline: "none",
};

const NOTIFY_ROLES = ["superadmin", "admin", "operator"];

export default function NotificationsAdminPage() {
  const [cfg, setCfg] = useState<NotificationConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [recipients, setRecipients] = useState<UserOut[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [c, users] = await Promise.all([
        notificationConfig.get(),
        admin.listUsers(),
      ]);
      setCfg(c);
      setRecipients(users.filter(u => u.active && NOTIFY_ROLES.includes(u.role)));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px 48px" }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 40, height: 40, background: "rgba(29,158,117,0.15)" }}
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
                stroke="#1D9E75" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Notificaciones por Email</h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Configura el servidor SMTP para las alertas de tu flota
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {/* Enable toggle + recipients */}
        <div style={card}>
          <Toggle
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
              <div className="flex flex-col gap-1.5">
                {recipients.map(u => (
                  <div key={u.id} className="flex items-center gap-2">
                    <div className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ width: 28, height: 28, background: "rgba(29,158,117,0.15)", color: "var(--accent)" }}>
                      {u.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm text-white">{u.full_name}</span>
                      <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>{u.email}</span>
                    </div>
                    <span className="text-xs px-1.5 py-0.5 rounded ml-auto flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                      {u.role}
                    </span>
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
              Gmail requiere una <strong>contrasena de aplicacion</strong> si tienes 2FA activado. Generala en myaccount.google.com/apppasswords.
            </p>
          )}
        </div>

        {/* SMTP Settings */}
        <div style={card}>
          <p style={sectionTitle}>Configuracion SMTP</p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr auto" }}>
            <FieldGroup label="Servidor SMTP (host)">
              <input
                style={inputStyle}
                placeholder="smtp.ejemplo.com"
                value={cfg.smtp_host}
                onChange={e => setCfg(prev => ({ ...prev, smtp_host: e.target.value }))}
              />
            </FieldGroup>
            <FieldGroup label="Puerto">
              <div className="flex flex-col gap-1">
                <input
                  style={{ ...inputStyle, width: 90 }}
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
            </FieldGroup>
          </div>

          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <FieldGroup label="Usuario SMTP">
              <input
                style={inputStyle}
                placeholder="usuario@ejemplo.com"
                value={cfg.smtp_user}
                onChange={e => setCfg(prev => ({ ...prev, smtp_user: e.target.value }))}
                autoComplete="username"
              />
            </FieldGroup>
            <FieldGroup label="Contrasena">
              <div className="relative">
                <input
                  style={{ ...inputStyle, paddingRight: 40 }}
                  type={showPassword ? "text" : "password"}
                  placeholder={cfg.smtp_password === "••••••••" ? "Guardada (dejar en blanco para mantener)" : "Contrasena SMTP"}
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
            </FieldGroup>
          </div>

          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <FieldGroup label="Email remitente">
              <input
                style={inputStyle}
                placeholder="alertas@miempresa.es"
                value={cfg.smtp_from}
                onChange={e => setCfg(prev => ({ ...prev, smtp_from: e.target.value }))}
              />
            </FieldGroup>
            <FieldGroup label="Nombre remitente">
              <input
                style={inputStyle}
                placeholder="CMG Telematics"
                value={cfg.smtp_from_name}
                onChange={e => setCfg(prev => ({ ...prev, smtp_from_name: e.target.value }))}
              />
            </FieldGroup>
          </div>

          <div className="grid gap-0 mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <Toggle
              checked={cfg.smtp_tls}
              onChange={v => setCfg(prev => ({ ...prev, smtp_tls: v }))}
              label="STARTTLS"
              description="Cifrado TLS al conectar (puerto 587). Desactivar si usas SSL directo."
            />
            <Toggle
              checked={cfg.smtp_ssl}
              onChange={v => setCfg(prev => ({ ...prev, smtp_ssl: v }))}
              label="SSL directo"
              description="Conexion SSL desde el inicio (puerto 465). No compatible con STARTTLS."
            />
          </div>
        </div>

        {/* Alert level toggles */}
        <div style={card}>
          <p style={sectionTitle}>Niveles que generan email</p>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            <Toggle
              checked={cfg.notify_level_high}
              onChange={v => setCfg(prev => ({ ...prev, notify_level_high: v }))}
              label="Alertas ALTAS"
              description="Situaciones criticas: presion excesiva, fallo de sistema, etc."
              accent="#ef4444"
            />
            <Toggle
              checked={cfg.notify_level_medium}
              onChange={v => setCfg(prev => ({ ...prev, notify_level_medium: v }))}
              label="Alertas MEDIAS"
              description="Advertencias: valores proximos al limite, bateria baja, etc."
              accent="#f59e0b"
            />
            <Toggle
              checked={cfg.notify_level_low}
              onChange={v => setCfg(prev => ({ ...prev, notify_level_low: v }))}
              label="Alertas BAJAS"
              description="Informacion: eventos de rutina que requieren atencion menor."
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
            {saving ? "Guardando..." : "Guardar configuracion"}
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
            Envia un correo de prueba usando la configuracion SMTP actual para verificar que esta funcionando correctamente. La configuracion debe estar guardada y activa.
          </p>
          <div className="flex gap-3 items-start flex-wrap">
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                style={inputStyle}
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
