"""
The read-only demo user in ai_service (docs/demo-stage/SPEC.md section 3).

A public demo hands every visitor the sign-in of one user who is ADMIN of a demo
institute and also holds the role DEMO_READ_ONLY. For a request made with that
user's token:

- GET, HEAD and OPTIONS pass, except the GETs in BLOCKED_GETS (they call a model,
  synthesise speech or stream model output);
- every other method is refused unless its path is in READS (empty today: no
  ai_service POST that only reads is needed by the demo);
- the answer is 403 with exactly REFUSAL_BODY, the same bytes the Java services send
  (common_service DemoReadOnlyGate).

This file is the one place for the rule. It is applied three ways:

- DemoReadOnlyMiddleware: every HTTP request that carries the token, whatever
  dependency the route uses (many routes read the token themselves or take none);
- enforce_request(): called by the auth dependencies in core/security.py;
- token_holds_role(): for callers with no HTTP request to judge (web sockets, the MCP
  server replaying a stored token); they refuse the demo user outright.

The role is read from the token's `authorities` claim under ANY institute, because the
`clientId` header is chosen by the caller. The claims are read WITHOUT checking the
signature: that costs nothing for ordinary users, and a forged token that names the
role only gets refused earlier than the real check would have refused it.

The visitor routes of app/site_assistant and app/demo_guide use their own tokens,
which carry no `authorities` claim, so they are not affected.
"""
from __future__ import annotations

import base64
import json
from typing import Any, Iterable, List, Optional, Tuple

ROLE = "DEMO_READ_ONLY"

REFUSAL_BODY = b'{"code":"DEMO_READ_ONLY","message":"This is a demo. Changes are not saved."}'

# Non-GET requests the demo user may make, as (METHOD, pattern). Only requests that
# read and cost nothing belong here. Default is deny: when unsure, leave it out.
READS: List[Tuple[str, str]] = []

# GETs refused for the demo user. Patterns are relative to the service base path
# (/ai-service); `*` is one segment, a trailing `**` is any remainder.
BLOCKED_GETS: List[str] = [
    # Legacy GET endpoints that start a model run
    "/ai/lecture/generate-plan",
    "/ai/lecture/generate-feedback",
    "/ai/get-question-pdf/**",
    "/ai/get-question-audio/**",
    "/ai/chat-with-pdf/get-response",
    # Speech synthesis
    "/tts/**",
    # Streams and polls of model output for a staff chat
    "/assistant/session/*/stream",
    "/chat-agent/session/*/stream",
    "/chat-agent/session/*/updates",
]


class DemoReadOnlyRefused(Exception):
    """Raised by enforce_request(); app_factory turns it into the 403 answer."""


def _is_role(name: Any) -> bool:
    return isinstance(name, str) and name.strip().upper().replace("-", "_").replace(" ", "_") == ROLE


def claims_hold_role(claims: Any) -> bool:
    """True when a token's claims list the demo role under any institute."""
    if not isinstance(claims, dict):
        return False
    authorities = claims.get("authorities")
    if not isinstance(authorities, dict):
        return False
    for entry in authorities.values():
        roles = entry.get("roles") if isinstance(entry, dict) else None
        if isinstance(roles, (list, tuple, set)) and any(_is_role(r) for r in roles):
            return True
    return False


def _unverified_claims(token: Optional[str]) -> Optional[dict]:
    if not token or not isinstance(token, str):
        return None
    parts = token.strip().split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except Exception:
        return None
    return claims if isinstance(claims, dict) else None


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not isinstance(authorization, str):
        return None
    value = authorization.strip()
    if value[:7].lower() == "bearer ":
        return value[7:].strip()
    return None


def token_holds_role(token: Optional[str]) -> bool:
    """True when a raw access token (no 'Bearer ' prefix) belongs to the demo user."""
    return claims_hold_role(_unverified_claims(token))


def authorization_holds_role(authorization: Optional[str]) -> bool:
    """True when an Authorization header value carries the demo user's token."""
    return token_holds_role(_bearer(authorization))


def _segments(path: str) -> List[str]:
    return [s for s in path.split("/") if s != ""]


def _matches(pattern: str, segments: List[str]) -> bool:
    want = _segments(pattern)
    open_ended = bool(want) and want[-1] == "**"
    if open_ended:
        want = want[:-1]
        if len(segments) < len(want):
            return False
    elif len(segments) != len(want):
        return False
    return all(w == "*" or w == s for w, s in zip(want, segments))


def _relative(path: str, base_path: str) -> str:
    base = (base_path or "").rstrip("/")
    if base and (path == base or path.startswith(base + "/")):
        return path[len(base):] or "/"
    return path


def is_refused(method: Optional[str], path: Optional[str], base_path: str = "/ai-service") -> bool:
    """
    The decision for a request made by the demo user.

    `path` is the path the router sees (already unescaped by the server). Repeated and
    trailing slashes are ignored when matching BLOCKED_GETS; a non-GET path must match
    a READS pattern exactly.
    """
    verb = (method or "").upper()
    if verb == "OPTIONS":
        return False
    if not isinstance(path, str) or not path.startswith("/"):
        return True
    relative = _relative(path, base_path)
    if verb in ("GET", "HEAD"):
        if ";" in relative or "\\" in relative or "%" in relative:
            return True
        segments = _segments(relative)
        if any(s in (".", "..") for s in segments):
            return True
        return any(_matches(pattern, segments) for pattern in BLOCKED_GETS)
    if "//" in relative or relative.endswith("/") or any(c in relative for c in ";\\%"):
        return True
    segments = _segments(relative)
    if any(s in (".", "..") for s in segments):
        return True
    return not any(verb == m and _matches(pattern, segments) for m, pattern in READS)


def _base_path() -> str:
    try:
        from ..config import get_settings
        return get_settings().api_base_path or ""
    except Exception:
        return "/ai-service"


def enforce_request(request: Any, authorization: Optional[str]) -> None:
    """
    For the auth dependencies: raise DemoReadOnlyRefused when the caller is the demo
    user and this request is not one it may make. Does nothing for anyone else.
    """
    if not authorization_holds_role(authorization):
        return
    method = getattr(request, "method", None)
    url = getattr(request, "url", None)
    path = getattr(url, "path", None)
    if is_refused(method, path, _base_path()):
        raise DemoReadOnlyRefused()


def refusal_response():
    from starlette.responses import Response
    return Response(
        content=REFUSAL_BODY,
        status_code=403,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


async def refused_handler(request: Any, exc: Exception):
    """Exception handler for DemoReadOnlyRefused."""
    return refusal_response()


def _authorization_values(scope: dict) -> Iterable[str]:
    for name, value in scope.get("headers") or []:
        if name.lower() == b"authorization":
            try:
                yield value.decode("latin-1")
            except Exception:
                continue


class DemoReadOnlyMiddleware:
    """
    Applies the rule to every HTTP request before routing. Requests without the demo
    user's token pass straight through; nothing is looked up for them.
    """

    def __init__(self, app, base_path: Optional[str] = None):
        self.app = app
        self._base_path = base_path

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and any(
            authorization_holds_role(value) for value in _authorization_values(scope)
        ):
            base = self._base_path if self._base_path is not None else _base_path()
            if is_refused(scope.get("method"), scope.get("path"), base):
                await refusal_response()(scope, receive, send)
                return
        await self.app(scope, receive, send)


__all__ = [
    "ROLE", "REFUSAL_BODY", "READS", "BLOCKED_GETS", "DemoReadOnlyRefused", "DemoReadOnlyMiddleware",
    "claims_hold_role", "token_holds_role", "authorization_holds_role", "is_refused",
    "enforce_request", "refusal_response", "refused_handler",
]
