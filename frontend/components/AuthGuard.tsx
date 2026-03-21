"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function decodeJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function silentRefresh() {
  const token = localStorage.getItem("cmg_token");
  if (!token) return;
  const exp = decodeJwtExp(token);
  if (!exp || Date.now() < exp - 5 * 60 * 1000) return; // >5 min left, skip
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem("cmg_token", data.access_token);
    }
  } catch {
    // network error — ignore
  }
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("cmg_token");
    if (!token && pathname !== "/login") {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [pathname, router]);

  // Background token refresh — runs every 4 minutes so a 60-min token stays alive
  useEffect(() => {
    silentRefresh(); // run immediately on mount
    const interval = setInterval(silentRefresh, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
