# tests/ingest/conftest.py
import pytest
import asyncio


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# Silencia el warning de pytest-asyncio >=0.23 sobre event_loop_policy
# La fixture event_loop de session-scope está en uso hasta migrar a
# pytest.mark.asyncio(loop_scope="session") cuando se requiera.
