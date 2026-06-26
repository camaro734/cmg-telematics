import { create } from 'zustand'

interface FleetStore {
  selectedId: string | null
  // Contador que se incrementa en cada selección con id no nulo. Permite al mapa
  // reactivar el seguimiento (follow) aunque se re-seleccione el MISMO vehículo.
  selectTick: number
  setSelected: (id: string | null) => void
}

export const useFleetStore = create<FleetStore>(set => ({
  selectedId: null,
  selectTick: 0,
  setSelected: id => set(s => ({ selectedId: id, selectTick: id ? s.selectTick + 1 : s.selectTick })),
}))
