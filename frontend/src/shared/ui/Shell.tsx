import { useEffect } from 'react'
import TopNav from './TopNav'
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
