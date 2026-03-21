"use client";

import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";

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
      {/* CSS var for mobile bottom bar height */}
      <style>{`
        @media (max-width: 767px) {
          :root { --mobile-bottom-bar-height: 64px; }
        }
      `}</style>
    </AuthGuard>
  );
}
