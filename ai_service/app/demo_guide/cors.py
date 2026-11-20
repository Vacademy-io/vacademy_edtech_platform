"""CORS for the demo guide's routes only: limited to the products' stage origins.

The app-wide CORSMiddleware (app_factory) echoes any origin, which is right
for the rest of ai_service and must stay as it is. This middleware sits
outside it and acts only on paths under ``<api base>/demo-guide/v1``:

  * a cross-origin preflight from an origin that is not a stage origin of any
    product is answered 403 here, without CORS headers;
  * for any other request from such an origin, the ``Access-Control-*``
    headers the inner middleware added are removed from the response, so a
    browser on that origin cannot read it.

Every other path passes through untouched. The endpoints still check the
Origin against the session's own product (service.require_origin); this is
the browser-facing half of the same rule.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from . import settings as S

Scope = Dict[str, Any]
PATH_MARK = "/demo-guide/v1"


def origin_is_stage(origin: Optional[str]) -> bool:
    """True when `origin` is a stage origin of any configured product."""
    o = S.normalize_origin(origin)
    if not o:
        return False
    try:
        return any(p.origin_allowed(o) for p in S.products().values())
    except Exception:  # noqa: BLE001 - settings unreadable: nobody is allowed
        return False


def _header(scope: Scope, name: bytes) -> Optional[str]:
    for k, v in scope.get("headers") or []:
        if k == name:
            return v.decode("latin-1")
    return None


class DemoGuideCorsMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]):
        self.app = app

    async def __call__(self, scope: Scope, receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http" or PATH_MARK not in (scope.get("path") or ""):
            await self.app(scope, receive, send)
            return
        origin = _header(scope, b"origin")
        if origin is None or origin_is_stage(origin):
            await self.app(scope, receive, send)
            return
        if scope.get("method") == "OPTIONS" and _header(scope, b"access-control-request-method"):
            body = b'{"detail":{"code":"origin_not_allowed","message":"This page cannot use the demo guide."}}'
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(body)).encode()), (b"vary", b"Origin")]})
            await send({"type": "http.response.body", "body": body})
            return

        async def strip(message: Dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers: List[Tuple[bytes, bytes]] = [
                    (k, v) for k, v in message.get("headers") or []
                    if not k.lower().startswith(b"access-control-")]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, strip)
