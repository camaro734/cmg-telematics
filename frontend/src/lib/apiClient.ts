import { useAuthStore } from '../features/auth/useAuthStore'

/** Error HTTP con el código de estado adjunto, para que el handler global de
 *  React Query (main.tsx) pueda suprimir toasts de 401/403/404 y la política de
 *  retry pueda no reintentarlos. Sin `.status`, esos filtros se saltan. */
function httpError(message: string, status: number): Error {
  const err = new Error(message) as Error & { status?: number }
  err.status = status
  return err
}

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
    // Extraer "detail" del JSON de FastAPI si existe; si no, usar el texto plano.
    // Siempre se lanza con `.status` para que el handler global suprima toasts
    // de 401/403/404 y la política de retry no los reintente.
    let message = text || `Error ${res.status}`
    try {
      const json = JSON.parse(text)
      if (json.detail) {
        message = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail)
      }
    } catch {
      // cuerpo no-JSON → se mantiene el texto plano
    }
    throw httpError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postForm: async <T>(path: string, formData: FormData, retry = true): Promise<T> => {
    const token = useAuthStore.getState().accessToken
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(path, { method: 'POST', headers, body: formData })
    } catch {
      throw new Error('Error de red')
    }
    if (res.status === 401 && retry) {
      const ok = await useAuthStore.getState().refresh()
      if (ok) return apiClient.postForm<T>(path, formData, false)
      useAuthStore.getState().logout()
      throw new Error('Sesión expirada')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw httpError(`${res.status}: ${text}`, res.status)
    }
    return res.json() as Promise<T>
  },
  getBlob: async (path: string, retry = true): Promise<Blob> => {
    const token = useAuthStore.getState().accessToken
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(path, { method: 'GET', headers })
    } catch {
      throw new Error('Error de red')
    }
    if (res.status === 401 && retry) {
      const ok = await useAuthStore.getState().refresh()
      if (ok) return apiClient.getBlob(path, false)
      useAuthStore.getState().logout()
      throw new Error('Sesión expirada')
    }
    if (!res.ok) throw new Error(`${res.status}`)
    return res.blob()
  },
}
