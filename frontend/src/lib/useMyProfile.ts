import { useQuery } from '@tanstack/react-query'
import { apiClient } from './apiClient'
import { useAuthStore } from '../features/auth/useAuthStore'
import type { MyProfile } from './types'

// Perfil del usuario actual (incluye flags de autogestión del fabricante).
// Se usa para gatear menús/botones que el JWT no transporta.
export function useMyProfile() {
  const token = useAuthStore(s => s.accessToken)
  return useQuery<MyProfile>({
    queryKey: ['me'],
    queryFn: () => apiClient.get<MyProfile>('/api/v1/auth/me'),
    enabled: !!token,
    staleTime: 5 * 60_000,
  })
}
