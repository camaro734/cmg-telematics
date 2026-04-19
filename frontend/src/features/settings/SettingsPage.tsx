import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'

export default function SettingsPage() {
  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
        <NotificationSettings />
      </div>
    </Shell>
  )
}
