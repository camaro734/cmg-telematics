# services/ingest/src/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_url: str
    redis_url: str
    tcp_host: str = "0.0.0.0"
    tcp_port: int = 5027
    environment: str = "development"


settings = Settings()
