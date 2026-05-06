import { apiClient } from './client';
import type { Alert } from '../types';

export async function getAlerts(params?: { vehicle_id?: string; status?: string }): Promise<Alert[]> {
  const { data } = await apiClient.get<Alert[]>('/api/v1/alerts', { params });
  return data;
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  await apiClient.post(`/api/v1/alerts/${alertId}/acknowledge`);
}
