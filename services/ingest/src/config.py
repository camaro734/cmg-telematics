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
    stream_maxlen: int = 100_000
    # Cierra una conexión TCP que lleve este nº de segundos sin enviar un solo byte.
    # Detecta sockets medio-abiertos (pérdida de señal/corriente) para que corra el
    # cleanup que marca el dispositivo offline. El FMC650 reconecta en su próximo batch
    # (buffer offline → sin pérdida de datos). 600 s es muy superior al intervalo de
    # reporte con ignición ON (~30 s), así que no afecta a conexiones sanas.
    idle_timeout_s: int = 600


settings = Settings()
