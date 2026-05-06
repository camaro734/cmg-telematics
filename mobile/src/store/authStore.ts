import { create } from 'zustand';
import type { LoginResponse } from '../types';
import * as SecureStore from 'expo-secure-store';

type UserData = Omit<LoginResponse, 'access_token' | 'refresh_token' | 'token_type'>;

interface AuthState {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (data: LoginResponse) => void;
  clearAuth: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (data) => {
    // Separar tokens del objeto usuario — los tokens se guardan en SecureStore
    const { access_token: _at, refresh_token: _rt, token_type: _tt, ...user } = data;
    set({ user, isAuthenticated: true, isLoading: false });
  },

  clearAuth: () => {
    void SecureStore.deleteItemAsync('access_token');
    void SecureStore.deleteItemAsync('refresh_token');
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  checkAuth: async () => {
    const token = await SecureStore.getItemAsync('access_token');
    if (!token) {
      set({ isLoading: false });
      return false;
    }
    // Token existe; la validación real ocurrirá en la primera llamada API
    set({ isAuthenticated: true, isLoading: false });
    return true;
  },
}));
