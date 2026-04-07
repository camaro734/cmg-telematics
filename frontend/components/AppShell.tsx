"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import Toast from "@/components/Toast";
import CommandPalette from "@/components/CommandPalette";
import { useToast } from "@/lib/toast";
import { useFleetWebSocket, type WsAlertMessage, type WsTelemetryMessage } from "@/lib/websocket";

function sendBrowserNotification(title: string, body: string, url: string) {
  if (typeof window === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "cmg-alert",
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); window.location.href = url; n.close(); };
  } catch {
    // Notifications not available in this context
  }
}

function NotificationBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      // Only show once per session
      const dismissed = sessionStorage.getItem("cmg_notif_banner_dismissed");
      if (!dismissed) setShow(true);
    }
  }, []);

  if (!show) return null;

  function requestPermission() {
    Notification.requestPermission().then(perm => {
      setShow(false);
      sessionStorage.setItem("cmg_notif_banner_dismissed", "1");
      if (perm === "granted") {
        new Notification("CMG Telematics", { body: "Notificaciones activadas. Recibirás alertas críticas.", icon: "/icon-192.png" });
      }
    });
  }

  return (
    <div
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm"
      style={{
        background: "var(--card)",
        border: "1px solid rgba(59,130,246,0.4)",
        color: "white",
        maxWidth: "calc(100vw - 2rem)",
        whiteSpace: "nowrap",
      }}
    >
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ color: "#60a5fa", flexShrink: 0 }}>
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span className="text-xs" style={{ color: "var(--muted)" }}>Activa notificaciones para alertas críticas</span>
      <button
        onClick={requestPermission}
        className="text-xs font-semibold px-3 py-1 rounded-lg"
        style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.3)" }}
      >
        Activar
      </button>
      <button
        onClick={() => { setShow(false); sessionStorage.setItem("cmg_notif_banner_dismissed", "1"); }}
        style={{ color: "var(--muted)" }}
      >
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

function AlertListener() {
  const { toasts, addToast, dismiss } = useToast();
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  // Update document title with unread alert count
  useEffect(() => {
    const base = "CMG Telematics";
    document.title = unreadAlerts > 0 ? `(${unreadAlerts}) ${base}` : base;
    return () => { document.title = base; };
  }, [unreadAlerts]);

  // Reset unread count when user focuses the window
  useEffect(() => {
    function onFocus() { setUnreadAlerts(0); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleAlert = useCallback((alert: WsAlertMessage) => {
    const levelMap: Record<string, "high" | "low" | "info"> = {
      high: "high",
      medium: "low",
      low: "info",
    };
    const levelLabel: Record<string, string> = {
      high: "ALTA",
      medium: "MEDIA",
      low: "BAJA",
    };

    addToast({
      level: levelMap[alert.level] ?? "info",
      title: `⚠️ ${alert.display_name}: ${alert.converted_value} ${alert.unit}`,
      message: `Nivel ${levelLabel[alert.level] ?? alert.level.toUpperCase()} — ${new Date(alert.fired_at).toLocaleTimeString("es-ES")}`,
    });

    // Increment unread counter for tab title
    if (!document.hasFocus()) {
      setUnreadAlerts(n => n + 1);
    }

    // Native browser notification for high severity
    if (alert.level === "high") {
      sendBrowserNotification(
        `🔴 Alerta ALTA — ${alert.display_name}`,
        `${alert.converted_value.toFixed(1)} ${alert.unit} (umbral: ${alert.threshold} ${alert.unit})`,
        "/alerts"
      );
    }
  }, [addToast]);

  const handleTelemetry = useCallback((_data: WsTelemetryMessage) => {}, []);

  useFleetWebSocket(handleTelemetry, handleAlert);

  return <Toast toasts={toasts} onDismiss={dismiss} />;
}

export default function AppShell({
  children,
  overflow = "auto",
}: {
  children: React.ReactNode;
  overflow?: "auto" | "hidden";
}) {
  const [cmdOpen, setCmdOpen] = useState(false);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
        <main
          className="flex-1 min-w-0"
          style={{
            background: "var(--background)",
            overflowY: overflow === "auto" ? "auto" : "hidden",
            overflowX: "hidden",
            // On mobile: add bottom padding for the 64px bottom tab bar
            paddingBottom: "var(--mobile-bottom-bar-height, 0)",
          }}
        >
          {children}
        </main>
      </div>
      {/* Global command palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      {/* Global alert toasts via WebSocket */}
      <AlertListener />
      {/* Push notification permission banner */}
      <NotificationBanner />
      {/* CSS var for mobile bottom bar height */}
      <style>{`
        @media (max-width: 767px) {
          :root { --mobile-bottom-bar-height: 64px; }
        }
      `}</style>
    </AuthGuard>
  );
}
