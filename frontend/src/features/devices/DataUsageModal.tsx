import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { ValueType, Payload } from 'recharts/types/component/DefaultTooltipContent'
import { apiClient } from '../../lib/apiClient'
import type { DataUsageMonth } from '../../lib/types'
import { formatBytes } from '../../lib/format'

interface Props {
  deviceId: string
  imei: string
  onClose: () => void
}

interface ChartEntry {
  mes: string
  mb: number
  bytes: number
}

export function DataUsageModal({ deviceId, imei, onClose }: Props) {
  const { data, isLoading } = useQuery<DataUsageMonth[]>({
    queryKey: ['devices', deviceId, 'data-usage'],
    queryFn: () => apiClient.get<DataUsageMonth[]>(`/api/v1/devices/${deviceId}/data-usage`),
  })

  const chartData: ChartEntry[] = (data ?? []).map(d => ({
    mes: d.year_month,
    mb: +(d.bytes / (1024 * 1024)).toFixed(2),
    bytes: d.bytes,
  }))

  function tooltipFormatter(
    _value: ValueType,
    _name: string,
    item: Payload<ValueType, string>,
  ): [string, string] {
    const entry = item.payload as ChartEntry
    return [formatBytes(entry.bytes), 'Consumo']
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 560, maxWidth: '90vw' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Consumo de datos (estimado)</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>{imei}</div>
        {isLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Cargando…</div>
        ) : chartData.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Sin datos de consumo todavía.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <XAxis dataKey="mes" tick={{ fill: 'var(--fg-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--fg-muted)', fontSize: 11 }} unit=" MB" width={60} />
              <Tooltip
                formatter={tooltipFormatter}
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="mb" fill="var(--gauge-fill)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
