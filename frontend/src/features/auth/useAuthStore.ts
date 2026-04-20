import { create } from 'zustand'
import type { CurrentUser, BrandTokens } from '../../lib/types'
import { wsClient } from '../../lib/wsClient'

const REFRESH_KEY = 'cmg_refresh'

function parseJwt(token: string): CurrentUser | null {
  try {
    let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    b64 += '='.repeat((4 - b64.length % 4) % 4)
    const raw = atob(b64)
    const p = JSON.parse(raw) as Record<string, unknown>
    const sub = p['sub']
    const tenant_id = p['tenant_id']
    const tenant_tier = p['tenant_tier']
    const role = p['role']
    const email = p['email']
    if (
      typeof sub !== 'string' ||
      typeof tenant_id !== 'string' ||
      typeof tenant_tier !== 'string' ||
      typeof role !== 'string' ||
      typeof email !== 'string'
    ) return null
    return {
      user_id: sub,
      tenant_id,
      tenant_tier: tenant_tier as CurrentUser['tenant_tier'],
      role: role as CurrentUser['role'],
      email,
    }
  } catch {
    return null
  }
}

interface AuthStore {
  accessToken: string | null
  user: CurrentUser | null
  brandName: string | null
  logoUrl: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<boolean>
  applyBrandTokens: (tokens: BrandTokens) => void
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  accessToken: null,
  user: null,
  brandName: null,
  logoUrl: null,

  login: async (email, password) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error('Credenciales incorrectas')
    const data = await res.json() as { access_token: string; refresh_token: string }
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    const user = parseJwt(data.access_token)
    if (!user) throw new Error('Token de acceso inválido')
    set({ accessToken: data.access_token, user })
  },

  logout: () => {
    localStorage.removeItem(REFRESH_KEY)
    wsClient.disconnect()
    document.documentElement.style.removeProperty('--accent-energy')
    set({ accessToken: null, user: null, brandName: null, logoUrl: null })
    window.location.href = '/login'
  },

  refresh: async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    if (!refreshToken) return false
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) { localStorage.removeItem(REFRESH_KEY); return false }
      const data = await res.json() as { access_token: string; refresh_token: string }
      localStorage.setItem(REFRESH_KEY, data.refresh_token)
      const user = parseJwt(data.access_token)
      if (!user) { localStorage.removeItem(REFRESH_KEY); return false }
      set({ accessToken: data.access_token, user })
      return true
    } catch {
      return false
    }
  },

  applyBrandTokens: (tokens) => {
    const root = document.documentElement
    if (tokens.brand_color && /^#[0-9a-fA-F]{6}$/.test(tokens.brand_color)) {
      root.style.setProperty('--accent-energy', tokens.brand_color)
    }
    const safeLogoUrl = tokens.logo_url?.startsWith('https://') ? tokens.logo_url : get().logoUrl
    set({
      brandName: tokens.brand_name ?? get().brandName,
      logoUrl: safeLogoUrl,
    })
  },
}))
