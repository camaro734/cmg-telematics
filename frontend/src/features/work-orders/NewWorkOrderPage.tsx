import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { toast } from '../../shared/ui/Toast'
import { Select } from '../../shared/ui/Select'
import Shell from '../../shared/ui/Shell'
import { useTenantContext } from '../../lib/useTenantContext'
import { AddressAutocomplete } from './AddressAutocomplete'
import { StopMap, type MapStop } from './StopMap'
import { useOptimizeRoute } from '../fleet/useDestination'
import type { WorkOrderOut, VehicleOut, DriverOut, WorkOrderPriority, GeoResult } from '../../lib/types'

// Detecta viewport estrecho para apilar las dos columnas (mapa debajo del formulario).
function useIsNarrow(maxWidthPx = 980): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [maxWidthPx])
  return narrow
}

const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}

type ExtraStop = {
  _id: string
  title: string
  client_name: string
  address: string
  lat: number | null
  lon: number | null
  arrival_radius_m: number
  notes: string
}

const PRIMARY = 'primary'

// Ancho completo con margen lateral pequeño, como la ficha de vehículo (sin maxWidth).
const FRAME: React.CSSProperties = { width: '100%', boxSizing: 'border-box' }

// ── Estilos con TOKENS del sistema (fuente grande y clara; sin px inline sueltos) ──
const S = {
  title:   { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 var(--space-2)' } as const,
  sub:     { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', color: 'var(--fg-muted)', margin: 0 } as const,
  form:    { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-5)' },
  // Tarjeta oscura con borde sutil y acento teal arriba (mismo lenguaje que la telemetría).
  card:    {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderTop: '2px solid var(--cmg-teal)', borderRadius: 8,
    padding: 'var(--space-5)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-5)',
  } as const,
  cardHd:  {
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-section-hd)', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--fg-muted)', margin: 0,
  } as const,
  field:   { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-2)' },
  label:   { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--fg-secondary)' } as const,
  input:   {
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-lg)', color: 'var(--fg-primary)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 'var(--space-3) var(--space-4)', width: '100%', boxSizing: 'border-box' as const, outline: 'none',
  } as const,
  textarea:{
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', color: 'var(--fg-primary)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 'var(--space-3) var(--space-4)', width: '100%', boxSizing: 'border-box' as const,
    outline: 'none', resize: 'vertical' as const, minHeight: 64,
  } as const,
  selectBig: { fontSize: 'var(--fs-lg)', padding: 'var(--space-3) var(--space-4)', borderRadius: 8 } as const,
  row2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
  sectionHd:{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 var(--space-3)' } as const,
  ok:      { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--ok)' } as const,
  hint:    { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' } as const,
  addBtn:  { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', fontWeight: 600, padding: 'var(--space-2) var(--space-4)', borderRadius: 8, cursor: 'pointer', background: 'color-mix(in srgb, var(--cmg-teal) 15%, transparent)', color: 'var(--cmg-teal)', border: '1px solid var(--cmg-teal)' } as const,
  editBtn: { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', fontWeight: 600, padding: 'var(--space-2) var(--space-4)', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--fg-secondary)', border: '1px solid var(--border)' } as const,
  activeBadge: { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--info)' } as const,
  moreBtn: { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-2) 0', background: 'none', border: 'none', color: 'var(--fg-secondary)', cursor: 'pointer', textAlign: 'left' as const } as const,
  // Barra de acciones: SIEMPRE visible (nunca se pierde al hacer scroll del formulario).
  footer:  {
    flexShrink: 0,
    display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)',
    paddingTop: 'var(--space-4)', marginTop: 'var(--space-4)',
    borderTop: '1px solid var(--border)', background: 'var(--bg-base)',
  } as const,
  btn:     { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-3) var(--space-6)', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--cmg-teal)', color: '#fff' } as const,
  btnGhost:{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-3) var(--space-6)', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--fg-muted)' } as const,
  delBtn:  { background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 'var(--fs-xl)', cursor: 'pointer', lineHeight: 1, padding: '0 4px' } as const,
  // Botones ↑/↓ para reordenar la parada (sin librería de drag-and-drop).
  moveBtn: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--fg-secondary)', borderRadius: 6, cursor: 'pointer', fontSize: 'var(--fs-md)', lineHeight: 1, padding: 'var(--space-1) var(--space-2)', minWidth: 28 } as const,
  // Número de visita (1..n) como chip mono, acento teal.
  visitNum:{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--cmg-teal)', minWidth: 18, textAlign: 'center' as const } as const,
  mapLabel:{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--fg-primary)', margin: '0 0 var(--space-2)' } as const,
  radius:  { ...{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)' }, width: 96, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg-primary)', padding: 'var(--space-2) var(--space-3)', boxSizing: 'border-box' as const } as const,
}

function stopCardStyle(active: boolean): React.CSSProperties {
  return {
    background: 'var(--bg-base)', borderRadius: 8, padding: 'var(--space-4)',
    border: `1px solid ${active ? 'var(--info)' : 'var(--border)'}`,
    borderLeft: `3px solid ${active ? 'var(--info)' : 'var(--cmg-teal)'}`,
    display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
  }
}

export default function NewWorkOrderPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { activeTenantId } = useTenantContext()
  const isNarrow = useIsNarrow()

  const [clientName, setClientName] = useState('')
  const [vehicleId, setVehicleId]   = useState('')
  const [driverId, setDriverId]     = useState('')
  // Dirección del servicio = dirección de la parada 1 (se geolocaliza con Valhalla).
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)

  // Paradas adicionales (la parada 1 es la dirección de arriba).
  const [extraStops, setExtraStops] = useState<ExtraStop[]>([])
  // Parada que se ve/edita en el mapa grande de la derecha.
  const [activeStopId, setActiveStopId] = useState<string>(PRIMARY)

  // ── Optimización de ruta: salida, llegada y resultado (geometría + totales) ──
  const [originType, setOriginType] = useState<'base' | 'vehicle'>('base')
  const [destType, setDestType] = useState<'base' | 'address'>('base')
  const [destAddress, setDestAddress] = useState('')
  const [destLat, setDestLat] = useState<number | null>(null)
  const [destLon, setDestLon] = useState<number | null>(null)
  const [routeGeometry, setRouteGeometry] = useState<[number, number][] | undefined>(undefined)
  const [routeInfo, setRouteInfo] = useState<{ distance_m: number; duration_s: number } | null>(null)
  // Orden de visita óptimo: claves de parada (PRIMARY o _id) en el orden devuelto por
  // la optimización. Reordena la numeración y el guardado de TODAS las paradas (la
  // dirección del servicio es una más, no queda fija). null = orden natural.
  const [visitOrder, setVisitOrder] = useState<string[] | null>(null)
  // Paradas FIJAS (candado): claves de parada que el optimizador no moverá.
  // Estado LOCAL de edición, no se persiste (solo instruye a "Optimizar ruta").
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set())
  const optimize = useOptimizeRoute()

  // "Más opciones" — plegado por defecto.
  const [showMore, setShowMore] = useState(false)
  const [priority, setPriority] = useState<WorkOrderPriority>('normal')
  const [scheduledAt, setScheduledAt] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')

  // Mismas queries que el listado: el backend filtra por el tenant del jefe de flota.
  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })
  const { data: drivers = [] } = useQuery({
    queryKey: [...keys.drivers(), activeTenantId],
    queryFn: () => apiClient.get<DriverOut[]>(`/api/v1/drivers${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })

  function addStop() {
    const id = Math.random().toString(36).slice(2)
    setExtraStops(s => [...s, {
      _id: id, title: '', client_name: '', address: '', lat: null, lon: null,
      arrival_radius_m: 50, notes: '',
    }])
    setActiveStopId(id)   // la nueva parada pasa a editarse en el mapa
  }
  function updateStop(_id: string, patch: Partial<ExtraStop>) {
    setExtraStops(s => s.map(d => d._id === _id ? { ...d, ...patch } : d))
  }
  function removeStop(_id: string) {
    setExtraStops(s => s.filter(d => d._id !== _id))
    if (activeStopId === _id) setActiveStopId(PRIMARY)
    setPinnedKeys(prev => {
      if (!prev.has(_id)) return prev
      const next = new Set(prev)
      next.delete(_id)
      return next
    })
  }

  const stopHasContent = (s: ExtraStop) => !!(s.title.trim() || s.address.trim() || s.lat != null)
  const hasPrimaryStop = !!(address.trim() || lat != null)

  // ── Punto/handlers del mapa grande según la parada activa ──
  const activeStop = activeStopId === PRIMARY ? null : extraStops.find(s => s._id === activeStopId) ?? null
  const mapRadius = activeStop ? activeStop.arrival_radius_m : 50

  // Claves de todas las paradas presentes (dirección del servicio + adicionales)
  // en orden natural. Base para reordenar a mano y numerar.
  const naturalKeys = [
    ...(hasPrimaryStop ? [PRIMARY] : []),
    ...extraStops.map(s => s._id),
  ]
  // Orden de VISITA efectivo: visitOrder reconciliado con las paradas presentes
  // (quita las que ya no existen, añade nuevas al final). Sin visitOrder → natural.
  const effectiveOrder = visitOrder
    ? [...visitOrder.filter(k => naturalKeys.includes(k)), ...naturalKeys.filter(k => !visitOrder.includes(k))]
    : naturalKeys

  // Número de visita de una parada (1..n) según el orden efectivo (manual u óptimo);
  // si la clave no está presente, usa el fallback.
  const visitNumberOf = (id: string, fallback: number) => {
    const i = effectiveOrder.indexOf(id)
    return i >= 0 ? i + 1 : fallback
  }

  // Sube/baja una parada una posición en el orden de visita (mutando visitOrder).
  function moveStop(key: string, dir: 'up' | 'down') {
    const base = effectiveOrder
    const i = base.indexOf(key)
    if (i < 0) return
    const j = dir === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= base.length) return
    const next = [...base]
    ;[next[i], next[j]] = [next[j], next[i]]
    setVisitOrder(next)
  }
  // Alterna el candado (fija/libera) de una parada. Solo estado local de edición.
  function togglePin(key: string) {
    setPinnedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Controles de cada parada: número de visita + ↑/↓ (reordenar) + candado (fijar).
  // Reutilizado por la dirección del servicio y por cada parada adicional.
  const stopControls = (key: string) => {
    const pos = effectiveOrder.indexOf(key)
    const isFirst = pos <= 0
    const isLast = pos === effectiveOrder.length - 1
    const pinned = pinnedKeys.has(key)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <span style={S.visitNum} title="Orden de visita">{pos >= 0 ? pos + 1 : '·'}</span>
        <button type="button" disabled={isFirst} title="Subir"
          style={{ ...S.moveBtn, opacity: isFirst ? 0.4 : 1, cursor: isFirst ? 'not-allowed' : 'pointer' }}
          onClick={() => moveStop(key, 'up')}>↑</button>
        <button type="button" disabled={isLast} title="Bajar"
          style={{ ...S.moveBtn, opacity: isLast ? 0.4 : 1, cursor: isLast ? 'not-allowed' : 'pointer' }}
          onClick={() => moveStop(key, 'down')}>↓</button>
        <button type="button" aria-pressed={pinned}
          title={pinned ? 'Parada fija: no se moverá al optimizar (clic para liberar)' : 'Fijar parada en su posición'}
          style={{ ...S.moveBtn,
            color: pinned ? 'var(--warn)' : 'var(--fg-secondary)',
            borderColor: pinned ? 'var(--warn)' : 'var(--border)',
            background: pinned ? 'color-mix(in srgb, var(--warn) 18%, transparent)' : 'var(--bg-elevated)' }}
          onClick={() => togglePin(key)}>{pinned ? '🔒' : '🔓'}</button>
      </div>
    )
  }

  // Todas las paradas con coordenadas, numeradas según el orden de VISITA (óptimo si
  // se ha optimizado; natural si no). La dirección del servicio no tiene número fijo.
  const mapStops: MapStop[] = [
    { id: PRIMARY, lat, lon },
    ...extraStops.map(s => ({ id: s._id, lat: s.lat, lon: s.lon })),
  ]
    .filter((s): s is { id: string; lat: number; lon: number } => s.lat != null && s.lon != null)
    .map((s, idx) => ({ ...s, n: visitNumberOf(s.id, idx + 1) }))
  const activeIdx = activeStop ? extraStops.findIndex(s => s._id === activeStopId) : -1
  const activeLabel = activeStop
    ? `Parada ${visitNumberOf(activeStop._id, activeIdx + 2)}${activeStop.title.trim() ? ` · ${activeStop.title.trim()}` : ''}`
    : `Parada ${visitNumberOf(PRIMARY, 1)} · dirección del servicio`

  function onMapPick(la: number, lo: number) {
    if (activeStopId === PRIMARY) { setLat(la); setLon(lo) }
    else updateStop(activeStopId, { lat: la, lon: lo })
  }
  function onMapAddress(addr: string) {
    if (activeStopId === PRIMARY) setAddress(addr)
    else updateStop(activeStopId, { address: addr })
  }

  // Firma de SOLO coordenadas (no del orden): si cambian las ubicaciones o el
  // conjunto de paradas, la ruta dibujada queda obsoleta y se descarta. Reordenar
  // (que no cambia coords) la conserva.
  const coordSig = [
    lat != null && lon != null ? `p:${lat},${lon}` : '',
    ...extraStops.map(s => (s.lat != null && s.lon != null ? `${s._id}:${s.lat},${s.lon}` : '')),
  ].join('|')
  useEffect(() => {
    setRouteGeometry(undefined)
    setRouteInfo(null)
    setVisitOrder(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordSig])

  // Paradas con coordenadas, EN ORDEN DE VISITA actual (para que `pinned` sean los
  // índices correctos). La dirección del servicio es una más; origen/destino se
  // anclan aparte. Las fijas (candado) mantendrán su posición al optimizar.
  const coordByKey = new Map<string, { lat: number; lon: number }>()
  if (lat != null && lon != null) coordByKey.set(PRIMARY, { lat, lon })
  for (const s of extraStops) {
    if (s.lat != null && s.lon != null) coordByKey.set(s._id, { lat: s.lat, lon: s.lon })
  }
  const optStops: { key: string; lat: number; lon: number }[] = effectiveOrder
    .filter(k => coordByKey.has(k))
    .map(k => ({ key: k, ...coordByKey.get(k)! }))
  const canOptimize = optStops.length >= 2 && !optimize.isPending

  async function optimizeRoute() {
    if (originType === 'vehicle' && !vehicleId) {
      toast.error('Selecciona un vehículo para usar su posición como salida')
      return
    }
    if (destType === 'address' && (destLat == null || destLon == null)) {
      toast.error('Busca y selecciona la dirección de llegada')
      return
    }
    try {
      // Índices (en el orden enviado) de las paradas fijas: el backend no las mueve.
      const pinned = optStops.reduce<number[]>((acc, s, i) => {
        if (pinnedKeys.has(s.key)) acc.push(i)
        return acc
      }, [])
      const res = await optimize.mutateAsync({
        origin: originType === 'base' ? { type: 'base' } : { type: 'vehicle', vehicle_id: vehicleId },
        stops: optStops.map(s => ({ lat: s.lat, lon: s.lon })),
        destination: destType === 'base' ? { type: 'base' } : { type: 'coords', lat: destLat!, lon: destLon! },
        pinned,
      })
      // `order` = índices 0-based de optStops en orden óptimo. Reordena TODAS las
      // paradas (incluida la dirección del servicio): guardamos el orden de visita
      // por clave; la numeración y el guardado lo aplican.
      const newVisitOrder = res.order
        .map(i => optStops[i]?.key)
        .filter((k): k is string => !!k)
      setVisitOrder(newVisitOrder)
      setRouteGeometry(res.geometry as [number, number][])
      setRouteInfo({ distance_m: res.distance_m, duration_s: res.duration_s })
      toast.success('Ruta optimizada')
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo optimizar la ruta')
    }
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      // El título se autocompleta (cliente → dirección) para no bloquear el guardado.
      const title = clientName.trim() || address.trim() || 'Orden de trabajo'
      const order = await apiClient.post<WorkOrderOut>('/api/v1/work-orders', {
        title,
        vehicle_id: vehicleId || null,
        driver_id: driverId || null,
        priority,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        description: description.trim() || null,
        notes: notes.trim() || null,
        final_client_name: clientName.trim() || null,
        final_client_address: address.trim() || null,
      })

      // Paradas a crear (la dirección del servicio es una más, sin posición fija).
      type SaveStop = { key: string; kind: 'primary' | 'extra'; extra?: ExtraStop }
      const toSave: SaveStop[] = []
      if (hasPrimaryStop) toSave.push({ key: PRIMARY, kind: 'primary' })
      for (const s of extraStops) {
        if (stopHasContent(s)) toSave.push({ key: s._id, kind: 'extra', extra: s })
      }
      // Orden de creación = orden de visita óptimo (si se optimizó); las paradas sin
      // coordenadas (no optimizadas) van al final manteniendo su orden relativo.
      if (visitOrder) {
        const rank = (k: string) => { const i = visitOrder.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
        toSave.sort((a, b) => rank(a.key) - rank(b.key))
      }
      let idx = 0
      for (const item of toSave) {
        const n = idx + 1
        const body = item.kind === 'primary'
          ? {
              title: address.trim() || clientName.trim() || `Parada ${n}`,
              client_name: clientName.trim() || null, address: address.trim() || null,
              lat, lon, arrival_radius_m: 50, notes: null,
            }
          : {
              title: item.extra!.title.trim() || item.extra!.address.trim() || item.extra!.client_name.trim() || `Parada ${n}`,
              client_name: item.extra!.client_name.trim() || null, address: item.extra!.address.trim() || null,
              lat: item.extra!.lat, lon: item.extra!.lon,
              arrival_radius_m: item.extra!.arrival_radius_m, notes: item.extra!.notes.trim() || null,
            }
        await apiClient.post(`/api/v1/work-orders/${order.id}/stops`, { ...body, order_index: idx })
        idx++
      }
      return order
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.workOrders() })
      toast.success('Orden creada')
      navigate('/work-orders')
    },
    onError: (e) => toast.error((e as Error).message || 'No se pudo crear la orden'),
  })

  // ── Contenido reutilizable (mismo en escritorio y en estrecho) ──
  const formContent = (
    <div style={S.form}>
      {/* Datos del servicio */}
      <div style={S.card}>
        <h2 style={S.cardHd}>Datos del servicio</h2>
      {/* 1 · Cliente del servicio */}
      <div style={S.field}>
        <label style={S.label} htmlFor="wo-client">Cliente del servicio</label>
        <input id="wo-client" style={S.input} value={clientName}
          placeholder="Nombre o razón social"
          onChange={e => setClientName(e.target.value)} />
      </div>

      {/* 2 · Dirección (Valhalla) = una parada más (su nº de visita lo fija la optimización) */}
      <div style={S.field}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <label style={S.label}>Dirección del servicio</label>
          {hasPrimaryStop && stopControls(PRIMARY)}
        </div>
        <AddressAutocomplete
          value={address}
          onChange={(q) => { setAddress(q); setActiveStopId(PRIMARY) }}
          onSelect={(r) => { setAddress(r.label); setLat(r.lat); setLon(r.lon); setActiveStopId(PRIMARY) }}
          placeholder="Busca la dirección y selecciónala"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {lat != null && lon != null
            ? <span style={S.ok}>✓ Ubicación fijada · {lat.toFixed(5)}, {lon.toFixed(5)}</span>
            : <span style={S.hint}>Selecciona una dirección o haz clic en el mapa →</span>}
          {activeStopId === PRIMARY
            ? <span style={S.activeBadge}>● Editando en el mapa</span>
            : <button type="button" style={S.editBtn} onClick={() => setActiveStopId(PRIMARY)}>Editar en el mapa</button>}
        </div>
      </div>

      {/* 3 · Vehículo + Chofer */}
      <div style={S.row2}>
        <Select label="Vehículo" style={S.selectBig} value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
          <option value="">— Sin asignar —</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <Select label="Chofer" style={S.selectBig} value={driverId} onChange={e => setDriverId(e.target.value)}>
          <option value="">— Sin asignar —</option>
          {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </Select>
      </div>
      </div>{/* /tarjeta Datos del servicio */}

      {/* 4 · Paradas adicionales — la ubicación se ajusta en el mapa grande */}
      <div style={S.card}>
        <h2 style={S.cardHd}>Paradas adicionales</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[...extraStops]
            .sort((a, b) => effectiveOrder.indexOf(a._id) - effectiveOrder.indexOf(b._id))
            .map((stop) => {
            const active = activeStopId === stop._id
            return (
              <div key={stop._id} style={stopCardStyle(active)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {stopControls(stop._id)}
                  <input style={{ ...S.input, fontSize: 'var(--fs-md)', flex: 1 }} placeholder="Título de la parada"
                    value={stop.title} onChange={e => updateStop(stop._id, { title: e.target.value })} />
                  <button type="button" style={S.delBtn} title="Eliminar parada" onClick={() => removeStop(stop._id)}>×</button>
                </div>
                <input style={{ ...S.input, fontSize: 'var(--fs-md)' }} placeholder="Cliente / empresa"
                  value={stop.client_name} onChange={e => updateStop(stop._id, { client_name: e.target.value })} />
                {/* Mismo buscador Valhalla que la dirección del servicio: fija address+lat/lon de ESTA parada. */}
                <AddressAutocomplete
                  value={stop.address}
                  onChange={(q) => { updateStop(stop._id, { address: q }); setActiveStopId(stop._id) }}
                  onSelect={(r) => { updateStop(stop._id, { address: r.label, lat: r.lat, lon: r.lon }); setActiveStopId(stop._id) }}
                  placeholder="Busca la dirección de la parada"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <label style={{ ...S.hint, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    Radio (m)
                    <input type="number" min={10} max={2000} step={10} style={S.radius}
                      value={stop.arrival_radius_m}
                      onChange={e => updateStop(stop._id, { arrival_radius_m: Math.max(10, parseInt(e.target.value) || 50) })} />
                  </label>
                  {active
                    ? <span style={S.activeBadge}>● Editando en el mapa</span>
                    : <button type="button" style={S.editBtn} onClick={() => setActiveStopId(stop._id)}>Editar en el mapa</button>}
                  {stop.lat != null && <span style={S.ok}>✓ {stop.lat.toFixed(4)}, {stop.lon?.toFixed(4)}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <button type="button" style={{ ...S.addBtn, alignSelf: 'flex-start' }} onClick={addStop}>
          + Añadir parada
        </button>
      </div>{/* /tarjeta Paradas adicionales */}

      {/* 5 · Más opciones (plegado) */}
      <div style={{ ...S.card, gap: 'var(--space-3)' }}>
        <button type="button" style={S.moreBtn} onClick={() => setShowMore(v => !v)}>
          {showMore ? '▲ Menos opciones' : '▼ Más opciones'}
        </button>
        {showMore && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
            <div style={S.row2}>
              <Select label="Prioridad" style={S.selectBig} value={priority} onChange={e => setPriority(e.target.value as WorkOrderPriority)}>
                {(Object.entries(PRIORITY_LABELS) as [WorkOrderPriority, string][]).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </Select>
              <div style={S.field}>
                <label style={S.label} htmlFor="wo-sched">Fecha programada</label>
                <input id="wo-sched" type="datetime-local" style={S.input}
                  value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
            </div>
            <div style={S.field}>
              <label style={S.label} htmlFor="wo-desc">Descripción</label>
              <textarea id="wo-desc" style={S.textarea} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div style={S.field}>
              <label style={S.label} htmlFor="wo-notes">Notas internas</label>
              <textarea id="wo-notes" style={S.textarea} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', margin: 0 }}>
              El auto-cierre por señal/geocerca se configura editando la orden desde el listado.
            </p>
          </div>
        )}
      </div>
    </div>
  )

  const mapContent = (
    <div style={{ ...S.card, gap: 'var(--space-3)', flex: 1, minHeight: 0 }}>
      <p style={S.mapLabel}>Ubicación · {activeLabel}</p>
      <div style={{ flex: 1, minHeight: 0, borderRadius: 6, overflow: 'hidden' }}>
        <StopMap
          stops={mapStops} activeId={activeStopId} activeRadiusM={mapRadius}
          onPick={onMapPick} onAddressChange={onMapAddress} onSelectStop={setActiveStopId}
          routeGeometry={routeGeometry}
        />
      </div>
      <p style={{ ...S.hint, margin: 0 }}>
        Haz clic en el mapa o arrastra el pin para fijar la ubicación de la parada activa.
      </p>
    </div>
  )

  const footerButtons = (
    <>
      <button type="button" style={S.btnGhost} onClick={() => navigate('/work-orders')}>Cancelar</button>
      <button type="button" style={{ ...S.btn, opacity: isPending ? 0.6 : 1 }} disabled={isPending} onClick={() => save()}>
        {isPending ? 'Guardando…' : 'Crear orden'}
      </button>
    </>
  )

  return (
    <Shell title="Nueva orden de trabajo">
      {/* Raíz de altura completa: cabecera fija + cuerpo con scroll + botones siempre visibles. */}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Cabecera fija */}
        <div style={{ ...FRAME, flexShrink: 0, padding: 'var(--space-6) var(--space-6) var(--space-4)' }}>
          <h1 style={S.title}>Nueva orden de trabajo</h1>
          <p style={S.sub}>Rellena lo mínimo para crear el parte. El resto puede completarse después.</p>

          {/* Optimización de ruta: salida, llegada y resultado. Respeta las paradas con candado. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
            <div style={{ minWidth: 180 }}>
              <Select label="Salida" style={S.selectBig} value={originType}
                onChange={e => setOriginType(e.target.value as 'base' | 'vehicle')}>
                <option value="base">Mi base</option>
                <option value="vehicle">Posición del camión</option>
              </Select>
            </div>
            <div style={{ minWidth: 180 }}>
              <Select label="Llegada" style={S.selectBig} value={destType}
                onChange={e => setDestType(e.target.value as 'base' | 'address')}>
                <option value="base">Mi base</option>
                <option value="address">Otra dirección</option>
              </Select>
            </div>
            {destType === 'address' && (
              <div style={{ minWidth: 240, flex: 1 }}>
                <label style={S.label}>Dirección de llegada</label>
                <AddressAutocomplete
                  value={destAddress}
                  onChange={setDestAddress}
                  onSelect={(r: GeoResult) => { setDestAddress(r.label); setDestLat(r.lat); setDestLon(r.lon) }}
                  placeholder="Busca la dirección de llegada"
                />
              </div>
            )}
            <button type="button" style={{ ...S.btn, opacity: canOptimize ? 1 : 0.6, cursor: canOptimize ? 'pointer' : 'not-allowed' }}
              disabled={!canOptimize} onClick={() => optimizeRoute()}>
              {optimize.isPending ? 'Optimizando…' : '⚡ Optimizar ruta'}
            </button>
            {routeInfo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)' }}>
                <span style={{ color: 'var(--cmg-teal)' }}>{(routeInfo.distance_m / 1000).toFixed(1)} km</span>
                <span style={{ color: 'var(--info)' }}>{Math.round(routeInfo.duration_s / 60)} min</span>
              </div>
            )}
          </div>
          {optStops.length < 2 && (
            <p style={{ ...S.hint, margin: 'var(--space-2) 0 0' }}>
              Añade al menos dos paradas con ubicación para optimizar la ruta.
            </p>
          )}
        </div>

        {isNarrow ? (
          /* Estrecho: columnas apiladas; toda la página hace scroll; botones fijos al pie. */
          <>
            <div style={{ ...FRAME, flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 var(--space-6) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              {formContent}
              <div style={{ display: 'flex', flexDirection: 'column', height: 420 }}>
                {mapContent}
              </div>
            </div>
            <div style={{ ...S.footer, ...FRAME, padding: 'var(--space-4) var(--space-6) var(--space-6)', marginTop: 0 }}>
              {footerButtons}
            </div>
          </>
        ) : (
          /* Escritorio: dos columnas a altura completa. El FORMULARIO hace scroll;
             el mapa rellena su columna; los botones quedan fijos al pie de la izquierda. */
          <div style={{
            ...FRAME, flex: 1, minHeight: 0, display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.92fr) minmax(0, 1.12fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 'var(--space-8)', padding: '0 var(--space-6) var(--space-6)', overflow: 'hidden',
          }}>
            {/* Columna izquierda: scroll del formulario + barra de acciones fija */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 'var(--space-3)', paddingBottom: 'var(--space-4)' }}>
                {formContent}
              </div>
              <div style={S.footer}>
                {footerButtons}
              </div>
            </div>

            {/* Columna derecha: mapa grande, refleja la parada activa */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {mapContent}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
