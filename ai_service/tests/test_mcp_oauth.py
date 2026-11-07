"""
OAuth pieces that are decided in our own code rather than by the SDK:
redirect-URI policy and the token/credential primitives.

The protocol mechanics (PKCE, code exchange, rotation) are covered end-to-end
against a real database; what is unit-tested here is the policy that stops a
client pointing an authorization at somewhere it should not go, and the
guarantee that stored credentials are hashed or encrypted.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.mcp.crypto import (  # noqa: E402
    ACCESS_TOKEN_PREFIX,
    TokenCipher,
    hash_token,
    new_token,
    tokens_equal,
)
from app.mcp.oauth_provider import is_acceptable_redirect_uri  # noqa: E402


# ── redirect-URI policy ──────────────────────────────────────────────────
@pytest.mark.parametrize(
    "uri",
    [
        "https://claude.ai/api/mcp/auth_callback",
        "https://cursor.com/cb",
        "http://127.0.0.1:33418/callback",   # desktop clients listen on loopback
        "http://localhost:6274/oauth/callback",
        "http://[::1]:8080/cb",
    ],
)
def test_https_and_loopback_are_accepted(uri):
    assert is_acceptable_redirect_uri(uri) is True


@pytest.mark.parametrize(
    "uri",
    [
        "http://evil.example.com/cb",        # plain http off-loopback
        "http://192.168.1.10/cb",            # LAN address is not loopback
        "ftp://example.com/cb",
        "cursor://anysphere.cursor-retrieval/oauth/callback",  # custom scheme
        "javascript:alert(1)",
        "",
        "not a url",
    ],
)
def test_everything_else_is_refused(uri):
    assert is_acceptable_redirect_uri(uri) is False


# ── token primitives ─────────────────────────────────────────────────────
def test_issued_tokens_are_prefixed_and_unguessable():
    token = new_token(ACCESS_TOKEN_PREFIX)
    assert token.startswith(ACCESS_TOKEN_PREFIX)
    # 32 random bytes, url-safe base64 -> well past the RFC 6749 128-bit floor.
    assert len(token) - len(ACCESS_TOKEN_PREFIX) >= 40
    assert new_token(ACCESS_TOKEN_PREFIX) != token


def test_hash_is_stable_and_does_not_reveal_the_token():
    token = new_token(ACCESS_TOKEN_PREFIX)
    digest = hash_token(token)
    assert digest == hash_token(token)
    assert token not in digest
    assert hash_token(new_token(ACCESS_TOKEN_PREFIX)) != digest


def test_tokens_equal_handles_missing_values():
    assert tokens_equal("abc", "abc") is True
    assert tokens_equal("abc", "abd") is False
    assert tokens_equal("", None) is True


# ── platform-credential encryption ───────────────────────────────────────
def test_cipher_round_trips_a_platform_token():
    cipher = TokenCipher("a-development-passphrase")
    ciphertext = cipher.encrypt("platform.jwt.value")
    assert ciphertext != "platform.jwt.value"
    assert "platform.jwt.value" not in ciphertext
    assert cipher.decrypt(ciphertext) == "platform.jwt.value"


def test_cipher_accepts_a_real_fernet_key():
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    cipher = TokenCipher(key)
    assert cipher.decrypt(cipher.encrypt("x")) == "x"


def test_cipher_refuses_to_start_without_a_key():
    """Storing platform credentials in clear is not an acceptable fallback."""
    with pytest.raises(ValueError):
        TokenCipher(None)
    with pytest.raises(ValueError):
        TokenCipher("")


def test_decrypting_with_the_wrong_key_returns_none_rather_than_raising():
    ciphertext = TokenCipher("key-one").encrypt("secret")
    assert TokenCipher("key-two").decrypt(ciphertext) is None


def test_empty_values_pass_through():
    cipher = TokenCipher("k")
    assert cipher.encrypt(None) is None
    assert cipher.decrypt(None) is None
