from fastapi import APIRouter
from app.api.v1 import auth, vehicles, telemetry, trips, commands, dashboard, admin, variable_map as variable_map_router, alerts as alerts_router, maintenance as maintenance_router, geofences as geofences_router, ecodriving as ecodriving_router, events as events_router, branding as branding_router, upload as upload_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(vehicles.router)
api_router.include_router(telemetry.router)
api_router.include_router(trips.router)
api_router.include_router(commands.router)
api_router.include_router(dashboard.router)
api_router.include_router(admin.router)
api_router.include_router(variable_map_router.router, prefix="/variable-maps", tags=["variable-maps"])
api_router.include_router(alerts_router.router)
api_router.include_router(maintenance_router.router)
api_router.include_router(geofences_router.router)
api_router.include_router(ecodriving_router.router)
api_router.include_router(events_router.router)
api_router.include_router(branding_router.router)
api_router.include_router(upload_router.router)
