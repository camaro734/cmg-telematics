const pulse = `
@keyframes cmg-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`
function injectPulseCSS() {
  if (typeof document === 'undefined' || document.getElementById('cmg-skeleton-pulse')) return
  const s = document.createElement('style')
  s.id = 'cmg-skeleton-pulse'
  s.textContent = pulse
  document.head.appendChild(s)
}

interface Props { width?: number | string; height?: number }

export function SkeletonCard({ width = '100%', height = 140 }: Props) {
  injectPulseCSS()
  return (
    <div style={{
      width, height, minWidth: typeof width === 'number' ? width : undefined,
      background: 'var(--bg-surface)',
      border: '2px solid var(--bg-border)',
      borderRadius: 8,
      animation: 'cmg-skeleton-pulse 1.4s ease-in-out infinite',
    }} />
  )
}

export function SkeletonRow({ height = 56 }: { height?: number }) {
  injectPulseCSS()
  return (
    <div style={{
      width: '100%', height,
      background: 'var(--bg-surface)',
      border: '1px solid var(--bg-border)',
      borderRadius: 8,
      animation: 'cmg-skeleton-pulse 1.4s ease-in-out infinite',
    }} />
  )
}
