"""
OAuth discovery documents, served from the ROOT of the host.

An MCP client that gets a 401 from ``/ai-service/mcp`` follows this trail:

    GET /.well-known/oauth-protected-resource/ai-service/mcp   (RFC 9728)
        -> names the authorization server
    GET /.well-known/oauth-authorization-server/ai-service/mcp (RFC 8414)
        -> names /authorize, /token, /register

Both live at the root of the domain by spec (the resource path is appended to
the well-known prefix, not the other way round), which is why the ingress needs
a ``/.well-known`` route pointing at this service.

The SDK builds the documents; this module only places them at the paths the spec
requires, plus the bare ``/.well-known/oauth-authorization-server`` that older
clients probe.
"""
from __future__ import annotations

import logging
from typing import List

from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.routes import (
    build_metadata,
    cors_middleware,
    create_protected_resource_routes,
)
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from pydantic import AnyHttpUrl
from starlette.responses import JSONResponse
from starlette.routing import Route

from ..config import Settings
from .constants import MCP_SCOPE_READ
from .institute_scope import institute_from_path_suffix, scoped_server_url

logger = logging.getLogger(__name__)


def build_discovery_routes(settings: Settings) -> List[Route]:
    """Protected-resource + authorization-server metadata routes."""
    issuer = AnyHttpUrl(settings.mcp_issuer_url)

    routes: List[Route] = list(
        create_protected_resource_routes(
            resource_url=issuer,
            authorization_servers=[issuer],
            scopes_supported=[MCP_SCOPE_READ],
            resource_name="Vacademy",
        )
    )

    metadata = build_metadata(
        issuer_url=issuer,
        service_documentation_url=None,
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=[MCP_SCOPE_READ],
            default_scopes=[MCP_SCOPE_READ],
        ),
        revocation_options=RevocationOptions(enabled=True),
    )
    handler = cors_middleware(MetadataHandler(metadata).handle, ["GET", "OPTIONS"])

    # RFC 8414 §3.1 puts the issuer's path AFTER the well-known segment. The bare
    # path is kept as a fallback for clients that probe the origin instead.
    issuer_path = (issuer.path or "").rstrip("/")
    for path in {f"/.well-known/oauth-authorization-server{issuer_path}",
                 "/.well-known/oauth-authorization-server"}:
        routes.append(Route(path, endpoint=handler, methods=["GET", "OPTIONS"]))

    # Institute-scoped resource (white-label): /ai-service/mcp/i/<id> is its own
    # RFC 9728 resource — same authorization server, its own `resource` value —
    # so the client's `resource` parameter names the institute from step one.
    async def scoped_resource_metadata(request):
        institute_id = institute_from_path_suffix(f"/i/{request.path_params.get('institute_id', '')}")
        if not institute_id:
            return JSONResponse({"error": "not_found"}, status_code=404)
        return JSONResponse({
            "resource": scoped_server_url(settings.mcp_issuer_url, institute_id),
            "authorization_servers": [str(issuer)],
            "scopes_supported": [MCP_SCOPE_READ],
            "bearer_methods_supported": ["header"],
            "resource_name": "Vacademy",
        })

    routes.append(Route(
        f"/.well-known/oauth-protected-resource{issuer_path}/i/{{institute_id}}",
        endpoint=cors_middleware(scoped_resource_metadata, ["GET", "OPTIONS"]),
        methods=["GET", "OPTIONS"],
    ))
    logger.info("MCP discovery routes: %s", [r.path for r in routes])
    return routes


__all__ = ["build_discovery_routes"]
