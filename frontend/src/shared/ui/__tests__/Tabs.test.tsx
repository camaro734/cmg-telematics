import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tabs from '../Tabs'

const TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
]

describe('Tabs', () => {
  it('renderiza todas las pestañas', () => {
    const { getByText } = render(
      <Tabs tabs={TABS} activeTab="live" onTabChange={() => {}} />
    )
    expect(getByText('EN VIVO')).toBeInTheDocument()
    expect(getByText('HISTÓRICO')).toBeInTheDocument()
  })

  it('llama onTabChange con el id correcto al hacer clic', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByText } = render(
      <Tabs tabs={TABS} activeTab="live" onTabChange={onChange} />
    )
    await user.click(getByText('HISTÓRICO'))
    expect(onChange).toHaveBeenCalledWith('historic')
  })

  it('la pestaña activa tiene atributo aria-selected=true', () => {
    const { getByRole } = render(
      <Tabs tabs={TABS} activeTab="historic" onTabChange={() => {}} />
    )
    const historicBtn = getByRole('tab', { name: 'HISTÓRICO' })
    expect(historicBtn).toHaveAttribute('aria-selected', 'true')
  })

  it('la pestaña inactiva tiene atributo aria-selected=false', () => {
    const { getByRole } = render(
      <Tabs tabs={TABS} activeTab="historic" onTabChange={() => {}} />
    )
    const liveBtn = getByRole('tab', { name: 'EN VIVO' })
    expect(liveBtn).toHaveAttribute('aria-selected', 'false')
  })
})
