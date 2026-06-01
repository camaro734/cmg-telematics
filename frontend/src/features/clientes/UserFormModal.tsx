import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { UserOut, UserCreate, UserUpdate } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

interface Props {
  tenantId: string
  user?: UserOut
  onClose: () => void
}

export default function UserFormModal({ tenantId, user, onClose }: Props) {
  const isEdit = !!user
  const qc = useQueryClient()

  const [email, setEmail] = useState(user?.email ?? '')
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [role, setRole] = useState<UserOut['role']>(user?.role ?? 'operator')
  const [password, setPassword] = useState('')

  const mutation = useMutation({
    mutationFn: (payload: UserCreate | UserUpdate) =>
      isEdit
        ? apiClient.put<UserOut>(`/api/v1/users/${user!.id}`, payload)
        : apiClient.post<UserOut>(`/api/v1/tenants/${tenantId}/users`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clienteUsers(tenantId) })
      onClose()
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit) {
      const payload: UserUpdate = { full_name: fullName, role }
      if (password) payload.password = password
      mutation.mutate(payload)
    } else {
      mutation.mutate({ email, full_name: fullName, role, password } satisfies UserCreate)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, padding: 24,
        width: 400, border: '1px solid var(--border)',
      }}>
        <h3 style={{ margin: '0 0 20px', color: 'var(--fg-primary)', fontSize: 16, fontWeight: 600 }}>
          {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
        </h3>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isEdit && (
            <Input label="Email" type="email" value={email}
              onChange={e => setEmail(e.target.value)} required />
          )}

          <Input label="Nombre completo" value={fullName}
            onChange={e => setFullName(e.target.value)} required />

          <Select label="Rol" value={role} onChange={e => setRole(e.target.value as UserOut['role'])}>
            <option value="admin">Admin</option>
            <option value="operator">Operador</option>
            <option value="viewer">Viewer</option>
            <option value="driver">Conductor</option>
          </Select>

          <Input
            label="Contraseña"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required={!isEdit}
            minLength={8}
            placeholder={isEdit ? '••••••••' : ''}
            helperText={isEdit ? '— dejar en blanco para no cambiar' : undefined}
          />

          {mutation.isError && (
            <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>Error al guardar.</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="submit"
              disabled={mutation.isPending}
              style={{
                flex: 1, background: 'var(--cmg-teal)', color: '#fff',
                border: 'none', borderRadius: 6, padding: '8px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {mutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, background: 'transparent', color: 'var(--fg-muted)',
                border: '1px solid var(--border)', borderRadius: 6, padding: '8px 0', fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
