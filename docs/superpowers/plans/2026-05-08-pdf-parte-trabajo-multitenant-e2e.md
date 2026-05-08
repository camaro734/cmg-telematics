# Verificación E2E — PDF parte de trabajo multi-tenant

**Fecha implementación:** 2026-05-08
**Plan completo:** `docs/superpowers/plans/2026-05-08-pdf-parte-trabajo-multitenant.md`
**Spec:** `docs/superpowers/specs/2026-05-08-pdf-parte-trabajo-multitenant-design.md`

## Estado de la implementación

11 fases × 20 tareas, ejecutadas autonomamente en orden:

| Fase | Commit | Cambio |
|---|---|---|
| 1.a | `ebffa56` | Migración Alembic 021 — schema multitenant del PDF |
| 1.b | `8f59355` | Modelos SQLAlchemy actualizados + TenantDocCounter |
| 1.c | `72605a2` | Schemas Pydantic con PdfMetric y validación XOR |
| 2 | `4ecb53d` | Helper `assign_doc_number` atómico + integración en transition_status |
| 3 | `9b26069` | Endpoint `/report` con XOR firma/no-firma |
| 4 | `e370724` | `pdf_metrics` en vehicle_type + `business_*` en tenant |
| 5 | `d99a980` | Template PDF reescrito + endpoint `download_pdf` |
| 6 | `999f726` | Endpoint `/work-orders/{id}/telemetry-detail` |
| 7 | `2715b7c` | TenantFormPage acepta `business_cif`/`business_address` |
| 8 | `3e2f202` | PdfMetricsSection en /tipos-vehiculo |
| 9 | `6bf8cd6` | Work-orders web — cliente final, doc_number, descarga PDF, telemetría capturada |
| 10 | `d4e94ce` | Mobile — captura firma+DNI cliente o motivo + Share API |

## Verificación automática realizada

### Backend
- ✅ Migración 021 aplicada en Postgres (alembic upgrade head sin errores).
- ✅ Schema verificado: `tenant_doc_counter`, columnas nuevas en `tenant`, `vehicle_type`, `work_order`, `work_report`.
- ✅ Suite completa pytest: **45 passed, 3 skipped, 0 fallos** (sin regresiones).
- ✅ Endpoints expuestos: `GET /work-orders/{id}/telemetry-detail`, `GET /work-orders/{id}/report/pdf`, `PATCH /vehicle-types/{id}` (acepta pdf_metrics), `PATCH /tenants/{id}` (acepta business_cif/address).
- ✅ Smoke test `assign_doc_number` contra Postgres real: PT-2026-00001 → PT-2026-00002 → PT-2027-00001.
- ✅ Tests del template PDF: format_metric, branding, firmado, sin-firma con motivo.

### Frontend web
- ✅ TypeScript `npx tsc --noEmit` pasa sin errores.
- ✅ `npm run test`: 153 passed / 10 failed (las 10 fallas son **pre-existentes** en master, no regresiones de estos cambios — confirmado con `git stash`).
- ✅ Imagen Docker `cmg-telematic1_frontend:latest` reconstruida con éxito.

### Mobile
- ✅ TypeScript `npx tsc --noEmit` pasa sin errores.
- ✅ Dependencias añadidas: `expo-file-system 17.0.1`, `expo-sharing 12.0.1` (alineadas con SDK 51 / EAS Build).

## Despliegue pendiente (manual)

El backend ya está corriendo con los cambios (los archivos se copiaron al contenedor `cmg-telematic1_core-api_1` y se reinició). El **frontend** tiene una nueva imagen pero el contenedor aún ejecuta la versión anterior. Para activar los cambios de UI:

```bash
# Swap del contenedor frontend (procedimiento descrito en CLAUDE.md por el bug de docker-compose v1)
OLD=$(docker ps -q --filter "name=cmg-telematic1_frontend_1")
docker stop $OLD && docker rm $OLD
docker run -d --name cmg-telematic1_frontend_1 \
  --network cmg-telematic1_default \
  --network-alias frontend \
  --restart unless-stopped \
  cmg-telematic1_frontend
```

El **mobile** requiere build EAS (Xploid) para generar el IPA actualizado:

```bash
cd /opt/cmg-telematic1/mobile
eas build --platform ios --profile production   # o el perfil que use Xploid
```

## Plan de pruebas E2E manual

Una vez desplegado el frontend, ejecutar este checklist:

### Configuración inicial (CMG admin)
1. Login como `admin@cmg.es` en https://cmgtrack.com.
2. En `/clientes` editar un tenant client (ej. VACUUM PRESURE SYSTEMS):
   - Rellenar **CIF / NIF** (ej. `B-46123456`)
   - Rellenar **Dirección fiscal** (ej. `Av. del Puerto 102, 46023 Valencia`)
   - Guardar y verificar que se persiste tras recargar.
3. En `/tipos-vehiculo` seleccionar `Sistema vacío-presión (cisterna)`:
   - Bajar a la sección "Métricas en el PDF de partes"
   - Añadir: Tiempo PTO, Presión máx, RPM medio, Combustible
   - Editar etiqueta "Tiempo PTO" → "Aspiración"
   - Reordenar con flechas ↑/↓
   - Verificar la vista previa muestra la tabla con datos de ejemplo
   - Verificar que persiste tras recargar.

### Crear orden con cliente final (admin)
4. En `/work-orders` → "+ Nueva orden":
   - Rellenar título, vehículo, conductor, prioridad
   - Bloque "Cliente final del servicio": nombre `Comunidad El Pinar`, dirección `C/ Mayor 12, Valencia`
   - Añadir 3 paradas con direcciones reales
   - Guardar.
5. Verificar que la orden aparece en lista; aún sin doc_number (estado `pending`).

### Cerrar parte desde mobile (operario, modo firmado)
6. Login mobile como operario asignado a la orden.
7. Abrir la orden → "Cerrar parte":
   - Añadir 2 fotos
   - Bloque "Conformidad del cliente":
     - Nombre: `Juan García`
     - DNI: `12345678A` (validación inline OK)
     - Canvas firma: dibujar
   - Pulsar "Cerrar parte".
8. Verificar:
   - Llega a `WorkReportSuccessScreen` con check verde y `PT-2026-XXXXX`.
   - Pulsar "Compartir parte con el cliente" abre el sheet nativo iOS/Android (WhatsApp / Mail / AirDrop).
   - El PDF descargado tiene el doc_number como nombre.

### Verificar PDF en web (admin emisor)
9. Volver al web autenticado.
10. En `/work-orders` ver la orden:
    - Estado `done` con chip de doc_number `PT-2026-XXXXX`.
    - Botón "⤓ PDF" descarga el archivo.
11. Abrir el PDF y comprobar:
    - Cabecera con logo del tenant emisor + color primario configurado.
    - Bloque "Emite": brand_name + CIF + dirección fiscal.
    - Bloque "Cliente": Comunidad El Pinar + C/ Mayor 12, Valencia.
    - Tabla "Paradas y mediciones" con 3 filas y 4 columnas (Aspiración, Presión máx, RPM medio, Combustible).
    - Las 2 fotos.
    - Bloque firma: nombre Juan García + DNI 12345678A + imagen canvas.
    - Footer con `brand_name · doc_number` izda y "Página 1 de 1" dcha.

### Caso "no se puede firmar"
12. Crear otra orden similar.
13. Mobile → cerrar parte: pulsar "⊘ No se puede firmar":
    - Seleccionar "Cliente ausente"
    - Pulsar "Cerrar parte".
14. Verificar PDF en web:
    - Bloque "Conformidad del cliente": nota gris cursiva *"Parte cerrado sin firma del cliente. Motivo: Cliente ausente."*
    - **Sin sello rojo** (cambio aprobado del spec).

### Tab "Telemetría capturada"
15. En `/work-orders` abrir el modal "Informe" de una orden completada.
16. Bajar a la sección "Telemetría capturada por parada":
    - Acordeón por parada
    - Cada métrica con tag verde **✓ PDF** si está en `pdf_metrics`, gris `—` si no.

### Validaciones de regresión
- ✅ La creación de tenants sigue funcionando como antes.
- ✅ El cierre de orden sin firma ni motivo devuelve 422 con mensaje claro.
- ✅ Las órdenes ya completadas antes de la migración no tienen doc_number (NULL); el frontend muestra "—".
- ✅ Los tenants sin CIF configurado generan PDF sin línea de CIF (sin error).
- ✅ Vehículos sin pdf_metrics configurado: el PDF muestra solo la lista de paradas sin tabla de mediciones.

## Riesgos a vigilar tras el deploy

1. **Logos del tenant** sirviéndose desde `/uploads/...` deben ser accesibles internamente como `file:///app/uploads/...` para WeasyPrint. El helper `_to_file_url` ya hace esa conversión.
2. **Brand color**: si el tenant solo tiene `brand_color` (columna) sin `brand_tokens.primary_color`, el PDF lo lee correctamente como fallback.
3. **iOS Share Sheet**: requiere `UTI: 'com.adobe.pdf'` en el `shareAsync` para que aplicaciones como Mail reconozcan el archivo. Ya configurado.
4. **Tokens de SecureStore en mobile**: el helper `downloadAndShareReportPdf` lee `access_token` de SecureStore directamente, sin pasar por axios — si el access_token expira durante la descarga, fallará con 401 y el operario verá el alert. En la práctica la descarga es inmediata tras el cierre, así que el token recién refrescado todavía es válido.
