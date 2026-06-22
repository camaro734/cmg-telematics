import pytest
from app.services.routing import _decode_polyline6, valhalla_route, RouteResult


def _encode6(coords: list[tuple[float, float]]) -> str:
    """Encoder polyline precisión 6, solo para el test (round-trip del decoder)."""
    def _enc(delta: int) -> str:
        v = ~(delta << 1) if delta < 0 else (delta << 1)
        s = ""
        while v >= 0x20:
            s += chr((0x20 | (v & 0x1F)) + 63)
            v >>= 5
        return s + chr(v + 63)
    out, prev_lat, prev_lon = "", 0, 0
    for lat, lon in coords:
        ilat, ilon = round(lat * 1e6), round(lon * 1e6)
        out += _enc(ilat - prev_lat) + _enc(ilon - prev_lon)
        prev_lat, prev_lon = ilat, ilon
    return out


def test_decode_polyline6_roundtrip():
    coords = [(39.469000, -0.376000), (41.385000, 2.173000)]
    pts = _decode_polyline6(_encode6(coords))
    assert len(pts) == 2
    assert pts[0][0] == pytest.approx(39.469, abs=1e-5)
    assert pts[0][1] == pytest.approx(-0.376, abs=1e-5)
    assert pts[1][1] == pytest.approx(2.173, abs=1e-5)


@pytest.mark.asyncio
async def test_valhalla_route_parses_summary(monkeypatch):
    # Ruta de 3 puntos para ejercitar la decodificación multi-punto de la shape
    _three_point_shape = _encode6([(39.47, -0.38), (39.50, -0.40), (41.39, 2.17)])
    fake_json = {
        "trip": {
            "summary": {"length": 12.5, "time": 600},
            "legs": [{"shape": _three_point_shape}],
        }
    }

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return fake_json

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json): return _Resp()

    monkeypatch.setattr("app.services.routing.httpx.AsyncClient", lambda **kw: _Client())
    result = await valhalla_route((39.47, -0.38), (41.39, 2.17), valhalla_url="http://valhalla:8002")
    assert isinstance(result, RouteResult)
    assert result.distance_m == pytest.approx(12500.0)   # 12.5 km → m
    assert result.duration_s == 600
    assert len(result.geometry) == 3
    assert result.geometry[0][0] == pytest.approx(39.47, abs=1e-5)
    assert result.geometry[0][1] == pytest.approx(-0.38, abs=1e-5)
    assert result.geometry[2][0] == pytest.approx(41.39, abs=1e-5)
    assert result.geometry[2][1] == pytest.approx(2.17, abs=1e-5)
