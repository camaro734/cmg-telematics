# CMG Track Mobile — Mejora iOS + Órdenes de Trabajo
**Fecha:** 2026-05-07  
**Alcance:** App React Native (Expo) en `/opt/cmg-telematic1/mobile/`

---

## Objetivo

Completar la app móvil CMG Track para que los conductores puedan gestionar sus órdenes de trabajo en campo — ver paradas, navegar a ellas, y cerrar la orden con firma digital y fotos — y preparar el proyecto para build nativo con Xcode usando Expo Prebuild.

---

## Usuarios objetivo

- **Conductor (driver):** usuario principal. Ve sus órdenes asignadas, navega a cada parada, cierra la orden con informe (firma + fotos + notas).
- **Operador/Supervisor:** secundario. Monitoriza flota y alertas desde el móvil.

---

## 1. Navegación

### Estructura del stack (RootStack)

```
RootStack
├── Login
├── Main (BottomTabs)
│   ├── Fleet      — lista/mapa de flota (sin cambios de fondo)
│   ├── Orders     — lista de órdenes
│   ├── Alerts     — alertas activas
│   └── Settings   — cuenta y cierre de sesión
├── VehicleDetail      (existente, sin cambios)
├── WorkOrderDetail    ← NUEVA
└── WorkReport         ← NUEVA
```

### Cambio en tab order para conductores
Cuando `user.role === 'driver'`, la tab **Orders** se coloca primera en el tab bar.

### Navegación desde WorkOrdersScreen
Tap en una order card → `WorkOrderDetail` (en lugar del cambio de estado inline actual).

---

## 2. Pantallas nuevas

### 2.1 `WorkOrderDetailScreen`

**Ruta:** `WorkOrderDetail` con parámetro `{ workOrderId: string }`

**Contenido:**
- Cabecera: título de la orden, `StatusBadge`, prioridad coloreada, vehículo asignado, conductor asignado
- **Sección Mapa:** `MapView` compacto (altura 200 px) con marcadores numerados para cada parada que tenga coordenadas. Estilo oscuro existente.
- **Sección Paradas:** lista `FlatList` de `StopItem` — número de orden, título, dirección, radio de llegada. Si `arrived_at != null`, mostrar icono de check verde. Botón "Navegar" abre la app de Mapas nativa con las coordenadas via `Linking.openURL('maps://...' | 'geo:...')`.
- **Botón flotante inferior:**
  - Estado `pending` → botón naranja "Iniciar orden"
  - Estado `in_progress` → botón verde "Cerrar orden" → navega a `WorkReport`
  - Estado `done` / `cancelled` → sin botón de acción
- Botón "Cancelar" en cabecera (derecha, texto pequeño) con confirmación Alert.

**Query:** `GET /api/v1/work-orders/{id}` — devuelve `WorkOrder` con `stops[]` incluidos.

---

### 2.2 `WorkReportScreen`

**Ruta:** `WorkReport` con parámetro `{ workOrderId: string }`

**Contenido (scroll vertical):**
1. **Notas:** `TextInput` multilínea, placeholder "Observaciones del servicio..."
2. **Fotos:** cuadrícula 3 columnas de miniaturas + botón "+" que abre `ActionSheet` (cámara / galería) via `expo-image-picker`. Máximo 5 fotos. Cada miniatura tiene botón "×" para eliminar.
3. **Firma digital:** área de firma con `react-native-signature-canvas`. Botón "Borrar" esquina superior derecha del canvas. Texto indicativo "Firma del cliente".
4. **Botón "Enviar informe"** (naranja, ancho completo, parte inferior):
   - Valida que haya firma antes de enviar
   - `POST /api/v1/work-orders/{id}/reports` como `multipart/form-data`: campo `notes` (string), campo `signature` (PNG file), campos `photos[]` (imagen files)
   - Loading state mientras envía
   - Al éxito: invalida queries `['work-orders']`, navega a raíz del stack (`Main/Orders`)
   - Al error: `Alert` con mensaje del servidor

**Pantalla activa:** `expo-keep-awake` activo durante toda la pantalla (ya instalado).

---

## 3. Cambios en pantallas existentes

### `WorkOrdersScreen`
- Cada `OrderCard` es ahora completamente tappable → navega a `WorkOrderDetail`
- Se eliminan los botones de acción inline de la card (Iniciar / Completar / Cancelar) — estas acciones viven en el detalle
- La card sigue mostrando: estado badge, prioridad, título, dirección, vehículo, conductor, fecha programada, descripción

### `FleetScreen`
- Sin cambios funcionales

### `theme/index.ts`
- `accent` cambia de `#00C8C8` → `#F97316` (naranja, alineado con design system web)
- `accentWarn` cambia de `#F97316` → `#EAB308` (amarillo, para que warning sea distinto del accent)

---

## 4. Tipos nuevos

En `src/types/index.ts`:

```ts
export interface WorkOrderStop {
  id: string;
  order_index: number;
  title: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  arrival_radius_m: number;
  arrived_at: string | null;
  notes: string | null;
}

// WorkOrder añade campo:
stops: WorkOrderStop[];
```

En `RootStackParamList`:
```ts
WorkOrderDetail: { workOrderId: string };
WorkReport: { workOrderId: string };
```

---

## 5. API

En `src/api/workOrders.ts`:

```ts
// Detalle de una orden (incluye stops)
getWorkOrder(id: string): Promise<WorkOrder>
// GET /api/v1/work-orders/{id}

// Crear informe de trabajo
createWorkReport(id: string, data: FormData): Promise<void>
// POST /api/v1/work-orders/{id}/reports (multipart/form-data)
// campos: notes (string), signature (PNG), photos[] (images)
```

---

## 6. Paquetes nuevos

| Paquete | Versión | Propósito |
|---|---|---|
| `expo-image-picker` | `~15.0.7` | Cámara y galería para fotos del informe |
| `react-native-signature-canvas` | `^4.5.0` | Canvas de firma digital sobre WebView nativo |
| `expo-build-properties` | `~0.12.3` | Configura iOS min deployment target en app.json |

`expo-keep-awake` ya está instalado.

---

## 7. Configuración iOS (Expo Prebuild)

### `app.json` — añadir/modificar:

```json
{
  "expo": {
    "plugins": [
      ["expo-image-picker", {
        "photosPermission": "CMG Track necesita acceso a tus fotos para adjuntarlas al informe.",
        "cameraPermission": "CMG Track necesita la cámara para fotografiar el servicio."
      }],
      ["expo-build-properties", {
        "ios": { "deploymentTarget": "14.0" }
      }]
    ]
  }
}
```

### Generación del proyecto nativo:

```bash
cd mobile
npm install
npx expo prebuild --clean
# Genera ios/ y android/
```

La carpeta `ios/` se committe al repositorio. El archivo `ios/CMGTrack.xcworkspace` es el que se abre con Xcode.

### `eas.json` (build profiles):

```json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "production": {
      "distribution": "store"
    }
  }
}
```

### Configuración en Xcode:
1. Abrir `ios/CMGTrack.xcworkspace`
2. Seleccionar target `CMGTrack` → Signing & Capabilities → Team: seleccionar Apple Developer account
3. Bundle ID: `es.cmghidraulica.cmgtrack` (ya configurado)
4. `react-native-maps` usa `PROVIDER_DEFAULT` (Apple Maps) — no requiere API key de Google

---

## 8. Componentes nuevos

| Componente | Descripción |
|---|---|
| `StopItem` | Fila de parada: número, título, dirección, check arrived, botón Navegar |

`SignatureCanvas` se usa directamente como el componente exportado por `react-native-signature-canvas`.

---

## 9. Criterios de éxito

- [ ] Conductor puede ver sus órdenes asignadas
- [ ] Tap en orden muestra detalle con paradas en lista y mapa
- [ ] Botón "Navegar" abre Maps nativa con las coordenadas de la parada
- [ ] Conductor puede iniciar y cerrar órdenes desde el detalle
- [ ] WorkReportScreen permite firma, fotos (≤5) y notas
- [ ] Informe se envía al backend correctamente (multipart)
- [ ] `expo prebuild` genera `ios/` sin errores
- [ ] App compila y corre en simulador/dispositivo desde Xcode
- [ ] Acento naranja (#F97316) consistente en toda la app
