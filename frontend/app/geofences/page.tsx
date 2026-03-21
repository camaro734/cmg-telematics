"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { geofences as geofencesApi, type GeofenceOut, type GeofenceEventOut } from "@/lib/api";
import type { GeofenceDrawMapRef, GeofenceDrawResult } from "@/components/GeofenceDrawMap";

// Dynamic import — Leaflet is not SSR-compatible
const GeofenceDrawMap = dynamic(() => import("@/components/GeofenceDrawMap"), { ssr: false });

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button onClick={onClose} style={{ color: "var(--muted)" }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Geofence form (map-based) ────────────────────────────────────────────────

interface GeofenceFormProps {
  initial?: Partial<GeofenceOut>;
  onSave: (data: object) => Promise<void>;
  onCancel: () => void;
}

function GeofenceForm({ initial, onSave, onCancel }: GeofenceFormProps) {
  const [formName, setFormName] = useState(initial?.name ?? "");
  const [formDesc, setFormDesc] = useState(initial?.description ?? "");
  const [shapeType, setShapeType] = useState<"circle" | "polygon">(initial?.shape_type ?? "circle");
  const [formAlertEnter, setFormAlertEnter] = useState(initial?.alert_on_enter ?? true);
  const [formAlertExit, setFormAlertExit] = useState(initial?.alert_on_exit ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const drawMapRef = useRef<GeofenceDrawMapRef | null>(null);

  // Build initialValue for the draw map when editing
  const initialDrawValue: GeofenceDrawResult | null = initial?.shape_type
    ? initial.shape_type === "circle"
      ? {
          shape_type: "circle",
          center_lat: initial.center_lat ?? undefined,
          center_lng: initial.center_lng ?? undefined,
          radius_m: initial.radius_m ?? undefined,
        }
      : {
          shape_type: "polygon",
          polygon_points: initial.polygon_points ?? undefined,
        }
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!formName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }

    const result = drawMapRef.current?.getResult();
    if (!result) {
      setError("Por favor dibuja la zona en el mapa antes de guardar.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        description: formDesc.trim() || null,
        shape_type: result.shape_type,
        center_lat: result.center_lat ?? null,
        center_lng: result.center_lng ?? null,
        radius_m: result.radius_m ?? null,
        polygon_points: result.polygon_points ?? null,
        alert_on_enter: formAlertEnter,
        alert_on_exit: formAlertExit,
      };
      await onSave(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "white",
    fontSize: 13,
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    marginBottom: 4,
    fontSize: 12,
    color: "var(--muted)",
    fontWeight: 500,
  } as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label style={labelStyle}>Nombre *</label>
        <input
          style={inputStyle}
          value={formName}
          onChange={e => setFormName(e.target.value)}
          placeholder="Ej. Zona de carga norte"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label style={labelStyle}>Descripción</label>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: 52 }}
          value={formDesc}
          onChange={e => setFormDesc(e.target.value)}
          rows={2}
          placeholder="Opcional"
        />
      </div>

      {/* Shape type toggle */}
      <div>
        <label style={labelStyle}>Tipo de zona</label>
        <div className="flex gap-2">
          {(["circle", "polygon"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setShapeType(t)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: shapeType === t ? "var(--accent)" : "var(--background)",
                color: shapeType === t ? "white" : "var(--muted)",
                border: `1px solid ${shapeType === t ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              {t === "circle" ? "Círculo" : "Polígono"}
            </button>
          ))}
        </div>
      </div>

      {/* Draw map */}
      <div>
        <label style={labelStyle}>Dibuja la zona en el mapa</label>
        <GeofenceDrawMap
          ref={drawMapRef}
          mode={shapeType}
          initialValue={initialDrawValue?.shape_type === shapeType ? initialDrawValue : null}
          height="340px"
        />
      </div>

      {/* Alert checkboxes */}
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={formAlertEnter}
            onChange={e => setFormAlertEnter(e.target.checked)}
            className="w-4 h-4"
          />
          Alertar al entrar
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={formAlertExit}
            onChange={e => setFormAlertExit(e.target.checked)}
            className="w-4 h-4"
          />
          Alertar al salir
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ background: "var(--accent)", color: "white", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Guardando..." : "Guardar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GeofencesPage() {
  const [fences, setFences] = useState<GeofenceOut[]>([]);
  const [events, setEvents] = useState<GeofenceEventOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<GeofenceOut | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadFences = useCallback(async () => {
    try {
      const data = await geofencesApi.list();
      setFences(data);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando geocercas");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const data = await geofencesApi.listEvents({ limit: 50 });
      setEvents(data);
    } catch {
      // non-critical
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFences();
    loadEvents();
  }, [loadFences, loadEvents]);

  // Auto-refresh events every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadEvents, 30_000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  async function handleCreate(data: object) {
    await geofencesApi.create(data as Parameters<typeof geofencesApi.create>[0]);
    setShowModal(false);
    await loadFences();
  }

  async function handleUpdate(data: object) {
    if (!editTarget) return;
    await geofencesApi.update(editTarget.id, data);
    setEditTarget(null);
    await loadFences();
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta geocerca? Se borrarán también todos sus eventos.")) return;
    setDeletingId(id);
    try {
      await geofencesApi.delete(id);
      await loadFences();
      await loadEvents();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(fence: GeofenceOut) {
    try {
      await geofencesApi.update(fence.id, { active: !fence.active });
      await loadFences();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al actualizar");
    }
  }

  function shapeDescription(fence: GeofenceOut) {
    if (fence.shape_type === "circle") {
      return `Círculo · r=${fence.radius_m != null ? fence.radius_m.toLocaleString("es-ES") : "–"} m`;
    }
    const pts = fence.polygon_points?.length ?? 0;
    return `Polígono · ${pts} puntos`;
  }

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Geocercas</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            Define zonas geográficas y recibe alertas cuando los vehículos entran o salen
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "var(--accent)", color: "white" }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Nueva geocerca
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "#450a0a", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Geofences table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-3 border-b flex items-center justify-between"
             style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <span className="text-sm font-semibold text-white">
            Geocercas definidas ({fences.length})
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            Cargando...
          </div>
        ) : fences.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            No hay geocercas definidas. Crea una con el botón &quot;Nueva geocerca&quot;.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Nombre", "Tipo", "Alerta entrada", "Alerta salida", "Estado", "Acciones"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fences.map((fence, idx) => (
                <tr
                  key={fence.id}
                  style={{
                    borderBottom: idx < fences.length - 1 ? "1px solid var(--border)" : "none",
                    background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{fence.name}</div>
                    {fence.description && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                        {fence.description}
                      </div>
                    )}
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {shapeDescription(fence)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(29,158,117,0.15)", color: "#1D9E75" }}>
                      {fence.shape_type === "circle" ? "Círculo" : "Polígono"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span style={{ color: fence.alert_on_enter ? "var(--success)" : "var(--muted)" }}>
                      {fence.alert_on_enter ? "Sí" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span style={{ color: fence.alert_on_exit ? "var(--success)" : "var(--muted)" }}>
                      {fence.alert_on_exit ? "Sí" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(fence)}
                      className="text-xs px-2 py-0.5 rounded-full font-medium transition-opacity"
                      style={{
                        background: fence.active ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                        color: fence.active ? "var(--success)" : "var(--muted)",
                        border: "none",
                        cursor: "pointer",
                      }}
                      title={fence.active ? "Haz clic para desactivar" : "Haz clic para activar"}
                    >
                      {fence.active ? "ACTIVA" : "INACTIVA"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditTarget(fence)}
                        className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(fence.id)}
                        disabled={deletingId === fence.id}
                        className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
                      >
                        {deletingId === fence.id ? "..." : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent events */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-3 border-b flex items-center justify-between"
             style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <span className="text-sm font-semibold text-white">Eventos recientes</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Actualización automática cada 30 s
          </span>
        </div>

        {eventsLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>Cargando...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            No hay eventos registrados todavía.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
                {["Fecha/Hora", "Vehículo", "Geocerca", "Evento", "Coordenadas"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev, idx) => (
                <tr
                  key={ev.id}
                  style={{
                    borderBottom: idx < events.length - 1 ? "1px solid var(--border)" : "none",
                    background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  }}
                >
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(ev.occurred_at).toLocaleString("es-ES", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    {ev.vehicle_name ?? ev.vehicle_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--muted)" }}>
                    {ev.geofence_name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={
                        ev.event_type === "enter"
                          ? { background: "rgba(34,197,94,0.15)", color: "#22c55e" }
                          : { background: "rgba(239,68,68,0.15)", color: "#ef4444" }
                      }
                    >
                      {ev.event_type === "enter" ? "ENTRÓ" : "SALIÓ"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)", fontFamily: "monospace" }}>
                    {ev.lat.toFixed(5)}, {ev.lng.toFixed(5)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <Modal title="Nueva geocerca" onClose={() => setShowModal(false)}>
          <GeofenceForm
            onSave={handleCreate}
            onCancel={() => setShowModal(false)}
          />
        </Modal>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <Modal title={`Editar: ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          <GeofenceForm
            initial={editTarget}
            onSave={handleUpdate}
            onCancel={() => setEditTarget(null)}
          />
        </Modal>
      )}
    </div>
  );
}
