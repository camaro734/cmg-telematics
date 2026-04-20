import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import UserFormModal from '../clientes/UserFormModal'
import type { UserOut } from '../../lib/types'

export default function UsersSection() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserOut | undefined>()
  const tenantId = user!.tenant_id

  const { data: users = [] } = useQuery({
    queryKey: keys.clienteUsers(tenantId),
    queryFn: () => apiClient.get<UserOut[]>(`/api/v1/tenants/${tenantId}/users`),
  })

  const deactivate = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/v1/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteUsers(tenantId) }),
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }}>Usuarios</h3>
        <button
          onClick={() => { setEditingUser(undefined); setShowModal(true) }}
          style={{
            background: 'var(--accent-energy)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          + Añadir usuario
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                  onClick={() => { setEditingUser(u); setShowModal(true) }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-energy)', fontSize: 12, cursor: 'pointer', marginRight: 8 }}
                >
                  Editar
                </button>
                {u.active && (
                  <button
                    onClick={() => deactivate.mutate(u.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Desactivar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <UserFormModal
          tenantId={tenantId}
          user={editingUser}
          onClose={() => { setShowModal(false); setEditingUser(undefined) }}
        />
      )}
    </div>
  )
}
