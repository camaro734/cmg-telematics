# Plan del rediseño visual de CMG Track

**Fecha de cierre del plan:** 30 mayo 2026
**Estado:** decisiones de diseño cerradas, ejecución pendiente

## Paleta y estética

- Paleta fría azul-gris (sala de control), en sustitución de la cálida marrón actual.
- Color de acento: teal #1D9E75 (decisión confirmada con comparativa visual).
- Tipografía: Inter (ya definida en design-system de temp/).
- Logo: PNG cmgtrack.png alta resolución (ya rescatado del alijo).

## Pantalla Flota (pantalla principal tras login)

- Eliminar la banda lateral fija de vehículos.
- El mapa ocupa el ancho completo.
- Panel flotante sobre el mapa con la lista de vehículos: en una esquina, con buscador y filtros, minimizable a un botón pequeño.
- Estilo CARTO Voyager para el mapa (calles, edificios, contexto real).
- Marcador de posición: pin azul Leaflet con halo verde teal.

## Detalle de vehículo

- Cabecera densa: nombre + matrícula + cliente + voltaje + ignición + velocidad en una línea.
- Eliminar los KPI grandes separados (velocidad, PTO, voltaje) — integrar en la cabecera.
- Pestañas: En vivo, Histórico, Ciclos, Mantenimiento (sin cambios).
- Mapa horizontal grande debajo de las pestañas, ancho completo, estilo Voyager. Etiqueta superpuesta con calle + ciudad.
- Estado del equipo (gauges) en tarjetas compactas DEBAJO del mapa, no a la derecha.
- Etiquetas de gauges: nombre completo en dos líneas fijas, alturas uniformes. Sin abreviaciones.
- Banner expandible rojo bajo la cabecera SI hay alertas activas (mensaje + valor + tiempo). Si no hay, no aparece.

## Pantalla Alertas

- Barra de gravedad a la izquierda por color: rojo (crítica), ámbar (aviso), gris (info).
- Agrupar repeticiones de la misma alerta del mismo vehículo en una fila con contador "×N repeticiones".
- Datos a la vista por alerta: vehículo + matrícula + cliente, valor que disparó + umbral, primera y última repetición.
- Solo dos acciones por alerta: "Ver vehículo" y "Reconocer". NO "Avisar" (el sistema ya envía emails automáticos).
- Cabecera con contadores por gravedad ("N crítica, N aviso, N info") y buscador + filtros.

## Eliminar Dashboard

- La pantalla Dashboard deja de existir.
- Tras login, redirigir a Flota.
- Quitar el enlace Dashboard del menú principal.
- Redireccionar las URLs antiguas del Dashboard a Flota (por enlaces guardados).

## Pantalla Mantenimiento

- Tres estados visibles: VENCIDO (rojo), PRONTO (ámbar), AL DÍA (verde discreto).
- Barra de gravedad a la izquierda + etiqueta de estado (mismo lenguaje visual que Alertas).
- Barra de progreso colorizada según estado, con porcentaje pudiendo superar el 100% en vencidos.
- Cabecera con contadores por estado ("N vencido, N pronto, N al día").
- Búsqueda y filtros (cliente, vehículo, estado).
- Botón "Realizado" siempre visible (más sutil en al día), con confirmación pequeña antes de marcar.
- Acción "Realizado": apunta fecha, reinicia contador, manda al histórico.
- Pestaña "Historial" añadida.
- Permisos: la usa quien tenga asignado el dispositivo (el cliente) y admin CMG.

## Login

- Quitar el texto redundante "Inicia sesión para continuar".
- Añadir icono de ojo para mostrar/ocultar contraseña.
- Centrado vertical mejorado, más respiración.
- Placeholder sutil en email ("tu@empresa.com").
- Mensajes de error específicos bajo la caja: "Email o contraseña incorrectos", "Cuenta bloqueada", etc.
- Estado de "Verificando..." en el botón al iniciar sesión, botón deshabilitado mientras tanto.
- Mantener "Contacta con tu administrador" — no se implementa recuperación automática.

## Pantalla Reportes

- Selección de uno o varios vehículos (no solo uno como ahora).
- Fechas Desde — Hasta siempre visibles. Las pills Día/Semana/Mes son atajos que las rellenan.
- Botones "Descargar PDF" y "Descargar CSV" al lado de los filtros, no en la esquina.
- Periodo por defecto: últimos 7 días.
- Sin envío automático por email — el cliente descarga él mismo.
- Paleta y lenguaje visual coherente con el resto.

## PDF de Reportes

- Mantener portada con logo CMG, nombre del cliente, vehículo, periodo, generación.
- ARREGLAR el mapa GPS — que el recorrido salga dibujado de verdad, no "no disponible".
- Omitir secciones/páginas enteras cuando estén vacías (no mostrar "Sin intervenciones").
- Añadir gráficas: tendencia de voltaje, picos de RPM, además de horas PTO.
- Métricas específicas del tipo de vehículo se grafican también si hay datos.
- Gráficas con teal nuevo (no naranja suelto).
- Mantener tabla de resumen por vehículo.

## Hallazgos técnicos pendientes (NO son rediseño)

Hay que arreglar estos antes/durante la programación del rediseño:

1. **Gauges vacíos en detalle de vehículo.** Los datos llegan a BD (RPM, temperatura, kilómetros, AdBlue, combustible) pero los gauges aparecen sin valor. Es problema de conexión entre dato y componente, no de diseño. Rediseñar gauges sin datos sería rediseñar a ciegas — arreglar esto primero.

2. **Seguridad de autenticación.** Las sesiones no se invalidan al cambiar contraseña (el cambio funciona, pero las sesiones ya abiertas siguen vivas). Y las sesiones duran indefinidamente. Necesita: invalidar tokens activos al cambiar contraseña excepto la sesión actual, y caducidad razonable de sesión (entre 7 y 30 días). Tocar autenticación es delicado — requiere sesión dedicada, no improvisada.

## Proyecto paralelo: cumplimiento RGPD

Los reportes incluyen recorrido GPS, que es dato personal del conductor según RGPD. Lo hacen así los grandes (Samsara, Geotab):
- Modo Privacidad activable por el conductor.
- Separar datos del vehículo (siempre visibles) de datos personales (con cuidado especial).
- Transparencia obligatoria: el conductor debe saber qué se registra.
- Contrato de encargado del tratamiento entre CMG y cada cliente.
- Retención limitada de datos GPS.

Pendiente:
1. Plantilla de contrato de encargado del tratamiento (CMG ↔ cliente) — abogado especialista.
2. Política de privacidad publicada en la app.
3. Aviso para conductores (texto reusable que el cliente reparte en su empresa).
4. Retención configurable de datos GPS (cuánto tiempo se guardan).
5. Permisos por cliente verificados (cada usuario ve solo lo suyo).
6. Log de accesos de admin CMG (quién vio qué y cuándo).

El diseño del rediseño debe dejar hueco para los enlaces legales (footer) y respetar los permisos por cliente desde el principio.

## Orden de ejecución pendiente de decidir

Para mañana o próxima sesión: en qué orden se programan las pantallas, qué hallazgos técnicos se atacan antes, cuándo se aborda el PDF, cómo se reparte el rediseño en fases reviewables.

---

Fin del plan. Estado: cerrado en lo conceptual, listo para discutir ejecución.

---

# Plan de ejecución

**Fecha de cierre del plan de ejecución:** 31 mayo 2026
**Estado:** orden de ejecución decidido, listo para arrancar Fase 1.

## Orden de fases

### Fase 1 — Base: tokens + tipografía (1-2 días)
- Sustituir los tokens de color cálidos por la paleta fría azul-gris.
- Integrar tipografía Inter (ya disponible en `temp/design-system/fonts/`).
- Verificar que todas las pantallas existentes pasan a tener el nuevo "fondo" automáticamente.
- CI debe quedar verde tras esta fase.

### Fase 1.5 — Componentes compartidos (3-4 días)
Tres sub-tareas:

**(a) Decidir Topbar.tsx**
- Confirmar si `frontend/src/shared/ui/Topbar.tsx` se usa todavía en alguna pantalla.
- Si no se usa, eliminarlo (es duplicado funcional de TopNav.tsx).
- Si se usa en algún sitio puntual, decidir si se migra al TopNav o se mantiene.

**(b) Crear componentes de formulario compartidos**
- Crear desde cero: `Input.tsx`, `Select.tsx`, `Checkbox.tsx`, `Textarea.tsx` en `frontend/src/shared/ui/`.
- Diseño coherente con la paleta fría y los Button/ConfirmDialog existentes.
- NO migrar los formularios existentes en este paso — solo crear los componentes y un Storybook/ejemplo mínimo.
- Justificación: hoy cada pantalla tiene sus `<input style={...}>` inline. Migrar a componentes compartidos se hace en cada pantalla cuando le toque, no de golpe.

**(c) Rediseñar componentes existentes con la paleta nueva**
- Aplicar paleta fría a: `Button.tsx`, `ConfirmDialog.tsx`, `Toast.tsx`, `Chip.tsx`, `StatusBadge.tsx`, `Sparkline.tsx`, todos los `gauges/*.tsx`, `SkeletonCard.tsx`, `SectionErrorBoundary.tsx`.
- NO tocar estructura, solo estilos.
- NO tocar `TopNav.tsx` (alto riesgo, se hace en Fase 2 dentro de Flota).
- NO tocar `GeofenceMapEditor.tsx` (mal ubicado, se reubica cuando toque geocercas).

Tras Fase 1.5, abrir CUALQUIER pantalla de la app y los modales, botones, badges, toasts deben tener look frío nuevo. Aunque las pantallas en sí sigan estructuradas como hoy.

### Fase 2 — Pantalla Flota (2-3 días)
- Eliminar la banda lateral fija de vehículos.
- Mapa a ancho completo con estilo CARTO Voyager.
- Implementar el panel flotante sobre el mapa con buscador, minimizable.
- Marcador con pin azul Leaflet + halo verde teal.
- TopNav (que es el componente más complejo del repo) se ajusta aquí si hace falta. Tratar con cuidado.

### Revisión 1 junio 2026 — cambio de scope

Tras verificación visual en vivo de /fleet, Carlos confirma que el
layout actual (lista de vehículos a la izquierda + mapa a ancho
completo a la derecha) FUNCIONA y NO debe rediseñarse. El plan
original ("eliminar banda lateral + panel flotante en esquina")
queda DESCARTADO.

El scope real de Fase 2 pasa a ser:

**Rediseñar el popup del marcador del vehículo en el mapa.**

El popup actual muestra solo nombre + matrícula + estado + última
señal + enlace al detalle. Carlos lo considera "simple visualmente
y pobre en información". Decisión: enriquecerlo en información y
rediseñarlo visualmente.

Estimación revisada: 1 sesión de implementación (no 3-4 días). Pasa
de "rediseño estructural de pantalla" a "rediseño de un componente
acotado".

---

## Especificación del popup rediseñado

### Información en nivel esencial (siempre visible)

- Cabecera: nombre del vehículo (izquierda, font-weight 500) +
  matrícula (derecha, color secundario).
- Cliente al que pertenece el vehículo, debajo del nombre, en
  color secundario.
- Si vehículo OFFLINE: banda roja arriba con texto
  "Datos desactualizados desde [hora]".
- Si vehículo tiene alerta crítica: borde IZQUIERDO de 3px en
  color de severidad (rojo crítico, ámbar aviso). Solo border-left,
  no borde completo (criterio: sutil pero presente).
- Chip de alertas activas: icono + texto + fondo en color de
  severidad. Una alerta por chip. Habitual 0-2 alertas.
- Tabla compacta con iconos de Tabler:
  - Conductor (icono ti-user). Si no hay conductor: mostrar
    "Sin conductor asignado" en color tertiary itálico.
  - Estado (icono según estado): "En línea" en verde teal /
    "Offline" en gris secundario.
  - Última señal: hora.
- Dos botones al pie:
  - "Ver más ↓" — despliega sección expandida (sub-nivel).
  - "Detalle →" — navega a /vehicles/:id.

### Información en nivel "Ver más" (al desplegar, crece hacia abajo)

- Label "EQUIPO INDUSTRIAL" en mayúsculas pequeñas, color tertiary.
- Tabla compacta con estado de cada elemento del equipo:
  - PTO
  - Depresor
  - Bomba (de agua si aplica)
  - Otros relevantes según vehículo
- VALORES VISUALMENTE DIFERENCIADOS:
  - "Activo" en verde teal (var(--ok) o equivalente coherente).
  - "Inactivo" en gris secundario.
- Botón cambia a "Ver menos ↑".

### Estilo visual

- Fondo claro (mantener nativo de Leaflet, NO oscurecer).
- Tipografía cuidada, jerarquía con dos pesos (400 y 500).
- Sombra suave, esquinas redondeadas (border-radius-md).
- Ancho: min 280px, max 340px.
- Padding interno: 14px-16px.
- Separadores entre secciones: 0.5px solid var(--color-border-tertiary).

### Estados especiales documentados

- Sin conductor → "Sin conductor asignado" en gris dim itálico
  (campo visible, dato vacío).
- Sin cliente → mostrar "—" en lugar del nombre del cliente
  (decisión técnica futura, falta confirmar).
- Offline + alerta → ambos elementos visibles al mismo tiempo
  (banda roja arriba + borde izquierdo rojo + chip de alerta).
- Sin alertas → no se muestra ni chip ni borde, popup limpio.

### Decisiones de diseño tomadas explícitamente

1. Información a mostrar: nombre, matrícula, cliente, conductor,
   estado online/offline, última señal, alertas activas, estado
   del equipo industrial (en nivel "Ver más").
2. Tipo de despliegue: "Ver más" CRECE hacia abajo dentro del
   mismo popup. NO abre popup secundario ni navega.
3. Aviso de offline: ROJO (tratar como problema, no como warning).
4. Borde de severidad: SOLO border-left, 3px, sutil.
5. Equipo activo: en VERDE TEAL (destaca).
6. Fondo: claro (estilo Leaflet nativo, NO oscuro).

### Mockup de referencia

Hay un mockup HTML/SVG aprobado en la conversación de Claude del
1 junio 2026, sesión de tarde. Si se pierde el contexto, regenerar
mockup pidiendo a Claude reproducir desde la especificación
anterior, indicando "popup_marcador_flota_v1".

### Fase 3 — Eliminar Dashboard (medio día)
- Quitar el enlace "Dashboard" del menú principal.
- Cambiar la pantalla por defecto tras login a `/fleet`.
- Redirigir URLs antiguas del Dashboard a Flota.

### Fase 4 — Detalle de vehículo (3-4 días, la más larga)
- Cabecera densa con KPI integrados.
- Mapa horizontal grande debajo de pestañas (Voyager, reutilizar de Flota).
- Estado del equipo en tarjetas compactas DEBAJO del mapa.
- Etiquetas de gauges en dos líneas fijas.
- Banner expandible rojo si hay alertas activas.

### Notas de verificación visual del 1 junio 2026

Durante la sesión de cierre de Fase 1.5 (tokenización de paleta cálida)
se verificó visualmente la pantalla del Detalle de vehículo y se
confirmaron en vivo los problemas estructurales ya documentados arriba:

- Etiquetas de gauges largas rompen en 4-5 líneas dentro de tarjetas
  estrechas ("PICO MÁXIMO DE PRESIÓN DE AGUA", "PICO MÁXIMO DEPRESOR
  SOPLANDO", etc.). La tipografía es legible pero la cuadrícula queda
  descompensada.
- Cuando muchos gauges no tienen dato (vehículo de prueba parado), la
  pantalla muestra muchas tarjetas vacías con solo el dash "—".
  Esperado en vehículo de prueba.
- El gauge RPM motor tiene su semicírculo y su número distanciados
  visualmente; falta cohesión.
- Layout general: los gauges no respiran, hay sensación de
  amontonamiento.

Cualquier rediseño de Fase 4 debe resolver estos puntos. La paleta
fría está aplicada correctamente — el problema es estructural, no
cromático.

### Fase 5 — Pantalla Alertas (1-2 días)
- Barra de gravedad por color (crítica/aviso/info).
- Agrupación de repeticiones.
- Datos clave a la vista.
- Dos acciones: Ver vehículo, Reconocer.
- Buscador y filtros, contadores por gravedad.

### Fase 6 — Pantalla Mantenimiento (1-2 días)
- Tres estados (vencido/pronto/al día) con mismo lenguaje visual que Alertas.
- Botón Realizado con confirmación pequeña.
- Pestaña Historial.

### Fase 7 — Login (medio día)
- Quitar texto redundante.
- Ojo para mostrar/ocultar contraseña.
- Centrado vertical mejorado, placeholder en email.
- Mensajes de error específicos, estado de "verificando".

### Fase 8 — Pantalla Reportes (1-2 días)
- Selección de uno o varios vehículos.
- Fechas Desde-Hasta siempre visibles + pills como atajos.
- Botones PDF y CSV junto a filtros.
- Periodo por defecto: 7 días.

### Fase 9 — PDF de Reportes (proyecto aparte, sin estimación)
- Arreglar mapa GPS.
- Omitir páginas vacías.
- Añadir gráficas (tendencia voltaje, picos RPM).
- Métricas configuradas en el tipo de vehículo se grafican si hay datos.
- Gráficas con teal nuevo.

## Reglas transversales

- **CI verde obligatorio entre fases.** Si una fase deja el CI en rojo, no se pasa a la siguiente.
- **Paradas estratégicas** después de Fase 2 (Flota) y Fase 4 (Detalle): un día usando la app rediseñada parcialmente antes de seguir, para pillar detalles que la planificación no anticipa.
- **TopNav.tsx con cuidado especial** — componente más complejo del repo (navegación + auth + tenant selector + detección móvil + role guards). Cualquier cambio estructural en él es de alto riesgo.
- **GeofenceMapEditor.tsx** se reubica de shared/ui a features/geofences/ cuando toquemos geocercas (no en este rediseño).

## Estimación total

- Trabajo efectivo: 13-18 días.
- Calendario real (con interrupciones, otras tareas, revisiones): 3-5 semanas.
- PDF de Reportes (Fase 9): a estimar cuando se aborde.

## Estado actual al cerrar la sesión del 31 mayo 2026

- Hallazgo de autenticación: **CERRADO** (commit fb917a8, migración 034 aplicada en producción, verificado en vivo).
- Hallazgo de gauges vacíos: descartado, no era bug (vehículo de prueba sin datos).
- Proyecto RGPD: pendiente, requiere abogado especialista.
- Deuda técnica nueva: sin tests de autenticación (test_refresh_with_invalid_pwd_version, test_password_change_increments_version, test_refresh_inherits_exp). Sesión dedicada cuando termine el rediseño.

## Próximo paso

Arrancar **Fase 1** (tokens + tipografía Inter) en la siguiente sesión.

---

## Deuda técnica menor identificada — 1 junio 2026

1. **Hex literales con sufijo de opacidad en template strings** — ✅ RESUELTO 1 junio 2026 commit c912d48.
   Creados `--danger-12`, `--danger-25`, `--warn-12`, `--info-12` en tokens.css. Refactorizados 9 hits
   en FleetMap.tsx, ReportsPage.tsx (CartesianGrid + overlay Leaflet) usando los tokens nuevos y
   `var(--border)` / `var(--bg-elevated)` según corresponda.
   Hits residuales justificados (deuda permanente): pulse rings SVG en marcadores Leaflet (API no
   acepta `var()`), BrandTokensEditor.tsx (input type=color exige hex).

2. **Hex literal del marcador Leaflet** en ClientPortalPage.tsx:89 (`#64748B`). Razón: la API de Leaflet no acepta `var()` en atributos SVG. Solución futura: leer la variable CSS con `getComputedStyle()` al inicializar el mapa.

3. **Hex literales en BrandTokensEditor.tsx** (valores default del color picker). Razón: `<input type="color">` exige hex literal por especificación HTML. Son correctos tal como están.

### Bug visual del tooltip de Recharts en Reportes — ✅ RESUELTO 1 junio 2026 commit c912d48

Pantallas afectadas: /reports, /dashboard, /vehicles/:id (KpiChart).
Causa real: `contentStyle.color` aplica al contenedor externo del tooltip, pero los valores de
cada serie se renderizan en `.recharts-tooltip-item` con CSS propio de Recharts que sobrescribe
la herencia. Solución: añadir `itemStyle: { color: 'var(--fg-primary)' }` en cada `<Tooltip>`.
Afectaba 10 tooltips en 3 archivos (ReportsPage 6, KpiChart 3, DashboardPage 1).
Contraste resultante: `--fg-primary` (#F1F5F9) sobre `--bg-elevated` (#22263A) = 9.5:1.
Verificado visualmente en /reports.

## Bug preexistente identificado — 1 junio 2026

Pie chart "Distribución del tiempo" en ReportsPage.tsx asigna colores por índice del array filtrado, no por nombre del segmento. Cuando un segmento (PTO, Motor o Parado) tiene valor cero, los índices restantes "se deslizan" y los segmentos visibles reciben colores que no les corresponden.

**Solución:** cambiar de mapeo por índice a mapeo por nombre semántico:
```tsx
const PIE_COLOR: Record<string, string> = {
  'PTO':    'var(--energy-orange)',
  'Motor':  '#22C55E',
  'Parado': 'var(--offline)',
}
// <Cell fill={PIE_COLOR[entry.name] ?? 'var(--fg-dim)'} />
```

Trabajo estimado: 10 minutos. Se aborda cuando se trate el componente Reportes en la Fase 8 del rediseño.
