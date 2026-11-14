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

With the lanes running (app/mcp/lanes.py) the database work of these methods runs on the
OAuth lane. When it cannot run or finish, the answer says the server is busy and says
nothing about the client, code or token: see ``OAuthBusy``.

A code exchange or a token rotation is one transaction, committed as its session closes.
If it does not commit, the code or refresh token is still good and the request can be repeated.
"""
from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar
from types import SimpleNamespace
from typing import Any, Callable, List, Optional, Tuple, TypeVar, Union
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
from mcp.server.auth.routes import AUTHORIZATION_PATH
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl
from sqlalchemy.exc import DataError, InterfaceError, OperationalError, PendingRollbackError, SQLAlchemyError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse

from ..config import Settings, get_settings
from ..db import db_session, mcp_db_session
from . import lanes
from .constants import busy_retry_after_s
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

T = TypeVar("T")

#: last_used_at only feeds the connections listing, so one write a minute is enough.
TOKEN_TOUCH_EVERY_S = 60

#: This request's (token, result) when the edge already checked it off the main loop.
#: A result of None is an answer too: that token is not valid.
verified_token: ContextVar[Optional[Tuple[str, Optional["VacademyAccessToken"]]]] = ContextVar(
    "mcp_verified_token", default=None
)


#: On an /authorize request, whether its client lookup found the server busy.
_authorize_request: ContextVar[Optional[SimpleNamespace]] = ContextVar("mcp_authorize_request", default=None)

OAUTH_BUSY_ERROR = "temporarily_unavailable"
OAUTH_BUSY_MESSAGE = "Vacademy is busy right now. Do not reconnect. Retry in about {n} seconds."
OAUTH_BAD_VALUE_MESSAGE = "A value in this request is too long or not allowed."

#: Connection, timeout, lock and deadlock errors: the same request can work later.
_BUSY_DB_ERRORS = (OperationalError, InterfaceError, PoolTimeoutError)
#: What the next statement in a session reports after a lookup with a fallback absorbed one of those.
_ABSORBED_BUSY_ERROR = PendingRollbackError
_ABSORBED_BUSY_SQLSTATE = "25P02"
#: A database answering read-only: the same request can work later.
_READ_ONLY_SQLSTATE = "25006"
#: The database refused a value from the request: the same request cannot work later.
_REFUSED_VALUE_ERRORS = (DataError, ValueError)


def _is_busy_db_error(exc: SQLAlchemyError) -> bool:
    if isinstance(exc, (*_BUSY_DB_ERRORS, _ABSORBED_BUSY_ERROR)) or getattr(exc, "connection_invalidated", False):
        return True
    return getattr(getattr(exc, "orig", None), "sqlstate", None) in (_ABSORBED_BUSY_SQLSTATE, _READ_ONLY_SQLSTATE)


class OAuthBusy(Exception):
    """The database work could not run or finish just now. Says nothing about the client, code or token."""


async def run_oauth_db(body: Callable[[], T], total_s: Optional[float] = None) -> T:
    """``body()`` on the OAuth lane. Raises OAuthBusy when the lane or the database cannot answer."""
    async def call() -> T:
        return body()

    try:
        return await lanes.oauth_lane().run(call, total_s=total_s)
    except lanes.LaneBusy as exc:
        _note_busy()
        raise OAuthBusy() from exc
    except SQLAlchemyError as exc:
        if not _is_busy_db_error(exc):
            raise
        logger.warning("MCP OAuth database work failed: %s", type(exc).__name__)
        _note_busy()
        raise OAuthBusy() from exc


def _note_busy() -> None:
    from . import admission

    admission.instance().note_oauth_refusal()


async def _busy_response(request: Request, exc: Exception) -> JSONResponse:
    retry_after_s = busy_retry_after_s()
    return JSONResponse(
        {
            "error": OAUTH_BUSY_ERROR,
            "error_description": OAUTH_BUSY_MESSAGE.format(n=retry_after_s),
            "retry_after_s": retry_after_s,
        },
        status_code=503,
        headers={"Retry-After": str(retry_after_s), "Cache-Control": "no-store", "Pragma": "no-cache"},
    )


class _AuthorizeRequest:
    """
    Gives each /authorize request its own record of a busy client lookup. The SDK's handler
    turns any exception into a redirect after looking the client up again, so the second
    lookup repeats the first one's answer and the request ends as a 503.
    """

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        reset = _authorize_request.set(SimpleNamespace(client_lookup_busy=False))
        try:
            await self.app(scope, receive, send)
        finally:
            _authorize_request.reset(reset)


class _HideBusyTraceback(logging.Filter):
    """The SDK logs what its /authorize handler caught. A busy answer is counted in the stats line instead."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not (record.exc_info and isinstance(record.exc_info[1], OAuthBusy))


logging.getLogger("mcp.server.auth.handlers.authorize").addFilter(_HideBusyTraceback())


def answer_oauth_busy(app: Starlette) -> Starlette:
    """OAuthBusy from a provider method becomes HTTP 503 with Retry-After, inside each route's CORS."""
    app.add_exception_handler(OAuthBusy, _busy_response)
    for route in app.routes:
        if getattr(route, "path", None) == AUTHORIZATION_PATH:
            route.app = _AuthorizeRequest(route.app)
    return app


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


def check_access_token_sync(
    token: str, cipher: TokenCipher, session_factory: Callable[[], Any]
) -> Optional[VacademyAccessToken]:
    """The stored token if it is live, else None. Raises when the database could not answer."""
    with session_factory() as db:
        repo = McpOAuthRepository(db, cipher)
        record = repo.get_token(token, kind="access")
        if not record:
            return None
        if record["revoked_at"] is not None or record["expires_at"].timestamp() <= time.time():
            return None
        last_used_at = record["last_used_at"]
        if last_used_at is None or time.time() - last_used_at.timestamp() >= TOKEN_TOUCH_EVERY_S:
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


async def check_access_token_off_loop(token: str) -> Optional[VacademyAccessToken]:
    """The same check on the verify lane. Raises lanes.LaneBusy when the lane cannot answer in time."""
    async def check() -> Optional[VacademyAccessToken]:
        cipher = TokenCipher(get_settings().resolve_mcp_encryption_key())
        return check_access_token_sync(token, cipher, mcp_db_session)

    return await lanes.verify_lane().run(check, total_s=lanes.VERIFY_WAIT_S)


def _token_or_raise(outcome: Union[OAuthToken, TokenError]) -> OAuthToken:
    """TokenError is a frozen dataclass and cannot leave a contextmanager's with block, so it is raised here."""
    if isinstance(outcome, TokenError):
        raise outcome
    return outcome


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
        self._registering = 0

    # ── helpers ──────────────────────────────────────────────────────────
    def _repo(self, db) -> McpOAuthRepository:
        return McpOAuthRepository(db, self.cipher)

    async def _db_work(self, body: Callable[[Callable[[], Any]], T], total_s: Optional[float] = None) -> T:
        """``body(session_factory)`` on the OAuth lane when the lanes run, otherwise right here."""
        if not lanes.active():
            return body(db_session)
        return await run_oauth_db(lambda: body(mcp_db_session), total_s)

    @property
    def _consent_url_base(self) -> str:
        return f"{self.settings.admin_dashboard_url.rstrip('/')}/mcp/authorize"

    # ── client registration ──────────────────────────────────────────────
    async def get_client(self, client_id: str) -> Optional[OAuthClientInformationFull]:
        request = _authorize_request.get()
        if request is not None and request.client_lookup_busy:
            raise OAuthBusy()

        def read(session_factory) -> Optional[OAuthClientInformationFull]:
            try:
                with session_factory() as db:
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
            except (*_REFUSED_VALUE_ERRORS, TypeError) as exc:
                # The id cannot be looked up, or the stored client cannot be used: the same as no client.
                logger.warning("MCP client lookup found no usable client: %s", type(exc).__name__)
                return None

        try:
            return await self._db_work(read, total_s=lanes.OAUTH_READ_LIMIT_S)
        except OAuthBusy:
            if request is not None:
                request.client_lookup_busy = True
            raise

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

        def save(session_factory) -> None:
            with session_factory() as db:
                self._repo(db).save_client(
                    client_id=client_info.client_id,
                    client_name=client_info.client_name,
                    redirect_uris=uris,
                    grant_types=list(client_info.grant_types or []),
                    scope=client_info.scope,
                    client_metadata=client_info.model_dump(mode="json", exclude_none=True),
                    source="dcr",
                )

        if lanes.active() and self._registering >= lanes.OAUTH_REGISTER_LIMIT:
            _note_busy()
            raise OAuthBusy()
        self._registering += 1
        try:
            await self._db_work(save)
        except _REFUSED_VALUE_ERRORS as exc:
            raise RegistrationError("invalid_client_metadata", OAUTH_BAD_VALUE_MESSAGE) from exc
        finally:
            self._registering -= 1
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

        def park(session_factory) -> Tuple[str, Optional[str]]:
            with session_factory() as db:
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
                portal = (
                    admin_portal_base(db, institute_id, self.settings.admin_dashboard_url) if institute_id else None
                )
            return txn, portal

        try:
            txn, portal = await self._db_work(park)
        except OAuthBusy as exc:
            # The client and its redirect are verified by now, so the browser goes back with
            # the code RFC 6749 section 4.1.2.1 has for this, which a redirect can carry.
            retry_after_s = busy_retry_after_s()
            raise AuthorizeError(OAUTH_BUSY_ERROR, OAUTH_BUSY_MESSAGE.format(n=retry_after_s)) from exc
        except _REFUSED_VALUE_ERRORS as exc:
            raise AuthorizeError("invalid_request", OAUTH_BAD_VALUE_MESSAGE) from exc

        base = f"{portal}/mcp/authorize" if portal else self._consent_url_base
        return f"{base}?{urlencode({'txn': txn})}"

    async def load_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: str,
    ) -> Optional[AuthorizationCode]:
        def read(session_factory) -> Optional[dict]:
            with session_factory() as db:
                return self._repo(db).get_code(authorization_code)

        record = await self._db_work(read, total_s=lanes.OAUTH_READ_LIMIT_S)

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
        def exchange(session_factory) -> Union[OAuthToken, TokenError]:
            with session_factory() as db:
                repo = self._repo(db)
                record = repo.get_code(authorization_code.code)
                if not record or record["client_id"] != client.client_id:
                    return TokenError("invalid_grant", "Unknown authorization code.")

                # Single use: whoever wins this UPDATE gets the tokens.
                if not repo.consume_code(authorization_code.code, commit=False):
                    return TokenError("invalid_grant", "Authorization code already used or expired.")

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

        return _token_or_raise(await self._db_work(exchange))

    # ── refresh ──────────────────────────────────────────────────────────
    async def load_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: str,
    ) -> Optional[VacademyRefreshToken]:
        def read(session_factory) -> Optional[dict]:
            with session_factory() as db:
                return self._repo(db).get_token(refresh_token, kind="refresh")

        record = await self._db_work(read, total_s=lanes.OAUTH_READ_LIMIT_S)

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
        def rotate(session_factory) -> Union[OAuthToken, TokenError]:
            with session_factory() as db:
                repo = self._repo(db)
                record = repo.get_token(refresh_token.token, kind="refresh")
                if not record or record["client_id"] != client.client_id:
                    return TokenError("invalid_grant", "Unknown refresh token.")

                requested = list(scopes or record["scopes"])
                if not set(requested).issubset(set(record["scopes"])):
                    return TokenError("invalid_scope", "Requested scopes exceed the original grant.")

                # Rotate: burn the presented refresh token and the access token minted
                # with it, then issue a fresh pair under the same pair id. A revoke of this
                # pair waits for this transaction and then reaches the new tokens as well.
                repo.lock_pair(record["pair_id"])
                if not repo.consume_refresh_token(refresh_token.token, commit=False):
                    return TokenError("invalid_grant", "Refresh token already used or expired.")
                repo.revoke_locked_pair(record["pair_id"])

                return self._issue_pair(
                    repo,
                    pair_id=record["pair_id"],
                    client_id=client.client_id,
                    user_id=record["user_id"],
                    institute_id=record["institute_id"],
                    username=record["username"],
                    scopes=requested,
                    resource=record["resource"],
                    platform_access_token=record["platform_access_token"],
                    platform_refresh_token=record["platform_refresh_token"],
                )

        return _token_or_raise(await self._db_work(rotate))

    # ── token verification ───────────────────────────────────────────────
    async def load_access_token(self, token: str) -> Optional[VacademyAccessToken]:
        return await self._db_work(
            lambda session_factory: check_access_token_sync(token, self.cipher, session_factory),
            total_s=lanes.OAUTH_READ_LIMIT_S,
        )

    async def verify_token(self, token: str) -> Optional[AccessToken]:
        """TokenVerifier protocol — the resource-server side of the same store."""
        checked = verified_token.get()
        if checked is not None and checked[0] == token:
            return checked[1]
        if lanes.active():
            return await check_access_token_off_loop(token)
        return await self.load_access_token(token)

    async def revoke_token(self, token: Any) -> None:
        pair_id = getattr(token, "pair_id", None)
        if not pair_id:
            return
        def revoke(session_factory) -> None:
            with session_factory() as db:
                self._repo(db).revoke_pair(pair_id)

        await self._db_work(revoke)

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
        pair_id: Optional[str] = None,
    ) -> OAuthToken:
        """Stores both tokens in the session's open transaction. The caller's session commits them."""
        pair_id = pair_id or uuid.uuid4().hex
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
            ttl_seconds=self.settings.mcp_access_token_ttl_seconds, commit=False, **common,
        )
        repo.store_token(
            token=refresh, kind="refresh",
            ttl_seconds=self.settings.mcp_refresh_token_ttl_seconds, commit=False, **common,
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
    "OAuthBusy",
    "answer_oauth_busy",
    "run_oauth_db",
    "VacademyOAuthProvider",
    "VacademyAccessToken",
    "VacademyRefreshToken",
    "is_acceptable_redirect_uri",
    "new_authorization_code",
]
