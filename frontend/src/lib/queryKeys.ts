export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleStatus: (id: string) => ['vehicles', id, 'status'] as const,
  vehicleTrack: (id: string) => ['vehicles', id, 'track'] as const,
  vehicleKpis: (id: string) => ['vehicles', id, 'kpis'] as const,
  alerts: () => ['alerts'] as const,
  rules: () => ['rules'] as const,
  tenantBrandTokens: (tenantId: string) => ['tenants', tenantId, 'brand-tokens'] as const,
}
