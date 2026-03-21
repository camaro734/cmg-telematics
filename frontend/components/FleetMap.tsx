"use client";

import { useEffect, useRef } from "react";
import type { FleetVehicle, GeofenceOut } from "@/lib/api";

interface Props {
  fleet: FleetVehicle[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  geofences?: GeofenceOut[];
}

// Modern CartoDB Voyager tiles — clean, professional, free
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function truckIcon(color: string, selected: boolean, speed?: number) {
  const size = selected ? 44 : 36;
  const ring = selected ? `<circle cx="22" cy="22" r="20" stroke="${color}" stroke-width="2.5" stroke-dasharray="4 3" fill="none" opacity="0.6"/>` : "";
  // Truck SVG inside a pill badge
  return `
    <div style="
      position:relative;
      width:${size}px; height:${size}px;
      filter: drop-shadow(0 3px 8px ${color}88);
    ">
      <svg width="${size}" height="${size}" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        ${ring}
        <circle cx="22" cy="22" r="${selected ? 17 : 16}" fill="${color}"/>
        <circle cx="22" cy="22" r="${selected ? 17 : 16}" fill="rgba(0,0,0,0.15)"/>
        <!-- Truck icon centered -->
        <g transform="translate(10, 13)">
          <rect x="0" y="2" width="14" height="10" rx="1.5" fill="white" fill-opacity="0.95"/>
          <path d="M14 5h5l3 5v3h-8V5z" fill="white" fill-opacity="0.95"/>
          <circle cx="4" cy="14.5" r="2" fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="14" cy="14.5" r="2" fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="20" cy="14.5" r="2" fill="${color}" stroke="white" stroke-width="1.5"/>
        </g>
      </svg>
      ${speed != null ? `
      <div style="
        position:absolute; bottom:-6px; left:50%; transform:translateX(-50%);
        background:${color}; color:white; border:1.5px solid rgba(0,0,0,0.3);
        border-radius:6px; padding:0 4px; font-size:9px; font-weight:700;
        white-space:nowrap; font-family:system-ui,sans-serif; line-height:14px;
      ">${speed} km/h</div>` : ""}
    </div>
  `;
}

export default function FleetMap({ fleet, selectedId, onSelect, geofences }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const markersRef = useRef<Record<string, unknown>>({});
  const geofenceLayersRef = useRef<unknown[]>([]);
  const initialFitDone = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("leaflet").then(L => {
      const map = L.map(containerRef.current!, {
        center: [39.4561, -0.3539],
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTR,
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map);

      // Move zoom control to bottom-right for better mobile UX
      map.zoomControl.setPosition("bottomright");

      mapRef.current = map;
    });

    return () => {
      if (mapRef.current) {
        (mapRef.current as import("leaflet").Map).remove();
        mapRef.current = null;
        markersRef.current = {};
        initialFitDone.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then(L => {
      if (!mapRef.current) return;
      const lmap = mapRef.current as import("leaflet").Map;

      const validVehicles = fleet.filter(
        v => v.last_position?.lat != null && v.last_position?.lng != null
      );
      const validIds = new Set(validVehicles.map(v => v.vehicle_id));

      Object.keys(markersRef.current).forEach(vid => {
        if (!validIds.has(vid)) {
          (markersRef.current[vid] as import("leaflet").Marker).remove();
          delete markersRef.current[vid];
        }
      });

      validVehicles.forEach(vehicle => {
        const pos = vehicle.last_position!;
        const isOnline = vehicle.device?.online ?? false;
        const isSelected = vehicle.vehicle_id === selectedId;
        const noSignal = isOnline && vehicle.device?.last_seen &&
          (Date.now() - new Date(vehicle.device.last_seen).getTime()) > 5 * 60 * 1000;

        const color = isSelected ? "#3b82f6" : noSignal ? "#f59e0b" : isOnline ? "#1D9E75" : "#64748b";
        const ain1 = pos.io_data?.["9"];
        const pressure = ain1 != null ? Math.round(ain1 * 0.006) : null;

        const icon = L.divIcon({
          className: "",
          html: truckIcon(color, isSelected, pos.speed ?? undefined),
          iconSize: [isSelected ? 44 : 36, isSelected ? 52 : 44],
          iconAnchor: [isSelected ? 22 : 18, isSelected ? 26 : 22],
          popupAnchor: [0, isSelected ? -28 : -24],
        });

        const statusLabel = noSignal ? "Sin señal" : isOnline ? "En línea" : "Offline";
        const statusColor = noSignal ? "#f59e0b" : isOnline ? "#1D9E75" : "#64748b";
        const lastSeenStr = vehicle.device?.last_seen
          ? new Date(vehicle.device.last_seen).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
          : "–";

        const popupHtml = `
          <div style="
            min-width:190px; font-family:system-ui,sans-serif;
            background:#1e2532; border-radius:10px; overflow:hidden;
            border:1px solid rgba(255,255,255,0.08);
          ">
            <div style="padding:10px 12px 6px; border-bottom:1px solid rgba(255,255,255,0.08)">
              <div style="font-size:13px; font-weight:700; color:#f1f5f9; margin-bottom:3px">
                ${vehicle.vehicle_name}
              </div>
              ${vehicle.license_plate ? `<div style="font-size:11px; color:#94a3b8">${vehicle.license_plate}</div>` : ""}
            </div>
            <div style="padding:8px 12px">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px">
                <span style="
                  display:inline-flex; align-items:center; gap:4px;
                  font-size:11px; font-weight:600; color:${statusColor};
                  background:${statusColor}22; border-radius:20px; padding:2px 8px;
                ">
                  <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block;${isOnline && !noSignal ? "animation:pulse 1.5s infinite" : ""}"></span>
                  ${statusLabel}
                </span>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px; color:#94a3b8">
                <div>🚀 <b style="color:#e2e8f0">${pos.speed ?? "–"}</b> km/h</div>
                <div>🔑 <b style="color:#e2e8f0">${pos.ignition ? "ON" : "OFF"}</b></div>
                ${pressure != null ? `<div>🔧 <b style="color:#e2e8f0">${pressure}</b> bar</div>` : ""}
                <div style="font-size:10px; color:#64748b; grid-column:1/-1">Últ. señal: ${lastSeenStr}</div>
              </div>
            </div>
          </div>
        `;

        const existing = markersRef.current[vehicle.vehicle_id] as import("leaflet").Marker | undefined;
        if (existing) {
          existing.setLatLng([pos.lat!, pos.lng!]);
          existing.setIcon(icon);
          if (!existing.isPopupOpen()) {
            existing.bindPopup(popupHtml, { className: "cmg-popup" });
          } else {
            existing.setPopupContent(popupHtml);
          }
        } else {
          const marker = L.marker([pos.lat!, pos.lng!], { icon })
            .addTo(lmap)
            .bindPopup(popupHtml, { className: "cmg-popup" });
          marker.on("click", () => onSelectRef.current?.(vehicle.vehicle_id));
          markersRef.current[vehicle.vehicle_id] = marker;
        }
      });

      if (!initialFitDone.current && validVehicles.length > 0) {
        initialFitDone.current = true;
        if (validVehicles.length === 1) {
          const v = validVehicles[0];
          lmap.setView([v.last_position!.lat!, v.last_position!.lng!], 15);
        } else {
          const bounds = L.latLngBounds(
            validVehicles.map(v => [v.last_position!.lat!, v.last_position!.lng!])
          );
          lmap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, selectedId]);

  // Update geofence layers
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then(L => {
      if (!mapRef.current) return;
      const lmap = mapRef.current as import("leaflet").Map;

      geofenceLayersRef.current.forEach(layer => (layer as import("leaflet").Layer).remove());
      geofenceLayersRef.current = [];

      if (!geofences) return;

      geofences.forEach(fence => {
        if (!fence.active) return;
        const style = {
          color: "#1D9E75", fillColor: "#1D9E75",
          fillOpacity: 0.08, weight: 2, dashArray: "6 4",
        };
        let layer: import("leaflet").Layer | null = null;

        if (fence.shape_type === "circle" &&
            fence.center_lat != null && fence.center_lng != null && fence.radius_m != null) {
          layer = L.circle([fence.center_lat, fence.center_lng], { ...style, radius: fence.radius_m })
            .bindPopup(`<div style="font-family:system-ui;font-size:13px;color:#1e2532"><b>${fence.name}</b><br/><span style="color:#64748b;font-size:11px">Radio: ${fence.radius_m.toLocaleString("es-ES")} m</span></div>`);
        } else if (fence.shape_type === "polygon" && fence.polygon_points && fence.polygon_points.length >= 3) {
          const latlngs = fence.polygon_points.map(p => [p.lat, p.lng] as [number, number]);
          layer = L.polygon(latlngs, style)
            .bindPopup(`<div style="font-family:system-ui;font-size:13px;color:#1e2532"><b>${fence.name}</b><br/><span style="color:#64748b;font-size:11px">Polígono · ${fence.polygon_points.length} puntos</span></div>`);
        }

        if (layer) {
          layer.addTo(lmap);
          geofenceLayersRef.current.push(layer);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofences]);

  return (
    <>
      <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 300 }} />
      <style>{`
        .cmg-popup .leaflet-popup-content-wrapper {
          background: transparent !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
          border-radius: 10px !important;
          padding: 0 !important;
        }
        .cmg-popup .leaflet-popup-content { margin: 0 !important; }
        .cmg-popup .leaflet-popup-tip-container { display: none; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}
