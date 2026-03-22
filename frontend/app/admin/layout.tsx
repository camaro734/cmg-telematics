"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cmg_user");
      const role = raw ? JSON.parse(raw).role : null;
      if (role !== "admin" && role !== "superadmin") {
        router.replace("/dashboard");
      }
    } catch {
      router.replace("/dashboard");
    }
  }, [router]);

  return <AppShell>{children}</AppShell>;
}
