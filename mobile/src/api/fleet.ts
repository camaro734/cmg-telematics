import { apiClient } from './client';
import type { Vehicle, VehicleStatusData, KpiData, TrackPoint } from '../types';

export async function getVehicles(): Promise<Vehicle[]> {
  const { data } = await apiClient.get<Vehicle[]>('/api/v1/vehicles');
  return data;
}

export async function getVehicleStatus(vehicleId: string): Promise<VehicleStatusData> {
  const { data } = await apiClient.get<VehicleStatusData>(`/api/v1/vehicles/${vehicleId}/status`);
  return data;
}

export async function getVehicleDetail(vehicleId: string): Promise<Vehicle> {
  const { data } = await apiClient.get<Vehicle>(`/api/v1/vehicles/${vehicleId}`);
  return data;
}

export async function getKpis(vehicleId: string, days: number = 7): Promise<KpiData[]> {
  const { data } = await apiClient.get<KpiData[]>(`/api/v1/vehicles/${vehicleId}/kpis`, {
    params: { days },
  });
  return data;
}

export async function getTrack(vehicleId: string, hours: number = 2): Promise<TrackPoint[]> {
  const { data } = await apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${vehicleId}/track`, {
    params: { hours },
  });
  return data;
}

export async function setDout(vehicleId: string, channel: number, state: boolean): Promise<void> {
  await apiClient.post(`/api/v1/vehicles/${vehicleId}/dout`, { channel, state });
}
