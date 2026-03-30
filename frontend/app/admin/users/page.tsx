"use client";

import { useEffect, useState, useMemo } from "react";
import { admin, type UserOut, type TenantOut } from "@/lib/api";
import Modal from "@/components/Modal";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super Admin",
  admin: "Admin",
  operator: "Operador",
  viewer: "Visualizador",
  driver: "Conductor",
};

const ROLE_COLORS: Record<string, string> = {
  superadmin: "#ef4444",
  admin: "#f59e0b",
  operator: "#3b82f6",
  viewer: "#64748b",
  driver: "#22c55e",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserOut[]>([]);
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [loading, setLoading] = useState(true);

  const currentUserRole = useMemo(() => {
    if (typeof window === "undefined") return "";
    try { return JSON.parse(localStorage.getItem("cmg_user") ?? "{}").role ?? ""; }
    catch { return ""; }
  }, []);

  // Roles creables según el rol del usuario actual
  const creatableRoles = useMemo(() => {
    if (currentUserRole === "superadmin") return ["admin", "operator", "viewer", "driver"];
    return ["operator", "viewer", "driver"]; // admin no puede crear otros admins
  }, [currentUserRole]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<UserOut | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    email: "", password: "", full_name: "",
    role: "viewer", tenant_id: "",
  });

  async function load() {
    const [u, t] = await Promise.all([admin.listUsers(), admin.listTenants()]);
    setUsers(u);
    setTenants(t);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ email: "", password: "", full_name: "", role: creatableRoles[creatableRoles.length - 2] ?? "viewer", tenant_id: tenants[0]?.id ?? "" });
    setShowModal(true);
    setError("");
  }

  function openEdit(u: UserOut) {
    setEditing(u);
    setForm({ email: u.email, password: "", full_name: u.full_name, role: u.role, tenant_id: u.tenant_id });
    setShowModal(true);
    setError("");
  }

  async function handleSave() {
    setError("");
    try {
      if (editing) {
        await admin.updateUser(editing.id, {
          full_name: form.full_name,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        await admin.createUser({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          role: form.role,
          tenant_id: form.tenant_id,
        });
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function toggleActive(u: UserOut) {
    await admin.updateUser(u.id, { active: !u.active });
    await load();
  }

  const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]));
  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="px-6 py-6 max-w-none w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white">Usuarios</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Gestión de acceso y roles
          </p>
        </div>
        <button onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Nuevo usuario
        </button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por nombre o email..."
        className="w-full px-4 py-2.5 rounded-lg text-sm text-white mb-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      />

      {/* Role legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {Object.entries(ROLE_LABELS).filter(([k]) => k !== "superadmin").map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[k] }} />
            {v}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />)}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Nombre", "Email", "Rol", "Organización", "Estado", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold"
                      style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id}
                    style={{
                      background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                      borderBottom: "1px solid var(--border)",
                      opacity: u.active ? 1 : 0.5,
                    }}>
                  <td className="px-4 py-3 font-medium text-white">{u.full_name}</td>
                  <td className="px-4 py-3" style={{ color: "var(--muted)" }}>{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: `${ROLE_COLORS[u.role] ?? "#64748b"}22`,
                            color: ROLE_COLORS[u.role] ?? "var(--muted)",
                          }}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {tenantMap[u.tenant_id] ?? u.tenant_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: u.active ? "rgba(34,197,94,0.1)" : "rgba(100,116,139,0.1)",
                            color: u.active ? "var(--success)" : "var(--muted)",
                          }}>
                      {u.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(u)}
                              className="text-xs px-2 py-1 rounded"
                              style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                        Editar
                      </button>
                      {u.role !== "superadmin" && (
                        <button onClick={() => toggleActive(u)}
                                className="text-xs px-2 py-1 rounded"
                                style={{
                                  background: u.active ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                                  color: u.active ? "var(--danger)" : "var(--success)",
                                }}>
                          {u.active ? "Desactivar" : "Activar"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: "var(--muted)" }}>
              No se encontraron usuarios
            </div>
          )}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? `Editar: ${editing.full_name}` : "Nuevo usuario"} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="Nombre completo">
              <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                     className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }} />
            </Field>
            {!editing && (
              <Field label="Email">
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                       className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                       style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }} />
              </Field>
            )}
            <Field label={editing ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña"}>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                     className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }} />
            </Field>
            <Field label="Rol">
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                      style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                {creatableRoles.map(k => (
                  <option key={k} value={k}>{ROLE_LABELS[k] ?? k}</option>
                ))}
              </select>
            </Field>
            {!editing && (
              <Field label="Organización">
                <select value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                        style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                  {tenants.filter(t => t.active && t.type !== "cmg").map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </Field>
            )}

            {/* Role description */}
            <div className="rounded-lg p-3 text-xs" style={{ background: "var(--sidebar)", color: "var(--muted)" }}>
              <strong style={{ color: "white" }}>Permisos por rol:</strong>
              <ul className="mt-1 space-y-0.5">
                <li>Admin — gestión completa de su subtree</li>
                <li>Operador — enviar comandos + ver telemetría</li>
                <li>Visualizador — solo lectura de telemetría</li>
                <li>Conductor — solo su propio vehículo</li>
              </ul>
            </div>

            {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>{error}</div>}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)}
                      className="flex-1 py-2.5 rounded-lg text-sm"
                      style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                Cancelar
              </button>
              <button onClick={handleSave}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                      style={{ background: "var(--accent)" }}>
                {editing ? "Guardar" : "Crear usuario"}
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
