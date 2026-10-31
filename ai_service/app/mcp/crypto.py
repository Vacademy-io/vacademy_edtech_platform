"""
Token hashing + at-rest encryption for the MCP OAuth store.

Two different primitives, for two different jobs:

* MCP access/refresh tokens we ISSUE are stored as SHA-256 hashes. We only ever
  need to look one up by its value, never to read it back, so a stolen DB dump
  yields nothing usable.
* The caller's PLATFORM tokens (the Vacademy JWT + refresh token) must be
  replayed to admin-core on every tool call, so they have to be recoverable.
  Those are Fernet-encrypted with ``MCP_TOKEN_ENCRYPTION_KEY``.

If no encryption key is configured the service refuses to start the MCP server
(see app_factory) rather than silently persisting platform credentials in clear.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

#: Prefixes make a leaked string identifiable at a glance (and greppable in logs
#: if one ever escapes, which it must not).
ACCESS_TOKEN_PREFIX = "vcm_at_"
REFRESH_TOKEN_PREFIX = "vcm_rt_"
AUTH_CODE_PREFIX = "vcm_ac_"


def new_token(prefix: str) -> str:
    """A 256-bit URL-safe secret. Well past the 128-bit floor RFC 6749 sets."""
    return f"{prefix}{secrets.token_urlsafe(32)}"


def hash_token(token: str) -> str:
    """Stable lookup key for an issued token. Not reversible."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    """Constant-time comparison for secrets compared outside the DB."""
    return hmac.compare_digest(a or "", b or "")


class TokenCipher:
    """Fernet wrapper that fails loudly on a bad key and quietly on bad data."""

    def __init__(self, key: Optional[str]):
        if not key:
            raise ValueError(
                "MCP_TOKEN_ENCRYPTION_KEY is not set — refusing to store platform "
                "credentials unencrypted."
            )
        self._fernet = Fernet(self._coerce_key(key))

    @staticmethod
    def _coerce_key(key: str) -> bytes:
        """
        Accept either a real Fernet key (32 url-safe base64 bytes) or an
        arbitrary passphrase, which we stretch to a valid key. The passphrase
        path keeps ops simple; a generated Fernet key remains the better choice.
        """
        raw = key.strip().encode("utf-8")
        try:
            Fernet(raw)
            return raw
        except (ValueError, TypeError):
            digest = hashlib.sha256(raw).digest()
            return base64.urlsafe_b64encode(digest)

    def encrypt(self, plaintext: Optional[str]) -> Optional[str]:
        if not plaintext:
            return None
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, ciphertext: Optional[str]) -> Optional[str]:
        if not ciphertext:
            return None
        try:
            return self._fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError, TypeError):
            # Key rotated, or a corrupt row. Treat as "no credential" — the
            # caller then fails the request and the client re-authorizes.
            logger.warning("MCP token decryption failed (key rotated or corrupt row).")
            return None


__all__ = [
    "ACCESS_TOKEN_PREFIX",
    "REFRESH_TOKEN_PREFIX",
    "AUTH_CODE_PREFIX",
    "new_token",
    "hash_token",
    "tokens_equal",
    "TokenCipher",
]
