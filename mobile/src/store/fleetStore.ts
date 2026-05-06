import { create } from 'zustand';
import type { Vehicle } from '../types';

interface FleetState {
  selectedVehicle: Vehicle | null;
  setSelectedVehicle: (v: Vehicle | null) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  selectedVehicle: null,
  setSelectedVehicle: (v) => set({ selectedVehicle: v }),
}));
