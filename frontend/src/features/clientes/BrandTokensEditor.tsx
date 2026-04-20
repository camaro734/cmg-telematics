import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { BrandTokens } from '../../lib/types'

interface Props { tenantId: string }

export default function BrandTokensEditor({ tenantId }: Props) {
  const qc = useQueryClient()

  const { data: tokens } = useQuery({
    queryKey: keys.tenantBrandTokens(tenantId),
    queryFn: () => apiClient.get<BrandTokens>(`/api/v1/tenants/${tenantId}/brand-tokens`),
  })

  const [brandColor, setBrandColor] = useState('#F97316')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandName, setBrandName] = useState('')
  const [previewColor, setPreviewColor] = useState('#F97316')

  useEffect(() => {
    if (tokens) {
      setBrandColor(tokens.brand_color ?? '#F97316')
      setPreviewColor(tokens.brand_color ?? '#F97316')
      setLogoUrl(tokens.logo_url ?? '')
      setBrandName(tokens.brand_name ?? '')
    }
  }, [tokens])

  const mutation = useMutation({
    mutationFn: (payload: BrandTokens) =>
      apiClient.put(`/api/v1/tenants/${tenantId}/brand-tokens`, { brand_tokens: payload }),
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: keys.tenantBrandTokens(tenantId) })
      const { user, applyBrandTokens } = useAuthStore.getState()
      if (user?.tenant_id === tenantId) applyBrandTokens(payload)
    },
  })

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Nombre de marca</span>
          <input value={brandName} onChange={e => setBrandName(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Color de acento</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={brandColor}
              onChange={e => { setBrandColor(e.target.value); setPreviewColor(e.target.value) }}
              style={{ width: 36, height: 36, padding: 2, background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, cursor: 'pointer' }}
            />
            <input
              value={brandColor}
              onChange={e => {
                setBrandColor(e.target.value)
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setPreviewColor(e.target.value)
              }}
              style={{ ...inputStyle, fontFamily: 'var(--font-data)', flex: 1 }}
            />
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>URL del logo</span>
          <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
        </label>

        <button
          onClick={() => mutation.mutate({ brand_color: brandColor, logo_url: logoUrl, brand_name: brandName })}
          disabled={mutation.isPending}
          style={{
            background: 'var(--accent-energy)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar'}
        </button>
        {mutation.isSuccess && <p style={{ color: 'var(--accent-ok)', fontSize: 12, margin: 0 }}>Guardado</p>}
      </div>

      <div style={{ width: 180 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 8px' }}>Preview</p>
        <div style={{ background: 'var(--bg-surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)' }}>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bg-border)' }}>
            {logoUrl
              ? <img src={logoUrl} alt="logo" style={{ width: 18, height: 18, objectFit: 'contain' }} />
              : <div style={{ width: 18, height: 18, borderRadius: 4, background: previewColor }} />
            }
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
              {brandName || 'Marca'}
            </span>
          </div>
          {['Flota', 'Alertas', 'Ajustes'].map(label => (
            <div key={label} style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
          ))}
          <div style={{ padding: '6px 10px', fontSize: 11, color: previewColor, background: `${previewColor}22` }}>
            Página activa
          </div>
        </div>
      </div>
    </div>
  )
}
