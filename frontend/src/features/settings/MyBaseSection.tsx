import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { AddressAutocomplete } from '../work-orders/AddressAutocomplete'
import type { TenantOut, GeoResult } from '../../lib/types'

/**
 * «Mi base» — el admin del cliente (jefe de flota) fija la BASE de su empresa
 * (dirección + lat/lon). Una base por tenant; es el origen/destino por defecto
 * de la optimización de rutas. Usa el geocoder reutilizable (AddressAutocomplete
 * → useGeocode) y persiste vía el endpoint self-service GET/PATCH /me/tenant/base.
 */
export default function MyBaseSection() {
  const queryClient = useQueryClient()
  const baseKey = ['me', 'tenant', 'base'] as const

  const { data: tenant } = useQuery({
    queryKey: baseKey,
    queryFn: () => apiClient.get<TenantOut>('/api/v1/me/tenant/base'),
    staleTime: 60_000,
  })

  const [address, setAddress] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [saved, setSaved] = useState(false)

  // Inicializa el formulario con la base ya guardada (si existe).
  useEffect(() => {
    if (!tenant) return
    setAddress(tenant.base_address ?? '')
    setCoords(
      tenant.base_lat != null && tenant.base_lon != null
        ? { lat: tenant.base_lat, lon: tenant.base_lon }
        : null,
    )
  }, [tenant?.base_address, tenant?.base_lat, tenant?.base_lon])

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      apiClient.patch<TenantOut>('/api/v1/me/tenant/base', {
        base_address: address.trim() || null,
        base_lat: coords?.lat ?? null,
        base_lon: coords?.lon ?? null,
      }),
    onSuccess: data => {
      queryClient.setQueryData(baseKey, data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  function onSelect(r: GeoResult) {
    setAddress(r.label)
    setCoords({ lat: r.lat, lon: r.lon })
    setSaved(false)
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--fg-primary)', marginBottom: 8 }}>
        Mi base
      </div>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>
        La base de tu empresa: punto de salida y llegada por defecto al optimizar rutas.
        Busca la dirección y selecciónala para fijar sus coordenadas.
      </p>

      <div style={{ marginBottom: 12 }}>
        <AddressAutocomplete
          value={address}
          onChange={q => { setAddress(q); setSaved(false) }}
          onSelect={onSelect}
          placeholder="Ej: Polígono Industrial, Massanassa"
        />
      </div>

      {coords ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ok)', marginBottom: 12 }}>
          ✓ Ubicación fijada · {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
          Sin ubicación fijada todavía.
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>
          {(error as Error).message}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => mutate()}
          disabled={isPending || !coords}
          style={{
            padding: '7px 20px', fontSize: 13, fontFamily: 'var(--font-sans)',
            background: 'var(--cmg-teal)', border: 'none',
            borderRadius: 6, color: 'var(--bg-base)',
            cursor: isPending ? 'wait' : !coords ? 'not-allowed' : 'pointer',
            opacity: !coords ? 0.6 : 1,
          }}
        >
          {isPending ? 'Guardando…' : 'Guardar base'}
        </button>
        {saved && (
          <span style={{ color: 'var(--ok)', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
            Guardado
          </span>
        )}
      </div>
    </div>
  )
}
