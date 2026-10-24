"""Who triggered an AI operation, and from which surface (contract K2).

`MeteringContext` is plain data. Callers turn it into the optional
CreditDeductRequest metering fields with `as_fields()`; the deduction then
writes them to ai_usage_event. Explicit fields are the source of truth
(critique C13): nothing here is carried in a contextvar.

`from_request` never raises and never does I/O: it reads the already-verified
JWT through core/security.py (jwt_institute_roles + the `fullname` claim) and
the Origin/Referer host. There is deliberately NO custom surface header: a
custom header would add a CORS preflight to every browser call.

Surface, first match wins:
  1. X-Internal-Service-Token that MATCHES this server's secret (or the
     caller's auth dependency said mode INTERNAL)              -> INTERNAL
  2. A verified API key: request.state.api_key_id, or X-Institute-Key with
     auth_mode='INSTITUTE' from the API-key dependency      -> PARTNER_API
     (actor API_KEY). A merely present header proves nothing and is ignored.
  3. Origin/Referer host in metering.admin_hosts -> ADMIN_APP
  4. JWT roles in the institute map only to LEARNER -> LEARNER_APP
  5. UNKNOWN (the event writer then applies the catalog default_surface)
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .constants import DEFAULT_ROLE_MAP, UNMAPPED_ROLE, normalize_role_name

logger = logging.getLogger(__name__)


def resolve_role_class(roles: Optional[List[str]], role_map: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """The role class with the lowest precedence number among `roles`
    (unmapped custom roles count as STAFF/35). None for no roles."""
    names = [normalize_role_name(r) for r in (roles or []) if r and normalize_role_name(r)]
    if not names:
        return None
    rmap = role_map
    if rmap is None:
        try:
            from .cache import peek_snapshot

            snap = peek_snapshot()
            rmap = snap.roles if snap is not None else DEFAULT_ROLE_MAP
        except Exception:  # noqa: BLE001
            rmap = DEFAULT_ROLE_MAP
    best = None
    for n in names:
        cls, prec = rmap.get(n, UNMAPPED_ROLE)
        if best is None or prec < best[1]:
            best = (cls, prec)
    return best[0] if best else None


def _host(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = urlparse(value if "//" in value else f"//{value}")
        host = (parsed.hostname or "").strip().lower()
        return host or None
    except Exception:  # noqa: BLE001
        return None


def _header(request: Any, name: str) -> Optional[str]:
    try:
        headers = getattr(request, "headers", None)
        if headers is None:
            return None
        value = headers.get(name)
        return str(value) if value else None
    except Exception:  # noqa: BLE001
        return None


def _internal_token_ok(token: Optional[str]) -> bool:
    """True only when `token` equals this server's internal service secret
    (constant-time; no I/O: settings are cached in-process)."""
    if not token:
        return False
    try:
        import hmac

        from ...config import get_settings

        expected = get_settings().internal_service_token
        return bool(expected) and hmac.compare_digest(str(token), str(expected))
    except Exception:  # noqa: BLE001
        return False


def _user_id_of(user: Any) -> Optional[str]:
    if user is None:
        return None
    uid = user.get("user_id") if isinstance(user, dict) else getattr(user, "user_id", None)
    if uid in (None, "", "unknown"):
        return None
    return str(uid)


@dataclass
class MeteringContext:
    actor_kind: str = "UNKNOWN"
    actor_user_id: Optional[str] = None
    actor_role_class: Optional[str] = None
    actor_roles_raw: Optional[List[str]] = None
    role_source: str = "UNRESOLVED"
    actor_display_name: Optional[str] = None
    subject_user_id: Optional[str] = None
    subject_display_name: Optional[str] = None
    surface: str = "UNKNOWN"
    source_service: str = "ai_service"

    # ------------------------------------------------------------------ builders

    @classmethod
    def from_request(cls, request: Any, institute_id: Optional[str], *, user: Any = None,
                     auth_mode: Optional[str] = None) -> "MeteringContext":
        """Attribution for a FastAPI request. Never raises: on any problem the
        fields it could not work out stay UNKNOWN / UNRESOLVED.

        `auth_mode` is the mode the route's API-key / internal-token dependency
        returned ('INSTITUTE' after it validated X-Institute-Key, 'INTERNAL'
        after it validated the service token); without it a raw header is
        never trusted."""
        ctx = cls()
        try:
            ctx.actor_user_id = _user_id_of(user)
            if ctx.actor_user_id:
                ctx.actor_kind = "USER"

            internal = _header(request, "x-internal-service-token")
            api_key = _header(request, "x-institute-key")
            state = getattr(request, "state", None)
            api_key_id = getattr(state, "api_key_id", None) if state is not None else None

            authorization = _header(request, "authorization")
            roles: Optional[set] = None
            if authorization and institute_id:
                try:
                    from ...core.security import jwt_institute_roles

                    roles = jwt_institute_roles(authorization, institute_id)
                except Exception:  # noqa: BLE001
                    roles = None
            if roles is not None:
                payload = None
                try:
                    from ...core.security import _extract_bearer, decode_access_token

                    payload = decode_access_token(_extract_bearer(authorization) or "")
                except Exception:  # noqa: BLE001
                    payload = None
                if isinstance(payload, dict):
                    if not ctx.actor_user_id and payload.get("user"):
                        ctx.actor_user_id = str(payload.get("user"))
                    name = str(payload.get("fullname") or "").strip()
                    ctx.actor_display_name = name[:255] or None
                ctx.actor_roles_raw = sorted(roles)
                ctx.actor_role_class = resolve_role_class(ctx.actor_roles_raw)
                ctx.role_source = "JWT" if ctx.actor_role_class else "UNRESOLVED"
                if ctx.actor_user_id:
                    ctx.actor_kind = "USER"

            mode = str(auth_mode or "").strip().upper()
            internal_ok = bool(internal) and (mode == "INTERNAL" or _internal_token_ok(internal))
            api_key_ok = bool(api_key_id) or (bool(api_key) and mode == "INSTITUTE")
            if internal_ok:
                ctx.surface = "INTERNAL"
            elif api_key_ok:
                ctx.surface = "PARTNER_API"
                if not ctx.actor_user_id:
                    ctx.actor_kind = "API_KEY"
                    ctx.actor_role_class = "API_KEY"
                    ctx.role_source = "CALLER"
                    if api_key_id:
                        ctx.actor_user_id = f"apikey:{api_key_id}"
            else:
                host = _host(_header(request, "origin")) or _host(_header(request, "referer"))
                admin = False
                if host:
                    try:
                        from .cache import admin_hosts

                        admin = host in admin_hosts()
                    except Exception:  # noqa: BLE001
                        admin = False
                if admin:
                    ctx.surface = "ADMIN_APP"
                elif ctx.actor_roles_raw and ctx.actor_role_class == "LEARNER" and all(
                    resolve_role_class([r]) == "LEARNER" for r in ctx.actor_roles_raw
                ):
                    ctx.surface = "LEARNER_APP"
        except Exception as exc:  # noqa: BLE001
            logger.debug("MeteringContext.from_request failed: %s", exc)
        return ctx

    @classmethod
    def system(cls, subject_user_id: Optional[str] = None, subject_display_name: Optional[str] = None,
               surface: str = "SCHEDULED") -> "MeteringContext":
        return cls(actor_kind="SYSTEM", actor_role_class="SYSTEM", role_source="CALLER",
                   subject_user_id=subject_user_id, subject_display_name=subject_display_name,
                   surface=surface or "SCHEDULED")

    @classmethod
    def api_key(cls, key_id: Optional[str]) -> "MeteringContext":
        return cls(actor_kind="API_KEY", actor_user_id=f"apikey:{key_id}" if key_id else None,
                   actor_role_class="API_KEY", role_source="CALLER", surface="PARTNER_API")

    # ------------------------------------------------------------------ output

    def as_fields(self) -> Dict[str, Any]:
        """The CreditDeductRequest metering fields this context fills (None
        values left out). `actor_user_id` and `role_source` are extra optional
        request fields; the ledger's own user_id/user_role are NOT produced
        here — callers keep passing those exactly as today."""
        out = {
            "actor_kind": self.actor_kind,
            "actor_user_id": self.actor_user_id,
            "actor_role_class": self.actor_role_class,
            "actor_roles_raw": list(self.actor_roles_raw) if self.actor_roles_raw else None,
            "role_source": self.role_source,
            "actor_display_name": self.actor_display_name,
            "subject_user_id": self.subject_user_id,
            "subject_display_name": self.subject_display_name,
            "surface": self.surface,
            "source_service": self.source_service,
        }
        return {k: v for k, v in out.items() if v is not None}

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


__all__ = ["MeteringContext", "resolve_role_class"]
