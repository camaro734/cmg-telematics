import Sidebar from './Sidebar'
import Topbar from './Topbar'

interface ShellProps {
  title: string
  children: React.ReactNode
}

export default function Shell({ title, children }: ShellProps) {
  return (
    <>
      <Sidebar />
      <Topbar title={title} />
      <main style={{
        marginLeft: 'var(--sidebar-w)',
        marginTop: 'var(--topbar-h)',
        height: 'calc(100vh - var(--topbar-h))',
        overflow: 'hidden',
      }}>
        {children}
      </main>
    </>
  )
}
