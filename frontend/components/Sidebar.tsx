"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, alerts as alertsApi, fetchMyBranding } from "@/lib/api";
import { useBranding } from "@/context/BrandingContext";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  operator: "Operador",
  viewer: "Visor",
  driver: "Conductor",
};

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  superadmin: { bg: "rgba(239,68,68,0.15)", color: "#f87171" },
  admin: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" },
  operator: { bg: "rgba(251,146,60,0.15)", color: "#fb923c" },
  viewer: { bg: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  driver: { bg: "rgba(34,197,94,0.15)", color: "var(--success)" },
};

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// Primary nav shown in desktop sidebar + mobile bottom bar
const primaryNav = [
  {
    href: "/dashboard",
    label: "Flota",
    icon: (active: boolean) => (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          stroke="currentColor" strokeWidth={active ? "2" : "1.5"} strokeLinejoin="round"
          fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0} />
        <path d="M9 22V12h6v10" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/vehicles",
    label: "Vehículos",
    icon: (active: boolean) => (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="2" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} />
        <path d="M16 8h4l3 5v3h-7V8z" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} strokeLinejoin="round" />
        <circle cx="5.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} />
        <circle cx="18.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} />
      </svg>
    ),
  },
  {
    href: "/map",
    label: "Mapa",
    icon: (active: boolean) => (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"
          stroke="currentColor" strokeWidth={active ? "2" : "1.5"}
          strokeLinecap="round" strokeLinejoin="round"
          fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0} />
        <line x1="8" y1="2" x2="8" y2="18" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} strokeLinecap="round" />
        <line x1="16" y1="6" x2="16" y2="22" stroke="currentColor" strokeWidth={active ? "2" : "1.5"} strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/alerts",
    label: "Alertas",
    hasAlerts: true,
    icon: (active: boolean) => (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
          stroke="currentColor" strokeWidth={active ? "2" : "1.5"}
          strokeLinecap="round" strokeLinejoin="round"
          fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0} />
      </svg>
    ),
  },
];

// Secondary nav shown in desktop sidebar + mobile "Más" sheet
const secondaryNav = [
  {
    href: "/trips",
    label: "Rutas",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M3 12h18M3 6l3 6-3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 6l-3 6 3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/analytics",
    label: "Analíticas",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <rect x="18" y="3" width="4" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10" y="8" width="4" height="13" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="2" y="13" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/maintenance",
    label: "Mantenimiento",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/geofences",
    label: "Geocercas",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
];

const adminNav = [
  {
    href: "/admin/tenants",
    label: "Clientes",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M3 21h18M9 8h1m-1 4h1m-1 4h1m4-8h1m-1 4h1m-1 4h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    label: "Usuarios",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/vehicles",
    label: "Dispositivos",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/variable-maps",
    label: "Variables IO",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/admin/automations",
    label: "Automatizaciones",
    superadminOnly: true,
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const branding = useBranding();
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [activeAlerts, setActiveAlerts] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userBranding, setUserBranding] = useState<{ brand_name: string; brand_color: string; logo_url: string | null; is_custom: boolean } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserRole(parsed.role ?? "");
        setUserName(parsed.full_name || parsed.email?.split("@")[0] || "");
      }
    } catch { /* ignore */ }

    // Fetch user-specific branding for all roles
    fetchMyBranding().then(b => {
      if (b.is_custom) setUserBranding(b);
    }).catch(() => {});
  }, []);

  // Close "Más" sheet on route change
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Poll active alert count every 60s
  useEffect(() => {
    const fetchCount = () => {
      alertsApi.activeCount().then(d => setActiveAlerts(d.count)).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, []);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  // Desktop sidebar nav item
  function DesktopNavItem({ href, label, icon, badge }: { href: string; label: string; icon: React.ReactNode; badge?: number }) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        href={href}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: active ? "rgba(29,158,117,0.15)" : "transparent",
          color: active ? "var(--accent)" : "var(--muted)",
        }}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {badge != null && badge > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444", minWidth: 18, textAlign: "center" }}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  }

  const desktopSidebar = (
    <>
      {/* Brand */}
      {(() => {
        // User-specific branding takes priority over domain branding
        const effectiveLogo = userBranding?.logo_url || branding.logo_url;
        const effectiveName = userBranding?.brand_name || (branding.is_custom ? branding.brand_name : "CMG");
        const effectiveSubtitle = (userBranding?.is_custom || branding.is_custom) ? "Fleet Management" : "Telematics";
        return (
          <div className="px-5 py-5 flex items-center gap-3 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
            {effectiveLogo ? (
              <img
                src={effectiveLogo}
                alt={effectiveName}
                className="h-7 max-w-[120px] object-contain flex-shrink-0"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                   style={{ background: "var(--accent)" }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                  <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="white" strokeWidth="1.5"
                        strokeLinejoin="round" fill="rgba(255,255,255,0.2)" />
                  <circle cx="12" cy="12" r="2.5" fill="white" />
                </svg>
              </div>
            )}
            {!effectiveLogo && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white leading-tight truncate">{effectiveName}</div>
                <div className="text-xs leading-tight" style={{ color: "var(--muted)" }}>{effectiveSubtitle}</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-xs px-3 pb-1 font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Monitorización
        </p>
        {primaryNav.map(item => (
          <DesktopNavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon(pathname === item.href || pathname.startsWith(item.href + "/"))}
            badge={item.hasAlerts ? activeAlerts : undefined}
          />
        ))}
        {secondaryNav.map(item => (
          <DesktopNavItem key={item.href} href={item.href} label={item.label} icon={item.icon} />
        ))}

        {(userRole === "superadmin" || userRole === "admin") && (
          <>
            <p className="text-xs px-3 pt-4 pb-1 font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Administración
            </p>
            {adminNav.filter(item => !item.superadminOnly || userRole === "superadmin").map(item => <DesktopNavItem key={item.href} {...item} />)}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="px-3 pb-2 pt-3 border-t flex-shrink-0" style={{ borderColor: "var(--border)" }}>
        {userName && (
          <Link href="/profile"
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors mb-1"
            style={{ background: pathname === "/profile" ? "rgba(29,158,117,0.12)" : "transparent" }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                 style={{ background: "var(--accent)" }}>
              {getInitials(userName)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{userName}</div>
              {userRole && (
                <span className="text-xs px-1.5 py-0 rounded font-medium"
                  style={{
                    background: (ROLE_COLORS[userRole] ?? ROLE_COLORS.viewer).bg,
                    color: (ROLE_COLORS[userRole] ?? ROLE_COLORS.viewer).color,
                    fontSize: 10,
                  }}>
                  {ROLE_LABELS[userRole] ?? userRole}
                </span>
              )}
            </div>
          </Link>
        )}
        <button onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm transition-colors"
          style={{ color: "var(--muted)" }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col h-full flex-shrink-0"
        style={{ width: 260, background: "var(--sidebar)", borderRight: "1px solid var(--border)" }}
      >
        {desktopSidebar}
      </aside>

      {/* ── Mobile: bottom tab bar ────────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch"
        style={{
          height: 64,
          background: "var(--sidebar)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {primaryNav.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 relative transition-colors"
              style={{ color: active ? "var(--accent)" : "var(--muted)" }}
            >
              {item.icon(active)}
              <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, lineHeight: 1 }}>
                {item.label}
              </span>
              {/* Alert badge */}
              {item.hasAlerts && activeAlerts > 0 && (
                <span className="absolute top-2 right-[calc(50%-16px)] flex items-center justify-center rounded-full font-bold"
                  style={{
                    background: "#ef4444", color: "white",
                    fontSize: 9, minWidth: 16, height: 16, padding: "0 3px",
                  }}>
                  {activeAlerts > 9 ? "9+" : activeAlerts}
                </span>
              )}
              {/* Active indicator */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
                  style={{ width: 24, height: 3, background: "var(--accent)" }} />
              )}
            </Link>
          );
        })}

        {/* "Más" tab */}
        <button
          className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
          style={{ color: moreOpen ? "var(--accent)" : "var(--muted)" }}
          onClick={() => setMoreOpen(v => !v)}
        >
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="19" cy="12" r="1.5" fill="currentColor" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: moreOpen ? 600 : 400, lineHeight: 1 }}>Más</span>
          {moreOpen && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
              style={{ width: 24, height: 3, background: "var(--accent)" }} />
          )}
        </button>
      </nav>

      {/* ── Mobile: "Más" bottom sheet ────────────────────────────────────── */}
      {/* Backdrop */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-30"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
          onClick={() => setMoreOpen(false)}
        />
      )}
      {/* Sheet */}
      <div
        className="md:hidden fixed left-0 right-0 flex flex-col"
        style={{
          bottom: 64,
          background: "var(--sidebar)",
          borderTop: "1px solid var(--border)",
          borderRadius: "16px 16px 0 0",
          transform: moreOpen ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.3s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "70vh",
          overflowY: "auto",
          zIndex: 35,
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="rounded-full" style={{ width: 36, height: 4, background: "var(--border)" }} />
        </div>

        {/* User profile */}
        {userName && (
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <Link href="/profile" onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
                   style={{ background: "var(--accent)" }}>
                {getInitials(userName)}
              </div>
              <div>
                <div className="text-sm font-semibold text-white">{userName}</div>
                {userRole && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: (ROLE_COLORS[userRole] ?? ROLE_COLORS.viewer).bg,
                      color: (ROLE_COLORS[userRole] ?? ROLE_COLORS.viewer).color,
                    }}>
                    {ROLE_LABELS[userRole] ?? userRole}
                  </span>
                )}
              </div>
            </Link>
          </div>
        )}

        {/* Secondary nav grid */}
        <div className="p-4 grid grid-cols-3 gap-3">
          {secondaryNav.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex flex-col items-center gap-2 p-3 rounded-xl transition-colors"
                style={{
                  background: active ? "rgba(29,158,117,0.15)" : "rgba(255,255,255,0.05)",
                  color: active ? "var(--accent)" : "var(--muted)",
                  border: `1px solid ${active ? "rgba(29,158,117,0.3)" : "var(--border)"}`,
                }}
              >
                {item.icon}
                <span style={{ fontSize: 11, fontWeight: 500, textAlign: "center" }}>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Admin section */}
        {(userRole === "superadmin" || userRole === "admin") && (
          <>
            <div className="px-4 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Administración
              </p>
            </div>
            <div className="px-4 pb-2 grid grid-cols-3 gap-3">
              {adminNav.filter(item => !item.superadminOnly || userRole === "superadmin").map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl transition-colors"
                    style={{
                      background: active ? "rgba(29,158,117,0.15)" : "rgba(255,255,255,0.05)",
                      color: active ? "var(--accent)" : "var(--muted)",
                      border: `1px solid ${active ? "rgba(29,158,117,0.3)" : "var(--border)"}`,
                    }}
                  >
                    {item.icon}
                    <span style={{ fontSize: 11, fontWeight: 500, textAlign: "center" }}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {/* Logout */}
        <div className="px-4 pt-2 pb-4 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium"
            style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  );
}
