"use client";

import { useEffect, useState } from "react";
import { admin, type TenantOut } from "@/lib/api";
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

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TenantOut | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ name: "", type: "end_client", parent_id: "" });

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
    setForm({ name: "", type: "end_client", parent_id: "" });
    setShowModal(true);
  }

  function openEdit(t: TenantOut) {
    setEditing(t);
    setForm({ name: t.name, type: t.type, parent_id: t.parent_id ?? "" });
    setShowModal(true);
  }

  async function handleSave() {
    setError("");
    try {
      if (editing) {
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
  const byParent: Record<string, TenantOut[]> = {};
  tenants.forEach(t => {
    const key = t.parent_id ?? "root";
    (byParent[key] ??= []).push(t);
  });

  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const key = parentId ?? "root";
    const children = byParent[key] ?? [];
    return children.map(t => (
      <div key={t.id}>
        <div
          className="flex items-center justify-between px-4 py-3 rounded-lg mb-1"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            marginLeft: depth * 24,
            opacity: t.active ? 1 : 0.5,
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full flex-shrink-0"
                 style={{ background: TYPE_COLORS[t.type] ?? "var(--muted)" }} />
            <div>
              <span className="text-sm font-medium text-white">{t.name}</span>
              <span className="text-xs ml-2 px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.07)", color: "var(--muted)" }}>
                {TYPE_LABELS[t.type] ?? t.type}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => openEdit(t)}
                    className="text-xs px-3 py-1 rounded-lg transition-colors"
                    style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
              Editar
            </button>
            {t.type !== "cmg" && (
              <button onClick={() => toggleActive(t)}
                      className="text-xs px-3 py-1 rounded-lg transition-colors"
                      style={{
                        background: t.active ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                        color: t.active ? "var(--danger)" : "var(--success)",
                        border: `1px solid ${t.active ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                      }}>
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
    <div className="px-6 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white">Clientes y Fabricantes</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Jerarquía de organizaciones: CMG → Fabricante → Cliente Final
          </p>
        </div>
        <button onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Nuevo
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-4">
        {Object.entries(TYPE_LABELS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[k] }} />
            {v}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />
          ))}
        </div>
      ) : (
        <div>{renderTree(null, 0)}</div>
      )}

      {showModal && (
        <Modal title={editing ? "Editar organización" : "Nueva organización"} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="Nombre">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                     className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
                     placeholder="Nombre de la organización" />
            </Field>

            {!editing && (
              <>
                <Field label="Tipo">
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                          style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                    <option value="manufacturer">Fabricante</option>
                    <option value="end_client">Cliente Final</option>
                  </select>
                </Field>
                <Field label="Depende de">
                  <select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                          style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                    <option value="">— Raíz (CMG) —</option>
                    {tenants.filter(t => t.active).map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({TYPE_LABELS[t.type]})</option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)}
                      className="flex-1 py-2.5 rounded-lg text-sm"
                      style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                Cancelar
              </button>
              <button onClick={handleSave}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                      style={{ background: "var(--accent)" }}>
                {editing ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>{label}</label>
      {children}
    </div>
  );
}
