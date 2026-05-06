# CMG Track — Aplicacion Movil

Aplicacion React Native + Expo para la plataforma de telemetria industrial CMG Track.
Permite monitorizar flotas de vehiculos especializados (camiones cisterna, barredoras municipales, maquinaria hidraulica) con datos CAN bus en tiempo real.

## Caracteristicas

- Listado y mapa de flota en tiempo real (actualizacion cada 30 s)
- Detalle de vehiculo: datos GPS, sensores CAN, estados I/O, control DOUT
- Historico de horas de motor y PTO (ultimos 7 dias)
- Gestion de alertas activas con reconocimiento
- Autenticacion JWT con refresco automatico de token
- Tokens almacenados en SecureStore (nunca AsyncStorage)
- Soporte white-label via brand_name / logo_url del API
- Mapa oscuro personalizado para entorno industrial

## Requisitos

- Node.js >= 18
- Expo CLI: `npm install -g expo-cli`
- Para iOS: Xcode 15+ y simulador iOS
- Para Android: Android Studio con emulador o dispositivo fisico

## Instalacion

```bash
cd /opt/cmg-telematic1/mobile
npm install
```

## Arrancar en desarrollo

```bash
# Servidor de desarrollo (abre QR para Expo Go)
npx expo start

# Especifico para Android
npx expo start --android

# Especifico para iOS
npx expo start --ios

# En web (funcionalidad limitada — react-native-maps no disponible en web)
npx expo start --web
```

## Verificacion de tipos

```bash
npm run typecheck
```

## Build para produccion (EAS Build)

Requiere cuenta Expo y configuracion de `eas.json`:

```bash
npm install -g eas-cli
eas login

# Build Android (.apk o .aab)
eas build --platform android

# Build iOS (.ipa)
eas build --platform ios

# Build ambas plataformas
eas build --platform all
```

## Variables de entorno y configuracion

La URL del API esta hardcodeada en `src/api/client.ts`:

```typescript
const BASE_URL = 'https://cmgtrack.com';
```

Para cambiar el entorno (desarrollo/produccion), modificar esta constante
o usar `expo-constants` con `app.config.ts` para valores por entorno.

## Seguridad — JWT en SecureStore

Los tokens JWT se almacenan en `expo-secure-store`, que usa:
- iOS: Keychain Services
- Android: Android Keystore / EncryptedSharedPreferences

**NUNCA usar AsyncStorage para tokens JWT.** AsyncStorage no esta cifrado
y es accesible sin root en dispositivos Android.

El cliente Axios (`src/api/client.ts`) gestiona automaticamente:
1. Inyeccion del Bearer token en cada peticion
2. Refresco del access_token cuando recibe 401
3. Limpieza de credenciales si el refresh falla

## Maps — react-native-maps

En desarrollo con Expo Go, los mapas usan el proveedor por defecto del dispositivo.

En produccion, para Google Maps (Android y iOS con Google):
1. Crear proyecto en Google Cloud Console
2. Activar Maps SDK for Android y Maps SDK for iOS
3. Añadir las API keys en `app.json`:

```json
{
  "expo": {
    "android": {
      "config": {
        "googleMaps": {
          "apiKey": "YOUR_ANDROID_API_KEY"
        }
      }
    },
    "ios": {
      "config": {
        "googleMapsApiKey": "YOUR_IOS_API_KEY"
      }
    }
  }
}
```

El proveedor `PROVIDER_DEFAULT` usa Apple Maps en iOS (sin API key) y
Google Maps en Android (requiere API key en produccion).

## Estructura del proyecto

```
mobile/
├── App.tsx                    # Punto de entrada, providers globales
├── app.json                   # Configuracion Expo
├── babel.config.js            # Alias @ para imports
├── package.json
├── tsconfig.json
├── assets/                    # Iconos y splash (reemplazar con PNGs reales)
└── src/
    ├── api/                   # Capa de comunicacion con el backend
    │   ├── client.ts          # Axios con interceptores JWT
    │   ├── auth.ts            # Login / logout
    │   ├── fleet.ts           # Vehiculos, status, KPIs, track, DOUT
    │   └── alerts.ts          # Alertas y reconocimiento
    ├── components/            # Componentes reutilizables
    │   ├── StatusBadge.tsx    # Badge de estado del vehiculo
    │   ├── VehicleCard.tsx    # Tarjeta en la lista de flota
    │   ├── SensorGauge.tsx    # Gauge circular SVG (sin librerias externas)
    │   └── DoutButton.tsx     # Boton de control salida digital
    ├── navigation/
    │   ├── AppNavigator.tsx   # Stack raiz (Login / Main / VehicleDetail)
    │   └── MainNavigator.tsx  # Bottom tabs (Flota / Alertas / Ajustes)
    ├── screens/
    │   ├── LoginScreen.tsx
    │   ├── FleetScreen.tsx    # Lista + mapa de flota
    │   ├── AlertsScreen.tsx   # Alertas activas con reconocimiento
    │   ├── SettingsScreen.tsx # Info de cuenta y logout
    │   └── VehicleDetailScreen.tsx  # EN VIVO / HISTORICO / ALERTAS
    ├── store/
    │   ├── authStore.ts       # Estado de autenticacion (Zustand)
    │   └── fleetStore.ts      # Vehiculo seleccionado (Zustand)
    ├── theme/
    │   └── index.ts           # Tokens de color, espaciado y radio
    └── types/
        └── index.ts           # Tipos TypeScript compartidos
```

## Notas de desarrollo

- **Actualizacion en tiempo real**: se usa `refetchInterval` de React Query (30 s por defecto).
  Para datos mas frescos, considerar WebSocket con el endpoint `/ws` del backend.
- **Offline**: actualmente no hay cache offline persistente. Para produccion,
  considerar `react-query-persist-client` con MMKV o AsyncStorage.
- **Assets**: los archivos en `assets/` son placeholders de 11 bytes.
  Reemplazarlos con los PNGs reales antes de publicar en las stores:
  - `icon.png`: 1024x1024 px
  - `splash.png`: 1284x2778 px (iPhone 14 Pro Max)
  - `adaptive-icon.png`: 1024x1024 px (Android)
  - `favicon.png`: 48x48 px (web)
  - `notification-icon.png`: 96x96 px (Android push)
