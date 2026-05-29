import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { SkeletonRow } from '../../shared/ui/SkeletonCard'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import type { TenantOut } from '../../lib/types'

export default function TenantsPage() {
  const [showInactive, setShowInactive] = useState(false)
  const qc = useQueryClient()
  const confirmAsk = useConfirm()

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
  })

  const { user } = useAuthStore()
  const isClient = user?.tenant_tier === 'client'
  const isAdmin = user?.role === 'admin'
  const isCmgAdmin = isAdmin && user?.tenant_tier === 'cmg'

  // CMG ve todos excepto sí mismo; client ve solo sus subclientes (filtra su propio tenant)
  const allClients = tenants.filter(t => t.tier !== 'cmg' && (isClient ? t.tier === 'subclient' : true))
  const visible = showInactive ? allClients : allClients.filter(t => t.active)
  const hiddenCount = allClients.filter(t => !t.active).length

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tenants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tenants() }),
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/tenants/${id}/reactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tenants() }),
  })

  async function handleDelete(tenant: TenantOut) {
    const ok = await confirmAsk({
      title: '¿Borrar tenant?',
      message: `"${tenant.name}" quedará inactivo. Sus vehículos y usuarios no se eliminan.`,
      confirmLabel: 'Borrar',
      kind: 'danger',
    })
    if (ok) deleteMutation.mutate(tenant.id)
  }

  async function handleReactivate(tenant: TenantOut) {
    const ok = await confirmAsk({
      title: '¿Reactivar tenant?',
      message: `"${tenant.name}" volverá a estar activo.`,
      confirmLabel: 'Reactivar',
      kind: 'info',
    })
    if (ok) reactivateMutation.mutate(tenant.id)
  }

  return (
    <Shell title="Clientes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, color: 'var(--fg-primary)', fontSize: 20, fontWeight: 600 }}>
            Clientes
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isCmgAdmin && hiddenCount > 0 && (
              <button
                onClick={() => setShowInactive(v => !v)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: showInactive ? 'var(--fg-primary)' : 'var(--fg-muted)',
                  borderRadius: 6, padding: '7px 14px', fontSize: 13,
                  cursor: 'pointer', fontWeight: 500,
                }}
              >
                {showInactive ? `Ocultar inactivos (${hiddenCount})` : `Ver inactivos (${hiddenCount})`}
              </button>
            )}
            {isAdmin && (
              <Link
                to="/clientes/new"
                style={{
                  background: 'var(--cmg-teal)', color: '#fff',
                  borderRadius: 6, padding: '8px 16px', fontSize: 14,
                  fontWeight: 500, textDecoration: 'none',
                }}
              >
                + Nuevo cliente
              </Link>
            )}
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0,1,2].map(i => <SkeletonRow key={i} height={44} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nombre', 'Slug', 'Estado', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(tenant => (
                <tr key={tenant.id} style={{ borderBottom: '1px solid var(--border)', opacity: tenant.active ? 1 : 0.6 }}>
                  <td style={{ padding: '10px 12px', color: 'var(--fg-primary)', fontSize: 14 }}>
                    {tenant.name}
                    {' '}
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, marginLeft: 4,
                      ...(tenant.tier === 'manufacturer'
                        ? { background: 'rgba(56,189,248,0.15)', color: 'var(--info)' }
                        : tenant.tier === 'subclient'
                        ? { background: 'rgba(120,113,108,0.15)', color: 'var(--offline)' }
                        : { background: 'rgba(249,115,22,0.15)', color: 'var(--cmg-teal)' }),
                    }}>
                      {tenant.tier === 'manufacturer' ? 'Fabricante' : tenant.tier === 'subclient' ? 'Subcliente' : 'Cliente'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{tenant.slug}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12,
                      background: tenant.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
                      color: tenant.active ? 'var(--ok)' : 'var(--offline)',
                    }}>
                      {tenant.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link to={`/clientes/${tenant.id}`} style={{ color: 'var(--cmg-teal)', fontSize: 13, textDecoration: 'none' }}>
                      Ver detalle →
                    </Link>
                    {isCmgAdmin && tenant.active && (
                      <button
                        onClick={() => handleDelete(tenant)}
                        disabled={deleteMutation.isPending}
                        style={{
                          marginLeft: 12, background: 'transparent',
                          border: '1px solid rgba(239,68,68,0.4)',
                          color: 'var(--danger)', borderRadius: 4,
                          padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                        }}
                      >
                        Borrar
                      </button>
                    )}
                    {isCmgAdmin && !tenant.active && (
                      <button
                        onClick={() => handleReactivate(tenant)}
                        disabled={reactivateMutation.isPending}
                        style={{
                          marginLeft: 12, background: 'transparent',
                          border: '1px solid rgba(34,197,94,0.4)',
                          color: 'var(--ok)', borderRadius: 4,
                          padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                        }}
                      >
                        Reactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '16px 12px', color: 'var(--fg-muted)', fontSize: 13 }}>
                    {showInactive ? 'No hay tenants inactivos.' : 'Sin clientes. Crea el primero con "+ Nuevo cliente".'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  )
}
