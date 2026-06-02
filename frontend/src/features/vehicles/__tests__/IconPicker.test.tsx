import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import IconPicker, { ICON_CATALOG } from '../IconPicker'

describe('IconPicker', () => {
  it('renderiza el botón con el icono seleccionado', () => {
    render(<IconPicker value="ti-engine" onChange={vi.fn()} />)
    expect(screen.getByText('Motor')).toBeInTheDocument()
  })

  it('muestra el dropdown al hacer click', () => {
    render(<IconPicker value="ti-engine" onChange={vi.fn()} />)
    expect(screen.queryByTestId('icon-picker-dropdown')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('icon-picker-dropdown')).toBeInTheDocument()
  })

  it('llama onChange y cierra al seleccionar un icono', () => {
    const onChange = vi.fn()
    render(<IconPicker value="ti-engine" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    const boltBtn = screen.getByTitle('Eléctrico')
    fireEvent.click(boltBtn)
    expect(onChange).toHaveBeenCalledWith('ti-bolt')
    expect(screen.queryByTestId('icon-picker-dropdown')).toBeNull()
  })

  it('filtra iconos al escribir en el buscador', () => {
    render(<IconPicker value="ti-engine" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))
    const search = screen.getByPlaceholderText('Buscar icono…')
    fireEvent.change(search, { target: { value: 'Motor' } })
    expect(screen.getByTitle('Motor')).toBeInTheDocument()
    expect(screen.queryByTitle('Eléctrico')).toBeNull()
  })

  it('muestra "Sin resultados" cuando no hay coincidencias', () => {
    render(<IconPicker value="ti-engine" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Buscar icono…'), { target: { value: 'xyzxyz' } })
    expect(screen.getByText('Sin resultados')).toBeInTheDocument()
  })

  it('el catálogo tiene al menos 20 iconos', () => {
    expect(ICON_CATALOG.length).toBeGreaterThanOrEqual(20)
  })

  it('todos los iconos del catálogo tienen key y label', () => {
    ICON_CATALOG.forEach(icon => {
      expect(icon.key).toBeTruthy()
      expect(icon.label).toBeTruthy()
    })
  })
})
