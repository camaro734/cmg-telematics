"use client";

import { useEffect, useState, useMemo } from "react";
import { admin, type VehicleAdminOut, type TenantOut } from "@/lib/api";
import Modal from "@/components/Modal";

// ─── helpers ─────────────────────────────────────────────────────────────────

function getSubtree(all: TenantOut[], rootId: string): Set<string> {
  const byParent: Record<string, string[]> = {};
  for (const t of all) {
    if (t.parent_id) (byParent[t.parent_id] ??= []).push(t.id);
  }
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.pop()!;
    visited.add(id);
    for (const child of byParent[id] ?? []) queue.push(child);
  }
  return visited;
}

/** True if the vehicle is still in manufacturer stock (tenant == manufacturer) */
function isStock(v: VehicleAdminOut) {
  return v.manufacturer_id && v.tenant_id === v.manufacturer_id;
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function AdminVehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleAdminOut[]>([]);
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VehicleAdminOut | null>(null);
  const [error, setError] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState("");

  const [form, setForm] = useState({
    manufacturer_id: "",
    tenant_id: "",        // "" = stock del fabricante
    name: "",
    license_plate: "",
    imei: "",
  });

  const userRole = useMemo(() => {
    if (typeof window === "undefined") return "";
    try { return JSON.parse(localStorage.getItem("cmg_user") ?? "{}").role ?? ""; }
    catch { return ""; }
  }, []);

  const manufacturers = useMemo(
    () => tenants.filter(t => t.type === "manufacturer" && t.active),
    [tenants]
  );

  const clients = useMemo(
    () => tenants.filter(t => t.type === "end_client" && t.active),
    [tenants]
  );

  // Clients available in the form, filtered by selected manufacturer
  const formClients = useMemo(() => {
    if (!form.manufacturer_id) return clients;
    const subtree = getSubtree(tenants, form.manufacturer_id);
    return clients.filter(c => subtree.has(c.id));
  }, [clients, tenants, form.manufacturer_id]);

  // Vehicles shown in table, filtered by selected manufacturer
  const filteredVehicles = useMemo(() => {
    if (!filterManufacturer) return vehicles;
    return vehicles.filter(v => v.manufacturer_id === filterManufacturer);
  }, [vehicles, filterManufacturer]);

  async function load() {
    const [v, t] = await Promise.all([admin.listVehicles(), admin.listTenants()]);
    setVehicles(v);
    setTenants(t);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    const firstMfr = manufacturers[0];
    setForm({
      manufacturer_id: firstMfr?.id ?? "",
      tenant_id: "",    // default: stock del fabricante
      name: "",
      license_plate: "",
      imei: "",
    });
    setError("");
    setShowModal(true);
  }

  function openEdit(v: VehicleAdminOut) {
    setEditing(v);
    // If tenant == manufacturer it's stock — show as "" (sin cliente)
    const clientId = isStock(v) ? "" : v.tenant_id;
    setForm({
      manufacturer_id: v.manufacturer_id ?? "",
      tenant_id: clientId,
      name: v.name,
      license_plate: v.license_plate ?? "",
      imei: v.device_imei ?? "",
    });
    setError("");
    setShowModal(true);
  }

  function onFormManufacturerChange(mfrId: string) {
    setForm(f => ({ ...f, manufacturer_id: mfrId, tenant_id: "" }));
  }

  async function handleSave() {
    setError("");
    try {
      if (editing) {
        // Determine effective tenant_id:
        // "" means keep as manufacturer stock, set to manufacturer_id
        const effectiveTenantId = form.tenant_id || editing.manufacturer_id || undefined;
        await admin.updateVehicle(editing.id, {
          name: form.name,
          license_plate: form.license_plate || null,
          imei: form.imei || "",
          tenant_id: effectiveTenantId,
        });
      } else {
        await admin.createVehicle({
          name: form.name,
          license_plate: form.license_plate || undefined,
          // tenant_id absent = backend defaults to manufacturer_id (stock)
          tenant_id: form.tenant_id || undefined,
          manufacturer_id: form.manufacturer_id || undefined,
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
    if (!confirm(`¿Dar de baja "${v.name}"? El vehículo dejará de aparecer en la flota.`)) return;
    await admin.updateVehicle(v.id, { active: false });
    await load();
  }

  return (
    <div className="px-6 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white">Vehículos y Dispositivos</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Alta de vehículos, asignación de dispositivos FMC650 y traspaso a clientes
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Nuevo vehículo
        </button>
      </div>

      {/* Filter bar */}
      {manufacturers.length > 1 && (
        <div className="flex items-center gap-3 mb-4">
          <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>Fabricante:</label>
          <select
            value={filterManufacturer}
            onChange={e => setFilterManufacturer(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-sm text-white"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <option value="">Todos</option>
            {manufacturers.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {filteredVehicles.length} vehículo{filteredVehicles.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Table */}
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
                {["Vehículo / Matrícula", "Fabricante", "Cliente", "IMEI FMC650", "Estado", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold"
                      style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((v, i) => (
                <tr
                  key={v.id}
                  style={{
                    background: i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{v.name}</div>
                    {v.license_plate && (
                      <div className="text-xs mt-0.5 font-mono" style={{ color: "var(--muted)" }}>
                        {v.license_plate}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {v.manufacturer_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {isStock(v) ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                        Stock fabricante
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {v.tenant_name || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {v.device_imei ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: v.device_online ? "var(--success)" : "var(--muted)" }}
                        />
                        <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                          {v.device_imei}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>Sin dispositivo</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: v.device_online
                          ? "rgba(34,197,94,0.1)" : "rgba(100,116,139,0.1)",
                        color: v.device_online ? "var(--success)" : "var(--muted)",
                      }}
                    >
                      {v.device_online ? "En línea" : "Offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(v)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleActive(v)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)" }}
                      >
                        Baja
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredVehicles.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: "var(--muted)" }}>
              {vehicles.length === 0 ? "No hay vehículos registrados" : "No hay vehículos para el fabricante seleccionado"}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <Modal
          title={editing ? `Editar: ${editing.name}` : "Nuevo vehículo"}
          onClose={() => setShowModal(false)}
        >
          <div className="space-y-4">
            {/* Manufacturer selector */}
            {(!editing || userRole === "superadmin") && manufacturers.length > 0 && (
              <Field label="Fabricante">
                <select
                  value={form.manufacturer_id}
                  onChange={e => onFormManufacturerChange(e.target.value)}
                  disabled={!!editing}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                  style={{ background: "var(--sidebar)", border: "1px solid var(--border)", opacity: editing ? 0.6 : 1 }}
                >
                  {manufacturers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </Field>
            )}

            {/* Client selector — optional, with "Stock fabricante" as first option */}
            <Field label="Cliente (opcional)">
              <select
                value={form.tenant_id}
                onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              >
                <option value="">— Stock del fabricante (sin cliente asignado) —</option>
                {formClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                {form.tenant_id
                  ? "El vehículo pertenecerá a este cliente."
                  : "El vehículo quedará en stock del fabricante hasta que se asigne a un cliente."}
              </p>
            </Field>

            <Field label="Nombre del vehículo">
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Camión Volquete #001"
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              />
            </Field>

            <Field label="Matrícula (opcional)">
              <input
                value={form.license_plate}
                onChange={e => setForm(f => ({ ...f, license_plate: e.target.value }))}
                placeholder="1234 ABC"
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              />
            </Field>

            <Field label={editing ? "IMEI FMC650 (dejar vacío para desasignar)" : "IMEI FMC650 (opcional, 15 dígitos)"}>
              <input
                value={form.imei}
                onChange={e => setForm(f => ({ ...f, imei: e.target.value.replace(/\D/g, "").slice(0, 15) }))}
                placeholder="352000000000001"
                maxLength={15}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white"
                style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  El IMEI está en la etiqueta del dispositivo FMC650.
                </p>
                <span className="text-xs font-mono"
                      style={{ color: form.imei.length === 15 ? "var(--success)" : "var(--muted)" }}>
                  {form.imei.length}/15
                </span>
              </div>
            </Field>

            {/* Transfer info when editing */}
            {editing && (
              <div className="rounded-lg px-3 py-2.5 text-xs"
                   style={{ background: "rgba(29,158,117,0.08)", border: "1px solid rgba(29,158,117,0.2)" }}>
                <div className="font-medium mb-1" style={{ color: "var(--accent)" }}>Traspaso de vehículo</div>
                <div style={{ color: "var(--muted)" }}>
                  {isStock(editing)
                    ? "Actualmente en stock del fabricante. Selecciona un cliente para traspasarlo."
                    : `Actualmente asignado a: ${editing.tenant_name}. Selecciona "Stock del fabricante" para devolverlo al fabricante.`}
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm"
                style={{ background: "var(--sidebar)", color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                {editing ? "Guardar cambios" : "Crear vehículo"}
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
