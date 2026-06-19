import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { BrandTokens } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { toast } from '../../shared/ui/Toast'

interface Props { tenantId: string }

export default function BrandTokensEditor({ tenantId }: Props) {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: tokens } = useQuery({
    queryKey: keys.tenantBrandTokens(tenantId),
    queryFn: () => apiClient.get<BrandTokens>(`/api/v1/tenants/${tenantId}/brand-tokens`),
  })

  const [brandColor, setBrandColor] = useState('#F97316')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [brandName, setBrandName] = useState('')
  const [previewColor, setPreviewColor] = useState('#F97316')
  const [savePending, setSavePending] = useState(false)
  const [uploadPending, setUploadPending] = useState(false)

  useEffect(() => {
    if (tokens) {
      setBrandColor(tokens.brand_color ?? '#F97316')
      setPreviewColor(tokens.brand_color ?? '#F97316')
      setLogoUrl(tokens.logo_url ?? null)
      setBrandName(tokens.brand_name ?? '')
    }
  }, [tokens])

  async function handleSave() {
    setSavePending(true)
    try {
      await apiClient.put(`/api/v1/tenants/${tenantId}/brand-tokens`, {
        brand_tokens: { brand_color: brandColor, brand_name: brandName },
      })
      qc.invalidateQueries({ queryKey: keys.tenantBrandTokens(tenantId) })
      const { user, applyBrandTokens } = useAuthStore.getState()
      if (user?.tenant_id === tenantId) applyBrandTokens({ brand_color: brandColor, brand_name: brandName })
      toast.success('Guardado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSavePending(false)
    }
  }

  async function handleLogoFile(file: File) {
    setUploadPending(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await apiClient.postForm<{ logo_url: string }>(
        `/api/v1/tenants/${tenantId}/logo`,
        form,
      )
      setLogoUrl(result.logo_url)
      qc.invalidateQueries({ queryKey: keys.tenantBrandTokens(tenantId) })
      const { user, applyBrandTokens } = useAuthStore.getState()
      if (user?.tenant_id === tenantId) applyBrandTokens({ logo_url: result.logo_url })
      toast.success('Logo actualizado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al subir el logo')
    } finally {
      setUploadPending(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Nombre de marca" value={brandName} onChange={e => setBrandName(e.target.value)} />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Color de acento</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={brandColor}
              onChange={e => { setBrandColor(e.target.value); setPreviewColor(e.target.value) }}
              style={{ width: 36, height: 36, padding: 2, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
            />
            <Input
              value={brandColor}
              mono
              onChange={e => {
                setBrandColor(e.target.value)
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setPreviewColor(e.target.value)
              }}
              style={{ flex: 1 }}
            />
          </div>
        </label>

        {/* Logo upload */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Logo del cliente</span>
          {logoUrl && (
            <div style={{
              background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 14px',
              border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <img
                src={logoUrl}
                alt="logo actual"
                style={{ maxHeight: 40, maxWidth: 140, objectFit: 'contain' }}
              />
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Logo actual</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleLogoFile(f) }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadPending}
            style={{
              background: 'var(--bg-elevated)', border: '1px dashed var(--border)',
              borderRadius: 8, padding: '10px 16px', cursor: uploadPending ? 'wait' : 'pointer',
              fontSize: 13, color: 'var(--fg-muted)', display: 'flex', alignItems: 'center',
              gap: 8, transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--cmg-teal)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--cmg-teal)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {uploadPending ? 'Subiendo…' : logoUrl ? 'Cambiar logo' : 'Subir logo'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>PNG, JPG, WebP o SVG · máx. 2 MB</span>
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={savePending}
          style={{
            background: 'var(--cmg-teal)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          {savePending ? 'Guardando...' : 'Guardar nombre y color'}
        </button>
      </div>

      <div style={{ width: 180 }}>
        <p style={{ color: 'var(--fg-muted)', fontSize: 12, margin: '0 0 8px' }}>Preview</p>
        <div style={{ background: 'var(--bg-surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)' }}>
            {logoUrl
              ? <img src={logoUrl} alt="logo" style={{ height: 22, maxWidth: 80, objectFit: 'contain' }} />
              : <div style={{ width: 18, height: 18, borderRadius: 4, background: previewColor }} />
            }
            <span style={{ fontSize: 11, color: 'var(--fg-primary)', fontWeight: 600 }}>
              {brandName || 'Marca'}
            </span>
          </div>
          {['Flota', 'Alertas', 'Ajustes'].map(label => (
            <div key={label} style={{ padding: '6px 10px', fontSize: 11, color: 'var(--fg-muted)' }}>{label}</div>
          ))}
          <div style={{ padding: '6px 10px', fontSize: 11, color: previewColor, background: `${previewColor}22` }}>
            Página activa
          </div>
        </div>
      </div>
    </div>
  )
}
