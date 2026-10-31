"""SQL for knowledge-base companions (tables from admin_core V535).

Raw SQL, like the KB itself. Every read that a learner can trigger is scoped by
institute in the WHERE clause, and learner access to a companion is decided by
ONE query (`learner_companion`) so "it is in my list" and "I may open it" can
never disagree.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

TARGET_TYPES = ("INSTITUTE", "BATCH", "LEARNER")
STATUSES = ("ACTIVE", "PAUSED", "ARCHIVED")
MODES = ("learn", "practice", "ask")

# A compile that has not written for this long is dead (pod restart, deploy)
# and may be taken over by the next request.
STALE_COMPILE_SECONDS = 240
# A FAILED lesson is retried on open, but not more often than this.
FAILED_RETRY_SECONDS = 60

_COMPANION_COLS = """
    c.id, c.institute_id, c.knowledge_base_id, c.name, c.description, c.avatar_emoji,
    c.accent_color, c.persona, c.language, c.modes, c.scope_node_ids, c.voice_enabled,
    c.voice_provider, c.voice_id, c.show_on_dashboard, c.daily_question_cap, c.status,
    c.starts_at, c.ends_at, c.created_by, c.created_at, c.updated_at,
    kb.name AS kb_name, kb.institute_id AS kb_institute_id, kb.embedding_dim, kb.embedding_model
"""

# Learner visibility: ACTIVE, inside the optional window, and assigned to the
# whole institute, to a batch the learner is ACTIVE in, or to the learner.
_LEARNER_VISIBLE = """
    c.institute_id = :institute_id
    AND c.status = 'ACTIVE'
    AND (c.starts_at IS NULL OR c.starts_at <= CURRENT_TIMESTAMP)
    AND (c.ends_at IS NULL OR c.ends_at > CURRENT_TIMESTAMP)
    AND EXISTS (
        SELECT 1 FROM kb_companion_assignment a
         WHERE a.companion_id = c.id
           AND (
                a.target_type = 'INSTITUTE'
             OR (a.target_type = 'LEARNER' AND a.target_id = :user_id)
             OR (a.target_type = 'BATCH' AND a.target_id IN (
                    SELECT m.package_session_id
                      FROM student_session_institute_group_mapping m
                     WHERE m.user_id = :user_id
                       AND m.institute_id = :institute_id
                       AND m.status = 'ACTIVE'))
           )
    )
"""


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


def _companion_row(r) -> Dict[str, Any]:
    return {
        "id": r[0], "institute_id": r[1], "knowledge_base_id": r[2], "name": r[3],
        "description": r[4], "avatar_emoji": r[5], "accent_color": r[6], "persona": r[7],
        "language": r[8], "modes": list(r[9] or []), "scope_node_ids": list(r[10] or []),
        "voice_enabled": bool(r[11]), "voice_provider": r[12], "voice_id": r[13],
        "show_on_dashboard": bool(r[14]), "daily_question_cap": int(r[15] or 0), "status": r[16],
        "starts_at": _iso(r[17]), "ends_at": _iso(r[18]), "created_by": r[19],
        "created_at": _iso(r[20]), "updated_at": _iso(r[21]),
        "kb_name": r[22], "kb_institute_id": r[23], "kb_embedding_dim": r[24], "kb_embedding_model": r[25],
    }


class CompanionRepository:
    def __init__(self, db: Session):
        self.db = db

    # ── companions ───────────────────────────────────────────────────────────
    def list_companions(self, institute_id: str, kb_id: Optional[str] = None) -> List[Dict[str, Any]]:
        where = "c.institute_id = :i AND c.status <> 'ARCHIVED'"
        params: Dict[str, Any] = {"i": institute_id}
        if kb_id:
            where += " AND c.knowledge_base_id = :kb"
            params["kb"] = kb_id
        rows = self.db.execute(text(f"""
            SELECT {_COMPANION_COLS}
              FROM kb_companion c JOIN knowledge_base kb ON kb.id = c.knowledge_base_id
             WHERE {where}
             ORDER BY c.created_at DESC
        """), params).fetchall()
        return [_companion_row(r) for r in rows]

    def get_companion(self, companion_id: str, institute_id: str) -> Optional[Dict[str, Any]]:
        r = self.db.execute(text(f"""
            SELECT {_COMPANION_COLS}
              FROM kb_companion c JOIN knowledge_base kb ON kb.id = c.knowledge_base_id
             WHERE c.id = :id AND c.institute_id = :i
        """), {"id": companion_id, "i": institute_id}).fetchone()
        return _companion_row(r) if r else None

    def create_companion(self, institute_id: str, created_by: Optional[str], data: Dict[str, Any]) -> str:
        row = self.db.execute(text("""
            INSERT INTO kb_companion (institute_id, knowledge_base_id, name, description, avatar_emoji,
                accent_color, persona, language, modes, scope_node_ids, voice_enabled, voice_provider,
                voice_id, show_on_dashboard, daily_question_cap, status, starts_at, ends_at, created_by)
            VALUES (:i, :kb, :name, :description, :avatar_emoji, :accent_color, :persona, :language,
                CAST(:modes AS TEXT[]), CAST(:scope AS TEXT[]), :voice_enabled, :voice_provider, :voice_id,
                :show_on_dashboard, :cap, :status, :starts_at, :ends_at, :by)
            RETURNING id
        """), {
            "i": institute_id, "kb": data["knowledge_base_id"], "name": data["name"],
            "description": data.get("description"), "avatar_emoji": data.get("avatar_emoji"),
            "accent_color": data.get("accent_color"), "persona": data.get("persona"),
            "language": data.get("language") or "en", "modes": list(data.get("modes") or MODES),
            "scope": list(data.get("scope_node_ids") or []),
            "voice_enabled": bool(data.get("voice_enabled", True)), "voice_provider": data.get("voice_provider"),
            "voice_id": data.get("voice_id"), "show_on_dashboard": bool(data.get("show_on_dashboard", True)),
            "cap": int(data.get("daily_question_cap") or 30), "status": data.get("status") or "ACTIVE",
            "starts_at": data.get("starts_at"), "ends_at": data.get("ends_at"), "by": created_by,
        }).fetchone()
        return str(row[0])

    _UPDATABLE = {
        "name": "name", "description": "description", "avatar_emoji": "avatar_emoji",
        "accent_color": "accent_color", "persona": "persona", "language": "language",
        "voice_enabled": "voice_enabled", "voice_provider": "voice_provider", "voice_id": "voice_id",
        "show_on_dashboard": "show_on_dashboard", "daily_question_cap": "daily_question_cap",
        "status": "status", "starts_at": "starts_at", "ends_at": "ends_at",
    }

    def update_companion(self, companion_id: str, institute_id: str, changes: Dict[str, Any]) -> None:
        sets: List[str] = []
        params: Dict[str, Any] = {"id": companion_id, "i": institute_id}
        for key, col in self._UPDATABLE.items():
            if key in changes:
                sets.append(f"{col} = :{key}")
                params[key] = changes[key]
        if "modes" in changes:
            sets.append("modes = CAST(:modes AS TEXT[])")
            params["modes"] = list(changes["modes"] or [])
        if "scope_node_ids" in changes:
            sets.append("scope_node_ids = CAST(:scope AS TEXT[])")
            params["scope"] = list(changes["scope_node_ids"] or [])
        if not sets:
            return
        self.db.execute(text(
            f"UPDATE kb_companion SET {', '.join(sets)}, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = :id AND institute_id = :i"
        ), params)

    # ── assignments ──────────────────────────────────────────────────────────
    def list_assignments(self, companion_id: str, institute_id: str) -> List[Dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT a.target_type, a.target_id,
                   CASE a.target_type
                        WHEN 'LEARNER' THEN (SELECT s.full_name FROM student s WHERE s.user_id = a.target_id LIMIT 1)
                        WHEN 'BATCH' THEN (
                            SELECT CONCAT_WS(' · ', p.package_name, l.level_name, se.session_name)
                              FROM package_session ps
                              JOIN package p ON p.id = ps.package_id
                              LEFT JOIN level l ON l.id = ps.level_id
                              LEFT JOIN session se ON se.id = ps.session_id
                             WHERE ps.id = a.target_id)
                        ELSE NULL END AS label
              FROM kb_companion_assignment a
             WHERE a.companion_id = :c AND a.institute_id = :i
             ORDER BY a.target_type, a.created_at
        """), {"c": companion_id, "i": institute_id}).fetchall()
        return [{"target_type": r[0], "target_id": r[1], "label": r[2]} for r in rows]

    def replace_assignments(self, companion_id: str, institute_id: str, targets: Sequence[Dict[str, str]]) -> None:
        self.db.execute(text(
            "DELETE FROM kb_companion_assignment WHERE companion_id = :c AND institute_id = :i"
        ), {"c": companion_id, "i": institute_id})
        for t in targets:
            self.db.execute(text("""
                INSERT INTO kb_companion_assignment (companion_id, institute_id, target_type, target_id)
                VALUES (:c, :i, :tt, :tid)
                ON CONFLICT (companion_id, target_type, target_id) DO NOTHING
            """), {"c": companion_id, "i": institute_id, "tt": t["target_type"], "tid": t["target_id"]})

    def batches_in_institute(self, institute_id: str, batch_ids: Sequence[str]) -> List[str]:
        """The subset of package_session ids that belong to this institute."""
        if not batch_ids:
            return []
        rows = self.db.execute(text("""
            SELECT DISTINCT ps.id
              FROM package_session ps
              JOIN package_institute pi ON pi.package_id = ps.package_id
             WHERE ps.id = ANY(CAST(:ids AS TEXT[])) AND pi.institute_id = :i
        """), {"ids": list(batch_ids), "i": institute_id}).fetchall()
        return [r[0] for r in rows]

    def learners_in_institute(self, institute_id: str, user_ids: Sequence[str]) -> List[str]:
        if not user_ids:
            return []
        rows = self.db.execute(text("""
            SELECT DISTINCT m.user_id
              FROM student_session_institute_group_mapping m
             WHERE m.user_id = ANY(CAST(:ids AS TEXT[])) AND m.institute_id = :i
        """), {"ids": list(user_ids), "i": institute_id}).fetchall()
        return [r[0] for r in rows]

    # ── learner access ───────────────────────────────────────────────────────
    def learner_companions(self, institute_id: str, user_id: str) -> List[Dict[str, Any]]:
        rows = self.db.execute(text(f"""
            SELECT {_COMPANION_COLS}
              FROM kb_companion c JOIN knowledge_base kb ON kb.id = c.knowledge_base_id
             WHERE {_LEARNER_VISIBLE}
             ORDER BY c.created_at
        """), {"institute_id": institute_id, "user_id": user_id}).fetchall()
        return [_companion_row(r) for r in rows]

    def learner_companion(self, companion_id: str, institute_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        r = self.db.execute(text(f"""
            SELECT {_COMPANION_COLS}
              FROM kb_companion c JOIN knowledge_base kb ON kb.id = c.knowledge_base_id
             WHERE c.id = :cid AND {_LEARNER_VISIBLE}
        """), {"cid": companion_id, "institute_id": institute_id, "user_id": user_id}).fetchone()
        return _companion_row(r) if r else None

    # ── KB reads ─────────────────────────────────────────────────────────────
    def get_node(self, kb_id: str, node_id: str) -> Optional[Dict[str, Any]]:
        r = self.db.execute(text("""
            SELECT id, parent_id, level, title, summary, page_start, page_end, source_id, keywords
              FROM knowledge_base_node
             WHERE id = :n AND knowledge_base_id = :kb AND level IN ('topic', 'subtopic')
        """), {"n": node_id, "kb": kb_id}).fetchone()
        if not r:
            return None
        return {"id": r[0], "parent_id": r[1], "level": r[2], "title": r[3], "summary": r[4],
                "page_start": r[5], "page_end": r[6], "source_id": r[7], "keywords": list(r[8] or [])}

    def chunk_ids_for_nodes(self, kb_id: str, chunk_institute_id: str, node_ids: Sequence[str]) -> List[str]:
        if not node_ids:
            return []
        rows = self.db.execute(text("""
            SELECT c.id FROM kb_chunk c JOIN knowledge_base_source s ON s.id = c.source_id
             WHERE c.knowledge_base_id = :kb AND c.institute_id = :i
               AND c.node_id = ANY(CAST(:n AS TEXT[])) AND s.is_active = TRUE
             ORDER BY c.id
        """), {"kb": kb_id, "i": chunk_institute_id, "n": list(node_ids)}).fetchall()
        return [r[0] for r in rows]

    # ── lessons / practice (shared compiled artifacts) ───────────────────────
    def _artifact_table(self, kind: str) -> str:
        return {"lesson": "kb_companion_lesson", "practice": "kb_companion_practice"}[kind]

    def get_artifact(self, kind: str, institute_id: str, kb_id: str, node_id: str, language: str) -> Optional[Dict[str, Any]]:
        table = self._artifact_table(kind)
        payload_col = "cards_json" if kind == "lesson" else "questions_json"
        extra = ", title, cards_planned, source_fingerprint" if kind == "lesson" else ", NULL, NULL, NULL"
        r = self.db.execute(text(f"""
            SELECT id, status, {payload_col}, model, credits_charged, error_message, created_at, updated_at,
                   EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - updated_at)) AS idle_seconds {extra}
              FROM {table}
             WHERE institute_id = :i AND knowledge_base_id = :kb AND node_id = :n AND language = :l
        """), {"i": institute_id, "kb": kb_id, "n": node_id, "l": language}).fetchone()
        if not r:
            return None
        return {
            "id": r[0], "status": r[1], "payload": r[2] or [], "model": r[3],
            "credits_charged": float(r[4] or 0), "error_message": r[5],
            "created_at": _iso(r[6]), "updated_at": _iso(r[7]), "idle_seconds": float(r[8] or 0),
            "title": r[9], "cards_planned": r[10], "source_fingerprint": r[11],
        }

    def claim_artifact(self, kind: str, institute_id: str, kb_id: str, node_id: str, language: str,
                       *, fingerprint: Optional[str] = None, created_by: Optional[str] = None) -> Optional[str]:
        """Become the ONE compiler of this artifact, across pods.

        Inserts the row, or takes over a dead / failed / outdated one. Returns
        the row id when this caller must compile it, None when someone else is
        compiling it or it is already good."""
        table = self._artifact_table(kind)
        params = {"i": institute_id, "kb": kb_id, "n": node_id, "l": language, "fp": fingerprint,
                  "by": created_by, "stale": STALE_COMPILE_SECONDS, "retry": FAILED_RETRY_SECONDS}
        if kind == "lesson":
            ins = self.db.execute(text("""
                INSERT INTO kb_companion_lesson (institute_id, knowledge_base_id, node_id, language, status,
                                                 source_fingerprint, created_by)
                VALUES (:i, :kb, :n, :l, 'GENERATING', :fp, :by)
                ON CONFLICT (institute_id, knowledge_base_id, node_id, language) DO NOTHING
                RETURNING id
            """), params).fetchone()
        else:
            ins = self.db.execute(text("""
                INSERT INTO kb_companion_practice (institute_id, knowledge_base_id, node_id, language, status)
                VALUES (:i, :kb, :n, :l, 'GENERATING')
                ON CONFLICT (institute_id, knowledge_base_id, node_id, language) DO NOTHING
                RETURNING id
            """), params).fetchone()
        if ins:
            self.db.commit()
            return str(ins[0])
        outdated = "OR (status = 'READY' AND source_fingerprint IS DISTINCT FROM :fp)" if kind == "lesson" and fingerprint else ""
        reset_payload = "cards_json = '[]'::jsonb, cards_planned = 0, source_fingerprint = :fp," if kind == "lesson" else "questions_json = '[]'::jsonb,"
        taken = self.db.execute(text(f"""
            UPDATE {table}
               SET status = 'GENERATING', {reset_payload} error_message = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE institute_id = :i AND knowledge_base_id = :kb AND node_id = :n AND language = :l
               AND (
                    (status = 'GENERATING' AND updated_at < CURRENT_TIMESTAMP - make_interval(secs => :stale))
                 OR (status = 'FAILED' AND updated_at < CURRENT_TIMESTAMP - make_interval(secs => :retry))
                 {outdated}
               )
            RETURNING id
        """), params).fetchone()
        self.db.commit()
        return str(taken[0]) if taken else None

    def write_lesson(self, lesson_id: str, *, cards: List[Dict[str, Any]], status: Optional[str] = None,
                     title: Optional[str] = None, cards_planned: Optional[int] = None, model: Optional[str] = None,
                     error: Optional[str] = None, fingerprint: Optional[str] = None) -> None:
        self.db.execute(text("""
            UPDATE kb_companion_lesson
               SET cards_json = CAST(:cards AS jsonb),
                   status = COALESCE(:status, status),
                   title = COALESCE(:title, title),
                   cards_planned = COALESCE(:planned, cards_planned),
                   model = COALESCE(:model, model),
                   source_fingerprint = COALESCE(:fp, source_fingerprint),
                   error_message = :error,
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = :id
        """), {"id": lesson_id, "cards": json.dumps(cards, ensure_ascii=False), "status": status, "title": title,
               "planned": cards_planned, "model": model, "error": error, "fp": fingerprint})

    def write_practice(self, practice_id: str, *, questions: List[Dict[str, Any]], status: str,
                       model: Optional[str] = None, error: Optional[str] = None) -> None:
        self.db.execute(text("""
            UPDATE kb_companion_practice
               SET questions_json = CAST(:q AS jsonb), status = :status, model = COALESCE(:model, model),
                   error_message = :error, updated_at = CURRENT_TIMESTAMP
             WHERE id = :id
        """), {"id": practice_id, "q": json.dumps(questions, ensure_ascii=False), "status": status,
               "model": model, "error": error})

    def set_credits(self, kind: str, row_id: str, credits: float) -> None:
        self.db.execute(text(
            f"UPDATE {self._artifact_table(kind)} SET credits_charged = :c WHERE id = :id"
        ), {"c": credits, "id": row_id})

    def lesson_statuses(self, institute_id: str, kb_id: str, language: str) -> Dict[str, Dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT node_id, status, cards_planned, jsonb_array_length(cards_json), updated_at
              FROM kb_companion_lesson
             WHERE institute_id = :i AND knowledge_base_id = :kb AND language = :l
        """), {"i": institute_id, "kb": kb_id, "l": language}).fetchall()
        return {r[0]: {"status": r[1], "cards_planned": r[2], "cards": r[3], "updated_at": _iso(r[4])} for r in rows}

    # ── progress ─────────────────────────────────────────────────────────────
    def progress_rows(self, companion_id: str, user_id: str) -> List[Dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT node_id, status, card_index, cards_total, max_card_seen, checks_correct, checks_total,
                   practice_correct, practice_total, mastery, last_activity_at, completed_at, answered_card_ids
              FROM kb_companion_progress
             WHERE companion_id = :c AND user_id = :u
        """), {"c": companion_id, "u": user_id}).fetchall()
        return [{
            "node_id": r[0], "status": r[1], "card_index": r[2], "cards_total": r[3], "max_card_seen": r[4],
            "checks_correct": r[5], "checks_total": r[6], "practice_correct": r[7], "practice_total": r[8],
            "mastery": r[9], "last_activity_at": _iso(r[10]), "completed_at": _iso(r[11]),
            "answered_card_ids": list(r[12] or []),
        } for r in rows]

    def upsert_progress(self, companion_id: str, institute_id: str, user_id: str, node_id: str,
                        values: Dict[str, Any]) -> None:
        self.db.execute(text("""
            INSERT INTO kb_companion_progress (companion_id, institute_id, user_id, node_id, status, card_index,
                cards_total, max_card_seen, checks_correct, checks_total, answered_card_ids, practice_correct,
                practice_total, mastery, completed_at)
            VALUES (:c, :i, :u, :n, :status, :card_index, :cards_total, :max_seen, :cc, :ct,
                CAST(:answered AS TEXT[]), :pc, :pt, :mastery, :completed_at)
            ON CONFLICT (companion_id, user_id, node_id) DO UPDATE SET
                status = EXCLUDED.status, card_index = EXCLUDED.card_index, cards_total = EXCLUDED.cards_total,
                max_card_seen = EXCLUDED.max_card_seen, checks_correct = EXCLUDED.checks_correct,
                checks_total = EXCLUDED.checks_total, answered_card_ids = EXCLUDED.answered_card_ids,
                practice_correct = EXCLUDED.practice_correct, practice_total = EXCLUDED.practice_total,
                mastery = EXCLUDED.mastery, completed_at = EXCLUDED.completed_at,
                last_activity_at = CURRENT_TIMESTAMP
        """), {
            "c": companion_id, "i": institute_id, "u": user_id, "n": node_id, "status": values["status"],
            "card_index": values["card_index"], "cards_total": values["cards_total"],
            "max_seen": values["max_card_seen"], "cc": values["checks_correct"], "ct": values["checks_total"],
            "answered": list(values["answered_card_ids"]), "pc": values["practice_correct"],
            "pt": values["practice_total"], "mastery": values["mastery"], "completed_at": values.get("completed_at"),
        })

    # ── Ask thread ───────────────────────────────────────────────────────────
    def thread(self, companion_id: str, user_id: str, limit: int = 60) -> List[Dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT id, role, content, meta, created_at FROM kb_companion_message
             WHERE companion_id = :c AND user_id = :u
             ORDER BY id DESC LIMIT :lim
        """), {"c": companion_id, "u": user_id, "lim": limit}).fetchall()
        return [{"id": r[0], "role": r[1], "content": r[2], "meta": r[3] or {}, "created_at": _iso(r[4])}
                for r in reversed(rows)]

    def add_message(self, companion_id: str, institute_id: str, user_id: str, role: str, content: str,
                    meta: Optional[Dict[str, Any]] = None) -> int:
        r = self.db.execute(text("""
            INSERT INTO kb_companion_message (companion_id, institute_id, user_id, role, content, meta)
            VALUES (:c, :i, :u, :r, :content, CAST(:meta AS jsonb)) RETURNING id
        """), {"c": companion_id, "i": institute_id, "u": user_id, "r": role, "content": content,
               "meta": json.dumps(meta or {}, ensure_ascii=False)}).fetchone()
        return int(r[0])

    def get_message(self, message_id: int, companion_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        r = self.db.execute(text("""
            SELECT id, role, content, meta FROM kb_companion_message
             WHERE id = :id AND companion_id = :c AND user_id = :u
        """), {"id": message_id, "c": companion_id, "u": user_id}).fetchone()
        return {"id": r[0], "role": r[1], "content": r[2], "meta": r[3] or {}} if r else None

    def question_counts(self, companion_id: str, user_id: str) -> Dict[str, int]:
        r = self.db.execute(text("""
            SELECT COUNT(*) FILTER (WHERE created_at >= date_trunc('day', CURRENT_TIMESTAMP)),
                   COUNT(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '60 seconds')
              FROM kb_companion_message
             WHERE companion_id = :c AND user_id = :u AND role = 'user'
               AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day'
        """), {"c": companion_id, "u": user_id}).fetchone()
        return {"today": int(r[0] or 0), "last_minute": int(r[1] or 0)}

    # ── people ───────────────────────────────────────────────────────────────
    def learner_first_name(self, user_id: str) -> Optional[str]:
        r = self.db.execute(text("SELECT full_name FROM student WHERE user_id = :u LIMIT 1"), {"u": user_id}).fetchone()
        return str(r[0]).split(" ")[0] if r and r[0] else None

    # ── insights ─────────────────────────────────────────────────────────────
    def insights(self, companion_id: str, institute_id: str, limit: int = 200) -> Dict[str, Any]:
        per_node = self.db.execute(text("""
            SELECT node_id, COUNT(*) AS started,
                   COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                   ROUND(AVG(mastery))::int AS avg_mastery
              FROM kb_companion_progress
             WHERE companion_id = :c AND institute_id = :i
             GROUP BY node_id
        """), {"c": companion_id, "i": institute_id}).fetchall()
        learners = self.db.execute(text("""
            SELECT p.user_id,
                   (SELECT s.full_name FROM student s WHERE s.user_id = p.user_id LIMIT 1) AS name,
                   COUNT(*) AS started,
                   COUNT(*) FILTER (WHERE p.status = 'COMPLETED') AS completed,
                   ROUND(AVG(p.mastery))::int AS avg_mastery,
                   MAX(p.last_activity_at) AS last_active
              FROM kb_companion_progress p
             WHERE p.companion_id = :c AND p.institute_id = :i
             GROUP BY p.user_id
             ORDER BY MAX(p.last_activity_at) DESC
             LIMIT :lim
        """), {"c": companion_id, "i": institute_id, "lim": limit}).fetchall()
        questions = self.db.execute(text("""
            SELECT COUNT(*), COUNT(DISTINCT user_id) FROM kb_companion_message
             WHERE companion_id = :c AND institute_id = :i AND role = 'user'
        """), {"c": companion_id, "i": institute_id}).fetchone()
        return {
            "nodes": [{"node_id": r[0], "started": r[1], "completed": r[2], "avg_mastery": r[3]} for r in per_node],
            "learners": [{"user_id": r[0], "name": r[1], "started": r[2], "completed": r[3],
                          "avg_mastery": r[4], "last_active": _iso(r[5])} for r in learners],
            "questions_asked": int(questions[0] or 0), "askers": int(questions[1] or 0),
        }
