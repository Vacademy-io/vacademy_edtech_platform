"""Deterministic plan for a QUIZ slide: no model call.

An opening topic, then ONE TOPIC PER QUESTION — a question is its own board,
cleared before the next — whose single concept's check IS the question. The
board shows the stem (and the options for MCQ) so the learner sees what they
are answering; the say text reads it aloud. Validated with QUIZ_LIMITS, since
a six-option question is the question, not a wall of text.
"""
from __future__ import annotations

from typing import Dict, List

from ...schemas.tutor import (
    BulletOp, Check, ConceptDraft, HeadingOp, KeyTerm, TeachingPlanDraft, TextOp, TopicDraft,
)
from .slide_source import SlideSource

_INTRO = {
    "en": "Let's check what you remember from this chapter, {student_name}. I will ask a few quick questions; answer in your own words and we'll see how it goes.",
    "hi": "चलो देखते हैं {student_name}, इस अध्याय से आपको क्या याद है। मैं कुछ छोटे सवाल पूछूँगी; अपने शब्दों में जवाब दीजिए।",
}
_ASK = {"en": "Question {n}: {stem}", "hi": "सवाल {n}: {stem}"}
_ASK_OPTIONS = {"en": " The options are: {opts}.", "hi": " विकल्प हैं: {opts}।"}
_RUBRIC_MCQ = {"en": "Full credit for choosing: {answer}. No partial credit.", "hi": "सही विकल्प: {answer}। आंशिक अंक नहीं।"}
_RUBRIC_OPEN = {"en": "Full credit when the answer matches: {answer}. Half credit for the right idea in the wrong words.", "hi": "पूरा अंक जब उत्तर मेल खाए: {answer}। सही विचार पर आधा अंक।"}


def _t(table: Dict[str, str], lang: str, **kw: str) -> str:
    return table.get(lang, table["en"]).format(**kw)


def _shorten(text: str, n: int = 140) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def compile_quiz(source: SlideSource, lang: str = "en") -> TeachingPlanDraft:
    other = "hi" if lang == "en" else "en"
    topics: List[TopicDraft] = [TopicDraft(
        id="t1",
        title=f"Quick check: {source.title or 'this chapter'}",
        estimated_seconds=20,
        concepts=[ConceptDraft(
            id="t1c1",
            title="Quick check",
            concept_tags=["quiz.intro"],
            board_ops=[
                HeadingOp(op="heading", id="t1-h", text=_shorten(source.title or "Quick check", 60)),
                TextOp(op="text", id="t1c1-t", text=f"{len(source.questions)} question(s)"),
            ],
            say=_t(_INTRO, lang, student_name="{student_name}"),
            say_i18n={other: _t(_INTRO, other, student_name="{student_name}")},
            teach_notes="Warm-up. Do not teach here; the questions are the lesson.",
            check=Check(type="none"),
        )],
        summary_ops=[],
    )]
    for i, q in enumerate(source.questions, start=1):
        t = f"t{i + 1}"
        is_mcq = q.question_type in ("MCQS", "MCQM", "MCQ", "TRUE_FALSE") and bool(q.options)
        opts = [o["text"] for o in q.options if o["text"]]
        answer = "; ".join(q.correct_texts) if q.correct_texts else (q.explanation or "")
        say = _t(_ASK, lang, n=str(i), stem=_shorten(q.stem, 220))
        say_o = _t(_ASK, other, n=str(i), stem=_shorten(q.stem, 220))
        if is_mcq and opts:
            say += _t(_ASK_OPTIONS, lang, opts="; ".join(_shorten(o, 60) for o in opts[:6]))
            say_o += _t(_ASK_OPTIONS, other, opts="; ".join(_shorten(o, 60) for o in opts[:6]))
        board = [TextOp(op="text", id=f"{t}c1-q", text=_shorten(f"Q{i}. {q.stem}", 220))]
        if is_mcq and opts:
            board.append(BulletOp(op="bullet", id=f"{t}c1-o", items=[_shorten(o, 80) for o in opts[:6]]))
        rubric = _t(_RUBRIC_MCQ if is_mcq else _RUBRIC_OPEN, lang, answer=_shorten(answer, 200) or "(see explanation)")
        topics.append(TopicDraft(
            id=t,
            title=_shorten(f"Question {i}", 40),
            estimated_seconds=45,
            concepts=[ConceptDraft(
                id=f"{t}c1",
                title=_shorten(f"Question {i}", 40),
                concept_tags=[f"quiz.q{i}"],
                board_ops=board,
                say=say,
                say_i18n={other: say_o},
                teach_notes=(q.explanation or "Ask, wait, then confirm the correct answer briefly.")[:600],
                check=Check(
                    type="mcq" if is_mcq else "open",
                    prompt=_shorten(q.stem, 400),
                    options=opts[:6] if is_mcq else [],
                    expected=_shorten(answer, 400) or None,
                    rubric=rubric,
                    misconceptions=[],
                    question_id=q.id,
                    option_ids=[o["id"] for o in q.options if o["text"]][:6] if is_mcq else [],
                    pass_threshold=1.0 if is_mcq else 0.7,
                ),
            )],
            summary_ops=[],
        ))
    return TeachingPlanDraft(
        language=lang,
        objectives=[f"Recall the key points checked by {len(source.questions)} question(s)"],
        key_terms=[KeyTerm(term="quiz", meaning="a quick check of understanding")],
        topics=topics,
    )
