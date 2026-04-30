import secrets as _secrets_mod
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_KNOWN_WEAK_KEYS = {"changeme", "secret", "supersecret", "development", "test"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_url: str
    db_url_sync: str
    redis_url: str
    secret_key: str
    internal_api_key: str = ""
    environment: str = "development"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("secret_key")
    @classmethod
    def _validate_secret_key(cls, v: str) -> str:
        if not v or len(v) < 32 or v.lower().strip() in _KNOWN_WEAK_KEYS:
            raise ValueError(
                "SECRET_KEY debe tener al menos 32 caracteres y no ser un valor por defecto conocido. "
                "Genera uno con: openssl rand -hex 32"
            )
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


settings = Settings()
