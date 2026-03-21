"""
Seed script for pilot environment.
Creates:
  - Tenant: CMG Metalhidráulica S.L. (type=cmg)
  - Tenant: MAX Equipment SL (type=manufacturer)
  - Tenant: Cliente Piloto SL (type=end_client)
  - User: admin@cmg.es / admin123 (superadmin)
  - Vehicle: Camión Vacío Test 001
  - Device: IMEI=352000000000001
  - VariableMap: AIN1 → Presión aceite hidráulico (bar)
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal, init_db
from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.variable_map import VariableMap
from app.api.v1.auth import hash_password


async def seed():
    await init_db()

    async with AsyncSessionLocal() as session:
        # --- Tenants ---
        result = await session.execute(
            select(Tenant).where(Tenant.name == "CMG Metalhidráulica S.L.")
        )
        cmg_tenant = result.scalar_one_or_none()
        if not cmg_tenant:
            cmg_tenant = Tenant(name="CMG Metalhidráulica S.L.", type="cmg")
            session.add(cmg_tenant)
            await session.flush()
            print(f"[seed] Created tenant: {cmg_tenant.name} (id={cmg_tenant.id})")
        else:
            print(f"[seed] Tenant already exists: {cmg_tenant.name}")

        result = await session.execute(
            select(Tenant).where(Tenant.name == "MAX Equipment SL")
        )
        mfr_tenant = result.scalar_one_or_none()
        if not mfr_tenant:
            mfr_tenant = Tenant(
                name="MAX Equipment SL",
                type="manufacturer",
                parent_id=cmg_tenant.id,
            )
            session.add(mfr_tenant)
            await session.flush()
            print(f"[seed] Created tenant: {mfr_tenant.name}")
        else:
            print(f"[seed] Tenant already exists: {mfr_tenant.name}")

        result = await session.execute(
            select(Tenant).where(Tenant.name == "Cliente Piloto SL")
        )
        client_tenant = result.scalar_one_or_none()
        if not client_tenant:
            client_tenant = Tenant(
                name="Cliente Piloto SL",
                type="end_client",
                parent_id=mfr_tenant.id,
            )
            session.add(client_tenant)
            await session.flush()
            print(f"[seed] Created tenant: {client_tenant.name}")
        else:
            print(f"[seed] Tenant already exists: {client_tenant.name}")

        # --- Admin user ---
        result = await session.execute(
            select(User).where(User.email == "admin@cmg.es")
        )
        admin = result.scalar_one_or_none()
        if not admin:
            admin = User(
                tenant_id=cmg_tenant.id,
                email="admin@cmg.es",
                hashed_password=hash_password("admin123"),
                full_name="Administrador CMG",
                role="superadmin",
            )
            session.add(admin)
            await session.flush()
            print(f"[seed] Created user: {admin.email} (role={admin.role})")
        else:
            print(f"[seed] User already exists: {admin.email}")

        # --- Vehicle ---
        result = await session.execute(
            select(Vehicle).where(Vehicle.name == "Camión Vacío Test 001")
        )
        vehicle = result.scalar_one_or_none()
        if not vehicle:
            vehicle = Vehicle(
                tenant_id=client_tenant.id,
                manufacturer_id=mfr_tenant.id,
                name="Camión Vacío Test 001",
                license_plate="TEST-001",
                description="Vehículo de prueba para piloto CMG Telematics",
            )
            session.add(vehicle)
            await session.flush()
            print(f"[seed] Created vehicle: {vehicle.name} (id={vehicle.id})")
        else:
            print(f"[seed] Vehicle already exists: {vehicle.name}")

        # --- Device (FMC650) ---
        PILOT_IMEI = "352000000000001"
        result = await session.execute(
            select(Device).where(Device.imei == PILOT_IMEI)
        )
        device = result.scalar_one_or_none()
        if not device:
            device = Device(
                vehicle_id=vehicle.id,
                imei=PILOT_IMEI,
                model="FMC650",
                online=False,
            )
            session.add(device)
            await session.flush()
            print(f"[seed] Created device: IMEI={device.imei} (id={device.id})")
        else:
            print(f"[seed] Device already exists: IMEI={device.imei}")

        # --- VariableMap: AIN1 → Presión hidráulica ---
        result = await session.execute(
            select(VariableMap).where(
                VariableMap.vehicle_id == vehicle.id,
                VariableMap.io_key == "9",
            )
        )
        vmap = result.scalar_one_or_none()
        if not vmap:
            vmap = VariableMap(
                vehicle_id=vehicle.id,
                io_key="9",
                display_name="Presión aceite hidráulico",
                unit="bar",
                scale_factor=0.006,  # mV → bar (calibrado transductor 0-30V → 0-180bar)
                offset=0.0,
                alert_high=200.0,
                alert_low=0.0,
                data_type="gauge",
            )
            session.add(vmap)
            print("[seed] Created VariableMap: AIN1 → Presión hidráulica")

        result = await session.execute(
            select(VariableMap).where(
                VariableMap.vehicle_id == vehicle.id,
                VariableMap.io_key == "10",
            )
        )
        vmap2 = result.scalar_one_or_none()
        if not vmap2:
            vmap2 = VariableMap(
                vehicle_id=vehicle.id,
                io_key="10",
                display_name="Caudal bomba hidráulica",
                unit="l/min",
                scale_factor=0.01,
                offset=0.0,
                data_type="gauge",
            )
            session.add(vmap2)
            print("[seed] Created VariableMap: AIN2 → Caudal")

        await session.commit()
        print("\n[seed] ✓ Pilot data seeded successfully")
        print(f"  Login: admin@cmg.es / admin123")
        print(f"  IMEI test device: {PILOT_IMEI}")


if __name__ == "__main__":
    asyncio.run(seed())
