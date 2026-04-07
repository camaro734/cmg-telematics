// React Query hook — alertas activas del tenant
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Alert } from '@/types';

export const alertKeys = {
  all: ['alerts'] as const,
  active: () => [...alertKeys.all, 'active'] as const,
  byVehicle: (vehicleId: number) => [...alertKeys.all, 'vehicle', vehicleId] as const,
};

export function useAlerts() {
  return useQuery({
    queryKey: alertKeys.active(),
    queryFn: async (): Promise<Alert[]> => {
      const { data } = await api.get<Alert[]>('/alerts');
      return data;
    },
    staleTime: 60 * 1000,           // 1 min
    gcTime: 24 * 60 * 60 * 1000,   // 24h offline
    refetchInterval: 60 * 1000,     // actualizar cada minuto
  });
}

export function useVehicleAlerts(vehicleId: number) {
  return useQuery({
    queryKey: alertKeys.byVehicle(vehicleId),
    queryFn: async (): Promise<Alert[]> => {
      const { data } = await api.get<Alert[]>('/alerts', {
        params: { vehicle_id: vehicleId, status: 'active' },
      });
      return data;
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });
}
