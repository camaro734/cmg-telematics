import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Select } from '../Select'

describe('Select', () => {
  it('renderiza con children', () => {
    const { container } = render(
      <Select>
        <option value="a">Opción A</option>
      </Select>
    )
    expect(container.querySelector('select')).toBeTruthy()
    expect(screen.getByText('Opción A')).toBeTruthy()
  })

  it('muestra el label y lo asocia al select', () => {
    render(
      <Select label="Rol">
        <option value="admin">Admin</option>
      </Select>
    )
    expect(screen.getByText('Rol')).toBeTruthy()
    expect(screen.getByLabelText('Rol')).toBeTruthy()
  })

  it('muestra el mensaje de error y aplica aria-invalid', () => {
    render(
      <Select error="Campo requerido">
        <option value="">Selecciona</option>
      </Select>
    )
    expect(screen.getByText('Campo requerido')).toBeTruthy()
    const select = screen.getByRole('combobox')
    expect(select.getAttribute('aria-invalid')).toBe('true')
  })

  it('no muestra aria-invalid si no hay error', () => {
    render(
      <Select>
        <option value="x">X</option>
      </Select>
    )
    expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBeNull()
  })

  it('muestra helperText cuando no hay error', () => {
    render(
      <Select helperText="Selecciona el rol del usuario">
        <option value="op">Operador</option>
      </Select>
    )
    expect(screen.getByText('Selecciona el rol del usuario')).toBeTruthy()
  })

  it('error tiene prioridad sobre helperText', () => {
    render(
      <Select error="Requerido" helperText="Texto de ayuda">
        <option value="">—</option>
      </Select>
    )
    expect(screen.getByText('Requerido')).toBeTruthy()
    expect(screen.queryByText('Texto de ayuda')).toBeNull()
  })

  it('size="md" aplica fontSize 13 (default)', () => {
    render(
      <Select size="md">
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.style.fontSize).toBe('13px')
  })

  it('size="sm" aplica fontSize 12', () => {
    render(
      <Select size="sm">
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.style.fontSize).toBe('12px')
  })

  it('size="sm" aplica padding vertical 5px', () => {
    render(
      <Select size="sm">
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.style.paddingTop).toBe('5px')
    expect(select.style.paddingBottom).toBe('5px')
  })

  it('size="md" aplica padding vertical 8px', () => {
    render(
      <Select>
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.style.paddingTop).toBe('8px')
    expect(select.style.paddingBottom).toBe('8px')
  })

  it('onChange llega correctamente al consumidor', () => {
    const onChange = vi.fn()
    render(
      <Select value="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('style del consumidor llega al select (override background)', () => {
    render(
      <Select style={{ background: 'var(--bg-card)', width: 120 }}>
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.style.background).toBe('var(--bg-card)')
    expect(select.style.width).toBe('120px')
  })

  it('disabled funciona', () => {
    render(
      <Select disabled>
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.disabled).toBe(true)
  })

  it('aria-describedby apunta al error cuando hay error', () => {
    render(<Select id="s1" error="Error"><option value="">—</option></Select>)
    const select = screen.getByRole('combobox')
    const descId = select.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)?.textContent).toBe('Error')
  })

  it('aria-describedby apunta al helperText cuando no hay error', () => {
    render(<Select id="s2" helperText="Ayuda"><option value="">—</option></Select>)
    const select = screen.getByRole('combobox')
    const descId = select.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)?.textContent).toBe('Ayuda')
  })

  it('no pone aria-describedby si no hay error ni helperText', () => {
    render(<Select><option value="">—</option></Select>)
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toBeNull()
  })

  it('respeta id explícito y lo asocia al label', () => {
    render(
      <Select id="mi-select" label="Mi campo">
        <option value="x">X</option>
      </Select>
    )
    expect(document.getElementById('mi-select')).toBeTruthy()
  })

  it('expone ref al elemento select nativo', () => {
    const ref = { current: null as HTMLSelectElement | null }
    render(
      <Select ref={ref}>
        <option value="x">X</option>
      </Select>
    )
    expect(ref.current).toBeInstanceOf(HTMLSelectElement)
  })

  it('llama a onFocus y onBlur', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(
      <Select onFocus={onFocus} onBlur={onBlur}>
        <option value="x">X</option>
      </Select>
    )
    const select = screen.getByRole('combobox')
    fireEvent.focus(select)
    expect(onFocus).toHaveBeenCalledTimes(1)
    fireEvent.blur(select)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})
