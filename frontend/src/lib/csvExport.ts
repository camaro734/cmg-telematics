type CsvValue = string | number | boolean | null | undefined

function escapeCsv(value: CsvValue): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function exportToCsv(filename: string, rows: Record<string, CsvValue>[]): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escapeCsv(row[h])).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  try {
    document.body.removeChild(a)
  } catch {
    // In test environment, removeChild might fail due to mocking
  }
  URL.revokeObjectURL(url)
}
