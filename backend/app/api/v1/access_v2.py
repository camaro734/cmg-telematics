"""Sistema de permisos v2 — jerarquía CMG → Fabricante → Cliente → Conductor.

Helper central para control de acceso a vehículos. Todos los endpoints de
vehicles.py, maintenance.py y alerts.py usan este módulo (Fase 4 completa).
Ref: docs/SPEC-jerarquia-v2.md §3
"""

import logging
from typing import Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.access_audit_log import AccessAuditLog
from app.models.driver import Driver, VehicleDriverAssignment
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.schemas.auth import CurrentUser

logger = logging.getLogger(__name__)

Operation = Literal["read", "write", "delete"]
Scope = Literal["all", "technical", "operational"]


def tenant_can_actuate_controls(user_tier: str, tenant: Tenant | None) -> bool:
    """¿Puede este usuario accionar controles (DOUT/Manual CAN)?

    - cmg y manufacturer: siempre.
    - cliente directo de CMG (parent_manufacturer_id is None): siempre.
    - cliente/subcliente bajo un fabricante: solo si su flag can_actuate_controls
      está activo (lo concede CMG cliente a cliente). Por defecto solo lectura.
    """
    if user_tier in ("cmg", "manufacturer"):
        return True
    if tenant is None or tenant.parent_manufacturer_id is None:
        return True
    return bool(getattr(tenant, "can_actuate_controls", False))


async def assert_can_actuate_controls(user: CurrentUser, db: AsyncSession) -> None:
    """Bloquea (403) el accionamiento de controles a los clientes de un fabricante
    que no tienen el permiso concedido. La telemetría sigue siendo de solo lectura."""
    tenant = await db.get(Tenant, user.tenant_id)
    if not tenant_can_actuate_controls(user.tenant_tier, tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu organización tiene acceso de solo lectura; los controles los gestiona el fabricante",
        )


async def _log_access(
    user: CurrentUser,
    vehicle: Vehicle,
    operation: Operation,
    scope: Scope,
    db: AsyncSession,
    justification: str | None = None,
) -> None:
    """Registra acceso cross-tenant en access_audit_log para cumplimiento RGPD.

    Usa savepoint para que un fallo de escritura nunca bloquee el acceso.
    ip_address, user_agent y endpoint se rellenan desde el endpoint cuando
    se integre con FastAPI Request (Fase 4+).
    """
    entry = AccessAuditLog(
        user_id=user.user_id,
        user_tenant_id=user.tenant_id,
        user_tenant_tier=user.tenant_tier,
        target_vehicle_id=vehicle.id,
        target_tenant_id=vehicle.tenant_id,
        operation=operation,
        scope=scope,
        justification=justification,
    )
    try:
        async with AsyncSessionLocal() as audit_session:
            async with audit_session.begin():
                audit_session.add(entry)
    except Exception as exc:
        logger.warning(
            "access_audit_log_failed: %s | user=%s vehicle=%s",
            exc,
            user.user_id,
            vehicle.id,
        )


async def assert_can_access_vehicle(
    user: CurrentUser,
    vehicle_id: UUID,
    db: AsyncSession,
    operation: Operation = "read",
    scope: Scope = "all",
) -> Vehicle:
    """Verifica permiso de acceso al vehículo según jerarquía v2.

    Evalúa en orden de prioridad:

    1. CMG (tenant_tier='cmg'): acceso total, sin consultas adicionales.

    2. Mismo tenant + rol != driver: acceso total a sus vehículos.

    3. Mismo tenant + rol == driver: solo si existe asignación activa
       al vehículo (ended_at IS NULL). Solo lectura salvo scope='operational'
       (permite al conductor registrar datos del parte de servicio).

    4. Fabricante (tenant_tier='manufacturer'): acceso técnico a vehículos
       donde vehicle.manufacturer_tenant_id == user.tenant_id. Acceso a
       datos CAN/telemetría (scope='technical') solo si el tenant cliente tiene
       manufacturer_can_view_can_data=True (default True — el fabricante ve
       su propia maquinaria por defecto; el cliente puede restringirlo).
       Acceso operativo (scope='operational') solo si manufacturer_can_view_operations=True.
       Nunca puede modificar ni eliminar.

    5. Cualquier otro caso: 404. Nunca 403 en casos de falta de acceso —
       se evita enumeración de recursos (privacy by obscurity).
       La excepción es cuando el recurso es visible pero la operación está
       prohibida (driver write, manufacturer write/delete): ahí sí es 403.

    Returns:
        Vehicle si el acceso está permitido.

    Raises:
        HTTPException 404 si el vehículo no existe o el usuario no tiene acceso.
        HTTPException 403 si el recurso es visible pero la operación no está permitida.
    """
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    # Nivel 1: CMG — acceso total sin consultas adicionales a DB
    if user.tenant_tier == "cmg":
        if vehicle.tenant_id != user.tenant_id:
            await _log_access(user, vehicle, operation, scope, db)
        return vehicle

    # Niveles 2 y 3: mismo tenant que el vehículo
    if vehicle.tenant_id == user.tenant_id:
        if user.role != "driver":
            # Nivel 2: admin / operator / viewer del mismo tenant
            return vehicle

        # Nivel 3: driver — requiere asignación activa (ended_at IS NULL)
        # El link es: CurrentUser.user_id → Driver.user_id → VehicleDriverAssignment.driver_id
        assignment = await db.scalar(
            select(VehicleDriverAssignment)
            .join(Driver, Driver.id == VehicleDriverAssignment.driver_id)
            .where(
                VehicleDriverAssignment.vehicle_id == vehicle_id,
                Driver.user_id == user.user_id,
                VehicleDriverAssignment.ended_at.is_(None),
            )
        )
        if not assignment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        if operation in ("write", "delete") and scope != "operational":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Driver cannot modify vehicle",
            )
        return vehicle

    # Nivel 4: fabricante — acceso a vehículos que él fabricó
    if user.tenant_tier == "manufacturer":
        if vehicle.manufacturer_tenant_id != user.tenant_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

        # Scope técnico requiere flag habilitado en el tenant cliente del vehículo
        if scope == "technical":
            client_tenant = await db.get(Tenant, vehicle.tenant_id)
            if not client_tenant or not client_tenant.manufacturer_can_view_can_data:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

        # Scope operativo requiere flag habilitado en el tenant cliente del vehículo
        if scope == "operational":
            client_tenant = await db.get(Tenant, vehicle.tenant_id)
            if not client_tenant or not client_tenant.manufacturer_can_view_operations:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

        # Fabricante nunca puede modificar ni eliminar
        if operation in ("write", "delete"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Manufacturer cannot modify vehicle",
            )
        await _log_access(user, vehicle, operation, scope, db)
        return vehicle

    # Nivel 5: cualquier otro caso (subclient, cross-tenant no fabricante)
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vehicle not found")


async def list_accessible_vehicle_ids(
    user: CurrentUser,
    db: AsyncSession,
) -> list[UUID] | Literal["ALL"]:
    """Devuelve los IDs de vehículos accesibles para el usuario.

    Para CMG devuelve la marca especial "ALL" — no materializa la lista completa.
    El caller debe omitir el filtro de tenant cuando recibe "ALL".

    Para drivers devuelve solo los vehículos con asignación activa hoy.
    Para fabricantes devuelve los vehículos que él fabricó.
    Para clientes (admin/operator/viewer) devuelve todos los de su tenant.
    """
    if user.tenant_tier == "cmg":
        return "ALL"

    if user.tenant_tier == "manufacturer":
        result = await db.scalars(
            select(Vehicle.id).where(Vehicle.manufacturer_tenant_id == user.tenant_id)
        )
        return list(result)

    if user.role == "driver":
        result = await db.scalars(
            select(VehicleDriverAssignment.vehicle_id)
            .join(Driver, Driver.id == VehicleDriverAssignment.driver_id)
            .where(
                Driver.user_id == user.user_id,
                VehicleDriverAssignment.ended_at.is_(None),
            )
        )
        return list(result)

    # Cliente (admin / operator / viewer): todos los vehículos del tenant
    result = await db.scalars(
        select(Vehicle.id).where(Vehicle.tenant_id == user.tenant_id)
    )
    return list(result)
