import type { HistoricMetricItem, UserPreferences } from './types'

export function resolveVisibleMetrics(
  allMetrics: HistoricMetricItem[],
  prefs: UserPreferences | undefined,
  typeId: string | undefined,
): HistoricMetricItem[] {
  const saved = typeId ? prefs?.historic_metrics?.[typeId] : undefined
  if (!saved) return allMetrics
  return saved.keys
    .map(k => allMetrics.find(m => m.key === k))
    .filter((m): m is HistoricMetricItem => m !== undefined)
}
