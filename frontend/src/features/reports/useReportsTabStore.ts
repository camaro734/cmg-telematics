import { create } from 'zustand'

export type ReportsTab = 'historico' | 'mantenimiento' | 'rutas' | 'alertas'

interface ReportsTabStore {
  tab: ReportsTab
  setTab: (t: ReportsTab) => void
}

export const REPORTS_TABS: { key: ReportsTab; label: string }[] = [
  { key: 'historico',     label: 'HISTÓRICO' },
  { key: 'mantenimiento', label: 'MANTENIMIENTO' },
  { key: 'rutas',         label: 'RUTAS' },
  { key: 'alertas',       label: 'ALERTAS' },
]

export const useReportsTabStore = create<ReportsTabStore>(set => ({
  tab: 'historico',
  setTab: (tab) => set({ tab }),
}))
