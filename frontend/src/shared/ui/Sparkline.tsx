import { useId } from 'react'

interface SparklineProps {
  values: number[]
  w?: number
  h?: number
  color?: string
}

export function Sparkline({ values, w = 72, h = 24, color = 'var(--cmg-teal)' }: SparklineProps) {
  const uid = useId()
  const gradId = `sg-${uid.replace(/:/g, '')}`

  if (!values || values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = 2
  const iw = w - pad * 2
  const ih = h - pad * 2

  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * iw,
    pad + ih - ((v - min) / range) * ih,
  ] as [number, number])

  const polylineStr = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const fillStr = `${pad},${pad + ih} ${polylineStr} ${pad + iw},${pad + ih}`

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradId})`} points={fillStr} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylineStr}
      />
    </svg>
  )
}
