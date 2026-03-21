'use client'
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'

export interface GeofenceDrawResult {
  shape_type: 'circle' | 'polygon'
  center_lat?: number
  center_lng?: number
  radius_m?: number
  polygon_points?: { lat: number; lng: number }[]
}

interface GeofenceDrawMapProps {
  mode: 'circle' | 'polygon'
  initialValue?: GeofenceDrawResult | null
  height?: string
}

export interface GeofenceDrawMapRef {
  getResult: () => GeofenceDrawResult | null
  clear: () => void
}

const GeofenceDrawMap = forwardRef<GeofenceDrawMapRef, GeofenceDrawMapProps>(
  ({ mode, initialValue, height = '350px' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<any>(null)
    const drawnLayerRef = useRef<any>(null)
    const drawingStateRef = useRef<any>({ phase: 'idle', center: null, polygon_points: [] })
    const resultRef = useRef<GeofenceDrawResult | null>(null)

    useImperativeHandle(ref, () => ({
      getResult: () => resultRef.current,
      clear: () => {
        if (drawnLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(drawnLayerRef.current)
          drawnLayerRef.current = null
        }
        resultRef.current = null
        drawingStateRef.current = { phase: 'idle', center: null, polygon_points: [] }
      },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      import('leaflet').then((L) => {
        // Init map if not done yet
        if (!mapRef.current) {
          const map = L.map(containerRef.current!, {
            center: [39.4561, -0.3539], // Valencia default
            zoom: 13,
          })
          L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20,
          }).addTo(map)
          mapRef.current = map
        }

        const map = mapRef.current

        // Remove previous click handlers
        map.off('click')
        map.off('mousemove')
        map.off('dblclick')

        // Clear existing drawing
        if (drawnLayerRef.current) {
          map.removeLayer(drawnLayerRef.current)
          drawnLayerRef.current = null
        }

        // Load initial value if provided
        if (initialValue) {
          resultRef.current = initialValue
          if (initialValue.shape_type === 'circle' && initialValue.center_lat && initialValue.center_lng && initialValue.radius_m) {
            const circle = L.circle([initialValue.center_lat, initialValue.center_lng], {
              radius: initialValue.radius_m,
              color: '#1D9E75',
              fillOpacity: 0.2,
            }).addTo(map)
            drawnLayerRef.current = circle
            map.fitBounds(circle.getBounds())
          } else if (initialValue.shape_type === 'polygon' && initialValue.polygon_points) {
            const latlngs = initialValue.polygon_points.map(p => [p.lat, p.lng] as [number, number])
            const poly = L.polygon(latlngs, { color: '#1D9E75', fillOpacity: 0.2 }).addTo(map)
            drawnLayerRef.current = poly
            map.fitBounds(poly.getBounds())
          }
          return
        }

        // Reset drawing state
        drawingStateRef.current = { phase: 'idle', center: null, polygon_points: [], tempLayer: null, previewLayer: null }

        if (mode === 'circle') {
          // Circle drawing: first click = center, second click = radius
          map.getContainer().style.cursor = 'crosshair'

          map.on('click', (e: any) => {
            const state = drawingStateRef.current
            if (state.phase === 'idle') {
              // First click: place center
              state.center = e.latlng
              state.phase = 'radius'
              if (state.tempLayer) map.removeLayer(state.tempLayer)
              state.tempLayer = L.circleMarker(e.latlng, {
                radius: 6, color: '#1D9E75', fillColor: '#1D9E75', fillOpacity: 1,
              }).addTo(map)
            } else if (state.phase === 'radius') {
              // Second click: set radius
              const center = state.center
              const radius = map.distance(center, e.latlng)

              if (state.tempLayer) map.removeLayer(state.tempLayer)
              if (state.previewLayer) map.removeLayer(state.previewLayer)
              if (drawnLayerRef.current) map.removeLayer(drawnLayerRef.current)

              const circle = L.circle([center.lat, center.lng], {
                radius,
                color: '#1D9E75',
                fillOpacity: 0.2,
              }).addTo(map)
              drawnLayerRef.current = circle

              resultRef.current = {
                shape_type: 'circle',
                center_lat: center.lat,
                center_lng: center.lng,
                radius_m: Math.round(radius),
              }

              state.phase = 'done'
              state.tempLayer = null
              state.previewLayer = null
              map.getContainer().style.cursor = ''
              map.off('mousemove')
            }
          })

          map.on('mousemove', (e: any) => {
            const state = drawingStateRef.current
            if (state.phase === 'radius' && state.center) {
              const radius = map.distance(state.center, e.latlng)
              if (state.previewLayer) map.removeLayer(state.previewLayer)
              state.previewLayer = L.circle([state.center.lat, state.center.lng], {
                radius,
                color: '#1D9E75',
                fillOpacity: 0.1,
                dashArray: '6',
              }).addTo(map)
            }
          })

        } else {
          // Polygon drawing: clicks add vertices, double-click closes
          map.getContainer().style.cursor = 'crosshair'
          drawingStateRef.current.polygon_points = []

          map.on('click', (e: any) => {
            const state = drawingStateRef.current
            if (state.phase === 'done') return
            state.phase = 'drawing'
            state.polygon_points.push({ lat: e.latlng.lat, lng: e.latlng.lng })

            // Redraw preview polygon
            if (state.previewLayer) map.removeLayer(state.previewLayer)
            if (state.polygon_points.length >= 2) {
              const latlngs = state.polygon_points.map((p: any) => [p.lat, p.lng])
              state.previewLayer = L.polygon(latlngs, {
                color: '#1D9E75',
                fillOpacity: 0.15,
                dashArray: '6',
              }).addTo(map)
            } else {
              state.previewLayer = L.circleMarker(e.latlng, {
                radius: 5, color: '#1D9E75', fillOpacity: 1,
              }).addTo(map)
            }
          })

          map.on('dblclick', (e: any) => {
            const state = drawingStateRef.current
            if (state.polygon_points.length < 3) return

            L.DomEvent.stopPropagation(e)

            if (state.previewLayer) map.removeLayer(state.previewLayer)
            if (drawnLayerRef.current) map.removeLayer(drawnLayerRef.current)

            const latlngs = state.polygon_points.map((p: any) => [p.lat, p.lng] as [number, number])
            const poly = L.polygon(latlngs, { color: '#1D9E75', fillOpacity: 0.2 }).addTo(map)
            drawnLayerRef.current = poly

            resultRef.current = {
              shape_type: 'polygon',
              polygon_points: [...state.polygon_points],
            }

            state.phase = 'done'
            state.previewLayer = null
            map.getContainer().style.cursor = ''
            map.off('click')
            map.off('dblclick')
          })
        }
      })

      return () => {
        if (mapRef.current) {
          mapRef.current.off('click')
          mapRef.current.off('mousemove')
          mapRef.current.off('dblclick')
          if (mapRef.current.getContainer()) {
            mapRef.current.getContainer().style.cursor = ''
          }
        }
      }
    }, [mode, initialValue])

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
      }
    }, [])

    return (
      <div className="flex flex-col gap-2">
        <div
          ref={containerRef}
          style={{ height, width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}
        />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {mode === 'circle'
            ? '1er clic: centro de la zona · 2º clic: borde (radio)'
            : 'Clics: añadir vértices · Doble clic: cerrar polígono'}
        </p>
      </div>
    )
  }
)
GeofenceDrawMap.displayName = 'GeofenceDrawMap'
export default GeofenceDrawMap
