# services/ingest/src/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_url: str
    redis_url: str
    tcp_host: str = "0.0.0.0"
    tcp_port: int = 5027
    environment: str = "development"
    core_api_url: str = "http://core-api:8010"
    internal_api_key: str = ""


settings = Settings()
