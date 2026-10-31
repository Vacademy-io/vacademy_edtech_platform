"""Knowledge Base companions API — design: docs/student-ai/KB_COMPANIONS_DESIGN.md.

Staff (admin / teacher) create a companion on a knowledge base, choose its
topics and who sees it, and can prepare its lessons in advance. Learners open
the companions assigned to them: a topic map with their progress, visual
lessons compiled from the book, practice sets, and a grounded Ask thread.

Every route verifies the JWT and pins the institute from the `clientId`
header (get_pinned_principal) — never from the body or path. Learner access to
a companion is ONE query (repository._LEARNER_VISIBLE). The institute pays for
everything, from its AI credits; lessons and practice sets are compiled once
per topic and shared, so only Ask and uncached speech cost per learner.

No handler holds a database connection across a model call.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator

from ..config import Settings, get_settings
from ..core.security import get_pinned_principal
from ..db import db_session
from ..models.ai_token_usage import RequestType
from ..services.ai_billing import UC, charge_tool, preflight_tool_credits
from ..services.kb.repository import KbRepository
from ..services.kb_companion import ask as ask_svc
from ..services.kb_companion import lesson as lesson_svc
from ..services.kb_companion import practice as practice_svc
from ..services.kb_companion import progress as prog
from ..services.kb_companion import speech as speech_svc
from ..services.kb_companion.repository import MODES, STATUSES, TARGET_TYPES, CompanionRepository
from ..services.tutor.roles import is_staff, normalize_roles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kb-companion/v1", tags=["kb-companion"])

MAX_PREPARE_PER_CALL = 40
QUESTIONS_PER_MINUTE = 6


# ── auth ─────────────────────────────────────────────────────────────────────

class Caller:
    def __init__(self, institute_id: str, user_id: str, roles: List[str], is_root: bool, metering: Any = None):
        self.institute_id, self.user_id, self.roles, self.is_root = institute_id, user_id, roles, is_root
        # Usage-event attribution for this caller's charges (never changes one).
        self.metering = metering

    @property
    def is_staff(self) -> bool:
        return is_staff(self.roles, is_root=self.is_root)


async def _caller(request: Request, authorization: Optional[str] = Header(default=None),
                  settings: Settings = Depends(get_settings)) -> Caller:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Missing Authorization: Bearer <jwt> (with a clientId header)")
    p = await get_pinned_principal(request, authorization, settings)
    if not p.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not identify the user")
    from ..services.ai_billing import metering_from_request
    return Caller(p.institute_id, p.user_id, sorted(normalize_roles(p.roles)), bool(p.is_root_user),
                  metering=metering_from_request(request, p.institute_id, user=p))


def _staff(caller: Caller) -> None:
    if not caller.is_staff:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins and teachers can manage companions")


def _estimate(tool_key: str, institute_id: str) -> Dict[str, Any]:
    """Price + balance on its OWN session: a failed pricing query must not
    abort the caller's transaction (and with it, e.g., the learner's saved
    question). {} when unknown."""
    try:
        with db_session() as pdb:
            return preflight_tool_credits(pdb, tool_key=tool_key, tool_params={}, institute_id=institute_id)
    except Exception as exc:  # noqa: BLE001 — a pricing lookup failure must not block learning
        if _is_usage_limit(exc):
            raise  # an AI usage limit (HTTP 429), not a pricing failure
        logger.warning("kbc preflight failed for %s", tool_key, exc_info=True)
        return {}


def _is_usage_limit(exc: BaseException) -> bool:
    try:
        from ..services.metering.limit_gate import is_limit_exceeded

        return is_limit_exceeded(exc)
    except Exception:  # noqa: BLE001
        return False


def _credits_or_402(db, tool_key: str, institute_id: str) -> None:
    est = _estimate(tool_key, institute_id)
    if est.get("sufficient") is False:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail={
            "code": "CREDITS_EXHAUSTED",
            "message": "Your institute has run out of AI credits. Please let your teacher know.",
        })


# ── schemas ──────────────────────────────────────────────────────────────────

class Target(BaseModel):
    target_type: str
    target_id: Optional[str] = None

    @field_validator("target_type")
    @classmethod
    def _tt(cls, v: str) -> str:
        v = (v or "").upper()
        if v not in TARGET_TYPES:
            raise ValueError(f"target_type must be one of {TARGET_TYPES}")
        return v


class CompanionFields(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    avatar_emoji: Optional[str] = Field(None, max_length=16)
    accent_color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    persona: Optional[str] = Field(None, max_length=1000)
    language: Optional[str] = Field(None, pattern=r"^(en|hi|kn)$")
    modes: Optional[List[str]] = None
    scope_node_ids: Optional[List[str]] = None
    voice_enabled: Optional[bool] = None
    voice_provider: Optional[str] = Field(None, pattern=r"^(smallest|sarvam|google|edge)$")
    voice_id: Optional[str] = Field(None, max_length=120)
    show_on_dashboard: Optional[bool] = None
    daily_question_cap: Optional[int] = Field(None, ge=0, le=500)
    status: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    assignments: Optional[List[Target]] = None

    @field_validator("modes")
    @classmethod
    def _modes(cls, v):
        if v is None:
            return v
        v = [m.lower() for m in v if m and m.lower() in MODES]
        if not v:
            raise ValueError("choose at least one of learn, practice, ask")
        return list(dict.fromkeys(v))

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v is not None and v.upper() not in STATUSES:
            raise ValueError(f"status must be one of {STATUSES}")
        return v.upper() if v else v


class CompanionCreate(CompanionFields):
    knowledge_base_id: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=200)


class AssignmentsIn(BaseModel):
    assignments: List[Target]


class PrepareIn(BaseModel):
    node_ids: Optional[List[str]] = None
    dry_run: bool = False


class CheckResult(BaseModel):
    card_id: str = Field(..., max_length=20)
    correct: bool


class PracticeResult(BaseModel):
    correct: int = Field(..., ge=0, le=100)
    total: int = Field(..., ge=1, le=100)


class ProgressIn(BaseModel):
    node_id: str = Field(..., max_length=255)
    card_index: int = Field(0, ge=0, le=100)
    cards_total: int = Field(0, ge=0, le=100)
    check: Optional[CheckResult] = None
    practice: Optional[PracticeResult] = None
    completed: Optional[bool] = None


class AskIn(BaseModel):
    question: str = Field(..., min_length=1, max_length=ask_svc.MAX_QUESTION_CHARS)
    node_id: Optional[str] = Field(None, max_length=255)


class SpeechIn(BaseModel):
    node_id: Optional[str] = Field(None, max_length=255)
    card_id: Optional[str] = Field(None, max_length=20)
    message_id: Optional[int] = None


# ── shared loaders ───────────────────────────────────────────────────────────

def _usable_kb(db, kb_id: str, institute_id: str) -> Dict[str, Any]:
    kbr = KbRepository(db)
    kb = kbr.get_kb(kb_id, institute_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not kbr.is_usable(kb, institute_id):
        raise HTTPException(status_code=403, detail="This knowledge base is not available to your institute")
    return kb


def _scoped(db, kb_id: str, scope: List[str]) -> List[Dict[str, Any]]:
    return prog.scoped_map(KbRepository(db).get_topic_tree(kb_id), scope)


def _staff_companion(db, caller: Caller, companion_id: str) -> Dict[str, Any]:
    c = CompanionRepository(db).get_companion(companion_id, caller.institute_id)
    if not c or c["status"] == "ARCHIVED":
        raise HTTPException(status_code=404, detail="Companion not found")
    return c


def _learner_companion(db, caller: Caller, companion_id: str) -> Dict[str, Any]:
    """A companion the caller may study with: assigned + active for learners;
    staff may also preview any non-archived companion of their institute."""
    repo = CompanionRepository(db)
    c = repo.learner_companion(companion_id, caller.institute_id, caller.user_id)
    if not c and caller.is_staff:
        c = repo.get_companion(companion_id, caller.institute_id)
        if c and c["status"] == "ARCHIVED":
            c = None
    if not c:
        raise HTTPException(status_code=404, detail="Companion not found")
    return c


def _leaf_node(db, companion: Dict[str, Any], kb: Dict[str, Any], node_id: str) -> Dict[str, Any]:
    scoped = _scoped(db, kb["id"], companion["scope_node_ids"])
    if node_id not in prog.leaf_ids(scoped):
        raise HTTPException(status_code=404, detail="Topic not found in this companion")
    node = CompanionRepository(db).get_node(kb["id"], node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Topic not found")
    return node


def _validated_targets(db, caller: Caller, targets: List[Target]) -> List[Dict[str, str]]:
    repo = CompanionRepository(db)
    out: List[Dict[str, str]] = []
    batches = [t.target_id for t in targets if t.target_type == "BATCH" and t.target_id]
    learners = [t.target_id for t in targets if t.target_type == "LEARNER" and t.target_id]
    ok_batches = set(repo.batches_in_institute(caller.institute_id, batches))
    ok_learners = set(repo.learners_in_institute(caller.institute_id, learners))
    bad = [b for b in batches if b not in ok_batches] + [u for u in learners if u not in ok_learners]
    if bad:
        raise HTTPException(status_code=400, detail=f"Not in this institute: {', '.join(bad[:5])}")
    if any(t.target_type == "INSTITUTE" for t in targets):
        out.append({"target_type": "INSTITUTE", "target_id": caller.institute_id})
    out += [{"target_type": "BATCH", "target_id": b} for b in dict.fromkeys(batches)]
    out += [{"target_type": "LEARNER", "target_id": u} for u in dict.fromkeys(learners)]
    return out


def _validated_scope(db, kb_id: str, scope: Optional[List[str]]) -> List[str]:
    if not scope:
        return []
    tree = KbRepository(db).get_topic_tree(kb_id)
    known = {t["id"] for t in tree} | {s["id"] for t in tree for s in t.get("subtopics") or []}
    bad = [s for s in scope if s not in known]
    if bad:
        raise HTTPException(status_code=400, detail="Some chosen topics are not in this knowledge base")
    return list(dict.fromkeys(scope))


def _companion_public(c: Dict[str, Any]) -> Dict[str, Any]:
    keys = ("id", "knowledge_base_id", "kb_name", "name", "description", "avatar_emoji", "accent_color",
            "language", "modes", "voice_enabled", "show_on_dashboard", "daily_question_cap")
    return {k: c.get(k) for k in keys}


# ── staff ────────────────────────────────────────────────────────────────────

@router.get("/companions", summary="Companions of this institute (optionally of one knowledge base)")
async def list_companions(kb_id: Optional[str] = Query(None), caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        repo = CompanionRepository(db)
        items = repo.list_companions(caller.institute_id, kb_id)
        for c in items:
            c["assignments"] = repo.list_assignments(c["id"], caller.institute_id)
    return {"companions": items}


@router.post("/companions", status_code=201, summary="Create a companion on a knowledge base")
async def create_companion(body: CompanionCreate, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        _usable_kb(db, body.knowledge_base_id, caller.institute_id)
        data = body.model_dump(exclude_none=True)
        data["scope_node_ids"] = _validated_scope(db, body.knowledge_base_id, body.scope_node_ids)
        targets = _validated_targets(db, caller, body.assignments or [])
        repo = CompanionRepository(db)
        cid = repo.create_companion(caller.institute_id, caller.user_id, data)
        repo.replace_assignments(cid, caller.institute_id, targets)
    return await get_companion(cid, caller)


@router.get("/companions/{companion_id}", summary="One companion with its assignments, topics and lesson status")
async def get_companion(companion_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        repo = CompanionRepository(db)
        c = _staff_companion(db, caller, companion_id)
        c["assignments"] = repo.list_assignments(companion_id, caller.institute_id)
        scoped = _scoped(db, c["knowledge_base_id"], c["scope_node_ids"])
        statuses = repo.lesson_statuses(caller.institute_id, c["knowledge_base_id"], c["language"])
        for t in scoped:
            for leaf in t["leaves"]:
                leaf["lesson"] = statuses.get(leaf["id"])
        c["topics"] = scoped
        leaves = prog.leaf_ids(scoped)
        c["lessons_ready"] = sum(1 for n in leaves if (statuses.get(n) or {}).get("status") == "READY")
        c["leaves_total"] = len(leaves)
    return c


@router.put("/companions/{companion_id}", summary="Update a companion (and optionally who sees it)")
async def update_companion(companion_id: str, body: CompanionFields, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        c = _staff_companion(db, caller, companion_id)
        changes = body.model_dump(exclude_unset=True)
        targets = changes.pop("assignments", None)
        if "scope_node_ids" in changes:
            changes["scope_node_ids"] = _validated_scope(db, c["knowledge_base_id"], changes["scope_node_ids"])
        for k in ("name", "language", "modes", "voice_enabled", "show_on_dashboard", "daily_question_cap", "status"):
            if k in changes and changes[k] is None:
                changes.pop(k)
        repo = CompanionRepository(db)
        repo.update_companion(companion_id, caller.institute_id, changes)
        if targets is not None:
            repo.replace_assignments(companion_id, caller.institute_id,
                                     _validated_targets(db, caller, body.assignments or []))
    return await get_companion(companion_id, caller)


@router.delete("/companions/{companion_id}", summary="Archive a companion (learners stop seeing it)")
async def archive_companion(companion_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        _staff_companion(db, caller, companion_id)
        CompanionRepository(db).update_companion(companion_id, caller.institute_id, {"status": "ARCHIVED"})
    return {"id": companion_id, "status": "ARCHIVED"}


@router.put("/companions/{companion_id}/assignments", summary="Replace who sees the companion")
async def put_assignments(companion_id: str, body: AssignmentsIn, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        _staff_companion(db, caller, companion_id)
        repo = CompanionRepository(db)
        repo.replace_assignments(companion_id, caller.institute_id, _validated_targets(db, caller, body.assignments))
        return {"assignments": repo.list_assignments(companion_id, caller.institute_id)}


@router.post("/companions/{companion_id}/prepare", summary="Compile lessons in advance (dry_run = estimate only)")
async def prepare_lessons(companion_id: str, body: PrepareIn, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        c = _staff_companion(db, caller, companion_id)
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        leaves = prog.leaf_ids(_scoped(db, kb["id"], c["scope_node_ids"]))
        if body.node_ids:
            wanted = set(body.node_ids)
            leaves = [n for n in leaves if n in wanted]
        repo = CompanionRepository(db)
        statuses = repo.lesson_statuses(caller.institute_id, kb["id"], c["language"])
        todo = [n for n in leaves if (statuses.get(n) or {}).get("status") not in ("READY", "GENERATING")]
        batch = todo[:MAX_PREPARE_PER_CALL]
        est = _estimate(lesson_svc.LESSON_TOOL, caller.institute_id)
        per = float(est.get("estimated_credits") or 0)
        summary = {"to_prepare": len(todo), "this_call": len(batch), "credits_per_lesson": per,
                   "estimated_credits": round(per * len(batch), 2), "balance": est.get("current_balance")}
        if body.dry_run or not batch:
            return {**summary, "started": 0}
        balance = est.get("current_balance")
        if balance is not None and float(balance) < per * len(batch):
            raise HTTPException(status_code=402, detail={
                "code": "CREDITS_EXHAUSTED",
                "message": f"Preparing {len(batch)} lessons needs about {round(per * len(batch))} credits.",
            })
        jobs = []
        for node_id in batch:
            node = repo.get_node(kb["id"], node_id)
            if not node:
                continue
            lesson_id = repo.claim_artifact("lesson", caller.institute_id, kb["id"], node_id, c["language"],
                                            created_by=caller.user_id)
            if lesson_id:
                jobs.append(lesson_svc.CompileJob(lesson_id=lesson_id, institute_id=caller.institute_id,
                                                  user_id=caller.user_id, kb=kb, node=node, language=c["language"],
                                                  metering=getattr(caller, "metering", None)))
    for job in jobs:
        lesson_svc.start_compile(job)
    return {**summary, "started": len(jobs)}


@router.get("/companions/{companion_id}/insights", summary="Learner progress on this companion")
async def insights(companion_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    _staff(caller)
    with db_session() as db:
        c = _staff_companion(db, caller, companion_id)
        data = CompanionRepository(db).insights(companion_id, caller.institute_id)
        scoped = _scoped(db, c["knowledge_base_id"], c["scope_node_ids"])
    titles = {leaf["id"]: leaf["title"] for t in scoped for leaf in t["leaves"]}
    for n in data["nodes"]:
        n["title"] = titles.get(n["node_id"])
    data["leaves_total"] = len(titles)
    return data


# ── learner ──────────────────────────────────────────────────────────────────

@router.get("/learner/companions", summary="Companions assigned to me, with my progress")
async def my_companions(caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    out = []
    with db_session() as db:
        repo = CompanionRepository(db)
        kbr = KbRepository(db)
        trees: Dict[str, List[Dict[str, Any]]] = {}
        for c in repo.learner_companions(caller.institute_id, caller.user_id):
            kb = kbr.get_kb(c["knowledge_base_id"], caller.institute_id)
            if not kb or not kbr.is_usable(kb, caller.institute_id):
                continue
            if kb["id"] not in trees:
                trees[kb["id"]] = kbr.get_topic_tree(kb["id"])
            scoped = prog.scoped_map(trees[kb["id"]], c["scope_node_ids"])
            leaves = prog.leaf_ids(scoped)
            rows = repo.progress_rows(c["id"], caller.user_id)
            resume = prog.resume_point(leaves, rows)
            titles = {leaf["id"]: leaf["title"] for t in scoped for leaf in t["leaves"]}
            if resume:
                resume["title"] = titles.get(resume["node_id"])
            out.append({**_companion_public(c), "progress": prog.summary(leaves, rows), "resume": resume,
                        "topics_total": len(scoped)})
    return {"companions": out}


@router.get("/learner/companions/{companion_id}", summary="Topic map, my progress and where to continue")
async def my_companion(companion_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        repo = CompanionRepository(db)
        scoped = _scoped(db, kb["id"], c["scope_node_ids"])
        rows = repo.progress_rows(companion_id, caller.user_id)
        statuses = repo.lesson_statuses(caller.institute_id, kb["id"], c["language"])
        name = repo.learner_first_name(caller.user_id)
    by_node = {r["node_id"]: r for r in rows}
    for t in scoped:
        for leaf in t["leaves"]:
            r = by_node.get(leaf["id"])
            leaf["progress"] = ({k: r[k] for k in ("status", "card_index", "cards_total", "mastery", "last_activity_at")}
                                if r else None)
            leaf["lesson_ready"] = (statuses.get(leaf["id"]) or {}).get("status") == "READY"
    leaves = prog.leaf_ids(scoped)
    resume = prog.resume_point(leaves, rows)
    if resume:
        resume["title"] = next((leaf["title"] for t in scoped for leaf in t["leaves"] if leaf["id"] == resume["node_id"]), None)
    return {"companion": _companion_public(c), "learner_name": name, "topics": scoped,
            "progress": prog.summary(leaves, rows), "resume": resume}


def _lesson_response(row: Optional[Dict[str, Any]], c: Dict[str, Any], node: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {"status": "MISSING", "cards": [], "node_id": node["id"], "title": node.get("title")}
    return {
        "status": row["status"], "node_id": node["id"], "title": row.get("title") or node.get("title"),
        "cards_planned": row.get("cards_planned") or len(row["payload"]),
        "cards": lesson_svc.serve_cards(row["payload"], accent=c.get("accent_color"), language=c["language"]),
        "error": "We couldn't prepare this lesson. Please try again in a minute." if row["status"] == "FAILED" else None,
    }


@router.post("/learner/companions/{companion_id}/nodes/{node_id}/lesson", summary="Open a lesson (compiles it the first time)")
async def open_lesson(companion_id: str, node_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    if_start: Optional[lesson_svc.CompileJob] = None
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        if "learn" not in c["modes"]:
            raise HTTPException(status_code=403, detail="Learning is turned off for this companion")
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        node = _leaf_node(db, c, kb, node_id)
        repo = CompanionRepository(db)
        row = repo.get_artifact("lesson", caller.institute_id, kb["id"], node_id, c["language"])
        needs = row is None or row["status"] != "READY"
        fingerprint = None
        if not needs:
            # A re-ingested book changes the passages: recompile rather than
            # teach from a stale reading of it.
            fingerprint = lesson_svc.gather_material(db, kb, node).fingerprint
            needs = bool(row.get("source_fingerprint")) and row["source_fingerprint"] != fingerprint
        if needs and not (row and row["status"] == "GENERATING" and row["idle_seconds"] < 240):
            _credits_or_402(db, lesson_svc.LESSON_TOOL, caller.institute_id)
            lesson_id = repo.claim_artifact("lesson", caller.institute_id, kb["id"], node_id, c["language"],
                                            fingerprint=fingerprint, created_by=caller.user_id)
            if lesson_id:
                if_start = lesson_svc.CompileJob(lesson_id=lesson_id, institute_id=caller.institute_id,
                                                 user_id=caller.user_id, kb=kb, node=node, language=c["language"],
                                                 metering=getattr(caller, "metering", None))
            row = repo.get_artifact("lesson", caller.institute_id, kb["id"], node_id, c["language"])
    if if_start:
        lesson_svc.start_compile(if_start)
    return _lesson_response(row, c, node)


@router.get("/learner/companions/{companion_id}/nodes/{node_id}/lesson", summary="Poll a lesson")
async def poll_lesson(companion_id: str, node_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        node = _leaf_node(db, c, kb, node_id)
        row = CompanionRepository(db).get_artifact("lesson", caller.institute_id, kb["id"], node_id, c["language"])
    if row and row["status"] == "GENERATING" and row["idle_seconds"] > 240:
        row["status"] = "FAILED"
    return _lesson_response(row, c, node)


def _practice_response(row: Optional[Dict[str, Any]], node: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {"status": "MISSING", "questions": [], "node_id": node["id"], "title": node.get("title")}
    st = row["status"]
    if st == "GENERATING" and row["idle_seconds"] > 240:
        st = "FAILED"
    return {"status": st, "node_id": node["id"], "title": node.get("title"),
            "questions": row["payload"] if st == "READY" else [],
            "error": "We couldn't prepare practice questions. Please try again in a minute." if st == "FAILED" else None}


@router.post("/learner/companions/{companion_id}/nodes/{node_id}/practice", summary="Get or start a practice set")
async def open_practice(companion_id: str, node_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    job: Optional[practice_svc.PracticeJob] = None
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        if "practice" not in c["modes"]:
            raise HTTPException(status_code=403, detail="Practice is turned off for this companion")
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        node = _leaf_node(db, c, kb, node_id)
        repo = CompanionRepository(db)
        row = repo.get_artifact("practice", caller.institute_id, kb["id"], node_id, c["language"])
        if row is None or row["status"] == "FAILED" or (row["status"] == "GENERATING" and row["idle_seconds"] > 240):
            _credits_or_402(db, practice_svc.PRACTICE_TOOL, caller.institute_id)
            pid = repo.claim_artifact("practice", caller.institute_id, kb["id"], node_id, c["language"])
            if pid:
                job = practice_svc.PracticeJob(practice_id=pid, institute_id=caller.institute_id,
                                               user_id=caller.user_id, kb=kb, node=node, language=c["language"],
                                               metering=getattr(caller, "metering", None))
            row = repo.get_artifact("practice", caller.institute_id, kb["id"], node_id, c["language"])
    if job:
        practice_svc.start_practice(job)
    return _practice_response(row, node)


@router.get("/learner/companions/{companion_id}/nodes/{node_id}/practice", summary="Poll a practice set")
async def poll_practice(companion_id: str, node_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        node = _leaf_node(db, c, kb, node_id)
        row = CompanionRepository(db).get_artifact("practice", caller.institute_id, kb["id"], node_id, c["language"])
    return _practice_response(row, node)


@router.post("/learner/companions/{companion_id}/progress", summary="Record my position, checks and practice")
async def record_progress(companion_id: str, body: ProgressIn, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        _leaf_node(db, c, kb, body.node_id)
        repo = CompanionRepository(db)
        rows = repo.progress_rows(companion_id, caller.user_id)
        existing = next((r for r in rows if r["node_id"] == body.node_id), None)
        update = body.model_dump(exclude_none=True)
        values = prog.apply_update(existing, update)
        if values["completed_at"] is True:
            values["completed_at"] = datetime.utcnow()
        repo.upsert_progress(companion_id, caller.institute_id, caller.user_id, body.node_id, values)
        scoped = _scoped(db, kb["id"], c["scope_node_ids"])
        rows = repo.progress_rows(companion_id, caller.user_id)
    leaves = prog.leaf_ids(scoped)
    mine = next((r for r in rows if r["node_id"] == body.node_id), None)
    return {"node": mine, "progress": prog.summary(leaves, rows), "resume": prog.resume_point(leaves, rows)}


@router.get("/learner/companions/{companion_id}/thread", summary="My Ask conversation with this companion")
async def my_thread(companion_id: str, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        msgs = CompanionRepository(db).thread(companion_id, caller.user_id)
        counts = CompanionRepository(db).question_counts(companion_id, caller.user_id)
    return {"messages": msgs, "questions_today": counts["today"], "daily_cap": c["daily_question_cap"]}


@router.post("/learner/companions/{companion_id}/ask", summary="Ask a question, answered from the book")
async def ask(companion_id: str, body: AskIn, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Ask a question")
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        if "ask" not in c["modes"]:
            raise HTTPException(status_code=403, detail="Questions are turned off for this companion")
        kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
        repo = CompanionRepository(db)
        counts = repo.question_counts(companion_id, caller.user_id)
        if c["daily_question_cap"] and counts["today"] >= c["daily_question_cap"]:
            raise HTTPException(status_code=429, detail={
                "code": "DAILY_LIMIT", "message": "You've asked a lot today! Come back tomorrow for more questions."})
        if counts["last_minute"] >= QUESTIONS_PER_MINUTE:
            raise HTTPException(status_code=429, detail={
                "code": "SLOW_DOWN", "message": "Take a breath — try again in a moment."})
        scoped = _scoped(db, kb["id"], c["scope_node_ids"])
        node = None
        if body.node_id and body.node_id in prog.leaf_ids(scoped):
            node = repo.get_node(kb["id"], body.node_id)
        history = repo.thread(companion_id, caller.user_id, limit=ask_svc.HISTORY_TURNS)
        rows = repo.progress_rows(companion_id, caller.user_id)
        name = repo.learner_first_name(caller.user_id)
        user_meta = {"node_id": node["id"] if node else None}
        if ask_svc.is_distress(question):
            # Answered even when the institute is out of credits: no model call.
            repo.add_message(companion_id, caller.institute_id, caller.user_id, "user", question, user_meta)
            reply = ask_svc.DISTRESS_REPLY.get(c["language"], ask_svc.DISTRESS_REPLY["en"])
            mid = repo.add_message(companion_id, caller.institute_id, caller.user_id, "assistant", reply,
                                   {"kind": "care", "grounded": False})
            return {"message": {"id": mid, "role": "assistant", "content": reply, "meta": {"kind": "care"}}}
        # Before the question is stored: a 402 (like a 429) leaves no trace, so
        # the learner app hands the question back to retry later.
        _credits_or_402(db, ask_svc.ASK_TOOL, caller.institute_id)
        repo.add_message(companion_id, caller.institute_id, caller.user_id, "user", question, user_meta)
        db.commit()
        hits = await ask_svc.retrieve(db, kb=kb, institute_id=caller.institute_id, question=question, node=node)
        covered = [leaf["title"] for t in scoped for leaf in t["leaves"] if leaf.get("title")]
        if not hits:
            reply = ask_svc.not_found_reply(c["language"], covered[:3])
            meta = {"kind": "not_found", "grounded": False, "in_scope": False}
            mid = repo.add_message(companion_id, caller.institute_id, caller.user_id, "assistant", reply, meta)
            return {"message": {"id": mid, "role": "assistant", "content": reply, "meta": meta}}
    excerpts, citations, figures, figures_text = ask_svc.build_context(hits)
    memo = prog.learner_memo(scoped, rows, node["id"] if node else None)
    try:
        shaped, res = await ask_svc.answer(
            companion=c, learner_name=name, memo=memo, question=question, excerpts=excerpts,
            figures_text=figures_text, history=history, covered_topics=covered,
            current_topic=node["title"] if node else None, citations=citations, figures=figures,
        )
    except Exception:  # noqa: BLE001
        logger.exception("kbc ask failed for companion %s", companion_id)
        raise HTTPException(status_code=502, detail={"code": "ASK_FAILED",
                                                     "message": "I couldn't answer just now. Please try again."})
    meta = {"kind": "answer", "grounded": True, **{k: shaped[k] for k in ("in_scope", "citations", "figures", "follow_ups")},
            "node_id": node["id"] if node else None}
    with db_session() as db:
        mid = CompanionRepository(db).add_message(companion_id, caller.institute_id, caller.user_id, "assistant",
                                                  shaped["answer"], meta)
        try:
            charge_tool(db, tool_key=ask_svc.ASK_TOOL, tool_params={}, request_type=RequestType.KNOWLEDGE_BASE,
                        model=res.model, prompt_tokens=res.prompt_tokens, completion_tokens=res.completion_tokens,
                        institute_id=caller.institute_id, user_id=caller.user_id, request_id=f"kbc_msg:{mid}",
                        idempotency_key=f"kbc_ask:{mid}",
                        use_case=UC.KB_COMPANION, metering=getattr(caller, "metering", None),
                        usage_context={"companion_id": companion_id, "feature": "kbc_ask"})
        except Exception:  # noqa: BLE001
            logger.warning("kbc ask billing failed for message %s", mid, exc_info=True)
    return {"message": {"id": mid, "role": "assistant", "content": shaped["answer"], "meta": meta}}


@router.post("/learner/companions/{companion_id}/speech", summary="Read-aloud audio for a card or an answer")
async def speech(companion_id: str, body: SpeechIn, caller: Caller = Depends(_caller)) -> Dict[str, Any]:
    with db_session() as db:
        c = _learner_companion(db, caller, companion_id)
        if not c["voice_enabled"]:
            raise HTTPException(status_code=403, detail="Read-aloud is turned off for this companion")
        repo = CompanionRepository(db)
        if body.message_id is not None:
            msg = repo.get_message(body.message_id, companion_id, caller.user_id)
            if not msg or msg["role"] != "assistant":
                raise HTTPException(status_code=404, detail="Message not found")
            text_ = speech_svc.speakable(msg["content"])
        elif body.node_id and body.card_id:
            kb = _usable_kb(db, c["knowledge_base_id"], caller.institute_id)
            _leaf_node(db, c, kb, body.node_id)
            row = repo.get_artifact("lesson", caller.institute_id, kb["id"], body.node_id, c["language"])
            card = next((x for x in (row or {}).get("payload") or [] if x.get("id") == body.card_id), None)
            if not card:
                raise HTTPException(status_code=404, detail="Card not found")
            text_ = speech_svc.speakable(card.get("say") or card.get("title") or "")
        else:
            raise HTTPException(status_code=400, detail="Give a message_id, or a node_id and card_id")
        if not text_:
            raise HTTPException(status_code=404, detail="Nothing to read aloud")
        _credits_or_402(db, speech_svc.SPEECH_TOOL, caller.institute_id)
    url, hit, provider = await speech_svc.narration(text_, c)
    if not url:
        raise HTTPException(status_code=503, detail="Read-aloud is unavailable right now")
    if not hit:
        with db_session() as db:
            try:
                charge_tool(db, tool_key=speech_svc.SPEECH_TOOL, tool_params={}, request_type=RequestType.KNOWLEDGE_BASE,
                            model=provider, institute_id=caller.institute_id, user_id=caller.user_id,
                            character_count=len(text_),
                            use_case=UC.KB_COMPANION, metering=getattr(caller, "metering", None),
                            usage_context={"companion_id": companion_id, "feature": "kbc_speech"})
            except Exception:  # noqa: BLE001
                logger.warning("kbc speech billing failed", exc_info=True)
    return {"url": url, "cached": hit}
