"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@cmg.es");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
               style={{ background: "var(--accent)" }}>
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
              <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="white" strokeWidth="1.5"
                    strokeLinejoin="round" fill="rgba(255,255,255,0.15)" />
              <circle cx="12" cy="12" r="3" fill="white" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">CMG Telematics</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Telemática industrial avanzada
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <h2 className="text-lg font-semibold text-white mb-6">Iniciar sesión</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg text-white text-sm outline-none transition-colors"
                style={{
                  background: "var(--sidebar)",
                  border: "1px solid var(--border)",
                }}
                placeholder="admin@empresa.es"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg text-white text-sm outline-none"
                style={{
                  background: "var(--sidebar)",
                  border: "1px solid var(--border)",
                }}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-sm px-4 py-3 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg font-semibold text-white text-sm transition-all"
              style={{
                background: loading ? "var(--muted)" : "var(--accent)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "var(--muted)" }}>
          CMG Metalhidráulica S.L. · Massanassa, Valencia
        </p>
      </div>
    </div>
  );
}
