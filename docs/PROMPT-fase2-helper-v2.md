# Prompt: Fase 2 — Helper de permisos v2 + tests

Has leído ya el CLAUDE.md de este repo (incluida la nueva sección 15
sobre el entorno de producción) y el documento
`docs/design/SPEC-jerarquia-v2.md`. La Fase 1 está completada y mergeada
en master (migraciones 023-028 aplicadas).

## Contexto importante

Este servidor es producción (sección 15 del CLAUDE.md). Pero **en este
momento no hay clientes con flotas reales operando**:
- Solo 2 dispositivos de prueba están enviando datos
- IMEI 862272089079729: dispositivo de VPS (Vacuum Pressure Systems),
  en pruebas, no ha salido a carretera
- IMEI 864275075510100: dispositivo en el taller de CMG, en pruebas

Esto reduce el riesgo de Fase 2, pero NO elimina la disciplina:
seguimos preguntando antes de tocar nada que afecte a contenedores,
schema, o configuración.

## Objetivo de esta fase

Crear el helper de permisos v2 (`access_v2.py`) con tests exhaustivos.
**NO migrar ningún endpoint todavía.** Solo añadir código nuevo que
nadie llama aún.

## Restricciones críticas

- **NO modificar** el helper actual `_check_vehicle_access` (vive en
  `backend/app/api/v1/deps.py` u otro lugar — localizar antes de tocar)
- **NO modificar** ningún endpoint
- **NO ejecutar** las migraciones (ya están aplicadas)
- **NO modificar** modelos SQLAlchemy existentes salvo añadir campos a
  los modelos que reflejen las columnas de las migraciones 024-028
- **SÍ** crear archivo nuevo `backend/app/api/v1/access_v2.py`
- **SÍ** crear archivo nuevo `backend/tests/test_access_v2.py` (o donde
  vivan los tests en este repo)
- **SÍ** actualizar modelos SQLAlchemy de Tenant, Vehicle, User para
  reflejar las columnas nuevas (con `Mapped[Optional[...]]` o equivalente)

## Modelo a usar

- Sonnet 4.6
- Thinking ON para el diseño del helper (es lógica delicada)

## Plan de trabajo

### Paso 1 — Reconocimiento (10 min)

```bash
cd /opt/cmg-telematic1

# Verificar estado limpio
git status
git log --oneline -3
# Debe mostrar el commit de Fase 1 mergeado

# Localizar el helper actual
grep -rn "_check_vehicle_access\|check_vehicle_access" backend/ --include="*.py"

# Localizar dónde viven los tests
ls backend/tests/ 2>/dev/null || find backend -name "test_*.py" -type f | head

# Ver modelos actuales relevantes
ls backend/app/models/ | grep -iE "tenant|vehicle|user|driver"
```

Reportar a Carlos qué has encontrado. **No avances sin que él te
confirme que has localizado todo bien.**

### Paso 2 — Actualizar modelos SQLAlchemy (30 min)

Reflejar las columnas que añadieron las migraciones 024-028 en los
modelos Python correspondientes.

#### Tenant
Añadir a `backend/app/models/tenant.py`:
```python
parent_manufacturer_id: Mapped[Optional[UUID]] = mapped_column(
    ForeignKey("tenant.id", ondelete="RESTRICT"), nullable=True
)
parent_manufacturer: Mapped[Optional["Tenant"]] = relationship(
    "Tenant", remote_side="Tenant.id", foreign_keys=[parent_manufacturer_id]
)
manufacturer_can_view_operations: Mapped[bool] = mapped_column(
    Boolean, server_default="false", nullable=False
)
manufacturer_can_view_can_data: Mapped[bool] = mapped_column(
    Boolean, server_default="true", nullable=False
)
manufacturer_can_create_rules: Mapped[bool] = mapped_column(
    Boolean, server_default="true", nullable=False
)
compliance_level: Mapped[str] = mapped_column(
    String(20), server_default="standard", nullable=False
)
```

Actualizar también la lista de valores válidos del campo `tier` si
existe validación a nivel Python (Pydantic o constraint en SQLAlchemy)
para incluir `'manufacturer'`.

#### Vehicle
Añadir a `backend/app/models/vehicle.py`:
```python
manufacturer_tenant_id: Mapped[Optional[UUID]] = mapped_column(
    ForeignKey("tenant.id", ondelete="RESTRICT"), nullable=True
)
manufacturer: Mapped[Optional["Tenant"]] = relationship(
    "Tenant", foreign_keys=[manufacturer_tenant_id]
)
```

#### User
Añadir a `backend/app/models/user.py`:
```python
driver_dni: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
driver_license: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
driver_license_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
mobile_device_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
last_mobile_login: Mapped[Optional[datetime]] = mapped_column(
    TIMESTAMP(timezone=True), nullable=True
)
```

**Después de cada cambio:**
- Reiniciar core-api: `docker compose restart core-api`
- Verificar logs: `docker compose logs core-api --tail 50`
- Confirmar que no hay errores de mapping SQLAlchemy

### Paso 3 — Crear el helper v2 (45 min)

Crear `backend/app/api/v1/access_v2.py` con el código exacto de la
sección 3 de `docs/design/SPEC-jerarquia-v2.md`.

Adaptaciones que pueden ser necesarias según lo que encuentres:
- Si los imports difieren (rutas distintas a las de la spec)
- Si los modelos tienen otros nombres (verificar VehicleDriverAssignment)
- Si el repo usa otro patrón para la sesión async DB

**Importante:** Añadir docstring exhaustivo explicando las reglas
de permisos. El próximo Claude Code que lea esto debe entenderlo
sin tener que ir a la spec.

### Paso 4 — Tests exhaustivos (1h)

Crear `backend/tests/test_access_v2.py` con los siguientes casos:

#### Setup
- Fixture `db_session` (probablemente ya existe en conftest.py)
- Fixture `make_tenant(tier='cmg'|'manufacturer'|'client')` — helper
  para crear tenants de prueba
- Fixture `make_user(tenant, role='admin'|'driver')`
- Fixture `make_vehicle(tenant, manufacturer=None)`
- Fixture `make_driver_assignment(user, vehicle, date_=today)`

#### Casos a cubrir — assert_can_access_vehicle

1. **CMG ve todo:**
   - `test_cmg_can_read_any_vehicle`
   - `test_cmg_can_write_any_vehicle`
   - `test_cmg_can_delete_any_vehicle`

2. **Client operador (mismo tenant):**
   - `test_client_admin_can_read_own_vehicle`
   - `test_client_admin_can_write_own_vehicle`
   - `test_client_admin_cannot_read_other_tenant_vehicle` (debe ser 404)
   - `test_client_admin_cannot_read_manufacturer_vehicle_of_other_client`

3. **Driver (role=driver):**
   - `test_driver_can_read_assigned_vehicle_today`
   - `test_driver_cannot_read_vehicle_not_assigned`
   - `test_driver_cannot_read_yesterday_assignment` (la asignación es
     por fecha, no se arrastra)
   - `test_driver_cannot_write_vehicle`
   - `test_driver_can_write_with_operational_scope` (para parte de servicio)

4. **Manufacturer:**
   - `test_manufacturer_can_read_own_manufactured_vehicle`
   - `test_manufacturer_cannot_read_vehicle_of_other_manufacturer`
   - `test_manufacturer_cannot_read_operational_scope_by_default`
   - `test_manufacturer_can_read_operational_when_flag_enabled`
   - `test_manufacturer_cannot_write_vehicle` (403)
   - `test_manufacturer_cannot_delete_vehicle` (403)

5. **Edge cases:**
   - `test_vehicle_not_found_returns_404`
   - `test_user_with_invalid_tenant_returns_404`
   - `test_returns_404_not_403_for_unauthorized` (privacy by obscurity)

#### Casos a cubrir — list_accessible_vehicle_ids

1. `test_cmg_returns_all_marker`
2. `test_manufacturer_returns_only_manufactured_vehicles`
3. `test_client_admin_returns_own_tenant_vehicles`
4. `test_driver_returns_only_assigned_today`
5. `test_user_without_access_returns_empty_list`

**Ejecutar los tests:**
```bash
docker compose exec core-api pytest backend/tests/test_access_v2.py -xvs
```

**Objetivo:** 100% de los tests verdes. Si alguno falla, parar y
analizar — no aplicar parches automáticos sin entender la causa.

### Paso 5 — Verificación de no regresión (15 min)

Confirmar que la API sigue funcionando exactamente igual:

```bash
# Reiniciar core-api con todo el código nuevo
docker compose restart core-api

# Esperar 10s
sleep 10

# Logs sin errores
docker compose logs core-api --tail 100 | grep -iE "error|exception|traceback"

# Healthcheck (devolverá 404, pero el API responde)
curl -sf -o /dev/null -w "HTTP %{http_code}\n" https://cmgtrack.com/api/v1/health

# Dispositivos de prueba siguen mandando datos
docker compose exec timescaledb psql -U postgres -d cmg -c "
SELECT d.imei, d.last_seen,
       EXTRACT(EPOCH FROM (now() - d.last_seen))/60 AS min_ago
FROM device d
WHERE d.imei IN ('862272089079729', '864275075510100');
"

# Tests existentes siguen pasando (los que pasaban antes)
docker compose exec core-api pytest backend/tests/ -x --tb=short --ignore=backend/tests/test_access_v2.py 2>&1 | tail -10
```

### Paso 6 — Commit y review (10 min)

```bash
git add backend/app/models/tenant.py backend/app/models/vehicle.py backend/app/models/user.py
git add backend/app/api/v1/access_v2.py
git add backend/tests/test_access_v2.py
git status
```

Mostrar a Carlos el `git status` antes de hacer commit.

Commit message sugerido:
```
feat(access): add v2 permissions helper for 5-tier hierarchy

New helper access_v2.py supports the hierarchy v2 (CMG → Manufacturer
→ Client → Driver). Coexists with v1 (_check_vehicle_access) during
migration period.

- access_v2.assert_can_access_vehicle: 5-tier permission check
- access_v2.list_accessible_vehicle_ids: efficient listing helper
- Updated SQLAlchemy models to reflect migrations 024-028
- Comprehensive test suite (test_access_v2.py)

NO endpoints migrated yet. v1 helper still in use. This is additive
code that nothing calls, except tests.

Phase 2 of 6 (SPEC-jerarquia-v2.md)
```

NO hacer push automático. Esperar OK de Carlos tras revisar.

## Output esperado al final

1. Resumen de archivos creados/modificados
2. Output de los tests (todos verdes)
3. Output del paso 5 (verificación no regresión)
4. Commit local mostrado, esperando OK para push

## Si algo falla

- Tests rojos → PARAR, analizar causa, preguntar a Carlos
- Errores de mapping SQLAlchemy → PARAR, revisar el modelo
- Errores en logs de core-api → PARAR
- Dispositivos de prueba dejan de mandar datos → PARAR, posible
  problema serio

En cualquier caso de duda: PARAR y preguntar. Carlos paga por turno
de modelo, los turnos extra de aclaración son baratos. Los errores
en producción son caros.

## Recordatorio de la sección 15 del CLAUDE.md

Aunque solo haya 2 dispositivos de prueba, este es el entorno de
producción. NO existe staging. Cualquier comando que toque docker,
schema, .env o servicios requiere confirmación explícita de Carlos.

Para esta fase específicamente, los comandos seguros (no requieren
confirmación) son:
- pytest sobre archivos nuevos
- Lectura de archivos (cat, less, head, view)
- git status, git diff, git log
- docker compose logs (solo lectura)
- psql con SELECT (solo lectura)

Los que SÍ requieren confirmación:
- docker compose restart core-api (afecta a producción)
- git commit (sí, también — Carlos quiere revisar antes)
- git push
- Cualquier ALTER, INSERT, UPDATE, DELETE en BD
