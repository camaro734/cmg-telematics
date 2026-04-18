# backend/app/api/v1/router.py
from fastapi import APIRouter, Depends
from app.api.v1.auth import router as auth_router
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)


@api_router.get("/vehicles")
async def _vehicles_stub(user: CurrentUser = Depends(get_current_user)):
    return []
