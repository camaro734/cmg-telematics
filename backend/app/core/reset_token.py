"""Generación y derivación de claves para tokens de recuperación de contraseña.

El token en claro viaja en el enlace del email; en Redis solo se guarda su
hash sha256, de modo que leer Redis no permite usar los tokens.
"""
import hashlib
import secrets

_KEY_PREFIX = "pwreset:"


def reset_key_for(token: str) -> str:
    """Clave Redis para un token de reset: prefijo + sha256 del token en claro."""
    return _KEY_PREFIX + hashlib.sha256(token.encode()).hexdigest()


def generate_reset_token() -> tuple[str, str]:
    """Genera un token aleatorio URL-safe y su clave Redis hasheada."""
    token = secrets.token_urlsafe(32)
    return token, reset_key_for(token)
