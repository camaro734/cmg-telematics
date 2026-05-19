# Prompt: Fase 1 — Migraciones de jerarquía v2

Has leído ya el CLAUDE.md de este repo y el documento
`docs/design/SPEC-jerarquia-v2.md`. Vamos a ejecutar **SOLO la Fase 1**.

## Objetivo

Crear las migraciones Alembic 023-028 que añaden la infraestructura
para la jerarquía v2 (Fabricante + Conductor con DNI + Compliance) **sin
romper nada de lo existente**.

## Restricciones críticas

- **NO modificar** ningún endpoint
- **NO modificar** el helper `_check_vehicle_access` actual
- **NO modificar** ningún modelo SQLAlchemy todavía
- **SOLO** crear las 6 migraciones nuevas
- Todas las columnas nuevas son **nullable** o tienen `server_default`
- API debe comportarse idéntico antes y después
- Wasterent y PREZERO deben seguir viendo exactamente lo mismo

## Modelo a usar

- Sonnet 4.6 (`/model claude-sonnet-4-6` si no estás en él)
- Thinking OFF por defecto

## Tareas en orden

### Paso 1 — Verificar estado actual (5 min)
```bash
cd /opt/cmg-telematic1
alembic current
ls -1 alembic/versions/ | tail -10
git status
git log --oneline -5
```

Confirmar que estás en la migración 022 y que no hay cambios pendientes.

### Paso 2 — Leer la especificación
Lee `docs/design/SPEC-jerarquia-v2.md` sección 2 (Schema SQL). NO el
resto todavía. Eso es para fases posteriores.

### Paso 3 — Crear las 6 migraciones
Crear estos archivos siguiendo EXACTAMENTE el código de la sección 2 de
la spec:

1. `alembic/versions/023_add_manufacturer_tier.py`
2. `alembic/versions/024_tenant_parent_manufacturer.py`
3. `alembic/versions/025_vehicle_manufacturer.py`
4. `alembic/versions/026_vehicle_manufacturer_trigger.py`
5. `alembic/versions/027_tenant_visibility_compliance.py`
6. `alembic/versions/028_user_driver_fields.py`

**Importante:** la migración 023 (enum) necesita `COMMIT` explícito antes
del `ALTER TYPE` porque Postgres no permite añadir valores a un enum
dentro de una transacción. Sigue el código de la spec.

### Paso 4 — Verificar localmente (NO en producción)
```bash
# Subir las migraciones en local
docker compose exec core-api alembic upgrade head

# Verificar
docker compose exec core-api alembic current
# Debe mostrar: 028

# Verificar schema en BD
docker compose exec timescaledb psql -U postgres -d cmg -c "
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'tenant'
    AND column_name IN ('parent_manufacturer_id', 'manufacturer_can_view_operations', 'compliance_level')
  ORDER BY column_name;
"

# Verificar enum
docker compose exec timescaledb psql -U postgres -d cmg -c "
  SELECT enumlabel FROM pg_enum
  WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'tenant_tier_enum')
  ORDER BY enumsortorder;
"
# Debe incluir 'manufacturer'

# Verificar trigger
docker compose exec timescaledb psql -U postgres -d cmg -c "
  SELECT trigger_name FROM information_schema.triggers
  WHERE event_object_table = 'vehicle';
"
# Debe incluir trg_vehicle_manufacturer_sync
```

### Paso 5 — Verificar que la API arranca y los tests pasan
```bash
# Reiniciar core-api
docker compose restart core-api

# Esperar 10s
sleep 10

# Verificar /health
curl -sf http://localhost:8010/api/v1/health || echo "FALLO"

# Si hay tests, ejecutarlos
docker compose exec core-api pytest -x --tb=short 2>&1 | tail -30

# Verificar logs sin errores
docker compose logs core-api --tail 50 | grep -i error
```

### Paso 6 — Smoke test funcional (CRÍTICO)
Probar manualmente con el frontend o curl:

```bash
# 1. Login como admin CMG y listar vehículos — debe devolver mismos vehículos que antes
# 2. Login como admin Wasterent — debe ver solo sus vehículos como antes
# 3. Login como admin PREZERO — idem

# Verificar contadores
docker compose exec timescaledb psql -U postgres -d cmg -c "
  SELECT
    (SELECT COUNT(*) FROM tenant) AS tenants,
    (SELECT COUNT(*) FROM vehicle) AS vehicles,
    (SELECT COUNT(*) FROM tenant WHERE parent_manufacturer_id IS NOT NULL) AS clients_with_manuf,
    (SELECT COUNT(*) FROM vehicle WHERE manufacturer_tenant_id IS NOT NULL) AS vehicles_with_manuf;
"
# clients_with_manuf y vehicles_with_manuf deben ser 0 — no hemos vinculado nada todavía
```

### Paso 7 — Commit
```bash
git add alembic/versions/02[3-8]_*.py
git commit -m "feat(schema): add hierarchy v2 infrastructure (manufacturer + compliance + driver)

Migrations 023-028 prepare schema for v2 hierarchy:
- 023: add 'manufacturer' to tenant_tier_enum
- 024: add tenant.parent_manufacturer_id (nullable)
- 025: add vehicle.manufacturer_tenant_id (nullable)
- 026: trigger to sync vehicle <-> tenant manufacturer
- 027: add manufacturer visibility flags + compliance_level
- 028: add driver fields to user (dni, license, mobile_device_id)

All columns nullable. Zero breaking changes. API behaves identical.

Spec: docs/design/SPEC-jerarquia-v2.md
Phase: 1 of 6"
```

### Paso 8 — NO hacer push automático
Esperar a que Carlos revise los archivos antes de:
- Hacer push al repositorio
- Aplicar las migraciones en producción

## Output esperado

Al terminar, mostrar a Carlos:

1. **Resumen de archivos creados** (6 migraciones)
2. **Output del paso 4** (verificación schema)
3. **Output del paso 5** (tests + healthcheck)
4. **Output del paso 6** (contadores: deben ser 0 los nuevos)
5. **Comando exacto para aplicar en producción** (sin ejecutarlo)
6. **Comando exacto de rollback** (por si falla algo)

## Comandos de producción (para Carlos, NO ejecutar)

```bash
# En el VPS, tras revisar el código:
ssh root@213.210.20.183
cd /opt/cmg-telematic1

# Backup TimescaleDB antes de migrar
docker exec timescaledb pg_dump -U postgres -d cmg -F custom \
  -f /var/lib/postgresql/data/backup_pre_v2_$(date +%Y%m%d_%H%M%S).dump

# Aplicar migraciones
docker compose exec core-api alembic upgrade head

# Verificar
docker compose exec core-api alembic current

# Si algo falla, rollback:
docker compose exec core-api alembic downgrade 022
```

## Reglas críticas de Claude Code

- Si una migración da error, **PARA y pregunta a Carlos**. No intentes
  arreglarla automáticamente.
- Si algún test falla tras las migraciones, **PARA y pregunta**. La regla
  es zero regresión.
- Si Wasterent o PREZERO devuelven datos distintos a los esperados,
  **PARA y pregunta**.
- NO modifiques ningún archivo fuera de `alembic/versions/`.
- NO ejecutes `git push` sin confirmación explícita.

## Validación que Carlos hará personalmente

Antes de aprobar push y deploy:
1. Mirar los 6 archivos uno por uno
2. Verificar que el output del paso 6 muestra 0 en los contadores nuevos
3. Confirmar que el healthcheck del paso 5 pasa
4. Verificar manualmente que Wasterent puede entrar y ver sus vehículos

Cuando Carlos diga "OK, deploy", entonces se aplica en producción.
