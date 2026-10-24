"""Persistence for teaching plans: versions, status transitions, listings.

ai_service owns these rows (V494). Every write goes through here so the
status machine (NEEDS_DETAILS → COMPILING → READY | FAILED, READY → STALE →
recompile, older versions → DELETED) lives in one place.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.teaching_plan import TeachingConcept, TeachingMedia, TeachingPlan, TeachingTopic
from ...schemas.tutor import TeachingPlanDraft
from .board_ops import clean_ops, materialize, ops_to_dicts

logger = logging.getLogger(__name__)

TERMINAL_OK = "READY"
# A STALE plan (source edited since it was compiled) keeps serving learners
# until a newer READY version replaces it (design §4.7); only compile-time
# decisions treat STALE as "needs work".
SERVING_STATUSES = ("READY", "STALE")
# A compile that has not finished in this long is dead (the worker was
# cancelled, crashed or redeployed); its row is retired so the slide can be
# compiled again and the course page stops showing "compiling" forever.
STUCK_COMPILING_MINUTES = 30


def latest_plan(db: Session, slide_id: str) -> Optional[TeachingPlan]:
    return (
        db.query(TeachingPlan)
        .filter(TeachingPlan.slide_id == slide_id, TeachingPlan.status != "DELETED")
        .order_by(TeachingPlan.version.desc())
        .first()
    )


def latest_ready_plan(db: Session, slide_id: str) -> Optional[TeachingPlan]:
    """Newest plan learners can be taught from (READY, or STALE until a
    recompile lands)."""
    return (
        db.query(TeachingPlan)
        .filter(TeachingPlan.slide_id == slide_id, TeachingPlan.status.in_(SERVING_STATUSES))
        .order_by(TeachingPlan.version.desc())
        .first()
    )


def reinstate_ready(db: Session, plan: TeachingPlan) -> None:
    """A STALE plan whose source hash still matches: nothing to recompile."""
    plan.status = TERMINAL_OK
    plan.error = None
    plan.updated_at = datetime.utcnow()
    db.flush()


def retire_stuck_compiling(db: Session, slide_id: Optional[str] = None) -> int:
    """COMPILING rows older than STUCK_COMPILING_MINUTES become FAILED."""
    cutoff = datetime.utcnow() - timedelta(minutes=STUCK_COMPILING_MINUTES)
    q = db.query(TeachingPlan).filter(TeachingPlan.status == "COMPILING", TeachingPlan.updated_at < cutoff)
    if slide_id:
        q = q.filter(TeachingPlan.slide_id == slide_id)
    n = q.update({"status": "FAILED", "error": "compile timed out or was interrupted",
                  "updated_at": datetime.utcnow()}, synchronize_session=False)
    if n:
        db.flush()
    return int(n or 0)


def active_compiling(db: Session, slide_id: str) -> Optional[TeachingPlan]:
    cutoff = datetime.utcnow() - timedelta(minutes=STUCK_COMPILING_MINUTES)
    return (
        db.query(TeachingPlan)
        .filter(TeachingPlan.slide_id == slide_id, TeachingPlan.status == "COMPILING",
                TeachingPlan.updated_at >= cutoff)
        .order_by(TeachingPlan.version.desc())
        .first()
    )


def next_version(db: Session, slide_id: str) -> int:
    row = db.execute(
        text("SELECT COALESCE(MAX(version), 0) FROM teaching_plan WHERE slide_id = :sid"),
        {"sid": slide_id},
    ).scalar()
    return int(row or 0) + 1


def start_plan(
    db: Session,
    *,
    slide_id: str,
    institute_id: str,
    content_hash: str,
    language: str,
    user_id: Optional[str],
    source_description: Optional[str],
    status: str = "COMPILING",
) -> TeachingPlan:
    retire_stuck_compiling(db, slide_id)
    plan = TeachingPlan(
        id=str(uuid4()),
        slide_id=slide_id,
        institute_id=institute_id,
        version=next_version(db, slide_id),
        content_hash=content_hash,
        language=language,
        status=status,
        source_description=source_description,
        created_by_user_id=user_id,
    )
    try:
        with db.begin_nested():
            db.add(plan)
            db.flush()
    except IntegrityError:
        # Two compiles of the same slide raced on UNIQUE(slide_id, version):
        # take the next number and try once more.
        plan.version = next_version(db, slide_id)
        db.add(plan)
        db.flush()
    return plan


def fail_plan(db: Session, plan: TeachingPlan, error: str) -> None:
    plan.status = "FAILED"
    plan.error = (error or "")[:4000]
    plan.updated_at = datetime.utcnow()
    db.flush()


def store_draft(
    db: Session,
    plan: TeachingPlan,
    draft: TeachingPlanDraft,
    *,
    model: Optional[str],
    raw: Optional[Dict[str, Any]],
    compile_inputs: Optional[Dict[str, Any]] = None,
    compiled_with_description: Optional[str] = None,
    quality_notes: Optional[List[str]] = None,
) -> TeachingPlan:
    """Write topics/concepts/media from a validated draft and mark READY.

    board_html per concept is the cumulative render of the topic's ops so far,
    so the teaching-off view can show any concept's board on its own. Ops are
    stored SANITIZED (clean_ops), so the learner app never receives a raw
    model SVG. If the admin changed the source description while this compile
    ran, the plan lands STALE rather than READY: its checks were built from the
    old text.
    """
    # Replace whatever a previous attempt on this same plan row wrote.
    db.query(TeachingConcept).filter(TeachingConcept.plan_id == plan.id).delete(synchronize_session=False)
    db.query(TeachingTopic).filter(TeachingTopic.plan_id == plan.id).delete(synchronize_session=False)
    db.query(TeachingMedia).filter(TeachingMedia.plan_id == plan.id).delete(synchronize_session=False)

    for ti, topic in enumerate(draft.topics, start=1):
        t_row = TeachingTopic(
            id=str(uuid4()),
            plan_id=plan.id,
            slide_id=plan.slide_id,
            topic_order=ti,
            title=topic.title,
            estimated_seconds=topic.estimated_seconds,
            summary_ops_json=clean_ops(ops_to_dicts(topic.summary_ops)) or None,
        )
        db.add(t_row)
        db.flush()
        cumulative: List[Dict[str, Any]] = []
        for ci, concept in enumerate(topic.concepts, start=1):
            ops = clean_ops(ops_to_dicts(concept.board_ops))
            cumulative.extend(ops)
            c_row = TeachingConcept(
                id=str(uuid4()),
                topic_id=t_row.id,
                plan_id=plan.id,
                concept_order=ci,
                title=concept.title,
                concept_tags=list(concept.concept_tags or []),
                prerequisites_json=list(concept.prerequisites or []) or None,
                board_ops_json=ops,
                board_html=materialize(cumulative),
                say=concept.say,
                say_i18n_json=dict(concept.say_i18n or {}) or None,
                teach_notes=concept.teach_notes,
                check_json=concept.check.model_dump() if concept.check else None,
            )
            db.add(c_row)
            db.flush()
            for op in ops:
                if op.get("op") in ("svg", "image", "video"):
                    db.add(TeachingMedia(
                        id=str(uuid4()),
                        plan_id=plan.id,
                        concept_id=c_row.id,
                        kind=op["op"],
                        source={"svg": "SVG", "image": "AI_IMAGE", "video": "AI_VIDEO"}[op["op"]]
                        if op.get("generate") or op["op"] == "svg" else "STOCK",
                        file_id=op.get("media_id"),
                        url=op.get("url"),
                        description=op.get("description") or "",
                        parts_json=op.get("parts") or None,
                    ))
        if topic.summary_ops:
            t_row.summary_html = materialize(cumulative + clean_ops(ops_to_dicts(topic.summary_ops)))

    plan.objectives_json = list(draft.objectives)
    plan.key_terms_json = [kt.model_dump() for kt in draft.key_terms]
    # Fields the topic/concept tables have no column for (spoken recap,
    # predict question), keyed by the draft's own ids.
    extras = {
        "summary_say": [(t.summary_say or "").strip() or None for t in draft.topics],
        "summary_say_i18n": [dict(t.summary_say_i18n or {}) for t in draft.topics],
        "predict": [[(c.predict or "").strip() or None for c in t.concepts] for t in draft.topics],
        "predict_i18n": [[dict(c.predict_i18n or {}) for c in t.concepts] for t in draft.topics],
    }
    plan.raw_plan_json = {"draft": raw, "compile_inputs": compile_inputs or {}, "extras": extras,
                          "quality_notes": list(quality_notes or [])}
    plan.model = model
    # plan.language is the REQUESTED language (set at start_plan); the model's
    # echo of it is not trusted (it may be missing, "Hindi", or anything).
    db.refresh(plan, attribute_names=["source_description"])
    changed_meanwhile = (
        compiled_with_description is not None
        and (plan.source_description or "").strip() != (compiled_with_description or "").strip()
    )
    plan.status = "STALE" if changed_meanwhile else TERMINAL_OK
    plan.error = None
    plan.updated_at = datetime.utcnow()
    db.flush()

    # Older versions of this slide give way to the new plan — only once the
    # new one is READY; a STALE landing keeps the previous READY plan serving.
    if plan.status == TERMINAL_OK:
        db.query(TeachingPlan).filter(
            TeachingPlan.slide_id == plan.slide_id,
            TeachingPlan.id != plan.id,
            TeachingPlan.status.in_(["READY", "STALE", "FAILED", "NEEDS_DETAILS"]),
        ).update({"status": "DELETED", "updated_at": datetime.utcnow()}, synchronize_session=False)
        db.flush()
    return plan


def set_source_description(
    db: Session, *, slide_id: str, institute_id: str, description: str, user_id: Optional[str]
) -> TeachingPlan:
    """Store the admin's description; a NEEDS_DETAILS plan becomes STALE so
    the course page's "prepare" picks it up, a READY one becomes STALE too
    because its checks were built from the old description."""
    plan = latest_plan(db, slide_id)
    if plan is None:
        plan = TeachingPlan(
            id=str(uuid4()), slide_id=slide_id, institute_id=institute_id, version=1,
            content_hash="", language="en", status="STALE", created_by_user_id=user_id,
        )
        db.add(plan)
    plan.source_description = description
    if plan.status in ("NEEDS_DETAILS", "READY", "FAILED"):
        plan.status = "STALE"
    plan.updated_at = datetime.utcnow()
    db.flush()
    return plan


def quality_notes_of(plan: TeachingPlan) -> List[str]:
    raw = plan.raw_plan_json if isinstance(plan.raw_plan_json, dict) else {}
    notes = raw.get("quality_notes")
    return [str(n) for n in notes] if isinstance(notes, list) else []


def plan_view(db: Session, plan: TeachingPlan) -> Dict[str, Any]:
    topics = (
        db.query(TeachingTopic).filter(TeachingTopic.plan_id == plan.id)
        .order_by(TeachingTopic.topic_order).all()
    )
    concepts = (
        db.query(TeachingConcept).filter(TeachingConcept.plan_id == plan.id)
        .order_by(TeachingConcept.concept_order).all()
    )
    by_topic: Dict[str, List[TeachingConcept]] = {}
    for c in concepts:
        by_topic.setdefault(c.topic_id, []).append(c)
    media = db.query(TeachingMedia).filter(TeachingMedia.plan_id == plan.id).all()
    # Recap lines and predict questions are stored by position (rows are
    # written in draft order and read back by topic_order / concept_order).
    extras = ((plan.raw_plan_json or {}).get("extras") or {}) if isinstance(plan.raw_plan_json, dict) else {}
    recaps = extras.get("summary_say") if isinstance(extras.get("summary_say"), list) else []
    recaps_i18n = extras.get("summary_say_i18n") if isinstance(extras.get("summary_say_i18n"), list) else []
    predicts = extras.get("predict") if isinstance(extras.get("predict"), list) else []
    predicts_i18n = extras.get("predict_i18n") if isinstance(extras.get("predict_i18n"), list) else []

    def _cell(rows: list, ti: int, ci: int):
        row = rows[ti] if ti < len(rows) and isinstance(rows[ti], list) else []
        return row[ci] if ci < len(row) else None
    return {
        "plan_id": plan.id,
        "slide_id": plan.slide_id,
        "version": plan.version,
        "status": plan.status,
        "language": plan.language,
        "model": plan.model,
        "objectives": list(plan.objectives_json or []),
        "key_terms": list(plan.key_terms_json or []),
        "source_description": plan.source_description,
        "error": plan.error,
        # Knowledge base the plan was compiled from (None for ungrounded
        # slides): the live tutor pulls passages from it on doubt turns.
        "kb": ((plan.raw_plan_json or {}).get("compile_inputs") or {}).get("kb")
        if isinstance(plan.raw_plan_json, dict) else None,
        "style": (((plan.raw_plan_json or {}).get("compile_inputs") or {}).get("style") or "lesson")
        if isinstance(plan.raw_plan_json, dict) else "lesson",
        # Board-quality asks the compiler let go (the plan is served anyway).
        "quality_notes": quality_notes_of(plan),
        "topics": [
            {
                "id": t.id, "order": t.topic_order, "title": t.title,
                "estimated_seconds": t.estimated_seconds, "summary_html": t.summary_html,
                "summary_ops": list(t.summary_ops_json or []),
                "summary_say": recaps[ti] if ti < len(recaps) else None,
                "summary_say_i18n": recaps_i18n[ti] if ti < len(recaps_i18n) and isinstance(recaps_i18n[ti], dict) else {},
                "concepts": [
                    {
                        "id": c.id, "order": c.concept_order, "title": c.title,
                        "concept_tags": list(c.concept_tags or []),
                        "board_ops": list(c.board_ops_json or []),
                        "board_html": c.board_html,
                        "say": c.say, "say_i18n": dict(c.say_i18n_json or {}),
                        "teach_notes": c.teach_notes, "check": c.check_json,
                        "predict": _cell(predicts, ti, ci),
                        "predict_i18n": _cell(predicts_i18n, ti, ci) or {},
                    }
                    for ci, c in enumerate(by_topic.get(t.id, []))
                ],
            }
            for ti, t in enumerate(topics)
        ],
        "media": [
            {"id": m.id, "concept_id": m.concept_id, "kind": m.kind, "source": m.source,
             "url": m.url, "file_id": m.file_id, "description": m.description, "parts": m.parts_json}
            for m in media
        ],
    }


def latest_plans_for_slides(db: Session, slide_ids: Iterable[str], *, ready_only: bool = False) -> Dict[str, TeachingPlan]:
    """Newest non-deleted (or newest READY) plan per slide, one query."""
    ids = [s for s in dict.fromkeys(slide_ids) if s]
    if not ids:
        return {}
    q = db.query(TeachingPlan).filter(TeachingPlan.slide_id.in_(ids))
    q = q.filter(TeachingPlan.status.in_(SERVING_STATUSES)) if ready_only else q.filter(TeachingPlan.status != "DELETED")
    out: Dict[str, TeachingPlan] = {}
    for plan in q.order_by(TeachingPlan.slide_id, TeachingPlan.version.desc()).all():
        out.setdefault(plan.slide_id, plan)
    return out


def counts_for_plans(db: Session, plan_ids: Iterable[str]) -> Dict[str, Dict[str, int]]:
    ids = [p for p in dict.fromkeys(plan_ids) if p]
    if not ids:
        return {}
    rows = db.execute(text("""
        SELECT p.id,
               (SELECT COUNT(*) FROM teaching_topic t WHERE t.plan_id = p.id) AS topics,
               (SELECT COUNT(*) FROM teaching_concept c WHERE c.plan_id = p.id) AS concepts
        FROM teaching_plan p WHERE p.id = ANY(:ids)
    """), {"ids": ids}).fetchall()
    return {r[0]: {"topics": int(r[1] or 0), "concepts": int(r[2] or 0)} for r in rows}


def plan_counts(db: Session, plan_id: str) -> Dict[str, int]:
    t = db.execute(text("SELECT COUNT(*) FROM teaching_topic WHERE plan_id = :p"), {"p": plan_id}).scalar() or 0
    c = db.execute(text("SELECT COUNT(*) FROM teaching_concept WHERE plan_id = :p"), {"p": plan_id}).scalar() or 0
    return {"topics": int(t), "concepts": int(c)}
