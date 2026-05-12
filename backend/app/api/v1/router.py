# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.rules import router as rules_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.settings import router as settings_router
from app.api.v1.maintenance import router as maintenance_router
from app.api.v1.users import router as users_router
from app.api.v1.reports import router as reports_router
from app.api.v1.devices import router as devices_router
from app.api.v1.work_cycles import router as work_cycles_router
from app.api.v1.diagnostics import router as diagnostics_router
from app.api.v1.commands import router as commands_router
from app.api.v1.drivers import router as drivers_router
from app.api.v1.work_orders import router as work_orders_router
from app.api.v1.work_reports import router as work_reports_router
from app.api.v1.portal import router as portal_router
from app.api.v1.fleet import router as fleet_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(drivers_router)
api_router.include_router(work_orders_router)
api_router.include_router(work_reports_router)
api_router.include_router(portal_router)
api_router.include_router(alerts_router)
api_router.include_router(rules_router)
api_router.include_router(tenants_router)
api_router.include_router(settings_router)
api_router.include_router(maintenance_router)
api_router.include_router(users_router)
api_router.include_router(reports_router, prefix="/reports")
api_router.include_router(devices_router, prefix="/devices")
api_router.include_router(work_cycles_router, prefix="/work-cycles")
api_router.include_router(diagnostics_router)
api_router.include_router(commands_router)
api_router.include_router(fleet_router)
