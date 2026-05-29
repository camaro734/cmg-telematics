import { useEffect } from 'react'
import TopNav from './TopNav'
import Sidebar from './Sidebar'
import { useIsMobile } from '../../lib/useIsMobile'

interface ShellProps {
  title?: string
  children: React.ReactNode
}

const BRAND = 'CMG Track'

export default function Shell({ title, children }: ShellProps) {
  const isMobile = useIsMobile()

  useEffect(() => {
    document.title = title ? `${title} — ${BRAND}` : BRAND
    return () => { document.title = BRAND }
  }, [title])

  return (
    <>
      {!isMobile && <Sidebar />}
      <TopNav />
      <main style={{
        marginTop: 'var(--topbar-h)',
        marginLeft: isMobile ? 0 : 'var(--sidebar-w)',
        height: 'calc(100vh - var(--topbar-h))',
        overflow: isMobile ? 'auto' : 'hidden',
        overflowX: 'hidden',
        transition: 'margin-left 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {children}
      </main>
    </>
  )
}
