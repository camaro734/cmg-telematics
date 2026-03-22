"use client";

import { useEffect, useState } from "react";
import { getMe, updateMe, changePassword, type MeResponse } from "@/lib/api";
import { setupPushNotifications, unregisterPushSubscription, getPushPermissionStatus } from "@/lib/push";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Administrador",
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
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function parseJwtExp(token: string): Date | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp) return new Date(payload.exp * 1000);
  } catch {
    // ignore
  }
  return null;
}

export default function ProfilePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Edit name
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState("");

  // Change password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState("");

  // Session info
  const [tokenExp, setTokenExp] = useState<Date | null>(null);

  // Push notifications
  const [pushStatus, setPushStatus] = useState<string>("default");
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("cmg_token");
    if (token) setTokenExp(parseJwtExp(token));

    // Check push permission status
    if (typeof window !== "undefined") {
      setPushStatus(getPushPermissionStatus());
    }

    getMe()
      .then((data) => {
        setMe(data);
        setNameValue(data.full_name);
      })
      .catch((e) => setError(e.message || "Error cargando perfil"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveName() {
    if (!nameValue.trim()) return;
    setNameSaving(true);
    setNameError("");
    setNameSuccess(false);
    try {
      const updated = await updateMe(nameValue.trim());
      setMe(updated);
      setNameValue(updated.full_name);
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (e: unknown) {
      setNameError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setNameSaving(false);
    }
  }

  async function handleChangePassword() {
    setPwError("");
    setPwSuccess(false);
    if (newPw !== confirmPw) {
      setPwError("Las contraseñas nuevas no coinciden");
      return;
    }
    if (newPw.length < 6) {
      setPwError("La nueva contraseña debe tener al menos 6 caracteres");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 4000);
    } catch (e: unknown) {
      setPwError(e instanceof Error ? e.message : "Error al cambiar contraseña");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleEnablePush() {
    const token = localStorage.getItem("cmg_token");
    if (!token) return;
    setPushLoading(true);
    setPushMessage("");
    try {
      const ok = await setupPushNotifications(token);
      if (ok) {
        setPushStatus("granted");
        setPushMessage("Notificaciones push activadas correctamente.");
      } else {
        const status = getPushPermissionStatus();
        setPushStatus(status);
        if (status === "denied") {
          setPushMessage("Permiso denegado. Actívalo manualmente en los ajustes del navegador.");
        } else {
          setPushMessage("No se pudieron activar las notificaciones push.");
        }
      }
    } catch (e) {
      setPushMessage("Error al activar notificaciones push.");
    } finally {
      setPushLoading(false);
    }
  }

  async function handleDisablePush() {
    const token = localStorage.getItem("cmg_token");
    if (!token) return;
    setPushLoading(true);
    setPushMessage("");
    try {
      await unregisterPushSubscription(token);
      setPushStatus("default");
      setPushMessage("Notificaciones push desactivadas.");
    } catch (e) {
      setPushMessage("Error al desactivar notificaciones push.");
    } finally {
      setPushLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--muted)" }}>
        Cargando...
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="px-6 py-6">
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
          {error || "No se pudo cargar el perfil"}
        </div>
      </div>
    );
  }

  const initials = getInitials(me.full_name || me.email);
  const roleStyle = ROLE_COLORS[me.role] ?? ROLE_COLORS.viewer;

  return (
    <div className="px-6 py-6 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white">Mi perfil</h1>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          Gestiona tu información personal y seguridad de cuenta
        </p>
      </div>

      {/* User info card */}
      <div className="rounded-xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 text-xl font-bold text-white"
            style={{ background: "var(--accent)" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-white truncate">{me.full_name}</div>
            <div className="text-sm truncate" style={{ color: "var(--muted)" }}>{me.email}</div>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: roleStyle.bg, color: roleStyle.color }}
              >
                {ROLE_LABELS[me.role] ?? me.role}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(34,197,94,0.1)", color: "var(--success)" }}
              >
                Activo
              </span>
            </div>
          </div>
        </div>

        {/* Session info */}
        <div className="mt-5 pt-5 grid grid-cols-2 gap-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div>
            <div className="text-xs font-medium mb-1" style={{ color: "var(--muted)" }}>Conectado como</div>
            <div className="text-sm text-white truncate">{me.email}</div>
          </div>
          <div>
            <div className="text-xs font-medium mb-1" style={{ color: "var(--muted)" }}>Token expira</div>
            <div className="text-sm text-white">
              {tokenExp
                ? tokenExp.toLocaleString("es-ES", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Edit name */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold text-white mb-4">Editar nombre</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
              Nombre completo
            </label>
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white outline-none"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              placeholder="Tu nombre completo"
            />
          </div>
          {nameError && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
              {nameError}
            </div>
          )}
          {nameSuccess && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(34,197,94,0.1)", color: "var(--success)" }}>
              Nombre actualizado correctamente
            </div>
          )}
          <button
            onClick={handleSaveName}
            disabled={nameSaving || !nameValue.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
            style={{
              background: "var(--accent)",
              opacity: nameSaving || !nameValue.trim() ? 0.6 : 1,
              cursor: nameSaving || !nameValue.trim() ? "not-allowed" : "pointer",
            }}
          >
            {nameSaving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {/* Push notifications */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold text-white mb-1">Notificaciones push</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Recibe alertas de la flota directamente en tu dispositivo, incluso con el navegador cerrado.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background:
                pushStatus === "granted"
                  ? "rgba(34,197,94,0.15)"
                  : pushStatus === "denied"
                  ? "rgba(239,68,68,0.15)"
                  : "rgba(100,116,139,0.15)",
              color:
                pushStatus === "granted"
                  ? "var(--success)"
                  : pushStatus === "denied"
                  ? "var(--danger)"
                  : "var(--muted)",
            }}
          >
            {pushStatus === "granted"
              ? "Activadas"
              : pushStatus === "denied"
              ? "Bloqueadas"
              : pushStatus === "unsupported"
              ? "No soportadas"
              : "Desactivadas"}
          </span>
        </div>
        {pushStatus !== "unsupported" && (
          <div className="flex gap-2">
            {pushStatus !== "granted" ? (
              <button
                onClick={handleEnablePush}
                disabled={pushLoading || pushStatus === "denied"}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
                style={{
                  background: "var(--accent)",
                  opacity: pushLoading || pushStatus === "denied" ? 0.6 : 1,
                  cursor: pushLoading || pushStatus === "denied" ? "not-allowed" : "pointer",
                }}
              >
                {pushLoading ? "Activando..." : "Activar notificaciones"}
              </button>
            ) : (
              <button
                onClick={handleDisablePush}
                disabled={pushLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
                style={{
                  background: "rgba(239,68,68,0.2)",
                  border: "1px solid rgba(239,68,68,0.4)",
                  opacity: pushLoading ? 0.6 : 1,
                  cursor: pushLoading ? "not-allowed" : "pointer",
                }}
              >
                {pushLoading ? "Desactivando..." : "Desactivar notificaciones"}
              </button>
            )}
          </div>
        )}
        {pushMessage && (
          <div
            className="text-xs px-3 py-2 rounded-lg mt-3"
            style={{
              background: pushStatus === "granted" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              color: pushStatus === "granted" ? "var(--success)" : "#fca5a5",
            }}
          >
            {pushMessage}
          </div>
        )}
      </div>

      {/* Change password */}
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold text-white mb-4">Cambiar contraseña</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
              Contraseña actual
            </label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white outline-none"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
              Nueva contraseña
            </label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white outline-none"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
              Confirmar nueva contraseña
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white outline-none"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
              placeholder="••••••••"
            />
          </div>
          {pwError && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
              {pwError}
            </div>
          )}
          {pwSuccess && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(34,197,94,0.1)", color: "var(--success)" }}>
              Contraseña cambiada correctamente
            </div>
          )}
          <button
            onClick={handleChangePassword}
            disabled={pwSaving || !currentPw || !newPw || !confirmPw}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
            style={{
              background: "var(--accent)",
              opacity: pwSaving || !currentPw || !newPw || !confirmPw ? 0.6 : 1,
              cursor: pwSaving || !currentPw || !newPw || !confirmPw ? "not-allowed" : "pointer",
            }}
          >
            {pwSaving ? "Cambiando..." : "Cambiar contraseña"}
          </button>
        </div>
      </div>
    </div>
  );
}
