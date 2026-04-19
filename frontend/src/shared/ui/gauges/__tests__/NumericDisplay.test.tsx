import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import NumericDisplay from '../NumericDisplay'

describe('NumericDisplay', () => {
  it('muestra el valor, unidad y label', () => {
    const { getByText } = render(
      <NumericDisplay value={47} unit="ciclos" label="CICLOS VACIADO" />
    )
    expect(getByText('47')).toBeInTheDocument()
    expect(getByText('ciclos')).toBeInTheDocument()
    expect(getByText('CICLOS VACIADO')).toBeInTheDocument()
  })

  it('muestra valor decimal con 1 decimal', () => {
    const { getByText } = render(
      <NumericDisplay value={3.4} unit="h" label="HORAS PTO" />
    )
    expect(getByText('3.4')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <NumericDisplay value={null} unit="ciclos" label="CICLOS" />
    )
    expect(getByText('—')).toBeInTheDocument()
  })
})
