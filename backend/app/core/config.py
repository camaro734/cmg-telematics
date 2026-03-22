from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import json


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="/opt/cmg-telematics/.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENVIRONMENT: str = "pilot"

    # Database
    DATABASE_URL: str
    POSTGRES_USER: str = "cmg"
    POSTGRES_PASSWORD: str = "cmg_pilot_2024"
    POSTGRES_DB: str = "cmg_telematics"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/2"

    # TCP Server (Teltonika)
    TCP_HOST: str = "0.0.0.0"
    TCP_PORT: int = 5027

    # FastAPI
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8010

    # MQTT
    MQTT_HOST: str = "localhost"
    MQTT_PORT: int = 1883

    # CORS
    FRONTEND_URL: str = "http://213.210.20.183"
    CORS_ORIGINS: List[str] = ["*"]

    # Email SMTP (optional — leave empty to disable)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "alertas@cmg-telematics.es"
    SMTP_TLS: bool = True

    # Web Push VAPID (optional — leave empty to disable)
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@cmg.es"


settings = Settings()
