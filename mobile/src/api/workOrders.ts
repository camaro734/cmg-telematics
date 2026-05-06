import { apiClient } from './client';
import type { WorkOrder, WorkOrderStatus } from '../types';

export async function getWorkOrders(params?: {
  status?: WorkOrderStatus | 'all';
  limit?: number;
}): Promise<WorkOrder[]> {
  const p: Record<string, string> = {};
  if (params?.status && params.status !== 'all') p.status = params.status;
  if (params?.limit) p.limit = String(params.limit);
  const { data } = await apiClient.get<WorkOrder[]>('/api/v1/work-orders', { params: p });
  return data;
}

export async function changeWorkOrderStatus(
  id: string,
  status: WorkOrderStatus,
): Promise<WorkOrder> {
  const { data } = await apiClient.patch<WorkOrder>(`/api/v1/work-orders/${id}/status`, { status });
  return data;
}
