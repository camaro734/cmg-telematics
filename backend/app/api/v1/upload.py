"""
File upload endpoint — logos for white-label tenants.
"""
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/upload", tags=["upload"])

LOGOS_DIR = "/opt/cmg-telematics/backend/static/logos"
ALLOWED_TYPES = {"image/png", "image/svg+xml", "image/jpeg", "image/webp"}
MAX_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB

ALLOWED_ROLES = {"superadmin", "admin"}


@router.post("/logo", response_model=dict)
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a logo image. Returns the public URL."""
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            400,
            f"Tipo de archivo no permitido: {file.content_type}. "
            "Usa PNG, SVG, JPG o WEBP."
        )

    content = await file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(400, "El archivo no puede superar 2 MB")

    # Determine extension from content type
    ext_map = {
        "image/png": ".png",
        "image/svg+xml": ".svg",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }
    ext = ext_map.get(file.content_type, ".png")

    filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(LOGOS_DIR, filename)

    with open(file_path, "wb") as f:
        f.write(content)

    return {"url": f"/static/logos/{filename}"}
