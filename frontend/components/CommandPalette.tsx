"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getVehicles, type Vehicle } from "@/lib/api";

// ─── Static navigation items ──────────────────────────────────────────────────

interface NavItem {
  kind: "nav";
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

interface VehicleItem {
  kind: "vehicle";
  label: string;
  description: string;
  path: string;
  online: boolean | null;
  plate: string | null;
}

interface ActionItem {
  kind: "action";
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

type PaletteItem = NavItem | VehicleItem | ActionItem;

// SVG icon helpers — inline to avoid external dependencies
function IconMap() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 22V12h6v10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconTruck() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="3" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 8h4l3 5v3h-7V8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="5.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12h18M3 6l3 6-3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 6l-3 6 3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <rect x="18" y="3" width="4" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="8" width="4" height="13" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="13" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconWrench() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGeo() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconAlertActive() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconAdmin() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 1l3 6 6.5 1-4.75 4.5 1.25 6.5L12 16l-6 3 1.25-6.5L2.5 8l6.5-1z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconEco() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 14s1.5-2 4-2 4 2 4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 9h.01M15 9h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { kind: "nav", label: "Dashboard — Flota", description: "Vista general de todos los vehículos", path: "/dashboard", icon: <IconMap /> },
  { kind: "nav", label: "Vehículos", description: "Lista completa de vehículos", path: "/vehicles", icon: <IconTruck /> },
  { kind: "nav", label: "Alertas", description: "Alertas activas e historial", path: "/alerts", icon: <IconBell /> },
  { kind: "nav", label: "Rutas y Viajes", description: "Historial de recorridos", path: "/trips", icon: <IconRoute /> },
  { kind: "nav", label: "Analíticas", description: "Estadísticas de flota", path: "/analytics", icon: <IconChart /> },
  { kind: "nav", label: "Mantenimiento", description: "Tareas e intervenciones", path: "/maintenance", icon: <IconWrench /> },
  { kind: "nav", label: "Geocercas", description: "Zonas geográficas configuradas", path: "/geofences", icon: <IconGeo /> },
  { kind: "nav", label: "Eco-Driving", description: "Scores de conducción eficiente", path: "/ecodriving", icon: <IconEco /> },
  { kind: "nav", label: "Mapa en tiempo real", description: "Mapa full-screen con flota en vivo", path: "/map", icon: <IconMap /> },
  { kind: "nav", label: "Mi perfil", description: "Configuración de cuenta", path: "/profile", icon: <IconProfile /> },
  { kind: "nav", label: "Administración — Clientes", description: "Gestión de tenants", path: "/admin/tenants", icon: <IconAdmin /> },
  { kind: "nav", label: "Administración — Usuarios", description: "Gestión de usuarios", path: "/admin/users", icon: <IconAdmin /> },
  { kind: "nav", label: "Administración — Dispositivos", description: "Gestión de vehículos y dispositivos", path: "/admin/vehicles", icon: <IconAdmin /> },
  { kind: "nav", label: "Administración — Variables IO", description: "Mapeo de señales CAN/IO", path: "/admin/variable-maps", icon: <IconAdmin /> },
  { kind: "nav", label: "Administración — Automatizaciones", description: "Reglas de automatización", path: "/admin/automations", icon: <IconAdmin /> },
];

const ACTION_ITEMS: ActionItem[] = [
  { kind: "action", label: "Ver alertas activas", description: "Alertas sin resolver ahora mismo", path: "/alerts?filter=active", icon: <IconAlertActive /> },
  { kind: "action", label: "Ver vehículos online", description: "Vehículos conectados en este momento", path: "/vehicles?filter=online", icon: <IconTruck /> },
  { kind: "action", label: "Mantenimiento urgente", description: "Tareas vencidas o próximas a vencer", path: "/maintenance?status=overdue", icon: <IconWrench /> },
];

// ─── Text highlight utility ──────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) return <span>{text}</span>;

  return (
    <span>
      {text.slice(0, idx)}
      <span style={{ color: "var(--accent)", fontWeight: 700 }}>
        {text.slice(idx, idx + lowerQuery.length)}
      </span>
      {text.slice(idx + lowerQuery.length)}
    </span>
  );
}

// ─── Fuzzy match: return true if all chars in query appear in order in text ──

function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}

// ─── Group header ─────────────────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
  return (
    <div
      className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
      style={{ color: "var(--muted)" }}
    >
      {label}
    </div>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

function ResultRow({
  item,
  query,
  isActive,
  onClick,
  rowRef,
}: {
  item: PaletteItem;
  query: string;
  isActive: boolean;
  onClick: () => void;
  rowRef?: React.Ref<HTMLButtonElement>;
}) {
  const isVehicle = item.kind === "vehicle";
  const vehicle = isVehicle ? (item as VehicleItem) : null;

  return (
    <button
      ref={rowRef}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors rounded-lg"
      style={{
        background: isActive ? "rgba(29,158,117,0.15)" : "transparent",
        border: isActive ? "1px solid rgba(29,158,117,0.3)" : "1px solid transparent",
        color: "var(--text-primary, #e8eaf0)",
      }}
    >
      {/* Icon or online dot */}
      <div
        className="flex-shrink-0 flex items-center justify-center rounded"
        style={{
          width: 28,
          height: 28,
          background: isActive ? "rgba(29,158,117,0.2)" : "rgba(255,255,255,0.05)",
          color: isActive ? "var(--accent)" : "var(--muted)",
        }}
      >
        {isVehicle ? (
          <IconTruck />
        ) : (
          (item as NavItem | ActionItem).icon
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: isActive ? "white" : "var(--text-primary, #e8eaf0)" }}>
          <HighlightedText text={item.label} query={query} />
        </div>
        {item.description && (
          <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
            {item.description}
          </div>
        )}
      </div>

      {/* Vehicle online badge */}
      {isVehicle && vehicle && (
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <span
            className="rounded-full"
            style={{
              width: 7,
              height: 7,
              background: vehicle.online ? "var(--success, #22c55e)" : "var(--muted)",
              display: "block",
            }}
          />
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {vehicle.online ? "Online" : "Offline"}
          </span>
        </div>
      )}

      {/* Plate chip */}
      {isVehicle && vehicle?.plate && (
        <span
          className="flex-shrink-0 text-xs px-2 py-0.5 rounded font-mono"
          style={{
            background: "rgba(255,255,255,0.07)",
            color: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          {vehicle.plate}
        </span>
      )}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);

  const [query, setQuery] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Fetch vehicles once when palette opens
  useEffect(() => {
    if (!open) return;
    setLoadingVehicles(true);
    getVehicles()
      .then(v => setVehicles(v))
      .catch(() => setVehicles([]))
      .finally(() => setLoadingVehicles(false));
  }, [open]);

  // Focus input when opened; reset state when closed
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Small delay to allow the portal to mount before focusing
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll active row into view
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Build filtered + grouped result list
  const filteredItems = (() => {
    const q = query.trim();

    const navMatches = NAV_ITEMS.filter(
      item =>
        fuzzyMatch(item.label, q) ||
        fuzzyMatch(item.description, q) ||
        fuzzyMatch(item.path, q)
    );

    const vehicleItems: VehicleItem[] = vehicles
      .filter(
        v =>
          fuzzyMatch(v.name, q) ||
          fuzzyMatch(v.license_plate ?? "", q) ||
          fuzzyMatch(v.device_imei ?? "", q)
      )
      .map(v => ({
        kind: "vehicle" as const,
        label: v.name,
        description: v.device_imei ? `IMEI: ${v.device_imei}` : "Sin dispositivo",
        path: `/vehicles/${v.id}`,
        online: v.device_online,
        plate: v.license_plate,
      }));

    const actionMatches = ACTION_ITEMS.filter(
      item =>
        fuzzyMatch(item.label, q) ||
        fuzzyMatch(item.description, q)
    );

    // When query is empty show all; when querying, only show non-empty groups
    const result: PaletteItem[] = [];

    if (navMatches.length > 0) result.push(...navMatches);
    if (vehicleItems.length > 0) result.push(...vehicleItems);
    if (actionMatches.length > 0) result.push(...actionMatches);

    return { navMatches, vehicleItems, actionMatches, flat: result };
  })();

  const flatItems = filteredItems.flat;

  const navigate = useCallback(
    (path: string) => {
      onClose();
      router.push(path);
    },
    [router, onClose]
  );

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex(i => (i + 1) % Math.max(flatItems.length, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(i => (i - 1 + Math.max(flatItems.length, 1)) % Math.max(flatItems.length, 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = flatItems[activeIndex];
        if (selected) navigate(selected.path);
        return;
      }
    },
    [flatItems, activeIndex, navigate, onClose]
  );

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  // Compute flat index offsets for each group
  const navOffset = 0;
  const vehicleOffset = filteredItems.navMatches.length;
  const actionOffset = vehicleOffset + filteredItems.vehicleItems.length;

  const isEmpty = flatItems.length === 0 && !loadingVehicles;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed z-[101] left-1/2 -translate-x-1/2"
        style={{
          top: "clamp(40px, 10vh, 120px)",
          width: "min(620px, calc(100vw - 32px))",
          background: "var(--card, #1e2532)",
          border: "1px solid rgba(29,158,117,0.3)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        {/* Search input row */}
        <div
          className="flex items-center gap-3 px-4"
          style={{
            borderBottom: "1px solid var(--border)",
            height: 52,
          }}
        >
          {/* Search icon */}
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ color: "var(--muted)", flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar página, vehículo o acción..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--text-primary, #e8eaf0)", caretColor: "var(--accent)" }}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />

          {/* Loading spinner */}
          {loadingVehicles && (
            <div
              className="flex-shrink-0 rounded-full"
              style={{
                width: 14,
                height: 14,
                border: "2px solid rgba(29,158,117,0.3)",
                borderTopColor: "var(--accent)",
                animation: "cmg-spin 0.7s linear infinite",
              }}
            />
          )}

          {/* Escape hint */}
          <kbd
            className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(255,255,255,0.07)",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto"
          style={{ maxHeight: "min(440px, 60vh)", padding: "6px 8px" }}
        >
          {/* Empty state */}
          {isEmpty && (
            <div
              className="flex flex-col items-center justify-center py-10 gap-2"
              style={{ color: "var(--muted)" }}
            >
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
                <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-sm">Sin resultados para &ldquo;{query}&rdquo;</span>
            </div>
          )}

          {/* Navigation group */}
          {filteredItems.navMatches.length > 0 && (
            <div className="mb-1">
              <GroupHeader label="Navegacion" />
              {filteredItems.navMatches.map((item, i) => {
                const flatIdx = navOffset + i;
                return (
                  <ResultRow
                    key={item.path}
                    item={item}
                    query={query}
                    isActive={flatIdx === activeIndex}
                    onClick={() => navigate(item.path)}
                    rowRef={flatIdx === activeIndex ? activeRowRef : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Vehicles group */}
          {(filteredItems.vehicleItems.length > 0 || loadingVehicles) && (
            <div className="mb-1">
              <GroupHeader label="Vehiculos" />
              {loadingVehicles && filteredItems.vehicleItems.length === 0 && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5 text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: "2px solid rgba(29,158,117,0.3)",
                      borderTopColor: "var(--accent)",
                      borderRadius: "50%",
                      animation: "cmg-spin 0.7s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                  Cargando flota...
                </div>
              )}
              {filteredItems.vehicleItems.map((item, i) => {
                const flatIdx = vehicleOffset + i;
                return (
                  <ResultRow
                    key={item.path}
                    item={item}
                    query={query}
                    isActive={flatIdx === activeIndex}
                    onClick={() => navigate(item.path)}
                    rowRef={flatIdx === activeIndex ? activeRowRef : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Quick actions group */}
          {filteredItems.actionMatches.length > 0 && (
            <div className="mb-1">
              <GroupHeader label="Acciones rapidas" />
              {filteredItems.actionMatches.map((item, i) => {
                const flatIdx = actionOffset + i;
                return (
                  <ResultRow
                    key={item.path + i}
                    item={item}
                    query={query}
                    isActive={flatIdx === activeIndex}
                    onClick={() => navigate(item.path)}
                    rowRef={flatIdx === activeIndex ? activeRowRef : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint bar */}
        <div
          className="flex items-center gap-4 px-4 py-2"
          style={{
            borderTop: "1px solid var(--border)",
            color: "var(--muted)",
            fontSize: 11,
          }}
        >
          <span className="flex items-center gap-1">
            <kbd style={kbdStyle}>&#8593;</kbd><kbd style={kbdStyle}>&#8595;</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd style={kbdStyle}>Enter</kbd>
            abrir
          </span>
          <span className="flex items-center gap-1">
            <kbd style={kbdStyle}>Esc</kbd>
            cerrar
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd style={kbdStyle}>Ctrl</kbd><kbd style={kbdStyle}>K</kbd>
            activar
          </span>
        </div>
      </div>

      {/* Spinner animation */}
      <style>{`
        @keyframes cmg-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 20,
  height: 18,
  padding: "0 4px",
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 10,
  color: "var(--muted)",
};
