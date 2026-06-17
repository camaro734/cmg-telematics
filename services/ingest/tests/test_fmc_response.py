from src.codec8 import is_fmc_error_response


def test_warning_is_error():
    assert is_fmc_error_response("WARNING: Not supported Param ID or Value detected") is True


def test_new_value_ack_is_ok():
    assert is_fmc_error_response("New value 16002:00FFFFFFFFFFFFFF;") is False


def test_empty_is_ok():
    assert is_fmc_error_response("") is False


def test_none_is_ok():
    assert is_fmc_error_response(None) is False
