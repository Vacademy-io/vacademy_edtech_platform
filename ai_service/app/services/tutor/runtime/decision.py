"""The live decision turn (design §6.4): one model call, strict JSON,
validated against the current board, deterministic fallback."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from ....db import db_session
from ....models.ai_token_usage import RequestType
from ...ai_billing import UC, metering_user, record_llm_billing
from ...api_key_resolver import ApiKeyResolver
from ...chat_llm_client import ChatLLMClient
from ..compile_prompts import extract_json
from ..plan_compiler import _FixedKeys
from . import prompts
from .state import Concept, LessonPlan, Pointer

logger = logging.getLogger(__name__)

ACTIONS = {"advance", "remediate", "answer_doubt", "wait"}
LIVE_OPS = {"highlight", "annotate", "unhighlight", "callout"}
# Actions in which the teacher may leave one note on the board.
NOTE_ACTIONS = {"remediate", "answer_doubt"}
NOTE_MAX_WORDS = 30
TURN_MAX_TOKENS = 700
PREDICT_MAX_TOKENS = 160


class Decision(Dict[str, Any]):
    """action, say, board_ops, assessment{score,misconception,evidence}, learner_state_delta{note}, fallback"""


def _board_ids(board_ops: List[Dict[str, Any]]) -> set:
    ids = set()
    for op in board_ops:
        if op.get("id"):
            ids.add(op["id"])
        for p in op.get("parts") or []:
            if p.get("id"):
                ids.add(p["id"])
    return ids


def _sanitize_ops(ops: Any, board_ops: List[Dict[str, Any]], *, action: str = "") -> List[Dict[str, Any]]:
    ids = _board_ids(board_ops)
    out: List[Dict[str, Any]] = []
    if not isinstance(ops, list):
        return out
    note_done = False
    for i, op in enumerate(ops[:5]):
        if not isinstance(op, dict) or op.get("op") not in LIVE_OPS:
            continue
        if op["op"] == "callout":
            # One note per turn, only while remediating or answering a doubt.
            words = str(op.get("text") or "").split()
            if note_done or action not in NOTE_ACTIONS or not words:
                continue
            note_done = True
            out.append({"op": "callout", "id": f"live-note-{uuid4().hex[:8]}", "kind": op.get("kind") if op.get("kind") in ("example", "tip", "definition", "warning") else "example",
                        "text": " ".join(words[:NOTE_MAX_WORDS]), "note": True})
            continue
        if op.get("target") not in ids:
            continue
        if op["op"] == "annotate":
            text = str(op.get("text") or "")[:60]
            if not text:
                continue
            out.append({"op": "annotate", "id": f"live-{i}", "target": op["target"], "text": text,
                        "position": op.get("position") if op.get("position") in ("right", "below", "above", "left") else "right"})
        else:
            out.append({"op": op["op"], "target": op["target"], **({"style": op.get("style")} if op.get("style") in ("pulse", "underline", "box") else {})})
    return out


def parse_decision(raw: str, *, board_ops: List[Dict[str, Any]], pass_threshold: float) -> Optional[Decision]:
    data = extract_json(raw)
    if not isinstance(data, dict):
        return None
    action = str(data.get("action") or "").strip().lower()
    say = str(data.get("say") or "").strip()
    if action not in ACTIONS or not say:
        return None
    assessment = data.get("assessment") if isinstance(data.get("assessment"), dict) else {}
    score = assessment.get("score")
    try:
        score = max(0.0, min(1.0, float(score))) if score is not None else None
    except Exception:  # noqa: BLE001
        score = None
    # The model may not advance a failing answer.
    if action == "advance" and score is not None and score < pass_threshold:
        action = "remediate"
    delta = data.get("learner_state_delta") if isinstance(data.get("learner_state_delta"), dict) else {}
    return Decision(
        action=action,
        say=say[:700],
        board_ops=_sanitize_ops(data.get("board_ops"), board_ops, action=action),
        assessment={"score": score, "misconception": (str(assessment.get("misconception"))[:120] if assessment.get("misconception") else None),
                    "evidence": (str(assessment.get("evidence"))[:300] if assessment.get("evidence") else None)},
        learner_state_delta={"note": (str(delta.get("note"))[:200] if delta.get("note") else None)},
        fallback=False,
    )


def fallback_decision(*, kind: str, lang: str, concept: Concept, remediation_no: int) -> Decision:
    """When the model is down or answers garbage: keep the lesson moving."""
    check = concept.check or {}
    if kind == "doubt":
        return Decision(action="answer_doubt", say=prompts.tpl("fallback_move_on", lang, expected=""), board_ops=[],
                        assessment={"score": None, "misconception": None, "evidence": None},
                        learner_state_delta={"note": None}, fallback=True)
    if remediation_no == 0:
        hint = (check.get("misconceptions") or [{}])[0].get("hint") if check.get("misconceptions") else None
        return Decision(action="remediate", say=prompts.tpl("fallback_hint", lang, hint=hint or (check.get("rubric") or "")[:120]),
                        board_ops=[], assessment={"score": 0.4, "misconception": None, "evidence": "fallback"},
                        learner_state_delta={"note": None}, fallback=True)
    return Decision(action="advance", say=prompts.tpl("fallback_move_on", lang, expected=(check.get("expected") or "")[:160]),
                    board_ops=[], assessment={"score": 0.5, "misconception": None, "evidence": "fallback"},
                    learner_state_delta={"note": None}, fallback=True)


async def run_turn(
    *,
    institute_id: str,
    user_id: str,
    model: Optional[str],
    teacher: str,
    lang: str,
    strictness: str,
    learner_name: Optional[str],
    state: Dict[str, Any],
    lesson: LessonPlan,
    pointer: Pointer,
    board_ops: List[Dict[str, Any]],
    transcript: List[Dict[str, str]],
    learner_message: str,
    kind: str,                       # "answer" | "doubt"
    mode: str,                       # "voice" | "text"
    tutor_session_id: str,
    source_block: Optional[str] = None,
    final_attempt: bool = False,
    concept: Optional[Concept] = None,
    revisit: bool = False,
) -> Tuple[Decision, Dict[str, int]]:
    """`concept` overrides the pointer's concept (a doubt raised during a
    topic summary or right after a verdict is about the concept just taught;
    a revisit carries the concept with its fresh check)."""
    concept = concept or lesson.concept_at(pointer)
    assert concept is not None
    check = concept.check or {}
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    try:
        user = _turn_user_prompt(lesson=lesson, pointer=pointer, concept=concept, check=check, lang=lang, state=state,
                                 learner_name=learner_name, board_ops=board_ops, transcript=transcript,
                                 learner_message=learner_message, kind=kind, mode=mode, final_attempt=final_attempt,
                                 source_block=source_block, revisit=revisit)
    except Exception:  # noqa: BLE001
        logger.warning("Tutor turn prompt failed for session %s", tutor_session_id, exc_info=True)
        return fallback_decision(kind=kind, lang=lang, concept=concept, remediation_no=pointer.remediations), usage
    messages = [{"role": "system", "content": prompts.system_prompt(teacher, lang, strictness, getattr(lesson, "style", "lesson"))},
                {"role": "user", "content": user}]
    try:
        with db_session() as db:
            keys = ApiKeyResolver(db).resolve_keys(
                institute_id, user_id, request_model=model,
                # A blank live model inherits the chatbot model setting (then the
                # platform_default use case), not the env default.
                platform_default_key="chatbot.text.model",
            )
        client = ChatLLMClient(_FixedKeys(keys), platform_model_key="chatbot.text.model")
        resp = await client.chat_completion(messages, temperature=0.3, max_tokens=TURN_MAX_TOKENS,
                                            institute_id=institute_id, user_id=user_id, model=model)
        u = resp.get("usage") or {}
        usage = {"prompt_tokens": int(u.get("prompt_tokens") or 0), "completion_tokens": int(u.get("completion_tokens") or 0)}
        record_llm_billing(
            request_type=RequestType.CONVERSATION, model=resp.get("model") or model or "default",
            prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"],
            total_tokens=usage["prompt_tokens"] + usage["completion_tokens"], institute_id=institute_id, user_id=user_id,
            request_id=tutor_session_id, metadata={"surface": "tutor", "kind": kind},
            use_case=UC.TUTOR_CHAT, metering=metering_user(user_id, surface="LEARNER_APP"),
            usage_context={"tutor_session_id": tutor_session_id, "feature": kind},
        )
        decision = parse_decision(resp.get("content") or "", board_ops=board_ops,
                                  pass_threshold=float(check.get("pass_threshold") or 0.7))
        if decision is not None:
            return decision, usage
        logger.warning("Tutor decision unparsable for session %s: %r", tutor_session_id, (resp.get("content") or "")[:200])
    except Exception:  # noqa: BLE001
        logger.warning("Tutor decision turn failed for session %s", tutor_session_id, exc_info=True)
    return fallback_decision(kind=kind, lang=lang, concept=concept, remediation_no=pointer.remediations), usage


def _turn_user_prompt(*, lesson: LessonPlan, pointer: Pointer, concept: Concept, check: Dict[str, Any], lang: str,
                      state: Dict[str, Any], learner_name: Optional[str], board_ops: List[Dict[str, Any]],
                      transcript: List[Dict[str, str]], learner_message: str, kind: str, mode: str, final_attempt: bool,
                      source_block: Optional[str], revisit: bool) -> str:
    lb = prompts.learner_block(state, concept.tags)
    # A revisit at slide end carries a pointer past the last topic.
    topic_title = (lesson.topics[pointer.topic].title if 0 <= pointer.topic < len(lesson.topics)
                   else (lesson.slide_title or (lesson.topics[-1].title if lesson.topics else "")))
    if kind == "doubt":
        user = prompts.doubt_prompt(
            learner_name=learner_name, learner_block=lb, slide_title=topic_title,
            board_ops=board_ops, concept_title=concept.title, concept_say=concept.narration(lang),
            teach_notes=concept.teach_notes, transcript=transcript, question=learner_message, source_block=source_block,
        )
    else:
        user = prompts.turn_prompt(
            learner_name=learner_name, learner_block=lb, slide_title=topic_title,
            objectives=lesson.objectives, board_ops=board_ops, concept_title=concept.title,
            concept_say=concept.narration(lang), teach_notes=concept.teach_notes, check=check,
            transcript=transcript, learner_message=learner_message, remediation_no=pointer.remediations, mode=mode,
            final_attempt=final_attempt, source_block=source_block, revisit=revisit,
        )
    return user


async def run_predict(
    *, institute_id: str, user_id: str, model: Optional[str], teacher: str, lang: str, learner_name: Optional[str],
    concept: Concept, answer: str, tutor_session_id: str,
) -> Tuple[str, Dict[str, int]]:
    """React to a pre-teaching guess in a sentence or two (never graded).
    Falls back to a canned line when the model is unavailable."""
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    messages = [
        {"role": "system", "content": f"You are {teacher}, a warm one-to-one teacher. JSON only."},
        {"role": "user", "content": prompts.predict_prompt(learner_name=learner_name, question=concept.predict or "",
                                                           concept_title=concept.title, concept_say=concept.narration(lang),
                                                           answer=answer, lang=lang)},
    ]
    try:
        with db_session() as db:
            keys = ApiKeyResolver(db).resolve_keys(
                institute_id, user_id, request_model=model,
                # A blank live model inherits the chatbot model setting (then the
                # platform_default use case), not the env default.
                platform_default_key="chatbot.text.model",
            )
        client = ChatLLMClient(_FixedKeys(keys), platform_model_key="chatbot.text.model")
        resp = await client.chat_completion(messages, temperature=0.5, max_tokens=PREDICT_MAX_TOKENS,
                                            institute_id=institute_id, user_id=user_id, model=model)
        u = resp.get("usage") or {}
        usage = {"prompt_tokens": int(u.get("prompt_tokens") or 0), "completion_tokens": int(u.get("completion_tokens") or 0)}
        record_llm_billing(
            request_type=RequestType.CONVERSATION, model=resp.get("model") or model or "default",
            prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"],
            total_tokens=usage["prompt_tokens"] + usage["completion_tokens"], institute_id=institute_id, user_id=user_id,
            request_id=tutor_session_id, metadata={"surface": "tutor", "kind": "predict"},
            use_case=UC.TUTOR_CHAT, metering=metering_user(user_id, surface="LEARNER_APP"),
            usage_context={"tutor_session_id": tutor_session_id, "feature": "predict"},
        )
        data = extract_json(resp.get("content") or "")
        say = str((data or {}).get("say") or "").strip() if isinstance(data, dict) else ""
        if say:
            return say[:400], usage
    except Exception:  # noqa: BLE001
        logger.warning("Predict turn failed for session %s", tutor_session_id, exc_info=True)
    return prompts.tpl("predict_ack", lang), usage
