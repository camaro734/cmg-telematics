"""
Seed script — entorno demo para presentaciones a clientes.

Crea:
  - Tenant: Hidráulica Industrial S.L. (manufacturer)
    - Tenant: Construcciones García S.L. (end_client) — 3 vehículos
    - Tenant: Obras Públicas Levante S.A. (end_client) — 3 vehículos
  - Usuarios en cada nivel con distintos roles
  - 6 vehículos con dispositivos FMC650 simulados
  - Variable maps (plantilla fabricante)
  - Reglas de alerta (flota + vehículo específico)
  - Reglas de automatización (track posición con bomba activa)
  - Geocercas (zona Valencia)
  - Tareas de mantenimiento + logs históricos
  - Telemetría histórica 7 días (rutas realistas en Valencia)
  - Logs de alertas (activas + resueltas)
  - Sesiones de automatización con trazas GPS

Credenciales demo:
  superadmin : admin@cmg.es / admin123  (ya existe)
  fabricante : admin@hidraulica-ind.es / Demo2024!
  operador   : operador@garcia.es / Demo2024!
  visualizador: vista@garcia.es / Demo2024!

Ejecutar:
  cd /opt/cmg-telematics/backend
  source venv/bin/activate
  python scripts/seed_demo.py
"""

import asyncio
import random
import sys
import os
import math
import json
import uuid
from datetime import datetime, timedelta, timezone, date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal, init_db
from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.variable_map import VariableMap
from app.models.alert_rule import AlertRule
from app.models.alert_log import AlertLog
from app.models.automation_rule import AutomationRule, AutomationSession, AutomationPositionLog
from app.models.geofence import Geofence, GeofenceEvent
from app.models.maintenance import MaintenanceTask, MaintenanceLog
from app.models.telemetry import TelemetryRecord
from app.api.v1.auth import hash_password

random.seed(42)

NOW = datetime.now(timezone.utc)
DEMO_PASSWORD = hash_password("Demo2024!")

# ─── Coordenadas base Valencia ────────────────────────────────────────────────
# Cada vehículo tiene una zona de trabajo centrada en un punto distinto
VEHICLE_BASES = [
    # (lat, lng, descripción)
    (39.5047, -0.4189, "Obras Quart de Poblet"),    # Excavadora JCB
    (39.4699, -0.3763, "Valencia Centro"),            # Camión Volvo
    (39.5001, -0.4416, "Paterna - Polígono"),         # Retroexcavadora Cat
    (39.4481, -0.3248, "Puerto de Valencia"),         # Plataforma JLG
    (39.4800, -0.4300, "Polígono Ind. L'Eliana"),    # Minicargadora Bobcat
    (39.4342, -0.4658, "Torrent - Obras"),            # Grúa Liebherr
]

MASSANASSA = (39.4167, -0.3833)  # Base/almacén central


# ─── Helpers ─────────────────────────────────────────────────────────────────

def workdays_in_last_7() -> list[date]:
    """Devuelve los días laborables (L-V) de los últimos 7 días."""
    days = []
    for i in range(7, 0, -1):
        d = (NOW - timedelta(days=i)).date()
        if d.weekday() < 5:  # 0=lunes, 4=viernes
            days.append(d)
    return days


def interpolate(p1, p2, t):
    """Interpola entre dos puntos (lat, lng) con t ∈ [0, 1]."""
    return p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t


def distance_km(p1, p2):
    """Distancia aproximada en km entre dos coordenadas."""
    dlat = (p2[0] - p1[0]) * 111.0
    dlng = (p2[1] - p1[1]) * 111.0 * math.cos(math.radians(p1[0]))
    return math.sqrt(dlat**2 + dlng**2)


def generate_day_trace(base_lat, base_lng, rng):
    """
    Genera la traza GPS de un día laboral.
    Fases: salida de Massanassa → obra → trabajo en sitio → regreso.
    Intervalos de 10 minutos, 07:00-18:00 → 66 puntos.
    Devuelve lista de dicts: {minute_offset, lat, lng, speed, ignition, pressure_raw, pump_active}.
    """
    home = MASSANASSA
    work = (base_lat + rng.uniform(-0.003, 0.003), base_lng + rng.uniform(-0.003, 0.003))

    # Fase 1: tránsito Massanassa → obra (07:00-08:30 = 9 intervalos)
    # Fase 2: trabajo en obra (08:30-16:30 = 48 intervalos)
    # Fase 3: tránsito obra → Massanassa (16:30-18:00 = 9 intervalos)
    points = []

    # ── Fase 1: tránsito al trabajo ──
    for i in range(9):
        t = i / 8.0
        lat, lng = interpolate(home, work, t)
        lat += rng.uniform(-0.0003, 0.0003)
        lng += rng.uniform(-0.0003, 0.0003)
        speed = rng.randint(35, 75)
        points.append({
            "minute_offset": i * 10,
            "lat": lat, "lng": lng,
            "speed": speed, "ignition": True,
            "pump_active": False,
            "pressure_raw": rng.randint(0, 800),
            "phase": "transit_in",
        })

    # ── Fase 2: trabajo en obra ──
    cur_lat, cur_lng = work
    for i in range(48):
        minute_offset = 90 + i * 10
        # Movimiento lento dentro de la obra (±100m)
        cur_lat += rng.uniform(-0.0008, 0.0008)
        cur_lng += rng.uniform(-0.0008, 0.0008)
        # Acercar de vuelta al centro de trabajo
        cur_lat += (work[0] - cur_lat) * 0.1
        cur_lng += (work[1] - cur_lng) * 0.1

        working = rng.random() > 0.25  # 75% del tiempo trabajando
        speed = rng.randint(0, 8) if not working else 0
        pump_active = working and rng.random() > 0.2
        if pump_active:
            pressure_raw = rng.randint(8000, 28000)  # 48-168 bar
        else:
            pressure_raw = rng.randint(0, 1200)
        points.append({
            "minute_offset": minute_offset,
            "lat": cur_lat, "lng": cur_lng,
            "speed": speed, "ignition": True,
            "pump_active": pump_active,
            "pressure_raw": pressure_raw,
            "phase": "working",
        })

    # ── Fase 3: regreso ──
    for i in range(9):
        t = i / 8.0
        lat, lng = interpolate(work, home, t)
        lat += rng.uniform(-0.0003, 0.0003)
        lng += rng.uniform(-0.0003, 0.0003)
        speed = rng.randint(30, 70)
        points.append({
            "minute_offset": 570 + i * 10,
            "lat": lat, "lng": lng,
            "speed": speed, "ignition": True,
            "pump_active": False,
            "pressure_raw": rng.randint(0, 500),
            "phase": "transit_out",
        })

    return points


async def get_or_create_tenant(session, name, type_, parent_id=None, brand_name=None, brand_color=None):
    result = await session.execute(select(Tenant).where(Tenant.name == name))
    t = result.scalar_one_or_none()
    if not t:
        t = Tenant(name=name, type=type_, parent_id=parent_id,
                   brand_name=brand_name, brand_color=brand_color)
        session.add(t)
        await session.flush()
        print(f"  [+] Tenant: {name}")
    return t


async def get_or_create_user(session, email, hashed_pw, full_name, role, tenant_id):
    result = await session.execute(select(User).where(User.email == email))
    u = result.scalar_one_or_none()
    if not u:
        u = User(tenant_id=tenant_id, email=email, hashed_password=hashed_pw,
                 full_name=full_name, role=role)
        session.add(u)
        await session.flush()
        print(f"  [+] Usuario: {email} ({role})")
    return u


async def get_or_create_vehicle(session, name, license_plate, tenant_id, manufacturer_id, description=""):
    result = await session.execute(select(Vehicle).where(Vehicle.name == name))
    v = result.scalar_one_or_none()
    if not v:
        v = Vehicle(name=name, license_plate=license_plate,
                    tenant_id=tenant_id, manufacturer_id=manufacturer_id,
                    description=description)
        session.add(v)
        await session.flush()
        print(f"  [+] Vehículo: {name} ({license_plate})")
    return v


async def get_or_create_device(session, imei, vehicle_id, last_seen=None):
    result = await session.execute(select(Device).where(Device.imei == imei))
    d = result.scalar_one_or_none()
    if not d:
        online = last_seen is not None and (NOW - last_seen).total_seconds() < 600
        d = Device(imei=imei, vehicle_id=vehicle_id, model="FMC650",
                   last_seen=last_seen, online=online)
        session.add(d)
        await session.flush()
        print(f"  [+] Dispositivo: IMEI {imei}")
    return d


# ─── SEED PRINCIPAL ───────────────────────────────────────────────────────────

async def seed():
    await init_db()
    print("\n═══ CMG Telematics — Seed Demo ═══\n")

    async with AsyncSessionLocal() as session:

        # ── 0. Tenant raíz CMG (ya debe existir) ──────────────────────────
        result = await session.execute(select(Tenant).where(Tenant.type == "cmg"))
        cmg = result.scalar_one_or_none()
        if not cmg:
            cmg = Tenant(name="CMG Metalhidráulica S.L.", type="cmg")
            session.add(cmg)
            await session.flush()
            print("  [+] Tenant raíz CMG creado")
        print(f"  [=] Tenant raíz: {cmg.name}")

        # ── 1. Admin CMG ──────────────────────────────────────────────────
        result = await session.execute(select(User).where(User.email == "admin@cmg.es"))
        admin_cmg = result.scalar_one_or_none()
        if not admin_cmg:
            admin_cmg = User(
                tenant_id=cmg.id, email="admin@cmg.es",
                hashed_password=hash_password("admin123"),
                full_name="Administrador CMG", role="superadmin",
            )
            session.add(admin_cmg)
            await session.flush()
        print(f"  [=] Admin CMG: admin@cmg.es / admin123")

        # ── 2. Fabricante: Hidráulica Industrial S.L. ─────────────────────
        print("\n[TENANTS]")
        mfr = await get_or_create_tenant(
            session, "Hidráulica Industrial S.L.", "manufacturer",
            parent_id=cmg.id,
            brand_name="HidroFleet", brand_color="#1D9E75",
        )

        # ── 3. Clientes finales ───────────────────────────────────────────
        client_a = await get_or_create_tenant(
            session, "Construcciones García S.L.", "end_client", parent_id=mfr.id
        )
        client_b = await get_or_create_tenant(
            session, "Obras Públicas Levante S.A.", "end_client", parent_id=mfr.id
        )
        await session.commit()

        # ── 4. Usuarios ───────────────────────────────────────────────────
        print("\n[USUARIOS]")
        admin_mfr = await get_or_create_user(
            session, "admin@hidraulica-ind.es", DEMO_PASSWORD,
            "Carlos Martínez (Admin Fabricante)", "admin", mfr.id,
        )
        op_garcia = await get_or_create_user(
            session, "operador@garcia.es", DEMO_PASSWORD,
            "Luis García (Operador)", "operator", client_a.id,
        )
        vista_garcia = await get_or_create_user(
            session, "vista@garcia.es", DEMO_PASSWORD,
            "Ana García (Visualizador)", "viewer", client_a.id,
        )
        op_obras = await get_or_create_user(
            session, "operador@obras-levante.es", DEMO_PASSWORD,
            "Pedro Soler (Operador OPL)", "operator", client_b.id,
        )
        await session.commit()

        # ── 5. Vehículos + Dispositivos ───────────────────────────────────
        print("\n[VEHÍCULOS]")
        vehicles_data = [
            # (nombre, matrícula, cliente, imei, last_seen_offset_min, descripción)
            ("Excavadora Hidráulica JCB 220X", "V-4821-KM", client_a.id,
             "352001000000001", 6,     "Excavadora de cadenas con sistema hidráulico IFM CR2530"),
            ("Camión Volvo FH 500 Hormigonera", "V-7734-LN", client_a.id,
             "352001000000002", None,  "Camión hormigonera — 8 m³"),
            ("Retroexcavadora CAT 432F2", "V-2290-JR", client_a.id,
             "352001000000003", 8,     "Retroexcavadora con monitorización CAN J1939"),
            ("Plataforma Elevadora JLG 600S", "V-5503-PQ", client_b.id,
             "352001000000004", None,  "Plataforma articulada 18m — control presión aceite"),
            ("Minicargadora Bobcat S650", "V-1122-TF", client_b.id,
             "352001000000005", 5,     "Minicargadora hidrostática con brazos hidráulicos"),
            ("Grúa Autopropulsada Liebherr LTM", "V-9876-XA", client_b.id,
             "352001000000006", None,  "Grúa móvil 50T — monitorización carga hidráulica"),
        ]

        vehicles = []
        devices = []
        for i, (name, plate, tenant_id, imei, online_offset, desc) in enumerate(vehicles_data):
            v = await get_or_create_vehicle(
                session, name, plate, tenant_id, mfr.id, description=desc
            )
            last_seen = NOW - timedelta(minutes=online_offset) if online_offset else NOW - timedelta(days=2)
            d = await get_or_create_device(session, imei, v.id, last_seen=last_seen)
            vehicles.append(v)
            devices.append(d)

        await session.commit()

        # ── 6. Variable Maps — plantilla fabricante ───────────────────────
        print("\n[VARIABLE MAPS]")
        vm_defs = [
            # (io_key, display_name, unit, scale_factor, offset, alert_high, alert_low, data_type)
            ("9",   "Presión aceite hidráulico", "bar",  0.006, 0.0, 190.0, 5.0,   "gauge"),
            ("10",  "Caudal bomba hidráulica",   "l/min",0.01,  0.0, 120.0, None,  "gauge"),
            ("11",  "Temperatura aceite hidráu.","°C",   0.1,   0.0, 95.0,  None,  "gauge"),
            ("12",  "Nivel depósito hidráulico", "%",    0.1,   0.0, None,  15.0,  "gauge"),
            ("239", "Ignición",                  "",     1.0,   0.0, None,  None,  "boolean"),
            ("67",  "Velocidad motor (RPM)",     "rpm",  1.0,   0.0, 2500.0,None,  "gauge"),
            ("200", "Sleep mode",                "",     1.0,   0.0, None,  None,  "boolean"),
        ]
        for io_key, display_name, unit, scale, offset, ah, al, dtype in vm_defs:
            result = await session.execute(
                select(VariableMap).where(
                    VariableMap.tenant_id == mfr.id,
                    VariableMap.io_key == io_key,
                    VariableMap.vehicle_id == None,
                )
            )
            if not result.scalar_one_or_none():
                vm = VariableMap(
                    tenant_id=mfr.id, io_key=io_key,
                    display_name=display_name, unit=unit,
                    scale_factor=scale, offset=offset,
                    alert_high=ah, alert_low=al, data_type=dtype,
                )
                session.add(vm)
                print(f"  [+] VarMap fabricante: {io_key} → {display_name}")
        await session.commit()

        # ── 7. Reglas de alerta ───────────────────────────────────────────
        print("\n[ALERT RULES]")
        alert_rules_data = [
            # (tenant_id, vehicle_id, name, io_key, display_name, condition, threshold,
            #  scale, unit, level, cooldown)
            (mfr.id, None,
             "Presión hidráulica crítica", "9", "Presión aceite hidráulico",
             "gt", 190.0, 0.006, "bar", "high", 30),
            (mfr.id, None,
             "Presión hidráulica alta", "9", "Presión aceite hidráulico",
             "gt", 160.0, 0.006, "bar", "medium", 60),
            (mfr.id, None,
             "Temperatura aceite alta", "11", "Temperatura aceite hidráulico",
             "gt", 90.0, 0.1, "°C", "high", 45),
            (mfr.id, None,
             "Nivel depósito bajo", "12", "Nivel depósito hidráulico",
             "lt", 20.0, 0.1, "%", "medium", 120),
            (mfr.id, None,
             "Voltaje batería bajo", "ext_voltage_mv", "Tensión batería vehículo",
             "lt", 11500.0, 1.0, "mV", "high", 60),
            (mfr.id, None,
             "Velocidad excesiva", "67", "Velocidad motor",
             "gt", 90.0, 1.0, "km/h", "medium", 15),
            # Reglas específicas por vehículo
            (client_a.id, vehicles[0].id,
             "JCB — Sobrepresión bomba principal", "9", "Presión bomba JCB 220X",
             "gt", 200.0, 0.006, "bar", "high", 20),
            (client_b.id, vehicles[3].id,
             "JLG — Temperatura crítica aceite", "11", "Temperatura aceite JLG 600S",
             "gt", 88.0, 0.1, "°C", "high", 30),
        ]
        alert_rule_objs = []
        for (t_id, v_id, name, io_key, disp, cond, thr, scale, unit, lvl, cool) in alert_rules_data:
            result = await session.execute(
                select(AlertRule).where(AlertRule.name == name, AlertRule.tenant_id == t_id)
            )
            ar = result.scalar_one_or_none()
            if not ar:
                ar = AlertRule(
                    tenant_id=t_id, vehicle_id=v_id, name=name,
                    io_key=io_key, display_name=disp, condition=cond,
                    threshold=thr, scale_factor=scale, unit=unit,
                    level=lvl, cooldown_minutes=cool, created_by=admin_mfr.id,
                )
                session.add(ar)
                await session.flush()
                print(f"  [+] AlertRule: {name}")
            alert_rule_objs.append(ar)
        await session.commit()

        # ── 8. Reglas de automatización ───────────────────────────────────
        print("\n[AUTOMATIZACIONES]")
        automation_defs = [
            (mfr.id, None,
             "Trazado GPS — Bomba hidráulica activa",
             "Registra la ruta GPS mientras la bomba hidráulica principal está en funcionamiento",
             "9", "gt", 5000.0, 0.006, 0.0,
             [{"type": "track_position", "params": {"label": "Bomba activa", "color": "#1D9E75"}}]),
            (mfr.id, None,
             "Trazado GPS — Jornada laboral (ignición ON)",
             "Registra posiciones durante la jornada con el motor encendido",
             "239", "eq", 1.0, 1.0, 0.0,
             [{"type": "track_position", "params": {"label": "Jornada trabajo", "color": "#3b82f6"}}]),
            (client_a.id, vehicles[0].id,
             "JCB — Alerta posición al superar 180 bar",
             "Guarda posición exacta cuando se detecta sobrepresión",
             "9", "gt", 30000.0, 0.006, 0.0,
             [{"type": "track_position", "params": {"label": "Sobrepresión JCB", "color": "#ef4444"}}]),
        ]
        automation_objs = []
        for (t_id, v_id, name, desc, io_key, cond, thr, scale, offset, actions) in automation_defs:
            result = await session.execute(
                select(AutomationRule).where(AutomationRule.name == name)
            )
            ar = result.scalar_one_or_none()
            if not ar:
                ar = AutomationRule(
                    tenant_id=t_id, vehicle_id=v_id, name=name, description=desc,
                    io_key=io_key, condition=cond, threshold=thr,
                    scale_factor=scale, offset=offset, actions=actions,
                    created_by=admin_mfr.id,
                )
                session.add(ar)
                await session.flush()
                print(f"  [+] Automatización: {name}")
            automation_objs.append(ar)
        await session.commit()

        # ── 9. Geocercas ──────────────────────────────────────────────────
        print("\n[GEOCERCAS]")
        geofence_defs = [
            (mfr.id,
             "Almacén Central Massanassa",
             "Base principal — salidas y entradas de flota",
             "circle", 39.4167, -0.3833, 500.0,
             None, True, True),
            (client_a.id,
             "Obra Valencia Norte (García)",
             "Zona de obra activa Q4 2026",
             "circle", 39.5047, -0.4189, 300.0,
             None, True, True),
            (client_a.id,
             "Cantera Paterna",
             "Cantera de extracción — acceso restringido",
             "circle", 39.5001, -0.4416, 400.0,
             None, True, True),
            (client_b.id,
             "Puerto de Valencia — Zona Obras",
             "Área de obras de ampliación del puerto",
             "circle", 39.4481, -0.3248, 600.0,
             None, True, True),
            (mfr.id,
             "Zona Prohibida — Residencial",
             "Área residencial — no operar maquinaria pesada",
             "circle", 39.4699, -0.3763, 200.0,
             None, True, True),
        ]
        geofence_objs = []
        for (t_id, name, desc, shape, clat, clng, r, poly, aenter, aexit) in geofence_defs:
            result = await session.execute(
                select(Geofence).where(Geofence.name == name)
            )
            gf = result.scalar_one_or_none()
            if not gf:
                gf = Geofence(
                    tenant_id=t_id, name=name, description=desc,
                    shape_type=shape, center_lat=clat, center_lng=clng, radius_m=r,
                    polygon_points=poly, alert_on_enter=aenter, alert_on_exit=aexit,
                    created_by=admin_mfr.id,
                )
                session.add(gf)
                await session.flush()
                print(f"  [+] Geocerca: {name}")
            geofence_objs.append(gf)
        await session.commit()

        # ── 10. Tareas de mantenimiento ────────────────────────────────────
        print("\n[MANTENIMIENTO]")
        maint_defs = [
            # (vehicle_idx, nombre, desc, trigger, interval, next_due_km, next_due_h, next_due_date, warn_before, pto_key)
            (0, "Cambio aceite hidráulico",
             "Aceite Shell Tellus S2 M 46 — 500h o 1 año",
             "hours", 500.0, None, 4850.0, None, 50.0, "9"),
            (0, "Revisión filtro retorno hidráulico",
             "Filtro HYDAC 250h de servicio",
             "hours", 250.0, None, 4610.0, None, 25.0, "9"),
            (0, "ITV — Excavadora JCB",
             "Inspección técnica de vehículo",
             "date", None, None, None, date(2026, 7, 15), 30.0, "ignition"),
            (1, "Cambio aceite motor Volvo",
             "Aceite Volvo VDS-4.5 — cada 40.000 km",
             "km", 40000.0, 142800.0, None, None, 2000.0, "ignition"),
            (1, "Revisión frenos y neumáticos",
             "Inspección semestral",
             "days", 180.0, None, None, date(2026, 5, 10), 14.0, "ignition"),
            (2, "Cambio aceite hidráulico CAT",
             "Aceite Caterpillar HYDO Advanced 10 — 1000h",
             "hours", 1000.0, None, 6120.0, None, 100.0, "9"),
            (3, "Revisión estructura elevadora JLG",
             "Inspección obligatoria cada 6 meses",
             "date", None, None, None, date(2026, 4, 20), 15.0, "ignition"),
            (4, "Cambio cadenas Bobcat",
             "Cadenas de goma 1200h o desgaste > 20%",
             "hours", 1200.0, None, 5900.0, None, 100.0, "ignition"),
            (5, "Certificación grúa Liebherr",
             "Certificado oficial carga máxima — anual",
             "date", None, None, None, date(2026, 3, 31), 30.0, "ignition"),
        ]
        maint_tasks = []
        for (vi, name, desc, ttype, interval, nkm, nh, nd, warn, pto) in maint_defs:
            result = await session.execute(
                select(MaintenanceTask).where(
                    MaintenanceTask.vehicle_id == vehicles[vi].id,
                    MaintenanceTask.name == name,
                )
            )
            mt = result.scalar_one_or_none()
            if not mt:
                mt = MaintenanceTask(
                    vehicle_id=vehicles[vi].id, name=name, description=desc,
                    trigger_type=ttype, interval_value=interval,
                    next_due_km=nkm, next_due_hours=nh, next_due_date=nd,
                    warn_before=warn, pto_io_key=pto,
                    created_by=op_garcia.id if vi < 3 else op_obras.id,
                )
                session.add(mt)
                await session.flush()
                print(f"  [+] Tarea mant.: {vehicles[vi].name[:25]} — {name[:35]}")
            maint_tasks.append((mt, vi))
        await session.commit()

        # ── 10b. Logs de mantenimiento históricos ─────────────────────────
        print("\n[LOGS MANTENIMIENTO]")
        maint_log_defs = [
            # (task_idx, performed_at_days_ago, notas, odometer, engine_h, performer)
            (0, 90, "Cambio aceite Shell Tellus S2 M 46. Sin incidencias.",     None, 4350.0, op_garcia.id),
            (0, 180,"Cambio aceite + filtro retorno. Aceite con leve contam.",  None, 3860.0, op_garcia.id),
            (1, 45, "Filtro retorno cambiado. Δp normal tras sustitución.",     None, 4360.0, op_garcia.id),
            (3, 60, "Cambio aceite motor. Km: 142.200. Sin incidencias.",       142200.0, None, op_garcia.id),
            (5, 120,"Cambio aceite hidráulico CAT. Análisis OK.",               None, 5120.0, op_obras.id),
        ]
        for (ti, days_ago, notes, odo, eng_h, performer) in maint_log_defs:
            mt, vi = maint_tasks[ti]
            performed_at = NOW - timedelta(days=days_ago)
            result = await session.execute(
                select(MaintenanceLog).where(
                    MaintenanceLog.task_id == mt.id,
                    MaintenanceLog.performed_at == performed_at,
                )
            )
            if not result.scalar_one_or_none():
                ml = MaintenanceLog(
                    task_id=mt.id, vehicle_id=vehicles[vi].id,
                    performed_at=performed_at, performed_by=performer,
                    notes=notes, odometer_km=odo, engine_hours=eng_h,
                )
                session.add(ml)
                print(f"  [+] Log mant.: {mt.name[:40]} (hace {days_ago}d)")
        await session.commit()

        # ── 11. Telemetría histórica ───────────────────────────────────────
        print("\n[TELEMETRÍA] Generando datos históricos (7 días)...")
        workdays = workdays_in_last_7()
        rng = random.Random(42)
        total_records = 0

        for vi, (vehicle, device) in enumerate(zip(vehicles, devices)):
            base_lat, base_lng, zona = VEHICLE_BASES[vi]

            for day in workdays:
                # Algunos vehículos no trabajan todos los días
                if rng.random() < 0.15:  # 15% probabilidad de día sin actividad
                    continue

                trace = generate_day_trace(base_lat, base_lng, rng)

                batch = []
                for pt in trace:
                    ts = datetime.combine(day, datetime.min.time()).replace(
                        hour=7, minute=0, second=0, tzinfo=timezone.utc
                    ) + timedelta(minutes=pt["minute_offset"])

                    # No generar datos más allá de NOW
                    if ts > NOW:
                        continue

                    io_data = {
                        "9": pt["pressure_raw"],
                        "10": rng.randint(200, 800) if pt["pump_active"] else 0,
                        "11": rng.randint(450, 870),   # temp aceite (×0.1 = 45-87°C)
                        "12": rng.randint(250, 900),   # nivel depósito (×0.1 = 25-90%)
                        "67": rng.randint(800, 2200) if pt["ignition"] else 0,
                        "239": 1 if pt["ignition"] else 0,
                        "200": 0,
                    }

                    # Ocasionalmente generar valor de alerta (presión alta)
                    if rng.random() < 0.02:  # 2% de registros con sobrepresión
                        io_data["9"] = rng.randint(32000, 36000)

                    batch.append({
                        "rec_id": str(uuid.uuid4()),
                        "time": ts,
                        "device_id": str(device.id),
                        "lat": round(pt["lat"], 6),
                        "lng": round(pt["lng"], 6),
                        "altitude": rng.randint(10, 35),
                        "speed": pt["speed"],
                        "angle": rng.randint(0, 359),
                        "satellites": rng.randint(7, 12),
                        "priority": 0,
                        "ignition": pt["ignition"],
                        "ext_voltage_mv": rng.randint(13400, 14700),
                        "battery_mv": rng.randint(4050, 4200),
                        "dout1": pt["pump_active"],
                        "dout2": False,
                        "dout3": False,
                        "dout4": False,
                        "din1": pt["pump_active"],
                        "din2": False,
                        "din3": False,
                        "din4": False,
                        "io_data": json.dumps(io_data),
                    })

                # INSERT en lote usando ON CONFLICT DO NOTHING (idempotente)
                if batch:
                    await session.execute(
                        text("""
                            INSERT INTO telemetry_record
                              (id, time, device_id, lat, lng, altitude, speed, angle, satellites,
                               priority, ignition, ext_voltage_mv, battery_mv,
                               dout1, dout2, dout3, dout4, din1, din2, din3, din4, io_data)
                            VALUES
                              (:rec_id, :time, :device_id, :lat, :lng, :altitude, :speed,
                               :angle, :satellites, :priority, :ignition,
                               :ext_voltage_mv, :battery_mv,
                               :dout1, :dout2, :dout3, :dout4, :din1, :din2, :din3, :din4,
                               CAST(:io_data AS jsonb))
                            ON CONFLICT (id, time) DO NOTHING
                        """),
                        batch,
                    )
                    total_records += len(batch)

            await session.commit()
            print(f"  [+] {vehicle.name[:35]}: {len(workdays)} días procesados")

        print(f"  Total registros telemetría: ~{total_records}")

        # ── 12. Alert Logs (histórico + activos) ──────────────────────────
        print("\n[ALERT LOGS]")
        alert_log_defs = [
            # (vehicle_idx, rule_idx, io_key, display_name, level,
            #  raw, converted, threshold, unit, days_ago, resolved_days_ago, ack_days_ago)
            (0, 0, "9", "Presión aceite hidráulico", "high",
             33500.0, 201.0, 190.0, "bar", 5, 5, 5),
            (0, 1, "9", "Presión aceite hidráulico", "medium",
             28000.0, 168.0, 160.0, "bar", 4, 4, None),
            (0, 2, "11", "Temperatura aceite hidráulico", "high",
             9600.0, 96.0, 90.0, "°C", 3, 3, 3),
            (1, 4, "ext_voltage_mv", "Tensión batería vehículo", "high",
             11200.0, 11200.0, 11500.0, "mV", 2, 2, None),
            (2, 0, "9", "Presión aceite hidráulico", "high",
             34200.0, 205.2, 190.0, "bar", 1, None, None),  # activa sin resolver
            (3, 7, "11", "Temperatura aceite JLG 600S", "high",
             9100.0, 91.0, 88.0, "°C", 1, None, None),       # activa sin resolver
            (4, 3, "12", "Nivel depósito hidráulico", "medium",
             1500.0, 15.0, 20.0, "%", 6, 6, 6),
            (5, 4, "ext_voltage_mv", "Tensión batería vehículo", "high",
             10900.0, 10900.0, 11500.0, "mV", 3, 3, 3),
            (0, 5, "67", "Velocidad motor", "medium",
             95.0, 95.0, 90.0, "km/h", 2, 2, None),
            (2, 6, "9", "Presión bomba JCB 220X", "high",
             33800.0, 202.8, 200.0, "bar", 1, None, None),   # activa sin resolver
        ]

        for (vi, ri, io_key, disp, lvl, raw, conv, thr, unit,
             days_ago, res_days, ack_days) in alert_log_defs:
            fired_at = NOW - timedelta(days=days_ago, hours=rng.randint(1, 8))
            resolved_at = (NOW - timedelta(days=res_days, minutes=30)) if res_days is not None else None
            acknowledged_at = (NOW - timedelta(days=ack_days, minutes=15)) if ack_days is not None else None

            rule = alert_rule_objs[ri] if ri < len(alert_rule_objs) else alert_rule_objs[0]
            al = AlertLog(
                device_id=devices[vi].id,
                vehicle_id=vehicles[vi].id,
                rule_id=rule.id,
                io_key=io_key,
                display_name=disp,
                level=lvl,
                raw_value=raw,
                converted_value=conv,
                threshold=thr,
                unit=unit,
                fired_at=fired_at,
                resolved_at=resolved_at,
                acknowledged_at=acknowledged_at,
                acknowledged_by=admin_mfr.id if acknowledged_at else None,
            )
            session.add(al)
            status = "activa" if not resolved_at else "resuelta"
            print(f"  [+] AlertLog: {vehicles[vi].name[:25]} — {disp[:30]} ({status})")

        await session.commit()

        # ── 13. Sesiones de automatización + trazas posición ──────────────
        print("\n[AUTOMATION SESSIONS]")
        if automation_objs and workdays:
            session_defs = [
                # (vehicle_idx, rule_idx, day_idx, start_h, end_h, color, label)
                (0, 0, -1, 9,  12, "#1D9E75", "Bomba activa — mañana"),
                (0, 0, -1, 14, 16, "#1D9E75", "Bomba activa — tarde"),
                (2, 0, -2, 8,  11, "#1D9E75", "Bomba activa — CAT"),
                (4, 0, -1, 10, 13, "#1D9E75", "Bomba activa — Bobcat"),
                (0, 1, -2,  7, 18, "#3b82f6", "Jornada laboral JCB"),
                (1, 1, -1,  7, 17, "#3b82f6", "Jornada laboral Volvo"),
            ]
            auto_rule_pump = automation_objs[0] if automation_objs else None
            auto_rule_jour = automation_objs[1] if len(automation_objs) > 1 else None

            for (vi, ri, di, sh, eh, color, label) in session_defs:
                if ri >= len(automation_objs):
                    continue
                rule = automation_objs[ri]
                day_idx = len(workdays) + di  # di=-1 → último día laborable
                if day_idx < 0 or day_idx >= len(workdays):
                    day_idx = len(workdays) - 1

                day = workdays[day_idx]
                started_at = datetime.combine(day, datetime.min.time()).replace(
                    hour=sh, minute=0, second=0, tzinfo=timezone.utc
                )
                ended_at = datetime.combine(day, datetime.min.time()).replace(
                    hour=eh, minute=0, second=0, tzinfo=timezone.utc
                )
                if started_at > NOW:
                    continue

                sess = AutomationSession(
                    rule_id=rule.id, device_id=devices[vi].id, vehicle_id=vehicles[vi].id,
                    started_at=started_at, ended_at=ended_at, label=label, color=color,
                )
                session.add(sess)
                await session.flush()

                # Posiciones durante la sesión (cada 15 min)
                base_lat, base_lng, _ = VEHICLE_BASES[vi]
                cur_lat = base_lat + rng.uniform(-0.002, 0.002)
                cur_lng = base_lng + rng.uniform(-0.002, 0.002)
                t = started_at
                while t < ended_at and t < NOW:
                    cur_lat += rng.uniform(-0.0005, 0.0005)
                    cur_lng += rng.uniform(-0.0005, 0.0005)
                    apl = AutomationPositionLog(
                        session_id=sess.id, time=t,
                        lat=round(cur_lat, 6), lng=round(cur_lng, 6),
                        speed=rng.randint(0, 5) if ri == 0 else rng.randint(0, 50),
                    )
                    session.add(apl)
                    t += timedelta(minutes=15)

                print(f"  [+] Sesión auto: {vehicles[vi].name[:25]} — {label}")

        await session.commit()

        # ── 14. Eventos geocerca ──────────────────────────────────────────
        print("\n[GEOFENCE EVENTS]")
        if geofence_objs and workdays:
            gf_event_defs = [
                # (gf_idx, vehicle_idx, day_idx, hour, event_type)
                (0, 0, -1,  7, "exit"),
                (1, 0, -1,  8, "enter"),
                (1, 0, -1, 17, "exit"),
                (0, 0, -1, 18, "enter"),
                (0, 2, -2,  7, "exit"),
                (2, 2, -2,  9, "enter"),
                (2, 2, -2, 16, "exit"),
                (0, 2, -2, 17, "enter"),
                (3, 3, -1,  9, "enter"),
                (3, 3, -1, 16, "exit"),
            ]
            for (gfi, vi, di, hour, etype) in gf_event_defs:
                if gfi >= len(geofence_objs):
                    continue
                gf = geofence_objs[gfi]
                day_idx = len(workdays) + di
                if day_idx < 0 or day_idx >= len(workdays):
                    day_idx = len(workdays) - 1
                day = workdays[day_idx]
                occurred_at = datetime.combine(day, datetime.min.time()).replace(
                    hour=hour, minute=rng.randint(0, 15), second=0, tzinfo=timezone.utc
                )
                if occurred_at > NOW:
                    continue
                ev = GeofenceEvent(
                    geofence_id=gf.id, device_id=devices[vi].id, vehicle_id=vehicles[vi].id,
                    event_type=etype, occurred_at=occurred_at,
                    lat=gf.center_lat + rng.uniform(-0.001, 0.001),
                    lng=gf.center_lng + rng.uniform(-0.001, 0.001),
                    geofence_name=gf.name, vehicle_name=vehicles[vi].name,
                )
                session.add(ev)
            print(f"  [+] {len(gf_event_defs)} eventos geocerca creados")

        await session.commit()

    # ── Resumen final ─────────────────────────────────────────────────────────
    print("""
╔══════════════════════════════════════════════════════════════╗
║          CMG TELEMATICS — ENTORNO DEMO LISTO ✓              ║
╠══════════════════════════════════════════════════════════════╣
║  CREDENCIALES                                                 ║
║  ─────────────────────────────────────────────────────────   ║
║  Superadmin (CMG):                                            ║
║    admin@cmg.es  /  admin123                                  ║
║                                                               ║
║  Admin Fabricante (Hidráulica Industrial S.L.):               ║
║    admin@hidraulica-ind.es  /  Demo2024!                      ║
║                                                               ║
║  Operador (Construcciones García):                            ║
║    operador@garcia.es  /  Demo2024!                           ║
║                                                               ║
║  Visualizador (Construcciones García):                        ║
║    vista@garcia.es  /  Demo2024!                              ║
║                                                               ║
║  Operador (Obras Públicas Levante):                           ║
║    operador@obras-levante.es  /  Demo2024!                    ║
║                                                               ║
║  DATOS CREADOS                                                ║
║  ─────────────────────────────────────────────────────────   ║
║  · 2 clientes + 1 fabricante en jerarquía multi-tenant        ║
║  · 6 vehículos (3 online, 3 offline)                          ║
║  · 7 variable maps (plantilla fabricante)                     ║
║  · 8 reglas de alerta (flota + específicas)                   ║
║  · 3 automatizaciones (trazado GPS por condición)             ║
║  · 5 geocercas (Valencia área)                                ║
║  · 9 tareas de mantenimiento (3 vencidas próximamente)        ║
║  · Telemetría histórica 7 días (~2.000 registros)             ║
║  · 10 alertas disparadas (4 activas sin resolver)             ║
║  · 6 sesiones de automatización con trazas GPS               ║
╚══════════════════════════════════════════════════════════════╝
""")


if __name__ == "__main__":
    asyncio.run(seed())
