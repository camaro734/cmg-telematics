// Servicio de autenticación — SecureStore para JWT, nunca AsyncStorage
import * as SecureStore from 'expo-secure-store';
import { api } from './api';
import type { User } from '@/types';

const TOKEN_KEY = 'cmg_jwt';
const USER_KEY = 'cmg_user';

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  await SecureStore.setItemAsync(TOKEN_KEY, data.access_token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
  return data;
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getStoredUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}
