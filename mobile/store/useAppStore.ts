// Zustand store — estado global de la app (auth + vehículo activo + WebSocket)
// NO contiene estado del servidor — eso es responsabilidad de React Query
import { create } from 'zustand';
import type { User } from '@/types';

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;

  // Selección de flota
  selectedVehicleId: number | null;

  // Estado del WebSocket de flota
  wsStatus: WsStatus;

  // Acciones
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  setSelectedVehicleId: (id: number | null) => void;
  setWsStatus: (status: WsStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  selectedVehicleId: null,
  wsStatus: 'disconnected',

  setAuth: (user: User, token: string) =>
    set({ user, token, isAuthenticated: true }),

  clearAuth: () =>
    set({ user: null, token: null, isAuthenticated: false, selectedVehicleId: null }),

  setSelectedVehicleId: (id: number | null) =>
    set({ selectedVehicleId: id }),

  setWsStatus: (status: WsStatus) =>
    set({ wsStatus: status }),
}));
