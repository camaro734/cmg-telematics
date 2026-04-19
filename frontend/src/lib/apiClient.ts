import { useAuthStore } from '../features/auth/useAuthStore'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Error de red')
  }

  if (res.status === 401 && retry) {
    const ok = await useAuthStore.getState().refresh()
    if (ok) return request<T>(method, path, body, false)
    useAuthStore.getState().logout()
    throw new Error('Sesión expirada')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText || 'Error desconocido')
    throw new Error(`${res.status}: ${text}`)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
