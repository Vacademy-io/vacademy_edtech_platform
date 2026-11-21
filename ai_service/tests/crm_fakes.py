"""
Shared fakes for the CRM tool tests (``crm_data`` and every ``assistant_tools_crm_*`` module).

    backend = CrmBackend()                       # admin-core, SQL, auth-service, notification-service
    backend.install(monkeypatch)                 # patches cbd.admin_core, crm_data.rows, ld.auth_call, …
    backend.lead_scope(mode="ADMIN")             # what GET /v1/audience/lead-scope answers
    backend.sql.on("FROM audience_response", [{"lead_id": ...}])
    ctx = make_ctx(roles=("COUNSELLOR",))
    db = confirm_db()                            # sqlite session with mcp_crm_confirm, for token tests

Fakes answer like the real services: admin-core errors are
``{error: admin_core_rejected, status, message}``; an unrouted admin-core path
answers 404. SQL handlers match the first registered substring (``on``) and
receive the bound params; ``sql.fail = True`` makes every read fail
(``rows`` → ``([], False)``). Every call is recorded for assertions.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.crm_confirm import CrmConfirm  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services import crm_data  # noqa: E402
from app.services import learner_data as ld  # noqa: E402
from app.services.assistant_tool_registry import ToolContext  # noqa: E402

INSTITUTE = "inst-1"
OTHER_INSTITUTE = "inst-2"


class FakeDb:
    """A session that answers every statement with no rows (crm_data reads go through ``rows``)."""

    def __init__(self):
        self.statements: List[Tuple[str, Any]] = []
        self.rollbacks = 0

    def execute(self, stmt, params=None):
        self.statements.append((str(stmt), params))
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        self.rollbacks += 1

    def commit(self):
        pass


def principal(user_id: str = "admin-1", roles: Sequence[str] = ("ADMIN",), institute_id: str = INSTITUTE,
              permissions: Sequence[str] = ()) -> PinnedPrincipal:
    return PinnedPrincipal(user_id=user_id, institute_id=institute_id, roles=list(roles),
                           permissions=list(permissions), is_root_user=False)


def make_ctx(user_id: str = "admin-1", roles: Sequence[str] = ("ADMIN",), *, db: Any = None,
             institute_id: str = INSTITUTE, via_mcp: bool = True, bearer_token: Optional[str] = "jwt") -> ToolContext:
    ctx = ToolContext(db=db if db is not None else FakeDb(), principal=principal(user_id, roles, institute_id),
                      keys=(), bearer_token=bearer_token)
    ctx.via_mcp = via_mcp
    return ctx


def confirm_db():
    """An sqlite session with the mcp_crm_confirm table (Flyway V583 creates it in production)."""
    engine = create_engine("sqlite://")
    CrmConfirm.__table__.create(bind=engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


Response = Union[Any, Callable[..., Any]]


class FakeAdminCore:
    """Routes ``cbd.admin_core`` calls by (method, path prefix). Unrouted → 404 like an older admin-core."""

    def __init__(self):
        self.calls: List[Dict[str, Any]] = []
        self.routes: List[Tuple[str, str, Response]] = []

    def on(self, method: str, path: str, response: Response) -> "FakeAdminCore":
        """``response``: a value, or ``fn(method, path, params, body)``. Later routes win."""
        self.routes.insert(0, (method.upper(), path, response))
        return self

    async def __call__(self, ctx_, method, path, *, params=None, body=None, timeout=30.0):
        self.calls.append({"method": method.upper(), "path": path, "params": dict(params or {}), "body": body})
        for m, p, response in self.routes:
            if m in (method.upper(), "*") and path.startswith(p):
                return response(method, path, params or {}, body) if callable(response) else response
        return cbd.err("admin_core_rejected", status=404, message="Not Found")

    def called(self, path: str, method: Optional[str] = None) -> List[Dict[str, Any]]:
        return [c for c in self.calls if c["path"].startswith(path) and (method is None or c["method"] == method)]


class FakeSql:
    """Stands in for ``crm_data.rows``: the first handler whose needle is in the SQL answers."""

    def __init__(self):
        self.calls: List[Tuple[str, Dict[str, Any]]] = []
        self.handlers: List[Tuple[str, Any]] = []
        self.fail = False

    def on(self, needle: str, result: Any) -> "FakeSql":
        """``result``: a list of row dicts, or ``fn(params, sql)`` returning one. Later handlers win."""
        self.handlers.insert(0, (needle, result))
        return self

    def __call__(self, ctx_, sql, params=None, *, timeout_ms=15000):
        params = dict(params or {})
        self.calls.append((sql, params))
        if self.fail:
            return [], False
        for needle, result in self.handlers:
            if needle in sql:
                out = result(params, sql) if callable(result) else result
                return [dict(r) for r in out], True
        return [], True

    def matching(self, needle: str) -> List[Tuple[str, Dict[str, Any]]]:
        return [(s, p) for s, p in self.calls if needle in s]


class CrmBackend:
    """admin-core + SQL + auth-service + notification-service fakes, installed together."""

    def __init__(self):
        self.admin_core = FakeAdminCore()
        self.sql = FakeSql()
        self.auth_calls: List[Dict[str, Any]] = []
        self.notification_calls: List[Dict[str, Any]] = []
        self.user_names: Dict[str, str] = {}
        self.notification_routes: List[Tuple[str, Response]] = []

    def install(self, monkeypatch) -> "CrmBackend":
        monkeypatch.setattr(cbd, "admin_core", self.admin_core)
        monkeypatch.setattr(crm_data, "rows", self.sql)
        monkeypatch.setattr(ld, "auth_call", self._auth_call)
        from app.services import assistant_tool_registry as reg
        monkeypatch.setattr(reg, "_notification_json", self._notification)
        monkeypatch.setattr(crm_data, "institute_tz", lambda ctx, purpose="reports": crm_data.DEFAULT_TZ)
        return self

    # admin-core shortcuts --------------------------------------------------------
    def lead_scope(self, mode: str = "ADMIN", owner_ids: Optional[Sequence[str]] = None, include_unassigned=None,
                   allowed_audience_ids: Optional[Sequence[str]] = None, sub_org_ids: Sequence[str] = (),
                   is_admin: Optional[bool] = None) -> "CrmBackend":
        body = {"mode": mode, "owner_ids": None if owner_ids is None else list(owner_ids),
                "include_unassigned": (mode in ("ADMIN", "DEFAULT", "COUNSELLOR_TREE", "AUDIENCE_LIST")
                                       if include_unassigned is None else include_unassigned),
                "allowed_audience_ids": None if allowed_audience_ids is None else list(allowed_audience_ids),
                "sub_org_ids": list(sub_org_ids), "is_admin": mode == "ADMIN" if is_admin is None else is_admin}
        self.admin_core.on("GET", crm_data.LEAD_SCOPE_PATH, body)
        return self

    def counsellors(self, users: Dict[str, str], *, assignable: Optional[Dict[str, str]] = None) -> "CrmBackend":
        """The visible roster (assignable=false) and, optionally, a different assignable roster."""
        def answer(method, path, params, body):
            pick = assignable if (assignable is not None and str(params.get("assignable")) == "true") else users
            return {"scoped": False, "counsellors": [{"id": k, "full_name": v} for k, v in pick.items()]}
        self.admin_core.on("GET", crm_data.COUNSELLOR_OPTIONS_PATH, answer)
        return self

    # auth / notification ---------------------------------------------------------
    async def _auth_call(self, ctx_, method, path, *, body=None, params=None, timeout=20.0):
        self.auth_calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        if path.endswith("/get-basic-details"):
            return [{"id": u, "name": self.user_names[u], "face_file_id": None} for u in body or []
                    if u in self.user_names]
        return cbd.err("auth_rejected", status=404, message="Not Found")

    def on_notification(self, path: str, response: Response) -> "CrmBackend":
        self.notification_routes.insert(0, (path, response))
        return self

    async def _notification(self, ctx_, method, path, *, params=None, body=None, timeout=20.0, **_kw):
        self.notification_calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        for p, response in self.notification_routes:
            if path.startswith(p):
                return response(method, path, params or {}, body) if callable(response) else response
        return {"error": "fetch_failed", "status": 404}


def lead_row(lead_id: str, user_id: Optional[str] = "u-1", *, list_id: str = "list-1", in_scope: bool = True,
             name: str = "Priya Sharma", phone: str = "+91 98765 43210", email: str = "priya@example.com",
             status_key: Optional[str] = "NEW", owner_id: Optional[str] = None, overall_status: Optional[str] = None,
             audience_status: str = "ACTIVE", submitted_at=None, **extra: Any) -> Dict[str, Any]:
    """A row shaped like crm_data's lead SELECT."""
    row = {"lead_id": lead_id, "lead_user_id": user_id, "list_id": list_id, "list_name": "NEET 2027",
           "overall_status": overall_status, "audience_status": audience_status, "submitted_at": submitted_at,
           "updated_at": None, "source_type": "META_LEAD_ADS", "lead_status_id": None, "enquiry_id": None,
           "parent_name": name, "parent_email": email, "parent_mobile": phone, "status_key": status_key,
           "profile_id": "ulp-" + str(user_id), "conversion_status": None, "lead_tier": None, "best_score": None,
           "profile_updated_at": None, "enquiry_owner_id": owner_id, "profile_owner_id": owner_id,
           "owner_id": owner_id, "in_scope": in_scope}
    row.update(extra)
    return row


__all__ = ["INSTITUTE", "OTHER_INSTITUTE", "FakeDb", "principal", "make_ctx", "confirm_db", "FakeAdminCore",
           "FakeSql", "CrmBackend", "lead_row"]
