"""
Institute-scoped MCP server URLs, for white-label institutes.

Vacademy is sold white-label: Shiksha Nation's admins live on
admin.shikshanation.com with their own logo and never see "Vacademy". OAuth
discovery, though, is per *resource URL*, and the AI app only knows the server
URL it was given — so with a single ``/ai-service/mcp`` the server cannot know
which institute is connecting until consent, and has to park the browser on the
one global dashboard (dash.vacademy.io) with an institute picker. Wrong brand,
wrong login session.

The fix is to put the institute in the URL the admin pastes:

    https://<backend>/ai-service/mcp/i/<institute_id>

Everything under ``/i/<id>`` is the SAME MCP app (one issuer, one token
endpoint, one registration endpoint), but:

* ``/authorize`` learns the institute from the RFC 8707 ``resource`` the client
  sends (its server URL) and sends the browser to THAT institute's admin portal
  — its brand, its session, no picker;
* consent only binds a user who belongs to that institute;
* a token minted for ``/i/<id>`` is accepted only under ``/i/<id>``;
* RFC 9728 metadata exists per institute, and the 401 challenge on a scoped path
  points at it, so clients that take ``resource`` from the metadata document
  and clients that use the URL they connected to agree.

The bare ``/ai-service/mcp`` keeps working as before (global dashboard +
picker) so existing connections are untouched.
"""
from __future__ import annotations

import logging
import re
from contextvars import ContextVar
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import text

logger = logging.getLogger(__name__)

#: ``/i/<institute_id>`` — ids are UUIDs today; accept a conservative superset.
_SCOPE_RE = re.compile(r"^/i/([A-Za-z0-9][A-Za-z0-9-]{6,63})(/.*)?$")

#: The institute named by the request path currently being served, set by
#: ``McpInstitutePathAdapter``. None on the bare (legacy) endpoint.
request_institute_id: ContextVar[Optional[str]] = ContextVar("mcp_request_institute_id", default=None)


def scoped_server_url(issuer_url: str, institute_id: str) -> str:
    return f"{issuer_url.rstrip('/')}/i/{institute_id}"


def institute_from_path_suffix(suffix: str) -> Optional[str]:
    """``/i/<id>`` or ``/i/<id>/…`` → id; anything else → None."""
    m = _SCOPE_RE.match(suffix or "")
    return m.group(1) if m else None


def institute_from_resource(resource: Optional[str], issuer_url: str) -> Optional[str]:
    """
    The institute an RFC 8707 ``resource`` names, when it is one of OUR scoped
    server URLs. Compared by path under the issuer's path, so host casing or a
    trailing slash never matter; a resource that is not ours yields None.
    """
    if not resource:
        return None
    try:
        res = urlparse(str(resource))
        iss = urlparse(issuer_url)
    except ValueError:
        return None
    if res.hostname and iss.hostname and res.hostname.lower() != iss.hostname.lower():
        return None
    base = (iss.path or "").rstrip("/")
    path = (res.path or "").rstrip("/")
    if not path.startswith(base):
        return None
    return institute_from_path_suffix(path[len(base):])


def admin_portal_base(db: Any, institute_id: Optional[str], default_url: str) -> str:
    """
    The institute's own admin portal origin, for white-label institutes.

    ``institutes.admin_portal_base_url`` first, else an ADMIN row in
    ``institute_domain_routing``, else the platform dashboard. Never raises:
    a lookup problem degrades to the default.
    """
    if not institute_id or db is None:
        return default_url.rstrip("/")
    try:
        row = db.execute(
            text("SELECT admin_portal_base_url FROM institutes WHERE id = :id"), {"id": institute_id}
        ).first()
        column = str(row[0] or "").strip() if row else ""
        if column:
            return _origin(column)
        rows = db.execute(
            text("SELECT domain, subdomain FROM institute_domain_routing WHERE institute_id = :id AND role = 'ADMIN'"),
            {"id": institute_id},
        ).fetchall()
        for domain, subdomain in rows or []:
            domain = str(domain or "").strip().lower().replace("https://", "").replace("http://", "").rstrip("/")
            sub = str(subdomain or "").strip().lower()
            if not domain:
                continue
            return _origin(domain if (not sub or sub == "*") else f"{sub}.{domain}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("admin portal lookup failed for institute %s: %s", institute_id, exc)
    return default_url.rstrip("/")


def institute_name(db: Any, institute_id: Optional[str]) -> Optional[str]:
    if not institute_id or db is None:
        return None
    try:
        row = db.execute(text("SELECT name FROM institutes WHERE id = :id"), {"id": institute_id}).first()
        return str(row[0]).strip() if row and row[0] else None
    except Exception:  # noqa: BLE001
        return None


def _origin(host_or_url: str) -> str:
    value = host_or_url.strip().rstrip("/")
    return value if value.startswith("http") else f"https://{value}"


class McpInstitutePathAdapter:
    """
    Serves ``/ai-service/mcp/i/<institute_id>`` from the mounted MCP app.

    Rewrites the path to the app root, remembers the institute for the request
    (``request_institute_id``), and rewrites the 401 challenge's
    ``resource_metadata`` to the institute's own RFC 9728 document so the
    client's OAuth dance is scoped from its very first step.
    """

    def __init__(self, app: Any, issuer_url: str):
        self.app = app
        self.issuer_url = issuer_url.rstrip("/")

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        # Registered as a Route with an {institute_id} param; fall back to the
        # raw path (after the issuer path) if mounted some other way.
        institute_id = institute_from_path_suffix("/i/" + str((scope.get("path_params") or {}).get("institute_id") or ""))
        if not institute_id:
            issuer_path = urlparse(self.issuer_url).path.rstrip("/")
            institute_id = institute_from_path_suffix(str(scope.get("path") or "")[len(issuer_path):])
        if not institute_id:
            await _plain_404(send)
            return

        token = request_institute_id.set(institute_id)
        metadata_url = f"{self._root()}/.well-known/oauth-protected-resource{urlparse(self.issuer_url).path.rstrip('/')}/i/{institute_id}"

        async def send_scoped(message: Any) -> None:
            if message.get("type") == "http.response.start" and message.get("status") == 401:
                headers = []
                for k, v in message.get("headers") or []:
                    if k.lower() == b"www-authenticate":
                        v = re.sub(rb'resource_metadata="[^"]*"', b'resource_metadata="' + metadata_url.encode() + b'"', v)
                    headers.append((k, v))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app({**scope, "path": "/", "raw_path": b"/"}, receive, send_scoped)
        finally:
            request_institute_id.reset(token)

    def _root(self) -> str:
        p = urlparse(self.issuer_url)
        return f"{p.scheme}://{p.netloc}"


async def _plain_404(send: Any) -> None:
    await send({"type": "http.response.start", "status": 404,
                "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": b'{"error":"not_found"}'})


__all__ = [
    "McpInstitutePathAdapter",
    "admin_portal_base",
    "institute_from_path_suffix",
    "institute_from_resource",
    "institute_name",
    "request_institute_id",
    "scoped_server_url",
]
