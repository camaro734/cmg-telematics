import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { MaintenanceThreshold } from '../../lib/types'
import { Input } from '../../shared/ui/Input'

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'Horas PTO',
  engine_hours: 'Horas motor',
  calendar_days: 'Días calendario',
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

interface Props {
  planId: string
  thresholds: MaintenanceThreshold[]
  onClose: () => void
}

export default function LogInterventionModal({ planId, thresholds, onClose }: Props) {
  const qc = useQueryClient()
  const [description, setDescription] = useState('')
  const [costEur, setCostEur] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (formData: FormData) =>
      apiClient.postForm(`/api/v1/maintenance/plans/${planId}/logs`, formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
      qc.invalidateQueries({ queryKey: keys.maintenanceLogs(planId) })
      onClose()
    },
    onError: () => setError('Error al registrar la intervención'),
  })

  function toggle(type: string) {
    setSelected(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFileError(null)
    if (f) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setFileError('Formato no válido. Use PDF, JPEG, PNG o WEBP.')
        return
      }
      if (f.size > 5 * 1024 * 1024) {
        setFileError('El archivo supera el límite de 5 MB.')
        return
      }
    }
    setFile(f)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('performed_at', new Date().toISOString())
    if (description.trim()) fd.append('description', description.trim())
    fd.append('reset_counters', JSON.stringify(selected))
    if (costEur) fd.append('cost_eur', costEur)
    if (file) fd.append('file', file)
    mutation.mutate(fd)
  }

  const inputStyle = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    color: 'var(--fg-primary)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 10, padding: 24, width: 420, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 20 }}>
          Registrar intervención
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
                CONTADORES A RESETEAR
              </div>
              {thresholds.map(t => (
                <label key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    aria-label={THRESHOLD_LABEL[t.type] ?? t.type}
                    checked={selected.includes(t.type)}
                    onChange={() => toggle(t.type)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--fg-primary)' }}>
                    {THRESHOLD_LABEL[t.type] ?? t.type}
                  </span>
                </label>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>DESCRIPCIÓN</div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ej: Cambio aceite SAE 46, filtro hidráulico…"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>COSTE (€)</div>
              <Input
                type="number"
                value={costEur}
                onChange={e => setCostEur(e.target.value)}
                placeholder="0.00"
                min={0}
                step={0.01}
                style={{ width: 120 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>
                DOCUMENTO <span style={{ fontWeight: 400, textTransform: 'none' }}>(factura / albarán)</span>
              </div>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handleFile}
                style={{ fontSize: 12, color: 'var(--fg-primary)', width: '100%' }}
              />
              {file && !fileError && (
                <div style={{ fontSize: 11, color: 'var(--cmg-teal)', marginTop: 4 }}>{file.name}</div>
              )}
              {fileError && (
                <div style={{ fontSize: 11, color: 'var(--accent-crit)', marginTop: 4 }}>{fileError}</div>
              )}
            </div>

            {error && <div style={{ color: 'var(--accent-crit)', fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--fg-muted)', borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={mutation.isPending || !!fileError}
                style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: (mutation.isPending || !!fileError) ? 'not-allowed' : 'pointer' }}
              >
                {mutation.isPending ? 'Guardando…' : 'Registrar'}
              </button>
            </div>

          </div>
        </form>
      </div>
    </div>
  )
}
