"""Lead Agent API (docs/crm/LEAD_AGENT_BUILD_SPEC.md §4, §4.1), prefix /lead-agent/v1.

Admin endpoints: `Authorization: Bearer <JWT>` + `clientId: <instituteId>` ->
get_pinned_principal (the JWT's roles for THAT institute). Staff (any staff or
custom institute role) may read; writes need ADMIN. principal.is_root_user is
never read: it is set for ordinary learners too. Every admin endpoint is 403
not_available unless `lead_agent.enabled` is on AND the institute is on the
`lead_agent.institutes` allowlist.

Agent JSON columns are exposed (and accepted) without the _json suffix: brief,
markets, gate, window.

Extension endpoints (/ext/*): header X-Lead-Agent-Token (a paired, unrevoked
worker), scoped to that worker's institute.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import timedelta
from typing import Any, Dict, FrozenSet, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import IntegrityError

from ..core.security import get_pinned_principal
from ..schemas.auth import PinnedPrincipal
from ..services.lead_agent import db as ladb
from ..services.lead_agent import engine_api, ext_auth, fetcher, flags, llm, models, pacing, research, store

logger = logging.getLogger(__name__)

MAX_EXT_BODY = 2_500_000   # bytes; an /ext/result carries at most 1.5 MB of HTML as JSON


def _too_large() -> JSONResponse:
    return JSONResponse(status_code=413, content={"detail": {"code": "too_large",
                                                             "message": f"Request body over {MAX_EXT_BODY} bytes."}})


class _ExtBodyCapRoute(APIRoute):
    """/ext/* bodies are capped BEFORE FastAPI reads and parses them: a declared
    Content-Length over the cap is refused at once, and a chunked body is counted
    as it streams in (refused as soon as it passes the cap). The bytes read are
    handed on as request._body, which FastAPI's own body read returns."""

    def get_route_handler(self):
        handler = super().get_route_handler()
        if "/ext/" not in self.path:
            return handler

        async def capped(request: Request):
            declared = request.headers.get("content-length")
            if declared is not None:
                try:
                    if int(declared) > MAX_EXT_BODY:
                        return _too_large()
                except ValueError:
                    return JSONResponse(status_code=400, content={"detail": "Bad Content-Length"})
            chunks, total = [], 0
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_EXT_BODY:
                    return _too_large()
                chunks.append(chunk)
            request._body = b"".join(chunks)
            return await handler(request)

        return capped


router = APIRouter(prefix="/lead-agent/v1", tags=["lead-agent"], route_class=_ExtBodyCapRoute)

MANAGE_ROLES: FrozenSet[str] = frozenset({"ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN", "OWNER"})
MAX_HTML = 1_500_000
SUGGEST_TIMEOUT_S = 60.0
SUGGEST_MAX_TOKENS = 5000  # a profile is ~1,300-2,450 tokens (~300 the description, last) + ~1,000 reasoning (counted as output); more only feeds a run-on
SUGGEST_EST_TOKENS = 8000  # the credit check's estimate: ~4,500 in (prompt + 15,000-char page) + the reply
THIN_TEXT_CHARS = 200
POLL_INTERVAL_S = 30
MAX_PARALLEL = 2
EXT_LEASE_S = 120


def _err(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error, "message": message})


def _roles(p: PinnedPrincipal) -> FrozenSet[str]:
    return frozenset(str(r).strip().upper().replace(" ", "_").replace("-", "_") for r in (p.roles or []) if r)


class Staff:
    def __init__(self, p: PinnedPrincipal):
        self.user_id = p.user_id
        self.institute_id = p.institute_id
        self.roles = _roles(p)
        self.can_manage = bool(self.roles & MANAGE_ROLES)


async def staff(principal: PinnedPrincipal = Depends(get_pinned_principal)) -> Staff:
    from ..services.tutor.roles import is_staff

    s = Staff(principal)
    if not is_staff(s.roles):
        raise _err(status.HTTP_403_FORBIDDEN, "forbidden", "Only the institute's staff can do this.")
    if not flags.available(s.institute_id):
        raise _err(status.HTTP_403_FORBIDDEN, "not_available",
                   "The Lead Agent is not available for this institute (switched off or not enabled).")
    return s


async def admin(s: Staff = Depends(staff)) -> Staff:
    if not s.can_manage:
        raise _err(status.HTTP_403_FORBIDDEN, "forbidden", "Only an institute admin can do this.")
    return s


def _q(fn, *args, **kwargs):
    """Run fn(db, *args) in one short session (blocking: call through asyncio.to_thread)."""
    with ladb.session() as db:
        return fn(db, *args, **kwargs)


async def run(fn, *args, **kwargs):
    return await asyncio.to_thread(_q, fn, *args, **kwargs)


# ==========================================================================
# agents
# ==========================================================================
def _agent_view(db, row: Dict[str, Any], *, with_today: bool = True) -> Dict[str, Any]:
    name = store.audience_name(db, row["audience_id"], row["institute_id"])
    today = store.get_day(db, row["id"], pacing.agent_day(row.get("window_json"))) if with_today else None
    return models.agent_out(row, audience_name=name, today=today,
                            workers_online=store.workers_online(db, row["institute_id"]),
                            review_waiting=store.review_counts(db, [row["id"]]).get(row["id"], 0))


def _list_agents(db, institute_id: str, include_archived: bool) -> List[Dict[str, Any]]:
    rows = store.list_agents(db, institute_id, include_archived)
    names = store.audience_names(db, [r["audience_id"] for r in rows])
    online = store.workers_online(db, institute_id)
    review = store.review_counts(db, [r["id"] for r in rows])
    return [models.agent_out(r, audience_name=names.get(r["audience_id"]),
                             today=store.get_day(db, r["id"], pacing.agent_day(r.get("window_json"))),
                             workers_online=online, review_waiting=review.get(r["id"], 0)) for r in rows]


@router.get("/agents")
async def list_agents(include_archived: bool = False, s: Staff = Depends(staff)):
    return await run(_list_agents, s.institute_id, include_archived)


def _create_agent(db, s: Staff, body: models.AgentCreate) -> Dict[str, Any]:
    if store.audience_name(db, body.audience_id, s.institute_id) is None:
        raise _err(status.HTTP_404_NOT_FOUND, "audience_not_found", "That lead list is not in this institute.")
    row = store.insert_agent(
        db, institute_id=s.institute_id, audience_id=body.audience_id, name=body.name.strip(),
        brief=body.brief.model_dump(), markets=[m.model_dump(exclude_none=True) for m in body.markets],
        daily_quota=body.daily_quota, monthly_credit_cap=body.monthly_credit_cap, mode=body.mode,
        gate=body.gate.model_dump() if body.gate else None, window=body.window.model_dump() if body.window else None,
        created_by=s.user_id)
    return _agent_view(db, row)


@router.post("/agents", status_code=201)
async def create_agent(body: models.AgentCreate, s: Staff = Depends(admin)):
    try:
        return await run(_create_agent, s, body)
    except IntegrityError:
        raise _err(status.HTTP_409_CONFLICT, "agent_exists", "This lead list already has a Lead Agent.") from None


def _get_agent(db, s: Staff, agent_id: str) -> Dict[str, Any]:
    row = store.get_agent(db, agent_id, s.institute_id)
    if row is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such agent.")
    return _agent_view(db, row)


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, s: Staff = Depends(staff)):
    return await run(_get_agent, s, agent_id)


def _update_agent(db, s: Staff, agent_id: str, body: models.AgentUpdate) -> Dict[str, Any]:
    current = store.get_agent(db, agent_id, s.institute_id)
    if current is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such agent.")
    fields: Dict[str, Any] = {}
    data = body.model_dump(exclude_unset=True)
    if "audience_id" in data and data["audience_id"] != current["audience_id"]:
        if store.audience_name(db, data["audience_id"], s.institute_id) is None:
            raise _err(status.HTTP_404_NOT_FOUND, "audience_not_found", "That lead list is not in this institute.")
        fields["audience_id"] = data["audience_id"]
    if data.get("name"):
        fields["name"] = data["name"].strip()
    if body.brief is not None:
        fields["brief_json"] = body.brief.model_dump()
    if body.markets is not None:
        fields["markets_json"] = [m.model_dump(exclude_none=True) for m in body.markets]
    if body.daily_quota is not None:
        fields["daily_quota"] = body.daily_quota
    if "monthly_credit_cap" in data:
        fields["monthly_credit_cap"] = body.monthly_credit_cap
    if body.mode is not None:
        fields["mode"] = body.mode
    if body.gate is not None:
        # A setting the request leaves out keeps its saved value: a screen that does not know
        # auto_competitor_users must not switch it off by saving the bars.
        saved = {k: v for k, v in (current.get("gate_json") or {}).items() if k in models.Gate.model_fields}
        try:
            fields["gate_json"] = models.Gate(**{**saved, **body.gate.model_dump(exclude_unset=True)}).model_dump()
        except ValueError as exc:
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_gate", str(exc)[:300]) from None
    if body.window is not None:
        fields["window_json"] = body.window.model_dump()
    row = store.update_agent(db, agent_id, s.institute_id, fields)
    if "gate_json" in fields and fields["gate_json"] != current.get("gate_json"):
        moved = research.regate_waiting(db, row)
        if moved:
            logger.info("lead agent %s: %d lead(s) waiting for review pass the new gate", agent_id, moved)
    return _agent_view(db, row)


@router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, body: models.AgentUpdate, s: Staff = Depends(admin)):
    try:
        return await run(_update_agent, s, agent_id, body)
    except IntegrityError:
        raise _err(status.HTTP_409_CONFLICT, "agent_exists", "That lead list already has a Lead Agent.") from None


def _set_status(db, s: Staff, agent_id: str, new_status: str) -> Dict[str, Any]:
    current = store.get_agent(db, agent_id, s.institute_id)
    if current is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such agent.")
    if current["status"] == "ARCHIVED" and new_status != "ARCHIVED":
        if any(a["audience_id"] == current["audience_id"] and a["id"] != agent_id
               for a in store.list_agents(db, s.institute_id)):
            raise _err(status.HTTP_409_CONFLICT, "agent_exists", "This lead list already has another Lead Agent.")
    row = store.update_agent(db, agent_id, s.institute_id, {"status": new_status})
    if new_status == "ACTIVE":
        store.force_tick(db, agent_id, s.institute_id)
    return _agent_view(db, row)


@router.post("/agents/{agent_id}/status")
async def set_status(agent_id: str, body: models.StatusIn, s: Staff = Depends(admin)):
    try:
        return await run(_set_status, s, agent_id, body.status)
    except IntegrityError:
        raise _err(status.HTTP_409_CONFLICT, "agent_exists", "This lead list already has another Lead Agent.") from None


@router.post("/agents/{agent_id}/run-now")
async def run_now(agent_id: str, s: Staff = Depends(admin)):
    if not flags.platform_enabled():
        raise _err(status.HTTP_409_CONFLICT, "disabled", "The Lead Agent is switched off on the platform.")
    row = await run(store.get_agent, agent_id, s.institute_id)
    if row is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such agent.")
    if row["status"] != "ACTIVE":
        raise _err(status.HTTP_409_CONFLICT, "not_active", "Start the agent first.")
    await run(store.force_tick, agent_id, s.institute_id)
    from ..services.lead_agent import scheduler

    scheduler.run_now(agent_id)
    return {"queued": True}


@router.get("/agents/{agent_id}/candidates")
async def list_candidates(agent_id: str, status_: Optional[str] = Query(None, alias="status", max_length=200),
                          page: int = Query(0, ge=0, le=10000), size: int = Query(25, ge=1, le=100),
                          s: Staff = Depends(staff)):
    def q(db):
        if store.get_agent(db, agent_id, s.institute_id) is None:
            raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such agent.")
        rows, total = store.list_candidates(db, agent_id, status=status_, page=page, size=size)
        return {"items": [models.candidate_summary(r) for r in rows], "total": total, "page": page, "size": size}
    return await asyncio.to_thread(_q, q)


@router.get("/agents/{agent_id}/stats")
async def agent_stats(agent_id: str, days: int = Query(14, ge=1, le=90), s: Staff = Depends(staff)):
    def q(db):
        agent = store.get_agent(db, agent_id, s.institute_id)
        if agent is None:
            raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such agent.")
        since = pacing.agent_day(agent.get("window_json")) - timedelta(days=days - 1)
        return [{k: models._plain(v) for k, v in r.items()} for r in store.day_stats(db, agent_id, since)]
    return await asyncio.to_thread(_q, q)


# ==========================================================================
# candidates
# ==========================================================================
@router.get("/candidates/{candidate_id}")
async def get_candidate(candidate_id: str, s: Staff = Depends(staff)):
    row = await run(store.get_candidate, candidate_id, s.institute_id)
    if row is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such candidate.")
    return models.candidate_detail(row)


@router.post("/candidates/{candidate_id}/decision")
async def decide(candidate_id: str, body: models.DecisionIn, s: Staff = Depends(admin)):
    def q(db):
        current = store.get_candidate(db, candidate_id, s.institute_id)
        if current is None:
            raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such candidate.")
        changed = store.decide(db, ids=[candidate_id], institute_id=s.institute_id, action=body.action,
                               reason=body.reason, user_id=s.user_id)
        if not changed:
            raise _err(status.HTTP_409_CONFLICT, "wrong_status",
                       f"A {current['status'].lower()} candidate cannot be "
                       f"{'approved' if body.action == 'APPROVE' else 'rejected'}.")
        return models.candidate_detail(store.get_candidate(db, candidate_id, s.institute_id))
    return await asyncio.to_thread(_q, q)


@router.post("/candidates/bulk-decision")
async def bulk_decide(body: models.BulkDecisionIn, s: Staff = Depends(admin)):
    changed = await run(store.decide, ids=list(dict.fromkeys(body.ids)), institute_id=s.institute_id,
                        action=body.action, reason=body.reason, user_id=s.user_id)
    return {"updated": len(changed)}


# ==========================================================================
# brief suggestion (product analysis)
# ==========================================================================
async def _page_text(url: str) -> Optional[str]:
    from ..services.safe_http import SafeFetchError, safe_fetch

    if not re.match(r"^https?://", url.strip(), re.I):
        url = "https://" + url.strip()
    try:
        res = await safe_fetch(url, max_bytes=fetcher.MAX_PAGE_BYTES, timeout=15.0, total_timeout=25.0,
                               allow_http=True, headers={"User-Agent": fetcher.USER_AGENT})
    except SafeFetchError:
        return None
    if res.status_code >= 400:
        return None
    html = fetcher._decode(res.content, res.headers.get("content-type", ""))
    try:  # BeautifulSoup on up to 1.5 MB: off the event loop
        record = await asyncio.to_thread(engine_api.parse_page, url, res.url, html, res.status_code)
    except Exception:  # noqa: BLE001
        return None
    return (record or {}).get("text") if (record or {}).get("access") == "ok" else None


def _suggest_credits(db, institute_id: str, user_id: Optional[str]):
    """Can the institute pay for one suggestion (it is charged by tokens, like any AI feature)?"""
    from ..schemas.credits import CreditCheckRequest
    from ..services.credit_service import CreditService

    return CreditService(db).check_credits(CreditCheckRequest(
        institute_id=institute_id, request_type="agent", estimated_tokens=SUGGEST_EST_TOKENS, user_id=user_id))


@router.post("/brief/suggest")
async def suggest_brief(body: models.SuggestIn, s: Staff = Depends(admin)):
    if not flags.platform_enabled():
        raise _err(status.HTTP_409_CONFLICT, "disabled", "The Lead Agent is switched off on the platform.")
    credits = await run(_suggest_credits, s.institute_id, s.user_id)
    if not credits.has_sufficient_credits:
        raise _err(status.HTTP_402_PAYMENT_REQUIRED, "no_credits",
                   "Not enough AI credits for a suggestion. Add credits and try again.")
    page_text, note = None, None
    if body.url:
        page_text = await _page_text(body.url)
        if not page_text:
            note = "The product page could not be read; the suggestion uses the description only."
    name = " ".join((body.name or "").split()) or None
    if not (name or body.products or (body.description or "").strip() or page_text):
        raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty", "Say what you sell, describe it or give a page.")
    system, user = engine_api.build_profile_prompt(list(body.products), body.description, page_text, name,
                                                   body.seller)
    try:
        profile = await asyncio.wait_for(
            llm.ask(system, user, engine_api.schema("ProductProfile"), purpose="profile",
                    ctx=llm.CallContext(institute_id=s.institute_id, user_id=s.user_id, charge=True),
                    max_tokens=SUGGEST_MAX_TOKENS),
            timeout=SUGGEST_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise _err(status.HTTP_504_GATEWAY_TIMEOUT, "timeout", "The suggestion took too long; try again.") from None
    except (llm.LLMUnavailable, llm.InvalidOutput) as exc:
        raise _err(status.HTTP_502_BAD_GATEWAY, "llm_failed", f"The suggestion failed: {exc}") from None
    return engine_api.parse_profile(profile, products=list(body.products), note=note, name=name)


# ==========================================================================
# suppressions
# ==========================================================================
def normalize_suppression(kind: str, value: str) -> str:
    v = value.strip()
    if kind == "DOMAIN":
        v = v.lower()
        if "://" not in v:
            v = "https://" + v
        domain = engine_api.registered_domain(v)
        if not domain:
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad_value", "Not a domain.")
        return domain
    if kind == "PHONE":
        digits = re.sub(r"\D", "", v)
        if len(digits) < 10:
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad_value", "A phone number needs at least 10 digits.")
        return digits[-10:]
    v = v.lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", v):
        raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad_value", "Not an email address.")
    return v


@router.get("/suppressions")
async def list_suppressions(s: Staff = Depends(staff)):
    rows = await run(store.list_suppressions, s.institute_id)
    return [{k: models._plain(v) for k, v in r.items()} for r in rows]


@router.post("/suppressions", status_code=201)
async def add_suppression(body: models.SuppressionIn, s: Staff = Depends(admin)):
    value = normalize_suppression(body.kind, body.value)
    row = await run(store.insert_suppression, institute_id=s.institute_id, kind=body.kind, value=value,
                    reason=body.reason, note=body.note, created_by=s.user_id)
    return {k: models._plain(v) for k, v in row.items()}


@router.delete("/suppressions/{supp_id}")
async def delete_suppression(supp_id: str, s: Staff = Depends(admin)):
    if not await run(store.delete_suppression, supp_id, s.institute_id):
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such suppression.")
    return {"deleted": True}


# ==========================================================================
# workers (extensions)
# ==========================================================================
@router.get("/workers")
async def list_workers(s: Staff = Depends(staff)):
    rows = await run(store.list_workers, s.institute_id)
    return [{"id": r["id"], "label": r["label"], "user_id": r["user_id"], "last_seen_at": models._plain(r["last_seen_at"]),
             "online": bool(r["online"]), "version": r["version"],
             "pages_today": int(r["pages_today"] or 0) if r["pages_day"] == pacing.now_utc().date() else 0}
            for r in rows]


@router.post("/workers/pair", status_code=201)
async def pair_worker(body: models.PairIn, s: Staff = Depends(admin)):
    return await asyncio.to_thread(ext_auth.pair, institute_id=s.institute_id, user_id=s.user_id,
                                   label=(body.label or "").strip() or None)


@router.delete("/workers/{worker_id}")
async def revoke_worker(worker_id: str, s: Staff = Depends(admin)):
    if not await run(store.revoke_worker, worker_id, s.institute_id):
        raise _err(status.HTTP_404_NOT_FOUND, "not_found", "No such worker.")
    return {"revoked": True}


# ==========================================================================
# extension protocol
# ==========================================================================
def _paused(db, institute_id: str) -> bool:
    if not flags.available(institute_id):
        return True
    return not any(a["status"] == "ACTIVE" and a["mode"] in ("LOCAL", "AUTO")
                   for a in store.list_agents(db, institute_id))


@router.post("/ext/hello")
async def ext_hello(body: models.HelloIn, worker: Dict[str, Any] = Depends(ext_auth.extension_worker)):
    def q(db):
        store.touch_worker(db, worker["id"], version=body.version, label=body.label)
        return {"worker_id": worker["id"], "institute_id": worker["institute_id"],
                "institute_name": store.institute_name(db, worker["institute_id"]),
                # The worker table keeps no name (users live in auth_service); the label names the browser.
                "user_name": body.label or worker.get("label"),
                "poll_interval_s": POLL_INTERVAL_S, "max_parallel": MAX_PARALLEL,
                "paused": _paused(db, worker["institute_id"])}
    return await asyncio.to_thread(_q, q)


@router.post("/ext/claim")
async def ext_claim(body: models.ClaimIn, worker: Dict[str, Any] = Depends(ext_auth.extension_worker)):
    def q(db):
        store.touch_worker(db, worker["id"])
        if _paused(db, worker["institute_id"]):
            return []
        left = store.worker_pages_left(db, worker["id"], pacing.now_utc().date())
        n = min(body.max, left)
        if n <= 0:
            return []
        return store.claim_extension_tasks(db, institute_id=worker["institute_id"], n=n, worker_id=worker["id"],
                                           lease_s=EXT_LEASE_S)
    tasks = await asyncio.to_thread(_q, q)
    return {"tasks": [{"id": t["id"], "url": t["url"], "page_type": t["page_type"], "timeout_ms": 20000,
                       "render": "tab" if (t.get("last_error") or "").startswith("thin_page") else "fetch"}
                      for t in tasks],
            "lease_s": EXT_LEASE_S}


@router.post("/ext/result")
async def ext_result(body: models.ResultIn, worker: Dict[str, Any] = Depends(ext_auth.extension_worker)):
    task = await run(store.get_task, body.task_id)
    if (task is None or task["institute_id"] != worker["institute_id"] or task["status"] != "CLAIMED"
            or task["lease_owner"] != worker["id"]):
        return {"accepted": False}
    today = pacing.now_utc().date()
    if not body.ok:
        await asyncio.to_thread(fetcher.fail_attempt, task, f"extension: {body.error or 'failed'}"[:500],
                                fetched_by="EXTENSION", delay_s=60)
        return {"accepted": True}
    html = (body.html or "")[:MAX_HTML]
    record = await asyncio.to_thread(fetcher._record_for, task, html, body.status_code, body.final_url,
                                     body.content_type)  # parsing is CPU: off the event loop
    thin = ((record.get("access") == "js_shell"
             or (record.get("access") == "ok" and len((record.get("text") or "").strip()) < THIN_TEXT_CHARS))
            and int(task["attempts"] or 0) < store.TASK_MAX_ATTEMPTS
            and not (task.get("last_error") or "").startswith("thin_page"))
    if thin:
        # Probably a JavaScript-built page: ask for it again, rendered in a tab.
        await run(store.retry_task, task["id"], "thin_page: render in a tab", 0, owner=worker["id"])
        await run(store.count_worker_page, worker["id"], today)
        return {"accepted": True}
    await asyncio.to_thread(fetcher.ingest_page_result, task, html, body.status_code, body.final_url,
                            body.content_type, "EXTENSION", record=record)
    await run(store.count_worker_page, worker["id"], today)
    return {"accepted": True}
