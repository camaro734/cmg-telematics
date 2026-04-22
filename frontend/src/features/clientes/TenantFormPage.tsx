import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { TenantOut, TenantCreate, TenantUpdate } from '../../lib/types'

export default function TenantFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [active, setActive] = useState(true)
  const [formModules, setFormModules] = useState<string[]>([])

  const { data: tenant } = useQuery({
    queryKey: keys.cliente(id!),
    queryFn: () => apiClient.get<TenantOut>(`/api/v1/tenants/${id}`),
    enabled: isEdit,
  })

  useEffect(() => {
    if (tenant) {
      setName(tenant.name)
      setSlug(tenant.slug)
      setActive(tenant.active)
      setFormModules(tenant.enabled_modules ?? [])
    }
  }, [tenant])

  const mutation = useMutation({
    mutationFn: (payload: TenantCreate | TenantUpdate) =>
      isEdit
        ? apiClient.put<TenantOut>(`/api/v1/tenants/${id}`, payload)
        : apiClient.post<TenantOut>('/api/v1/tenants', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tenants() })
      if (isEdit) qc.invalidateQueries({ queryKey: keys.cliente(id!) })
      navigate('/clientes')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit) {
      mutation.mutate({ name: name.trim(), slug: slug.trim(), active, enabled_modules: formModules } satisfies TenantUpdate)
    } else {
      mutation.mutate({
        parent_id: user!.tenant_id,
        tier: 'client',
        name: name.trim(),
        slug: slug.trim(),
      } satisfies TenantCreate)
    }
  }

  const AVAILABLE_MODULES = [
    { key: 'fleet',       label: 'Flota' },
    { key: 'alerts',      label: 'Alertas' },
    { key: 'maintenance', label: 'Mantenimiento' },
    { key: 'reports',     label: 'Reportes' },
  ]

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box',
  }

  return (
    <Shell title={isEdit ? 'Editar cliente' : 'Nuevo cliente'}>
      <div style={{ padding: 24, maxWidth: 480 }}>
        <h2 style={{ margin: '0 0 24px', color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>
          {isEdit ? 'Editar cliente' : 'Nuevo cliente'}
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nombre</span>
            <input value={name} onChange={e => setName(e.target.value)} required style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Slug (identificador único)</span>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              required
              style={{ ...inputStyle, fontFamily: 'var(--font-data)' }}
            />
          </label>

          {isEdit && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>Activo</span>
            </label>
          )}

          {isEdit && tenant && (tenant.tier === 'client' || tenant.tier === 'subclient') && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Módulos habilitados
              </div>
              {AVAILABLE_MODULES.map(m => (
                <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formModules.includes(m.key)}
                    onChange={e => {
                      if (e.target.checked) {
                        setFormModules(prev => [...prev, m.key])
                      } else {
                        setFormModules(prev => prev.filter(k => k !== m.key))
                      }
                    }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-default)' }}>{m.label}</span>
                </label>
              ))}
            </div>
          )}

          {mutation.isError && (
            <p style={{ color: 'var(--accent-crit)', fontSize: 13, margin: 0 }}>
              Error al guardar. Verifica que el slug sea único.
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              type="submit"
              disabled={mutation.isPending}
              style={{
                background: 'var(--accent-energy)', color: '#fff', border: 'none',
                borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {mutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/clientes')}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--bg-border)', borderRadius: 6,
                padding: '9px 20px', fontSize: 14, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </Shell>
  )
}
