"""Rules the plan schema cannot express (design §4.3 / §4.6).

TWO TIERS, deliberately:

* `validate_plan` is STRUCTURAL and fatal — malformed ops, duplicate ids,
  a check with no answer, missing media urls, narration in one language only:
  things the runtime cannot serve. The model gets these back and must fix them.

* `board_quality_errors` (fed to the model through `soft_errors`) is PEDAGOGY —
  a board's word budget, one heading per concept, something to look at on every
  board. These are asked for once and then let go: a dense derivation that will
  not fit 60 words is still a teachable board, and a structurally sound plan
  must never be thrown away (leaving the slide unteachable and the compile
  credits spent) over a quality preference. What remains is stored on the plan
  as `quality_notes` and shown to the admin.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

from ...schemas.tutor import TeachingPlanDraft, VISUAL_OPS
from .board_ops import iter_element_ops, op_words, ops_to_dicts, validate_ops
from .svg_check import check_svg_geometry


@dataclass(frozen=True)
class Limits:
    words_per_concept: int = 60
    headings_per_concept: int = 1
    visuals_per_concept: int = 1
    board_words_per_topic: int = 220
    min_say_sentences: int = 1
    max_say_sentences: int = 6
    # Whiteboards teach with pictures: every board must carry at least one
    # svg / image / video (media tasks count). Off for quizzes.
    require_visual_per_topic: bool = True
    # Images are on for this course, so a slide is expected to carry real
    # illustrations, not only shapes. Advice only, like the rest of this block.
    expect_images: bool = False
    # Engagement rules (soft: one repair round, never a failed plan): a recap
    # board + spoken recap per topic, an example per topic, a mix of quick
    # checks, a hint per check, short open questions. Off for quizzes.
    engagement_rules: bool = True


DEFAULT_LIMITS = Limits()
# Quiz boards show the question and its options verbatim; a six-option MCQ is
# not a wall of text, it is the question. One topic per question keeps each
# board to one question anyway.
QUIZ_LIMITS = Limits(words_per_concept=160, board_words_per_topic=400, require_visual_per_topic=False, engagement_rules=False)
MAX_OPEN_QUESTION_WORDS = 30
MAX_PREDICT_WORDS = 25
RECAP_MIN_ITEMS, RECAP_MAX_ITEMS = 3, 5
QUICK_CHECK_TYPES = ("mcq", "numeric")
_DEVANAGARI = re.compile(r"[\u0900-\u097F]")
_LATIN = re.compile(r"[A-Za-z]")
# Hindi narration must actually be Hindi (Hinglish keeps English technical
# terms, so a sentence can be mostly Latin letters): at least this share of
# Devanagari code points among all letters.
MIN_DEVANAGARI_SHARE = 0.15


def is_hinglish(text: str) -> bool:
    dev = len(_DEVANAGARI.findall(text or ""))
    total = dev + len(_LATIN.findall(text or ""))
    return total == 0 or dev / total >= MIN_DEVANAGARI_SHARE

# What counts as "this board has something to look at". A derivation board's
# formula and a comparison table are visual on a whiteboard; demanding an SVG
# on an algebra board only produces decoration.
BOARD_VISUAL_OPS = VISUAL_OPS | {"formula", "table"}
# A concept that labels or points at a diagram drawn earlier on the board is
# extending that visual, not adding prose — it counts as a visual step.
EXTENDS_VISUAL_OPS = {"annotate", "arrow", "highlight"}


def concept_is_visual(ops: List[Dict[str, Any]]) -> bool:
    """Does this concept's reveal give the learner something new to look at?
    Notes (text, bullets, callouts) never do — that is the point of the rule."""
    return any(op.get("op") in BOARD_VISUAL_OPS or op.get("op") in EXTENDS_VISUAL_OPS for op in iter_element_ops(ops))


def image_target(plan: TeachingPlanDraft) -> int:
    """How many real illustrations a slide should carry: about one per two
    boards, and never fewer than one per four concepts — a single five-concept
    board is a five-minute view and one picture does not carry it."""
    topics = len(plan.topics)
    concepts = sum(len(t.concepts) for t in plan.topics)
    by_boards = 1 if topics <= 2 else 2 if topics <= 4 else 3
    return min(4, max(by_boards, -(-concepts // 4)))

MAX_WORDS_PER_CONCEPT = DEFAULT_LIMITS.words_per_concept
MAX_HEADINGS_PER_CONCEPT = DEFAULT_LIMITS.headings_per_concept
MAX_VISUALS_PER_CONCEPT = DEFAULT_LIMITS.visuals_per_concept
MAX_BOARD_WORDS_PER_TOPIC = DEFAULT_LIMITS.board_words_per_topic
MIN_DESCRIPTION_CHARS = 10
SUPPORTED_LANGS = ("en", "hi")

_SENT = re.compile(r"[.!?।](\s|$)")


def sentence_count(text: str) -> int:
    text = (text or "").strip()
    if not text:
        return 0
    return max(1, len(_SENT.findall(text)))


def normalize_plan(plan: TeachingPlanDraft) -> None:
    """Cheap fixes that are not worth a repair round-trip: a check with no
    prompt is no check; stray whitespace in ids; empty say_i18n entries."""
    for topic in plan.topics:
        topic.id = (topic.id or "").strip()
        for concept in topic.concepts:
            concept.id = (concept.id or "").strip()
            if concept.check and concept.check.type != "none" and not (concept.check.prompt or "").strip():
                concept.check.type = "none"
            concept.say_i18n = {k: v for k, v in (concept.say_i18n or {}).items() if (v or "").strip()}


def validate_plan(
    plan: TeachingPlanDraft,
    course_lang: str = "en",
    *,
    limits: Limits = DEFAULT_LIMITS,
    require_media_urls: bool = True,
) -> List[str]:
    normalize_plan(plan)
    errors: List[str] = []
    seen_ids: Set[str] = set()
    other_lang = "hi" if course_lang == "en" else "en"

    if not plan.topics:
        errors.append("plan has no topics")
        return errors

    for ti, topic in enumerate(plan.topics):
        tloc = f"topics[{ti}]('{topic.title[:30]}')"
        if not topic.concepts:
            errors.append(f"{tloc}: topic has no concepts")
            continue
        if topic.id in seen_ids:
            errors.append(f"{tloc}: duplicate id '{topic.id}'")
        seen_ids.add(topic.id)

        board_ids: Set[str] = set()
        for ci, concept in enumerate(topic.concepts):
            cloc = f"{tloc}.concepts[{ci}]('{concept.title[:30]}')"
            if concept.id in seen_ids:
                errors.append(f"{cloc}: duplicate id '{concept.id}'")
            seen_ids.add(concept.id)

            ops = ops_to_dicts(concept.board_ops)
            op_errors, board_ids = validate_ops(ops, board_ids, where=f"{cloc}.board_",
                                                require_media_urls=require_media_urls)
            errors.extend(op_errors)
            # Element ids must be unique across the whole plan too, so a live
            # highlight can never be ambiguous.
            elems = list(iter_element_ops(ops))
            for op in elems:
                oid = op.get("id")
                if oid and oid in seen_ids:
                    errors.append(f"{cloc}: element id '{oid}' reuses an earlier topic/concept/element id")
                elif oid:
                    seen_ids.add(oid)

            if any(op.get("op") == "clear" for op in ops):
                errors.append(f"{cloc}: 'clear' belongs to topic boundaries, not concepts")
            for op in elems:
                if op.get("op") in VISUAL_OPS and len((op.get("description") or "").strip()) < MIN_DESCRIPTION_CHARS:
                    errors.append(f"{cloc}: {op.get('op')} '{op.get('id')}' needs a real description")

            if not (concept.say or "").strip():
                errors.append(f"{cloc}: say is empty — the teacher must have something to say about this board")
            if not (concept.say_i18n or {}).get(other_lang, "").strip():
                errors.append(f"{cloc}: say_i18n['{other_lang}'] is missing (narration must be compiled in both languages)")

            chk = concept.check
            if ci > 0 and chk.type == "none":
                errors.append(f"{cloc}: every concept after the first of a board needs a check with a prompt and an expected answer or rubric")
            if chk.type != "none":
                if not (chk.prompt or "").strip():
                    errors.append(f"{cloc}: check needs a prompt")
                if chk.type == "mcq" and len(chk.options) < 2:
                    errors.append(f"{cloc}: mcq check needs at least two options")
                if not (chk.expected or "").strip() and not (chk.rubric or "").strip():
                    errors.append(f"{cloc}: check needs an expected answer or a rubric")
                if not (0.3 <= chk.pass_threshold <= 1.0):
                    errors.append(f"{cloc}: pass_threshold must be between 0.3 and 1.0")

        s_errors, _ = validate_ops(ops_to_dicts(topic.summary_ops), set(board_ids), where=f"{tloc}.summary_",
                                   require_media_urls=require_media_urls)
        errors.extend(s_errors)

    return errors


# ── soft rules: engagement and diagram quality ──────────────────────────────
# These come back to the model once; a plan that still breaks them is kept
# (with broken diagrams replaced by an auto-layout), so quality asks never
# turn into a failed compile.

_TRAILING_Q = re.compile(r"[?？]\s*[\"'”’)]*\s*$")
_REVEAL_CUES = re.compile(r"\b(before I reveal|try it first|what do you think|can you tell me|tell me)\b", re.IGNORECASE)


def narration_asks(say: str) -> bool:
    """Does the narration end by asking something? (Then the check prompt
    would be a second, different question — the learner hears two.)"""
    t = (say or "").strip()
    if not t:
        return False
    return bool(_TRAILING_Q.search(t)) or bool(_REVEAL_CUES.search(t[-160:]))


def board_quality_errors(plan: TeachingPlanDraft, *, limits: Limits = DEFAULT_LIMITS) -> List[str]:
    """Board hygiene: how much a board may hold and whether it shows anything.
    Never fatal — see the module docstring."""
    errors: List[str] = []
    for ti, topic in enumerate(plan.topics):
        tloc = f"topics[{ti}]('{topic.title[:30]}')"
        topic_words = 0
        for ci, concept in enumerate(topic.concepts):
            cloc = f"{tloc}.concepts[{ci}]('{concept.title[:30]}')"
            ops = ops_to_dicts(concept.board_ops)
            elems = list(iter_element_ops(ops))
            words = sum(op_words(op) for op in ops)
            topic_words += words
            if words > limits.words_per_concept:
                errors.append(f"{cloc}: board adds {words} words of text; keep a concept under {limits.words_per_concept} "
                              f"(formulas and diagrams do not count — move explanation into the narration)")
            headings = sum(1 for op in elems if op.get("op") == "heading")
            if headings > limits.headings_per_concept:
                errors.append(f"{cloc}: {headings} headings; at most {limits.headings_per_concept} per concept")
            visuals = sum(1 for op in elems if op.get("op") in VISUAL_OPS)
            if visuals > limits.visuals_per_concept:
                errors.append(f"{cloc}: {visuals} diagrams/images; at most {limits.visuals_per_concept} per concept")
            n = sentence_count(concept.say)
            if n > limits.max_say_sentences:
                errors.append(f"{cloc}: say has {n} sentences; use {limits.min_say_sentences}-{limits.max_say_sentences}")
        if limits.require_visual_per_topic:
            visual_flags = [concept_is_visual(ops_to_dicts(c.board_ops)) for c in topic.concepts]
            if not any(visual_flags):
                errors.append(f"{tloc}: this board shows nothing to look at — add an svg diagram, an image, a formula or a "
                              f"comparison table to one of its concepts")
            else:
                # The unit a learner looks at is the concept, not the board: the
                # opening reveal must be the visual, and two note-only reveals
                # in a row is a wall of text however many callouts dress it.
                if visual_flags and not visual_flags[0]:
                    c0 = topic.concepts[0]
                    errors.append(f"{tloc}.concepts[0]('{c0.title[:30]}'): the board opens with notes only — the diagram "
                                  f"or picture belongs in the FIRST concept; later concepts extend it with annotate/arrow "
                                  f"or add their own visual")
                for ci in range(1, len(visual_flags)):
                    if not visual_flags[ci] and not visual_flags[ci - 1]:
                        c = topic.concepts[ci]
                        errors.append(f"{tloc}.concepts[{ci}]('{c.title[:30]}'): two text-only concepts in a row — give "
                                      f"this one something to look at (an svg, an image, a table, or annotate a part of "
                                      f"the board's diagram) and move the explanation into the narration")
        if topic_words > limits.board_words_per_topic:
            errors.append(f"{tloc}: the topic's whole board is {topic_words} words; a board should fit one screen "
                          f"(<= {limits.board_words_per_topic})")
    if limits.expect_images:
        images = sum(1 for t in plan.topics for c in t.concepts
                     for op in iter_element_ops(ops_to_dicts(c.board_ops)) if op.get("op") == "image")
        want = image_target(plan)
        if images < want:
            concepts = sum(len(t.concepts) for t in plan.topics)
            errors.append(
                f"plan: only {images} real illustration(s) for {len(plan.topics)} board(s) / {concepts} concepts; "
                f"aim for about {want}. "
                f"Students learn from pictures: add an `image` op where a picture teaches better than shapes "
                f"(a real scene, an object, an organism, an apparatus, a labelled textbook illustration)")
    return errors


# ── question coverage: a problem slide's first board must carry the ask ─────
_OPTION_LINE = re.compile(r"(?m)^\s*\(?([A-Da-d])[).:]\s*(.+?)\s*$")
_ASK_CUE = re.compile(r"\b(find|determine|evaluate|calculate|what is|which of|the value of|equals?)\b", re.IGNORECASE)
_DISPLAY_MATH = re.compile(r"\\\[(.+?)\\\]|\$\$(.+?)\$\$", re.S)


def _norm_math(s: str) -> str:
    return re.sub(r"[\s{}]|\\left|\\right|\\,|\\;|\\!", "", s or "").lower()


def _norm_text(s: str) -> str:
    return re.sub(r"[\s.,:;()\-–—]", "", s or "").lower()


def question_coverage_errors(plan: TeachingPlanDraft, source_text: Optional[str]) -> List[str]:
    """When the source reads like a problem (an ask, maybe options), the first
    topic's boards must show the ask and the options. Advice, not fatal."""
    if not source_text or not plan.topics:
        return []
    text = source_text
    options = [_norm_text(v) for _l, v in _OPTION_LINE.findall(text) if len(v.strip()) <= 60]
    if len(options) < 3:
        options = []
    # The display-math block that follows an ask cue is "what is asked".
    asked: List[str] = []
    for m in _DISPLAY_MATH.finditer(text):
        before = text[max(0, m.start() - 160):m.start()]
        if _ASK_CUE.search(before):
            asked.append(_norm_math(m.group(1) or m.group(2) or ""))
    if not options and not asked:
        return []
    first = plan.topics[0]
    board_text = " ".join(
        str(v) for c in first.concepts for op in iter_element_ops(ops_to_dicts(c.board_ops))
        for v in ([op.get("text")] + list(op.get("items") or []) + [cell for row in (op.get("rows") or []) for cell in row])
        if isinstance(v, str)
    )
    board_latex = " ".join(str(op.get("latex") or "") for c in first.concepts for op in iter_element_ops(ops_to_dicts(c.board_ops))
                           if op.get("op") == "formula")
    errors: List[str] = []
    if asked and not any(a and a[:24] in _norm_math(board_latex) for a in asked):
        errors.append(f"topics[0]('{first.title[:30]}'): the question's ask is missing — the first board must show, as a "
                      f"formula op, exactly what the problem asks for (the source says: \\[ {asked[0][:80]} \\])")
    if options:
        shown = sum(1 for o in options if o and o in _norm_text(board_text))
        if shown < max(2, len(options) - 1):
            errors.append(f"topics[0]('{first.title[:30]}'): the answer options are missing from the first board — "
                          f"list all {len(options)} options (a bullet op) so the learner sees the full question")
    return errors


def soft_errors(plan: TeachingPlanDraft, *, limits: Limits = DEFAULT_LIMITS, source_text: Optional[str] = None) -> List[str]:
    errors: List[str] = board_quality_errors(plan, limits=limits) + question_coverage_errors(plan, source_text)
    if not plan.topics:
        return errors
    total_checks = 0
    quick_checks = 0
    other = "hi" if (plan.language or "en") == "en" else "en"

    def _needs(loc: str, what: str, text: str, i18n: Dict[str, str]) -> None:
        if not (text or "").strip():
            return
        alt = (i18n or {}).get(other, "")
        if not alt.strip():
            errors.append(f"{loc}: {what}_i18n['{other}'] is missing (every spoken line is compiled in both languages)")
        elif other == "hi" and not is_hinglish(alt):
            errors.append(f"{loc}: {what}_i18n['hi'] is not Hindi — write it as Hinglish in Devanagari with English technical terms")

    for ti, topic in enumerate(plan.topics):
        tloc = f"topics[{ti}]('{topic.title[:30]}')"
        _needs(tloc, "summary_say", topic.summary_say or "", topic.summary_say_i18n)
        for ci, concept in enumerate(topic.concepts):
            cloc = f"{tloc}.concepts[{ci}]('{concept.title[:30]}')"
            if other == "hi" and (concept.say_i18n or {}).get("hi") and not is_hinglish(concept.say_i18n["hi"]):
                errors.append(f"{cloc}: say_i18n['hi'] is not Hindi — write it as Hinglish in Devanagari with English technical terms")
            _needs(cloc, "predict", concept.predict or "", concept.predict_i18n)
            if concept.check.type != "none":
                _needs(cloc, "check.prompt", concept.check.prompt or "", concept.check.prompt_i18n)
                _needs(cloc, "check.hint", concept.check.hint or "", concept.check.hint_i18n)
                if narration_asks(concept.say or ""):
                    errors.append(f"{cloc}: `say` must not ask the question — it ends with '?' but the check prompt is the only question, spoken right after; end `say` with a statement")
            ops = ops_to_dicts(concept.board_ops)
            for op in iter_element_ops(ops):
                if op.get("op") == "svg":
                    for e in check_svg_geometry(op.get("svg", ""), op.get("parts") or []):
                        errors.append(f"{cloc}: svg '{op.get('id')}': {e}")
            chk = concept.check
            if chk.type != "none":
                total_checks += 1
                if chk.type in QUICK_CHECK_TYPES:
                    quick_checks += 1
                if chk.type == "mcq" and len(chk.options) < 3:
                    errors.append(f"{cloc}: mcq needs 3 options (one right, two plausible)")
                if not (chk.hint or "").strip() or len((chk.hint or "").split()) < 3:
                    errors.append(f"{cloc}: check needs a `hint` (a nudge toward the answer, not the answer)")
                prompt = chk.prompt or ""
                if chk.type == "open" and (len(prompt.split()) > MAX_OPEN_QUESTION_WORDS or prompt.count("?") > 1):
                    errors.append(f"{cloc}: open question asks more than one thing or is over {MAX_OPEN_QUESTION_WORDS} words; ask ONE thing")
            if concept.predict:
                p = concept.predict.strip()
                if len(p.split()) > MAX_PREDICT_WORDS or not p.endswith("?"):
                    errors.append(f"{cloc}: predict must be one short question (<= {MAX_PREDICT_WORDS} words, ending with ?)")
            elif limits.engagement_rules and ti > 0 and ci == 0:
                errors.append(f"{cloc}: the first concept of every topic after the first needs a `predict` question the learner guesses at before the board appears")
        if not limits.engagement_rules:
            continue
        s_ops = ops_to_dicts(topic.summary_ops)
        recap = [op for op in s_ops if op.get("op") == "bullet" and RECAP_MIN_ITEMS <= len(op.get("items") or []) <= RECAP_MAX_ITEMS]
        if not recap:
            errors.append(f"{tloc}: summary_ops needs a recap bullet op with {RECAP_MIN_ITEMS}-{RECAP_MAX_ITEMS} items (what the topic taught)")
        n = sentence_count(topic.summary_say or "")
        if n < 1 or n > 3:
            errors.append(f"{tloc}: summary_say must be 1-3 spoken sentences recapping the topic")
        if not any(op.get("op") == "callout" and op.get("kind") == "example"
                   for c in topic.concepts for op in iter_element_ops(ops_to_dicts(c.board_ops))):
            errors.append(f"{tloc}: the topic needs one callout of kind 'example' (a worked or real-life example)")
    if limits.engagement_rules and total_checks >= 3 and quick_checks * 3 < total_checks:
        errors.append(f"plan: only {quick_checks} of {total_checks} checks are quick (mcq with 3 options or numeric); make at least a third quick — open questions are for reasoning, not every concept")
    return errors
