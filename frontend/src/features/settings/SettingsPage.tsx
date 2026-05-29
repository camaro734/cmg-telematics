import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
import SmtpSection from './SmtpSection'
import { useAuthStore } from '../auth/useAuthStore'
import { useNavigate } from 'react-router-dom'

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'
  const isCmgAdmin = isCmg && isAdmin
  const navigate = useNavigate()

  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <NotificationSettings />
        {isAdmin && <UsersSection />}
        {isAdmin && <WorkCycleDefinitionsSection />}
        {isCmgAdmin && <SmtpSection />}
        {isCmgAdmin && (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 8 }}>Configuración de vehículos</div>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 12 }}>
              Los sensores, métricas de reportes, alertas y ciclos de trabajo se configuran en <strong>Plantillas</strong>.
            </p>
            <button
              onClick={() => navigate('/tipos-vehiculo')}
              style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Ir a Plantillas →
            </button>
          </div>
        )}
      </div>
    </Shell>
  )
}
