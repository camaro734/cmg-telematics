import { apiClient } from './client';
import type { Driver } from '../types';

export async function getDrivers(): Promise<Driver[]> {
  const { data } = await apiClient.get<Driver[]>('/api/v1/drivers');
  return data;
}
