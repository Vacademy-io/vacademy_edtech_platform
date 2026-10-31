"""Staff gate for every course-knowledge admin route.

The caller is resolved from the verified JWT pinned to the clientId institute
(resolve_pinned_principal, the same trust boundary as the site assistant), and
is staff by ROLES ONLY (built-in staff roles or a custom institute role, the
Tutor Mode rule in tutor.roles). principal.is_root_user is never read: it is set for
ordinary learners too (about 185k of 189k prod users, most of them students),
so a root shortcut would let learners spend the institute's credits on paid
processing and read lesson coverage.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet, Iterable, Optional

from fastapi import HTTPException, Request, status

from ...config import get_settings
from ...core.security import resolve_pinned_principal
from ..tutor.roles import is_staff

STAFF_ROLES: FrozenSet[str] = frozenset({
    "ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN", "TEACHER", "CONTENT_CREATOR", "COURSE_CREATOR",
})
MANAGE_ROLES: FrozenSet[str] = frozenset({"ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN"})


@dataclass(frozen=True)
class CkStaff:
    user_id: str
    institute_id: str
    roles: FrozenSet[str]
    can_manage: bool


def _deny(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error, "message": message})


def normalize_roles(roles: Optional[Iterable[str]]) -> FrozenSet[str]:
    """Upper case, spaces and dashes as underscores ("CONTENT CREATOR" == CONTENT_CREATOR)."""
    return frozenset(
        str(r).strip().upper().replace(" ", "_").replace("-", "_") for r in (roles or []) if r
    )


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[len("Bearer "):].strip() or None


async def ck_staff(request: Request) -> CkStaff:
    """A staff member of the clientId institute, or 403 {code: forbidden}.
    401 when the token is missing or invalid (from resolve_pinned_principal)."""
    token = _bearer(request.headers.get("authorization"))
    client_id = request.headers.get("clientId") or request.headers.get("client_id")
    principal = await resolve_pinned_principal(token=token, client_id=client_id, settings=get_settings())
    roles = normalize_roles(principal.roles)
    # Custom institute roles count as staff (tutor.roles.is_staff); spending stays MANAGE_ROLES only.
    if not is_staff(roles):
        raise _deny(status.HTTP_403_FORBIDDEN, "forbidden", "Only the institute's staff can do this.")
    return CkStaff(
        user_id=principal.user_id,
        institute_id=principal.institute_id,
        roles=roles,
        can_manage=bool(roles & MANAGE_ROLES),
    )


def require_manage(staff: CkStaff) -> CkStaff:
    """403 {code: forbidden} unless the staff member is an institute admin."""
    if not staff.can_manage:
        raise _deny(status.HTTP_403_FORBIDDEN, "forbidden", "Only an institute admin can do this.")
    return staff


__all__ = ["STAFF_ROLES", "MANAGE_ROLES", "CkStaff", "normalize_roles", "ck_staff", "require_manage"]
