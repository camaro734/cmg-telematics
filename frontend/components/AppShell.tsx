"use client";

import { useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/toast";
import { useFleetWebSocket, type WsAlertMessage, type WsTelemetryMessage } from "@/lib/websocket";

function AlertListener() {
  const { toasts, addToast, dismiss } = useToast();

  const handleAlert = useCallback((alert: WsAlertMessage) => {
    // Map alert level to toast level
    const levelMap: Record<string, "high" | "low" | "info"> = {
      high: "high",
      medium: "low",
      low: "info",
    };
    const toastLevel = levelMap[alert.level] ?? "info";

    const levelLabel: Record<string, string> = {
      high: "ALTA",
      medium: "MEDIA",
      low: "BAJA",
    };

    addToast({
      level: toastLevel,
      title: `\u26a0\ufe0f ${alert.display_name}: ${alert.converted_value} ${alert.unit}`,
      message: `Nivel ${levelLabel[alert.level] ?? alert.level.toUpperCase()} \u2014 ${new Date(alert.fired_at).toLocaleTimeString("es-ES")}`,
    });
  }, [addToast]);

  // No-op telemetry handler — AppShell doesn't need telemetry data
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
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
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
      {/* Global alert toasts via WebSocket */}
      <AlertListener />
      {/* CSS var for mobile bottom bar height */}
      <style>{`
        @media (max-width: 767px) {
          :root { --mobile-bottom-bar-height: 64px; }
        }
      `}</style>
    </AuthGuard>
  );
}
