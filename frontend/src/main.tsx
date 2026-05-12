import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryCache, MutationCache, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './styles/tokens.css'
import App from './App.tsx'
import { toast } from './shared/ui/Toast'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
  })
}

function _humanError(err: unknown): string | null {
  const e = err as { status?: number; message?: string } | undefined
  if (!e) return null
  // 401/403/404 los maneja la UI por su cuenta — no toast global.
  if (e.status === 401 || e.status === 403 || e.status === 404) return null
  if (e.status && e.status >= 500) return 'El servidor no responde. Reintenta en unos segundos.'
  return e.message ?? 'Error de red'
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      // Solo mostrar toast si la query no tiene su propio onError ni se ha consumido como manejado.
      const msg = _humanError(err)
      if (msg && query.state.data === undefined) toast.error(msg)
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      const msg = _humanError(err)
      if (msg) toast.error(msg)
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status
        if (status === 401 || status === 403 || status === 404) return false
        return failureCount < 2
      },
      staleTime: 30_000,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
