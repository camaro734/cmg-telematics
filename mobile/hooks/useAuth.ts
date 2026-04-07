// Hook de autenticación — carga token desde SecureStore al arrancar
import { useEffect, useState } from 'react';
import { getStoredToken, getStoredUser } from '@/services/auth';
import { useAppStore } from '@/store/useAppStore';

export function useAuth() {
  const { isAuthenticated, user, setAuth, clearAuth } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Restaurar sesión desde SecureStore al arrancar la app
    async function restoreSession() {
      try {
        const [token, storedUser] = await Promise.all([
          getStoredToken(),
          getStoredUser(),
        ]);

        if (token && storedUser) {
          setAuth(storedUser, token);
        } else {
          clearAuth();
        }
      } catch {
        clearAuth();
      } finally {
        setIsLoading(false);
      }
    }

    restoreSession();
  }, [setAuth, clearAuth]);

  return { isAuthenticated, isLoading, user };
}
