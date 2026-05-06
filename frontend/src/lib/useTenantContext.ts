import { create } from 'zustand'

interface TenantContextState {
  activeTenantId: string | null
  activeTenantName: string | null
  setActiveTenant: (id: string | null, name: string | null) => void
}

export const useTenantContext = create<TenantContextState>((set) => ({
  activeTenantId: null,
  activeTenantName: null,
  setActiveTenant: (id, name) => set({ activeTenantId: id, activeTenantName: name }),
}))
