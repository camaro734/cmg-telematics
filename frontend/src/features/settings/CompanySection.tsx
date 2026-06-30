import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { useAuthStore } from '../auth/useAuthStore'
import type { TenantOut } from '../../lib/types'

/**
 * «Datos de empresa» — el admin del cliente edita el MEMBRETE del emisor de su
 * tenant (razón social, CIF, dirección, teléfono, email, web) que aparecerá en
 * el reporte/parte. Persiste vía el endpoint self-service PATCH /me/tenant/company
 * (el PATCH /tenants/{id} general bloquea editar el propio tenant). El logo se
 * sube con el endpoint ya existente POST /tenants/{id}/logo (no se reimplementa).
 */

// Campos editables del membrete (clave en TenantOut → etiqueta + tipo de input).
const FIELDS: { key: keyof TenantOut; label: string; type?: string; placeholder?: string }[] = [
  { key: 'business_legal_name', label: 'Razón social', placeholder: 'Nombre fiscal de la empresa' },
  { key: 'business_cif', label: 'CIF / NIF', placeholder: 'B-12345678' },
  { key: 'business_address', label: 'Dirección', placeholder: 'Calle, nº, CP, población' },
  { key: 'business_phone', label: 'Teléfono', type: 'tel', placeholder: '+34 960 00 00 00' },
  { key: 'business_email', label: 'Email', type: 'email', placeholder: 'contacto@empresa.com' },
  { key: 'business_website', label: 'Web', type: 'url', placeholder: 'https://empresa.com' },
]

const lbl: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: 'var(--fg-secondary)', marginBottom: 4,
}
const inp: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-primary)',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '7px 10px', width: '100%', boxSizing: 'border-box', outline: 'none',
}

export default function CompanySection() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const baseKey = ['me', 'tenant', 'base'] as const

  const { data: tenant } = useQuery({
    queryKey: baseKey,
    queryFn: () => apiClient.get<TenantOut>('/api/v1/me/tenant/base'),
    staleTime: 60_000,
  })

  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Inicializa el formulario con los datos ya guardados.
  useEffect(() => {
    if (!tenant) return
    setForm(Object.fromEntries(FIELDS.map(f => [f.key, (tenant[f.key] as string | null) ?? ''])))
  }, [tenant])

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch<TenantOut>('/api/v1/me/tenant/company',
        Object.fromEntries(FIELDS.map(f => [f.key, form[f.key]?.trim() || null])),
      ),
    onSuccess: data => {
      queryClient.setQueryData(baseKey, data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return apiClient.postForm<{ logo_url: string }>(`/api/v1/tenants/${user?.tenant_id}/logo`, fd)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: baseKey }),
  })

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--fg-primary)', marginBottom: 8 }}>
        Datos de empresa
      </div>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>
        El membrete del emisor que aparecerá en los reportes y partes. El logo y estos datos identifican a tu empresa.
      </p>

      {/* Logo: preview + subida (endpoint ya existente) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 88, height: 56, borderRadius: 6, border: '1px solid var(--border)',
          background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {tenant?.logo_url
            ? <img src={tenant.logo_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Sin logo</span>}
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploadLogo.isPending}
            style={{
              padding: '6px 14px', fontSize: 13, fontFamily: 'var(--font-sans)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--fg-primary)', cursor: uploadLogo.isPending ? 'wait' : 'pointer',
            }}>
            {uploadLogo.isPending ? 'Subiendo…' : tenant?.logo_url ? 'Cambiar logo' : 'Subir logo'}
          </button>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            PNG, JPG, WebP o SVG · máx. 2 MB
          </div>
          {uploadLogo.error && (
            <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>
              {(uploadLogo.error as Error).message}
            </div>
          )}
        </div>
      </div>

      {/* Campos del membrete */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {FIELDS.map(f => (
          <div key={f.key} style={{ gridColumn: f.key === 'business_address' ? '1 / -1' : undefined }}>
            <div style={lbl}>{f.label}</div>
            <input
              type={f.type ?? 'text'}
              style={inp}
              value={form[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={e => { setForm(s => ({ ...s, [f.key]: e.target.value })); setSaved(false) }}
            />
          </div>
        ))}
      </div>

      {save.error && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>
          {(save.error as Error).message}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          style={{
            padding: '7px 20px', fontSize: 13, fontFamily: 'var(--font-sans)',
            background: 'var(--cmg-teal)', border: 'none', borderRadius: 6, color: 'var(--bg-base)',
            cursor: save.isPending ? 'wait' : 'pointer',
          }}
        >
          {save.isPending ? 'Guardando…' : 'Guardar datos'}
        </button>
        {saved && (
          <span style={{ color: 'var(--ok)', fontSize: 12, fontFamily: 'var(--font-sans)' }}>Guardado</span>
        )}
      </div>
    </div>
  )
}
