"""Prompt blocks for compiling one slide into a teaching plan (design §4.6)."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .plan_validator import (
    MAX_BOARD_WORDS_PER_TOPIC, MAX_HEADINGS_PER_CONCEPT, MAX_VISUALS_PER_CONCEPT,
    MAX_WORDS_PER_CONCEPT,
)

LANG_NAMES = {"en": "English", "hi": "Hindi (Devanagari script; keep English technical terms in Latin script)"}


def _other(lang: str) -> str:
    return "hi" if lang == "en" else "en"


OPS_REFERENCE = """BOARD OPERATIONS (the only ops you may use; every element op has a unique "id"):
- {"op":"heading","id":"t1-h","text":"...","level":2}            one per concept at most
- {"op":"text","id":"...","text":"..."}                            a short line, not a paragraph
- {"op":"bullet","id":"...","items":["...","..."]}                 2-4 short items
- {"op":"formula","id":"...","latex":"F = m a","caption":"..."}   LaTeX, no $ delimiters
- {"op":"svg","id":"...","svg":"<svg viewBox='0 0 640 360'>...</svg>","description":"what it shows","parts":[{"id":"nucleus","label":"Nucleus","step":0},{"id":"arrow1","label":"Energy flow","step":1}]}
      a clean diagram; give the parts a teacher would point at their own id= inside the svg (wrap a shape and its
      label in one <g id='...'>). "step" ANIMATES the diagram: parts with step 0 are drawn at once, parts with
      step 1, 2, 3… appear in that order while the teacher speaks, so mention them in `say` in the same order.
      Inside the svg use SINGLE quotes for every attribute (viewBox='0 0 640 360', id='nucleus') so the JSON string needs no escaping.
- {"op":"image","id":"...","generate":"prompt for an image generator","description":"what it shows","caption":"..."}
      a realistic picture where a photo teaches better than a line drawing (anatomy, equipment, real-world
      scenes, a patient doing an exercise): write a concrete, well-lit, educational illustration prompt
- {"op":"table","id":"...","rows":[["Header","Header"],["a","b"]]}
- {"op":"callout","id":"...","text":"...","kind":"tip|warning|definition|example"}
- {"op":"annotate","id":"...","target":"<existing element id>","text":"...","position":"right|below|above|left"}
- {"op":"arrow","id":"...","from":"<element id>","to":"<element id>","text":"..."}
- {"op":"media_task","id":"...","kind":"video|pdf","description":"..."}   ONLY in a media-task lesson (the system fills the url)
- {"op":"columns","id":"...","columns":[[ ...ops... ],[ ...ops... ]]}      2-3 columns side by side for a comparison
      (each column: a heading/text/bullet/callout/table/formula; nested ops need their own ids; no svg/image inside)
REQUIRED on every element op: "say_index": the 0-based sentence of `say` during which it appears. The board writes
itself while the teacher speaks: sentence 0 shows the say_index-0 elements, sentence 1 the next, and so on. A
diagram part's "step" is likewise the sentence index it appears at. Optional: "anim":"write|fade|pop".
Never use highlight/unhighlight/reveal/clear: those are live-session ops."""


def plan_schema_text(lang: str) -> str:
    other = _other(lang)
    return f"""OUTPUT: one JSON object, nothing else (no markdown fences, no prose before or after; compact, no pretty-printing; no raw newlines inside strings):
{{
  "language": "{lang}",
  "objectives": ["...", "..."],
  "key_terms": [{{"term": "...", "meaning": "..."}}],
  "topics": [
    {{
      "id": "t1", "title": "...", "estimated_seconds": 240,
      "concepts": [
        {{
          "id": "t1c1", "title": "...",
          "concept_tags": ["subject.concept"],
          "prerequisites": [],
          "predict": "ONLY on the first concept of topics 2, 3, …: one short question the learner guesses at BEFORE this board appears (<= 25 words)",
          "predict_i18n": {{"{other}": "the same question in {LANG_NAMES[other]}"}},
          "board_ops": [ ...ops... ],
          "say": "2 to 4 spoken sentences in {LANG_NAMES[lang]}",
          "say_i18n": {{"{other}": "the same narration in {LANG_NAMES[other]}"}},
          "teach_notes": "how to teach this; analogies; what NOT to introduce yet",
          "check": {{
            "type": "open|mcq|numeric|none",
            "prompt": "the question the teacher asks",
            "options": ["only for mcq"],
            "expected": "the answer",
            "rubric": "what earns full / half credit",
            "misconceptions": [{{"pattern": "what a confused learner says", "hint": "the nudge that fixes it"}}],
            "hint": "a nudge the teacher gives when the learner is stuck (never the answer itself)",
            "prompt_i18n": {{"{other}": "the question in {LANG_NAMES[other]}"}},
            "hint_i18n": {{"{other}": "the hint in {LANG_NAMES[other]}"}},
            "pass_threshold": 0.7
          }}
        }}
      ],
      "summary_ops": [ {{"op":"bullet","id":"t1-recap","items":["3 to 5 one-line takeaways of this topic"]}} ],
      "summary_say": "1-3 spoken sentences that recap the topic in {LANG_NAMES[lang]}",
      "summary_say_i18n": {{"{other}": "the same recap in {LANG_NAMES[other]}"}}
    }}
  ]
}}"""


def rules_text(images_enabled: bool = True) -> str:
    return f"""RULES (a validator enforces these; violations come back to you for repair):
1. A TOPIC is one whiteboard. A CONCEPT is one phase of that board: it ADDS a little to the board
   (at most {MAX_HEADINGS_PER_CONCEPT} heading, at most {MAX_VISUALS_PER_CONCEPT} visual, under {MAX_WORDS_PER_CONCEPT} words of new text) while the teacher
   speaks `say`. The whole topic's board must fit one screen (under {MAX_BOARD_WORDS_PER_TOPIC} words).
2. PROBLEM SLIDES (checked): when the source is a question — a stem, what is asked, and possibly answer
   options — the FIRST board states the COMPLETE question before anything is solved: every given, the exact
   quantity or expression asked for (as a `formula` op, verbatim), and the options as a bullet or table if
   there are any. A learner must be able to read the whole problem off that board alone; never reduce it to
   the givens and keep the ask for later.
3. Cover the ENTIRE slide. As many topics and concepts as the material needs; never compress to hit a count.
   Do not add facts the material does not contain; do not skip facts it does.
4. Every concept except the first of a topic has a check. Checks test the concept just taught, in the
   learner's own words where possible; give a rubric and 1-3 realistic misconceptions with hints.
5. VISUALS ARE THE POINT OF A WHITEBOARD — a board of prose is a FAILED board. Institutes tell us students
   learn from pictures. The unit the learner looks at is the CONCEPT (each reveal is on screen for about a
   minute), so these are checked per concept:
   - the FIRST concept of every board opens with its diagram or picture — a learner never stares at a
     definition and two callouts while the drawing waits for concept three;
   - every later concept either adds a visual of its own (svg, image, table, formula) or EXTENDS the board's
     diagram — `annotate` the part the narration reaches, `arrow` between two parts, `highlight` one — so
     the diagram grows as the teaching does; two note-only concepts never follow each other;
   - a recap concept re-annotates the board's diagram rather than restating it in a callout.
   Text, bullets and callouts are NOTES beside the visual and never count as the visual, however many there
   are. Use them the way a textbook margin does: `callout` with its right kind ("definition" for a term,
   "example" for a worked or real case, "warning" for the common mistake, "tip" for the thing to remember),
   a `table` for any comparison, `columns` for side-by-side, a numbered `bullet` strip for a process.
   Use an SVG diagram for anything structural (parts of a cell, a circuit, a force diagram, a
   flow, a timeline, a comparison) and for any IDEA that has parts or a direction — three abilities become
   three labelled shapes, a definition with a contrast becomes two boxes and an arrow, a chain becomes a
   flow. SVG craft rules (the board renders them at ~700px wide in a sans-serif font):
   - viewBox='0 0 640 360' and FILL it: shapes spread across the whole canvas, nothing crammed into one corner
     or floating in empty white space; keep a 24px margin from every edge (text baselines >= 32 from the top).
   - 3-4 harmonious fill colours (soft blues/greens/ambers with a darker stroke) plus dark text; rounded
     rects (rx='10'), arrows with marker-end, thick strokes (2-3px).
   - Labels 18-22px, text-anchor='middle' inside or under their shape; a label fits in about 11px per
     character, so a 12-character label needs a shape at least 150px wide. Never let text cross a line or
     another label; never rely on font width to line things up.
   - Give the parts a teacher would point at their own id= (listed in "parts"), and use "step" so a
     process, a flow or a build-up appears piece by piece as the narration reaches it.
   Tables for comparisons, callouts for definitions and warnings. A worked derivation or a pure-algebra board
   is visual through its `formula` ops and a comparison board through its `table` — those count as the board's
   visual; never bolt a decorative diagram onto algebra just to have a picture.
   {IMAGES_ON_RULE if images_enabled else IMAGES_OFF_RULE}
6. WORD BUDGET: the limit on a concept's board counts the words of text, bullets, callouts and table cells —
   formulas and diagram labels do not count. If a step needs more explanation than fits, say it out loud in the
   narration instead of writing it on the board.
7. `say` is what the teacher SAYS out loud: warm, second person, 2-4 sentences, refers to the board
   ("look at the arrow on the left"). Use {{student_name}} where the teacher would say the learner's name.
   Provide the same narration in the other language under say_i18n — and likewise every other SPOKEN line
   (check prompt, hint, predict, summary_say) under its *_i18n. A learner may switch language mid-lesson.
   HINDI means Hinglish as an Indian teacher speaks it: Hindi sentences in Devanagari with the technical
   terms in English letters ("physical assessment physiotherapy plan की नींव है") — never an English
   sentence, never a pure-Sanskrit translation of a technical term. SPOKEN RHYTHM: one idea per sentence,
   under 18 words each; never read a list aloud (say "three things matter here" and name them in prose);
   put a question in its own final sentence.
8. Ids: topics "t1","t2"...; concepts "t1c1","t1c2"...; elements "t1c1-b1" etc. All unique across the plan.
9. concept_tags are stable, lowercase, dotted ("cell.nucleus"); the same idea gets the same tag everywhere.
10. Write teach_notes for a human/AI teacher: the analogy to use, the order to reveal things, common traps.
11. ENGAGEMENT (checked): every topic closes with a recap — summary_ops holds ONE bullet op of 3-5 one-line
   takeaways and summary_say is the 1-3 sentence spoken recap; every topic contains one callout of kind
   "example" (a worked or real-life example); the first concept of every topic after the first carries a
   `predict` question (a guess the learner makes before the board appears, e.g. "What do you think happens
   to control when you export?").
12. CHECK MIX (checked): at least a third of all checks are QUICK — "mcq" with exactly 3 options (one right,
   two plausible) or "numeric"; open questions ask ONE thing in under 30 words and are for reasoning, not
   recall; every check carries a `hint` (a nudge, never the answer).
13. Set "say_index" on every element op and "step" on diagram parts so the board writes itself in sync with
   the narration (rule in the ops reference).
14. ONE QUESTION, ASKED ONCE (checked). When a concept has a check, `say` explains and then STOPS — it never
   asks the check's question, never says "try it before I reveal", never ends with a question mark. The
   check's `prompt` is the only question and it is spoken aloud verbatim right after `say`, so write it as a
   complete, concrete, self-contained question with the actual numbers and names ("A train 150 m long
   passes a pole in 15 s. What is its speed?"), never an abstract restatement ("A train of length L…")."""


# How the session runs. The style changes the persona and the shape of every
# board; the ops, the checks and the validator are shared.
STYLE_PERSONA = {
    "lesson": (
        "You are {teacher}, an expert one-to-one teacher, turning one course slide into a live whiteboard "
        "lesson: a sequence of small board phases, each spoken over in a few sentences and followed by a "
        "quick check of understanding. You write for a learner who is alone with you; you never lecture in "
        "walls of text."
    ),
    "interview": (
        "You are {teacher}, a professional INTERVIEWER running a one-to-one mock interview over a shared "
        "whiteboard. This is NOT a lesson: you do not teach first. Each concept is ONE interview question: "
        "`say` is what an interviewer says to set up that question in one or two sentences (context only, no "
        "method, no hints), the board shows just the question's givens (a heading and the numbers or the "
        "statement, nothing that reveals the method), and the check `prompt` IS the interview question, asked "
        "once, concretely. Put the model answer, the method and the trap in the rubric, hint and teach_notes — "
        "the interviewer reveals them only AFTER the candidate has answered. Keep the register crisp and "
        "professional: 'Question two.', 'Take your time.', 'Good — now…'. No 'let's learn', no recap lectures; "
        "a topic's summary_say is the interviewer's brief feedback on that round."
    ),
    "practice": (
        "You are {teacher}, a coach running a hands-on PRACTICE session over a shared whiteboard: short "
        "set-ups, then the learner does the work. Each concept: `say` gives the situation in one or two "
        "sentences, the board shows the scenario or the template, and the check `prompt` asks the learner to "
        "produce something concrete (a sentence, a number, a choice). Feedback and the model version come "
        "after the attempt, via the rubric and hint. Warm, brisk, practical; no long explanations."
    ),
}


def style_persona(style: str, teacher_name: str) -> str:
    return STYLE_PERSONA.get(style or "lesson", STYLE_PERSONA["lesson"]).format(teacher=teacher_name)


def system_prompt(teacher_name: str, lang: str, images_enabled: bool = True, style: str = "lesson") -> str:
    return (
        style_persona(style, teacher_name) + "\n\n"
        f"Course language: {LANG_NAMES.get(lang, lang)}.\n\n"
        + OPS_REFERENCE + "\n\n" + rules_text(images_enabled)
    )


# Tested 2026-09-04 on a physiotherapy slide: with only "use an image where a
# picture teaches better", both Luna and Flash returned ZERO image ops across
# four boards. Spelling out which visual kind fits what, and requiring one
# scene-setting image, gave two well-placed images plus the diagrams.
IMAGES_ON_RULE = """IMAGES ARE ON FOR THIS COURSE. A whiteboard mixes two kinds of visual and you must use both kinds where each fits:
   - "svg" diagrams for STRUCTURE: parts of a thing, a flow or pathway, a comparison, a timeline, a formula.
   - "image" ops for everything a learner should SEE rather than infer from shapes — in two flavours:
     * a TEXTBOOK ILLUSTRATION, where a book would print one: a labelled cutaway or cross-section, an
       organism or specimen, an apparatus, an anatomical structure, a map, a historical scene. Brief it as
       "a clean educational textbook illustration, flat vector style, generous white background, soft muted
       palette, of <subject>, with <the parts that matter> clearly separated".
     * a PHOTOGRAPHIC scene, for the real world: a person doing something, a workplace, a clinic, a lab, a
       technique being performed. Brief it as subject, action, setting, lighting, camera angle, then
       "realistic, educational".
     A learner remembers a labelled illustration of the heart, or a photo of a physiotherapist assessing a
     patient, far better than a box labelled "assessment".
   Image rules (checked): (a) a slide carries roughly one illustration per two boards and never fewer than
   one per four concepts — one on a short slide, two or three on a long one — placed where a picture teaches
   more than shapes, never as decoration;
   (b) every topic that involves people, places, organisms, equipment, practical technique or a worked
   real-world example gets an image op in one of its concepts, alongside (not instead of) any diagram that
   topic needs; (c) a purely abstract topic (definitions, categories, a derivation) keeps its diagram and
   needs no photo, though a labelled illustration often still helps; (d) an image `generate` prompt is a
   concrete brief of 25-45 words naming the subject and the parts that must be visible, and always ends with
   "no text, no watermark, no logos" — the board writes the labels, not the picture."""

IMAGES_OFF_RULE = """AI IMAGES ARE OFF for this course: do not use image ops; draw every visual as an svg diagram."""


def user_prompt(
    *,
    slide_title: str,
    chapter_title: Optional[str],
    course_title: Optional[str],
    slide_kind: str,
    source_text: str,
    lang: str,
    kb_block: Optional[str] = None,
    institute_prompt: Optional[str] = None,
    images_enabled: bool = True,
) -> str:
    parts: List[str] = []
    parts.append(f"COURSE: {course_title or '(untitled)'}\nCHAPTER: {chapter_title or '(none)'}\nSLIDE: {slide_title}\nSLIDE KIND: {slide_kind}")
    if institute_prompt:
        parts.append("INSTITUTE TEACHING STYLE:\n" + institute_prompt.strip()[:2000])
    if not images_enabled:
        parts.append(IMAGES_OFF_RULE)
    parts.append("SLIDE MATERIAL (teach all of it, in this order):\n" + source_text.strip())
    if kb_block:
        parts.append(kb_block.strip())
    parts.append(plan_schema_text(lang))
    return "\n\n".join(parts)


TEXT_KIND_LABEL = {"script": "NARRATION SCRIPT", "captions": "CAPTIONS", "transcript": "TRANSCRIPT (speech recognition; may contain errors)",
                   "pdf": "TEXT"}


def media_task_user_prompt(
    *,
    slide_title: str,
    chapter_title: Optional[str],
    course_title: Optional[str],
    kind: str,
    description: str,
    lang: str,
    transcript: Optional[str] = None,
    text_kind: Optional[str] = None,
) -> str:
    """A video or PDF slide. With only a teacher's description: one topic, the
    media task, then 2-4 check questions. With the material's own words
    (script / captions / transcript / PDF text): the media task, then real
    teaching concepts drawn from the text (design §4.2)."""
    what = "video" if kind == "video" else "PDF"
    head = (
        f"COURSE: {course_title or '(untitled)'}\nCHAPTER: {chapter_title or '(none)'}\nSLIDE: {slide_title}\n"
        f"SLIDE KIND: {what} the learner must {'watch' if kind == 'video' else 'read'} (a MEDIA TASK)\n\n"
    )
    task = (
        "Its FIRST concept is the task itself: board_ops = exactly one op "
        f'{{"op":"media_task","id":"t1c1-m","kind":"{kind}","description":"..."}} (the url is filled in by the system), '
        f"`say` asks the learner to {'watch the video' if kind == 'video' else 'read the document'} now and tell you when done, and check.type = \"none\". "
    )
    if transcript and transcript.strip():
        label = TEXT_KIND_LABEL.get(text_kind or "", "TEXT")
        note = f"WHAT THE {what.upper()} TEACHES (the teacher's note):\n{description.strip()}\n\n" if description and description.strip() else ""
        return (
            head + note
            + f"{label} OF THE {what.upper()} (what it actually says):\n{transcript.strip()}\n\n"
            + "Build 1 to 3 topics in the order the material presents its ideas. " + task
            + "Every other concept teaches ONE key idea from the text: a board that shows it (heading, bullets, formula, table, "
              "or an svg where the idea is visual), a narration in your own words (never a quote of the text), and a check with "
              "rubric and misconceptions drawn from the text. 3 to 8 teaching concepts in total; ignore small talk, "
              "greetings and sponsor messages in the text. Nothing else.\n\n"
            + plan_schema_text(lang)
        )
    return (
        head
        + f"WHAT THE {what.upper()} TEACHES (written by the teacher who added it):\n{description.strip()}\n\n"
        + "Build ONE topic. " + task
        + "Then 2 to 4 concepts that each ask ONE check question about what the material covered "
          "(board: a short heading or bullet restating the point after the learner answers), with rubric and misconceptions "
          "drawn from the description. Nothing else.\n\n"
        + plan_schema_text(lang)
    )


def image_repair_prompt(previous_json: str) -> str:
    """The plan validated but carries no image op although images are on:
    one extra round that asks for pictures where they belong."""
    return (
        "Your plan is valid but has NO image op, and AI images are ON for this course. Re-read the image "
        "rules: add an image op (with a 25-45 word photographic `generate` brief) in the topic that sets the "
        "scene and in every topic that involves people, patients, settings, tools, techniques or worked "
        "examples — keep every diagram you drew. If the slide is genuinely abstract everywhere, return the "
        "plan unchanged. Return the complete corrected JSON object, nothing else.\n\nPREVIOUS JSON:\n"
        f"{previous_json[:60000]}"
    )


def repair_prompt(errors: List[str], previous_json: str) -> str:
    listed = "\n".join(f"- {e}" for e in errors[:40])
    return (
        "Your previous plan did not pass validation. Fix EVERY problem below and return the complete, "
        "corrected JSON object (same structure, all topics and concepts, nothing else):\n"
        f"{listed}\n\nPREVIOUS JSON:\n{previous_json[:60000]}"
    )


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    return s


def extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Pull the first JSON object out of a model reply.

    Tolerates code fences and prose around the object, then falls back to a
    repairing parser: plans carry SVG markup inside JSON strings and models
    regularly slip on the escaping (an unescaped quote in a viewBox, a raw
    newline), which strict json.loads rejects wholesale."""
    if not text:
        return None
    s = _strip_fences(text)
    for candidate in (s, s[s.find("{"): s.rfind("}") + 1] if "{" in s and "}" in s else ""):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:  # noqa: BLE001
            pass
    if "{" in s:
        # A complete object followed by stray text (a second attempt, a note).
        try:
            obj, _end = json.JSONDecoder().raw_decode(s[s.find("{"):])
            if isinstance(obj, dict):
                return obj
        except Exception:  # noqa: BLE001
            pass
    try:
        import json_repair  # type: ignore
        obj = json_repair.loads(s[s.find("{"):] if "{" in s else s)
        # Text it reads as several values comes back as a list: the plan is
        # the object that carries topics.
        if isinstance(obj, list):
            plans = [o for o in obj if isinstance(o, dict) and o.get("topics")]
            obj = max(plans, key=lambda o: len(json.dumps(o, ensure_ascii=False))) if plans else None
        if isinstance(obj, dict) and obj:
            return obj
    except Exception:  # noqa: BLE001
        pass
    return None


def json_error_at(text: str) -> str:
    """Where strict parsing breaks, with the text around it, for the log: the
    error column only shows the reply's head and tail."""
    s = _strip_fences(text or "")
    s = s[s.find("{"):] if "{" in s else s
    try:
        json.loads(s)
        return "strict parse OK"
    except json.JSONDecodeError as exc:
        around = s[max(0, exc.pos - 80): exc.pos + 80].replace("\n", " ")
        return f"strict parse: {exc.msg} at char {exc.pos} near {around!r}"
    except Exception as exc:  # noqa: BLE001
        return f"strict parse: {exc}"[:200]


def describe_reply(text: str) -> str:
    """One line for logs and the plan's error column: size, shape, head."""
    t = (text or "")
    head = t.strip()[:160].replace("\n", " ")
    tail = t.strip()[-40:].replace("\n", " ")
    return f"len={len(t)} starts={head!r} ends={tail!r}"


def soft_repair_prompt(errors: List[str], previous_json: str) -> str:
    """Quality asks (recap, examples, check mix, hints, diagram geometry):
    one round, and the plan is kept even if the model cannot satisfy all."""
    listed = "\n".join(f"- {e}" for e in errors[:40])
    return (
        "Your plan is valid but misses some of the engagement and diagram rules. Improve it: fix every point "
        "below, keep every topic and concept, keep what already works, and return the complete corrected JSON "
        "object, nothing else. For a diagram problem, redraw that svg on viewBox='0 0 640 360' with filled "
        "rounded boxes, 16-22px labels inside or under their shapes, and nothing crossing. For a text-only "
        "concept, draw the idea (its parts as labelled shapes, its contrast as two boxes and an arrow, its "
        "chain as a flow) or extend the board's existing diagram with annotate/arrow/highlight — and move the "
        "words that were on the board into the narration.\n"
        f"{listed}\n\nPREVIOUS JSON:\n{previous_json[:60000]}"
    )
