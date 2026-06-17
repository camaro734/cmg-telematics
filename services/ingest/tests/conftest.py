"""Configuración común de tests del ingest.

src.config.Settings() se instancia al importar src.server y exige db_url/redis_url.
En tests no hay .env, así que inyectamos valores dummy antes de cualquier import.
"""
import os

os.environ.setdefault("DB_URL", "postgresql://test/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
