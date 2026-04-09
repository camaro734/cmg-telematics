// Layout raíz — QueryClient + Zustand + GestureHandler + redirección auth
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/useAuth';

// Captura errores JS no manejados y los muestra como Alert (útil en Release)
const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
  Alert.alert(
    isFatal ? '💥 Error fatal' : '⚠️ Error',
    error?.message ?? String(error),
    [{ text: 'OK' }],
  );
  originalHandler(error, isFatal);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

// Componente interno que accede a los hooks de routing
function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // No autenticado → login
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Autenticado pero en login → dashboard
      router.replace('/(tabs)/');
    }
  }, [isAuthenticated, isLoading, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" backgroundColor="#0f1117" />
        <RootLayoutNav />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
