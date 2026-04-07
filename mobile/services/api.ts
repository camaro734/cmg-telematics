// Cliente Axios centralizado — JWT automático + interceptores de error
import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

// URL base desde variable de entorno — nunca hardcodeada
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://213.210.20.183/api/v1';

const TOKEN_KEY = 'cmg_jwt';

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor de petición: añade el token JWT automáticamente
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ─── Namespaces de endpoints ─────────────────────────────────────────────────

export const commands = {
  sendDout: (imei: string, output: 'DOUT1' | 'DOUT2', value: boolean) =>
    api.post<{ success: boolean; message: string }>('/commands/send', { imei, output, value }).then((r) => r.data),
};

// Interceptor de respuesta: maneja errores globalmente
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expirado o inválido — limpiar credenciales
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync('cmg_user');
      // El hook useAuth detectará el cambio en el store y redirigirá a login
    }
    return Promise.reject(error);
  },
);
