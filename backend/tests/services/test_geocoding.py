import pytest
from app.services.geocoding import nominatim_search, GeoResult


@pytest.mark.asyncio
async def test_nominatim_search_parses_results(monkeypatch):
    fake_json = [
        {"display_name": "Valencia, España", "lat": "39.4699", "lon": "-0.3763"},
        {"display_name": "Valencia, Venezuela", "lat": "10.16", "lon": "-68.0"},
    ]

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return fake_json

    class _Client:
        def __init__(self):
            self.last_params = None

        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

        async def get(self, url, **kwargs):
            # Captura params independientemente de si se pasan como keyword o posicional
            self.last_params = kwargs.get("params", {})
            return _Resp()

    client = _Client()
    monkeypatch.setattr("app.services.geocoding.httpx.AsyncClient", lambda **kw: client)
    out = await nominatim_search("valencia", limit=3, nominatim_url="http://nominatim")
    assert len(out) == 2
    assert isinstance(out[0], GeoResult)
    assert out[0].label == "Valencia, España"
    assert out[0].lat == pytest.approx(39.4699)
    # Verifica que el código de producción reenvía q y limit correctamente
    assert client.last_params is not None, "get() no recibió params"
    assert client.last_params.get("q") == "valencia"
    assert client.last_params.get("limit") == 3
