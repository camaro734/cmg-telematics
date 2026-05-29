import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressBar from '../ProgressBar'

describe('ProgressBar', () => {
  it('muestra el porcentaje', () => {
    render(<ProgressBar pct={75} status="ok" />)
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('color verde para ok', () => {
    const { container } = render(<ProgressBar pct={30} status="ok" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.background === 'var(--ok)')
    expect(fill).toBeTruthy()
  })

  it('color naranja para próximo', () => {
    const { container } = render(<ProgressBar pct={92} status="próximo" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.background === 'var(--warn)')
    expect(fill).toBeTruthy()
  })

  it('color rojo para vencido', () => {
    const { container } = render(<ProgressBar pct={105} status="vencido" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.background === 'var(--danger)')
    expect(fill).toBeTruthy()
  })

  it('limita el fill a 100% aunque pct sea mayor', () => {
    const { container } = render(<ProgressBar pct={150} status="vencido" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.width === '100%') as HTMLElement
    expect(fill).toBeTruthy()
  })
})
