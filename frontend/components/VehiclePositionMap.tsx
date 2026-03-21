'use client'
import { useEffect, useRef } from 'react'

interface Props {
  lat: number
  lng: number
  speed?: number
  ignition?: boolean
  height?: string
}

const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function makeIcon(L: typeof import('leaflet'), speed: number, ignition: boolean) {
  const color = ignition ? (speed > 5 ? '#1D9E75' : '#3b82f6') : '#64748b'
  return L.divIcon({
    html: `
      <div style="position:relative;width:44px;height:52px">
        <div style="
          position:absolute;top:0;left:4px;
          width:36px;height:36px;border-radius:50%;
          background:${color};border:3px solid white;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 3px 12px ${color}88;
        ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="1" y="3" width="15" height="11" rx="2" fill="white" fill-opacity="0.9"/>
            <path d="M16 6h4l3 5v3h-7V6z" fill="white" fill-opacity="0.9"/>
            <circle cx="5" cy="16" r="2" fill="${color}" stroke="white" stroke-width="1.5"/>
            <circle cx="15" cy="16" r="2" fill="${color}" stroke="white" stroke-width="1.5"/>
            <circle cx="21" cy="16" r="2" fill="${color}" stroke="white" stroke-width="1.5"/>
          </svg>
        </div>
        <div style="
          position:absolute;bottom:0;left:50%;transform:translateX(-50%);
          background:${color};color:white;border:1.5px solid rgba(0,0,0,0.25);
          border-radius:6px;padding:1px 5px;font-size:10px;font-weight:700;
          font-family:system-ui,sans-serif;line-height:14px;white-space:nowrap;
        ">${speed} km/h</div>
      </div>
    `,
    className: '',
    iconSize: [44, 52],
    iconAnchor: [22, 26],
  })
}

export default function VehiclePositionMap({ lat, lng, speed = 0, ignition = false, height = '200px' }: Props) {
  const mapRef   = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instRef  = useRef<{ map: any; marker: any; L: any } | null>(null)

  const propsRef = useRef({ lat, lng, speed, ignition })
  propsRef.current = { lat, lng, speed, ignition }

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return

    import('leaflet').then((L) => {
      if (instRef.current || !mapRef.current) return

      const { lat, lng, speed, ignition } = propsRef.current
      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false })
      map.zoomControl.setPosition('bottomright')

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTR,
        maxZoom: 20,
        subdomains: 'abcd',
      }).addTo(map)

      map.setView([lat, lng], 15)

      const marker = L.marker([lat, lng], { icon: makeIcon(L, speed, ignition) })
        .addTo(map)
        .bindPopup(`<div style="font-family:system-ui;font-size:12px"><b>${speed} km/h</b><br/>${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`)

      instRef.current = { map, marker, L }
    })

    return () => {
      if (instRef.current) {
        instRef.current.map.remove()
        instRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const inst = instRef.current
    if (!inst) return
    inst.marker.setLatLng([lat, lng])
    inst.marker.setIcon(makeIcon(inst.L, speed, ignition))
    const popup = `<div style="font-family:system-ui;font-size:12px"><b>${speed} km/h</b><br/>${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`
    if (inst.marker.isPopupOpen()) inst.marker.setPopupContent(popup)
    else inst.marker.bindPopup(popup)
    inst.map.panTo([lat, lng], { animate: true, duration: 0.8 })
  }, [lat, lng, speed, ignition])

  return <div ref={mapRef} style={{ height, width: '100%', borderRadius: 'inherit' }} />
}
