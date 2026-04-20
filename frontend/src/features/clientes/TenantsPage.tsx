import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { TenantOut } from '../../lib/types'

export default function TenantsPage() {
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
  })

  const clients = tenants.filter(t => t.tier !== 'cmg')

  return (
    <Shell title="Clientes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>
            Clientes
          </h2>
          <Link
            to="/clientes/new"
            style={{
              background: 'var(--accent-energy)', color: '#fff',
              borderRadius: 6, padding: '8px 16px', fontSize: 14,
              fontWeight: 500, textDecoration: 'none',
            }}
          >
            + Nuevo cliente
          </Link>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['Nombre', 'Slug', 'Estado', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(tenant => (
                <tr key={tenant.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontSize: 14 }}>{tenant.name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', fontSize: 13 }}>{tenant.slug}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12,
                      background: tenant.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
                      color: tenant.active ? 'var(--accent-ok)' : 'var(--accent-off)',
                    }}>
                      {tenant.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <Link to={`/clientes/${tenant.id}`} style={{ color: 'var(--accent-energy)', fontSize: 13, textDecoration: 'none' }}>
                      Ver detalle →
                    </Link>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '16px 12px', color: 'var(--text-muted)', fontSize: 13 }}>
                    Sin clientes. Crea el primero con "+ Nuevo cliente".
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
