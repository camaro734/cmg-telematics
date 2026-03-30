"use client";

import { useEffect, useState } from "react";
import { admin, uploadLogo, type TenantOut } from "@/lib/api";
import Modal from "@/components/Modal";

const TYPE_LABELS: Record<string, string> = {
  cmg: "CMG (raíz)",
  manufacturer: "Fabricante",
  end_client: "Cliente Final",
};

const TYPE_COLORS: Record<string, string> = {
  cmg: "#3b82f6",
  manufacturer: "#8b5cf6",
  end_client: "#22c55e",
};

type ModalMode = "create" | "edit" | "branding";

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ModalMode>("create");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TenantOut | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ name: "", type: "end_client", parent_id: "" });

  // Current user info from localStorage
  const currentUser = (() => {
    if (typeof window === "undefined") return { role: "", tenant_id: "" };
    try { return JSON.parse(localStorage.getItem("cmg_user") ?? "{}"); }
    catch { return { role: "", tenant_id: "" }; }
  })();
  const isSuperadmin = currentUser.role === "superadmin";
  const [brandForm, setBrandForm] = useState({
    brand_name: "",
    brand_color: "#1D9E75",
    logo_url: "",
    custom_domain: "",
  });

  async function load() {
    try {
      const data = await admin.listTenants();
      setTenants(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setMode("create");
    setForm({ name: "", type: "end_client", parent_id: isSuperadmin ? "" : currentUser.tenant_id });
    setError("");
    setShowModal(true);
  }

  function openEdit(t: TenantOut) {
    setEditing(t);
    setMode("edit");
    setForm({ name: t.name, type: t.type, parent_id: t.parent_id ?? "" });
    setError("");
    setShowModal(true);
  }

  function openBranding(t: TenantOut) {
    setEditing(t);
    setMode("branding");
    setBrandForm({
      brand_name: t.brand_name ?? "",
      brand_color: t.brand_color ?? "#1D9E75",
      logo_url: t.logo_url ?? "",
      custom_domain: t.custom_domain ?? "",
    });
    setError("");
    setShowModal(true);
  }

  async function handleSave() {
    setError("");
    try {
      if (mode === "branding" && editing) {
        await admin.updateTenant(editing.id, {
          brand_name: brandForm.brand_name || null,
          brand_color: brandForm.brand_color || null,
          logo_url: brandForm.logo_url || null,
          custom_domain: brandForm.custom_domain || null,
        });
      } else if (mode === "edit" && editing) {
        await admin.updateTenant(editing.id, { name: form.name });
      } else {
        await admin.createTenant({
          name: form.name,
          type: form.type,
          parent_id: form.parent_id || undefined,
        });
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function toggleActive(t: TenantOut) {
    await admin.updateTenant(t.id, { active: !t.active });
    await load();
  }

  // Build tree structure for display
  // Treat as root any tenant whose parent is not in the returned list
  // (for non-superadmin, the manufacturer itself has a parent outside their subtree)
  const tenantIdSet = new Set(tenants.map((t) => t.id));
  const byParent: Record<string, TenantOut[]> = {};
  tenants.forEach((t) => {
    const key = !t.parent_id || !tenantIdSet.has(t.parent_id) ? "root" : t.parent_id;
    (byParent[key] ??= []).push(t);
  });

  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const key = parentId ?? "root";
    const children = byParent[key] ?? [];
    return children.map((t) => (
      <div key={t.id}>
        <div
          className="flex items-center justify-between px-4 py-3 rounded-xl mb-1.5"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            marginLeft: depth * 24,
            opacity: t.active ? 1 : 0.5,
          }}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: TYPE_COLORS[t.type] ?? "var(--muted)" }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white">{t.name}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    color: "var(--muted)",
                  }}
                >
                  {TYPE_LABELS[t.type] ?? t.type}
                </span>
                {/* Branding badge */}
                {t.type === "manufacturer" && t.brand_name && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                    style={{
                      background: "rgba(139,92,246,0.15)",
                      color: "#a78bfa",
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: t.brand_color ?? "#8b5cf6" }}
                    />
                    White-label
                  </span>
                )}
                {t.custom_domain && (
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(59,130,246,0.1)",
                      color: "#60a5fa",
                    }}
                  >
                    {t.custom_domain}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            <button
              onClick={() => openEdit(t)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: "var(--sidebar)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              Editar
            </button>
            {t.type === "manufacturer" && (
              <button
                onClick={() => openBranding(t)}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                style={{
                  background: t.brand_name
                    ? "rgba(139,92,246,0.15)"
                    : "var(--sidebar)",
                  color: t.brand_name ? "#a78bfa" : "var(--muted)",
                  border: `1px solid ${t.brand_name ? "rgba(139,92,246,0.3)" : "var(--border)"}`,
                }}
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                  <circle
                    cx="12"
                    cy="12"
                    r="3"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                Branding
              </button>
            )}
            {t.type !== "cmg" && (
              <button
                onClick={() => toggleActive(t)}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{
                  background: t.active
                    ? "rgba(239,68,68,0.1)"
                    : "rgba(34,197,94,0.1)",
                  color: t.active ? "var(--danger)" : "var(--success)",
                  border: `1px solid ${t.active ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                }}
              >
                {t.active ? "Desactivar" : "Activar"}
              </button>
            )}
          </div>
        </div>
        {renderTree(t.id, depth + 1)}
      </div>
    ));
  }

  return (
    <div className="px-6 py-6 max-w-none w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white">Clientes y Fabricantes</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {isSuperadmin
              ? "Jerarquía: CMG → Fabricante → Cliente Final. Los fabricantes pueden tener portal white-label propio."
              : "Gestión de los clientes finales de tu organización."}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Nuevo
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-5">
        {Object.entries(TYPE_LABELS)
          .filter(([k]) => isSuperadmin || k !== "cmg")
          .map(([k, v]) => (
            <div
              key={k}
              className="flex items-center gap-1.5 text-xs"
              style={{ color: "var(--muted)" }}
            >
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: TYPE_COLORS[k] }}
              />
              {v}
            </div>
          ))}
        {isSuperadmin && (
          <div
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "var(--muted)" }}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: "#8b5cf6" }}
            />
            White-label activo
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl animate-pulse"
              style={{ background: "var(--card)" }}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-0">{renderTree(null, 0)}</div>
      )}

      {showModal && (
        <Modal
          title={
            mode === "branding"
              ? `Portal white-label — ${editing?.name}`
              : editing
              ? "Editar organización"
              : "Nueva organización"
          }
          onClose={() => setShowModal(false)}
        >
          {mode === "branding" ? (
            <BrandingForm
              form={brandForm}
              setForm={setBrandForm}
              error={error}
              onSave={handleSave}
              onClose={() => setShowModal(false)}
              tenantName={editing?.name ?? ""}
            />
          ) : (
            <OrgForm
              form={form}
              setForm={setForm}
              tenants={tenants}
              editing={editing}
              error={error}
              onSave={handleSave}
              onClose={() => setShowModal(false)}
              isSuperadmin={isSuperadmin}
              currentUserTenantId={currentUser.tenant_id}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Org form ─────────────────────────────────────────────────────────────────

function OrgForm({
  form,
  setForm,
  tenants,
  editing,
  error,
  onSave,
  onClose,
  isSuperadmin,
  currentUserTenantId,
}: {
  form: { name: string; type: string; parent_id: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; type: string; parent_id: string }>>;
  tenants: TenantOut[];
  editing: TenantOut | null;
  error: string;
  onSave: () => void;
  onClose: () => void;
  isSuperadmin: boolean;
  currentUserTenantId: string;
}) {
  // For non-superadmin: exclude CMG root from parent options (API already scopes to subtree)
  const parentOptions = tenants.filter(
    (t) => t.active && (isSuperadmin || t.type !== "cmg")
  );

  return (
    <div className="space-y-4">
      <Field label="Nombre">
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
          style={{
            background: "var(--sidebar)",
            border: "1px solid var(--border)",
          }}
          placeholder="Nombre de la organización"
        />
      </Field>

      {!editing && (
        <>
          {isSuperadmin && (
            <Field label="Tipo">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                style={{
                  background: "var(--sidebar)",
                  border: "1px solid var(--border)",
                }}
              >
                <option value="manufacturer">Fabricante</option>
                <option value="end_client">Cliente Final</option>
              </select>
            </Field>
          )}
          <Field label="Depende de">
            <select
              value={form.parent_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, parent_id: e.target.value }))
              }
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{
                background: "var(--sidebar)",
                border: "1px solid var(--border)",
              }}
            >
              {isSuperadmin && <option value="">— Raíz (CMG) —</option>}
              {parentOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({TYPE_LABELS[t.type]})
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <Buttons onClose={onClose} onSave={onSave} isEdit={!!editing} />
    </div>
  );
}

// ─── Branding form ────────────────────────────────────────────────────────────

function BrandingForm({
  form,
  setForm,
  error,
  onSave,
  onClose,
  tenantName,
}: {
  form: { brand_name: string; brand_color: string; logo_url: string; custom_domain: string };
  setForm: React.Dispatch<React.SetStateAction<{ brand_name: string; brand_color: string; logo_url: string; custom_domain: string }>>;
  error: string;
  onSave: () => void;
  onClose: () => void;
  tenantName: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const previewColor = form.brand_color || "#1D9E75";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const { url } = await uploadLogo(file);
      setForm((f) => ({ ...f, logo_url: url }));
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Info */}
      <div
        className="flex gap-3 items-start p-4 rounded-xl text-xs leading-relaxed"
        style={{
          background: "rgba(139,92,246,0.08)",
          border: "1px solid rgba(139,92,246,0.2)",
          color: "#a78bfa",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>
          El portal de <strong>{tenantName}</strong> mostrará su propio logo y
          color de marca en el login y el menú. Sus usuarios verán{" "}
          <strong>&quot;Powered by CMG Telematics&quot;</strong> en el pie de página.
        </span>
      </div>

      {/* Live preview */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>
          Vista previa del login
        </p>
        <div
          className="rounded-xl p-5 flex flex-col items-center gap-2"
          style={{ background: "#0f1117", border: "1px solid var(--border)" }}
        >
          {form.logo_url ? (
            <img
              src={form.logo_url}
              alt="logo"
              className="h-10 max-w-[140px] object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: previewColor }}
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path
                  d="M12 2L2 7v10l10 5 10-5V7L12 2z"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  fill="rgba(255,255,255,0.15)"
                />
                <circle cx="12" cy="12" r="3" fill="white" />
              </svg>
            </div>
          )}
          <p className="text-sm font-bold text-white">
            {form.brand_name || tenantName}
          </p>
          <p className="text-xs" style={{ color: "#64748b" }}>
            Portal de gestión de flota
          </p>
          <div
            className="w-full mt-1 py-2 rounded-lg text-xs text-center text-white font-medium"
            style={{ background: previewColor }}
          >
            Entrar
          </div>
          <p className="text-xs mt-1" style={{ color: "#334155" }}>
            Powered by CMG Telematics
          </p>
        </div>
      </div>

      <Field label="Nombre de marca">
        <input
          value={form.brand_name}
          onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
          placeholder={tenantName}
          className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
          style={{
            background: "var(--sidebar)",
            border: "1px solid var(--border)",
          }}
        />
      </Field>

      <Field label="Color principal (hex)">
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={form.brand_color}
            onChange={(e) =>
              setForm((f) => ({ ...f, brand_color: e.target.value }))
            }
            className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0.5"
            style={{ background: "var(--sidebar)" }}
          />
          <input
            value={form.brand_color}
            onChange={(e) =>
              setForm((f) => ({ ...f, brand_color: e.target.value }))
            }
            placeholder="#1D9E75"
            className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white font-mono"
            style={{
              background: "var(--sidebar)",
              border: "1px solid var(--border)",
            }}
          />
        </div>
      </Field>

      <Field label="Logo (PNG, SVG, JPG — máx 2 MB)">
        <label
          className="flex flex-col items-center gap-3 px-4 py-5 rounded-xl cursor-pointer transition-colors"
          style={{
            border: `2px dashed ${uploading ? "var(--accent)" : "var(--border)"}`,
            background: "var(--sidebar)",
          }}
        >
          <input
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
          {uploading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--accent)" }}>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Subiendo…
            </div>
          ) : form.logo_url ? (
            <div className="flex flex-col items-center gap-2">
              <img
                src={form.logo_url}
                alt="logo preview"
                className="h-10 max-w-[160px] object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
              <span className="text-xs" style={{ color: "var(--accent)" }}>
                ✓ Logo subido — haz clic para cambiar
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 text-center">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)" }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm text-white">Haz clic para subir el logo</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                PNG o SVG blanco sobre transparente, mín. 300px
              </span>
            </div>
          )}
        </label>
        {uploadError && (
          <p className="text-xs mt-1.5" style={{ color: "var(--danger)" }}>{uploadError}</p>
        )}
        {form.logo_url && (
          <button
            onClick={() => setForm((f) => ({ ...f, logo_url: "" }))}
            className="text-xs mt-1.5"
            style={{ color: "var(--muted)" }}
          >
            × Eliminar logo
          </button>
        )}
      </Field>

      <Field label="Dominio personalizado">
        <div className="flex items-center rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <span className="px-3 py-2.5 text-sm flex-shrink-0" style={{ background: "rgba(29,158,117,0.1)", color: "var(--accent)" }}>
            https://
          </span>
          <input
            value={form.custom_domain}
            onChange={(e) =>
              setForm((f) => ({ ...f, custom_domain: e.target.value.replace(/^https?:\/\//, "") }))
            }
            placeholder="connect.empresa.com"
            className="flex-1 px-3 py-2.5 text-sm text-white font-mono outline-none"
            style={{ background: "var(--sidebar)" }}
          />
        </div>
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>
          HTTPS automático vía Let&apos;s Encrypt. El fabricante solo necesita
          añadir un registro DNS: <span className="font-mono text-white">connect.empresa.com A 213.210.20.183</span>
        </p>
      </Field>

      {error && <ErrorBox>{error}</ErrorBox>}

      <Buttons onClose={onClose} onSave={onSave} isEdit saveLabel="Guardar branding" />
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="block text-xs font-medium mb-1.5"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-xs px-3 py-2 rounded-lg"
      style={{ background: "#450a0a", color: "#fca5a5" }}
    >
      {children}
    </div>
  );
}

function Buttons({
  onClose,
  onSave,
  isEdit,
  saveLabel,
}: {
  onClose: () => void;
  onSave: () => void;
  isEdit: boolean;
  saveLabel?: string;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        onClick={onClose}
        className="flex-1 py-2.5 rounded-lg text-sm"
        style={{
          background: "var(--sidebar)",
          color: "var(--muted)",
          border: "1px solid var(--border)",
        }}
      >
        Cancelar
      </button>
      <button
        onClick={onSave}
        className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
        style={{ background: "var(--accent)" }}
      >
        {saveLabel ?? (isEdit ? "Guardar" : "Crear")}
      </button>
    </div>
  );
}
