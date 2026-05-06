import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import type { TenantOut, VehicleOut } from '../../lib/types'
import type { Period } from './useReportData'

// ── Style constants (compartidos con ReportsPage) ─────────────────────────────

const btnSecondary: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600,
  fontFamily: 'var(--font-ui)', border: '1px solid var(--bg-border)',
  borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
}

// ── PDF Download button ───────────────────────────────────────────────────────

export function PdfDownloadBtn({
  vehicleId, vehicles, isCmg, tenantId,
}: {
  vehicleId: string
  vehicles: VehicleOut[]
  isCmg: boolean
  tenantId: string
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ]

  async function download() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      if (vehicleId) params.append('vehicle_ids', vehicleId)
      if (isCmg && tenantId) params.append('tenant_id', tenantId)
      const blob = await apiClient.getBlob(`/api/v1/reports/monthly?${params}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe-${year}-${String(month).padStart(2, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al generar el informe')
    } finally {
      setLoading(false)
    }
  }

  const selStyle: React.CSSProperties = {
    fontSize: 12, background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 5, padding: '4px 8px',
    color: 'var(--text-primary)',
  }

  return (
    <div style={{ position: 'relative' }}>
      <button style={{ ...btnSecondary, color: 'var(--accent-energy)', borderColor: 'var(--accent-energy)' }} onClick={() => setOpen(o => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Informe PDF
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 100,
          background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
          borderRadius: 8, padding: 14, minWidth: 240, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Selecciona período</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...selStyle, flex: 1 }}>
              {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={selStyle}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {vehicleId
              ? `Vehículo: ${vehicles.find(v => v.id === vehicleId)?.name ?? vehicleId}`
              : 'Todos los vehículos del tenant'}
          </div>
          <button
            style={{
              ...btnSecondary, justifyContent: 'center',
              background: 'var(--accent-energy)', color: '#fff',
              border: 'none', opacity: loading ? 0.6 : 1,
            }}
            onClick={download}
            disabled={loading}
          >
            {loading ? 'Generando…' : '⬇ Descargar PDF'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── SelectorBar ───────────────────────────────────────────────────────────────

export function SelectorBar({
  isCmg: _isCmg, tenants: _tenants, tenantId: _tenantId, setTenantId: _setTenantId,
  vehicles, vehicleId, setVehicleId,
  period, setPeriod,
  customFrom, customTo, setCustomFrom, setCustomTo,
  pdfSlot, onBack,
}: {
  isCmg: boolean
  tenants: TenantOut[]
  tenantId: string
  setTenantId: (v: string) => void
  vehicles: VehicleOut[]
  vehicleId: string
  setVehicleId: (v: string) => void
  period: Period
  setPeriod: (p: Period) => void
  customFrom: string
  customTo: string
  setCustomFrom: (v: string) => void
  setCustomTo: (v: string) => void
  pdfSlot?: React.ReactNode
  onBack?: () => void
}) {
  const selStyle: React.CSSProperties = {
    fontSize: 12, background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px',
    color: 'var(--text-primary)',
  }
  const dateInputStyle: React.CSSProperties = {
    fontSize: 12, background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 5, padding: '4px 8px',
    color: 'var(--text-primary)',
  }
  const periodBtn = (p: Period): React.CSSProperties => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font-ui)', border: '1px solid var(--bg-border)',
    borderRadius: 20, cursor: 'pointer',
    background: period === p ? 'var(--accent-energy)' : 'transparent',
    color: period === p ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s',
  })
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid var(--bg-border)',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: '1px solid var(--bg-border)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          ‹ Volver
        </button>
      )}

      <select
        value={vehicleId}
        onChange={e => setVehicleId(e.target.value)}
        style={{ ...selStyle, color: vehicleId ? 'var(--text-primary)' : 'var(--text-muted)', minWidth: 180 }}
      >
        <option value="">— Selecciona un vehículo —</option>
        {vehicles.map(v => (
          <option key={v.id} value={v.id}>{v.name}{v.license_plate ? ` (${v.license_plate})` : ''}</option>
        ))}
      </select>

      <div style={{ display: 'flex', gap: 4, marginLeft: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['dia', 'semana', 'mes', 'custom'] as Period[]).map(p => (
          <button key={p} style={periodBtn(p)} onClick={() => setPeriod(p)}>
            {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Personalizado'}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Desde</label>
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={e => {
              const val = e.target.value
              const minAllowed = new Date(new Date(customTo).getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
              setCustomFrom(val < minAllowed ? minAllowed : val)
            }}
            style={dateInputStyle}
          />
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hasta</label>
          <input
            type="date"
            value={customTo}
            max={today}
            onChange={e => {
              const val = e.target.value
              setCustomTo(val)
              const minFrom = new Date(new Date(val).getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
              if (customFrom < minFrom) setCustomFrom(minFrom)
            }}
            style={dateInputStyle}
          />
        </div>
      )}

      <div style={{ marginLeft: 'auto' }}>{pdfSlot}</div>
    </div>
  )
}
