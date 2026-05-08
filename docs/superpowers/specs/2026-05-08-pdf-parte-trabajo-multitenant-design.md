# PDF de parte de trabajo multi-tenant — Diseño

**Fecha:** 2026-05-08
**Autor:** brainstorming session (carlos@cmghidraulica.com)
**Estado:** propuesta de diseño, pendiente de plan de implementación

---

## 1. Contexto y problema

CMG Telematics es un SaaS de telemetría con jerarquía de tenants en árbol de 3 niveles:

- **CMG** (`tier=cmg`) — propietario del software
- **Cliente directo** (`tier=client`) — ej. Vacuum
- **Sub-cliente** (`tier=subclient`) — ej. Aguas de Valencia

Los sub-clientes ejecutan trabajos de campo con sus operarios y necesitan emitir un parte de servicio (recibo) para sus clientes finales (ej. comunidades de propietarios, ayuntamientos). Hoy la plataforma genera un PDF básico con WeasyPrint pero:

- Solo inyecta el `brand_name` del tenant — sin logo ni colores propios.
- Captura firma del operario, no del cliente final.
- No tiene DNI del firmante ni datos legales del emisor.
- No expone telemetría por parada (presiones hidráulicas, PTO, RPM, combustible) aunque ya se captura en `work_order_stop`.
El objetivo es transformar ese PDF en un albarán de servicio profesional con branding por tenant emisor, telemetría configurable por tipo de vehículo, y firma + DNI del cliente final, descargable por los admins/operadores autenticados de cada tenant desde el web habitual.

## 2. Decisiones tomadas durante el brainstorming

1. **Propósito del PDF:** recibo de servicio compacto para el cliente final. Una página A4 si es posible, paginación natural si excede.
2. **Solo se captura firma + DNI del cliente final** (no del operario).
3. **Configuración de métricas:** `vehicle_type.pdf_metrics` JSONB. Cada tipo de vehículo define qué métricas salen en el PDF. Distinto de `historic_metrics` (gráficas de `/reports`).
4. **Layout:** recibo clásico vertical top-down (header → emisor/cliente → servicio → tabla de paradas → fotos → firma).
5. **Captura firma:** in-situ en la mobile del operario al cerrar el parte. Si no se puede firmar, botón explícito "No se puede firmar" + motivo.
6. **Numeración del documento:** `PT-{año}-{NNNNN}` con secuencia **independiente por tenant emisor** (cada subclient tiene su propia serie).
7. **Vista admin:** además del PDF, el admin del emisor ve en el web una pestaña "Telemetría capturada" con TODAS las métricas del work_order, incluso las no incluidas en el PDF.
8. **Datos legales del emisor:** CIF y dirección fiscal opcionales en `tenant`. Si están, salen en el PDF; si no, se omiten.

## 3. Modelo de datos (Migración 020)

**Nombre sugerido:** `020_work_report_pdf_multitenant.py`

### 3.1 — `vehicle_type`
```sql
ALTER TABLE vehicle_type
  ADD COLUMN pdf_metrics JSONB NOT NULL DEFAULT '[]'::jsonb;
```
Estructura del JSONB — array ordenado de objetos:
```json
[
  {"key": "pto_minutes",  "label": "Tiempo PTO",   "unit": "min", "format": "integer"},
  {"key": "pressure_max", "label": "Presión máx.", "unit": "bar", "format": "decimal1"},
  {"key": "rpm_avg",      "label": "RPM medio",    "unit": "rpm", "format": "integer"},
  {"key": "fuel_l",       "label": "Combustible",  "unit": "L",   "format": "decimal1"}
]
```

`key` debe coincidir con una columna existente de `work_order_stop`. `format` ∈ `{integer, decimal1, decimal2}`. Catálogo de columnas válidas (hardcoded en frontend y validado en backend Pydantic):

| key | default_label | default_unit | default_format |
|---|---|---|---|
| `pto_minutes` | Tiempo PTO | min | integer |
| `pressure_min` | Presión mín. | bar | decimal1 |
| `pressure_max` | Presión máx. | bar | decimal1 |
| `rpm_avg` | RPM medio | rpm | integer |
| `pump_minutes` | Tiempo bomba | min | integer |
| `fuel_l` | Combustible | L | decimal1 |

### 3.2 — `tenant`
```sql
ALTER TABLE tenant
  ADD COLUMN business_cif      VARCHAR(20),
  ADD COLUMN business_address  VARCHAR(300);
```
`brand_tokens` ya existe como JSONB; se establece convención de clave `primary_color` (string hex) — sin migración, basta documentar.

> **Decisión de scope:** este sprint **no toca el portal público existente**. La descarga de PDFs es solo para usuarios autenticados (admins/operadores de cada tenant) desde el web habitual. Si en el futuro el cliente final necesita acceso directo al PDF sin login se evaluará entonces (firmar URL temporal, envío por email, etc.).

### 3.3 — `work_order`
```sql
ALTER TABLE work_order
  ADD COLUMN final_client_name    VARCHAR(200),
  ADD COLUMN final_client_address VARCHAR(300),
  ADD COLUMN doc_number           VARCHAR(40);
CREATE UNIQUE INDEX work_order_doc_number_idx
  ON work_order (tenant_id, doc_number) WHERE doc_number IS NOT NULL;
```

### 3.4 — `work_report`
```sql
ALTER TABLE work_report
  ADD COLUMN client_signee_name VARCHAR(200),
  ADD COLUMN client_signee_dni  VARCHAR(20),
  ADD COLUMN unsigned_reason    VARCHAR(200);
```
`signature_url` ya existe — se reinterpreta semánticamente como firma del cliente final. **Restricción aplicada en código** (no via CHECK constraint, para flexibilidad):
- Una de estas dos condiciones debe cumplirse al crear/finalizar el report:
  - `signature_url` IS NOT NULL **AND** `client_signee_name` IS NOT NULL **AND** `client_signee_dni` IS NOT NULL
  - `unsigned_reason` IS NOT NULL
- Y son mutuamente excluyentes: si `unsigned_reason` está, los tres campos firmados deben ser NULL.

### 3.5 — `tenant_doc_counter` (nueva tabla)
```sql
CREATE TABLE tenant_doc_counter (
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year      INTEGER NOT NULL,
  last_seq  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);
```
Asignación atómica del siguiente número:
```sql
INSERT INTO tenant_doc_counter (tenant_id, year, last_seq)
VALUES (:t, :y, 1)
ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_seq = tenant_doc_counter.last_seq + 1
RETURNING last_seq;
```
Formato final: `PT-{year}-{seq:05d}` (ej. `PT-2026-00142`).

## 4. Backend — endpoints

### 4.1 — Configuración `pdf_metrics`
**`PATCH /api/v1/vehicle-types/{id}`** (existente). Extensión del schema Pydantic `VehicleTypeUpdate`:
```python
class PdfMetric(BaseModel):
    key: Literal['pto_minutes','pressure_min','pressure_max','rpm_avg','pump_minutes','fuel_l']
    label: str = Field(min_length=1, max_length=60)
    unit:  str = Field(min_length=1, max_length=10)
    format: Literal['integer','decimal1','decimal2']

class VehicleTypeUpdate(BaseModel):
    # ... campos existentes ...
    pdf_metrics: list[PdfMetric] | None = None
```
Validación: keys únicas en la lista (no repetir la misma métrica). Solo CMG admin y admin del tenant propietario del `vehicle_type` pueden modificar.

### 4.2 — Crear / editar work_order con cliente final
**`POST /api/v1/work-orders`** y **`PATCH /api/v1/work-orders/{id}`** — schema extendido:
```python
final_client_name:    str | None = Field(None, max_length=200)
final_client_address: str | None = Field(None, max_length=300)
```
Editable mientras la orden está en `pending` o `in_progress`.

### 4.3 — Cerrar orden y asignar `doc_number`
Helper interno en `backend/app/services/work_orders.py`:
```python
async def assign_doc_number(db: AsyncSession, tenant_id: UUID, completed_at: datetime) -> str:
    year = completed_at.year
    result = await db.execute(text("""
        INSERT INTO tenant_doc_counter (tenant_id, year, last_seq)
        VALUES (:t, :y, 1)
        ON CONFLICT (tenant_id, year)
          DO UPDATE SET last_seq = tenant_doc_counter.last_seq + 1
        RETURNING last_seq
    """), {"t": tenant_id, "y": year})
    seq = result.scalar_one()
    return f"PT-{year}-{seq:05d}"
```
Llamado en la transición `status → completed` dentro de `PATCH /work-orders/{id}` (ya existente). Si `doc_number` ya está asignado, no se sobreescribe (idempotente).

### 4.4 — Cerrar parte (firmar o "sin firma")
**`POST /api/v1/work-orders/{order_id}/report`** — body extendido:
```python
class WorkReportCreate(BaseModel):
    description:           str | None = None
    work_duration_minutes: int | None = None
    photo_urls:            list[str] = []
    signature_url:         str | None = None
    client_signee_name:    str | None = Field(None, max_length=200)
    client_signee_dni:     str | None = Field(None, max_length=20)
    unsigned_reason:       str | None = Field(None, max_length=200)
    materials_used:        list[dict] = []
```
Validación server-side (en el endpoint, post-Pydantic):
- Si `unsigned_reason` está presente y no vacío → `signature_url`, `client_signee_name`, `client_signee_dni` deben ser `None` o vacíos.
- Si `unsigned_reason` está vacío/None → los tres campos firmados son obligatorios.
- Si la validación falla, `422` con mensaje claro: `"Debe firmar el parte o indicar el motivo por el que no se puede firmar"`.

Subida de firma e imágenes mantiene endpoints actuales (`POST /report/signature`, `POST /report/photos`).

### 4.5 — Generar PDF
**`GET /api/v1/work-orders/{order_id}/report/pdf`** (existente). Cambios internos:
1. Cargar `vehicle_type.pdf_metrics` del vehículo de la orden.
2. Cargar todos los `work_order_stop` ordenados por `sequence`.
3. Cargar `tenant.logo_url`, `tenant.brand_tokens.get('primary_color', '#F97316')`, `tenant.business_cif`, `tenant.business_address`.
4. Renderizar el template nuevo (Sección 5).
5. Exigir que la orden esté en estado `completed` (404 si no).

### 4.6 — Descarga del PDF
**Endpoint existente:** `GET /api/v1/work-orders/{order_id}/report/pdf` ya requiere JWT y filtra por `tenant_id` del usuario autenticado. **No se cambia la auth, solo el contenido del PDF y la lógica interna de carga de datos** (descrita en 4.5).

Acceso:
- **CMG admin** ve PDFs de todos los tenants.
- **Admin / operator del tenant emisor** (ej. Aguas de Valencia) ve PDFs de sus propias órdenes desde el web — incluyendo las de sus subclients si los tuviera, vía la jerarquía de permisos existente.
- **Operario / conductor desde la mobile** descarga el PDF de las órdenes que ha cerrado él (mismo JWT, mismo endpoint). Justo tras cerrar el parte, la app le ofrece compartir el PDF con el cliente final (WhatsApp, email, AirDrop, etc.) usando la Share API nativa.
- **Cliente final** (ej. Comunidad El Pinar) **no tiene acceso directo al PDF en la plataforma**: lo recibe del operario en el momento (compartido desde su móvil) o del subclient admin después (descargado del web y reenviado). Esto es intencional para evitar la complejidad de un portal público.

> **No se desarrolla ningún portal público en este sprint.** El portal `/portal/:token` actual sigue funcionando como está; ni se extiende ni se elimina. Si en el futuro se decide darle acceso directo al cliente final al PDF, se evaluará entonces (URL firmada con TTL, envío automático por email, etc.).

### 4.7 — Vista telemetría completa para admin
**Endpoint nuevo:** `GET /api/v1/work-orders/{order_id}/telemetry-detail`.
Devuelve:
```json
{
  "stops": [
    {
      "id": "...", "sequence": 1, "address": "...", "client_name": "...",
      "arrival_at": "...", "departure_at": "...",
      "telemetry": {
        "pto_minutes": 22, "pressure_min": 7.8, "pressure_max": 8.4,
        "rpm_avg": 1850, "pump_minutes": 18, "fuel_l": 4.2
      }
    }
  ],
  "pdf_metric_keys": ["pto_minutes", "pressure_max", "rpm_avg", "fuel_l"]
}
```
Auth normal por JWT, filtra por tenant_id del usuario.

## 5. Template PDF (HTML / Jinja)

Estilos clave:
- Tamaño A4 con margen 18mm/16mm (`@page`).
- Color primario inyectado desde `tenant.brand_tokens.primary_color` o fallback `#F97316`.
- Logo del tenant en cabecera con `max-height: 44px; max-width: 160px`.
- Tipografía: Helvetica/Arial para texto, JetBrains Mono opcional para columnas numéricas.
- `display: table-header-group` en `<thead>` para que la tabla de paradas repita encabezado al paginar.
- Bloque firma con `page-break-inside: avoid`.
- Footer con `@bottom-left/right` mostrando `brand_name · doc_number` y "Página X de Y".

Estructura del cuerpo:
1. **Header** — logo + brand_name + nº documento + fecha de cierre.
2. **Bloque "Emite / Cliente"** — dos columnas. Emite: brand_name, CIF, dirección fiscal (si existen). Cliente: final_client_name, final_client_address (si existen).
3. **Servicio realizado** — vehículo, conductor, duración. Título y descripción libre del operario.
4. **Paradas y mediciones** — tabla con columnas `# · Ubicación · {pdf_metrics dinámicas}`. Una fila por `work_order_stop`. Bajo la dirección, opcionalmente `client_name` de la parada en gris pequeño.
5. **Materiales utilizados** — tabla simple si `materials_used` no está vacío.
6. **Fotografías** — grid 3 columnas, alto fijo 110px.
7. **Conformidad del cliente:**
   - Si firmado: imagen de firma + nombre + DNI.
   - Si no firmado: nota discreta en gris cursiva — `"Parte cerrado sin firma del cliente. Motivo: {unsigned_reason}"`. Sin sello ni colores llamativos: el documento sigue siendo válido como justificante interno y el motivo queda registrado para trazabilidad.

Helper Jinja registrado:
```python
def format_metric(value, fmt: str, unit: str) -> str:
    if value is None: return "—"
    if fmt == "integer":  return f"{int(value)} {unit}"
    if fmt == "decimal1": return f"{value:.1f} {unit}"
    if fmt == "decimal2": return f"{value:.2f} {unit}"
    return f"{value} {unit}"
```

Template completo (reemplaza el actual `_PDF_TEMPLATE` en `backend/app/api/v1/work_reports.py`):

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm;
    @bottom-left  { content: "{{ brand_name }} · {{ doc_number }}"; font-size: 8px; color: #aaa; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8px; color: #aaa; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 2px solid {{ primary_color }}; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-logo { max-height: 44px; max-width: 160px; }
  .brand-name { font-size: 16px; font-weight: 700; color: {{ primary_color }}; }
  .brand-sub { font-size: 10px; color: #888; margin-top: 2px; }
  .doc-info { text-align: right; font-size: 10px; color: #555; }
  .doc-info .num { font-size: 14px; color: #222; font-weight: 700; display: block; }
  h2 { font-size: 11px; font-weight: 700; color: #1a1a1a; text-transform: uppercase;
       letter-spacing: 0.04em; border-left: 3px solid {{ primary_color }}; padding-left: 8px;
       margin: 14px 0 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: #fafafa;
             border: 1px solid #ececec; border-radius: 4px; padding: 10px 12px; }
  .party-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
                 color: {{ primary_color }}; font-weight: 700; margin-bottom: 4px; }
  .party-line { font-size: 11px; line-height: 1.4; }
  .service-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 16px;
                  font-size: 10px; margin-bottom: 6px; }
  .field-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
  .field-value { font-size: 11px; color: #222; font-weight: 500; margin-top: 1px; }
  .description-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px;
                     padding: 8px 10px; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; }
  table.stops { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.stops thead { display: table-header-group; }
  table.stops th { background: #f3f3f3; color: #555; padding: 6px 8px; text-align: left;
                   font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
                   border-bottom: 1px solid #ddd; }
  table.stops td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.stops td.num { font-weight: 700; color: {{ primary_color }}; width: 28px; }
  table.stops td.metric { font-family: 'JetBrains Mono', monospace; text-align: right; white-space: nowrap; }
  table.stops .stop-client { font-size: 9px; color: #888; margin-top: 2px; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
  .photo-img { width: 100%; height: 110px; object-fit: cover; border-radius: 3px; border: 1px solid #ddd; }
  .signature-section { margin-top: 22px; page-break-inside: avoid; }
  .signature-box { border: 1px solid #ccc; border-radius: 4px; padding: 10px 14px;
                   display: inline-block; min-width: 280px; }
  .signature-img { max-height: 90px; max-width: 280px; display: block; margin-bottom: 4px; }
  .signature-meta { font-size: 10px; color: #444; line-height: 1.4; padding-top: 4px; border-top: 1px solid #eee; }
  .signature-meta b { font-size: 11px; color: #222; }
  .unsigned-note { font-size: 11px; color: #777; font-style: italic; padding: 8px 0; }
  .unsigned-note b { color: #555; font-style: normal; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      {% if logo_url %}<img class="brand-logo" src="{{ logo_url }}"/>{% endif %}
      <div>
        <div class="brand-name">{{ brand_name }}</div>
        <div class="brand-sub">Parte de servicio</div>
      </div>
    </div>
    <div class="doc-info">
      <span class="num">{{ doc_number }}</span>
      {{ completed_date }}
      {% if completed_time %}<br>{{ completed_time }}{% endif %}
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">Emite</div>
      <div class="party-line"><b>{{ brand_name }}</b></div>
      {% if business_cif %}<div class="party-line">CIF: {{ business_cif }}</div>{% endif %}
      {% if business_address %}<div class="party-line">{{ business_address }}</div>{% endif %}
    </div>
    <div>
      <div class="party-label">Cliente</div>
      <div class="party-line"><b>{{ final_client_name or '—' }}</b></div>
      {% if final_client_address %}<div class="party-line">{{ final_client_address }}</div>{% endif %}
    </div>
  </div>

  <h2>Servicio realizado</h2>
  <div class="service-grid">
    <div><div class="field-label">Vehículo</div><div class="field-value">{{ vehicle_label }}</div></div>
    <div><div class="field-label">Conductor</div><div class="field-value">{{ driver_name or '—' }}</div></div>
    <div><div class="field-label">Duración</div><div class="field-value">{{ duration_label }}</div></div>
  </div>
  {% if order_title %}<div class="field-value" style="margin: 6px 0 4px;"><b>{{ order_title }}</b></div>{% endif %}
  {% if description %}<div class="description-box">{{ description }}</div>{% endif %}

  {% if stops %}
  <h2>Paradas y mediciones</h2>
  <table class="stops">
    <thead>
      <tr>
        <th>#</th><th>Ubicación</th>
        {% for m in pdf_metrics %}<th style="text-align:right">{{ m.label }}</th>{% endfor %}
      </tr>
    </thead>
    <tbody>
      {% for s in stops %}
      <tr>
        <td class="num">{{ loop.index }}</td>
        <td>
          <div>{{ s.address or '—' }}</div>
          {% if s.client_name %}<div class="stop-client">{{ s.client_name }}</div>{% endif %}
        </td>
        {% for m in pdf_metrics %}<td class="metric">{{ s[m.key] | format_metric(m.format, m.unit) }}</td>{% endfor %}
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if materials_used %}
  <h2>Materiales utilizados</h2>
  <table class="stops">
    <thead><tr><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
    <tbody>
      {% for m in materials_used %}
      <tr><td>{{ m.name }}</td><td class="metric">{{ m.quantity }}</td><td>{{ m.unit or '—' }}</td></tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if photo_urls %}
  <h2>Fotografías</h2>
  <div class="photos-grid">
    {% for url in photo_urls %}<img class="photo-img" src="{{ url }}"/>{% endfor %}
  </div>
  {% endif %}

  <div class="signature-section">
    <h2>Conformidad del cliente</h2>
    {% if signature_url %}
      <div class="signature-box">
        <img class="signature-img" src="{{ signature_url }}"/>
        <div class="signature-meta">
          <b>{{ signee_name }}</b><br>
          DNI: {{ signee_dni }}
        </div>
      </div>
    {% else %}
      <div class="unsigned-note">
        Parte cerrado sin firma del cliente. <b>Motivo:</b> {{ unsigned_reason }}
      </div>
    {% endif %}
  </div>
</body>
</html>
```

## 6. Mobile — flujo de captura

Pantalla `WorkReportScreen.tsx` reorganizada con dos modos mutuamente excluyentes:

**Modo "sign"** (default):
- Bloque "Conformidad del cliente" con inputs:
  - Nombre del firmante (texto, ≥3 chars, requerido)
  - DNI / NIE (texto, autoCapitalize chars, validación con letra de control opcional)
  - Canvas de firma con botón "Borrar firma"
- Botón secundario "No se puede firmar" abajo del bloque.

**Modo "unsigned"** (al pulsar el botón anterior):
- Picker de motivo: `Cliente ausente | Rechaza firmar | Menor de edad / sin capacidad | Otro`.
- Si se elige `Otro`: text input libre (≥3 chars).
- Botón "← Volver a captura de firma" para revertir al modo sign.

Validación local (`isValid`):
```ts
mode === 'sign'
  ? signeeName.trim().length >= 3 && isValidDni(signeeDni) && !!signatureB64
  : unsignedReason !== null && (unsignedReason !== 'other' || unsignedReasonText.trim().length >= 3)
```

`isValidDni()` (helper en `mobile/src/utils/dni.ts`) — valida DNI español (8 dígitos + letra control) y NIE (X/Y/Z + 7 + letra). Si el formato no parece español, acepta el valor tal cual (clientes extranjeros). Solo rechaza si parece DNI/NIE pero la letra es incorrecta.

Submit:
1. Subir fotos (existente).
2. Si `mode === 'sign'`: subir firma.
3. POST `/work-orders/{id}/report` con todos los campos.
4. PATCH `/work-orders/{id}` con `status: 'completed'` (asigna `doc_number`).
5. Navegar a una pantalla de éxito (`WorkReportSuccessScreen`) con dos acciones:
   - **"Compartir parte con el cliente"** (primary) — descarga el PDF con `expo-file-system` y lo abre con la Share API nativa (`expo-sharing`). El operario elige el canal (WhatsApp, Mail, AirDrop, etc.) directamente desde el sheet del SO.
   - **"Volver"** (secondary) — vuelve al listado de órdenes sin compartir.

Implementación de la descarga + compartir:
```ts
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'

async function shareReportPdf(orderId: string, docNumber: string) {
  const url = `${API_BASE}/api/v1/work-orders/${orderId}/report/pdf`
  const targetPath = `${FileSystem.cacheDirectory}${docNumber}.pdf`
  const { uri } = await FileSystem.downloadAsync(url, targetPath, {
    headers: { Authorization: `Bearer ${await getAuthToken()}` },
  })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Parte ${docNumber}` })
  }
}
```

Archivos modificados / nuevos:
- `mobile/src/screens/WorkReportScreen.tsx` (reescritura del bloque firma)
- `mobile/src/screens/WorkReportSuccessScreen.tsx` **(nuevo — pantalla post-cierre con botón compartir PDF)**
- `mobile/src/utils/dni.ts` (nuevo)
- `mobile/src/api/workOrders.ts` (extensión del payload + helper `downloadReportPdf`)
- `mobile/src/types/index.ts` (actualizar `WorkReport` type)
- `mobile/src/navigation/MainNavigator.tsx` (registrar la nueva pantalla en el stack)
- `mobile/package.json` — añadir `expo-sharing` si no está ya (probablemente sí, junto a `expo-file-system`).

## 7. Frontend web — UI

### 7.1 — `PdfMetricsSection` en `/tipos-vehiculo`
Componente nuevo `frontend/src/features/vehicleTypes/PdfMetricsSection.tsx`. Lista editable de métricas con interacciones:

- **Reordenar:** flechas ↑/↓ a la derecha de cada fila (sin DnD para evitar añadir dependencia nueva al proyecto).
- **Añadir:** botón "+ Añadir métrica" abre dropdown con el catálogo `AVAILABLE_METRICS` filtrado para excluir las ya añadidas. Al elegir una, se añade al final con `default_label`/`default_unit`/`default_format`.
- **Editar:** ícono ✎ en cada fila abre un modal pequeño con tres inputs (`label`, `unit`, `format` como select). Al guardar actualiza el array.
- **Eliminar:** ícono ✕ en cada fila con confirmación inline ("¿Quitar esta métrica del PDF?").
- **Vista previa:** debajo de la lista, una tabla render-only con datos de ejemplo hardcoded mostrando cómo quedará en el PDF.

Persistencia: cada cambio dispara `PATCH /vehicle-types/{id}` con el array completo (no operaciones parciales — la lista entera es atómica).

### 7.2 — Datos cliente final en `WorkOrderForm`
Sección "Datos del cliente final (opcional)" con `final_client_name` y `final_client_address`. Editable durante todo el ciclo de vida de la orden hasta que pase a `completed`.

### 7.3 — Tab "Telemetría capturada" en `/work-orders/:id`
Nueva tab en `WorkOrderDetailPage.tsx`. Acordeón por parada mostrando todos los campos de `work_order_stop`. Las métricas que están en `pdf_metrics` se marcan con ✓; las que no, con texto "capturado, no en PDF".

### 7.4 — Datos legales en `TenantFormPage`
Sección "Datos legales (aparecerán en el PDF de partes)" con `business_cif` y `business_address`. Sección "Branding" añade selector de `primary_color` (input type=color + hex text). Editable por el admin del propio tenant (Aguas de Valencia configura sus datos) o por CMG admin.

### 7.5 — Botón "Descargar PDF" en la app autenticada
Botón "⤓ Descargar parte (PDF)" visible en:
- **`WorkOrderDetailPage`** (`/work-orders/:id`) — botón principal en la cabecera, solo si la orden está en estado `completed`.
- **`WorkOrdersPage`** — icono de descarga en la fila de cada orden completada.

Implementación: simple `<a href={`/api/v1/work-orders/${id}/report/pdf`} target="_blank">` con header de auth en la sesión web (la cookie/JWT del usuario logado se manda automáticamente). No hay lógica nueva; es enlace directo al endpoint que ya existe (con la nueva firma del template multi-tenant).

### 7.6 — Mostrar `doc_number`
- `WorkOrdersPage`: nueva columna "Nº Doc" (solo visible si `completed`).
- `WorkOrderDetailPage`: header grande con `doc_number` junto al título.

## 8. Out of scope (YAGNI)

- Captura de foto del DNI físico del cliente.
- Búsqueda de cliente final por DNI en una BD de contactos.
- Envío automático del PDF por email/SMS al cliente final tras firmar.
- Preview en vivo del PDF en mobile antes de enviar.
- Editor visual de templates PDF arbitrarios.
- Múltiples plantillas PDF por tipo de vehículo.
- Botón "compartir PDF" en frontend web.
- Versión "borrador" del PDF antes de cerrar la orden.
- Override de `pdf_metrics` por orden de trabajo individual (todas las órdenes del mismo `vehicle_type` usan la misma config).
- Edición de `final_client_name`/`final_client_address` desde la mobile (asumimos: se rellena desde web antes de iniciar el trabajo).

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Race condition en `doc_number` con múltiples cierres simultáneos | UPSERT atómico con `RETURNING` sobre `tenant_doc_counter` (PostgreSQL garantiza atomicidad) |
| Operario olvida marcar "no se puede firmar" y se queda esperando | Validación local antes de habilitar botón submit + mensaje claro |
| Cliente final extranjero con DNI que no pasa validación española | `isValidDni` permisivo: solo rechaza si parece formato español pero letra incorrecta |
| Tenant cambia `pdf_metrics` después de cerrar órdenes | Las métricas se renderizan en el momento de descarga, no se snapshot — los PDFs futuros reflejarán la nueva config. Aceptable: el `work_order_stop` ya tiene los datos; solo cambia qué se muestra |
| Logo del tenant es muy grande y rompe el header | CSS limita `max-height: 44px; max-width: 160px`; WeasyPrint redimensiona |
| Cliente final sin login no puede ver el PDF | Aceptado por diseño. El subclient admin descarga y reenvía manualmente. Si en el futuro se necesita acceso directo, se evaluará entonces |

## 10. Plan de implementación (alto nivel)

Sugerido para el plan detallado posterior:

1. **Migración 020** — añadir columnas (`vehicle_type.pdf_metrics`, `tenant.business_cif/address`, `work_order.final_client_*`/`doc_number`, `work_report.client_signee_*`/`unsigned_reason`) + tabla `tenant_doc_counter`.
2. **Backend — modelos y schemas** — actualizar SQLAlchemy models y Pydantic schemas.
3. **Backend — helper `assign_doc_number`** + integración en `PATCH /work-orders/{id}`.
4. **Backend — endpoint `/report` ampliado** con validación XOR y nuevos campos.
5. **Backend — template PDF reescrito** + helper `format_metric`. Endpoint `GET /work-orders/{id}/report/pdf` carga `pdf_metrics` del vehicle_type, datos legales del tenant, branding y stops; renderiza el template nuevo.
6. **Backend — endpoint `/work-orders/{id}/telemetry-detail`**.
7. **Frontend — `PdfMetricsSection`** en `/tipos-vehiculo`.
8. **Frontend — datos cliente final** en `WorkOrderForm` + **datos legales y branding del tenant** en `TenantFormPage`.
9. **Frontend — Tab "Telemetría capturada" + columnas `doc_number`** en listados.
10. **Frontend — botones "Descargar PDF"** en `WorkOrderDetailPage` y `WorkOrdersPage`.
11. **Mobile — `WorkReportScreen` rediseñado** con captura firma+DNI o motivo, **y nueva `WorkReportSuccessScreen` con botón "Compartir parte"** que descarga el PDF y abre la Share API nativa.
12. **Verificación end-to-end** — crear tenant subclient, configurar `pdf_metrics` y datos legales, crear orden con cliente final, cerrar desde mobile firmando (y en otra prueba sin firmar con motivo), descargar PDF desde el web del subclient admin y verificar branding+telemetría+firma.
