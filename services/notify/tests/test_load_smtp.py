"""_load_smtp_from_db debe parsear el JSONB de system_settings.

asyncpg devuelve las columnas JSONB como str (a diferencia de SQLAlchemy en
core-api, que las da como dict). Si no se parsea, `.get()` falla sobre el str y
la config SMTP de la BD se pierde, cayendo al fallback de entorno (vacío → stub).
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

import src.dispatcher as disp


@pytest.mark.asyncio
async def test_load_smtp_parsea_jsonb_string():
    # Reset del cache para forzar recarga
    disp._smtp_cache = None
    disp._smtp_cache_ts = 0.0

    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={
        "value": '{"host":"smtp.hostinger.com","port":465,"user":"u@x.com",'
                 '"password":"secret","from_addr":"team@x.com"}'
    })

    cfg = await disp._load_smtp_from_db(pool)

    assert cfg["host"] == "smtp.hostinger.com"
    assert cfg["port"] == 465
    assert cfg["from_addr"] == "team@x.com"


@pytest.mark.asyncio
async def test_load_smtp_acepta_dict_directo():
    # Si algún día el value llega ya como dict, también debe funcionar
    disp._smtp_cache = None
    disp._smtp_cache_ts = 0.0

    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={
        "value": {"host": "smtp.hostinger.com", "port": 465}
    })

    cfg = await disp._load_smtp_from_db(pool)
    assert cfg["host"] == "smtp.hostinger.com"
