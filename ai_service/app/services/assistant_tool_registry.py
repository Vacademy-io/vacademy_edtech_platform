"""
Vacademy Assistant — tool registry and the AND-gate authorization engine.

Every Assistant tool is authorized by TWO independent legs, and BOTH must pass
(deny-by-default):

  1. RBAC leg     — the tool's ``required_permission`` must be present in the
                    caller's per-institute permissions (read from the JWT
                    authorities map for the pinned institute). A tool with
                    ``required_permission = None`` has no RBAC leg (used for the
                    Phase-1 help tool, which every non-learner role may use).
  2. Settings leg — the tool must be enabled for the pinned institute (and the
                    caller's role) in the institute's ``ASSISTANT_TOOLS_SETTING``.
                    When an institute has not configured the setting yet, tools
                    flagged ``default_enabled`` are on; everything else is off.

This is enforced ENTIRELY in the agent because the backend performs no
per-institute RBAC and ai_service->Java internal calls run with full service
trust. The gate is evaluated twice: once to decide which tool schemas are even
offered to the LLM, and again at dispatch time right before execution (so a
hallucinated or forced call to a disallowed tool is refused, not run).

Identity (user_id / institute_id) for every tool call is taken from the pinned
principal — never from the model-supplied arguments.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..schemas.auth import PinnedPrincipal

logger = logging.getLogger(__name__)

#: The institute-settings JSON key the Assistant reads its per-tool toggles from.
ASSISTANT_TOOLS_SETTING_KEY = "ASSISTANT_TOOLS_SETTING"

#: context_type stamped on chat_sessions created through the Assistant surface,
#: so admin Assistant sessions are never confused with learner tutor sessions.
ASSISTANT_CONTEXT_TYPE = "admin_assistant"

#: The Phase-1 how-to corpus is PRODUCT-WIDE (the steps to create a course are the
#: same for every institute), so it is ingested ONCE under this sentinel institute
#: id and the help tool always reads it here instead of the caller's institute.
#: (Per-institute custom help can be unioned in later.)
HELP_KNOWLEDGE_INSTITUTE_ID = "__global_help__"


class _StaticKeyResolver:
    """Returns pre-resolved API keys without touching the DB (for embeddings)."""

    def __init__(self, keys: tuple):
        self._keys = keys

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._keys


@dataclass
class ToolContext:
    """Runtime context handed to a tool executor. Built per call by the service."""
    db: Session
    principal: PinnedPrincipal
    keys: tuple  # pre-resolved (openrouter_key, gemini_key, model) for embeddings
    # The caller's own JWT, replayed on tools that hit normal (JWT-authenticated)
    # admin endpoints — so the REAL user identity reaches Java, and the caller can
    # never do via the assistant what they couldn't do directly in the UI.
    bearer_token: Optional[str] = None
    # The chat session this call belongs to — write tools persist their pending
    # confirmation row against it.
    session_id: Optional[str] = None
    # OUT-parameter: a WRITE tool's proposer sets this so the agent loop can emit
    # an `action_request` SSE event (incl. the nonce) to the FE. Deliberately NOT
    # part of the tool result string — the model never sees the nonce, so it can
    # never fabricate a confirmation.
    pending_action: Optional[Dict[str, Any]] = None
    # True when the caller shows a tool's base64 images to the model as images
    # (the MCP adapter). The in-product assistant stores tool results as chat
    # text, so tools leave large images out for it.
    images_as_content: bool = False
    # The tool settings this call was gated with (set by execute_tool), so a READ
    # tool can word its advice for what the caller may also do — e.g. "bind it
    # with website_edit" only to a caller who has website_edit. None = unknown,
    # which a tool must treat as "not allowed".
    gate_setting: Optional[Dict[str, Any]] = None
    gate_checked: bool = False
    # True only for calls that came in over the MCP server (set by the adapter).
    # ``mcp_only`` tools refuse every other caller, whatever the settings say.
    via_mcp: bool = False
    # The MCP OAuth client this call came through (set by the adapter; None in
    # product), so a confirm token can be bound to the connection that saw the preview.
    client_id: Optional[str] = None
    # The institute's module entitlements (app/services/entitlements.py), loaded
    # once per call by ``context_entitlements`` — never shared across calls.
    entitlements: Optional[Any] = None

    def may_use(self, tool_name: str) -> bool:
        """True iff this caller may also call ``tool_name`` (same gates as execute_tool)."""
        spec = ASSISTANT_TOOLS.get(tool_name)
        if spec is not None and spec.mcp_only and not self.via_mcp:
            return False
        return self.gate_checked and is_tool_allowed(tool_name, self.principal, self.gate_setting)


# Executor signature: async (args: dict, ctx: ToolContext) -> str
ToolExecutor = Callable[[Dict[str, Any], ToolContext], Awaitable[str]]


@dataclass
class ToolSpec:
    """One Assistant tool: its LLM-facing schema, executor, and gating metadata."""
    name: str
    schema: Dict[str, Any]            # OpenAI function-calling schema (offered to the LLM)
    executor: ToolExecutor
    required_permission: Optional[str] = None  # RBAC leg; None = no permission required
    setting_key: Optional[str] = None          # Settings-leg key; defaults to ``name``
    # A resolver used by SEVERAL groups (e.g. find_batch) lists them here — the
    # Settings leg passes if ANY of these groups is enabled for the caller.
    setting_keys_any: Optional[List[str]] = None
    default_enabled: bool = False              # on for EVERY role when no ASSISTANT_TOOLS_SETTING
    default_roles: Optional[List[str]] = None  # on for THESE roles when no setting (e.g. ["ADMIN"])
    phase: int = 1                             # roadmap phase (1=help, 2=read, 3=write)
    mode: str = "READ"                         # READ | WRITE
    # Skips the Settings leg entirely: on for everyone who may use the
    # assistant/MCP at all, and not offered as a toggle. Reserved for tools that
    # reveal nothing beyond the caller's own identity (whoami).
    always_allowed: bool = False
    # Exposed only over MCP (an AI app with its own tools, e.g. Figma reads):
    # never offered to the in-product assistant's model.
    mcp_only: bool = False
    # The institute's plan (module entitlements, V567) must include
    # ``module_feature`` (e.g. "crm.leads") when set, and at least one of
    # ``module_features_any`` when set; otherwise the tool is not listed and
    # refuses calls with module_not_enabled. Both None = not tied to a module.
    module_feature: Optional[str] = None
    module_features_any: Optional[Tuple[str, ...]] = None

    def key(self) -> str:
        return self.setting_key or self.name

    def keys_any(self) -> List[str]:
        return self.setting_keys_any or [self.key()]


# ──────────────────────────────────────────────────────────────────────────
# Phase-1 tool: search_help_knowledge (role-scoped how-to retrieval over RAG)
# ──────────────────────────────────────────────────────────────────────────

_SEARCH_HELP_KNOWLEDGE_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "search_help_knowledge",
        "description": (
            "Search Vacademy's how-to knowledge base for step-by-step instructions on "
            "how and where to perform a task in the admin portal (e.g. 'how do I create a "
            "course', 'where do I add a learner to a batch'). Use this for any "
            "how-to / where-to question before answering. Returns matching help articles "
            "with their steps and the in-app route to navigate to."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The user's how-to question, in natural language.",
                },
            },
            "required": ["query"],
        },
    },
}


async def _execute_search_help_knowledge(args: Dict[str, Any], ctx: ToolContext) -> str:
    """Role-scoped retrieval over the 'help_knowledge' corpus in pgvector."""
    query = str((args or {}).get("query") or "").strip()
    if not query:
        return json.dumps({"results": [], "note": "No query was provided."})

    # Imported here to avoid a heavy import at module load.
    from .embedding_service import EmbeddingService
    from .rag_service import RAGService

    try:
        embedding_service = EmbeddingService(_StaticKeyResolver(ctx.keys))
        rag = RAGService(ctx.db, embedding_service)
        # Search BOTH the product-wide global corpus and any institute-specific
        # help, then merge. This makes retrieval robust to which institute the
        # corpus was ingested under (global sentinel vs the caller's institute).
        institute_ids = [HELP_KNOWLEDGE_INSTITUTE_ID]
        if ctx.principal.institute_id and ctx.principal.institute_id != HELP_KNOWLEDGE_INSTITUTE_ID:
            institute_ids.append(ctx.principal.institute_id)
        merged: Dict[Any, Dict[str, Any]] = {}
        for iid in institute_ids:
            for r in await rag.search(
                query=query,
                institute_id=iid,
                top_k=5,
                similarity_threshold=0.3,
                source_type="help_knowledge",
                roles=ctx.principal.roles or None,
            ):
                k = r.get("source_id") or r.get("content_text")
                if k not in merged or (r.get("similarity_score") or 0) > (merged[k].get("similarity_score") or 0):
                    merged[k] = r
        rows = sorted(merged.values(), key=lambda r: r.get("similarity_score") or 0, reverse=True)[:5]
    except Exception as e:  # never leak internals to the model
        logger.warning("search_help_knowledge failed: %s", e)
        return json.dumps({"results": [], "note": "Help search is temporarily unavailable."})

    if not rows:
        return json.dumps({
            "results": [],
            "note": "No matching help article was found. Tell the user you don't have a "
                    "documented procedure for this and avoid inventing steps.",
        })

    results = []
    for r in rows:
        meta = r.get("metadata") or {}
        results.append({
            "task": meta.get("task"),
            "route_path": meta.get("route_path"),
            "steps": r.get("content_text"),
            "similarity": r.get("similarity_score"),
        })
    return json.dumps({"results": results})


# ──────────────────────────────────────────────────────────────────────────
# Phase-2 tools: find_learner (resolver) + get_student_360 (data aggregate).
# ──────────────────────────────────────────────────────────────────────────

_FIND_LEARNER_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "find_learner",
        "description": (
            "Find ENROLLED learners/students in this institute by ONE free-text query — "
            "matches name, email, phone number, username, or enrollment number. Use this "
            "FIRST whenever the user names a learner and the page context does not already "
            "identify them. If more than one learner matches, list the matches and ask "
            "the user which one they mean — never guess. NEVER use this for leads, "
            "enquiries, or prospects — those are different records this tool cannot see."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The learner's name / email / phone / enrollment number.",
                },
                "statuses": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Enrollment statuses to include. Default ['ACTIVE']; "
                                   "widen to ['ACTIVE','INACTIVE','INVITED'] if nothing is found.",
                },
            },
            "required": ["query"],
        },
    },
}

_STUDENT_360_MODULES = [
    "attendance", "live_classes", "academics", "activity",
    "progress", "certificates", "assignments", "doubts", "login",
]

_GET_STUDENT_360_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_student_360",
        "description": (
            "Fetch a learner's data for SPECIFIC modules: attendance (live-class "
            "presence %), live_classes (attended/missed), academics (assessment scores "
            "vs batch — SLOW, request only when asked about tests/scores), activity "
            "(study time & habits), progress (course completion), certificates, "
            "assignments, doubts, login (last login & session time). Request ONLY the "
            "modules the question needs. Requires the learner's user id — from the page "
            "context's selected student or a prior find_learner result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {
                    "type": "string",
                    "description": "The learner's user_id (NOT their name).",
                },
                "modules": {
                    "type": "array",
                    "items": {"type": "string", "enum": _STUDENT_360_MODULES},
                    "description": "Only the modules the question actually needs (1-3 usually).",
                },
                "batch_id": {
                    "type": "string",
                    "description": "Optional package_session_id to scope attendance/progress "
                                   "(from page context or the find_learner result).",
                },
                "start_date": {"type": "string", "description": "YYYY-MM-DD. Default: 30 days ago."},
                "end_date": {"type": "string", "description": "YYYY-MM-DD. Default: today."},
            },
            "required": ["target_user_id", "modules"],
        },
    },
}


def _mask_mobile(mobile: Optional[str]) -> Optional[str]:
    if not mobile:
        return None
    digits = str(mobile)
    return ("*" * max(0, len(digits) - 4)) + digits[-4:]


async def _execute_find_learner(args: Dict[str, Any], ctx: ToolContext) -> str:
    """Search learners within the pinned institute via the students-list endpoint.

    Calls the normal admin endpoint WITH THE CALLER'S OWN JWT — the caller can
    only see what they could already see in the portal. institute_ids is forced
    from the pinned principal; the response is reduced to a compact projection
    (never the full row: no address, parent contacts, or custom fields).
    """
    import httpx
    from ..config import get_settings

    query = str((args or {}).get("query") or "").strip()
    if not query:
        return json.dumps({"matches": [], "note": "No search query was provided."})
    if not ctx.bearer_token:
        return json.dumps({"error": "no_auth", "message": "Learner search is unavailable right now."})

    statuses = args.get("statuses") or ["ACTIVE"]
    settings = get_settings()
    url = (
        f"{settings.admin_core_service_base_url}"
        "/admin-core-service/institute/institute_learner/get/v2/all"
    )
    body = {
        "name": query,
        "institute_ids": [ctx.principal.institute_id],  # forced — never model-supplied
        "statuses": [str(s) for s in statuses][:6],
        "package_session_ids": [],
        "group_ids": [],
        "gender": [],
        "sort_columns": {},
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                params={"pageNo": 0, "pageSize": 10},
                json=body,
                headers=_jwt_headers(ctx),
            )
        if resp.status_code != 200:
            logger.warning("find_learner: %s from students-list (%s)", resp.status_code, resp.text[:200])
            return json.dumps({"error": "search_failed", "status": resp.status_code})
        data = resp.json() or {}
    except Exception as e:
        logger.warning("find_learner failed: %s", e)
        return json.dumps({"error": "search_failed"})

    matches = []
    for row in (data.get("content") or [])[:10]:
        matches.append({
            "user_id": row.get("user_id"),
            "full_name": row.get("full_name"),
            "email": row.get("email"),
            "mobile": _mask_mobile(row.get("mobile_number")),
            "enrollment_no": row.get("institute_enrollment_number"),
            "status": row.get("status"),
            "payment_status": row.get("payment_status"),
            "package_session_id": row.get("package_session_id"),
            "expiry_date": row.get("expiry_date"),
        })
    return json.dumps({
        "matches": matches,
        "total_matches": data.get("total_elements", len(matches)),
        "note": "If more than one match, ask the user which learner they mean." if len(matches) > 1 else None,
    })


_FIND_BATCH_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "find_batch",
        "description": (
            "Resolve a batch / course / class NAME (e.g. 'NEET 2026 Morning', 'Class 10 "
            "Science') to its batch id (package_session_id) plus the enrolled count. Use "
            "this whenever a tool needs a batch id and the user gave a name. If several "
            "batches match, list them and ask which one — never guess."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The batch/course name as the user said it."},
            },
            "required": ["query"],
        },
    },
}

#: batches of the pinned institute matching a name fragment, most-enrolled first.
_FIND_BATCH_SQL = """
SELECT ps.id,
       TRIM(CONCAT(l.level_name, ' ', p.package_name, ' (', s.session_name, ')')) AS batch_name,
       ps.status,
       (SELECT COUNT(*) FROM student_session_institute_group_mapping ssigm
         WHERE ssigm.package_session_id = ps.id
           AND ssigm.institute_id = :inst AND ssigm.status = 'ACTIVE') AS enrolled
FROM package_session ps
JOIN package_institute pi ON ps.package_id = pi.package_id
JOIN package p ON ps.package_id = p.id
JOIN level l ON ps.level_id = l.id
JOIN session s ON ps.session_id = s.id
WHERE pi.institute_id = :inst
  AND ps.status NOT IN ('DELETED')
  AND (LOWER(p.package_name) LIKE :q OR LOWER(l.level_name) LIKE :q
       OR LOWER(s.session_name) LIKE :q
       OR LOWER(CONCAT(l.level_name, ' ', p.package_name, ' ', s.session_name)) LIKE :q)
ORDER BY enrolled DESC
LIMIT 10
"""


async def _execute_find_batch(args: Dict[str, Any], ctx: ToolContext) -> str:
    """Name → package_session_id resolver over the shared admin_core DB (always
    scoped to the pinned institute via the package_institute join)."""
    from sqlalchemy import text as sql_text

    query = str((args or {}).get("query") or "").strip().lower()
    if not query:
        return json.dumps({"matches": [], "note": "No batch name was provided."})
    try:
        rows = ctx.db.execute(
            sql_text(_FIND_BATCH_SQL),
            {"inst": ctx.principal.institute_id, "q": f"%{query}%"},
        ).fetchall()
    except Exception as e:
        logger.warning("find_batch failed: %s", e)
        return json.dumps({"error": "search_failed"})
    matches = [
        {"package_session_id": r[0], "batch_name": r[1], "status": r[2], "enrolled": int(r[3] or 0)}
        for r in rows
    ]
    return json.dumps({
        "matches": matches,
        "note": ("If more than one match, ask the user which batch they mean." if len(matches) > 1
                 else ("No batch matched — ask the user for the exact batch name." if not matches else None)),
    })


def _batch_name_in_institute(ctx: ToolContext, package_session_id: str) -> Optional[str]:
    """The human-readable name of a batch IF it belongs to the pinned institute
    (None otherwise) — used to validate + label write proposals."""
    from sqlalchemy import text as sql_text
    try:
        row = ctx.db.execute(
            sql_text(
                "SELECT TRIM(CONCAT(l.level_name, ' ', p.package_name, ' (', s.session_name, ')')) "
                "FROM package_session ps "
                "JOIN package_institute pi ON ps.package_id = pi.package_id "
                "JOIN package p ON ps.package_id = p.id "
                "JOIN level l ON ps.level_id = l.id "
                "JOIN session s ON ps.session_id = s.id "
                "WHERE ps.id = :psid AND pi.institute_id = :inst LIMIT 1"
            ),
            {"psid": package_session_id, "inst": ctx.principal.institute_id},
        ).first()
        return row[0] if row else None
    except Exception as e:
        logger.warning("batch name lookup failed: %s", e)
        return None


def _prune_nulls(obj: Any) -> Any:
    """Drop null values / empty dicts from the report so the LLM context stays lean."""
    if isinstance(obj, dict):
        pruned = {k: _prune_nulls(v) for k, v in obj.items() if v is not None}
        return {k: v for k, v in pruned.items() if v not in (None, {}, [])}
    if isinstance(obj, list):
        return [_prune_nulls(v) for v in obj if v is not None]
    return obj


async def _execute_get_student_360(args: Dict[str, Any], ctx: ToolContext) -> str:
    """Synchronous Layer-1 student report (selected modules) via the internal endpoint.

    The internal endpoint verifies the target learner belongs to the pinned
    institute (404 otherwise), so a session pinned to institute A can never read
    institute B's learners even though the call carries service-level trust.
    """
    import httpx
    from ..config import get_settings
    from .internal_auth import internal_auth_headers

    target_user_id = str((args or {}).get("target_user_id") or "").strip()
    if not target_user_id:
        return json.dumps({"error": "missing_target", "message": "target_user_id is required."})

    modules = [m for m in (args.get("modules") or []) if m in _STUDENT_360_MODULES]
    if not modules:
        return json.dumps({"error": "missing_modules",
                           "message": f"Pick 1-3 modules from: {', '.join(_STUDENT_360_MODULES)}."})

    settings = get_settings()
    params: Dict[str, Any] = {
        "userId": target_user_id,
        "instituteId": ctx.principal.institute_id,  # forced — never model-supplied
        "modules": ",".join(modules),
    }
    if args.get("batch_id"):
        params["batchId"] = str(args["batch_id"])
    if args.get("start_date"):
        params["startDate"] = str(args["start_date"])
    if args.get("end_date"):
        params["endDate"] = str(args["end_date"])

    url = f"{settings.admin_core_service_base_url}/admin-core-service/internal/student-analysis/student-360"
    try:
        headers = await internal_auth_headers()
        async with httpx.AsyncClient(timeout=65.0) as client:
            resp = await client.get(url, params=params, headers=headers)
        if resp.status_code == 404:
            return json.dumps({"error": "not_found",
                               "message": "This learner has no enrollment in your institute."})
        if resp.status_code != 200:
            logger.warning("get_student_360: %s (%s)", resp.status_code, resp.text[:200])
            return json.dumps({"error": "fetch_failed", "status": resp.status_code})
        report = resp.json() or {}
    except Exception as e:
        logger.warning("get_student_360 failed: %s", e)
        return json.dumps({"error": "fetch_failed"})

    return json.dumps(_prune_nulls(report))


# ──────────────────────────────────────────────────────────────────────────
# Phase-2b tools: payments, batch roster, schedule, institute overview,
# trigger-full-report. All call EXISTING admin endpoints with the caller's own
# JWT (institute/user identity forced from the pinned principal).
# ──────────────────────────────────────────────────────────────────────────

def _jwt_headers(ctx: ToolContext) -> Dict[str, str]:
    """Auth headers for normal (JWT) admin endpoints: the caller's own token plus
    the pinned institute as clientId (Java's JwtAuthFilter keys the user lookup
    on `${clientId}@${username}`)."""
    return {
        "Authorization": f"Bearer {ctx.bearer_token}",
        "clientId": ctx.principal.institute_id,
    }


def _compact(obj: Any, max_items: int = 15, max_str: int = 300) -> Any:
    """Shape-agnostic trim for tool results: drop nulls, cap list lengths, and
    truncate long strings so unverified response shapes can't flood the context."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            c = _compact(v, max_items, max_str)
            if c not in (None, {}, []):
                out[k] = c
        return out
    if isinstance(obj, list):
        trimmed = [_compact(v, max_items, max_str) for v in obj[:max_items]]
        trimmed = [v for v in trimmed if v not in (None, {}, [])]
        if len(obj) > max_items:
            trimmed.append({"_truncated": f"{len(obj) - max_items} more items omitted"})
        return trimmed
    if isinstance(obj, str) and len(obj) > max_str:
        return obj[:max_str] + "…"
    return obj


async def _service_json(
    ctx: ToolContext,
    method: str,
    base_url: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
    timeout: float = 20.0,
    error_detail: bool = False,
) -> Any:
    """
    One JWT-authenticated call to a backend service; returns parsed JSON or an error dict.
    ``error_detail`` also puts the start of a non-200 answer's body in the error dict
    (``detail``), for callers that tell one 409 from another.
    """
    import httpx

    if not ctx.bearer_token:
        return {"error": "no_auth", "message": "This lookup is unavailable right now."}
    url = f"{base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method, url, params=params, json=body, headers=_jwt_headers(ctx)
            )
        if resp.status_code != 200:
            logger.warning("assistant %s %s -> %s (%s)", method, path, resp.status_code, resp.text[:150])
            if error_detail:
                return {"error": "fetch_failed", "status": resp.status_code, "detail": resp.text[:500]}
            return {"error": "fetch_failed", "status": resp.status_code}
        try:
            return resp.json()
        except ValueError:
            # Some Java endpoints answer a bare string (an id, a URL) — hand it back as text.
            return resp.text.strip()
    except Exception as e:
        logger.warning("assistant %s %s failed: %s", method, path, e)
        return {"error": "fetch_failed"}


async def _admin_core_json(ctx: ToolContext, method: str, path: str, **kw: Any) -> Any:
    from ..config import get_settings
    return await _service_json(ctx, method, get_settings().admin_core_service_base_url, path, **kw)


async def _assessment_json(ctx: ToolContext, method: str, path: str, **kw: Any) -> Any:
    from ..config import get_settings
    return await _service_json(ctx, method, get_settings().assessment_service_base_url, path, **kw)


async def _auth_json(ctx: ToolContext, method: str, path: str, **kw: Any) -> Any:
    from ..config import get_settings
    return await _service_json(ctx, method, get_settings().auth_service_base_url, path, **kw)


async def _notification_json(ctx: ToolContext, method: str, path: str, **kw: Any) -> Any:
    from ..config import get_settings
    return await _service_json(ctx, method, get_settings().notification_service_base_url, path, **kw)


_GET_PAYMENT_HISTORY_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_payment_history",
        "description": (
            "A learner's payment TRANSACTIONS (what was actually paid, when, via which "
            "gateway). Use for 'did they pay / when / how much was the last payment'. "
            "For outstanding balance or overdue installments use get_fee_dues instead."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {"type": "string", "description": "The learner's user_id."},
                "payment_statuses": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Optional filter, e.g. ['PAID','FAILED','PENDING'].",
                },
            },
            "required": ["target_user_id"],
        },
    },
}


async def _execute_get_payment_history(args: Dict[str, Any], ctx: ToolContext) -> str:
    target = str((args or {}).get("target_user_id") or "").strip()
    if not target:
        return json.dumps({"error": "missing_target"})
    body: Dict[str, Any] = {
        "institute_id": ctx.principal.institute_id,  # forced
        "user_id": target,
    }
    if args.get("payment_statuses"):
        body["payment_statuses"] = [str(s) for s in args["payment_statuses"]][:6]
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/user-plan/payment-logs",
        params={"pageNo": 0, "pageSize": 10}, body=body,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    items = []
    for row in (data.get("content") or [])[:10]:
        log_ = row.get("payment_log") or {}
        plan = (row.get("user_plan") or {}).get("payment_plan_dto") or {}
        items.append({
            "date": log_.get("date"),
            "amount": log_.get("payment_amount"),
            "currency": log_.get("currency"),
            "status": log_.get("payment_status") or log_.get("status"),
            "vendor": log_.get("vendor"),
            "transaction_id": log_.get("transaction_id"),
            "plan": plan.get("name"),
        })
    total = data.get("totalElements", data.get("total_elements", len(items)))
    return json.dumps({"payments": items, "total_transactions": total})


_GET_FEE_DUES_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_fee_dues",
        "description": (
            "A learner's fee DUES: total expected/paid/outstanding and per-installment "
            "rows with due dates and overdue flags. Use for 'has X cleared fees / what's "
            "outstanding / is anything overdue'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {"type": "string", "description": "The learner's user_id."},
                "status": {
                    "type": "string",
                    "description": "Optional: 'OVERDUE' to list only overdue installments.",
                },
            },
            "required": ["target_user_id"],
        },
    },
}


async def _execute_get_fee_dues(args: Dict[str, Any], ctx: ToolContext) -> str:
    target = str((args or {}).get("target_user_id") or "").strip()
    if not target:
        return json.dumps({"error": "missing_target"})
    body: Dict[str, Any] = {"fetch_all": True}
    if args.get("status"):
        body["status"] = str(args["status"])
    data = await _admin_core_json(
        ctx, "POST", f"/admin-core-service/v1/admin/student-fee/{target}/dues",
        params={"instituteId": ctx.principal.institute_id}, body=body,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    installments = []
    for r in (data.get("content") or [])[:15]:
        installments.append({
            "fee": r.get("fee_type_name") or r.get("cpo_name"),
            "expected": r.get("amount_expected"),
            "paid": r.get("amount_paid"),
            "due": r.get("amount_due"),
            "due_date": r.get("due_date"),
            "status": r.get("status"),
            "is_overdue": r.get("is_overdue"),
            "days_overdue": r.get("days_overdue"),
        })
    return json.dumps({
        "total_fee": data.get("total_fee"),
        "total_paid": data.get("total_paid"),
        "total_due": data.get("total_due"),
        "installments": installments,
    })


_GET_SUBSCRIPTION_PLANS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_subscription_plans",
        "description": (
            "A learner's enrollment payment plans/subscriptions (plan name, price, "
            "status, validity window). Use for 'what plan is X on / when does it end'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {"type": "string", "description": "The learner's user_id."},
            },
            "required": ["target_user_id"],
        },
    },
}


async def _execute_get_subscription_plans(args: Dict[str, Any], ctx: ToolContext) -> str:
    target = str((args or {}).get("target_user_id") or "").strip()
    if not target:
        return json.dumps({"error": "missing_target"})
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/user-plan/all",
        params={"pageNo": 0, "pageSize": 10},
        body={"user_id": target, "institute_id": ctx.principal.institute_id},
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    plans = []
    for row in (data.get("content") or [])[:10]:
        plan = row.get("payment_plan_dto") or {}
        option = row.get("payment_option") or {}
        plans.append({
            "plan": plan.get("name"),
            "price": plan.get("actual_price"),
            "currency": plan.get("currency"),
            "option": option.get("name"),
            "option_type": option.get("type"),
            "status": row.get("status"),
            "start_date": row.get("start_date"),
            "end_date": row.get("end_date"),
        })
    return json.dumps({"plans": plans})


_LIST_BATCH_LEARNERS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "list_batch_learners",
        "description": (
            "The learners enrolled in one batch (roster + total count). Use for 'who is "
            "in batch X / how many active learners'. Needs the batch's "
            "package_session_id (from page context or a find_learner result)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "package_session_id": {"type": "string", "description": "The batch id."},
                "statuses": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Default ['ACTIVE'].",
                },
                "page": {"type": "integer", "description": "0-based page (20 per page)."},
            },
            "required": ["package_session_id"],
        },
    },
}


async def _execute_list_batch_learners(args: Dict[str, Any], ctx: ToolContext) -> str:
    batch = str((args or {}).get("package_session_id") or "").strip()
    if not batch:
        return json.dumps({"error": "missing_batch"})
    statuses = [str(s) for s in (args.get("statuses") or ["ACTIVE"])][:6]
    page = int(args.get("page") or 0)
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/institute/institute_learner/get/v2/all",
        params={"pageNo": page, "pageSize": 20},
        body={
            "institute_ids": [ctx.principal.institute_id],  # forced
            "package_session_ids": [batch],
            "statuses": statuses,
            "group_ids": [], "gender": [], "sort_columns": {},
        },
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    learners = []
    for row in (data.get("content") or [])[:20]:
        learners.append({
            "user_id": row.get("user_id"),
            "full_name": row.get("full_name"),
            "enrollment_no": row.get("institute_enrollment_number"),
            "status": row.get("status"),
            "payment_status": row.get("payment_status"),
        })
    total = data.get("totalElements", data.get("total_elements", len(learners)))
    return json.dumps({"learners": learners, "total": total, "page": page})


_GET_CLASS_SCHEDULE_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_class_schedule",
        "description": (
            "Live-class schedule for this institute: scope 'live' = classes running "
            "right now, 'upcoming' = the upcoming schedule (grouped by date), 'mine' = "
            "the classes assigned to the person asking. Use for 'what classes are on "
            "today / what do I have today / is anything live right now'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["live", "upcoming", "mine"]},
            },
            "required": ["scope"],
        },
    },
}


async def _execute_get_class_schedule(args: Dict[str, Any], ctx: ToolContext) -> str:
    scope = str((args or {}).get("scope") or "upcoming")
    if scope == "mine":
        path, params = "/admin-core-service/get-sessions/by-user-id", {"userId": ctx.principal.user_id}
    elif scope == "live":
        path, params = "/admin-core-service/get-sessions/live", {"instituteId": ctx.principal.institute_id}
    else:
        path, params = "/admin-core-service/get-sessions/upcoming", {"instituteId": ctx.principal.institute_id}
    data = await _admin_core_json(ctx, "GET", path, params=params)
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    return json.dumps({"scope": scope, "schedule": _compact(data, max_items=12, max_str=200)})


_GET_INSTITUTE_OVERVIEW_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_institute_overview",
        "description": (
            "Institute-level snapshot. sections: 'profile' (the institute's name, logo, theme, "
            "contact details, portal URLs and its own terminology — e.g. what it calls a course), "
            "'outstanding_fees' (total overdue amount + count across the institute), 'live_now' "
            "(classes running right now), 'enrollment_counts' (active learner count). Use 'profile' "
            "to address the institute by its own name and vocabulary; the others for 'how much fees "
            "is pending overall / how many active learners do we have'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "sections": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["profile", "outstanding_fees", "live_now", "enrollment_counts"]},
                },
            },
            "required": ["sections"],
        },
    },
}


async def _media_public_url(ctx: ToolContext, file_id: Optional[str]) -> Optional[str]:
    """A public URL for a media-service file id, or None. (The endpoint answers plain text.)"""
    if not file_id or not ctx.bearer_token:
        return None
    import httpx
    from ..config import get_settings
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{get_settings().media_server_base_url}/media-service/get-public-url",
                params={"fileId": file_id}, headers=_jwt_headers(ctx),
            )
        url = resp.text.strip().strip('"') if resp.status_code == 200 else ""
        return url if url.startswith("http") else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("media public url lookup failed for %s: %s", file_id, exc)
        return None


def _terminology_from_setting(setting_json: Any) -> Dict[str, str]:
    """NAMING_SETTING → {"Course": "Program", …}: only the words the institute renamed."""
    try:
        blob = json.loads(setting_json) if isinstance(setting_json, str) else (setting_json or {})
        rows = (((blob.get("setting") or {}).get("NAMING_SETTING") or {}).get("data") or {}).get("data") or []
    except (ValueError, AttributeError):
        return {}
    out: Dict[str, str] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        key, custom, system = r.get("key"), r.get("customValue"), r.get("systemValue")
        if key and custom and custom != (system or key):
            out[str(key)] = str(custom)
    return out


async def load_institute_profile(ctx: ToolContext) -> Dict[str, Any]:
    """
    Who the institute is: name, logo, theme, contact, portals, terminology.

    White-label institutes are their OWN brand to their staff; an assistant that
    says "Vacademy" to a Shiksha Nation admin is wrong. This is what tools and
    the MCP server hand the model so it speaks in the institute's name.
    """
    data = await _admin_core_json(
        ctx, "GET", f"/admin-core-service/institute/v1/details-non-batches/{ctx.principal.institute_id}",
        timeout=15.0,
    )
    if not isinstance(data, dict) or data.get("error"):
        return {"id": ctx.principal.institute_id, "error": "profile_unavailable"}
    logo_url = await _media_public_url(ctx, data.get("institute_logo_file_id"))
    profile = {
        "id": ctx.principal.institute_id,
        "name": data.get("institute_name"),
        "logo_url": logo_url,
        "theme": data.get("institute_theme_code"),
        "email": data.get("email"),
        "address": data.get("address"),
        "website_url": data.get("website_url"),
        "learner_portal_url": data.get("learner_portal_url"),
        "admin_portal_url": data.get("admin_portal_url"),
        "terminology": _terminology_from_setting(data.get("setting")) or None,
    }
    return {k: v for k, v in profile.items() if v not in (None, "", {})}


async def _execute_get_institute_overview(args: Dict[str, Any], ctx: ToolContext) -> str:
    sections = [s for s in (args.get("sections") or []) if isinstance(s, str)]
    out: Dict[str, Any] = {}
    if "profile" in sections:
        out["profile"] = await load_institute_profile(ctx)
    if "outstanding_fees" in sections:
        # Audit fix 2026-07-16: the earlier source (adjustment/pending) only
        # covered installments awaiting a concession/penalty decision, badly
        # undercounting. The collection dashboard is the true institute total.
        data = await _admin_core_json(
            ctx, "POST", "/admin-core-service/v1/admin/student-fee/dashboard/collection",
            body={"instituteId": ctx.principal.institute_id}, timeout=30.0,
        )
        if isinstance(data, dict) and not data.get("error"):
            out["outstanding_fees"] = {
                "overdue_total": data.get("totalOverdue"),
                "collected_to_date": data.get("collectedToDate"),
                "expected_to_date": data.get("expectedToDate"),
                "note": "Use search_fee_records to list WHICH learners are overdue.",
            }
        else:
            out["outstanding_fees"] = data  # error dict
    if "live_now" in sections:
        data = await _admin_core_json(
            ctx, "GET", "/admin-core-service/get-sessions/live",
            params={"instituteId": ctx.principal.institute_id},
        )
        out["live_now"] = _compact(data, max_items=8, max_str=150)
    if "enrollment_counts" in sections:
        data = await _admin_core_json(
            ctx, "POST", "/admin-core-service/institute/institute_learner/get/v2/all",
            params={"pageNo": 0, "pageSize": 1},
            body={"institute_ids": [ctx.principal.institute_id], "statuses": ["ACTIVE"],
                  "package_session_ids": [], "group_ids": [], "gender": [], "sort_columns": {}},
        )
        if isinstance(data, dict) and not data.get("error"):
            out["enrollment_counts"] = {
                "active_learners": data.get("totalElements", data.get("total_elements"))
            }
        else:
            out["enrollment_counts"] = data
    return json.dumps(out or {"error": "no_sections"})


_TRIGGER_FULL_REPORT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "trigger_full_report",
        "description": (
            "Start generating a learner's FULL analysis report (all modules, with AI "
            "narrative — runs in the background, takes a few minutes, may spend AI "
            "credits). Offer this when a quick answer isn't enough. The report appears "
            "under the learner's Reports tab and notifies when ready."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {"type": "string", "description": "The learner's user_id."},
                "batch_id": {"type": "string", "description": "Optional package_session_id."},
                "start_date": {"type": "string", "description": "YYYY-MM-DD. Default: 30 days ago."},
                "end_date": {"type": "string", "description": "YYYY-MM-DD. Default: today."},
            },
            "required": ["target_user_id"],
        },
    },
}


async def _execute_trigger_full_report(args: Dict[str, Any], ctx: ToolContext) -> str:
    from datetime import date, timedelta

    target = str((args or {}).get("target_user_id") or "").strip()
    if not target:
        return json.dumps({"error": "missing_target"})
    end = str(args.get("end_date") or date.today().isoformat())
    start = str(args.get("start_date") or (date.today() - timedelta(days=30)).isoformat())
    body: Dict[str, Any] = {
        "user_id": target,
        "institute_id": ctx.principal.institute_id,  # forced
        "start_date_iso": start,
        "end_date_iso": end,
        "report_version": "v2",
        "send_email": True,
    }
    if args.get("batch_id"):
        body["package_session_id"] = str(args["batch_id"])
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/student-analysis/initiate", body=body
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    return json.dumps({
        "process_id": data.get("process_id"),
        "status": data.get("status"),
        "note": "Report generation started in the background — it will appear in the learner's "
                "Reports tab and the requester is notified when it's ready.",
    })


# ──────────────────────────────────────────────────────────────────────────
# Audit roadmap 4–6 (2026-07-16): institute-wide LIST/aggregate reads.
# ──────────────────────────────────────────────────────────────────────────

_SEARCH_FEE_RECORDS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "search_fee_records",
        "description": (
            "Institute-WIDE fee records, one row per learner+fee-plan with expected/"
            "paid/due/overdue amounts and a status. Use for 'which learners have "
            "overdue or unpaid fees', 'who hasn't paid this month', 'biggest "
            "defaulters'. For ONE known learner use get_fee_dues instead."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "statuses": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["OVERDUE", "PENDING", "PARTIAL", "PAID"]},
                    "description": "Filter by fee status. Default ['OVERDUE'].",
                },
                "batch_ids": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Optional package_session_ids (from find_batch).",
                },
                "due_start": {"type": "string", "description": "Optional due-date window start, YYYY-MM-DD."},
                "due_end": {"type": "string", "description": "Optional due-date window end, YYYY-MM-DD."},
                "name": {"type": "string", "description": "Optional learner name/text search."},
                "sort_by": {
                    "type": "string",
                    "enum": ["dueDate", "overdueAmount", "dueAmount", "totalPaidAmount", "studentName"],
                    "description": "Default dueDate.",
                },
                "page": {"type": "integer", "description": "0-based page (15 rows per page)."},
            },
            "required": [],
        },
    },
}


async def _execute_search_fee_records(args: Dict[str, Any], ctx: ToolContext) -> str:
    filters: Dict[str, Any] = {
        "statuses": [str(s) for s in (args.get("statuses") or ["OVERDUE"])][:4],
    }
    if args.get("batch_ids"):
        filters["packageSessionIds"] = [str(b) for b in args["batch_ids"]][:10]
    if args.get("due_start") or args.get("due_end"):
        filters["dueDateRange"] = {
            "startDate": str(args.get("due_start") or ""),
            "endDate": str(args.get("due_end") or ""),
        }
    if args.get("name"):
        filters["studentSearchQuery"] = str(args["name"])[:80]
    # NB this endpoint's request body is camelCase (no @JsonNaming on the DTO);
    # the response rows are snake_case.
    body = {
        "page": max(0, int(args.get("page") or 0)),
        "size": 15,
        "sortBy": str(args.get("sort_by") or "dueDate"),
        "sortDirection": "DESC",
        "filters": filters,
    }
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/admin/student-fee/search",
        params={"instituteId": ctx.principal.institute_id},  # forced
        body=body, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    rows = []
    for r in (data.get("content") or [])[:15]:
        rows.append({
            "user_id": r.get("student_id"),
            "name": r.get("student_name"),
            "mobile": _mask_mobile(r.get("phone")),
            "fee_plan": r.get("cpo_name"),
            "expected": r.get("total_expected_amount"),
            "paid": r.get("total_paid_amount"),
            "due": r.get("due_amount"),
            "overdue": r.get("overdue_amount"),
            "status": r.get("status"),
        })
    total = data.get("totalElements", data.get("total_elements", len(rows)))
    return json.dumps({"fee_records": rows, "total_matching": total,
                       "note": "One row per learner + fee plan."})


_GET_COLLECTIONS_SUMMARY_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_collections_summary",
        "description": (
            "Money COLLECTED. Without dates: cumulative collections dashboard "
            "(projected/expected/collected to date, total overdue, per-batch and "
            "per-gateway breakdown). With start_date+end_date: actual PAID "
            "transactions in that window, summed. Use for 'how much did we collect "
            "this week/month' (pass dates) or 'overall collections picture' (no dates)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "YYYY-MM-DD (with end_date → windowed sum)."},
                "end_date": {"type": "string", "description": "YYYY-MM-DD."},
            },
            "required": [],
        },
    },
}


async def _execute_get_collections_summary(args: Dict[str, Any], ctx: ToolContext) -> str:
    start = str((args or {}).get("start_date") or "").strip()
    end = str((args or {}).get("end_date") or "").strip()
    if start and end:
        # Windowed: page through PAID payment-logs and sum client-side (the
        # endpoint returns transactions, not a server-side aggregate).
        totals: Dict[str, float] = {}
        count = 0
        sample = []
        for page in range(5):  # hard cap: 5 × 100 transactions
            data = await _admin_core_json(
                ctx, "POST", "/admin-core-service/v1/user-plan/payment-logs",
                params={"pageNo": page, "pageSize": 100},
                body={
                    "institute_id": ctx.principal.institute_id,  # forced
                    "payment_statuses": ["PAID"],
                    "start_date_in_utc": f"{start}T00:00:00",
                    "end_date_in_utc": f"{end}T23:59:59",
                },
                timeout=30.0,
            )
            if isinstance(data, dict) and data.get("error"):
                return json.dumps(data)
            content = data.get("content") or []
            for row in content:
                log_ = row.get("payment_log") or {}
                cur = str(log_.get("currency") or "INR")
                totals[cur] = round(totals.get(cur, 0) + float(log_.get("payment_amount") or 0), 2)
                count += 1
                if len(sample) < 5:
                    sample.append({"date": log_.get("date"), "amount": log_.get("payment_amount"),
                                   "currency": cur, "vendor": log_.get("vendor")})
            if data.get("last") is True or not content:
                break
        capped = count >= 500
        return json.dumps({
            "window": {"start": start, "end": end},
            "collected_by_currency": totals,
            "paid_transactions": count,
            "recent": sample,
            **({"note": "500-transaction cap reached — totals may be partial."} if capped else {}),
        })
    # Cumulative dashboard (camelCase body + response).
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/admin/student-fee/dashboard/collection",
        body={"instituteId": ctx.principal.institute_id}, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    return json.dumps({
        "projected_revenue": data.get("projectedRevenue"),
        "expected_to_date": data.get("expectedToDate"),
        "collected_to_date": data.get("collectedToDate"),
        "total_overdue": data.get("totalOverdue"),
        "by_batch": _compact(data.get("classWiseBreakdown"), max_items=10, max_str=120),
        "by_payment_mode": _compact(data.get("paymentModeBreakdown"), max_items=8, max_str=80),
    })


_LIST_RECENT_ENROLLMENTS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "list_recent_enrollments",
        "description": (
            "Learners who ENROLLED within a date range (newest first) — 'who joined "
            "this month/week', 'new admissions since X'. Returns the matching count "
            "plus the first page of learners."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Enrollment window start, YYYY-MM-DD."},
                "end_date": {"type": "string", "description": "Enrollment window end, YYYY-MM-DD."},
                "batch_id": {"type": "string", "description": "Optional package_session_id (from find_batch)."},
            },
            "required": ["start_date", "end_date"],
        },
    },
}


async def _execute_list_recent_enrollments(args: Dict[str, Any], ctx: ToolContext) -> str:
    start = str((args or {}).get("start_date") or "").strip()
    end = str((args or {}).get("end_date") or "").strip()
    if not start or not end:
        return json.dumps({"error": "missing_dates"})
    body: Dict[str, Any] = {
        "institute_ids": [ctx.principal.institute_id],  # forced
        "statuses": ["ACTIVE"],
        "start_date": start,  # filters ssigm.enrolled_date
        "end_date": end,
        "package_session_ids": [str(args["batch_id"])] if args.get("batch_id") else [],
        "group_ids": [], "gender": [], "sort_columns": {},
    }
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/institute/institute_learner/get/v2/all",
        params={"pageNo": 0, "pageSize": 15}, body=body, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    rows = []
    for r in (data.get("content") or [])[:15]:
        rows.append({
            "user_id": r.get("user_id"),
            "name": r.get("full_name"),
            "email": r.get("email"),
            "batch_id": r.get("package_session_id"),
            "status": r.get("status"),
        })
    total = data.get("totalElements", data.get("total_elements", len(rows)))
    return json.dumps({"window": {"start": start, "end": end},
                       "total_enrolled_in_window": total, "learners": rows})


# ──────────────────────────────────────────────────────────────────────────
# Assessments group — reads against assessment_service (caller's JWT).
# ──────────────────────────────────────────────────────────────────────────

_FIND_ASSESSMENT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "find_assessment",
        "description": (
            "Find assessments/tests by name and window (live / upcoming / past). "
            "Returns assessment_id + registration/attempt counts + start/end times. "
            "ALWAYS resolve an assessment here before asking for its results or "
            "leaderboard. For date questions ('tests this week') check the returned "
            "bound_start_time yourself."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name text to search (optional)."},
                "window": {
                    "type": "string", "enum": ["live", "upcoming", "past", "all"],
                    "description": "Which set to list. Default 'all'.",
                },
            },
            "required": [],
        },
    },
}


async def _execute_find_assessment(args: Dict[str, Any], ctx: ToolContext) -> str:
    window = str((args or {}).get("window") or "all")
    body: Dict[str, Any] = {
        "name": str(args.get("name") or "").strip(),
        "assessment_types": ["ASSESSMENT"],
        "institute_ids": [ctx.principal.institute_id],  # forced — endpoint does NOT scope itself
        "get_live_assessments": window in ("live", "all"),
        "get_upcoming_assessments": window in ("upcoming", "all"),
        "get_passed_assessments": window in ("past", "all"),
        "batch_ids": [], "subjects_ids": [], "tag_ids": [], "evaluation_types": [],
        "assessment_statuses": [], "assessment_modes": [], "access_statuses": [],
        "sort_columns": {"created_at": "DESC"},
    }
    data = await _assessment_json(
        ctx, "POST", "/assessment-service/assessment/admin/assessment-admin-list-filter",
        params={"pageNo": 0, "pageSize": 10, "instituteId": ctx.principal.institute_id},
        body=body, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    rows = []
    for r in (data.get("content") or [])[:10]:
        rows.append({
            "assessment_id": r.get("assessment_id"),
            "name": r.get("name"),
            "status": r.get("status"),
            "visibility": r.get("assessment_visibility"),
            "play_mode": r.get("play_mode"),
            "starts": r.get("bound_start_time"),
            "ends": r.get("bound_end_time"),
            "registered": r.get("user_registrations"),
            "attempted": r.get("user_attempt_count"),
        })
    total = data.get("totalElements", data.get("total_elements", len(rows)))
    return json.dumps({"matches": rows, "total_matching": total})


_GET_ASSESSMENT_RESULTS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_assessment_results",
        "description": (
            "Participants of ONE assessment with attempt state, score, and evaluation "
            "status. CRITICAL semantics: evaluation_status PENDING = attempted but NOT "
            "YET GRADED (never report it as 'didn't attempt'); attempt_state 'pending' "
            "= registered but not attempted. release_status shows whether the learner "
            "can see their result. Use find_assessment first to get assessment_id and "
            "visibility."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "assessment_id": {"type": "string"},
                "visibility": {
                    "type": "string",
                    "description": "The assessment's visibility from find_assessment (e.g. PRIVATE/PUBLIC). Default PRIVATE.",
                },
                "attempt_state": {
                    "type": "string", "enum": ["attempted", "not_attempted", "live"],
                    "description": "attempted = finished attempts; not_attempted = registered but no attempt; live = attempting now.",
                },
                "evaluation_status": {
                    "type": "string", "enum": ["PENDING", "COMPLETED"],
                    "description": "PENDING = awaiting grading; COMPLETED = graded.",
                },
                "batch_ids": {"type": "array", "items": {"type": "string"}},
                "name": {"type": "string", "description": "Optional learner-name search."},
                "page": {"type": "integer"},
            },
            "required": ["assessment_id"],
        },
    },
}

_ATTEMPT_STATE_MAP = {"attempted": "ENDED", "not_attempted": "PENDING", "live": "LIVE"}


async def _execute_get_assessment_results(args: Dict[str, Any], ctx: ToolContext) -> str:
    assessment_id = str((args or {}).get("assessment_id") or "").strip()
    if not assessment_id:
        return json.dumps({"error": "missing_assessment_id"})
    body: Dict[str, Any] = {
        "name": str(args.get("name") or "").strip(),
        "assessment_type": str(args.get("visibility") or "PRIVATE"),
        "attempt_type": (
            [_ATTEMPT_STATE_MAP[args["attempt_state"]]]
            if args.get("attempt_state") in _ATTEMPT_STATE_MAP else []
        ),
        "evaluation_status": (
            [str(args["evaluation_status"])]
            if str(args.get("evaluation_status") or "") in ("PENDING", "COMPLETED") else []
        ),
        "batches": [str(b) for b in (args.get("batch_ids") or [])][:10],
        "status": ["ACTIVE"],
        "registration_source": [],
        # NB: never sort by end_time — the WAF blocks it.
        "sort_columns": {"attempt_date": "DESC"},
    }
    data = await _assessment_json(
        ctx, "POST", "/assessment-service/assessment/admin-participants/all/registered-participants",
        params={"instituteId": ctx.principal.institute_id, "assessmentId": assessment_id,
                "pageNo": max(0, int(args.get("page") or 0)), "pageSize": 15},
        body=body, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    rows = []
    for r in (data.get("content") or [])[:15]:
        rows.append({
            "user_id": r.get("user_id"),
            "name": r.get("student_name"),
            "batch_id": r.get("batch_id"),
            "attempt_date": r.get("attempt_date"),
            "score": r.get("score"),
            "evaluation_status": r.get("evaluation_status"),
            "release_status": r.get("report_release_result_status"),
        })
    total = data.get("totalElements", data.get("total_elements", len(rows)))
    return json.dumps({
        "participants": rows, "total_matching": total,
        "note": "evaluation_status PENDING = attempted, awaiting grading (NOT a missed test).",
    })


_GET_ASSESSMENT_LEADERBOARD_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_assessment_leaderboard",
        "description": (
            "Ranked leaderboard for ONE assessment: rank, marks, percentile per "
            "learner. Use for 'toppers / how did the batch do on test X'. Resolve "
            "the assessment with find_assessment first."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "assessment_id": {"type": "string"},
                "page": {"type": "integer", "description": "0-based page (10 rows per page)."},
            },
            "required": ["assessment_id"],
        },
    },
}


async def _execute_get_assessment_leaderboard(args: Dict[str, Any], ctx: ToolContext) -> str:
    assessment_id = str((args or {}).get("assessment_id") or "").strip()
    if not assessment_id:
        return json.dumps({"error": "missing_assessment_id"})
    data = await _assessment_json(
        ctx, "POST", "/assessment-service/assessment/admin/get-leaderboard",
        params={"assessmentId": assessment_id, "instituteId": ctx.principal.institute_id,
                "pageNo": max(0, int(args.get("page") or 0)), "pageSize": 10},
        body={"name": "", "status": ["ACTIVE"], "sort_columns": {}}, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    rows = []
    for r in (data.get("content") or [])[:10]:
        rows.append({
            "rank": r.get("rank"),
            "name": r.get("student_name"),
            "user_id": r.get("user_id"),
            "marks": r.get("achieved_marks"),
            "percentile": r.get("percentile"),
            "time_seconds": r.get("completion_time_in_seconds"),
        })
    total = data.get("totalElements", data.get("total_elements", len(rows)))
    return json.dumps({"leaderboard": rows, "total_participants": total})


# ──────────────────────────────────────────────────────────────────────────
# Announcements group.
# ──────────────────────────────────────────────────────────────────────────

_LIST_ANNOUNCEMENTS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "list_announcements",
        "description": (
            "The institute's announcements — 'planned' (scheduled/upcoming) or "
            "'past' (already delivered). Use to answer 'what announcements are "
            "scheduled / did my announcement go out'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["planned", "past"],
                          "description": "Default 'planned'."},
            },
            "required": [],
        },
    },
}


async def _execute_list_announcements(args: Dict[str, Any], ctx: ToolContext) -> str:
    scope = "past" if str((args or {}).get("scope") or "") == "past" else "planned"
    data = await _notification_json(
        ctx, "GET",
        f"/notification-service/v1/announcements/institute/{ctx.principal.institute_id}/{scope}",
        params={"page": 0, "size": 10},
    )
    if isinstance(data, dict) and data.get("error"):
        return json.dumps(data)
    content = data.get("content") if isinstance(data, dict) else data
    return json.dumps({"scope": scope,
                       "announcements": _compact(content, max_items=10, max_str=160)})


# ──────────────────────────────────────────────────────────────────────────
# Phase-3 WRITE tools — confirmation-card protocol.
#
# A WRITE tool's executor NEVER hits Java. It validates, verifies the target
# belongs to the pinned institute, persists a `pending_action` row (nonce + TTL,
# in chat_messages) and sets ctx.pending_action so the loop shows the FE a
# confirmation card. Only the /action/{nonce}/confirm endpoint — a separate
# authenticated request from the human — executes the change, re-checking the
# AND-gate first. The model never sees the nonce, so "the user already said yes"
# can never bypass the card.
# ──────────────────────────────────────────────────────────────────────────

#: Pending write confirmations expire after this many minutes.
PENDING_ACTION_TTL_MINUTES = 10

#: message_type used for pending-confirmation rows in chat_messages.
PENDING_ACTION_MESSAGE_TYPE = "pending_action"


def _target_in_institute(ctx: ToolContext, target_user_id: str) -> bool:
    """Membership pre-check: the write endpoints trust the request body, so WE
    must ensure the target learner belongs to the pinned institute."""
    from sqlalchemy import text as sql_text
    try:
        row = ctx.db.execute(
            sql_text(
                "SELECT 1 FROM student_session_institute_group_mapping "
                "WHERE user_id = :u AND institute_id = :i LIMIT 1"
            ),
            {"u": target_user_id, "i": ctx.principal.institute_id},
        ).first()
        return row is not None
    except Exception as e:
        logger.warning("membership pre-check failed (deny): %s", e)
        return False


async def _propose_action(
    ctx: ToolContext,
    tool: str,
    perform_args: Dict[str, Any],
    summary: str,
) -> str:
    """Persist a pending action (nonce + TTL) and hand the card to the FE."""
    import uuid
    from datetime import datetime, timedelta, timezone
    from ..repositories.chat_message_repository import ChatMessageRepository

    if not ctx.session_id:
        return json.dumps({"error": "no_session"})

    nonce = str(uuid.uuid4())
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=PENDING_ACTION_TTL_MINUTES)
    ).isoformat()
    ChatMessageRepository(ctx.db).create_message(
        session_id=ctx.session_id,
        message_type=PENDING_ACTION_MESSAGE_TYPE,
        content=summary,
        metadata={
            "nonce": nonce,
            "tool": tool,
            "args": perform_args,
            "status": "PENDING",
            "expires_at": expires_at,
            "proposed_by": ctx.principal.user_id,
            "institute_id": ctx.principal.institute_id,
        },
    )
    ctx.pending_action = {
        "action_id": nonce,
        "tool": tool,
        "summary": summary,
        "expires_at": expires_at,
    }
    return json.dumps({
        "status": "awaiting_user_confirmation",
        "summary": summary,
        "note": (
            "A confirmation card has been shown to the user. The change has NOT been made. "
            "Tell the user to press Confirm on the card (or Cancel). Do not claim it is done."
        ),
    })


# Editable profile fields (schema-level whitelist). Deliberately EXCLUDES
# user_name / password / face_file_id / institute_name even though the backend
# accepts them — the assistant must not touch credentials.
_PROFILE_EDITABLE_FIELDS = [
    "email", "full_name", "contact_number", "gender", "address_line",
    "state", "pin_code", "father_name", "mother_name",
    "parents_mobile_number", "parents_email",
]

_UPDATE_LEARNER_PROFILE_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "update_learner_profile",
        "description": (
            "PROPOSE an edit to a learner's profile details (name, contact, address, "
            "parent info). The user gets a confirmation card and the change only "
            "happens after they press Confirm. Supply ONLY the fields to change."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {"type": "string", "description": "The learner's user_id."},
                **{f: {"type": "string"} for f in _PROFILE_EDITABLE_FIELDS},
            },
            "required": ["target_user_id"],
        },
    },
}


async def _execute_update_learner_profile(args: Dict[str, Any], ctx: ToolContext) -> str:
    target = str((args or {}).get("target_user_id") or "").strip()
    if not target:
        return json.dumps({"error": "missing_target"})
    changes = {
        f: str(args[f]).strip()
        for f in _PROFILE_EDITABLE_FIELDS
        if args.get(f) is not None and str(args[f]).strip() != ""
    }
    if not changes:
        return json.dumps({"error": "no_changes", "message": "No editable fields were provided."})
    if not _target_in_institute(ctx, target):
        return json.dumps({"error": "not_found",
                           "message": "This learner has no enrollment in your institute."})
    pretty = ", ".join(f"{k.replace('_', ' ')} → “{v}”" for k, v in changes.items())
    summary = f"Update learner profile ({len(changes)} field{'s' if len(changes) > 1 else ''}): {pretty}"
    return await _propose_action(
        ctx, "update_learner_profile", {"target_user_id": target, "changes": changes}, summary
    )


async def _perform_update_learner_profile(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    body = {"user_id": args["target_user_id"], **(args.get("changes") or {})}
    data = await _admin_core_json(
        ctx, "PUT", "/admin-core-service/learner/info/v1/edit", body=body
    )
    if isinstance(data, dict) and data.get("error"):
        return {"ok": False, "detail": data}
    return {"ok": True, "detail": "profile updated"}


#: Enrollment operations the assistant may propose. TERMINATE is deliberately
#: excluded (destructive) — Phase 3b at the earliest.
_ENROLLMENT_OPERATIONS = {
    "ADD_EXPIRY": "extend/set access expiry (new_state = date as dd-MM-yyyy)",
    "UPDATE_BATCH": "move to another batch (new_state = target package_session_id)",
    "MAKE_INACTIVE": "deactivate the learner in the batch",
    "MAKE_ACTIVE": "re-activate the learner in the batch",
    "UPDATE_STATUS": "set enrollment status (new_state = status value)",
}

_MANAGE_ENROLLMENT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "manage_enrollment",
        "description": (
            "PROPOSE an enrollment change for a learner — extend access expiry, move "
            "batch, activate/deactivate. The user gets a confirmation card; nothing "
            "changes until they press Confirm. Operations: "
            + "; ".join(f"{k} = {v}" for k, v in _ENROLLMENT_OPERATIONS.items())
            + ". IMPORTANT: ADD_EXPIRY dates must be dd-MM-yyyy (e.g. 31-08-2026)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_user_id": {"type": "string", "description": "The learner's user_id."},
                "operation": {"type": "string", "enum": sorted(_ENROLLMENT_OPERATIONS.keys())},
                "new_state": {
                    "type": "string",
                    "description": "Meaning depends on operation (see description).",
                },
                "current_package_session_id": {
                    "type": "string",
                    "description": "The learner's current batch id (from context or find_learner).",
                },
            },
            "required": ["target_user_id", "operation", "current_package_session_id"],
        },
    },
}


async def _execute_manage_enrollment(args: Dict[str, Any], ctx: ToolContext) -> str:
    import re
    target = str((args or {}).get("target_user_id") or "").strip()
    operation = str(args.get("operation") or "").strip().upper()
    new_state = str(args.get("new_state") or "").strip()
    batch = str(args.get("current_package_session_id") or "").strip()
    if not target or not batch:
        return json.dumps({"error": "missing_target"})
    if operation not in _ENROLLMENT_OPERATIONS:
        return json.dumps({"error": "bad_operation",
                           "message": f"Allowed: {', '.join(sorted(_ENROLLMENT_OPERATIONS))}."})
    if operation == "ADD_EXPIRY" and not re.fullmatch(r"\d{2}-\d{2}-\d{4}", new_state):
        return json.dumps({"error": "bad_date",
                           "message": "ADD_EXPIRY needs new_state as dd-MM-yyyy (e.g. 31-08-2026)."})
    if operation in ("ADD_EXPIRY", "UPDATE_BATCH", "UPDATE_STATUS") and not new_state:
        return json.dumps({"error": "missing_new_state"})
    if not _target_in_institute(ctx, target):
        return json.dumps({"error": "not_found",
                           "message": "This learner has no enrollment in your institute."})
    # Confirm cards must show human-readable batch NAMES, and a batch move must
    # target a REAL batch of this institute — a guessed/hallucinated id is refused.
    current_batch_name = _batch_name_in_institute(ctx, batch) or "their current batch"
    target_batch_name = None
    if operation == "UPDATE_BATCH":
        target_batch_name = _batch_name_in_institute(ctx, new_state)
        if not target_batch_name:
            return json.dumps({
                "error": "unknown_batch",
                "message": "That batch id doesn't exist in this institute. Use find_batch "
                           "to resolve the batch name first — never guess batch ids.",
            })
    nice = {
        "ADD_EXPIRY": f"Extend access expiry to {new_state} (in {current_batch_name})",
        "UPDATE_BATCH": f"Move from {current_batch_name} to {target_batch_name}",
        "MAKE_INACTIVE": f"Mark INACTIVE in {current_batch_name}",
        "MAKE_ACTIVE": f"Mark ACTIVE in {current_batch_name}",
        "UPDATE_STATUS": f"Set enrollment status to {new_state} (in {current_batch_name})",
    }[operation]
    summary = f"Enrollment change: {nice}"
    return await _propose_action(
        ctx, "manage_enrollment",
        {"target_user_id": target, "operation": operation, "new_state": new_state,
         "current_package_session_id": batch},
        summary,
    )


async def _perform_manage_enrollment(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    body = {
        "operation": args["operation"],
        "requests": [{
            "user_id": args["target_user_id"],
            "new_state": args.get("new_state") or None,
            "institute_id": ctx.principal.institute_id,  # forced
            "current_package_session_id": args["current_package_session_id"],
        }],
    }
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/institute/institute_learner-operation/v1/update",
        body=body,
    )
    if isinstance(data, dict) and data.get("error"):
        return {"ok": False, "detail": data}
    return {"ok": True, "detail": "enrollment updated"}


_ANNOUNCEMENT_TARGET_ROLES = {"STUDENT", "TEACHER", "ADMIN"}

_SEND_ANNOUNCEMENT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "send_announcement",
        "description": (
            "PROPOSE sending an announcement to learners/staff (in-app alert, "
            "optionally push notification). The user gets a confirmation card showing "
            "exactly who receives it; NOTHING is sent until they press Confirm. "
            "Target batches by package_session_id (resolve names with find_batch "
            "first — never guess ids), or whole roles, or specific users."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Announcement title (short)."},
                "message": {"type": "string", "description": "The announcement body (plain text)."},
                "target_batch_ids": {
                    "type": "array", "items": {"type": "string"},
                    "description": "package_session_ids from find_batch.",
                },
                "target_roles": {
                    "type": "array",
                    "items": {"type": "string", "enum": sorted(_ANNOUNCEMENT_TARGET_ROLES)},
                    "description": "Send to everyone with a role, e.g. ['STUDENT'].",
                },
                "target_user_ids": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Specific user_ids (from find_learner).",
                },
                "push": {"type": "boolean",
                         "description": "Also send a push notification. Default false."},
            },
            "required": ["title", "message"],
        },
    },
}


async def _execute_send_announcement(args: Dict[str, Any], ctx: ToolContext) -> str:
    import html as html_mod

    title = str((args or {}).get("title") or "").strip()
    message = str(args.get("message") or "").strip()
    if not title or not message:
        return json.dumps({"error": "missing_fields", "message": "title and message are required."})
    if len(title) > 500:
        return json.dumps({"error": "title_too_long", "message": "Max 500 characters."})

    batch_ids = [str(b).strip() for b in (args.get("target_batch_ids") or []) if str(b).strip()][:10]
    roles = [str(r).strip().upper() for r in (args.get("target_roles") or [])]
    user_ids = [str(u).strip() for u in (args.get("target_user_ids") or []) if str(u).strip()][:20]
    bad_roles = [r for r in roles if r not in _ANNOUNCEMENT_TARGET_ROLES]
    if bad_roles:
        return json.dumps({"error": "bad_role",
                           "message": f"Allowed roles: {', '.join(sorted(_ANNOUNCEMENT_TARGET_ROLES))}."})
    if not batch_ids and not roles and not user_ids:
        return json.dumps({"error": "no_targets",
                           "message": "Give at least one target: batches, roles, or users."})

    # Every model-supplied target id must belong to the pinned institute — the
    # backend endpoint accepts ANY id, so this pre-check is the trust boundary.
    target_desc: List[str] = []
    for bid in batch_ids:
        name = _batch_name_in_institute(ctx, bid)
        if not name:
            return json.dumps({
                "error": "unknown_batch",
                "message": "A target batch id doesn't exist in this institute. Use find_batch "
                           "to resolve batch names first — never guess batch ids.",
            })
        target_desc.append(f"batch “{name}”")
    for uid in user_ids:
        if not _target_in_institute(ctx, uid):
            return json.dumps({"error": "unknown_user",
                               "message": "A target user has no enrollment in your institute."})
    if user_ids:
        target_desc.append(f"{len(user_ids)} specific learner{'s' if len(user_ids) > 1 else ''}")
    target_desc.extend(f"all {r.lower()}s" for r in roles)

    channels = "in-app alert + push notification" if args.get("push") else "in-app alert"
    body_html = f"<p>{html_mod.escape(message)}</p>"
    summary = (
        f"Send announcement “{title}” to {', '.join(target_desc)} ({channels}). "
        f"Message: “{message[:180]}{'…' if len(message) > 180 else ''}”"
    )
    return await _propose_action(
        ctx, "send_announcement",
        {"title": title, "message": message, "body_html": body_html,
         "batch_ids": batch_ids, "roles": roles, "user_ids": user_ids,
         "push": bool(args.get("push"))},
        summary,
    )


async def _perform_send_announcement(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    # The create endpoint trusts instituteId/createdBy/createdByRole from the
    # body (and createdByRole=ADMIN bypasses institute approval) — so every
    # identity field here is forced from the verified principal, never the model.
    recipients = (
        [{"recipientType": "PACKAGE_SESSION", "recipientId": b} for b in args.get("batch_ids") or []]
        + [{"recipientType": "ROLE", "recipientId": r} for r in args.get("roles") or []]
        + [{"recipientType": "USER", "recipientId": u} for u in args.get("user_ids") or []]
    )
    caller_roles = ctx.principal.roles or []
    payload: Dict[str, Any] = {
        # NB: this service's wire format is camelCase, unlike the rest of the platform.
        "title": args["title"],
        "content": {"type": "html", "content": args.get("body_html") or args["message"]},
        "instituteId": ctx.principal.institute_id,          # forced
        "createdBy": ctx.principal.user_id,                 # forced
        "createdByName": ctx.principal.full_name or ctx.principal.username or "Vacademy Assistant user",
        "createdByRole": "ADMIN" if "ADMIN" in caller_roles else (caller_roles[0] if caller_roles else "ADMIN"),
        "timezone": "Asia/Kolkata",
        "recipients": recipients,
        "modes": [{"modeType": "SYSTEM_ALERT", "settings": {}}],
    }
    if args.get("push"):
        payload["mediums"] = [{
            "mediumType": "PUSH_NOTIFICATION",
            "config": {"title": args["title"], "body": args["message"][:500]},
        }]
    data = await _notification_json(
        ctx, "POST", "/notification-service/v1/announcements", body=payload, timeout=30.0,
    )
    if isinstance(data, dict) and data.get("error"):
        return {"ok": False, "detail": data}
    return {"ok": True, "detail": "announcement created and delivery started"}


#: perform-side dispatch used by the confirm endpoint (NOT reachable by the LLM).
WRITE_PERFORMERS: Dict[str, Callable[[Dict[str, Any], ToolContext], Awaitable[Dict[str, Any]]]] = {
    "update_learner_profile": _perform_update_learner_profile,
    "manage_enrollment": _perform_manage_enrollment,
    "send_announcement": _perform_send_announcement,
}


# ──────────────────────────────────────────────────────────────────────────
# The registry.
# ──────────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────────
# whoami — the caller's own identity and institute. Always allowed: it reveals
# nothing the caller does not already know about themselves, and an assistant
# that cannot say who it is talking to (name, institute, role) cannot address
# them properly. Not a settings toggle.
# ──────────────────────────────────────────────────────────────────────────
_WHOAMI_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "whoami",
        "description": (
            "Who is connected: the current user's name, username, email, mobile, roles, and the "
            "institute this connection belongs to (name, logo, theme, portal URLs, terminology). "
            "Call once at the start of a conversation to address the user and institute by name "
            "and to use the institute's own vocabulary. Identity comes from the authorization, "
            "never from arguments."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


async def _execute_whoami(args: Dict[str, Any], ctx: ToolContext) -> str:
    p = ctx.principal
    user: Dict[str, Any] = {
        "user_id": p.user_id,
        "username": p.username,
        "full_name": p.full_name,
        "roles": list(p.roles or []),
        "is_root_user": bool(p.is_root_user),
    }
    details = await _auth_json(
        ctx, "GET", "/auth-service/v1/user-details/get",
        params={"userId": p.user_id, "instituteId": p.institute_id}, timeout=15.0,
    )
    if isinstance(details, dict) and not details.get("error"):
        user.update({k: v for k, v in {
            "full_name": details.get("full_name") or p.full_name,
            "email": details.get("email"),
            "mobile": details.get("mobile_number"),
            "preferred_locale": details.get("preferred_locale"),
            "profile_photo_url": await _media_public_url(ctx, details.get("profile_pic_file_id")),
        }.items() if v})
    institute = await load_institute_profile(ctx)
    return json.dumps({
        "user": {k: v for k, v in user.items() if v not in (None, "", [], False)},
        "institute": institute,
        "note": (
            f"Address the user as {user.get('full_name') or p.username or 'the admin'} and the "
            f"institute as {institute.get('name') or 'the institute'}; use its terminology where given."
        ),
    }, ensure_ascii=False, default=str)


ASSISTANT_TOOLS: Dict[str, ToolSpec] = {
    "whoami": ToolSpec(
        name="whoami",
        schema=_WHOAMI_SCHEMA,
        executor=_execute_whoami,
        required_permission=None,
        setting_key="identity",
        default_enabled=True,
        always_allowed=True,
        phase=1,
        mode="READ",
    ),
    "search_help_knowledge": ToolSpec(
        name="search_help_knowledge",
        schema=_SEARCH_HELP_KNOWLEDGE_SCHEMA,
        executor=_execute_search_help_knowledge,
        required_permission=None,   # Phase-1 help is available to all non-learner roles
        default_enabled=True,       # on out-of-the-box until an institute configures the setting
        phase=1,
        mode="READ",
    ),
    # Phase 2a learner-data tools. One settings key ("learner_data") controls both —
    # the resolver is useless without the data tool and vice versa. RBAC leg is None
    # for now: the ASSISTANT_* permission catalog isn't seeded/grantable in the roles
    # UI yet, so the per-role Settings leg (deny-by-default, ADMIN-only default) is
    # the founder's grant mechanism; the permission backstop lands with the catalog.
    "find_learner": ToolSpec(
        name="find_learner",
        schema=_FIND_LEARNER_SCHEMA,
        executor=_execute_find_learner,
        required_permission=None,
        setting_key="learner_data",
        default_enabled=False,
        default_roles=["ADMIN"],    # founder decision 2026-07-02: reads on for ADMIN only
        phase=2,
        mode="READ",
    ),
    "get_student_360": ToolSpec(
        name="get_student_360",
        schema=_GET_STUDENT_360_SCHEMA,
        executor=_execute_get_student_360,
        required_permission=None,
        setting_key="learner_data",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    # Name→id resolver shared by several groups: available when ANY of them is on.
    "find_batch": ToolSpec(
        name="find_batch",
        schema=_FIND_BATCH_SCHEMA,
        executor=_execute_find_batch,
        required_permission=None,
        setting_key="learner_data",
        setting_keys_any=["learner_data", "batch_data", "learner_edits", "schedule",
                          "assessments", "announcements", "payments"],
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "trigger_full_report": ToolSpec(
        name="trigger_full_report",
        schema=_TRIGGER_FULL_REPORT_SCHEMA,
        executor=_execute_trigger_full_report,
        required_permission=None,
        setting_key="learner_data",   # rides the learner-data grant
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    # Payments group — one settings key controls all three.
    "get_payment_history": ToolSpec(
        name="get_payment_history",
        schema=_GET_PAYMENT_HISTORY_SCHEMA,
        executor=_execute_get_payment_history,
        required_permission=None,
        setting_key="payments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_fee_dues": ToolSpec(
        name="get_fee_dues",
        schema=_GET_FEE_DUES_SCHEMA,
        executor=_execute_get_fee_dues,
        required_permission=None,
        setting_key="payments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_subscription_plans": ToolSpec(
        name="get_subscription_plans",
        schema=_GET_SUBSCRIPTION_PLANS_SCHEMA,
        executor=_execute_get_subscription_plans,
        required_permission=None,
        setting_key="payments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "list_batch_learners": ToolSpec(
        name="list_batch_learners",
        schema=_LIST_BATCH_LEARNERS_SCHEMA,
        executor=_execute_list_batch_learners,
        required_permission=None,
        setting_key="batch_data",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_class_schedule": ToolSpec(
        name="get_class_schedule",
        schema=_GET_CLASS_SCHEDULE_SCHEMA,
        executor=_execute_get_class_schedule,
        required_permission=None,
        setting_key="schedule",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_institute_overview": ToolSpec(
        name="get_institute_overview",
        schema=_GET_INSTITUTE_OVERVIEW_SCHEMA,
        executor=_execute_get_institute_overview,
        required_permission=None,
        setting_key="institute_overview",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    # Phase-3 WRITE tools — OFF for everyone by default (founder decision:
    # writes are never default-on); grantable per-role via the "learner_edits"
    # settings group. Executors only PROPOSE; execution happens exclusively via
    # the nonce-confirmed /action endpoint.
    # Audit fix 2026-07-07: edits default ON for ADMIN — the confirm card is the
    # safety gate, and the owner should never be told they lack authority they
    # can grant themselves. Other roles stay opt-in.
    "update_learner_profile": ToolSpec(
        name="update_learner_profile",
        schema=_UPDATE_LEARNER_PROFILE_SCHEMA,
        executor=_execute_update_learner_profile,
        required_permission=None,
        setting_key="learner_edits",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=3,
        mode="WRITE",
    ),
    "manage_enrollment": ToolSpec(
        name="manage_enrollment",
        schema=_MANAGE_ENROLLMENT_SCHEMA,
        executor=_execute_manage_enrollment,
        required_permission=None,
        setting_key="learner_edits",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=3,
        mode="WRITE",
    ),
    # Audit roadmap 4–6 (2026-07-16): institute-wide lists, assessments,
    # announcements. Reads default-ON for ADMIN like the rest of Phase 2; the
    # announcement send is a WRITE behind the confirmation card.
    "search_fee_records": ToolSpec(
        name="search_fee_records",
        schema=_SEARCH_FEE_RECORDS_SCHEMA,
        executor=_execute_search_fee_records,
        required_permission=None,
        setting_key="payments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_collections_summary": ToolSpec(
        name="get_collections_summary",
        schema=_GET_COLLECTIONS_SUMMARY_SCHEMA,
        executor=_execute_get_collections_summary,
        required_permission=None,
        setting_key="payments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "list_recent_enrollments": ToolSpec(
        name="list_recent_enrollments",
        schema=_LIST_RECENT_ENROLLMENTS_SCHEMA,
        executor=_execute_list_recent_enrollments,
        required_permission=None,
        setting_key="learner_data",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "find_assessment": ToolSpec(
        name="find_assessment",
        schema=_FIND_ASSESSMENT_SCHEMA,
        executor=_execute_find_assessment,
        required_permission=None,
        setting_key="assessments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_assessment_results": ToolSpec(
        name="get_assessment_results",
        schema=_GET_ASSESSMENT_RESULTS_SCHEMA,
        executor=_execute_get_assessment_results,
        required_permission=None,
        setting_key="assessments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "get_assessment_leaderboard": ToolSpec(
        name="get_assessment_leaderboard",
        schema=_GET_ASSESSMENT_LEADERBOARD_SCHEMA,
        executor=_execute_get_assessment_leaderboard,
        required_permission=None,
        setting_key="assessments",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "list_announcements": ToolSpec(
        name="list_announcements",
        schema=_LIST_ANNOUNCEMENTS_SCHEMA,
        executor=_execute_list_announcements,
        required_permission=None,
        setting_key="announcements",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    "send_announcement": ToolSpec(
        name="send_announcement",
        schema=_SEND_ANNOUNCEMENT_SCHEMA,
        executor=_execute_send_announcement,
        required_permission=None,
        setting_key="announcements",
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=3,
        mode="WRITE",
    ),
}

#: Friendly names for the settings groups — used in denials and the capability
#: disclosure so users hear "Fees & payments", not "payments".
GROUP_LABELS: Dict[str, str] = {
    "search_help_knowledge": "How-to help",
    "learner_data": "Learner data lookups",
    "payments": "Fees & payments",
    "batch_data": "Batch rosters",
    "schedule": "Class schedule",
    "institute_overview": "Institute stats",
    "learner_edits": "Learner edits (confirmed changes)",
    "assessments": "Assessment results",
    "announcements": "Announcements",
}


# ──────────────────────────────────────────────────────────────────────────
# Settings-leg: read ASSISTANT_TOOLS_SETTING from the shared admin_core DB.
# ──────────────────────────────────────────────────────────────────────────

def load_assistant_tools_setting(db: Session, institute_id: str) -> Optional[Dict[str, Any]]:
    """
    Read the institute's ASSISTANT_TOOLS_SETTING from the shared admin_core DB.

    Delegates to the shared reader, which knows the envelope admin_core_service
    actually writes (``setting_json["setting"][KEY]["data"]``) and keeps the
    legacy top-level lookup as a fallback. Returns the parsed setting blob or
    None when the institute has not configured it — in which case the Settings
    leg falls back to ``default_enabled`` tools.

    Fails closed-to-default (returns None, never raises) so a settings read
    problem can never silently grant a tool.
    """
    from .institute_setting_reader import load_institute_setting_data

    return load_institute_setting_data(db, institute_id, ASSISTANT_TOOLS_SETTING_KEY)


def _effective_enabled_tools(setting: Optional[Dict[str, Any]], roles: Optional[List[str]]) -> set:
    """
    The set of tool keys enabled for the caller, given the institute setting and
    the caller's roles.

    - No setting configured -> tools flagged ``default_enabled`` (all roles) plus
      tools whose ``default_roles`` include one of the caller's roles (e.g. the
      learner-data tools default on for ADMIN only — founder decision 2026-07-02).
    - Setting configured     -> the institute-level ``enabled_tools`` UNION the
      ``enabled_tools`` of each of the caller's roles in ``role_overrides``
      (union across multiple roles — the broadest of the caller's roles wins).
    """
    if not setting:
        caller_roles = set(roles or [])
        return {
            spec.key()
            for spec in ASSISTANT_TOOLS.values()
            if spec.default_enabled
            or (spec.default_roles and caller_roles.intersection(spec.default_roles))
        }

    enabled = set(setting.get("enabled_tools") or [])
    overrides = setting.get("role_overrides") or {}
    if isinstance(overrides, dict):
        for role in roles or []:
            ro = overrides.get(role)
            if isinstance(ro, dict) and ro.get("enabled_tools") is not None:
                enabled |= set(ro.get("enabled_tools") or [])
    return enabled


# ──────────────────────────────────────────────────────────────────────────
# The AND-gate.
# ──────────────────────────────────────────────────────────────────────────

def is_tool_allowed(
    tool_name: str,
    principal: PinnedPrincipal,
    setting: Optional[Dict[str, Any]],
) -> bool:
    """True iff BOTH the RBAC leg and the Settings leg allow this tool. Deny-by-default."""
    spec = ASSISTANT_TOOLS.get(tool_name)
    if spec is None:
        return False  # unknown tool -> never allowed

    # RBAC leg
    if spec.required_permission is not None:
        if not (principal.is_root_user or spec.required_permission in (principal.permissions or [])):
            return False

    if spec.always_allowed:
        return True

    # Settings leg — a multi-group resolver passes if ANY of its groups is enabled.
    enabled = _effective_enabled_tools(setting, principal.roles)
    return any(k in enabled for k in spec.keys_any())


# ──────────────────────────────────────────────────────────────────────────
# The module leg: features the institute's plan includes (V567 entitlements).
# Checked after the AND-gate, only for tools tied to a module, and only when a
# DB session is at hand (unit tests and DB-less callers skip it).
# ──────────────────────────────────────────────────────────────────────────

def load_entitlements(db: Session, institute_id: str) -> Any:
    """The institute's entitlements (``.on(key) -> bool``); never raises (LEGACY on a read error)."""
    from .entitlements import entitlements

    return entitlements(db, institute_id)


def context_entitlements(ctx: ToolContext) -> Any:
    """Entitlements for this call's institute, loaded once per ToolContext."""
    if ctx.entitlements is None:
        ctx.entitlements = load_entitlements(ctx.db, ctx.principal.institute_id)
    return ctx.entitlements


def missing_module_feature(spec: ToolSpec, ent: Any) -> Optional[str]:
    """The feature key that keeps ``spec`` off for these entitlements, or None when it is on."""
    if spec.module_feature and not ent.on(spec.module_feature):
        return spec.module_feature
    if spec.module_features_any and not any(ent.on(f) for f in spec.module_features_any):
        return spec.module_features_any[0]
    return None


def build_offered_tools(
    principal: PinnedPrincipal,
    setting: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """The LLM-facing function schemas for exactly the tools this caller may use."""
    return [
        spec.schema
        for spec in ASSISTANT_TOOLS.values()
        if not spec.mcp_only and is_tool_allowed(spec.name, principal, setting)
    ]


async def execute_tool(
    tool_name: str,
    args: Optional[Dict[str, Any]],
    ctx: ToolContext,
    setting: Optional[Dict[str, Any]],
    *,
    in_product: bool = False,
) -> str:
    """
    Dispatch a tool call after re-checking the AND-gate and forcing identity.

    ``mcp_only`` tools run only for MCP callers (``ctx.via_mcp``); ``in_product``
    (the dashboard assistant) refuses them as well, whatever the context says.

    Returns a string tool-result in ALL cases (including denial/errors) — the
    agent loop feeds tool output back to the LLM as a string, so raising here
    would bypass the graceful contract.
    """
    if not is_tool_allowed(tool_name, ctx.principal, setting):
        logger.warning(
            "Assistant denied tool '%s' for user=%s institute=%s (roles=%s)",
            tool_name, ctx.principal.user_id, ctx.principal.institute_id, ctx.principal.roles,
        )
        spec_denied = ASSISTANT_TOOLS.get(tool_name)
        group = GROUP_LABELS.get(spec_denied.key(), spec_denied.key()) if spec_denied else tool_name
        return json.dumps({
            "error": "tool_not_permitted",
            "tool": tool_name,
            "message": (
                f"The '{group}' capability is not enabled for this user's role. Do not retry. "
                "Tell the user an admin can enable it under "
                "[Assistant settings](/settings?selectedTab=assistantTools)."
            ),
        })

    spec = ASSISTANT_TOOLS[tool_name]
    if spec.mcp_only and (in_product or not ctx.via_mcp):
        # Never offered outside MCP; refuse a model that names it anyway (e.g. a
        # settings row that enables the group for the in-product assistant).
        logger.warning("Assistant refused MCP-only tool '%s' outside MCP for user=%s institute=%s",
                       tool_name, ctx.principal.user_id, ctx.principal.institute_id)
        return json.dumps({
            "error": "tool_not_available",
            "tool": tool_name,
            "message": "This tool is only available to AI apps connected over the MCP server. Do not retry.",
        })
    if (spec.module_feature or spec.module_features_any) and ctx.db is not None:
        try:
            missing = missing_module_feature(spec, context_entitlements(ctx))
        except Exception:  # noqa: BLE001 — a broken entitlement check never runs a gated tool
            logger.exception("Assistant module check failed for tool '%s' (institute=%s)",
                             tool_name, ctx.principal.institute_id)
            missing = spec.module_feature or (spec.module_features_any or ("unknown",))[0]
        if missing:
            logger.info("Assistant refused tool '%s': module feature %s is off for institute=%s",
                        tool_name, missing, ctx.principal.institute_id)
            refusal: Dict[str, Any] = {
                "error": "module_not_enabled",
                "tool": tool_name,
                "feature": missing,
                "message": (
                    f"This institute's plan does not include '{missing}', which this tool needs. Do not retry. "
                    "Tell the user the feature has to be added to the institute's plan first."
                ),
            }
            if spec.module_features_any:
                refusal["features_any"] = list(spec.module_features_any)
            return json.dumps(refusal)
    ctx.gate_setting, ctx.gate_checked = setting, True
    safe_args: Dict[str, Any] = dict(args or {})
    # What the model put in `user_id` survives only as data (e.g. a model with a stale tool schema
    # naming a learner); it never becomes identity.
    if (args or {}).get("user_id") not in (None, ""):
        safe_args["requested_user_id"] = str(args["user_id"]).strip()
    # Identity is ALWAYS taken from the pinned principal, never from the model.
    safe_args["user_id"] = ctx.principal.user_id
    safe_args["institute_id"] = ctx.principal.institute_id

    import time
    started = time.monotonic()
    try:
        result = await spec.executor(safe_args, ctx)
        logger.info(
            "assistant tool '%s' ok in %dms (institute=%s)",
            tool_name, int((time.monotonic() - started) * 1000), ctx.principal.institute_id,
        )
        return result
    except Exception as e:
        logger.exception(
            "Assistant tool '%s' raised after %dms: %s",
            tool_name, int((time.monotonic() - started) * 1000), e,
        )
        return json.dumps({"error": "tool_failed", "tool": tool_name})


# ──────────────────────────────────────────────────────────────────────────
# Feature tools that live in their own modules (website builder, lead forms,
# course builder, learners, CRM).
# Each module self-registers into ASSISTANT_TOOLS / GROUP_LABELS when imported,
# so importing it here is only to make sure that happens. The import is
# tolerant of the cycle: a test that imports the feature module first will find
# this module half-initialised, and the feature module registers itself once
# this one finishes.
# ──────────────────────────────────────────────────────────────────────────
def _load_feature_tools() -> None:
    for module in (
        "assistant_tools_website", "assistant_tools_website_edit", "assistant_tools_design_import",
        "assistant_tools_catalog_data_edit",
        "assistant_tools_website_publish",
        "assistant_tools_audience",
        "assistant_tools_workflow", "assistant_tools_blog",
        "assistant_tools_courses", "assistant_tools_course_edit", "assistant_tools_course_drip",
        "assistant_tools_course_invites",
        "assistant_tools_course_structure",
        "assistant_tools_learners", "assistant_tools_learner_enroll", "assistant_tools_learner_edit",
        "assistant_tools_learner_report",
        "assistant_tools_sub_orgs", "assistant_tools_sub_org_edit", "assistant_tools_sub_org_enroll",
        "assistant_tools_crm_leads", "assistant_tools_crm_lead_edit", "assistant_tools_crm_team",
        "assistant_tools_crm_calls", "assistant_tools_crm_meetings", "assistant_tools_crm_messages",
        "assistant_tools_crm_reports", "assistant_tools_crm_money",
    ):
        try:
            __import__(f"{__package__}.{module}")
        except ImportError as exc:  # partially initialised cycle; see above
            logger.debug("deferred feature tool module %s: %s", module, exc)


_load_feature_tools()


__all__ = [
    "ASSISTANT_TOOLS",
    "ASSISTANT_TOOLS_SETTING_KEY",
    "ASSISTANT_CONTEXT_TYPE",
    "ToolSpec",
    "ToolContext",
    "is_tool_allowed",
    "build_offered_tools",
    "execute_tool",
    "load_assistant_tools_setting",
    "load_entitlements",
    "context_entitlements",
    "missing_module_feature",
]
