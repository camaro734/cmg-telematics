---
name: Mobile App Initialization
description: Expo SDK 54 project initialized at /opt/cmg-telematics/mobile/ with all core dependencies — key versions and workarounds recorded
type: project
---

Expo SDK 54 mobile app initialized at `/opt/cmg-telematics/mobile/` with Expo Router v6.

**Why:** First mobile layer for CMG Telematics — consumes existing FastAPI backend without duplicating business logic.

**How to apply:** Use these confirmed-working versions for all future dependency additions.

## Key package versions (confirmed working with `npx expo export --platform ios`)
- expo: ~54.0.33
- expo-router: ~6.0.23  (NOT v3 — SDK 54 ships with v6)
- react-native: 0.81.5
- react-native-reanimated: ~4.1.1
- react-native-worklets: 0.5.1  ← REQUIRED peer of reanimated v4 — must install explicitly
- react-native-svg: 15.12.1
- @tanstack/react-query: ^5.96.2
- zustand: ^5.0.12
- axios: ^1.14.0

## Critical workaround: reanimated v4 + worklets
`react-native-reanimated` v4 (SDK 54) requires `react-native-worklets` as a peer.
Without it, Babel fails with: `Cannot find module 'react-native-worklets/plugin'`
Install with: `npx expo install react-native-worklets`

## Entry point
`package.json` main: `"expo-router/entry"` (NOT the old `index.ts` pattern)
Old `App.tsx` and `index.ts` from blank template must be deleted.

## npm install issues
`npm install axios` fails without `--legacy-peer-deps` due to peer conflicts.
Always use: `npm install <pkg> --legacy-peer-deps` for non-expo packages.

## Environment variables
- `EXPO_PUBLIC_API_URL=http://213.210.20.183/api/v1`
- `EXPO_PUBLIC_WS_URL=ws://213.210.20.183/ws/fleet`
- `.env` file is NOT in git (added to .gitignore)

## Build verification
`npx expo export --platform ios` runs from `/opt/cmg-telematics/mobile/` — success baseline.
