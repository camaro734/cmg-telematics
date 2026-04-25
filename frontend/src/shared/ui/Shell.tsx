import TopNav from './TopNav'
import { useIsMobile } from '../../lib/useIsMobile'

interface ShellProps {
  title?: string
  children: React.ReactNode
}

export default function Shell({ children }: ShellProps) {
  const isMobile = useIsMobile()
  return (
    <>
      <TopNav />
      <main style={{
        marginTop: 'var(--topbar-h)',
        height: 'calc(100vh - var(--topbar-h))',
        overflow: isMobile ? 'auto' : 'hidden',
        overflowX: 'hidden',
        padding: isMobile ? 0 : undefined,
      }}>
        {children}
      </main>
    </>
  )
}
