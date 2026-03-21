"use client";

import { useEffect, useState } from "react";
import { admin, type VehicleAdminOut, type TenantOut } from "@/lib/api";
import Modal from "@/components/Modal";

export default function AdminVehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleAdminOut[]>([]);
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VehicleAdminOut | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", license_plate: "", tenant_id: "", imei: "",
  });

  async function load() {
    const [v, t] = await Promise.all([admin.listVehicles(), admin.listTenants()]);
    setVehicles(v);
    setTenants(t);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    const firstClient = tenants.find(t => t.type === "end_client");
    setForm({ name: "", license_plate: "", tenant_id: firstClient?.id ?? "", imei: "" });
    setShowModal(true);
    setError("");
  }

  function openEdit(v: VehicleAdminOut) {
    setEditing(v);
    setForm({ name: v.name, license_plate: v.license_plate ?? "", tenant_id: v.tenant_id, imei: v.device_imei ?? "" });
    setShowModal(true);
    setError("");
  }

  async function handleSave() {
    setError("");
    try {
      if (editing) {
        await admin.updateVehicle(editing.id, {
          name: form.name,
          license_plate: form.license_plate || null,
        });
      } else {
        await admin.createVehicle({
          name: form.name,
          license_plate: form.license_plate || undefined,
          tenant_id: form.tenant_id,
          imei: form.imei || undefined,
        });
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function toggleActive(v: VehicleAdminOut) {
    await admin.updateVehicle(v.id, { active: false });
    await load();
  }

  const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]));

  return (
    <div className="px-6 py-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white">Vehículos y Dispositivos</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Alta de vehículos y asignación de dispositivos FMC650
          </p>
        </div>
        <button onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Nuevo vehículo
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--card)" }} />)}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Vehículo", "Matrícula", "Cliente", "IMEI FMC650", "Estado", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold"
                      style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, i) => (
                <tr key={v.id}
                    style={{
                      background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                      borderBottom: "1px solid var(--border)",
                    }}>
                  <td className="px-4 py-3 font-medium text-white">{v.name}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {v.license_plate ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {tenantMap[v.tenant_id] ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {v.device_imei ? (
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full"
                             style={{ background: v.device_online ? "var(--success)" : "var(--muted)" }} />
                        <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                          {v.device_imei}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>Sin dispositivo</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: v.device_online ? "rgba(34,197,94,0.1)" : "rgba(100,116,139,0.1)",
                            color: v.device_online ? "var(--success)" : "var(--muted)",
                          }}>
                      {v.device_online ? "En línea" : "Offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(v)}
                              className="text-xs px-2 py-1 rounded"
                              style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                        Editar
                      </button>
                      <button onClick={() => toggleActive(v)}
                              className="text-xs px-2 py-1 rounded"
                              style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)" }}>
                        Dar de baja
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vehicles.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: "var(--muted)" }}>
              No hay vehículos registrados
            </div>
          )}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? `Editar: ${editing.name}` : "Nuevo vehículo"} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="Nombre del vehículo">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                     placeholder="Ej: Camión Vacío #001"
                     className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }} />
            </Field>
            <Field label="Matrícula (opcional)">
              <input value={form.license_plate} onChange={e => setForm(f => ({ ...f, license_plate: e.target.value }))}
                     placeholder="1234 ABC"
                     className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                     style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }} />
            </Field>
            {!editing && (
              <>
                <Field label="Cliente">
                  <select value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                          style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}>
                    {tenants.filter(t => t.active && t.type === "end_client").map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="IMEI FMC650 (opcional, 15 dígitos)">
                  <input value={form.imei} onChange={e => setForm(f => ({ ...f, imei: e.target.value }))}
                         placeholder="352000000000001"
                         maxLength={15}
                         className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white"
                         style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }} />
                  <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                    Se puede asignar después. El IMEI está en la etiqueta del dispositivo.
                  </p>
                </Field>
              </>
            )}

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
                {editing ? "Guardar" : "Crear vehículo"}
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
