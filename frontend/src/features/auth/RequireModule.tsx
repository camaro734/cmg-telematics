import { Navigate } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'

interface Props {
  module: string
  children: React.ReactNode
}

export default function RequireModule({ module, children }: Props) {
  const { user, enabledModules } = useAuthStore()
  if (user?.tenant_tier === 'cmg' || user?.tenant_tier === 'manufacturer') {
    return <>{children}</>
  }
  if (!enabledModules.includes(module)) {
    return <Navigate to="/fleet" replace />
  }
  return <>{children}</>
}
