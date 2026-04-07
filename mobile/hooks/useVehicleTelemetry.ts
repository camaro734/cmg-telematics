// React Query hooks — telemetría por vehículo (last + live-signals)
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { vehicleKeys } from './useVehicles';
import type { VehicleLastResponse, LiveSignalsResponse } from '@/types';

export function useVehicleLast(vehicleId: number) {
  return useQuery({
    queryKey: vehicleKeys.last(vehicleId),
    queryFn: async (): Promise<VehicleLastResponse> => {
      const { data } = await api.get<VehicleLastResponse>(`/vehicles/${vehicleId}/last`);
      return data;
    },
    staleTime: 10 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchInterval: 10 * 1000,   // polling cada 10s mientras el vehículo está activo
  });
}

export function useLiveSignals(vehicleId: number) {
  return useQuery({
    queryKey: vehicleKeys.liveSignals(vehicleId),
    queryFn: async (): Promise<LiveSignalsResponse> => {
      const { data } = await api.get<LiveSignalsResponse>(`/vehicles/${vehicleId}/live-signals`);
      return data;
    },
    staleTime: 10 * 1000,
    refetchInterval: 10 * 1000,
  });
}
