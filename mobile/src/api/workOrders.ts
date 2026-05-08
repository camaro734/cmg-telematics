import { apiClient } from './client';
import type { WorkOrder, WorkOrderStatus, WorkOrderStop, WorkReportOut } from '../types';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://cmgtrack.com';

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

export async function getWorkOrder(id: string): Promise<WorkOrder> {
  const { data } = await apiClient.get<WorkOrder>(`/api/v1/work-orders/${id}`);
  return data;
}

export async function getWorkOrderStops(id: string): Promise<WorkOrderStop[]> {
  const { data } = await apiClient.get<WorkOrderStop[]>(`/api/v1/work-orders/${id}/stops`);
  return data;
}

export async function changeWorkOrderStatus(
  id: string,
  status: WorkOrderStatus,
): Promise<WorkOrder> {
  const { data } = await apiClient.patch<WorkOrder>(`/api/v1/work-orders/${id}/status`, { status });
  return data;
}

export interface CreateWorkReportPayload {
  description: string | null;
  work_duration_minutes?: number | null;
  signature_data: string | null;
  client_signee_name: string | null;
  client_signee_dni: string | null;
  unsigned_reason: string | null;
}

export async function createWorkReport(
  id: string,
  payload: CreateWorkReportPayload,
): Promise<WorkReportOut> {
  const { data } = await apiClient.post<WorkReportOut>(`/api/v1/work-orders/${id}/report`, payload);
  return data;
}

/**
 * Descarga el PDF del parte y lo abre con el sheet nativo de compartir
 * (WhatsApp / Mail / AirDrop / etc.) para que el operario lo envíe al cliente.
 */
export async function downloadAndShareReportPdf(orderId: string, docNumber: string | null): Promise<void> {
  const token = await SecureStore.getItemAsync('access_token');
  const url = `${BASE_URL}/api/v1/work-orders/${orderId}/report/pdf`;
  const filename = `${docNumber ?? `parte-${orderId.slice(0, 8)}`}.pdf`;
  const targetPath = `${FileSystem.cacheDirectory}${filename}`;

  const result = await FileSystem.downloadAsync(url, targetPath, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (result.status !== 200) {
    throw new Error(`Error al descargar el PDF (HTTP ${result.status})`);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, {
      mimeType: 'application/pdf',
      dialogTitle: docNumber ? `Parte ${docNumber}` : 'Parte de servicio',
      UTI: 'com.adobe.pdf',
    });
  } else {
    throw new Error('Compartir no disponible en este dispositivo');
  }
}

export async function uploadReportPhoto(
  id: string,
  fileUri: string,
): Promise<WorkReportOut> {
  const filename = fileUri.split('/').pop() ?? 'photo.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const formData = new FormData();
  formData.append('file', { uri: fileUri, name: filename, type: mimeType } as unknown as Blob);
  const { data } = await apiClient.post<WorkReportOut>(
    `/api/v1/work-orders/${id}/report/photos`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}
