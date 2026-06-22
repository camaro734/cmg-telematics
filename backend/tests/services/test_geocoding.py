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
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params, headers): return _Resp()

    monkeypatch.setattr("app.services.geocoding.httpx.AsyncClient", lambda **kw: _Client())
    out = await nominatim_search("valencia", nominatim_url="http://nominatim")
    assert len(out) == 2
    assert isinstance(out[0], GeoResult)
    assert out[0].label == "Valencia, España"
    assert out[0].lat == pytest.approx(39.4699)
