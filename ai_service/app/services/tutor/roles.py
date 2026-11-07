"""Who may manage teaching plans (compile, read answer keys, spend credits).

One constant for every tutor-family router. Platform role names carry spaces
("CONTENT CREATOR", "COURSE CREATOR"); the JWT may carry either form, so
names are normalised before comparison.

Staff is decided by ROLES ONLY, read from the pinned principal (the JWT
authorities entry of the clientId institute). is_root_user never grants staff:
it is set for ordinary learners too (most production users, students
included), so a root shortcut would let learners compile plans on the
institute's credits and read quiz answer keys.

Custom institute roles (an "Academic Coordinator" created in the admin
dashboard, which can see the Tutor Mode tab) count as staff, the same rule as
admin_core's InstituteAccessValidator.requireStaffAuthorities: learners are
always enrolled with the built-in STUDENT role, so a role that is neither a
known staff role nor a learner-side role is a staff role by construction.
A learner-side role wins over a custom role (a learner holding a stray custom
role is still a learner); a known staff role wins over both.
"""
from __future__ import annotations

from typing import Iterable, Set

STAFF_ROLES: Set[str] = {
    "ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN", "TEACHER",
    "CONTENT_CREATOR", "COURSE_CREATOR",
}

#: Learner-side roles: never staff unless a known staff role is also held.
LEARNER_ROLES: Set[str] = {"STUDENT", "LEARNER", "PARENT", "GUARDIAN"}


def normalize_roles(roles: Iterable[str] | None) -> Set[str]:
    return {str(r).strip().upper().replace(" ", "_").replace("-", "_") for r in (roles or []) if r}


def is_staff(roles: Iterable[str] | None, *, is_root: bool = False) -> bool:
    """True when the caller holds a staff role in the pinned institute.

    Order: a known staff role -> staff; else any learner-side role -> not
    staff; else any other (custom institute) role -> staff; no roles -> not
    staff. `is_root` is accepted so existing call sites keep working, and is
    deliberately ignored: a root user without a staff role is not staff."""
    del is_root
    names = normalize_roles(roles)
    if names & STAFF_ROLES:
        return True
    if names & LEARNER_ROLES:
        return False
    return bool(names)


__all__ = ["STAFF_ROLES", "LEARNER_ROLES", "normalize_roles", "is_staff"]
