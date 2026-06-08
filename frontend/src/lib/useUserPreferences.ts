import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './apiClient'
import type { UserPreferences, PreferencesPatch } from './types'

const PREFS_KEY = ['userPreferences'] as const

export function useUserPreferences() {
  return useQuery<UserPreferences>({
    queryKey: PREFS_KEY,
    queryFn: () => apiClient.get<UserPreferences>('/api/v1/auth/me/preferences'),
    staleTime: 5 * 60 * 1000,
  })
}

export function usePatchUserPreferences() {
  const queryClient = useQueryClient()
  return useMutation<UserPreferences, Error, PreferencesPatch>({
    mutationFn: (body) =>
      apiClient.patch<UserPreferences>('/api/v1/auth/me/preferences', body),
    onSuccess: (data) => {
      queryClient.setQueryData(PREFS_KEY, data)
    },
  })
}
