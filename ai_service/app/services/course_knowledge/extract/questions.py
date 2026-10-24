"""Question lessons as text: quizzes, single questions, assignments and the
questions inside a video (spec §6.5).

Stems and option texts only. auto_evaluation_json (answer keys) and every
explanation_text_id are NEVER selected: the learner payload carries the
answer keys (SlideRepository.java:1449, 1574, 1742), but the AI must not see
them, so they never reach a chunk.

Each loader runs a fixed number of batched reads in the caller's session (no
network) and returns {source_id: [Segment(anchor question, question_no)]}.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...tutor.slide_source import html_to_text
from .types import Segment

_QUIZ_SQL = text("""
    SELECT q.quiz_slide_id, q.id, q.question_order, rt.content AS stem, prt.content AS passage
      FROM quiz_slide_question q
      LEFT JOIN rich_text_data rt ON rt.id = q.text_id
      LEFT JOIN rich_text_data prt ON prt.id = q.parent_rich_text_id
     WHERE q.quiz_slide_id = ANY(:ids) AND COALESCE(q.status, 'ACTIVE') <> 'DELETED'
     ORDER BY q.quiz_slide_id, q.question_order NULLS LAST, q.created_at, q.id
""")

_QUIZ_OPTIONS_SQL = text("""
    SELECT o.quiz_slide_question_id, rt.content
      FROM quiz_slide_question_options o
      LEFT JOIN rich_text_data rt ON rt.id = o.text_id
     WHERE o.quiz_slide_question_id = ANY(:qids)
     ORDER BY o.quiz_slide_question_id, o.created_on, o.id
""")

_QUESTION_SQL = text("""
    SELECT q.id, q.id, 1, rt.content AS stem, prt.content AS passage
      FROM question_slide q
      LEFT JOIN rich_text_data rt ON rt.id = q.text_id
      LEFT JOIN rich_text_data prt ON prt.id = q.parent_rich_text_id
     WHERE q.id = ANY(:ids)
""")

_QUESTION_OPTIONS_SQL = text("""
    SELECT o.question_id, rt.content
      FROM "option" o
      LEFT JOIN rich_text_data rt ON rt.id = o.text_id
     WHERE o.question_id = ANY(:qids)
     ORDER BY o.question_id, o.created_on, o.id
""")

_ASSIGNMENT_SQL = text("""
    SELECT a.id, rt.content AS task, prt.content AS passage
      FROM assignment_slide a
      LEFT JOIN rich_text_data rt ON rt.id = a.text_id
      LEFT JOIN rich_text_data prt ON prt.id = a.parent_rich_text_id
     WHERE a.id = ANY(:ids)
""")

_ASSIGNMENT_QUESTIONS_SQL = text("""
    SELECT q.assignment_slide_id, q.id, q.question_order, rt.content AS stem, NULL AS passage
      FROM assignment_slide_question q
      LEFT JOIN rich_text_data rt ON rt.id = q.text_id
     WHERE q.assignment_slide_id = ANY(:ids) AND COALESCE(q.status, 'ACTIVE') <> 'DELETED'
     ORDER BY q.assignment_slide_id, q.question_order NULLS LAST, q.created_at, q.id
""")

_VIDEO_QUESTIONS_SQL = text("""
    SELECT q.video_slide_id, q.id, q.question_order, rt.content AS stem, prt.content AS passage,
           q.question_time_in_millis
      FROM video_slide_question q
      LEFT JOIN rich_text_data rt ON rt.id = q.text_id
      LEFT JOIN rich_text_data prt ON prt.id = q.parent_rich_text_id
     WHERE q.video_slide_id = ANY(:ids) AND COALESCE(q.status, 'ACTIVE') <> 'DELETED'
     ORDER BY q.video_slide_id, q.question_order NULLS LAST, q.question_time_in_millis NULLS LAST, q.created_at, q.id
""")

_VIDEO_OPTIONS_SQL = text("""
    SELECT o.video_slide_question_id, rt.content
      FROM video_slide_question_options o
      LEFT JOIN rich_text_data rt ON rt.id = o.text_id
     WHERE o.video_slide_question_id = ANY(:qids)
     ORDER BY o.video_slide_question_id, o.created_on, o.id
""")

_LETTERS = "abcdefghijklmnopqrstuvwxyz"


def question_text(n: int, stem_html: Optional[str], options: Sequence[str], passage_html: Optional[str] = None) -> str:
    parts: List[str] = []
    passage = html_to_text(passage_html or "")
    if passage:
        parts.append(passage)
    stem = html_to_text(stem_html or "")
    parts.append(f"Question {n}. {stem}".rstrip())
    opts = [o for o in options if o]
    if opts:
        parts.append("Options: " + "; ".join(f"({_LETTERS[i % 26]}) {o}" for i, o in enumerate(opts)))
    return "\n".join(parts).strip()


def _options(db: Session, sql, qids: List[str]) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    if not qids:
        return out
    for qid, content in db.execute(sql, {"qids": qids}).fetchall():
        body = html_to_text(content or "")
        if body:
            out.setdefault(qid, []).append(body)
    return out


def _build(rows: Sequence[Tuple], opts: Dict[str, List[str]], *, with_time: bool = False) -> Dict[str, List[Segment]]:
    out: Dict[str, List[Segment]] = {}
    for row in rows:
        owner, qid, stem, passage = row[0], row[1], row[3], row[4]
        segs = out.setdefault(owner, [])
        n = len(segs) + 1
        body = question_text(n, stem, opts.get(qid, []), passage)
        if not body:
            continue
        seg = Segment(text=body, anchor="question", question_no=n, label=f"Question {n}")
        if with_time and row[5] is not None:
            try:
                seg.t_start_ms = int(row[5])
            except (TypeError, ValueError):
                pass
        segs.append(seg)
    return out


def quiz_segments(db: Session, quiz_ids: List[str]) -> Dict[str, List[Segment]]:
    if not quiz_ids:
        return {}
    rows = db.execute(_QUIZ_SQL, {"ids": quiz_ids}).fetchall()
    return _build(rows, _options(db, _QUIZ_OPTIONS_SQL, [r[1] for r in rows]))


def question_segments(db: Session, question_ids: List[str]) -> Dict[str, List[Segment]]:
    if not question_ids:
        return {}
    rows = db.execute(_QUESTION_SQL, {"ids": question_ids}).fetchall()
    return _build(rows, _options(db, _QUESTION_OPTIONS_SQL, [r[1] for r in rows]))


def assignment_segments(db: Session, assignment_ids: List[str]) -> Dict[str, List[Segment]]:
    """The assignment's task text, then its questions (stems only)."""
    if not assignment_ids:
        return {}
    out: Dict[str, List[Segment]] = {}
    for aid, task_html, passage_html in db.execute(_ASSIGNMENT_SQL, {"ids": assignment_ids}).fetchall():
        task = "\n".join(t for t in (html_to_text(passage_html or ""), html_to_text(task_html or "")) if t)
        if task:
            out.setdefault(aid, []).append(Segment(text=task, anchor="none", label="Assignment"))
    rows = db.execute(_ASSIGNMENT_QUESTIONS_SQL, {"ids": assignment_ids}).fetchall()
    for aid, segs in _build(rows, {}).items():
        out.setdefault(aid, []).extend(segs)
    return out


def video_question_segments(db: Session, video_ids: List[str]) -> Dict[str, List[Segment]]:
    """Questions shown inside a video, numbered in play order (t_start_ms = when it pops up)."""
    if not video_ids:
        return {}
    rows = db.execute(_VIDEO_QUESTIONS_SQL, {"ids": video_ids}).fetchall()
    return _build(rows, _options(db, _VIDEO_OPTIONS_SQL, [r[1] for r in rows]), with_time=True)


__all__ = ["quiz_segments", "question_segments", "assignment_segments", "video_question_segments", "question_text"]
