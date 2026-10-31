"""
Vacademy as an OAuth 2.1 authorization server for the MCP endpoint.

The MCP client never sees a Vacademy platform credential. The flow is:

    client ──/authorize──▶ we park the request and bounce the browser to the
                           admin dashboard consent page
    admin  ──consent────▶ consent.py verifies the admin's platform session,
                           checks the institute's MCP settings, and mints an
                           authorization code bound to that admin + institute
    client ──/token─────▶ code (+ PKCE verifier) is exchanged for an opaque MCP
                           access token and a rotating refresh token

Everything the resource server later needs — the approving user, their institute
and their (encrypted) platform tokens — hangs off the token row, not off the
token string, which is random and stored only as a hash.

The SDK enforces PKCE, redirect-URI matching and resource binding around these
methods; what this class adds is persistence, single use, rotation, and refusing
redirect targets that are not HTTPS or loopback.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, List, Optional
from urllib.parse import urlencode, urlparse

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

from ..config import Settings
from ..db import db_session
from .institute_scope import admin_portal_base, institute_from_resource
from .crypto import (
    ACCESS_TOKEN_PREFIX,
    AUTH_CODE_PREFIX,
    REFRESH_TOKEN_PREFIX,
    TokenCipher,
    new_token,
)
from .repository import McpOAuthRepository

logger = logging.getLogger(__name__)


class VacademyAccessToken(AccessToken):
    """An issued MCP access token plus the context the tool layer needs."""

    user_id: str
    institute_id: str
    username: Optional[str] = None
    token_hash: str
    pair_id: str
    platform_access_token: Optional[str] = None
    platform_refresh_token: Optional[str] = None


class VacademyRefreshToken(RefreshToken):
    pair_id: str
    user_id: str
    institute_id: str


def is_acceptable_redirect_uri(uri: str) -> bool:
    """
    Redirect targets must be HTTPS, or HTTP on an explicit loopback address.

    Loopback matters: desktop MCP clients (Claude Desktop, Cursor, the Inspector)
    listen on 127.0.0.1 for the callback. "localhost" is accepted alongside the
    literal addresses because that is what those clients register in practice.
    Everything else — plain HTTP hosts, custom app schemes — is refused.
    """
    try:
        parsed = urlparse(uri)
    except ValueError:
        return False

    if parsed.scheme == "https":
        return bool(parsed.hostname)
    if parsed.scheme == "http":
        return parsed.hostname in ("127.0.0.1", "::1", "localhost")
    return False


class VacademyOAuthProvider(
    OAuthAuthorizationServerProvider[AuthorizationCode, VacademyRefreshToken, VacademyAccessToken]
):
    """Authorization server + token verifier backed by the MCP OAuth tables."""

    def __init__(self, settings: Settings, cipher: TokenCipher):
        self.settings = settings
        self.cipher = cipher

    # ── helpers ──────────────────────────────────────────────────────────
    def _repo(self, db) -> McpOAuthRepository:
        return McpOAuthRepository(db, self.cipher)

    @property
    def _consent_url_base(self) -> str:
        return f"{self.settings.admin_dashboard_url.rstrip('/')}/mcp/authorize"

    # ── client registration ──────────────────────────────────────────────
    async def get_client(self, client_id: str) -> Optional[OAuthClientInformationFull]:
        with db_session() as db:
            record = self._repo(db).get_client(client_id)
        if not record:
            return None
        return OAuthClientInformationFull(
            client_id=record["client_id"],
            client_name=record["client_name"],
            redirect_uris=[AnyUrl(u) for u in record["redirect_uris"]],
            grant_types=record["grant_types"] or ["authorization_code", "refresh_token"],
            token_endpoint_auth_method="none",
            scope=record["scope"],
        )

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        """Dynamic Client Registration (RFC 7591), public clients only."""
        uris = [str(u) for u in (client_info.redirect_uris or [])]
        if not uris:
            raise RegistrationError("invalid_redirect_uri", "At least one redirect_uri is required.")

        bad = [u for u in uris if not is_acceptable_redirect_uri(u)]
        if bad:
            raise RegistrationError(
                "invalid_redirect_uri",
                "redirect_uri must be https, or http on a loopback address.",
            )

        with db_session() as db:
            self._repo(db).save_client(
                client_id=client_info.client_id,
                client_name=client_info.client_name,
                redirect_uris=uris,
                grant_types=list(client_info.grant_types or []),
                scope=client_info.scope,
                client_metadata=client_info.model_dump(mode="json", exclude_none=True),
                source="dcr",
            )
        logger.info("MCP client registered via DCR: %s (%s)", client_info.client_id, client_info.client_name)

    # ── authorization ────────────────────────────────────────────────────
    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """
        Park the request and send the browser to the dashboard consent page.

        No identity is established here: the user may not even be logged in yet.
        The txn id is an opaque handle; the consent endpoint is what binds a
        verified admin to it.
        """
        redirect_uri = str(params.redirect_uri)
        if not is_acceptable_redirect_uri(redirect_uri):
            raise AuthorizeError("invalid_request", "Unsupported redirect_uri.")

        # A scoped server URL (…/mcp/i/<institute>) names the institute up front,
        # so the browser can go to THAT institute's own admin portal — its brand,
        # its session — instead of the platform dashboard with a picker.
        institute_id = institute_from_resource(params.resource, self.settings.mcp_issuer_url)

        with db_session() as db:
            txn = self._repo(db).create_txn(
                client_id=client.client_id,
                redirect_uri=redirect_uri,
                redirect_uri_provided=params.redirect_uri_provided_explicitly,
                code_challenge=params.code_challenge,
                state=params.state,
                scopes=list(params.scopes or []),
                resource=params.resource,
                ttl_seconds=self.settings.mcp_auth_txn_ttl_seconds,
            )
            portal = admin_portal_base(db, institute_id, self.settings.admin_dashboard_url) if institute_id else None

        base = f"{portal}/mcp/authorize" if portal else self._consent_url_base
        return f"{base}?{urlencode({'txn': txn})}"

    async def load_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: str,
    ) -> Optional[AuthorizationCode]:
        with db_session() as db:
            record = self._repo(db).get_code(authorization_code)

        if not record or record["client_id"] != client.client_id:
            return None
        if record["used_at"] is not None:
            logger.warning("MCP authorization code replayed for client %s", client.client_id)
            return None
        if record["expires_at"].timestamp() <= time.time():
            return None

        return AuthorizationCode(
            code=authorization_code,
            scopes=record["scopes"],
            expires_at=record["expires_at"].timestamp(),
            client_id=record["client_id"],
            code_challenge=record["code_challenge"] or "",
            redirect_uri=AnyUrl(record["redirect_uri"]),
            redirect_uri_provided_explicitly=True,
            resource=record["resource"],
            subject=record["user_id"],
        )

    async def exchange_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: AuthorizationCode,
    ) -> OAuthToken:
        with db_session() as db:
            repo = self._repo(db)
            record = repo.get_code(authorization_code.code)
            if not record or record["client_id"] != client.client_id:
                raise TokenError("invalid_grant", "Unknown authorization code.")

            # Single use: whoever wins this UPDATE gets the tokens.
            if not repo.consume_code(authorization_code.code):
                raise TokenError("invalid_grant", "Authorization code already used or expired.")

            return self._issue_pair(
                repo,
                client_id=client.client_id,
                user_id=record["user_id"],
                institute_id=record["institute_id"],
                username=record["username"],
                scopes=record["scopes"],
                resource=record["resource"],
                platform_access_token=record["platform_access_token"],
                platform_refresh_token=record["platform_refresh_token"],
            )

    # ── refresh ──────────────────────────────────────────────────────────
    async def load_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: str,
    ) -> Optional[VacademyRefreshToken]:
        with db_session() as db:
            record = self._repo(db).get_token(refresh_token, kind="refresh")

        if not record or record["client_id"] != client.client_id:
            return None
        if record["revoked_at"] is not None or record["expires_at"].timestamp() <= time.time():
            return None

        return VacademyRefreshToken(
            token=refresh_token,
            client_id=record["client_id"],
            scopes=record["scopes"],
            expires_at=int(record["expires_at"].timestamp()),
            resource=record["resource"],
            subject=record["user_id"],
            pair_id=record["pair_id"],
            user_id=record["user_id"],
            institute_id=record["institute_id"],
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: VacademyRefreshToken,
        scopes: List[str],
    ) -> OAuthToken:
        with db_session() as db:
            repo = self._repo(db)
            record = repo.get_token(refresh_token.token, kind="refresh")
            if not record or record["client_id"] != client.client_id:
                raise TokenError("invalid_grant", "Unknown refresh token.")

            # Rotate: burn the presented refresh token and the access token minted
            # with it, then issue a fresh pair.
            if not repo.consume_refresh_token(refresh_token.token):
                raise TokenError("invalid_grant", "Refresh token already used or expired.")
            repo.revoke_pair(record["pair_id"])

            requested = list(scopes or record["scopes"])
            if not set(requested).issubset(set(record["scopes"])):
                raise TokenError("invalid_scope", "Requested scopes exceed the original grant.")

            return self._issue_pair(
                repo,
                client_id=client.client_id,
                user_id=record["user_id"],
                institute_id=record["institute_id"],
                username=record["username"],
                scopes=requested,
                resource=record["resource"],
                platform_access_token=record["platform_access_token"],
                platform_refresh_token=record["platform_refresh_token"],
            )

    # ── token verification ───────────────────────────────────────────────
    async def load_access_token(self, token: str) -> Optional[VacademyAccessToken]:
        with db_session() as db:
            repo = self._repo(db)
            record = repo.get_token(token, kind="access")
            if not record:
                return None
            if record["revoked_at"] is not None or record["expires_at"].timestamp() <= time.time():
                return None
            repo.touch_token(record["token_hash"])

        return VacademyAccessToken(
            token=token,
            client_id=record["client_id"],
            scopes=record["scopes"],
            expires_at=int(record["expires_at"].timestamp()),
            resource=record["resource"],
            subject=record["user_id"],
            user_id=record["user_id"],
            institute_id=record["institute_id"],
            username=record["username"],
            token_hash=record["token_hash"],
            pair_id=record["pair_id"],
            platform_access_token=record["platform_access_token"],
            platform_refresh_token=record["platform_refresh_token"],
        )

    async def verify_token(self, token: str) -> Optional[AccessToken]:
        """TokenVerifier protocol — the resource-server side of the same store."""
        return await self.load_access_token(token)

    async def revoke_token(self, token: Any) -> None:
        pair_id = getattr(token, "pair_id", None)
        if not pair_id:
            return
        with db_session() as db:
            self._repo(db).revoke_pair(pair_id)

    # ── issuance ─────────────────────────────────────────────────────────
    def _issue_pair(
        self,
        repo: McpOAuthRepository,
        *,
        client_id: str,
        user_id: str,
        institute_id: str,
        username: Optional[str],
        scopes: List[str],
        resource: Optional[str],
        platform_access_token: Optional[str],
        platform_refresh_token: Optional[str],
    ) -> OAuthToken:
        pair_id = uuid.uuid4().hex
        access = new_token(ACCESS_TOKEN_PREFIX)
        refresh = new_token(REFRESH_TOKEN_PREFIX)

        common = dict(
            pair_id=pair_id,
            client_id=client_id,
            user_id=user_id,
            institute_id=institute_id,
            username=username,
            scopes=scopes,
            resource=resource,
            platform_access_token=platform_access_token,
            platform_refresh_token=platform_refresh_token,
        )
        repo.store_token(
            token=access, kind="access",
            ttl_seconds=self.settings.mcp_access_token_ttl_seconds, **common,
        )
        repo.store_token(
            token=refresh, kind="refresh",
            ttl_seconds=self.settings.mcp_refresh_token_ttl_seconds, **common,
        )

        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=self.settings.mcp_access_token_ttl_seconds,
            scope=" ".join(scopes),
            refresh_token=refresh,
        )


def new_authorization_code() -> str:
    """Used by the consent endpoint when an admin approves a pending request."""
    return new_token(AUTH_CODE_PREFIX)


__all__ = [
    "VacademyOAuthProvider",
    "VacademyAccessToken",
    "VacademyRefreshToken",
    "is_acceptable_redirect_uri",
    "new_authorization_code",
]
