"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

// ─── IO Key catalogue ─────────────────────────────────────────────────────────
interface IoOption { value: string; label: string; }
interface IoGroup  { group: string; options: IoOption[]; }

const IO_KEY_GROUPS: IoGroup[] = [
  {
    group: "Columnas estándar (telemetría directa)",
    options: [
      { value: "ignition",        label: "ignition — Ignición (IO 239)" },
      { value: "movement",        label: "movement — Movimiento (IO 240)" },
      { value: "speed",           label: "speed — Velocidad km/h (IO 24)" },
      { value: "ext_voltage_mv",  label: "ext_voltage_mv — Tensión externa mV (IO 66)" },
      { value: "battery_mv",      label: "battery_mv — Batería interna mV (IO 67)" },
      { value: "battery_current", label: "battery_current — Corriente batería (IO 68)" },
      { value: "odometer_m",      label: "odometer_m — Odómetro metros (IO 16)" },
      { value: "gsm_signal",      label: "gsm_signal — Señal GSM (IO 21)" },
      { value: "rssi",            label: "rssi — RSSI radio (IO 22)" },
      { value: "sleep_mode",      label: "sleep_mode — Modo sleep (IO 200)" },
      { value: "din1",            label: "din1 — Entrada digital 1 (IO 1)" },
      { value: "din2",            label: "din2 — Entrada digital 2 (IO 2)" },
      { value: "din3",            label: "din3 — Entrada digital 3 (IO 3)" },
      { value: "din4",            label: "din4 — Entrada digital 4 (IO 4)" },
      { value: "dout1_status",    label: "dout1_status — Salida digital 1 (IO 179)" },
      { value: "dout2_status",    label: "dout2_status — Salida digital 2 (IO 180)" },
      { value: "dout3_status",    label: "dout3_status — Salida digital 3 (IO 181)" },
      { value: "dout4_status",    label: "dout4_status — Salida digital 4 (IO 182)" },
      { value: "analog_1_mv",     label: "analog_1_mv — AIN1 mV (IO 9)" },
      { value: "analog_2_mv",     label: "analog_2_mv — AIN2 mV (IO 10)" },
      { value: "analog_3_mv",     label: "analog_3_mv — AIN3 mV (IO 11)" },
      { value: "dallas_temp_1",   label: "dallas_temp_1 — Sonda Dallas 1 (IO 71)" },
    ],
  },
  {
    group: "Manual CAN — slots 00–09 (AVL 145–154)",
    options: Array.from({ length: 10 }, (_, i) => ({
      value: String(145 + i),
      label: `${145 + i} — Manual CAN slot ${String(i).padStart(2, "0")}`,
    })),
  },
  {
    group: "Manual CAN — slots 10–19 (AVL 380–389)",
    options: Array.from({ length: 10 }, (_, i) => ({
      value: String(380 + i),
      label: `${380 + i} — Manual CAN slot ${String(10 + i).padStart(2, "0")}`,
    })),
  },
  {
    group: "Manual CAN — slots 20–69 (AVL 10298–10347)",
    options: Array.from({ length: 50 }, (_, i) => ({
      value: String(10298 + i),
      label: `${10298 + i} — Manual CAN slot ${String(20 + i).padStart(2, "0")}`,
    })),
  },
];

const ALL_IO_VALUES = new Set(
  IO_KEY_GROUPS.flatMap(g => g.options.map(o => o.value))
);

// Auto display names for known IO keys
const IO_DEFAULT_NAMES: Record<string, string> = {
  ignition: "Ignición", movement: "Movimiento", speed: "Velocidad",
  ext_voltage_mv: "Tensión externa", battery_mv: "Batería interna",
  battery_current: "Corriente batería", odometer_m: "Odómetro",
  gsm_signal: "Señal GSM", rssi: "RSSI", sleep_mode: "Sleep mode",
  din1: "Entrada digital 1", din2: "Entrada digital 2",
  din3: "Entrada digital 3", din4: "Entrada digital 4",
  dout1_status: "Salida digital 1", dout2_status: "Salida digital 2",
  dout3_status: "Salida digital 3", dout4_status: "Salida digital 4",
  analog_1_mv: "AIN1 mV", analog_2_mv: "AIN2 mV", analog_3_mv: "AIN3 mV",
  dallas_temp_1: "Temperatura Dallas 1",
};
for (let i = 0; i < 10; i++) IO_DEFAULT_NAMES[String(145 + i)] = `Manual CAN slot ${String(i).padStart(2,"0")}`;
for (let i = 0; i < 10; i++) IO_DEFAULT_NAMES[String(380 + i)] = `Manual CAN slot ${String(10+i).padStart(2,"0")}`;
for (let i = 0; i < 50; i++) IO_DEFAULT_NAMES[String(10298 + i)] = `Manual CAN slot ${String(20+i).padStart(2,"0")}`;

type SignalType = "analog" | "digital";

interface VariableForm {
  io_key: string;
  display_name: string;
  unit: string;
  scale_factor: string;
  offset: string;
  alert_low: string;
  alert_high: string;
  data_type: DataType;
  signal_type: SignalType;
  bit_index: string;
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
  signal_type: "analog",
  bit_index: "0",
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
  // Determine if the current io_key is from the catalogue or custom
  const isCustom = form.io_key !== "" && !ALL_IO_VALUES.has(form.io_key);
  const selectValue = isCustom ? "__custom__" : form.io_key;

  function handleSelectChange(val: string) {
    if (val === "__custom__") {
      setForm(f => ({ ...f, io_key: "" }));
      return;
    }
    const autoName = IO_DEFAULT_NAMES[val] ?? "";
    setForm(f => ({
      ...f,
      io_key: val,
      display_name: f.display_name || autoName,
    }));
  }

  return (
    <Modal
      title={editing ? `Editar: ${editing.display_name}` : title}
      onClose={onClose}
    >
      <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        {subtitle}
      </p>
      <div className="space-y-4">
        <Field label="IO Key">
          <select
            value={selectValue}
            onChange={e => handleSelectChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
            style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
          >
            <option value="" disabled>— Selecciona un IO key —</option>
            {IO_KEY_GROUPS.map(grp => (
              <optgroup key={grp.group} label={grp.group}>
                {grp.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            ))}
            <option value="__custom__">✏ Personalizado (escribir manualmente)</option>
          </select>
          {(isCustom || selectValue === "__custom__") && (
            <input
              value={form.io_key}
              onChange={e => setForm(f => ({ ...f, io_key: e.target.value }))}
              placeholder="Escribe el IO key exacto"
              className="w-full mt-2 px-3 py-2.5 rounded-lg text-sm font-mono text-white"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
            />
          )}
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
        {/* Signal type selector */}
        <Field label="Tipo de señal">
          <div className="flex gap-2">
            {(["analog", "digital"] as SignalType[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    signal_type: st,
                    data_type: st === "digital" ? "boolean" : f.data_type,
                    bit_index: st === "digital" ? f.bit_index || "0" : "0",
                  }))
                }
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background:
                    form.signal_type === st
                      ? st === "digital"
                        ? "rgba(245,158,11,0.15)"
                        : "rgba(29,158,117,0.15)"
                      : "var(--sidebar)",
                  color:
                    form.signal_type === st
                      ? st === "digital"
                        ? "var(--warning)"
                        : "var(--accent)"
                      : "var(--muted)",
                  border: `1px solid ${
                    form.signal_type === st
                      ? st === "digital"
                        ? "var(--warning)"
                        : "var(--accent)"
                      : "var(--border)"
                  }`,
                }}
              >
                {st === "analog" ? "Analógico (valor completo)" : "Digital (bit)"}
              </button>
            ))}
          </div>
          {form.signal_type === "analog" && (
            <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
              Usa el valor raw completo → aplica escala y offset.
            </p>
          )}
          {form.signal_type === "digital" && (
            <p className="text-xs mt-1.5" style={{ color: "var(--warning)" }}>
              Extrae 1 bit del byte recibido. Ideal para bytes que empaquetan
              hasta 8 señales booleanas (bit 0 = LSB … bit 7 = MSB).
            </p>
          )}
        </Field>

        {/* Bit selector — only when digital */}
        {form.signal_type === "digital" && (
          <Field label="Bit a extraer (0 = LSB, 7 = MSB)">
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, bit_index: String(b) }))}
                  className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-colors"
                  style={{
                    background:
                      form.bit_index === String(b)
                        ? "rgba(245,158,11,0.2)"
                        : "var(--sidebar)",
                    color:
                      form.bit_index === String(b)
                        ? "var(--warning)"
                        : "var(--muted)",
                    border: `1px solid ${
                      form.bit_index === String(b)
                        ? "var(--warning)"
                        : "var(--border)"
                    }`,
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
              Bit {form.bit_index} → máscara 0x{(1 << parseInt(form.bit_index || "0")).toString(16).toUpperCase().padStart(2, "0")} = {(1 << parseInt(form.bit_index || "0")).toString(2).padStart(8, "0")}b
            </p>
          </Field>
        )}

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
      <table className="w-full text-sm min-w-[860px]">
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
              "Señal",
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
              <td className="px-4 py-3">
                {v.signal_type === "digital" ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-mono"
                    style={{
                      background: "rgba(245,158,11,0.12)",
                      color: "var(--warning)",
                    }}
                  >
                    bit {v.bit_index}
                  </span>
                ) : (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(29,158,117,0.1)",
                      color: "var(--accent)",
                    }}
                  >
                    analógico
                  </span>
                )}
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

  // Role check
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      if (raw) {
        const user = JSON.parse(raw);
        setIsSuperadmin(user?.role === "superadmin");
      }
    } catch {
      // ignore
    }
  }, []);

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
      signal_type: v.signal_type ?? "analog",
      bit_index: v.bit_index != null ? String(v.bit_index) : "0",
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
        signal_type: form.signal_type,
        bit_index: form.signal_type === "digital" ? parseInt(form.bit_index) : null,
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
    <div className="px-4 py-6 max-w-none w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold text-white">Variables IO</h1>
          {isSuperadmin && (
            <Link
              href="/admin/can-sniffer"
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                background: "var(--sidebar)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              CAN Sniffer
            </Link>
          )}
        </div>
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
