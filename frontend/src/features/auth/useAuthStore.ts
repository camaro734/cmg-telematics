// Temporary stub — replaced in Task 4
export const useAuthStore = {
  getState: () => ({
    accessToken: null as string | null,
    refresh: async () => false,
    logout: () => {},
  }),
}
