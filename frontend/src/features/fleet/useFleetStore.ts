import { create } from 'zustand'

interface FleetStore {
  selectedId: string | null
  setSelected: (id: string | null) => void
}

export const useFleetStore = create<FleetStore>(set => ({
  selectedId: null,
  setSelected: id => set({ selectedId: id }),
}))
