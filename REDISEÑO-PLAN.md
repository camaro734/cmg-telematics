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
