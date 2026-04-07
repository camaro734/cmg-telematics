// WebSocket de flota — conexión en tiempo real con reconexión exponencial
// Endpoint: ws://213.210.20.183/ws/fleet?token=<JWT>
import { useEffect, useRef, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAppStore, type WsStatus } from '@/store/useAppStore';

// ─── Tipos de mensajes entrantes ────────────────────────────────────────────

export type { WsStatus };

export interface TelemetryMsg {
  type: 'telemetry';
  vehicle_id: string;
  data: {
    speed?: number;
    lat?: number;
    lng?: number;
    ignition?: boolean;
    ext_voltage_mv?: number;
    ain1_mv?: number;
    dout1?: number;
    dout2?: number;
    [key: string]: number | boolean | null | undefined;
  };
  ts: string;
}

export interface AlertMsg {
  type: 'alert';
  alert_id: string;
  level: string;
  vehicle_id: string;
  display_name: string;
  converted_value: number;
  threshold: number;
  unit: string;
}

export interface StatusMsg {
  type: 'status';
  vehicle_id: string;
  online: boolean;
  last_seen: string;
}

type WsMessage = TelemetryMsg | AlertMsg | StatusMsg;

// ─── Opciones del hook ───────────────────────────────────────────────────────

interface UseFleetWebSocketOptions {
  onTelemetry?: (msg: TelemetryMsg) => void;
  onAlert?: (msg: AlertMsg) => void;
  onStatusChange?: (status: WsStatus) => void;
  /** Desactiva la conexión sin desmontar — útil cuando la pantalla pasa a background */
  enabled?: boolean;
}

// Clave SecureStore sincronizada con services/api.ts
const TOKEN_KEY = 'cmg_jwt';
const WS_BASE_URL = 'ws://213.210.20.183/ws/fleet';
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFleetWebSocket({
  onTelemetry,
  onAlert,
  onStatusChange,
  enabled = true,
}: UseFleetWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef<number>(INITIAL_DELAY_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const { setWsStatus } = useAppStore();

  // Callbacks en refs para evitar que cambios de referencia disparen reconexión
  const onTelemetryRef = useRef(onTelemetry);
  const onAlertRef = useRef(onAlert);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => { onTelemetryRef.current = onTelemetry; }, [onTelemetry]);
  useEffect(() => { onAlertRef.current = onAlert; }, [onAlert]);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  const updateStatus = useCallback((status: WsStatus) => {
    setWsStatus(status);
    onStatusChangeRef.current?.(status);
  }, [setWsStatus]);

  const connect = useCallback(async () => {
    if (!isMountedRef.current) return;

    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token || !isMountedRef.current) return;

    updateStatus('connecting');

    const url = `${WS_BASE_URL}?token=${token}`;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      if (!isMountedRef.current) {
        socket.close();
        return;
      }
      // Reconexión exitosa — resetear backoff
      reconnectDelayRef.current = INITIAL_DELAY_MS;
      updateStatus('connected');
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        if (msg.type === 'telemetry') {
          onTelemetryRef.current?.(msg);
        } else if (msg.type === 'alert') {
          onAlertRef.current?.(msg);
        }
        // Los mensajes 'status' actualizan estado visual pero no necesitan callback externo
      } catch {
        // JSON malformado — ignorar silenciosamente
      }
    };

    socket.onclose = () => {
      if (!isMountedRef.current) return;
      updateStatus('disconnected');
      // Backoff exponencial: 1s → 2s → 4s → 8s → ... → 30s max
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_DELAY_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) connect();
      }, delay);
    };

    socket.onerror = () => {
      // onerror siempre va seguido de onclose — cerrar para activar el flujo de reconexión
      socket.close();
    };
  }, [updateStatus]);

  useEffect(() => {
    isMountedRef.current = true;

    if (enabled) {
      connect();
    }

    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, enabled]);
}
