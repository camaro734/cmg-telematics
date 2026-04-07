// React Query hook — flota de vehículos del tenant
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { FleetVehicle } from '@/types';

// Factory de query keys para vehículos
export const vehicleKeys = {
  all: ['vehicles'] as const,
  fleet: () => [...vehicleKeys.all, 'fleet'] as const,
  detail: (id: number) => [...vehicleKeys.all, 'detail', id] as const,
  last: (id: number) => [...vehicleKeys.detail(id), 'last'] as const,
  liveSignals: (id: number) => [...vehicleKeys.detail(id), 'live-signals'] as const,
};

export function useFleet() {
  return useQuery({
    queryKey: vehicleKeys.fleet(),
    queryFn: async (): Promise<FleetVehicle[]> => {
      const { data } = await api.get<{ fleet: FleetVehicle[] }>('/dashboard/fleet');
      return data.fleet;
    },
    staleTime: 30 * 1000,          // 30s — datos de flota refrescados frecuentemente
    gcTime: 24 * 60 * 60 * 1000,  // 24h cache offline
    refetchInterval: 30 * 1000,    // polling cada 30s
    refetchIntervalInBackground: false,
  });
}
