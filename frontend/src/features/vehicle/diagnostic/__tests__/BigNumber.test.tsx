import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BigNumber } from '../BigNumber'

describe('BigNumber', () => {
  it('muestra el valor y la unidad', () => {
    render(<BigNumber label="Horas PTO" value={1234} unit="h" />)
    expect(screen.getByText('1234')).toBeInTheDocument()
    expect(screen.getByText('h')).toBeInTheDocument()
  })

  it('muestra el label', () => {
    render(<BigNumber label="Horas PTO" value={1234} unit="h" />)
    expect(screen.getByText('Horas PTO')).toBeInTheDocument()
  })

  it('muestra "—" cuando value es null', () => {
    render(<BigNumber label="Horas PTO" value={null} unit="h" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('no muestra unidad cuando unit es null', () => {
    const { queryByTestId } = render(<BigNumber label="Ciclos" value={42} unit={null} />)
    expect(queryByTestId('bignumber-unit')).toBeNull()
  })
})
