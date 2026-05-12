import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import UserFormModal from './UserFormModal'
import GrantsSection from './GrantsSection'
import BrandTokensEditor from './BrandTokensEditor'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import type { TenantOut, UserOut, VehicleOut } from '../../lib/types'

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: 20, border: '1px solid var(--bg-border)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  )
}

function PortalTokenSection({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient()
  const confirmAsk = useConfirm()
  const [copied, setCopied] = useState(false)

  const { data } = useQuery({
    queryKey: ['portal-token', tenantId],
    queryFn: () => apiClient.get<{ portal_access_token: string | null }>(`/api/v1/tenants/${tenantId}/portal-token`),
  })

  const { mutate: generate, isPending } = useMutation({
    mutationFn: () => apiClient.post<{ portal_access_token: string }>(`/api/v1/tenants/${tenantId}/portal-token`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-token', tenantId] }),
  })

  const token = data?.portal_access_token
  const portalUrl = token ? `${window.location.origin}/portal/${token}` : null

  function copyUrl() {
    if (!portalUrl) return
    navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SectionCard title="Portal del cliente">
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        URL pública para que el cliente vea el estado de sus vehículos y órdenes sin necesidad de login.
      </p>
      {token ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              readOnly
              value={portalUrl!}
              style={{
                flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
                borderRadius: 6, color: 'var(--text-muted)', fontFamily: 'var(--font-data)',
                fontSize: 12, padding: '7px 10px',
              }}
            />
            <button
              onClick={copyUrl}
              style={{
                padding: '7px 14px', borderRadius: 6, border: '1px solid var(--bg-border)',
                background: copied ? 'var(--accent-ok)' : 'var(--bg-elevated)',
                color: copied ? '#fff' : 'var(--text-muted)',
                fontFamily: 'var(--font-ui)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <a
              href={portalUrl!}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '7px 14px', borderRadius: 6, border: '1px solid var(--bg-border)',
                background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                fontFamily: 'var(--font-ui)', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Abrir →
            </a>
          </div>
          <button
            onClick={async () => { if (await confirmAsk({ title: 'Regenerar token', message: '¿Regenerar el token? El enlace anterior dejará de funcionar.', confirmLabel: 'Regenerar', kind: 'warning' })) generate() }}
            style={{
              alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 6,
              border: '1px solid var(--bg-border)', background: 'var(--bg-elevated)',
              color: 'var(--accent-warn)', fontFamily: 'var(--font-ui)', fontSize: 12, cursor: 'pointer',
            }}
          >
            Regenerar token
          </button>
        </div>
      ) : (
        <button
          onClick={() => generate()}
          disabled={isPending}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: 'var(--accent-energy)', color: '#fff',
            fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            opacity: isPending ? 0.7 : 1,
          }}
        >
          {isPending ? 'Generando…' : 'Generar enlace de portal'}
        </button>
      )}
    </SectionCard>
  )
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserOut | undefined>()

  const { data: tenant, isLoading } = useQuery({
    queryKey: keys.cliente(id!),
    queryFn: () => apiClient.get<TenantOut>(`/api/v1/tenants/${id}`),
  })

  const { data: users = [] } = useQuery({
    queryKey: keys.clienteUsers(id!),
    queryFn: () => apiClient.get<UserOut[]>(`/api/v1/tenants/${id}/users`),
    enabled: !!id,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.clienteVehicles(id!),
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles?tenant_id=${id}`),
    enabled: !!id,
  })

  const deactivateUser = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/v1/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteUsers(id!) }),
  })

  if (isLoading) {
    return <Shell title="Cliente"><p style={{ padding: 24, color: 'var(--text-muted)' }}>Cargando...</p></Shell>
  }
  if (!tenant) {
    return <Shell title="Cliente"><p style={{ padding: 24, color: 'var(--text-muted)' }}>Cliente no encontrado</p></Shell>
  }

  return (
    <Shell title={tenant.name}>
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>

        {/* 1. Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--text-primary)', fontSize: 22, fontWeight: 700 }}>{tenant.name}</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-data)' }}>{tenant.slug}</span>
            <span style={{
              marginLeft: 10, display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12,
              background: tenant.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
              color: tenant.active ? 'var(--accent-ok)' : 'var(--accent-off)',
            }}>
              {tenant.active ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <Link
            to={`/clientes/${id}/edit`}
            style={{
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--bg-border)', borderRadius: 6,
              padding: '7px 14px', fontSize: 13, textDecoration: 'none',
            }}
          >
            Editar
          </Link>
        </div>

        {/* 2. Usuarios */}
        <SectionCard title="Usuarios">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['Email', 'Nombre', 'Rol', 'Estado', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)' }}>{u.email}</td>
                  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{u.full_name}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{u.role}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 11,
                      background: u.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
                      color: u.active ? 'var(--accent-ok)' : 'var(--accent-off)',
                    }}>
                      {u.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button
                      onClick={() => { setEditingUser(u); setShowUserModal(true) }}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-energy)', fontSize: 12, cursor: 'pointer', marginRight: 8 }}
                    >
                      Editar
                    </button>
                    {u.active && (
                      <button
                        onClick={() => deactivateUser.mutate(u.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', fontSize: 12, cursor: 'pointer' }}
                      >
                        Desactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 13 }}>Sin usuarios</td></tr>
              )}
            </tbody>
          </table>
          <button
            onClick={() => { setEditingUser(undefined); setShowUserModal(true) }}
            style={{
              background: 'var(--accent-energy)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            + Añadir usuario
          </button>
        </SectionCard>

        {/* 3. Vehículos */}
        <SectionCard title="Vehículos">
          {vehicles.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 10px' }}>Sin vehículos asignados</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  {['Nombre', 'Matrícula'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)' }}>{v.name}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                      {v.license_plate ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link to={`/fleet?tenant=${id}`} style={{ color: 'var(--accent-energy)', fontSize: 13, textDecoration: 'none' }}>
            Ver en Flota →
          </Link>
        </SectionCard>

        {/* 4. Permission Grants */}
        <SectionCard title="Permission Grants">
          <GrantsSection tenantId={id!} />
        </SectionCard>

        {/* 5. White-label */}
        <SectionCard title="White-label">
          <BrandTokensEditor tenantId={id!} />
        </SectionCard>

        {/* 6. Portal cliente */}
        <PortalTokenSection tenantId={id!} />

      </div>

      {showUserModal && (
        <UserFormModal
          tenantId={id!}
          user={editingUser}
          onClose={() => { setShowUserModal(false); setEditingUser(undefined) }}
        />
      )}
    </Shell>
  )
}
