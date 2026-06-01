import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Input } from '../Input'

describe('Input', () => {
  it('renders un input sin props', () => {
    const { container } = render(<Input />)
    expect(container.querySelector('input')).toBeTruthy()
  })

  it('muestra el label y lo asocia al input', () => {
    render(<Input label="Correo electrónico" />)
    const label = screen.getByText('Correo electrónico')
    expect(label).toBeTruthy()
    const input = screen.getByLabelText('Correo electrónico')
    expect(input).toBeTruthy()
  })

  it('muestra el mensaje de error y marca aria-invalid', () => {
    render(<Input error="Campo requerido" />)
    expect(screen.getByText('Campo requerido')).toBeTruthy()
    const input = screen.getByRole('textbox')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('no muestra mensaje de error si no hay error', () => {
    render(<Input />)
    const input = screen.getByRole('textbox')
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('renderiza el prefix', () => {
    render(<Input prefix={<span data-testid="prefix-icon">@</span>} />)
    expect(screen.getByTestId('prefix-icon')).toBeTruthy()
  })

  it('renderiza el suffix', () => {
    render(<Input suffix={<button type="button">Ver</button>} />)
    expect(screen.getByRole('button', { name: 'Ver' })).toBeTruthy()
  })

  it('propaga value y onChange nativos', () => {
    const onChange = vi.fn()
    render(<Input value="hola" onChange={onChange} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('hola')
    fireEvent.change(input, { target: { value: 'mundo' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('propaga placeholder y type nativos', () => {
    render(<Input type="email" placeholder="usuario@empresa.com" />)
    const input = screen.getByPlaceholderText('usuario@empresa.com')
    expect(input.getAttribute('type')).toBe('email')
  })

  it('expone ref al elemento input nativo', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(<Input ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it('llama a onFocus y onBlur cuando el input recibe/pierde foco', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(<Input onFocus={onFocus} onBlur={onBlur} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(onFocus).toHaveBeenCalledTimes(1)
    fireEvent.blur(input)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('aplica fontFamily mono cuando mono=true', () => {
    render(<Input mono />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.style.fontFamily).toContain('var(--font-mono)')
  })

  it('respeta id explícito pasado como prop', () => {
    render(<Input id="mi-campo" label="Mi campo" />)
    const input = document.getElementById('mi-campo')
    expect(input).toBeTruthy()
  })

  // ── size ────────────────────────────────────────────────────────────────────

  it('size="md" aplica fontSize 13 y color fg-primary (default)', () => {
    render(<Input size="md" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.style.fontSize).toBe('13px')
    expect(input.style.color).toContain('var(--fg-primary)')
  })

  it('size="sm" aplica fontSize 12 y color fg-secondary', () => {
    render(<Input size="sm" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.style.fontSize).toBe('12px')
    expect(input.style.color).toContain('var(--fg-secondary)')
  })

  it('size="sm" aplica padding vertical 5px', () => {
    render(<Input size="sm" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.style.paddingTop).toBe('5px')
    expect(input.style.paddingBottom).toBe('5px')
  })

  it('size="md" aplica padding vertical 8px (default)', () => {
    render(<Input />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.style.paddingTop).toBe('8px')
    expect(input.style.paddingBottom).toBe('8px')
  })

  // ── helperText ───────────────────────────────────────────────────────────────

  it('muestra helperText cuando no hay error', () => {
    render(<Input helperText="Mínimo 8 caracteres" />)
    expect(screen.getByText('Mínimo 8 caracteres')).toBeTruthy()
  })

  it('helperText NO aparece cuando hay error (error tiene prioridad)', () => {
    render(<Input error="Campo requerido" helperText="Mínimo 8 caracteres" />)
    expect(screen.getByText('Campo requerido')).toBeTruthy()
    expect(screen.queryByText('Mínimo 8 caracteres')).toBeNull()
  })

  it('aria-describedby apunta al id del error cuando hay error', () => {
    render(<Input id="pwd" error="Error" />)
    const input = screen.getByRole('textbox')
    const descId = input.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    const desc = document.getElementById(descId!)
    expect(desc?.textContent).toBe('Error')
  })

  it('aria-describedby apunta al id del helperText cuando no hay error', () => {
    render(<Input id="pwd" helperText="Ayuda" />)
    const input = screen.getByRole('textbox')
    const descId = input.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    const desc = document.getElementById(descId!)
    expect(desc?.textContent).toBe('Ayuda')
  })

  it('no pone aria-describedby si no hay error ni helperText', () => {
    render(<Input />)
    const input = screen.getByRole('textbox')
    expect(input.getAttribute('aria-describedby')).toBeNull()
  })
})
