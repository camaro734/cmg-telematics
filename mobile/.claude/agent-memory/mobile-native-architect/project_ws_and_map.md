---
name: WebSocket, Map, and DOUT implementation status
description: Key implementation decisions for fleet WS hook, dashboard map, vehicle detail screen, and EAS setup
type: project
---

WebSocket fleet hook (`hooks/useFleetWebSocket.ts`) connects to `ws://213.210.20.183/ws/fleet?token=<JWT>` with exponential backoff (1s → 30s max). Token key in SecureStore is `cmg_jwt` — must stay in sync with `services/api.ts`.

Dashboard (`app/(tabs)/index.tsx`) uses a split layout: MapView (40% height via `useWindowDimensions`) on top, FlatList below. Live positions are stored in a `useRef<Map<string,LivePosition>>` and a version counter (`livePosVersion` state) triggers re-renders. WS status badge overlays the map corner.

Vehicle detail (`app/(tabs)/vehicle/[id].tsx`) merges REST snapshot (`useVehicleLast`) with WS live data via `{ ...lastData.data, ...liveTel }`. `wsActive` flips to `false` on WS disconnect so `LiveIndicator` downgrades to polling mode. DOUT buttons call `commands.sendDout` from `services/api.ts` and use `Alert.alert` for confirmation — no external toast library needed.

**Why:** Keeps server state in React Query cache while giving sub-second visual updates from WS. Avoids re-renders on every WS message for large fleets by using ref + version bump pattern.

**How to apply:** When adding more live-update screens, follow the ref+version pattern for position data (high-frequency), and direct `useState` for low-frequency values like alerts.

EAS CLI installed globally (v18.5.0). `eas.json` created at repo root of mobile dir.

TypeScript strict-mode issue found and fixed: `??` and `||` cannot be mixed without parentheses (TS5076). Always wrap `(a ?? b) || c`.
