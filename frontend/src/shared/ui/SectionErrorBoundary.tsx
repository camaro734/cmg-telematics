import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(e: Error): State {
    return { error: e }
  }

  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error(`[SectionErrorBoundary:${this.props.label}]`, e, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24, background: 'var(--bg-surface)',
          border: '1px solid var(--accent-crit)',
          borderRadius: 8, margin: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: 'var(--accent-crit)', fontSize: 14 }}>
            {this.props.label ? `Error en ${this.props.label}` : 'Error inesperado'}
          </span>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '6px 16px', background: 'var(--accent-energy)',
              color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
