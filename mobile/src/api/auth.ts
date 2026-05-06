import { apiClient } from './client';
import type { LoginResponse } from '../types';
import * as SecureStore from 'expo-secure-store';

export async function login(email: string, password: string): Promise<LoginResponse> {
  // El endpoint espera application/x-www-form-urlencoded con campos username/password
  const params = new URLSearchParams();
  params.append('username', email);
  params.append('password', password);
  const { data } = await apiClient.post<LoginResponse>('/api/v1/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  await SecureStore.setItemAsync('access_token', data.access_token);
  await SecureStore.setItemAsync('refresh_token', data.refresh_token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post('/api/v1/auth/logout');
  } finally {
    // Siempre limpiar tokens locales independientemente de la respuesta del servidor
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
  }
}
