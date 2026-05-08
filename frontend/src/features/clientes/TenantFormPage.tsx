import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { TenantOut, TenantCreate, TenantUpdate } from '../../lib/types'

const WIZARD_STEPS = [
  {
    num: 1,
    title: 'Configura la plantilla de vehículo',
    description: 'Define los tipos de vehículo del cliente: sensores CAN, umbrales de mantenimiento y configuración de salidas digitales.',
    cta: 'Ir a Tipos de vehículo',
    path: '/tipos-vehiculo',
    icon: '⚙',
  },
  {
    num: 2,
    title: 'Añade el primer vehículo',
    description: 'Crea el primer vehículo y asígnale el tipo que acabas de configurar. Puedes añadir más desde la sección Flota.',
    cta: 'Ir a Vehículos',
    path: '/vehiculos',
    icon: '🚛',
  },
  {
    num: 3,
    title: 'Conecta el dispositivo GPS',
    description: 'Vincula el IMEI del FMC650 al vehículo. El dispositivo debe apuntar a cmgtrack.com puerto 5027 (TCP).',
    cta: 'Ir a Dispositivos',
    path: '/devices',
    icon: '📡',
  },
]

function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const current = WIZARD_STEPS[step]
  const isLast = step === WIZARD_STEPS.length - 1

  function goNext() {
    if (isLast) { onClose() } else { setStep(s => s + 1) }
  }
  function goTo(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: '32px 28px 24px', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: 'var(--accent-energy)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Cliente creado correctamente
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Configuración inicial</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Sigue estos pasos para que el cliente empiece a recibir datos.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {WIZARD_STEPS.map((s, i) => (
            <div key={s.num} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--accent-energy)' : 'var(--bg-elevated)', transition: 'background 0.2s' }} />
          ))}
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: '20px 18px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-surface)', border: '2px solid var(--accent-energy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
              {current.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Paso {current.num} de {WIZARD_STEPS.length}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{current.title}</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{current.description}</p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button onClick={() => goTo(current.path)} style={{ flex: 1, background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {current.cta}
          </button>
          <button onClick={goNext} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--bg-border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>
            {isLast ? 'Finalizar' : 'Siguiente'}
          </button>
        </div>

        <div style={{ textAlign: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: '4px 8px' }}>
            Configurar más tarde
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [showWizard, setShowWizard] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [createUser, setCreateUser] = useState(true)
  const [businessCif, setBusinessCif] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')

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
      setBusinessCif(tenant.business_cif ?? '')
      setBusinessAddress(tenant.business_address ?? '')
    }
  }, [tenant])

  const mutation = useMutation({
    mutationFn: async (payload: TenantCreate | TenantUpdate) => {
      if (isEdit) {
        return apiClient.patch<TenantOut>(`/api/v1/tenants/${id}`, payload)
      }
      const newTenant = await apiClient.post<TenantOut>('/api/v1/tenants', payload)
      if (createUser && adminEmail && adminPassword) {
        await apiClient.post(`/api/v1/tenants/${newTenant.id}/users`, {
          email: adminEmail.trim(),
          password: adminPassword,
          role: 'admin',
        }).catch(() => {})
      }
      return newTenant
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tenants() })
      if (isEdit) {
        qc.invalidateQueries({ queryKey: keys.cliente(id!) })
        navigate('/clientes')
      } else {
        setShowWizard(true)
      }
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit) {
      mutation.mutate({
        name: name.trim(),
        slug: slug.trim(),
        active,
        enabled_modules: formModules,
        business_cif: businessCif.trim() || null,
        business_address: businessAddress.trim() || null,
      } satisfies TenantUpdate)
    } else {
      mutation.mutate({ parent_id: user!.tenant_id, tier: 'client', name: name.trim(), slug: slug.trim() } satisfies TenantCreate)
    }
  }

  const AVAILABLE_MODULES = [
    { key: 'fleet', label: 'Flota' },
    { key: 'alerts', label: 'Alertas' },
    { key: 'maintenance', label: 'Mantenimiento' },
    { key: 'reports', label: 'Reportes' },
  ]

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box',
  }

  return (
    <Shell title={isEdit ? 'Editar cliente' : 'Nuevo cliente'}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', minHeight: '100%', overflowY: 'auto' }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: '28px 32px', width: '100%', maxWidth: 520, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          <h2 style={{ margin: '0 0 24px', color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>
            {isEdit ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nombre</span>
              <input value={name} onChange={e => setName(e.target.value)} required style={inputStyle} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Slug (identificador único, solo letras minúsculas y guiones)</span>
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

            {isEdit && (
              <div style={{ borderTop: '1px solid var(--bg-border)', paddingTop: 16, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Datos legales (aparecerán en el PDF de partes)
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>CIF / NIF</span>
                  <input
                    value={businessCif}
                    onChange={e => setBusinessCif(e.target.value)}
                    placeholder="A-46123456"
                    maxLength={20}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Dirección fiscal</span>
                  <input
                    value={businessAddress}
                    onChange={e => setBusinessAddress(e.target.value)}
                    placeholder="Av. del Puerto 102, 46023 Valencia"
                    maxLength={300}
                    style={inputStyle}
                  />
                </label>
              </div>
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
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{m.label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Usuario admin del cliente (solo en creación) */}
            {!isEdit && (
              <div style={{ borderTop: '1px solid var(--bg-border)', paddingTop: 16, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Usuario de acceso del cliente
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={createUser} onChange={e => setCreateUser(e.target.checked)} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Crear usuario admin para el cliente</span>
                </label>
                {createUser && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Email del administrador</span>
                      <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@empresa.com" style={inputStyle} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Contraseña inicial</span>
                      <input type="text" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Mínimo 8 caracteres" style={inputStyle} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>El cliente deberá cambiarla en el primer acceso.</span>
                    </label>
                  </>
                )}
              </div>
            )}

            {mutation.isError && (
              <p style={{ color: 'var(--accent-crit)', fontSize: 13, margin: 0 }}>
                Error al guardar. Verifica que el slug sea único.
              </p>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button type="submit" disabled={mutation.isPending}
                style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                {mutation.isPending ? 'Guardando...' : 'Guardar'}
              </button>
              <button type="button" onClick={() => navigate('/clientes')}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '9px 20px', fontSize: 14, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>

      {showWizard && <OnboardingWizard onClose={() => { setShowWizard(false); navigate('/clientes') }} />}
    </Shell>
  )
}
