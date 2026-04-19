import { create } from 'zustand'
import type { CurrentUser, BrandTokens } from '../../lib/types'

const REFRESH_KEY = 'cmg_refresh'

function parseJwt(token: string): CurrentUser | null {
  try {
    const raw = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const p = JSON.parse(raw) as Record<string, string>
    return {
      user_id: p['sub'],
      tenant_id: p['tenant_id'],
      tenant_tier: p['tenant_tier'] as CurrentUser['tenant_tier'],
      role: p['role'] as CurrentUser['role'],
      email: p['email'],
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
    set({ accessToken: data.access_token, user: parseJwt(data.access_token) })
  },

  logout: () => {
    localStorage.removeItem(REFRESH_KEY)
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
      set({ accessToken: data.access_token, user: parseJwt(data.access_token) })
      return true
    } catch {
      return false
    }
  },

  applyBrandTokens: (tokens) => {
    const root = document.documentElement
    Object.entries(tokens).forEach(([k, v]) => {
      if (v && k.startsWith('--')) root.style.setProperty(k, v)
    })
    set({
      brandName: tokens['brand_name'] ?? get().brandName,
      logoUrl: tokens['logo_url'] ?? get().logoUrl,
    })
  },
}))
