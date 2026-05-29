import type { CSSProperties } from 'react'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { SettingsOut, TenantOut } from '../../lib/types'

const INPUT: CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
  fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box',
}

const LABEL: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)',
  display: 'block', marginBottom: 4, letterSpacing: '0.05em',
}

export default function NotificationSettings() {
  const user = useAuthStore(s => s.user)
  const isCmg = user?.tenant_tier === 'cmg'

  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState(false)

  const queryClient = useQueryClient()

  const { data: tenants = [] } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    enabled: isCmg,
    staleTime: 60_000,
  })

  const tenantParam = isCmg && selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''
  const settingsKey = keys.settings(isCmg ? (selectedTenantId || undefined) : undefined)

  const { data: settings } = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiClient.get<SettingsOut>(`/api/v1/settings${tenantParam}`),
    enabled: !isCmg || !!selectedTenantId,
  })

  useEffect(() => {
    if (settings !== undefined) setEmail(settings.notification_email ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.tenant_id, settings?.notification_email])

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      apiClient.patch<SettingsOut>(
        `/api/v1/settings${tenantParam}`,
        { notification_email: email.trim() || null },
      ),
    onSuccess: data => {
      queryClient.setQueryData(settingsKey, data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--fg-primary)', marginBottom: 20 }}>
        Notificaciones por email
      </div>

      {isCmg && (
        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>TENANT</label>
          <select
            value={selectedTenantId}
            onChange={e => { setSelectedTenantId(e.target.value); setEmail(''); setSaved(false) }}
            style={INPUT}
          >
            <option value="">Selecciona un tenant…</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {(!isCmg || selectedTenantId) && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>EMAIL DE ALERTAS</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setSaved(false) }}
              placeholder="operaciones@empresa.com"
              style={INPUT}
            />
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>
              Cuando se dispare una alerta, se enviará un aviso a esta dirección. Cada regla puede además tener su propio email específico.
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>
              {(error as Error).message}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => mutate()}
              disabled={isPending}
              style={{
                padding: '7px 20px', fontSize: 13, fontFamily: 'var(--font-sans)',
                background: 'var(--cmg-teal)', border: 'none',
                borderRadius: 6, color: 'var(--bg-base)',
                cursor: isPending ? 'wait' : 'pointer',
              }}
            >
              {isPending ? 'Guardando…' : 'Guardar'}
            </button>
            {saved && (
              <span style={{ color: 'var(--ok)', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
                Guardado
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
