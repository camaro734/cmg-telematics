/** Formatea bytes a KB/MB/GB con 1-2 decimales. 0 → "0 B". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const decimals = value >= 100 || i === 0 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[i]}`
}
