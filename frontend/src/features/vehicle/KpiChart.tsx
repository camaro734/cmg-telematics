import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { KpiHour } from '../../lib/types'

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

const BTN_BASE = {
  padding: '4px 14px',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-ui)',
  borderRadius: 4,
  border: '1px solid var(--bg-border)',
  cursor: 'pointer',
  outline: 'none',
  transition: 'background 0.15s',
}

function formatBucket(bucket: string): string {
  const d = new Date(bucket)
  return `${d.getHours()}:00`
}

interface KpiChartProps {
  vehicleId: string
}

export default function KpiChart({ vehicleId }: KpiChartProps) {
  const [hours, setHours] = useState(24)

  const { data: kpis = [], isLoading } = useQuery({
    queryKey: [...keys.vehicleKpis(vehicleId), hours],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?hours=${hours}`),
  })

  const chartData = kpis.map(h => ({
    time: formatBucket(h.bucket),
    pressure: h.avg_pressure_1,
    temp: h.avg_oil_temp,
    pto: h.pto_active_minutes,
  }))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {RANGES.map(r => (
          <button
            key={r.hours}
            onClick={() => setHours(r.hours)}
            style={{
              ...BTN_BASE,
              background: hours === r.hours ? 'var(--accent-energy)' : 'var(--bg-surface)',
              color: hours === r.hours ? 'var(--bg-base)' : 'var(--text-muted)',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          Cargando…
        </div>
      )}

      {!isLoading && chartData.length === 0 && (
        <div style={{
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: '60px 0',
          textAlign: 'center',
          background: 'var(--bg-surface)',
          borderRadius: 8,
          border: '1px solid var(--bg-elevated)',
        }}>
          Sin datos para el período seleccionado
        </div>
      )}

      {!isLoading && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-elevated)" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--bg-border)' }}
            />
            <YAxis
              yAxisId="pressure"
              orientation="left"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'bar', position: 'insideLeft', offset: 10, fill: 'var(--text-muted)', fontSize: 10 }}
            />
            <YAxis
              yAxisId="temp"
              orientation="right"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={false}
              label={{ value: '°C', position: 'insideRight', offset: -10, fill: 'var(--text-muted)', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'var(--font-data)',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}
            />
            <Area
              yAxisId="pressure"
              type="monotone"
              dataKey="pressure"
              name="Presión media (bar)"
              stroke="var(--accent-energy)"
              fill="var(--accent-energy)"
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="temp"
              name="Temp. aceite (°C)"
              stroke="var(--accent-warn)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="pressure"
              type="monotone"
              dataKey="pto"
              name="PTO activo (min)"
              stroke="var(--accent-info)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
