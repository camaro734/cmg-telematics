import hashlib
from app.core.reset_token import generate_reset_token, reset_key_for


def test_generate_reset_token_devuelve_token_y_clave_hasheada():
    token, key = generate_reset_token()
    assert isinstance(token, str) and len(token) >= 32
    # La clave es el hash sha256 del token, nunca el token en claro
    expected = "pwreset:" + hashlib.sha256(token.encode()).hexdigest()
    assert key == expected
    assert token not in key


def test_reset_key_for_es_deterministico():
    token, key = generate_reset_token()
    assert reset_key_for(token) == key
