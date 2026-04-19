import { useAuthStore } from '../features/auth/useAuthStore'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && retry) {
    const ok = await useAuthStore.getState().refresh()
    if (ok) return request<T>(method, path, body, false)
    useAuthStore.getState().logout()
    throw new Error('Sesión expirada')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
