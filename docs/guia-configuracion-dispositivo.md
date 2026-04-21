# Guía: Configurar un dispositivo GPS y asignarlo a un vehículo

**Audiencia:** administrador CMG  
**Objetivo:** registrar el IMEI de un Teltonika FMC650 en la plataforma y vincularlo a un vehículo para empezar a recibir telemetría.

---

## Requisitos previos

Antes de empezar necesitas tener creados:
- Un **tenant** (cliente) activo — ej. "Wasterent"
- Un **vehículo** activo en ese tenant — ej. "WAS-001"
- El **número IMEI** del dispositivo FMC650 (15 dígitos, impreso en el lateral del dispositivo o visible en la configuración del Teltonika Configurator)

---

## Paso 1 — Registrar el dispositivo (IMEI)

Solo puede hacerlo un usuario con rol **CMG admin**.

1. Inicia sesión con tu cuenta CMG admin en `https://cmgtrack.com`
2. En la barra lateral izquierda, haz clic en el icono **Dispositivos** (tarjeta SIM)
3. Verás la tabla de dispositivos registrados. Haz clic en **+ Nuevo dispositivo** (esquina superior derecha)
4. Rellena el formulario:
   - **IMEI** — los 15 dígitos del FMC650 (solo números, sin espacios)
   - **Modelo** — dejar `FMC650` salvo que sea otro modelo
   - **Cliente** — selecciona el tenant al que pertenece el dispositivo (ej. "Wasterent")
5. Haz clic en **Crear dispositivo**

El dispositivo aparece en la tabla con estado **Offline** y sin vehículo asignado. Esto es correcto — todavía no hemos vinculado ningún vehículo.

> **Error "IMEI ya registrado":** el IMEI ya existe en la base de datos. Busca el dispositivo en la tabla (puedes filtrar por cliente) y comprueba si ya tiene vehículo asignado.

---

## Paso 2 — Asignar el dispositivo a un vehículo

Puede hacerlo un **CMG admin** o un **client admin** del tenant correspondiente.

1. Ve a **Flota** en la barra lateral
2. Localiza el vehículo al que quieres asignar el dispositivo (ej. "WAS-001")
3. En la fila del vehículo verás un botón pequeño **GPS** a la derecha — haz clic en él
4. Se despliega la sección **Dispositivo GPS** debajo del vehículo:
   - Si no hay dispositivo asignado, verás "Sin dispositivo asignado" y el botón **+ Asignar dispositivo**
   - Si ya hay uno, verás el IMEI y los botones **Cambiar** / **Desasignar**
5. Haz clic en **+ Asignar dispositivo**
6. Aparece un selector con los dispositivos disponibles del tenant (aquellos sin vehículo asignado). Selecciona el IMEI correcto
7. Haz clic en **Confirmar**

La sección muestra ahora el IMEI con estado **Offline** y "Última señal: —".

---

## Paso 3 — Verificar que llegan datos

Una vez asignado, configura el FMC650 para que apunte a:

| Parámetro | Valor |
|-----------|-------|
| Protocolo | Codec 8 TCP |
| Servidor | `cmgtrack.com` |
| Puerto | `5027` |

Cuando el dispositivo envíe el primer paquete:

- En **Dispositivos**, la fila del FMC650 cambiará a estado **Online** (punto verde) y mostrará la hora de la última señal
- En **Flota**, el vehículo mostrará su posición en el mapa
- En la **ficha del vehículo** (clic en el nombre), la pestaña **EN VIVO** mostrará los gauges hidráulicos y datos CAN en tiempo real

Si tras 2-3 minutos el dispositivo sigue Offline:
1. Comprueba que el FMC650 tiene cobertura 4G (LED de estado)
2. Confirma que el IMEI introducido en la plataforma coincide exactamente con el del dispositivo
3. Revisa los logs del servicio de ingestión: `docker compose logs ingest-svc -f`

---

## Referencia rápida — ¿quién puede hacer qué?

| Acción | CMG admin | Client admin | Operator |
|--------|-----------|--------------|----------|
| Registrar nuevo dispositivo (IMEI) | ✅ | ✗ | ✗ |
| Cambiar modelo / firmware del dispositivo | ✅ | ✗ | ✗ |
| Asignar dispositivo a vehículo | ✅ | ✅ (solo su tenant) | ✗ |
| Desasignar dispositivo | ✅ | ✅ (solo su tenant) | ✗ |
| Ver lista de dispositivos | ✅ | ✅ (solo su tenant) | ✅ (solo su tenant) |
