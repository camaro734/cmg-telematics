# Plan del rediseño visual de CMG Track

**Fecha de cierre del plan:** 30 mayo 2026
**Estado:** Fases 1, 1.5 y 2 (popup marcador) completadas — próxima: Fase 3 (eliminar Dashboard)

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

**(a) Decidir Topbar.tsx** ✅ COMPLETADA 31 mayo 2026 commit 6da0a73
- Confirmado: `Topbar.tsx` no se importaba en ningún archivo del frontend.
- Eliminado como código muerto (duplicado funcional simplificado de TopNav.tsx).

**(b) Crear componentes de formulario compartidos** ✅ COMPLETADA 1 junio 2026 commits b39642d + 856c05c + 1a46be4
- `Input.tsx` creado (label, error, helperText, prefix, suffix, size, mono, forwardRef) + 21 tests.
- `Select.tsx` creado (label, error, helperText, size, children, forwardRef) + 19 tests.
- Migración masiva completada: ~110 inputs + ~47 selects = **~157 elementos migrados en ~57 archivos**.
- ~18 constantes locales (`inputStyle`, `SELECT`, `selStyle`, etc.) eliminadas.
- `Textarea.tsx` y `Checkbox.tsx` diferidos — YAGNI: menos de 8 instancias cada uno, sin divergencias que justifiquen encapsular ahora.

**(c) Rediseñar componentes existentes con la paleta nueva** ✅ COMPLETADA mayo-junio 2026 commits d9f8a33 + 322e3c1 + 33cff02 + d060466
- Paleta fría cold-dark aplicada a tokens CSS + Button.tsx + gauges + componentes shared.
- Categorías A, B y C de tokenización completadas (warm-palette → cold-palette).
- Deuda técnica de opacidad (9 hits rgba → tokens) resuelta en commit c912d48.
- TopNav.tsx y GeofenceMapEditor.tsx NO tocados (conforme a lo planeado).

Tras Fase 1.5, abrir CUALQUIER pantalla de la app y los modales, botones, badges, toasts deben tener look frío nuevo. Aunque las pantallas en sí sigan estructuradas como hoy.

### Fase 2 — Pantalla Flota (2-3 días)
- Eliminar la banda lateral fija de vehículos.
- Mapa a ancho completo con estilo CARTO Voyager.
- Implementar el panel flotante sobre el mapa con buscador, minimizable.
- Marcador con pin azul Leaflet + halo verde teal.
- TopNav (que es el componente más complejo del repo) se ajusta aquí si hace falta. Tratar con cuidado.

### Revisión 1 junio 2026 — cambio de scope ✅ COMPLETADA 1 junio 2026 commit df0fdcf

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

### Fase 3 — Eliminar Dashboard ✅ COMPLETADA 1 junio 2026
- Enlace "Dashboard" eliminado del TopNav (array MODULES).
- Logo del TopNav ahora navega a `/fleet` (antes `/dashboard`).
- Login y RequireModule redirigen a `/fleet`.
- Ruta `/dashboard` convertida en `<Navigate to="/fleet">` para compatibilidad con URLs antiguas.
- `DashboardPage.tsx` eliminado (413 líneas, 6 subcomponentes privados, ninguno rescatable).
- Pantalla por defecto tras login: `/fleet`.

## Fase 4 — Detalle de vehículo `/vehicles/:id` (rediseño completo, 4 tabs)

**Estado**: Planificada el 1 junio 2026. Pendiente de implementación.
**Estimación honesta**: 10-16 días de trabajo (~2-3 semanas).
**Justificación del alcance**: `/vehicles/:id` es la pantalla donde los clientes ven el valor real del producto (diagnóstico + operación). Inversión de producto, no solo cosmética. Diferencia Track de competencia (Wecove, Cleveapp).

### Filosofía del rediseño

Cambio conceptual respecto al diseño actual:
- De "muestra todos los datos crudos" → a "diagnostica el estado del vehículo".
- El técnico abre `/vehicles/:id` en el 70% de los casos para **diagnóstico rápido** (¿está OK / NO OK?), no para análisis profundo.
- La pantalla debe responder "¿está bien?" en menos de 3 segundos a la vista.

### Estructura general de la pantalla

#### Cabecera unificada (fija arriba)
- Botón "← Flota" para volver.
- Línea 1 (identidad): icono vehículo + nombre + matrícula + chip "EN LÍNEA"/"OFFLINE" + contador alertas activas con icono ⚠ + número + color (rojo crítica, ámbar aviso).
- Línea 2 (contexto operativo): cliente · ignición · voltaje · última señal.
- Botón "Actividad" en cabecera abre panel desplegable lateral con historial de comandos e incidencias (drawer estilo lateral derecho, lista paginada con filtros simples por tipo y fecha).

#### Tabs principales
1. **EN VIVO** (rediseño completo en Fase 4).
2. **HISTÓRICO** (rediseño completo en Fase 4, incluye selector de fecha del mapa de rutas que antes vivía en EN VIVO).
3. **CICLOS** (rediseño completo en Fase 4).
4. **MANTENIMIENTO** (rediseño completo en Fase 4).

### Tab EN VIVO

#### Layout (Layout 3 con preferencia recordada)
1. Cabecera de página (descrita arriba).
2. Fila de tabs (EN VIVO / HISTÓRICO / CICLOS / MANTENIMIENTO).
3. **Mapa colapsable**: barra "Ver mapa ↓" plegada por defecto. Estado abierto/cerrado se guarda por usuario (tabla `user_dashboard_prefs`, no solo localStorage para persistir entre dispositivos).
4. **Panel de diagnóstico** a todo el ancho — grid responsive (4 columnas desktop, 2 columnas móvil) con 8+ tarjetas de bloques de sistema.
5. **Sección de detalle por bloque**, debajo del panel. Cada bloque tiene su zona de detalle, accesible vía "Ver detalle ↓" en su tarjeta (scroll suave).
6. Al pie: footer estándar.

#### Panel de diagnóstico — Tarjetas
Cada tarjeta representa un sistema físico del vehículo:
- Border-left 3px de color de severidad (rojo crítica, ámbar aviso, verde OK).
- Icono del sistema (Tabler/Lucide).
- Nombre del bloque.
- Frase corta de estado:
  - 0 alertas activas → "Funcionando normal" o equivalente.
  - 1 alerta activa → nombre de la regla/alerta.
  - 2+ alertas activas → "N alertas activas".
- 2-3 valores clave del sistema (configurable por admin en cantidad y selección).
- Click en la tarjeta → scroll suave a sección de detalle correspondiente.

#### Lógica del color del semáforo
Prioridad en orden:
1. Alerta crítica activa para algún sensor del bloque → rojo.
2. Alerta de aviso activa → ámbar.
3. Umbral `critical_max/min` del `sensor_schema` cruzado → rojo.
4. Umbral `warn_max/min` cruzado → ámbar.
5. Si nada → verde por defecto.

#### Sección de detalle por bloque
Al hacer scroll desde una tarjeta:
- Cabecera con nombre del bloque + estado actual.
- **Todos los sensores del bloque** (no solo los "valores clave" del resumen).
- Cada sensor visualizado según su **tipo** (definido por admin, ver sección "Tipos de visualización" abajo).
- **Mini-gráfico de últimas 24h** del sensor más crítico del bloque.
- **Alertas activas relacionadas con el bloque**, listadas con descripción (sin acción directa — la acción "Reconocer" vive en `/alerts`).

### Tipos de visualización de sensores
Catálogo cerrado de 5 tipos. Admin elige el tipo por sensor en `/vehicle-types`:

1. **RangeBar** — Barra horizontal con rango, valor actual y línea de umbral crítico. Para sensores numéricos con min/max conocidos. Ejemplos: RPM (0-3000), Presión hidráulica (0-250 bar).
2. **BigNumber** — Número grande con unidad pequeña. Para valores numéricos sin rango específico. Ejemplos: Kilómetros totales, Horas motor, Temperatura ambiente.
3. **LevelTank** — Rectángulo vertical relleno con %, color verde/ámbar/rojo según nivel. Para valores de nivel/porcentaje. Ejemplos: Combustible, Adblue, Cisterna, Nivel de agua.
4. **BinaryIndicator** — Chip con punto + texto "Activo"/"Inactivo" en verde/gris. Para valores ON/OFF. Ejemplos: PTO, Depresor, Pedal freno, Setas, Bomba.
5. **StatusText** — Chip con texto y color contextual. Para valores categóricos. Ejemplos: Estado del motor ("ralentí"/"trabajo"/"apagado"), Modo operación.

**Eliminado del catálogo**: gauge circular con aguja (`CircularGauge`, `GaugeArc`). Causa raíz del bug visual de la captura inicial (etiquetas largas comprimidas). Los 5 tipos cubren todos los casos sin pérdida funcional.

### Sistema de bloques configurable por admin (en `/vehicle-types`)

Filosofía: el admin de CMG controla todo el catálogo desde `/vehicle-types`. Nuevos clientes con tipos de vehículo distintos (cosechadoras, cisternas, etc.) se añaden sin tocar código.

#### Extensión del modelo `vehicle_types`
Campo nuevo `system_blocks: JSON` que contiene array de bloques:
```json
{
  "id": "block_motor_xyz",
  "name": "Motor",
  "icon": "ti-engine",
  "sensor_keys": ["rpm", "engine_temp", "engine_hours"],
  "key_sensor_keys": ["rpm", "engine_temp"],
  "key_count": 2
}
```

#### UI nueva en `/vehicle-types`
- Sección "Bloques del panel" con CRUD completo.
- Drag&drop para reordenar bloques.
- Por cada bloque: nombre editable, selector de icono (grid con ~30 iconos Tabler/Lucide), multi-select de sensores del schema, multi-select para marcar valores clave.
- Botón "Aplicar plantilla" con 3-4 plantillas iniciales: VPS (cuba), MAX (barredora), basura (recolectora), genérico.
- Plantillas hardcodeadas en seed/código, pero el admin puede editarlas tras aplicar.

#### Endpoints backend nuevos
- `GET /api/v1/vehicle-types/:id/system-blocks`
- `PUT /api/v1/vehicle-types/:id/system-blocks` (full replace del array).

### Configurabilidad personal del usuario final (Nivel Medio)

El usuario final puede personalizar **su** vista de `/vehicles/:id`:
1. **Reordenar bloques** (drag&drop, sobreescribe el orden definido por admin).
2. **Ocultar bloques** que no le interesan (toggle).
3. **Pinned**: marcar 1-2 bloques como fijos arriba siempre.

#### Persistencia
Tabla nueva `user_dashboard_prefs`:
- `user_id`, `vehicle_type_id`, `block_order: JSON`, `hidden_blocks: string[]`, `pinned_blocks: string[]`, `map_collapsed: boolean`.

#### UI
- Botón "Personalizar" arriba a la derecha del panel.
- Click → panel lateral con drag&drop de bloques + toggles para ocultar + estrellitas para pinned.
- Cambios persisten al guardar.

### DOUT (control de salidas digitales)
- DOUT pasa a ser **una tarjeta más del panel** ("Control remoto" o nombre que decida el admin).
- Lógica del semáforo distinta: gris/neutro si todas OFF, azul/info si alguna activada, rojo si problema con DOUT.
- Botones de control en la sección de detalle del bloque (al hacer scroll).
- **NO se toca lógica de DOUT** — funcionalidad crítica en producción.

### Tabs HISTÓRICO / CICLOS / MANTENIMIENTO
Planificación específica de cada una **diferida a sesiones propias antes de implementar**. Hoy solo se decide:
- Las 3 tabs entran en alcance de Fase 4 (decisión del 1 junio 2026).
- Selector de fecha del mapa de rutas se mueve de EN VIVO a HISTÓRICO.
- Cromática y componentes compartidos (Input, Select, Chip, etc.) ya aplicados en Fase 1.5 valen para estas tabs.

### Componentes obsoletos tras Fase 4
- `CircularGauge.tsx` (eliminar tras migración).
- `GaugeArc.tsx` (eliminar tras migración).
- `LinearGauge.tsx` y `TankGauge.tsx` (revisar si se adaptan o se reemplazan por LevelTank).
- `NumericDisplay.tsx` (revisar si se adapta o se reemplaza por BigNumber).
- `SensorWidget.tsx` (probablemente refactor profundo o reemplazo).

### Componentes nuevos a crear
- `RangeBar.tsx`, `BigNumber.tsx`, `LevelTank.tsx`, `BinaryIndicator.tsx`, `StatusText.tsx` (los 5 tipos de visualización).
- `SystemBlockCard.tsx` (la tarjeta del panel).
- `SystemBlockDetail.tsx` (la sección de detalle por bloque).
- `DashboardCustomizer.tsx` (el panel lateral de personalización del usuario).
- `ActivityDrawer.tsx` (el panel lateral del historial de comandos/incidencias).
- `VehicleTypeSystemBlocks.tsx` (la sección de admin en `/vehicle-types`).

### Bloques de implementación (orden sugerido)
Fase 4 se ejecuta en bloques. Cada bloque cierra con commit propio.

1. **Backend modelo `system_blocks`** + endpoints + plantillas seed.
2. **UI admin en `/vehicle-types`**: editor de bloques + selector iconos + plantillas.
3. **Cabecera unificada** + drawer de actividad.
4. **Los 5 componentes nuevos de visualización** (RangeBar, BigNumber, LevelTank, BinaryIndicator, StatusText) + tests.
5. **Panel de diagnóstico** (SystemBlockCard) + lógica del semáforo.
6. **Secciones de detalle por bloque** (SystemBlockDetail) + mini-gráficos.
7. **Mapa colapsable** con preferencia recordada.
8. **Configurabilidad usuario** (DashboardCustomizer + persistencia).
9. **DOUT como tarjeta del panel** + adaptación de los botones de control.
10. **Eliminación de componentes obsoletos** (CircularGauge, etc.).
11. **Rediseño tab HISTÓRICO** (planificación específica antes de arrancar).
12. **Rediseño tab CICLOS** (planificación específica antes de arrancar).
13. **Rediseño tab MANTENIMIENTO** (planificación específica antes de arrancar).
14. **Verificación visual completa de las 4 tabs en desktop + móvil**.
15. **Commit final + push + cierre de Fase 4**.

### Hitos clave
- Hito 1 (~5 días): admin puede definir bloques en `/vehicle-types`. Modelo backend funcional.
- Hito 2 (~9 días): tab EN VIVO funcional con panel + detalles + personalización usuario. Apto para mostrar a cliente.
- Hito 3 (~14 días): las 4 tabs rediseñadas. Fase 4 cerrada.

### Riesgos identificados
- **Riesgo alto**: cambio masivo de componentes de visualización. Mitigar con tests por componente nuevo + verificación visual por cliente real.
- **Riesgo medio**: configuración admin compleja puede ser difícil de usar sin onboarding. Mitigar con plantillas y tooltips claros.
- **Riesgo bajo**: persistencia de prefs de usuario. Patrón estándar, sin sorpresas técnicas.
- **Riesgo bajo**: DOUT como tarjeta — UX nuevo. Si no funciona, fallback a sección al pie como hoy.

### Decisiones aplazadas (no urgentes)
- Vistas guardadas configurables (Nivel Total de personalización): aplazado, evaluar tras ver uso real del Nivel Medio.
- Unificación de `relativeTime` en 4 archivos del proyecto (deuda apuntada): aplazado, sesión propia futura.

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

4. **Tiempo relativo (formatRelative) — sin urgencia** — detectado al analizar subcomponentes de DashboardPage antes de eliminarla (Fase 3, 1 junio 2026).
   Existen 4 implementaciones distintas en el proyecto:
   - `VehicleRow.tsx`: acepta segundos, distingue "hace un momento" < 1 min.
   - `DevicesPage.tsx`: acepta minutos.
   - `VehiclesPage.tsx`: acepta minutos, otra granularidad.
   - `DashboardPage.tsx`: aceptaba ISO string (borrada en Fase 3).
   Para unificar: decidir interfaz única (segundos vs minutos vs ISO), granularidad y strings.
   Sesión propia cuando aparezca el 5º caso o se quiera limpiar de un tirón.

### Bug visual del tooltip de Recharts en Reportes — ✅ RESUELTO 1 junio 2026 commit c912d48

Pantallas afectadas: /reports, /dashboard, /vehicles/:id (KpiChart).
Causa real: `contentStyle.color` aplica al contenedor externo del tooltip, pero los valores de
cada serie se renderizan en `.recharts-tooltip-item` con CSS propio de Recharts que sobrescribe
la herencia. Solución: añadir `itemStyle: { color: 'var(--fg-primary)' }` en cada `<Tooltip>`.
Afectaba 10 tooltips en 3 archivos (ReportsPage 6, KpiChart 3, DashboardPage 1).
Contraste resultante: `--fg-primary` (#F1F5F9) sobre `--bg-elevated` (#22263A) = 9.5:1.
Verificado visualmente en /reports.

## Bug preexistente identificado — ✅ RESUELTO 1 junio 2026 commit 90f9aa8

Pie chart "Distribución del tiempo" en ReportsPage.tsx asignaba colores por índice del array
filtrado. Cuando un segmento tenía valor 0 y era eliminado por `.filter(d => d.value > 0)`,
los índices se deslizaban y los segmentos visibles recibían colores incorrectos.

Solución aplicada: `pieColors2` (array indexado) sustituido por `PIE_COLOR: Record<string, string>`
mapeado por nombre semántico. `<Cell>` cambiado de `(_, i)` a `(entry)`. Color de 'Parado'
mejorado de `#1E2532` (bg-card, casi invisible) a `var(--offline)` (#64748B). Verificado visualmente.
