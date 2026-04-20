import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import { useAuthStore } from '../auth/useAuthStore'

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <NotificationSettings />
        {isAdmin && <UsersSection />}
      </div>
    </Shell>
  )
}
