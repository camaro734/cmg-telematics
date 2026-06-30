"""Membrete del EMISOR para los PDF (reporte agregado y parte individual).

Centraliza los datos de empresa del tenant emisor y el logo embebido en base64
(data URI), con fallback al logo de CMG. Lo consumen ambos generadores de PDF a
través de la macro Jinja ``templates/reports/_letterhead.html`` para no mantener
dos membretes divergentes (DRY).

El logo se embebe como data URI (no ``file://``) para no depender del ``base_url``
de WeasyPrint y servir igual a ambos PDF.
"""
import base64
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Raíz de subidas (Docker o repo local) — el logo del tenant vive en logos/<id>.<ext>.
_UPLOADS_ROOT = (
    Path("/app/uploads") if Path("/app/uploads").exists()
    else Path(__file__).resolve().parents[2] / "uploads"
)
# Logo corporativo de CMG: fallback cuando el tenant no tiene logo propio.
_CMG_LOGO = Path(__file__).resolve().parents[1] / "static" / "logos" / "cmgtrack.png"

_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


def _data_uri(path: Path) -> str | None:
    """Lee un fichero de imagen y lo devuelve como data URI base64 (None si falla)."""
    try:
        mime = _MIME_BY_EXT.get(path.suffix.lower(), "image/png")
        return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    except Exception:  # noqa: BLE001 — la ausencia de logo no debe romper el PDF
        return None


def _logo_path_from_url(logo_url: str) -> Path | None:
    """Traduce ``/uploads/logos/<id>.<ext>`` a su ruta física bajo _UPLOADS_ROOT."""
    prefix = "/uploads/"
    if not logo_url.startswith(prefix):
        return None
    return _UPLOADS_ROOT / logo_url[len(prefix):]


def issuer_logo_data_uri(tenant: Any | None) -> str | None:
    """Logo del emisor como data URI: el del tenant si existe; si no, el de CMG."""
    if tenant is not None and getattr(tenant, "logo_url", None):
        p = _logo_path_from_url(tenant.logo_url)
        if p is not None and p.exists():
            uri = _data_uri(p)
            if uri:
                return uri
    return _data_uri(_CMG_LOGO)


def build_issuer(tenant: Any | None) -> dict[str, Any]:
    """Datos del membrete del emisor (razón social, CIF, contacto + logo embebido).

    ``tenant`` None o sin datos → cae a los valores de CMG. Las claves vacías van
    como None para que la macro las omita limpiamente.
    """
    if tenant is None:
        return {
            "legal_name": "CMG Track",
            "cif": None, "address": None, "phone": None, "email": None, "website": None,
            "logo_src": issuer_logo_data_uri(None),
        }
    return {
        "legal_name": tenant.business_legal_name or tenant.brand_name or tenant.name,
        "cif": tenant.business_cif,
        "address": tenant.business_address,
        "phone": tenant.business_phone,
        "email": tenant.business_email,
        "website": tenant.business_website,
        "logo_src": issuer_logo_data_uri(tenant),
    }
