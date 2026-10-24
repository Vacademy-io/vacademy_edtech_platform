"""Live-turn prompts and deterministic templates (design §6.4–§6.6)."""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

LANG_NAMES = {"en": "English", "hi": "Hindi (Devanagari; keep technical terms in English letters)"}

# ── deterministic lines (no model call) ──────────────────────────────────────

T = {
    "greet": {
        "en": "Hi {name}! I'm {teacher}, and I'll be teaching you today. We're starting with {slide}. Let's begin.",
        "hi": "नमस्ते {name}! मैं {teacher} हूँ और आज मैं आपको पढ़ाऊँगी। हम {slide} से शुरू कर रहे हैं। चलिए शुरू करते हैं।",
    },
    "greet_interview": {
        "en": "Hi {name}, I'm {teacher}, and I'll be your interviewer today. Think aloud, take your time, and I'll give you feedback after each answer. Ready?",
        "hi": "नमस्ते {name}, मैं {teacher} हूँ, और आज मैं आपका interviewer हूँ। सोचते हुए बोलिए, समय लीजिए, और हर जवाब के बाद मैं feedback दूँगी। तैयार?",
    },
    "greet_practice": {
        "en": "Hi {name}, I'm {teacher}. This is a practice session: I'll set up a situation, you try it, and we improve it together. Let's start.",
        "hi": "नमस्ते {name}, मैं {teacher} हूँ। यह एक practice session है: मैं situation दूँगी, आप try करेंगे, और हम साथ में बेहतर करेंगे। शुरू करते हैं।",
    },
    "resume": {
        "en": "Welcome back, {name}! Last time we were in {slide}. {summary} Let's pick up from where we left off.",
        "hi": "वापस स्वागत है, {name}! पिछली बार हम {slide} पर थे। {summary} चलिए वहीं से आगे बढ़ते हैं।",
    },
    "resume_summary": {
        "en": "Welcome back, {name}! We had just finished {topic} in {slide}. {summary} Let's carry on from there.",
        "hi": "वापस स्वागत है, {name}! हमने {slide} में {topic} अभी पूरा किया था। {summary} चलिए वहीं से आगे बढ़ते हैं।",
    },
    "resume_done": {
        "en": "Welcome back, {name}! You already completed {slide}. {summary} Let's see what's next.",
        "hi": "वापस स्वागत है, {name}! आप {slide} पहले ही पूरा कर चुके हैं। {summary} चलिए देखते हैं आगे क्या है।",
    },
    "greet_returning": {
        "en": "Welcome back, {name}! Last time we worked on {previous}. {summary} Today we're starting {slide}. Let's begin.",
        "hi": "वापस स्वागत है, {name}! पिछली बार हमने {previous} पर काम किया था। {summary} आज हम {slide} शुरू कर रहे हैं। चलिए शुरू करते हैं।",
    },
    "topic_summary": {
        "en": "Good. That wraps up {topic}. Take a look at the board once more, then we'll move to the next part.",
        "hi": "बहुत अच्छे। {topic} यहीं पूरा होता है। बोर्ड को एक बार फिर देख लीजिए, फिर हम अगले हिस्से पर चलेंगे।",
    },
    "slide_done": {
        "en": "That completes {slide}. Well done, {name}. {weak}",
        "hi": "{slide} पूरा हुआ। शाबाश, {name}। {weak}",
    },
    "weak_note": {
        "en": "We'll come back to {n} point(s) that need a little more practice.",
        "hi": "हम {n} बिंदु(ओं) पर फिर से लौटेंगे जिन पर थोड़ा और अभ्यास चाहिए।",
    },
    "ask": {"en": "{prompt}", "hi": "{prompt}"},
    "media_task_video": {
        "en": "Please watch this video now. Take your time, and tell me when you're done.",
        "hi": "कृपया अभी यह वीडियो देखिए। आराम से देखिए, और जब हो जाए तो मुझे बताइए।",
    },
    "media_task_pdf": {
        "en": "Please read this document now. Take your time, and tell me when you're done.",
        "hi": "कृपया अभी यह दस्तावेज़ पढ़िए। आराम से पढ़िए, और जब हो जाए तो मुझे बताइए।",
    },
    "skipped": {"en": "Okay, let's move on.", "hi": "ठीक है, आगे बढ़ते हैं।"},
    "next_slide": {"en": "Now let's move on to {slide}.", "hi": "अब चलिए {slide} पर चलते हैं।"},
    "pause": {"en": "Okay, I'll wait. Say continue when you're ready.", "hi": "ठीक है, मैं रुकती हूँ। जब तैयार हों तो 'continue' कहिए।"},
    "credits_end": {"en": "Your institute's lesson credits have run out for now, so I'll stop here. Your place is saved; ask them to top up and we'll continue.",
                    "hi": "आपके संस्थान के पाठ क्रेडिट अभी समाप्त हो गए हैं, इसलिए मैं यहीं रुकती हूँ। आपकी जगह सुरक्षित है; टॉप-अप के बाद हम आगे बढ़ेंगे।"},
    "idle_end": {"en": "We've been quiet for a while, so I'll stop here. Come back any time and we'll pick up where we left off.",
                 "hi": "काफ़ी देर से कोई बात नहीं हुई, इसलिए मैं यहीं रुकती हूँ। जब चाहें वापस आइए, हम वहीं से आगे बढ़ेंगे।"},
    "away": {"en": "Looks like you stepped away. I'll wait right here.", "hi": "लगता है आप थोड़ी देर के लिए चले गए। मैं यहीं इंतज़ार कर रही हूँ।"},
    "welcome_back": {"en": "Welcome back! Let's pick up where we left off.", "hi": "वापसी पर स्वागत है! चलिए वहीं से आगे बढ़ते हैं।"},
    "slower": {"en": "Sure, I'll go slower.", "hi": "ज़रूर, मैं धीरे बोलूँगी।"},
    "faster": {"en": "Sure, I'll speed up a little.", "hi": "ज़रूर, थोड़ा तेज़ चलते हैं।"},
    "fallback_correct": {"en": "That's right. Let's continue.", "hi": "बिल्कुल सही। चलिए आगे बढ़ते हैं।"},
    "fallback_hint": {"en": "Not quite. Look at the board again: {hint}. Try once more.", "hi": "पूरी तरह नहीं। बोर्ड को फिर देखिए: {hint}। एक बार फिर कोशिश कीजिए।"},
    "fallback_move_on": {"en": "Let's note that for later and keep going. {expected}", "hi": "इसे बाद के लिए नोट कर लेते हैं और आगे बढ़ते हैं। {expected}"},
    # Weak-concept revisits (design §6.6)
    "revisit_intro_topic": {
        "en": "Before we move on, let's quickly go back to {n} point(s) that gave you trouble.",
        "hi": "आगे बढ़ने से पहले, चलिए जल्दी से {n} बिंदु(ओं) पर लौटते हैं जिनमें दिक्कत हुई थी।",
    },
    "revisit_intro_slide": {
        "en": "Before we finish, let's revisit {n} point(s) that need a little more practice.",
        "hi": "समाप्त करने से पहले, चलिए {n} बिंदु(ओं) को फिर से देखते हैं जिन पर थोड़ा और अभ्यास चाहिए।",
    },
    "revisit_ask": {"en": "About {concept}. {prompt}", "hi": "{concept} के बारे में। {prompt}"},
    "revisit_done_topic": {"en": "Good, that's the revisit done. Let's move to the next part.",
                           "hi": "बहुत अच्छे, दोहराव पूरा हुआ। चलिए अगले हिस्से पर चलते हैं।"},
    "revisit_done_slide": {"en": "That's the revisit done. Well done for sticking with it.",
                           "hi": "दोहराव पूरा हुआ। लगे रहने के लिए शाबाश।"},
    "revisit_skipped": {"en": "Okay, we'll leave that one for another day.", "hi": "ठीक है, इसे किसी और दिन के लिए छोड़ते हैं।"},
    # Silence recovery (a minute on an open question)
    "nudge_hint": {"en": "Take your time. Here's a hint: {hint}", "hi": "आराम से सोचिए। एक संकेत: {hint}"},
    # Voice lesson, no microphone audio since the question: explain how to answer first.
    "nudge_voice_hint": {"en": "To answer out loud, tap the Answer button and then speak — or type it below. Here's a hint: {hint}",
                         "hi": "बोलकर जवाब देने के लिए Answer button दबाइए और फिर बोलिए — या नीचे type कीजिए। एक संकेत: {hint}"},
    "nudge_voice_open": {"en": "To answer out loud, tap the Answer button and then speak — or type it below. You can also say 'skip'.",
                         "hi": "बोलकर जवाब देने के लिए Answer button दबाइए और फिर बोलिए — या नीचे type कीजिए। चाहें तो 'skip' भी कह सकते हैं।"},
    "nudge_open": {"en": "Take your time. If you'd like, say 'skip' and we'll come back to this later.",
                   "hi": "आराम से सोचिए। चाहें तो 'skip' कहिए, हम इस पर बाद में लौटेंगे।"},
    # Predict-then-reveal
    "predict_intro": {"en": "Before I show you, a quick guess: {question}", "hi": "दिखाने से पहले, एक अंदाज़ा लगाइए: {question}"},
    "predict_ack": {"en": "Good guess. Let's see.", "hi": "अच्छा अंदाज़ा। चलिए देखते हैं।"},
    # The right answer stays on the board when the teacher moves on.
    "answer_note": {"en": "Answer: {expected}", "hi": "उत्तर: {expected}"},
}


# ── rolling summary shape ────────────────────────────────────────────────────
# A model-written summary is two paragraphs: what the teacher says to the
# learner on return, then her private notes. The deterministic fallback
# written at session end starts with "Session on" and is never spoken.

LEGACY_SUMMARY_PREFIX = "Session on "


def resume_line(summary: Optional[str]) -> Optional[str]:
    """The sentence(s) to say to a returning learner, or None for a legacy
    (deterministic) summary."""
    s = (summary or "").strip()
    if not s or s.startswith(LEGACY_SUMMARY_PREFIX) or "\n\n" not in s:
        return None
    first = s.split("\n\n", 1)[0].strip()
    return first[:400] or None


def summary_notes(summary: Optional[str]) -> str:
    """The teacher's notes part (everything but the spoken line)."""
    s = (summary or "").strip()
    if "\n\n" in s and not s.startswith(LEGACY_SUMMARY_PREFIX):
        return s.split("\n\n", 1)[1].strip()
    return s


_LEADING_GREETING = re.compile(
    r"^\s*(?:hi|hello|hey|namaste|नमस्ते|welcome(?: back)?)[^.!?।]*[.!?।]\s*", re.IGNORECASE)


_NAME_GREETING = re.compile(r"^\s*(?:hi|hello|hey|namaste|नमस्ते|welcome(?: back)?)[,!]?\s*\{student_name\}[,!]?\s*", re.IGNORECASE)
_NAME_INLINE = re.compile(r"\s*,?\s*\{student_name\}\s*,?\s*")


def neutralize_name(text_: str) -> str:
    """The same line without the learner's name (for prepared audio and
    learners whose name is unknown): "Hi {student_name}, a force is a push."
    → "A force is a push."; "Look, {student_name}, at the arrow" → "Look at the arrow"."""
    t = _NAME_GREETING.sub("", text_ or "", count=1)
    t = _NAME_INLINE.sub(" ", t)
    t = " ".join(t.split()).strip()
    return (t[0].upper() + t[1:]) if t else t


def strip_leading_greeting(narration: str) -> str:
    """Drop a compiled narration's own opening "Hi {name}, …" sentence when
    the teacher already greeted (welcome back / next slide)."""
    out = _LEADING_GREETING.sub("", narration or "", count=1)
    return out if out.strip() else narration


def tpl(key: str, lang: str, **kw: Any) -> str:
    table = T[key]
    text = table.get(lang if lang in table else "en") or table["en"]
    try:
        return text.format(**{k: (v if v is not None else "") for k, v in kw.items()})
    except Exception:  # noqa: BLE001
        return text


# ── decision turn ────────────────────────────────────────────────────────────

DECISION_SCHEMA = """Return ONE JSON object and nothing else:
{
  "action": "advance" | "remediate" | "answer_doubt" | "wait",
  "say": "what you say next, 1-4 spoken sentences, in the session language, addressing the learner directly",
  "board_ops": [ {"op":"highlight","target":"<element id on the board>","style":"pulse"} | {"op":"annotate","id":"s-1","target":"<element id>","text":"<=8 words","position":"right"} | {"op":"callout","id":"note-1","kind":"example","text":"<=30 words: a worked example or the key line, ONLY with action remediate or answer_doubt"} ],
  "assessment": {"score": 0.0-1.0, "misconception": "<short label or null>", "evidence": "<what in the answer shows it>"},
  "learner_state_delta": {"note": "<one line about this learner, or null>"}
}
Rules: "advance" only when score >= the pass threshold. "remediate" = the answer misses the point: `say` gives ONE
concrete hint anchored on the board and re-asks in fewer words (never reveal the full answer on the first remediation).
"answer_doubt" = the learner asked something instead of answering: answer briefly from the concept material, then
invite them to answer the check. "wait" = the learner said something that is neither (small talk): respond in one
sentence and re-ask. Ops: highlight/annotate on targets that exist on the board, plus at most ONE callout note when you
remediate or answer a doubt (a worked example or the one line to remember — it stays on the board). ECHOES: an answer
that repeats the teacher's own hint or words nearly verbatim is NOT understanding: score it at most 0.6 and, the first
time, use action "wait" to ask for it in their own words or for the reason why. SPOKEN ANSWERS: a voice answer
is a speech-to-text transcript — ignore fillers ("um", "like", "you know", "ma'am"), false starts, repetition, loose
grammar and misheard words, and grade the idea the learner expressed. An answer that states the key idea in its own
informal words is correct: give it full credit even if it is phrased nothing like the expected answer. When it is
partly right, credit what is right and name the one missing piece. (The exception is a check whose rubric grades
the wording itself — e.g. removing hedge or filler words — there the words are the answer.) No markdown."""


LIVE_PERSONA = {
    "lesson": "You are {teacher}, a one-to-one teacher speaking to a learner over a shared whiteboard.",
    "interview": ("You are {teacher}, a professional interviewer running a mock interview over a shared whiteboard. "
                  "You are evaluating a CANDIDATE, not teaching a student: react like an interviewer (brief, fair, "
                  "specific), give the model answer and the method only after their attempt, never say 'let's learn' "
                  "or 'look at the board again' as a lesson would, and move to the next question cleanly."),
    "practice": ("You are {teacher}, a coach running a practice session over a shared whiteboard. The learner "
                 "attempts, you give short concrete feedback and a better version, then the next attempt."),
}


def greet_key(style: str) -> str:
    return {"interview": "greet_interview", "practice": "greet_practice"}.get(style or "lesson", "greet")


def system_prompt(teacher: str, lang: str, strictness: str, style: str = "lesson") -> str:
    tone = {
        "gentle": "Very encouraging; accept partial answers generously; never make the learner feel wrong.",
        "strict": "Precise; award credit only for correct, complete answers; correct terminology firmly but kindly.",
    }.get(strictness, "Warm and clear; give credit for the right idea in the learner's own words.")
    persona = LIVE_PERSONA.get(style or "lesson", LIVE_PERSONA["lesson"]).format(teacher=teacher)
    return (
        f"{persona} "
        f"Session language: {LANG_NAMES.get(lang, lang)}. {tone}\n"
        "You evaluate the learner's answer to the check for the CURRENT concept using its rubric and the listed "
        "misconceptions, and decide what happens next. Keep every spoken line short; the learner is listening, not reading.\n\n"
        + DECISION_SCHEMA
    )


_TRAILING_Q = re.compile(r"[?？]\s*[\"'”’)]*\s*$")


def narration_asks(say: str) -> bool:
    """The narration already ended on a question: speaking the check prompt
    too would ask the learner twice (older plans; new ones are validated)."""
    return bool(_TRAILING_Q.search((say or "").strip()))


def _ops_as_text(ops: List[Dict[str, Any]]) -> str:
    lines = []
    for op in ops:
        k = op.get("op")
        if k in ("heading", "text", "callout", "annotate"):
            lines.append(f"[{k} #{op.get('id')}] {op.get('text')}")
        elif k == "bullet":
            lines.append(f"[bullet #{op.get('id')}] " + " | ".join(op.get("items") or []))
        elif k == "formula":
            lines.append(f"[formula #{op.get('id')}] {op.get('latex')}")
        elif k in ("svg", "image", "video", "media_task"):
            parts = ", ".join(f"{p.get('label')} (#{p.get('id')})" for p in (op.get("parts") or []))
            lines.append(f"[{k} #{op.get('id')}] {op.get('description')}" + (f" — parts: {parts}" if parts else ""))
        elif k == "table":
            lines.append(f"[table #{op.get('id')}] " + " / ".join(" | ".join(r) for r in (op.get("rows") or [])[:4]))
        elif k == "arrow":
            lines.append(f"[arrow #{op.get('id')}] {op.get('from')} -> {op.get('to')} {op.get('text') or ''}")
    return "\n".join(lines)


def turn_prompt(
    *,
    learner_name: Optional[str],
    learner_block: str,
    slide_title: str,
    objectives: List[str],
    board_ops: List[Dict[str, Any]],
    concept_title: str,
    concept_say: str,
    teach_notes: Optional[str],
    check: Dict[str, Any],
    transcript: List[Dict[str, str]],
    learner_message: str,
    remediation_no: int,
    mode: str,
    final_attempt: bool = False,
    source_block: Optional[str] = None,
    revisit: bool = False,
) -> str:
    parts = [
        f"LEARNER: {learner_name or 'the learner'}\n{learner_block}".strip(),
        f"SLIDE: {slide_title}\nOBJECTIVES: " + "; ".join(objectives[:5]),
        "BOARD (what the learner sees now; ids in #):\n" + (_ops_as_text(board_ops) or "(empty)"),
        f"CURRENT CONCEPT: {concept_title}\nTEACHER JUST SAID: {concept_say}"
        + (f"\nTEACHING NOTES: {teach_notes}" if teach_notes else ""),
        "CHECK:\n" + json.dumps({
            "type": check.get("type"), "prompt": check.get("prompt"), "options": check.get("options") or [],
            "expected": check.get("expected"), "rubric": check.get("rubric"),
            "misconceptions": check.get("misconceptions") or [], "pass_threshold": check.get("pass_threshold", 0.7),
        }, ensure_ascii=False),
        ("SOURCE MATERIAL (the course's own material for this concept; ground your hint in it):\n" + source_block[:6000])
        if source_block else "",
        "RECENT TRANSCRIPT:\n" + "\n".join(f"{m['role']}: {m['text']}" for m in transcript[-6:]),
        ("THIS IS A REVISIT: the learner found this concept hard earlier in the lesson; the check above is a fresh "
         "question on the same idea and this is their ONE attempt at it."
         if revisit else (f"THIS IS REMEDIATION #{remediation_no} FOR THIS CONCEPT." if remediation_no else "FIRST ANSWER FOR THIS CONCEPT.")),
        ("THIS IS THE LEARNER'S FINAL ATTEMPT ON THIS CHECK. Do NOT re-ask. If the answer is still wrong, use action "
         "\"remediate\" and in `say` give the correct answer in one clear sentence, then say you will move on."
         if final_attempt else ""),
        f"LEARNER NOW SAYS ({mode}): {learner_message.strip()}",
        "Decide. JSON only.",
    ]
    return "\n\n".join(p for p in parts if p)


def doubt_prompt(
    *,
    learner_name: Optional[str],
    learner_block: str,
    slide_title: str,
    board_ops: List[Dict[str, Any]],
    concept_title: str,
    concept_say: str,
    teach_notes: Optional[str],
    transcript: List[Dict[str, str]],
    question: str,
    source_block: Optional[str],
) -> str:
    parts = [
        f"LEARNER: {learner_name or 'the learner'}\n{learner_block}".strip(),
        f"SLIDE: {slide_title}",
        "BOARD (ids in #):\n" + (_ops_as_text(board_ops) or "(empty)"),
        f"CURRENT CONCEPT: {concept_title}\nTEACHER JUST SAID: {concept_say}"
        + (f"\nTEACHING NOTES: {teach_notes}" if teach_notes else ""),
    ]
    if source_block:
        parts.append("SOURCE MATERIAL (answer from this; say so if it does not cover the question):\n" + source_block[:6000])
    parts += [
        "RECENT TRANSCRIPT:\n" + "\n".join(f"{m['role']}: {m['text']}" for m in transcript[-6:]),
        f"LEARNER ASKS: {question.strip()}",
        'Answer in 1-4 spoken sentences, then bring them back to the lesson. Use action "answer_doubt". JSON only.',
    ]
    return "\n\n".join(parts)


def learner_block(state: Dict[str, Any], tags: List[str]) -> str:
    mastery = state.get("mastery_json") or {}
    relevant = {t: mastery[t] for t in tags if t in mastery}
    lines = []
    if state.get("rolling_summary"):
        lines.append("Previous sessions: " + summary_notes(str(state["rolling_summary"]))[:600])
    if relevant:
        lines.append("Mastery on this concept's tags: " + ", ".join(f"{t}={round(float(v.get('score', 0)), 2)}" for t, v in relevant.items()))
    mis = state.get("misconceptions_json") or []
    if mis:
        lines.append("Known misconceptions: " + "; ".join(str(m.get("note") or m.get("tag")) for m in mis[-4:]))
    if state.get("pace"):
        lines.append(f"Pace preference: {state['pace']}")
    return "\n".join(lines)


# ── revisit question (design §6.6) ───────────────────────────────────────────

REVISIT_QUESTION_SCHEMA = """Return ONE JSON object and nothing else:
{"prompt": "<the new question, 1-2 spoken sentences>", "expected": "<the answer you expect, one line>", "rubric": "<what earns credit, one line>"}"""


def revisit_question_prompt(
    *, lang: str, concept_title: str, concept_say: str, teach_notes: Optional[str], check: Dict[str, Any],
    previous_answer: Optional[str], misconception: Optional[str],
) -> str:
    parts = [
        f"CONCEPT: {concept_title}\nWHAT WAS TAUGHT: {concept_say}" + (f"\nTEACHING NOTES: {teach_notes}" if teach_notes else ""),
        "ORIGINAL CHECK (do not reuse its wording):\n" + json.dumps({
            "prompt": check.get("prompt"), "expected": check.get("expected"), "rubric": check.get("rubric"),
            "misconceptions": check.get("misconceptions") or []}, ensure_ascii=False),
        (f"THE LEARNER'S EARLIER ANSWER: {previous_answer[:300]}" if previous_answer else "")
        + (f"\nMISCONCEPTION HEARD: {misconception}" if misconception else ""),
        f"Write ONE fresh question on the same idea, approached from a different angle (an example, a why, a what-if), "
        f"answerable in one or two spoken sentences, in {LANG_NAMES.get(lang, lang)}. No options, no markdown.",
        REVISIT_QUESTION_SCHEMA,
    ]
    return "\n\n".join(p for p in parts if p)


# ── rolling summary rewrite (design §6.6, §6.9) ─────────────────────────────

SUMMARY_SCHEMA = """Return ONE JSON object and nothing else:
{"say_next_time": "<1-2 sentences you will say to the learner when they return: what went well and what to revisit; warm, specific, no lists>",
 "notes": "<60-120 words of private notes: what they know, which concepts are weak (name them), misconceptions heard, how they answer, pace>"}"""


def summary_prompt(*, teacher: str, learner_name: Optional[str], lang: str, digest: Dict[str, Any]) -> str:
    attempts = digest.get("attempts") or []
    lines = [
        f"You are {teacher}, a one-to-one teacher. Rewrite your notes about {learner_name or 'the learner'} after today's lesson.",
        f"TODAY ({digest.get('date')}, {digest.get('duration_minutes', 0)} min): "
        + "; ".join(f"{s.get('title')} — {s.get('done_today', s.get('done', 0))} concept(s) today, "
                    f"{s.get('done', 0)}/{s.get('total', 0)} overall" for s in (digest.get("slides") or [])),
        "ANSWERS TODAY:\n" + ("\n".join(
            f"- {a.get('concept')}: score {a.get('score') if a.get('score') is not None else 'n/a'}, {a.get('action')}"
            + (f", misconception: {a.get('misconception')}" if a.get("misconception") else "")
            + (f", said: \"{a.get('answer')}\"" if a.get("answer") else "")
            for a in attempts[:40]) or "(no checks answered)"),
        ("STILL WEAK: " + ", ".join(digest.get("weak_titles") or [])) if digest.get("weak_titles") else "",
        ("PREVIOUS NOTES:\n" + str(digest.get("previous_summary"))[:900]) if digest.get("previous_summary") else "",
        f"Pace preference: {digest.get('pace')}" if digest.get("pace") else "",
        f"`say_next_time` must be in {LANG_NAMES.get(lang, lang)} and address the learner directly, but it must NOT greet "
        "or say the learner's name (the teacher has already said \"welcome back\" before it); `notes` in English. "
        "Merge with the previous notes and drop what is no longer true.",
        SUMMARY_SCHEMA,
    ]
    return "\n\n".join(p for p in lines if p)


# ── predict-then-reveal turn ─────────────────────────────────────────────────

PREDICT_SCHEMA = """Return ONE JSON object and nothing else:
{"say": "1-2 spoken sentences reacting to the guess (warm; if it is close say what was right; if not, do not reveal the answer — say what to watch for), in the session language", "close": true|false}"""


def predict_prompt(*, learner_name: Optional[str], question: str, concept_title: str, concept_say: str,
                   answer: str, lang: str) -> str:
    return "\n\n".join([
        f"LEARNER: {learner_name or 'the learner'}",
        f"You asked them to GUESS before teaching '{concept_title}': {question}",
        f"WHAT YOU ARE ABOUT TO TEACH (do not reveal it yet): {concept_say}",
        f"THEIR GUESS ({LANG_NAMES.get(lang, lang)}): {answer.strip()}",
        "React in 1-2 sentences and hand over to the explanation. Any guess is fine; never grade it. JSON only.",
        PREDICT_SCHEMA,
    ])
