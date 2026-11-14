"""The live decision turn (design §6.4): one model call, strict JSON,
validated against the current board, deterministic fallback."""
from __future__ import annotations

import asyncio
import logging
import re
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
from .state import Concept, LessonPlan, Pointer, Step

logger = logging.getLogger(__name__)

ACTIONS = {"advance", "remediate", "answer_doubt", "wait"}
LIVE_OPS = {"highlight", "annotate", "unhighlight", "callout"}
# Actions in which the teacher may leave one note on the board.
NOTE_ACTIONS = {"remediate", "answer_doubt"}
NOTE_MAX_WORDS = 30
TURN_MAX_TOKENS = 700
PREDICT_MAX_TOKENS = 160
# Natural teaching: the warm-up acknowledgement is one small call with a
# hard ceiling — a slow model must not hold the first board back.
WARMUP_MAX_TOKENS = 120
WARMUP_ACK_TIMEOUT_S = 5.0
WARMUP_ACK_MAX_CHARS = 300
# A bridge is spoken only into a step that teaches a new concept.
BRIDGE_NEXT_KINDS = ("teach", "predict", "media_task")
BRIDGE_TARGET_MAX_CHARS = 160
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।])\s+")
_INDIC_DANDA = re.compile(r"[\u0900-\u09FF]")     # Devanagari / Bengali end a sentence with "।"


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
        # Natural teaching only asks for it; kept only on an advance.
        bridge=clean_bridge(data.get("bridge")) if action == "advance" else None,
        board_ops=_sanitize_ops(data.get("board_ops"), board_ops, action=action),
        assessment={"score": score, "misconception": (str(assessment.get("misconception"))[:120] if assessment.get("misconception") else None),
                    "evidence": (str(assessment.get("evidence"))[:300] if assessment.get("evidence") else None)},
        learner_state_delta={"note": (str(delta.get("note"))[:200] if delta.get("note") else None)},
        fallback=False,
    )


# ── natural teaching: the bridge into the next concept ──────────────────────

def clean_bridge(raw: Any) -> Optional[str]:
    """The model's optional bridge sentence, or None when it is missing,
    asks a question or runs past the word limit (never trimmed mid-thought)."""
    if not isinstance(raw, str):
        return None
    b = " ".join(raw.split()).strip().strip("\"'“”‘’").strip()
    if not b or "?" in b or "？" in b or len(b.split()) > prompts.BRIDGE_MAX_WORDS or len(b) > 200:
        return None
    if b[-1] not in ".!।":
        b += "।" if _INDIC_DANDA.search(b) else "."
    return b


def bridge_target(step: Optional[Step], lang: str) -> Optional[str]:
    """What the turn prompt says about the concept an advance leads into:
    its title, plus its opening sentence when it is plainly taught next (a
    predict step gets the title only — its narration is the answer to the
    guess). None when an advance would end the topic."""
    if step is None or step.kind not in BRIDGE_NEXT_KINDS or step.concept is None:
        return None
    title = (step.concept.title or "").strip()
    if not title:
        return None
    if step.kind != "teach":
        return title
    narration = prompts.neutralize_name(prompts.strip_leading_greeting(step.concept.narration(lang) or "", extended=True))
    opening = _SENTENCE_SPLIT.split(narration.strip(), maxsplit=1)[0].strip() if narration.strip() else ""
    if not opening:
        return title
    return f"{title} (it opens with: {opening[:BRIDGE_TARGET_MAX_CHARS]})"


def append_bridge(say: str, bridge: Optional[str], *, action: str, next_kind: Optional[str]) -> str:
    """The spoken verdict plus the bridge — only on an advance into a step that
    teaches a new concept (never into a topic summary or the slide's end)."""
    if not bridge or action != "advance" or next_kind not in BRIDGE_NEXT_KINDS:
        return say
    return f"{(say or '').rstrip()} {bridge}".strip()


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
    next_concept: Optional[str] = None,
) -> Tuple[Decision, Dict[str, int]]:
    """`concept` overrides the pointer's concept (a doubt raised during a
    topic summary or right after a verdict is about the concept just taught;
    a revisit carries the concept with its fresh check). `next_concept`
    (natural teaching, graded answers only) asks for the optional bridge."""
    concept = concept or lesson.concept_at(pointer)
    assert concept is not None
    check = concept.check or {}
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    # Never on doubts or revisits: only a graded answer can advance into a new concept.
    next_concept = next_concept if (kind == "answer" and not revisit) else None
    try:
        user = _turn_user_prompt(lesson=lesson, pointer=pointer, concept=concept, check=check, lang=lang, state=state,
                                 learner_name=learner_name, board_ops=board_ops, transcript=transcript,
                                 learner_message=learner_message, kind=kind, mode=mode, final_attempt=final_attempt,
                                 source_block=source_block, revisit=revisit, next_concept=next_concept)
    except Exception:  # noqa: BLE001
        logger.warning("Tutor turn prompt failed for session %s", tutor_session_id, exc_info=True)
        return fallback_decision(kind=kind, lang=lang, concept=concept, remediation_no=pointer.remediations), usage
    messages = [{"role": "system", "content": prompts.system_prompt(teacher, lang, strictness, getattr(lesson, "style", "lesson"),
                                                                    bridge=bool(next_concept))},
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
                      source_block: Optional[str], revisit: bool, next_concept: Optional[str] = None) -> str:
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
            final_attempt=final_attempt, source_block=source_block, revisit=revisit, next_concept=next_concept,
        )
    return user


async def run_predict(
    *, institute_id: str, user_id: str, model: Optional[str], teacher: str, lang: str, learner_name: Optional[str],
    concept: Concept, answer: str, tutor_session_id: str, vary: bool = False,
) -> Tuple[str, Dict[str, int]]:
    """React to a pre-teaching guess in a sentence or two (never graded).
    Falls back to a canned line when the model is unavailable (`vary`:
    natural teaching's line variety)."""
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
    return prompts.tpl("predict_ack", lang, vary=vary), usage


# ── natural teaching: the warm-up acknowledgement ────────────────────────────

async def _warmup_completion(messages: List[Dict[str, str]], *, institute_id: str, user_id: str,
                             model: Optional[str]) -> Dict[str, Any]:
    with db_session() as db:
        keys = ApiKeyResolver(db).resolve_keys(
            institute_id, user_id, request_model=model, platform_default_key="chatbot.text.model",
        )
    client = ChatLLMClient(_FixedKeys(keys), platform_model_key="chatbot.text.model")
    return await client.chat_completion(messages, temperature=0.6, max_tokens=WARMUP_MAX_TOKENS,
                                        institute_id=institute_id, user_id=user_id, model=model)


def clean_warmup_ack(raw: str) -> Optional[str]:
    """The model's acknowledgement, or None when it is empty, asks a
    question (the learner would think it is still their turn) or is too long
    to be "a sentence or two"."""
    data = extract_json(raw or "")
    say = str((data or {}).get("say") or "").strip() if isinstance(data, dict) else ""
    say = " ".join(say.split())
    if not say or "?" in say or "？" in say:
        return None
    if len(say) > WARMUP_ACK_MAX_CHARS:
        # Keep whole sentences that fit; a cut mid-sentence is worse than the template.
        kept = ""
        for s in _SENTENCE_SPLIT.split(say):
            if len(kept) + len(s) + 1 > WARMUP_ACK_MAX_CHARS:
                break
            kept = f"{kept} {s}".strip()
        say = kept
    return say or None


async def run_warmup_ack(
    *, institute_id: str, user_id: str, model: Optional[str], teacher: str, lang: str, learner_name: Optional[str],
    question: str, answer: str, topic: str, first_concept: Optional[str], tutor_session_id: str,
    timeout: float = WARMUP_ACK_TIMEOUT_S,
) -> Tuple[str, Dict[str, int], bool]:
    """Acknowledge the learner's warm-up answer and lead into the first board
    (never graded, never an attempt). Returns (say, usage, fell_back): any
    error, timeout or unusable reply speaks a canned warmup_ack line."""
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    fallback = prompts.tpl("warmup_ack", lang, vary=True)
    messages = [
        {"role": "system", "content": f"You are {teacher}, a warm one-to-one teacher. JSON only."},
        {"role": "user", "content": prompts.warmup_ack_prompt(learner_name=learner_name, question=question, answer=answer,
                                                              topic=topic, first_concept=first_concept, lang=lang)},
    ]
    try:
        resp = await asyncio.wait_for(
            _warmup_completion(messages, institute_id=institute_id, user_id=user_id, model=model), timeout=timeout)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001  (TimeoutError included)
        logger.warning("Warm-up ack failed or timed out for session %s", tutor_session_id, exc_info=True)
        return fallback, usage, True
    u = (resp or {}).get("usage") or {}
    usage = {"prompt_tokens": int(u.get("prompt_tokens") or 0), "completion_tokens": int(u.get("completion_tokens") or 0)}
    try:
        record_llm_billing(
            request_type=RequestType.CONVERSATION, model=(resp or {}).get("model") or model or "default",
            prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"],
            total_tokens=usage["prompt_tokens"] + usage["completion_tokens"], institute_id=institute_id, user_id=user_id,
            request_id=tutor_session_id, metadata={"surface": "tutor", "kind": "warmup"},
            use_case=UC.TUTOR_CHAT, metering=metering_user(user_id, surface="LEARNER_APP"),
            usage_context={"tutor_session_id": tutor_session_id, "feature": "warmup"},
        )
    except Exception:  # noqa: BLE001
        logger.warning("Warm-up ack billing failed for session %s", tutor_session_id, exc_info=True)
    say = clean_warmup_ack((resp or {}).get("content") or "")
    if say:
        return say, usage, False
    logger.info("Warm-up ack unusable for session %s: %r", tutor_session_id, ((resp or {}).get("content") or "")[:200])
    return fallback, usage, True
