import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import { useReportsTabStore } from './useReportsTabStore'
import { useTenantContext } from '../../lib/useTenantContext'
import type { ReportsTab } from './useReportsTabStore'
import type { TenantOut, VehicleOut, VehicleTypeOut } from '../../lib/types'

export type Period = 'dia' | 'semana' | 'mes' | 'custom'

export const PERIOD_HOURS: Record<Exclude<Period, 'custom'>, number> = {
  dia: 24,
  semana: 168,
  mes: 720,
}

export const PERIOD_LABELS: Record<Period, string> = {
  dia: 'Último día',
  semana: 'Última semana',
  mes: 'Último mes',
  custom: 'Personalizado',
}

export function periodToHours(
  period: Period,
  customFrom: string,
  customTo: string,
): number {
  if (period === 'custom') {
    const ms =
      new Date(customTo + 'T23:59:59').getTime() -
      new Date(customFrom + 'T00:00:00').getTime()
    return Math.max(1, Math.ceil(ms / 3_600_000))
  }
  return PERIOD_HOURS[period]
}

export interface UseReportDataReturn {
  // Auth / user
  isCmg: boolean
  // Navigation
  navigate: ReturnType<typeof useNavigate>
  fromVehicleId: string | null
  // Filter state
  period: Period
  setPeriod: (p: Period) => void
  vehicleId: string
  setVehicleId: (v: string) => void
  tenantId: string
  setTenantId: (v: string) => void
  customFrom: string
  setCustomFrom: (v: string) => void
  customTo: string
  setCustomTo: (v: string) => void
  // Tab state
  tab: ReportsTab
  setTab: (t: ReportsTab) => void
  // Query data
  tenants: TenantOut[]
  vehicles: VehicleOut[]
  vehicleTypes: VehicleTypeOut[]
  selectedVehicle: VehicleOut | undefined
}

export function useReportData(): UseReportDataReturn {
  const user = useAuthStore(s => s.user)
  const isCmg = user?.tenant_tier === 'cmg'
  const location = useLocation()
  const { activeTenantId } = useTenantContext()
  const navigate = useNavigate()

  const { tab, setTab } = useReportsTabStore()

  const [period, setPeriod] = useState<Period>('semana')
  const [vehicleId, setVehicleId] = useState('')
  const [tenantId, setTenantId] = useState('')

  const _todayStr = new Date().toISOString().slice(0, 10)
  const _sevenAgo = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const [customFrom, setCustomFrom] = useState(_sevenAgo)
  const [customTo, setCustomTo] = useState(_todayStr)

  const fromState = useRef(
    location.state as {
      vehicleId?: string
      tab?: string
      tenantId?: string
    } | null,
  ).current
  const fromVehicleId = fromState?.vehicleId ?? null

  // Initialize from navigation state (e.g. from VehicleDetailPage quick-access cards)
  useEffect(() => {
    if (fromState?.tenantId) setTenantId(fromState.tenantId)
    if (fromState?.vehicleId) setVehicleId(fromState.vehicleId)
    if (
      fromState?.tab &&
      ['historico', 'mantenimiento', 'rutas', 'alertas'].includes(fromState.tab)
    ) {
      setTab(fromState.tab as Parameters<typeof setTab>[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Para usuarios CMG: si solo llega vehicleId (sin tenantId), buscar el vehículo para obtener su tenant
  const needVehicleLookup =
    isCmg && Boolean(fromState?.vehicleId) && !fromState?.tenantId
  const { data: navVehicle } = useQuery<VehicleOut>({
    queryKey: ['reports-nav-vehicle', fromState?.vehicleId ?? ''],
    queryFn: () =>
      apiClient.get<VehicleOut>(`/api/v1/vehicles/${fromState!.vehicleId}`),
    enabled: needVehicleLookup,
    staleTime: 300_000,
  })
  useEffect(() => {
    if (navVehicle?.tenant_id && !tenantId) setTenantId(navVehicle.tenant_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navVehicle?.tenant_id])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    enabled: isCmg,
    staleTime: 60_000,
  })

  // TopNav tenant selector overrides the local SelectorBar choice
  useEffect(() => {
    if (isCmg && activeTenantId) setTenantId(activeTenantId)
  }, [activeTenantId, isCmg])

  const effectiveTenantId = isCmg ? (activeTenantId ?? tenantId) : (user?.tenant_id ?? '')

  const { data: vehicles = [] } = useQuery<VehicleOut[]>({
    queryKey: isCmg
      ? keys.vehiclesByTenant(effectiveTenantId)
      : keys.vehicles(),
    queryFn: () =>
      isCmg
        ? apiClient.get<VehicleOut[]>(
            `/api/v1/vehicles?tenant_id=${effectiveTenantId}`,
          )
        : apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    enabled: !isCmg || Boolean(effectiveTenantId),
    staleTime: 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 300_000,
  })

  const selectedVehicle = vehicles.find(v => v.id === vehicleId)

  return {
    isCmg,
    navigate,
    fromVehicleId,
    period,
    setPeriod,
    vehicleId,
    setVehicleId,
    tenantId,
    setTenantId,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    tab,
    setTab,
    tenants,
    vehicles,
    vehicleTypes,
    selectedVehicle,
  }
}
