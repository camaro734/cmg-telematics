"use client";

import { useEffect, useState } from "react";
import {
  admin,
  variableMaps,
  type VehicleAdminOut,
  type TenantOut,
  type VariableMapOut,
} from "@/lib/api";
import Modal from "@/components/Modal";

const DATA_TYPES = ["gauge", "counter", "boolean", "hours"] as const;
type DataType = (typeof DATA_TYPES)[number];

interface VariableForm {
  io_key: string;
  display_name: string;
  unit: string;
  scale_factor: string;
  offset: string;
  alert_low: string;
  alert_high: string;
  data_type: DataType;
}

const emptyForm = (): VariableForm => ({
  io_key: "",
  display_name: "",
  unit: "",
  scale_factor: "1",
  offset: "0",
  alert_low: "",
  alert_high: "",
  data_type: "gauge",
});

// ─── Shared form modal ────────────────────────────────────────────────────────

function VariableModal({
  title,
  subtitle,
  editing,
  form,
  setForm,
  onSave,
  onClose,
  error,
}: {
  title: string;
  subtitle: string;
  editing: VariableMapOut | null;
  form: VariableForm;
  setForm: React.Dispatch<React.SetStateAction<VariableForm>>;
  onSave: () => void;
  onClose: () => void;
  error: string;
}) {
  return (
    <Modal
      title={editing ? `Editar: ${editing.display_name}` : title}
      onClose={onClose}
    >
      <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        {subtitle}
      </p>
      <div className="space-y-4">
        <Field label="IO Key (p. ej. ain1_mv, io_300, dout1)">
          <input
            value={form.io_key}
            onChange={(e) => setForm((f) => ({ ...f, io_key: e.target.value }))}
            placeholder="ain1_mv"
            className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          />
        </Field>
        <Field label="Nombre para mostrar">
          <input
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="Presión hidráulica"
            className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          />
        </Field>
        <Field label="Unidad (opcional)">
          <input
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            placeholder="bar"
            className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Factor escala">
            <input
              type="number"
              step="any"
              value={form.scale_factor}
              onChange={(e) => setForm((f) => ({ ...f, scale_factor: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
            />
          </Field>
          <Field label="Offset">
            <input
              type="number"
              step="any"
              value={form.offset}
              onChange={(e) => setForm((f) => ({ ...f, offset: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Alerta mín">
            <input
              type="number"
              step="any"
              value={form.alert_low}
              onChange={(e) => setForm((f) => ({ ...f, alert_low: e.target.value }))}
              placeholder="—"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
            />
          </Field>
          <Field label="Alerta máx">
            <input
              type="number"
              step="any"
              value={form.alert_high}
              onChange={(e) => setForm((f) => ({ ...f, alert_high: e.target.value }))}
              placeholder="—"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
            />
          </Field>
        </div>
        <Field label="Tipo de dato">
          <select
            value={form.data_type}
            onChange={(e) =>
              setForm((f) => ({ ...f, data_type: e.target.value as DataType }))
            }
            className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          >
            {DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <div
            className="text-xs px-3 py-2 rounded-lg"
            style={{ background: "#450a0a", color: "#fca5a5" }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-2">
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
            {editing ? "Guardar cambios" : "Crear"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Variables table ──────────────────────────────────────────────────────────

function VariablesTable({
  variables,
  onEdit,
  onDelete,
  emptyMsg,
}: {
  variables: VariableMapOut[];
  onEdit: (v: VariableMapOut) => void;
  onDelete: (v: VariableMapOut) => void;
  emptyMsg: string;
}) {
  if (variables.length === 0) {
    return (
      <div
        className="rounded-xl py-10 text-center text-sm"
        style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
      >
        {emptyMsg}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-x-auto"
      style={{ border: "1px solid var(--border)" }}
    >
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr
            style={{
              background: "var(--card)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {[
              "IO Key",
              "Nombre",
              "Unidad",
              "Escala",
              "Offset",
              "Min alerta",
              "Máx alerta",
              "Tipo",
              "",
            ].map((h) => (
              <th
                key={h}
                className="text-left px-4 py-3 text-xs font-semibold"
                style={{ color: "var(--muted)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variables.map((v, i) => (
            <tr
              key={v.id}
              style={{
                background:
                  i % 2 === 0 ? "var(--card)" : "rgba(30,33,48,0.5)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <td
                className="px-4 py-3 font-mono text-xs"
                style={{ color: "var(--muted)" }}
              >
                {v.io_key}
              </td>
              <td className="px-4 py-3 font-medium text-white">
                {v.display_name}
              </td>
              <td
                className="px-4 py-3 text-xs"
                style={{ color: "var(--muted)" }}
              >
                {v.unit ?? "—"}
              </td>
              <td
                className="px-4 py-3 text-xs"
                style={{ color: "var(--muted)" }}
              >
                {v.scale_factor}
              </td>
              <td
                className="px-4 py-3 text-xs"
                style={{ color: "var(--muted)" }}
              >
                {v.offset}
              </td>
              <td
                className="px-4 py-3 text-xs"
                style={{ color: "var(--muted)" }}
              >
                {v.alert_low != null ? v.alert_low : "—"}
              </td>
              <td
                className="px-4 py-3 text-xs"
                style={{ color: "var(--muted)" }}
              >
                {v.alert_high != null ? v.alert_high : "—"}
              </td>
              <td className="px-4 py-3">
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(59,130,246,0.1)",
                    color: "#60a5fa",
                  }}
                >
                  {v.data_type}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => onEdit(v)}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: "var(--sidebar)",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onDelete(v)}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: "rgba(239,68,68,0.1)",
                      color: "var(--danger)",
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminVariableMapsPage() {
  const [activeTab, setActiveTab] = useState<"templates" | "overrides">(
    "templates"
  );
  const [vehicles, setVehicles] = useState<VehicleAdminOut[]>([]);
  const [tenants, setTenants] = useState<TenantOut[]>([]);
  const [loading, setLoading] = useState(true);

  // Template tab
  const [selectedManufacturerId, setSelectedManufacturerId] = useState("");
  const [templates, setTemplates] = useState<VariableMapOut[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Override tab
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [overrides, setOverrides] = useState<VariableMapOut[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VariableMapOut | null>(null);
  const [form, setForm] = useState<VariableForm>(emptyForm());
  const [modalError, setModalError] = useState("");

  // Load tenants + vehicles on mount
  useEffect(() => {
    Promise.all([admin.listTenants(), admin.listVehicles()])
      .then(([t, v]) => {
        setTenants(t);
        setVehicles(v);
        const manufacturers = t.filter((x) => x.type === "manufacturer");
        if (manufacturers.length > 0) {
          setSelectedManufacturerId(manufacturers[0].id);
        }
        if (v.length > 0) {
          setSelectedVehicleId(v[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Load templates when manufacturer changes
  useEffect(() => {
    if (!selectedManufacturerId) return;
    setLoadingTemplates(true);
    variableMaps
      .list({ tenant_id: selectedManufacturerId })
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [selectedManufacturerId]);

  // Load overrides when vehicle changes
  useEffect(() => {
    if (!selectedVehicleId) return;
    setLoadingOverrides(true);
    variableMaps
      .list({ vehicle_id: selectedVehicleId })
      .then(setOverrides)
      .catch(() => setOverrides([]))
      .finally(() => setLoadingOverrides(false));
  }, [selectedVehicleId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setModalError("");
    setShowModal(true);
  }

  function openEdit(v: VariableMapOut) {
    setEditing(v);
    setForm({
      io_key: v.io_key,
      display_name: v.display_name,
      unit: v.unit ?? "",
      scale_factor: String(v.scale_factor),
      offset: String(v.offset),
      alert_low: v.alert_low != null ? String(v.alert_low) : "",
      alert_high: v.alert_high != null ? String(v.alert_high) : "",
      data_type: v.data_type as DataType,
    });
    setModalError("");
    setShowModal(true);
  }

  async function handleSave() {
    setModalError("");
    try {
      const payload = {
        io_key: form.io_key,
        display_name: form.display_name,
        unit: form.unit || undefined,
        scale_factor: parseFloat(form.scale_factor) || 1.0,
        offset: parseFloat(form.offset) || 0.0,
        alert_low: form.alert_low !== "" ? parseFloat(form.alert_low) : null,
        alert_high: form.alert_high !== "" ? parseFloat(form.alert_high) : null,
        data_type: form.data_type,
      };

      if (editing) {
        await variableMaps.update(editing.id, payload);
      } else if (activeTab === "templates") {
        await variableMaps.create({ tenant_id: selectedManufacturerId, ...payload });
      } else {
        await variableMaps.create({ vehicle_id: selectedVehicleId, ...payload });
      }

      setShowModal(false);

      // Refresh the correct list
      if (activeTab === "templates") {
        const updated = await variableMaps.list({ tenant_id: selectedManufacturerId });
        setTemplates(updated);
      } else {
        const updated = await variableMaps.list({ vehicle_id: selectedVehicleId });
        setOverrides(updated);
      }
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "Error al guardar");
    }
  }

  async function handleDelete(v: VariableMapOut) {
    try {
      await variableMaps.delete(v.id);
      if (activeTab === "templates" && selectedManufacturerId) {
        const updated = await variableMaps.list({ tenant_id: selectedManufacturerId });
        setTemplates(updated);
      } else if (activeTab === "overrides" && selectedVehicleId) {
        const updated = await variableMaps.list({ vehicle_id: selectedVehicleId });
        setOverrides(updated);
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  const manufacturers = tenants.filter((t) => t.type === "manufacturer");
  const selectedManufacturer = manufacturers.find(
    (t) => t.id === selectedManufacturerId
  );
  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  // Group vehicles by manufacturer for the override selector
  const vehiclesByManufacturer: Record<string, VehicleAdminOut[]> = {};
  for (const v of vehicles) {
    const mfr = v.manufacturer_name || "Sin fabricante";
    if (!vehiclesByManufacturer[mfr]) vehiclesByManufacturer[mfr] = [];
    vehiclesByManufacturer[mfr].push(v);
  }

  return (
    <div className="px-4 py-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-white">Variables IO</h1>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          Configura las claves IO: nombres, unidades, factores de escala y alertas.
          Las plantillas de fabricante se heredan en todos sus vehículos.
          Las excepciones por vehículo anulan la plantilla para ese vehículo concreto.
        </p>
      </div>

      {/* Tab bar */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)", display: "inline-flex" }}
      >
        <button
          onClick={() => setActiveTab("templates")}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={
            activeTab === "templates"
              ? { background: "var(--accent)", color: "#fff" }
              : { color: "var(--muted)" }
          }
        >
          Plantillas de fabricante
        </button>
        <button
          onClick={() => setActiveTab("overrides")}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={
            activeTab === "overrides"
              ? { background: "var(--accent)", color: "#fff" }
              : { color: "var(--muted)" }
          }
        >
          Excepciones por vehículo
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl animate-pulse"
              style={{ background: "var(--card)" }}
            />
          ))}
        </div>
      ) : activeTab === "templates" ? (
        // ─── TEMPLATES TAB ─────────────────────────────────────────────────
        <div>
          {/* Info box */}
          <div
            className="flex gap-3 items-start p-4 rounded-xl mb-5"
            style={{ background: "rgba(29,158,117,0.08)", border: "1px solid rgba(29,158,117,0.2)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-xs leading-relaxed" style={{ color: "var(--accent)" }}>
              Las plantillas se aplican a <strong>todos los vehículos</strong> de ese fabricante automáticamente.
              Configura aquí las variables IO estándar de tus modelos de máquina.
            </p>
          </div>

          {/* Manufacturer selector + add button */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[200px]">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--muted)" }}
              >
                Fabricante
              </label>
              {manufacturers.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  No hay fabricantes disponibles
                </p>
              ) : (
                <select
                  value={selectedManufacturerId}
                  onChange={(e) => setSelectedManufacturerId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {manufacturers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={openCreate}
              disabled={!selectedManufacturerId}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
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
              Nueva plantilla
            </button>
          </div>

          {/* Template count badge */}
          {selectedManufacturer && (
            <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
              {selectedManufacturer.name} ·{" "}
              <span className="text-white">{templates.length}</span> variable
              {templates.length !== 1 ? "s" : ""} configurada
              {templates.length !== 1 ? "s" : ""}
            </p>
          )}

          {loadingTemplates ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg animate-pulse"
                  style={{ background: "var(--card)" }}
                />
              ))}
            </div>
          ) : (
            <VariablesTable
              variables={templates}
              onEdit={(v) => { setActiveTab("templates"); openEdit(v); }}
              onDelete={handleDelete}
              emptyMsg={
                selectedManufacturerId
                  ? "No hay plantillas para este fabricante. Añade la primera variable IO."
                  : "Selecciona un fabricante"
              }
            />
          )}
        </div>
      ) : (
        // ─── OVERRIDES TAB ────────────────────────────────────────────────
        <div>
          {/* Info box */}
          <div
            className="flex gap-3 items-start p-4 rounded-xl mb-5"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 mt-0.5" style={{ color: "var(--warning)" }}>
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-xs leading-relaxed" style={{ color: "var(--warning)" }}>
              Las excepciones <strong>anulan</strong> la plantilla del fabricante para un vehículo concreto.
              Úsalas sólo cuando un vehículo tenga una configuración diferente al resto de su flota.
            </p>
          </div>

          {/* Vehicle selector + add button */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[240px]">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--muted)" }}
              >
                Vehículo
              </label>
              {vehicles.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  No hay vehículos disponibles
                </p>
              ) : (
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {Object.entries(vehiclesByManufacturer).map(
                    ([mfrName, mfrVehicles]) => (
                      <optgroup key={mfrName} label={mfrName}>
                        {mfrVehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.tenant_name ? ` — ${v.tenant_name}` : ""}
                            {v.license_plate ? ` (${v.license_plate})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )
                  )}
                </select>
              )}
            </div>
            <button
              onClick={openCreate}
              disabled={!selectedVehicleId}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--warning)", filter: "brightness(0.9)" }}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Nueva excepción
            </button>
          </div>

          {/* Vehicle context */}
          {selectedVehicle && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)" }}>
                <rect x="1" y="3" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M16 8h4l3 3v5h-7V8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx="5.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="18.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {selectedVehicle.name}
                  {selectedVehicle.license_plate && (
                    <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>
                      {selectedVehicle.license_plate}
                    </span>
                  )}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {[selectedVehicle.manufacturer_name, selectedVehicle.tenant_name]
                    .filter(Boolean)
                    .join(" → ")}
                  {selectedVehicle.device_imei && (
                    <span className="ml-2 font-mono">IMEI: {selectedVehicle.device_imei}</span>
                  )}
                </p>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(245,158,11,0.1)",
                  color: "var(--warning)",
                }}
              >
                {overrides.length} excepción{overrides.length !== 1 ? "es" : ""}
              </span>
            </div>
          )}

          {loadingOverrides ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg animate-pulse"
                  style={{ background: "var(--card)" }}
                />
              ))}
            </div>
          ) : (
            <VariablesTable
              variables={overrides}
              onEdit={(v) => { setActiveTab("overrides"); openEdit(v); }}
              onDelete={handleDelete}
              emptyMsg={
                selectedVehicleId
                  ? "Sin excepciones para este vehículo. Hereda la plantilla del fabricante."
                  : "Selecciona un vehículo"
              }
            />
          )}
        </div>
      )}

      {showModal && (
        <VariableModal
          title={
            activeTab === "templates"
              ? `Nueva plantilla — ${selectedManufacturer?.name ?? ""}`
              : `Nueva excepción — ${selectedVehicle?.name ?? ""}`
          }
          subtitle={
            activeTab === "templates"
              ? `Se aplicará a todos los vehículos de ${selectedManufacturer?.name ?? "este fabricante"}`
              : `Anulará la plantilla del fabricante para ${selectedVehicle?.name ?? "este vehículo"}`
          }
          editing={editing}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
          error={modalError}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
