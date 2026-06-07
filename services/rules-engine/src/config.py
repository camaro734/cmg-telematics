from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    db_url: str
    redis_url: str
    environment: str = "development"
    # Umbral de silencio adaptativo por ignición
    silence_moving_hours: float = 2.0   # vehículo trabajando (ignición ON)
    silence_parked_hours: float = 72.0  # vehículo parado / deep-sleep


settings = Settings()
