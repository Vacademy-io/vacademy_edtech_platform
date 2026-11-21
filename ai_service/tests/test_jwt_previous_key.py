"""
Token verification with an optional second key (JWT_SECRET_KEY_PREVIOUS), the
same rule as common_service JwtService: the current key always verifies, the
previous key only when set, any other key never. No DB, no HTTP.
"""
import base64
import logging
import sys
import time
from pathlib import Path
from types import SimpleNamespace

from jose import jwt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import security  # noqa: E402

CURRENT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
PREVIOUS = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
OTHER = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"


def _settings(previous=""):
    return SimpleNamespace(jwt_secret_key=CURRENT, jwt_secret_key_previous=previous, jwt_algorithm="HS256")


def _token(key, user="u-1", expires_in=600):
    claims = {"sub": "someone@example.com", "user": user, "exp": int(time.time()) + expires_in}
    return jwt.encode(claims, base64.b64decode(key), algorithm="HS256")


def test_current_key_verifies():
    claims = security._decode_jwt_token(_token(CURRENT), _settings())
    assert claims["user"] == "u-1"


def test_previous_key_verifies_only_when_set(caplog):
    security._previous_key_logged_at.clear()
    token = _token(PREVIOUS, user="u-2")
    assert security._decode_jwt_token(token, _settings()) is None
    with caplog.at_level(logging.INFO, logger=security.logger.name):
        assert security._decode_jwt_token(token, _settings(PREVIOUS))["user"] == "u-2"
        assert security._decode_jwt_token(token, _settings(PREVIOUS))["user"] == "u-2"
    logged = [r for r in caplog.records if "JWT_SECRET_KEY_PREVIOUS" in r.getMessage()]
    assert len(logged) == 1  # once per user per hour
    assert "u-2" in logged[0].getMessage() and token not in logged[0].getMessage()


def test_other_key_is_rejected():
    token = _token(OTHER)
    assert security._decode_jwt_token(token, _settings()) is None
    assert security._decode_jwt_token(token, _settings(PREVIOUS)) is None


def test_expired_previous_key_token_is_rejected():
    assert security._decode_jwt_token(_token(PREVIOUS, expires_in=-60), _settings(PREVIOUS)) is None


def test_settings_without_previous_field_behave_as_before():
    legacy = SimpleNamespace(jwt_secret_key=CURRENT, jwt_algorithm="HS256")
    assert security._decode_jwt_token(_token(CURRENT), legacy)["user"] == "u-1"
    assert security._decode_jwt_token(_token(PREVIOUS), legacy) is None
