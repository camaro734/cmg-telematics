import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuthStore } from './useAuthStore'

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, user: null, brandName: null, logoUrl: null })
  document.documentElement.style.removeProperty('--accent-energy')
})

afterEach(() => { vi.unstubAllGlobals() })

describe('applyBrandTokens', () => {
  it('aplica brand_color válido como --accent-energy', () => {
    useAuthStore.getState().applyBrandTokens({ brand_color: '#3056D3' })
    expect(document.documentElement.style.getPropertyValue('--accent-energy')).toBe('#3056D3')
  })

  it('ignora brand_color con formato inválido', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty')
    useAuthStore.getState().applyBrandTokens({ brand_color: '#ZZZZZZ' })
    expect(spy).not.toHaveBeenCalledWith('--accent-energy', expect.anything())
  })

  it('guarda brand_name en el store', () => {
    useAuthStore.getState().applyBrandTokens({ brand_name: 'Wasterent' })
    expect(useAuthStore.getState().brandName).toBe('Wasterent')
  })

  it('guarda logo_url https en el store', () => {
    useAuthStore.getState().applyBrandTokens({ logo_url: 'https://cdn.example.com/logo.png' })
    expect(useAuthStore.getState().logoUrl).toBe('https://cdn.example.com/logo.png')
  })

  it('rechaza logo_url sin https y limpia el valor previo', () => {
    useAuthStore.setState({ logoUrl: 'https://prev.com/logo.png' })
    useAuthStore.getState().applyBrandTokens({ logo_url: 'http://unsafe.com/logo.png' })
    expect(useAuthStore.getState().logoUrl).toBeNull()
  })
})

describe('logout', () => {
  it('elimina --accent-energy del DOM', () => {
    document.documentElement.style.setProperty('--accent-energy', '#3056D3')
    const spy = vi.spyOn(document.documentElement.style, 'removeProperty')
    vi.stubGlobal('location', { href: '' })
    useAuthStore.getState().logout()
    expect(spy).toHaveBeenCalledWith('--accent-energy')
  })
})
