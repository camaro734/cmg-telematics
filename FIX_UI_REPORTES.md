# FIX UI Reportes — 2026-04-30

## Problema 1 — Botón PDF y pestañas en VehicleDetailPage

**Estado:** Ya estaba correctamente implementado en el código existente.

La fila de tabs ya usaba `display: flex; justify-content: space-between` con las pestañas a la izquierda y el `PdfDownloadBtn` a la derecha en un contenedor separado. No se requirió cambio estructural.

## Problema 2 — Accesos rápidos redundantes en tab EN VIVO

**Fichero:** `frontend/src/features/vehicle/VehicleDetailPage.tsx`

**Cambios realizados:**

1. Eliminada la sección "ACCESO RÁPIDO A REPORTES" con sus 4 tarjetas (`QuickReportCard`).
2. Eliminado el estado `pdfModalOpen` y el componente modal `PdfQuickModal` (ya no necesarios al quitar la tarjeta "Descargar PDF").
3. Eliminado el componente helper `QuickReportCard` (ya sin uso).
4. Añadido en su lugar un único botón "Ver reportes de este vehículo" que navega a `/reports` con `state: { vehicleId: id, tab: 'historico' }`.

El botón usa hover interactivo (border/color cambia a `--accent-info`) y es semántico — no duplica la navegación del menú superior sino que preselecciona el vehículo en la página de reportes.

## Problema 3 — Botón PDF en ReportsPage

**Estado:** Sin problemas de layout detectados.

El `PdfDownloadBtn` en ReportsPage se pasa como `pdfSlot` al componente `SelectorBar`, que lo coloca con `marginLeft: auto` dentro del flex container de la barra de filtros. El dropdown usa `position: absolute; right: 0; top: 110%` y abre hacia abajo sin tapar ningún elemento de UI.

## Build

- TypeScript (`tsc -b`): sin errores
- Vite build (`vite build --outDir /tmp/cmg-dist`): compilación exitosa, 950 módulos transformados
- Nota: el directorio `dist/assets` tiene permisos root de un build Docker anterior; no afecta al código ni al despliegue por Docker
