import TopNav from './TopNav'

interface ShellProps {
  title?: string
  children: React.ReactNode
}

export default function Shell({ children }: ShellProps) {
  return (
    <>
      <TopNav />
      <main style={{
        marginTop: 'var(--topbar-h)',
        height: 'calc(100vh - var(--topbar-h))',
        overflow: 'hidden',
      }}>
        {children}
      </main>
    </>
  )
}
