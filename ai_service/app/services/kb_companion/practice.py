"""An 8-question practice set for one topic, compiled once and shared.

Answers ship to the learner app with the questions: practice is for learning,
the feedback is instant, and nothing here is an exam. Scores still reach the
server (progress endpoint) and feed mastery.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ..ai_billing import UC, charge_tool, metering_user
from . import llm, model_choice
from .lesson import GROUNDING_RULES, LANG_NAMES, MIN_MATERIAL_CHARS, _POD_LLM_SLOTS, citation_for, gather_material
from .repository import CompanionRepository

logger = logging.getLogger(__name__)

PRACTICE_TOOL = "kb_companion_practice"
QUESTIONS = 8
_BACKGROUND: set = set()


def practice_messages(*, kb_name: str, node_title: str, passages: str, language: str) -> List[Dict[str, str]]:
    lang = LANG_NAMES.get(language, "English")
    system = f"""You write practice questions for a school student who has just learned a topic from their book.

{GROUNDING_RULES}

Write {QUESTIONS} multiple-choice questions in {lang}:
- a mix: about 3 recall, 3 understanding / apply, 2 that make the student think (why / what would happen / which is NOT);
- exactly 4 short options each, one clearly correct, distractors drawn from common misconceptions;
- every answer must be supported by the passages; no trick wording, no "all of the above";
- "explanation": 1-2 sentences saying WHY the answer is right, in simple words;
- "pages": page numbers the answer comes from.

Return ONLY: {{"questions": [{{"question": "...", "options": ["...","...","...","..."], "answer_index": 0, "explanation": "...", "difficulty": "easy|medium|hard", "pages": [12]}}]}}"""
    user = f"BOOK / KNOWLEDGE BASE: {kb_name}\nTOPIC: {node_title}\n\nPASSAGES:\n{passages}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def validate_questions(raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for q in (raw or {}).get("questions") or []:
        if not isinstance(q, dict):
            continue
        text = str(q.get("question") or "").strip()
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        try:
            ans = int(q.get("answer_index"))
        except (TypeError, ValueError):
            continue
        if not text or len(opts) != 4 or not 0 <= ans < 4 or len({o.lower() for o in opts}) != 4:
            continue
        if text.lower() in seen:
            continue
        seen.add(text.lower())
        diff = str(q.get("difficulty") or "medium").lower()
        pages = []
        for p in q.get("pages") or []:
            try:
                pages.append(int(p))
            except (TypeError, ValueError):
                pass
        out.append({
            "id": f"q{len(out) + 1}", "question": text[:600], "options": [o[:240] for o in opts],
            "answer_index": ans, "explanation": str(q.get("explanation") or "").strip()[:600],
            "difficulty": diff if diff in ("easy", "medium", "hard") else "medium", "pages": pages[:6],
        })
        if len(out) >= QUESTIONS:
            break
    return out


@dataclass
class PracticeJob:
    practice_id: str
    institute_id: str
    user_id: Optional[str]
    kb: Dict[str, Any]
    node: Dict[str, Any]
    language: str
    # Usage-event attribution for the charge (never changes it).
    metering: Any = None


def start_practice(job: PracticeJob) -> None:
    task = asyncio.get_running_loop().create_task(_run(job))
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


async def _run(job: PracticeJob) -> None:
    try:
        with db_session() as db:
            material = gather_material(db, job.kb, job.node)
        if material.chars < MIN_MATERIAL_CHARS:
            raise RuntimeError("This topic has too little material to practise from.")
        model_choice.refresh()  # the 'kb_companion' use case (env overrides still win)
        async with _POD_LLM_SLOTS:
            parsed, res = await llm.complete_json(
                practice_messages(kb_name=job.kb.get("name") or "", node_title=job.node.get("title") or "",
                                  passages=material.passages_text(), language=job.language),
                max_tokens=6000, temperature=0.4, label="kbc-practice", language=job.language,
            )
        questions = validate_questions(parsed)
        if len(questions) < 3:
            raise RuntimeError("Too few usable practice questions came back.")
        for q in questions:
            q["citation"] = citation_for({"pages": q["pages"]}, material)
        with db_session() as db:
            repo = CompanionRepository(db)
            repo.write_practice(job.practice_id, questions=questions, status="READY", model=res.model)
            try:
                charged = charge_tool(
                    db, tool_key=PRACTICE_TOOL, tool_params={}, request_type=RequestType.KNOWLEDGE_BASE,
                    model=res.model, prompt_tokens=res.prompt_tokens, completion_tokens=res.completion_tokens,
                    institute_id=job.institute_id, user_id=job.user_id, request_id=job.practice_id,
                    idempotency_key=f"kbc_practice:{job.practice_id}:{material.fingerprint}",
                    use_case=UC.KB_COMPANION,
                    metering=getattr(job, "metering", None) or metering_user(getattr(job, "user_id", None)),
                    usage_context={"kb_id": (job.kb or {}).get("id"), "kb_name": (job.kb or {}).get("name"),
                                   "node_id": (job.node or {}).get("id"), "feature": "kbc_practice"},
                )
                repo.set_credits("practice", job.practice_id, float(charged))
            except Exception as exc:  # noqa: BLE001
                logger.warning("kbc practice billing failed for %s: %s", job.practice_id, exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("kbc practice %s failed", job.practice_id)
        try:
            with db_session() as db:
                CompanionRepository(db).write_practice(job.practice_id, questions=[], status="FAILED",
                                                       error=str(exc)[:500])
        except Exception:  # noqa: BLE001
            logger.exception("could not mark practice %s failed", job.practice_id)
