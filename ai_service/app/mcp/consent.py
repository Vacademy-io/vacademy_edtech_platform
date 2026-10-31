"""
HTTP endpoints the admin dashboard uses to drive the MCP server.

Two groups:

* **Consent** — the OAuth authorization step. ``/authorize`` parked a request;
  the dashboard shows the user what is being asked for and calls ``/consent``
  with their own platform session. That call is the ONLY place a Vacademy
  identity is bound to an MCP grant, and it is gated on the institute's MCP
  settings (enabled + role allow-list, learners never).

* **Connection info** — what the settings page needs to render: the server URL,
  the tool catalogue, manually-issued OAuth client ids (for LLM apps that cannot
  self-register), and the live connections an admin can revoke.

Every endpoint here authenticates with the normal platform contract
(``Authorization: Bearer <JWT>`` + ``clientId``), so it inherits the same trust
boundary as the rest of the admin surface.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..core.security import _extract_bearer, get_pinned_principal
from ..db import db_dependency
from ..schemas.auth import PinnedPrincipal
from .access import check_mcp_access, load_mcp_setting, normalize_role
from .adapter import tool_catalog
from .constants import (
    AUTO_CLIENT_ID_PREFIX,
    AUTO_CLIENT_NAME,
    AUTO_CLIENT_REDIRECT_URIS,
    DENIAL_MESSAGES,
    MCP_SCOPE_READ,
    is_auto_client,
)
from .crypto import TokenCipher
from .institute_scope import admin_portal_base, institute_from_resource, institute_name, scoped_server_url
from .oauth_provider import is_acceptable_redirect_uri, new_authorization_code
from .repository import McpOAuthRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-service/mcp/oauth", tags=["mcp"])


def _repo(db: Session, settings: Settings) -> McpOAuthRepository:
    return McpOAuthRepository(db, TokenCipher(settings.resolve_mcp_encryption_key()))


def _require_institute_admin(principal: PinnedPrincipal) -> None:
    """
    Gate for MANAGING the MCP server (client ids, revoking connections).

    Deliberately NOT ``check_mcp_access``: that answers "may this user connect an
    AI client", which is a different question. An admin must still be able to
    administer the server while it is switched off, or while the allow-list
    names only other roles.
    """
    # No root bypass: is_root_user is set for ordinary users and carries no
    # membership of this institute (see access.check_mcp_access).
    roles = {normalize_role(r) for r in (principal.roles or [])}
    if "ADMIN" in roles:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"reason": "not_admin", "message": "Only institute admins can manage the MCP server."},
    )


def _require_can_connect(principal: PinnedPrincipal, db: Session) -> Dict[str, Any]:
    """Gate for GRANTING an AI client access: the institute + role allow-list."""
    setting = load_mcp_setting(db, principal.institute_id)
    denial = check_mcp_access(principal, setting)
    if denial:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"reason": denial, "message": DENIAL_MESSAGES.get(denial, "Access denied.")},
        )
    return setting


def _ensure_auto_client(repo: McpOAuthRepository, principal: PinnedPrincipal, db: Session) -> None:
    """
    Give every institute an OAuth client id without anyone filling in a form.

    Asking an admin to invent an "app name" and look up a redirect URL was
    friction for no benefit: the name is always the same, and the callbacks are
    fixed by whichever AI app is connecting, not by the institute. So the first
    time the settings page is opened we mint one client seeded with the
    callbacks of the apps we know about, and simply show the id.

    Idempotent, and deliberately additive-only: it never rewrites an existing
    client's redirect URIs, so an admin who added their own is left alone.

    This is the institute's PRIMARY client: it is the one the settings page
    shows front and centre, and it cannot be removed (see
    ``delete_manual_client``), so an institute always has a working id.
    """
    if any(is_auto_client(c["client_id"]) for c in repo.list_manual_clients(principal.institute_id)):
        return

    repo.save_client(
        client_id=f"{AUTO_CLIENT_ID_PREFIX}{uuid.uuid4().hex}",
        # White-label: the AI app shows this name ("<name> wants access"), so it
        # is the institute's, not ours.
        client_name=institute_name(db, principal.institute_id) or AUTO_CLIENT_NAME,
        redirect_uris=list(AUTO_CLIENT_REDIRECT_URIS),
        grant_types=["authorization_code", "refresh_token"],
        scope=MCP_SCOPE_READ,
        institute_id=principal.institute_id,
        created_by=principal.user_id,
        source="manual",
    )
    logger.info("Auto-provisioned MCP OAuth client for institute %s", principal.institute_id)


# ── consent ──────────────────────────────────────────────────────────────
class ConsentRequest(BaseModel):
    txn: str
    approve: bool
    # The dashboard holds the user's refresh token in a cookie. Passing it here
    # lets a long-lived MCP connection outlive the 30-day access token without
    # the user re-authorizing. Optional: the grant still works without it, it
    # just ends when the access token expires.
    refresh_token: Optional[str] = None


class ConsentResponse(BaseModel):
    redirect_to: str


class TxnResponse(BaseModel):
    txn: str
    client_id: str
    client_name: Optional[str] = None
    redirect_host: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    expires_at: Optional[str] = None
    #: Set when the AI app connected to an institute-scoped server URL
    #: (…/mcp/i/<id>): the consent page then shows this institute instead of a
    #: picker, and only a member of it may approve.
    institute_id: Optional[str] = None
    institute_name: Optional[str] = None


@router.get(
    "/txn/{txn}",
    response_model=TxnResponse,
    summary="Describe a pending MCP authorization request",
)
async def get_txn(
    txn: str,
    db: Session = Depends(db_dependency),
    settings: Settings = Depends(get_settings),
) -> TxnResponse:
    """
    Public on purpose: the consent page must render before the user logs in.

    It discloses only what the consent screen has to show — which client is
    asking and for what — and nothing about any Vacademy user or institute.
    """
    record = _repo(db, settings).get_txn(txn)
    if not record or record["consumed_at"] is not None:
        raise HTTPException(status_code=404, detail="This authorization request is no longer valid.")

    client = _repo(db, settings).get_client(record["client_id"])
    try:
        redirect_host = urlparse(record["redirect_uri"]).hostname
    except ValueError:
        redirect_host = None

    institute_id = institute_from_resource(record.get("resource"), settings.mcp_issuer_url)
    return TxnResponse(
        txn=record["txn"],
        client_id=record["client_id"],
        client_name=(client or {}).get("client_name"),
        redirect_host=redirect_host,
        scopes=record["scopes"] or [MCP_SCOPE_READ],
        expires_at=record["expires_at"].isoformat() if record["expires_at"] else None,
        institute_id=institute_id,
        institute_name=institute_name(db, institute_id) if institute_id else None,
    )


@router.post(
    "/consent",
    response_model=ConsentResponse,
    summary="Approve or deny a pending MCP authorization request",
)
async def consent(
    request: Request,
    payload: ConsentRequest,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    db: Session = Depends(db_dependency),
    settings: Settings = Depends(get_settings),
) -> ConsentResponse:
    """
    Bind the authenticated admin (and the institute they pinned) to a pending
    request, and hand back the URL the browser should be sent to.

    The platform tokens captured here are what every later tool call replays, so
    the connection can never do more than this user could do themselves.
    """
    repo = _repo(db, settings)
    record = repo.get_txn(payload.txn)
    if not record or record["consumed_at"] is not None:
        raise HTTPException(status_code=404, detail="This authorization request is no longer valid.")

    state_qs = {"state": record["state"]} if record["state"] else {}

    if not payload.approve:
        repo.consume_txn(payload.txn)
        return ConsentResponse(
            redirect_to=f"{record['redirect_uri']}?{urlencode({'error': 'access_denied', **state_qs})}"
        )

    # A scoped server URL fixes the institute at /authorize time; the user must
    # be approving AS that institute (the dashboard sends it as clientId).
    pinned = institute_from_resource(record.get("resource"), settings.mcp_issuer_url)
    if pinned and pinned != principal.institute_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "reason": "institute_mismatch",
                "message": "This connection is for a different institute. Sign in to that institute's portal to approve it.",
                "institute_id": pinned,
            },
        )

    # Gate the institute + role BEFORE issuing anything.
    _require_can_connect(principal, db)

    if not repo.consume_txn(payload.txn):
        raise HTTPException(status_code=409, detail="This authorization request was already handled.")

    # The platform access token is the very one this request authenticated with —
    # already verified by get_pinned_principal above.
    platform_access_token = _extract_bearer(request.headers.get("authorization"))
    code = new_authorization_code()
    repo.create_code(
        code=code,
        client_id=record["client_id"],
        user_id=principal.user_id,
        institute_id=principal.institute_id,
        username=principal.username,
        redirect_uri=record["redirect_uri"],
        code_challenge=record["code_challenge"],
        scopes=record["scopes"] or [MCP_SCOPE_READ],
        resource=record["resource"],
        platform_access_token=platform_access_token,
        platform_refresh_token=payload.refresh_token,
        ttl_seconds=settings.mcp_auth_code_ttl_seconds,
    )

    logger.info(
        "MCP authorization granted: user=%s institute=%s client=%s",
        principal.user_id, principal.institute_id, record["client_id"],
    )
    return ConsentResponse(
        redirect_to=f"{record['redirect_uri']}?{urlencode({'code': code, **state_qs})}"
    )


# ── settings support ─────────────────────────────────────────────────────
class ManualClientRequest(BaseModel):
    client_name: str = Field(min_length=1, max_length=120)
    redirect_uris: List[str] = Field(min_length=1, max_length=5)


class ManualClientResponse(BaseModel):
    client_id: str
    client_name: Optional[str] = None
    redirect_uris: List[str]
    created_at: Optional[str] = None
    #: True for the auto-provisioned client every institute gets. It is listed
    #: first and cannot be deleted; the UI renders it as "your client ID".
    is_primary: bool = False


def _client_response(client: Dict[str, Any]) -> ManualClientResponse:
    return ManualClientResponse(**client, is_primary=is_auto_client(client.get("client_id")))


class ConnectionInfoResponse(BaseModel):
    #: The URL admins paste into their AI app: institute-scoped, so the OAuth
    #: dance lands on THIS institute's own admin portal (white-label).
    server_url: str
    #: The bare, institute-less endpoint (platform dashboard + institute picker).
    legacy_server_url: str
    issuer: str
    scope: str
    #: Where this institute's consent page and editor live.
    admin_portal_url: str
    tools: List[Dict[str, Any]]
    manual_clients: List[ManualClientResponse]
    connections: List[Dict[str, Any]]


@router.get(
    "/connection-info",
    response_model=ConnectionInfoResponse,
    summary="Everything the MCP settings page renders",
)
async def connection_info(
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    db: Session = Depends(db_dependency),
    settings: Settings = Depends(get_settings),
    # Only a settings page that keeps opt-in groups out of its presets asks for them.
    opt_in: bool = Query(False),
) -> ConnectionInfoResponse:
    _require_institute_admin(principal)
    repo = _repo(db, settings)
    _ensure_auto_client(repo, principal, db)
    # Note this is NOT gated on check_mcp_access: the settings page must render
    # (server URL, catalogue) precisely while the server is still switched off.
    return ConnectionInfoResponse(
        server_url=scoped_server_url(settings.mcp_issuer_url, principal.institute_id),
        legacy_server_url=settings.mcp_issuer_url,
        admin_portal_url=admin_portal_base(db, principal.institute_id, settings.admin_dashboard_url),
        issuer=settings.mcp_issuer_url,
        scope=MCP_SCOPE_READ,
        tools=tool_catalog(include_opt_in=opt_in),
        # Primary client first, then custom ones newest-first (the repository order).
        manual_clients=sorted(
            (_client_response(c) for c in repo.list_manual_clients(principal.institute_id)),
            key=lambda c: not c.is_primary,
        ),
        connections=repo.list_connections(principal.institute_id),
    )


@router.post(
    "/manual-client",
    response_model=ManualClientResponse,
    summary="Issue an OAuth client id for an app that cannot self-register",
)
async def create_manual_client(
    payload: ManualClientRequest,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    db: Session = Depends(db_dependency),
    settings: Settings = Depends(get_settings),
) -> ManualClientResponse:
    """
    Most MCP clients register themselves (RFC 7591). Some LLM apps want a
    client id pasted into a form instead — this mints one, scoped to the
    institute that created it, with the redirect URIs that app requires.

    Public client: no secret is issued, PKCE is mandatory, and the redirect URIs
    are fixed at creation so the id cannot be pointed somewhere else later.
    """
    _require_institute_admin(principal)

    uris = [u.strip() for u in payload.redirect_uris if u and u.strip()]
    bad = [u for u in uris if not is_acceptable_redirect_uri(u)]
    if not uris or bad:
        raise HTTPException(
            status_code=400,
            detail="Redirect URLs must be https, or http on localhost/127.0.0.1.",
        )

    client_id = f"vcm-{uuid.uuid4().hex}"
    repo = _repo(db, settings)
    repo.save_client(
        client_id=client_id,
        client_name=payload.client_name.strip(),
        redirect_uris=uris,
        grant_types=["authorization_code", "refresh_token"],
        scope=MCP_SCOPE_READ,
        institute_id=principal.institute_id,
        created_by=principal.user_id,
        source="manual",
    )
    logger.info(
        "MCP manual client created: %s by user=%s institute=%s",
        client_id, principal.user_id, principal.institute_id,
    )
    return ManualClientResponse(
        client_id=client_id,
        client_name=payload.client_name.strip(),
        redirect_uris=uris,
    )


@router.delete(
    "/manual-client/{client_id}",
    summary="Revoke a manually issued OAuth client id",
)
async def delete_manual_client(
    client_id: str,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    db: Session = Depends(db_dependency),
    settings: Settings = Depends(get_settings),
) -> Dict[str, bool]:
    _require_institute_admin(principal)
    if is_auto_client(client_id):
        # The primary client is what the settings page hands to admins; deleting
        # it would leave the institute with no id to paste. Custom ones only.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "reason": "primary_client",
                "message": "Your institute's own client ID cannot be removed.",
            },
        )
    deleted = _repo(db, settings).delete_manual_client(principal.institute_id, client_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="No such client for this institute.")
    return {"deleted": True}


@router.delete(
    "/connection/{pair_id}",
    summary="Revoke a live MCP connection",
)
async def revoke_connection(
    pair_id: str,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    db: Session = Depends(db_dependency),
    settings: Settings = Depends(get_settings),
) -> Dict[str, bool]:
    _require_institute_admin(principal)
    revoked = _repo(db, settings).revoke_connection(principal.institute_id, pair_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="No such active connection for this institute.")
    logger.info("MCP connection revoked: pair=%s by user=%s", pair_id, principal.user_id)
    return {"revoked": True}


__all__ = ["router"]
