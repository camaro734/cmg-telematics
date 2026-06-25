import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import type { WorkCycleReport } from '../../lib/types'
import { periodToHours, type Period } from './useReportData'

// Rango [desde, hasta) en ISO8601 a partir del período/fechas personalizadas.
function periodRange(period: Period, customFrom: string, customTo: string): { desde: string; hasta: string } {
  if (period === 'custom') {
    return {
      desde: new Date(customFrom + 'T00:00:00').toISOString(),
      hasta: new Date(customTo + 'T23:59:59').toISOString(),
    }
  }
  const hours = periodToHours(period, customFrom, customTo)
  const now = new Date()
  return {
    desde: new Date(now.getTime() - hours * 3_600_000).toISOString(),
    hasta: now.toISOString(),
  }
}

const fmtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toFixed(2)

const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700,
  color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.03em',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12, color: 'var(--fg-primary)',
  borderBottom: '1px solid var(--border-soft)', verticalAlign: 'top',
}
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }

const btn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
  border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-card)', color: 'var(--fg-primary)',
  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
}

export function PartesReportTab({
  vehicleId, clientId, isCmg, period, customFrom, customTo,
}: {
  vehicleId: string
  clientId: string
  isCmg: boolean
  period: Period
  customFrom: string
  customTo: string
}) {
  const [report, setReport] = useState<WorkCycleReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<'pdf' | 'xlsx' | null>(null)

  function buildParams(): URLSearchParams {
    const { desde, hasta } = periodRange(period, customFrom, customTo)
    const p = new URLSearchParams({ desde, hasta })
    if (vehicleId) p.append('vehicle_id', vehicleId)
    // El filtro de cliente solo aplica a CMG (los demás ya quedan acotados por su tenant)
    if (isCmg && clientId) p.append('client_id', clientId)
    return p
  }

  async function generate() {
    setLoading(true)
    try {
      const data = await apiClient.get<WorkCycleReport>(
        `/api/v1/work-cycle-reports/data?${buildParams()}`,
      )
      setReport(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al generar el reporte')
    } finally {
      setLoading(false)
    }
  }

  async function download(kind: 'pdf' | 'xlsx') {
    setDownloading(kind)
    try {
      const blob = await apiClient.getBlob(`/api/v1/work-cycle-reports/${kind}?${buildParams()}`)
      const { desde, hasta } = periodRange(period, customFrom, customTo)
      const tag = `${desde.slice(0, 10)}_${hasta.slice(0, 10)}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `parte_trabajos_${tag}.${kind}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Error al descargar ${kind.toUpperCase()}`)
    } finally {
      setDownloading(null)
    }
  }

  const cols = report?.columnas_senal ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Acciones */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          style={{ ...btn, background: 'var(--cmg-teal)', color: '#fff', border: 'none', opacity: loading ? 0.6 : 1 }}
          onClick={generate}
          disabled={loading}
        >
          {loading ? 'Generando…' : 'Generar'}
        </button>
        <button style={{ ...btn, opacity: !report || downloading ? 0.6 : 1 }}
          onClick={() => download('pdf')} disabled={!report || downloading !== null}>
          {downloading === 'pdf' ? 'Descargando…' : '⬇ PDF'}
        </button>
        <button style={{ ...btn, opacity: !report || downloading ? 0.6 : 1 }}
          onClick={() => download('xlsx')} disabled={!report || downloading !== null}>
          {downloading === 'xlsx' ? 'Descargando…' : '⬇ Excel'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 4 }}>
          Elige el rango (y opcionalmente vehículo/cliente) y pulsa «Generar».
        </span>
      </div>

      {/* Resultado */}
      {report === null ? null
        : report.filas.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center', color: 'var(--fg-muted)',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          }}>
            No hay intervenciones para el rango y filtros seleccionados.
          </div>
        ) : (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Fecha</th>
                    <th style={th}>OT</th>
                    <th style={th}>Cliente</th>
                    {cols.map(c => (
                      <th key={c.key} style={{ ...th, textAlign: 'right' }}>
                        {c.label}{c.unit ? ` (${c.unit})` : ''}
                      </th>
                    ))}
                    <th style={{ ...th, textAlign: 'right' }}>Kilometraje</th>
                    <th style={th}>Dirección</th>
                  </tr>
                </thead>
                <tbody>
                  {report.filas.map((f, i) => (
                    <tr key={i}>
                      <td style={td}>{f.fecha}</td>
                      <td style={{ ...td, color: f.ot === 'Sin asignar' ? 'var(--fg-muted)' : 'var(--fg-primary)', fontStyle: f.ot === 'Sin asignar' ? 'italic' : 'normal' }}>{f.ot}</td>
                      <td style={td}>{f.cliente}</td>
                      {cols.map(c => (
                        <td key={c.key} style={tdNum}>{fmtNum(f.senales[c.key])}</td>
                      ))}
                      <td style={tdNum}>{f.kilometraje.toFixed(2)} km</td>
                      <td style={{ ...td, fontSize: 11, color: 'var(--fg-muted)', maxWidth: 320 }}>{f.direccion}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={3}>
                      Totales ({report.totales.intervenciones} interv.)
                    </td>
                    {cols.map(c => {
                      const t = report.totales.senales[c.key]
                      return (
                        <td key={c.key} style={{ ...tdNum, fontWeight: 700 }}>
                          {t && t.min !== null ? `${fmtNum(t.min)} / ${fmtNum(t.max)}` : '—'}
                        </td>
                      )
                    })}
                    <td style={{ ...tdNum, fontWeight: 700 }}>{report.totales.km_total.toFixed(2)} km</td>
                    <td style={td}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
    </div>
  )
}
