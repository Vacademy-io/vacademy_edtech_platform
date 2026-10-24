"""Lesson mode — education videos built like a real class.

A lesson is a board that builds up while a teacher explains it. This module
holds the pure rules (no network, no ffmpeg) that every stage of the pipeline
consults when a run carries a lesson plan:

  * planner     — lesson pacing replaces the reel rhythm (sections of 6-20 s,
                  no 12-shot cap) and every shot gets a `teacher_layout`;
  * narration   — a teacher's voice instead of a narrator's;
  * per-shot    — the board keeps the teacher's part of the frame clear;
  * timeline    — the teacher overlay entries, one per run of sections that
                  share a layout.

The teacher itself is rendered by `lesson_teacher.py` (Spatius Video API).

Layouts, landscape 1920x1080 (portrait maps side/presenter to a bottom band):

  board      no teacher on screen
  corner     small teacher cut-out in the bottom-right corner over the board (22% wide)
  bubble     round teacher bubble in the bottom-right corner (270 px)
  side       slim teacher panel on the right (25%), board on the rest
  presenter  teacher panel on the right (36%) — the hook and "why it matters" moments

The avatar is never drawn larger than the Spatius render (a 1080p head-and-
shoulders): every layout scales it DOWN, so the face stays sharp. Teachers
read as too big and soft at the first sizes (side 33%, presenter 50%).
"""
from __future__ import annotations

import html as _html
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

LAYOUTS: Tuple[str, ...] = ("board", "corner", "bubble", "side", "presenter")
TEACHER_LAYOUTS: Tuple[str, ...] = ("corner", "bubble", "side", "presenter")
# Layouts that float over a full-frame board (no panel, no canvas resize).
OVERLAY_LAYOUTS: Tuple[str, ...] = ("corner", "bubble")
LAYOUT_PREFERENCES: Tuple[str, ...] = ("auto",) + LAYOUTS

# Shot types whose content is dense enough that the board needs most of the
# frame — the teacher steps into the corner for these. TEXT_DIAGRAM is the
# everyday explanation shot, so it stays with the side panel by default.
_DENSE_TYPES = frozenset({
    "EQUATION_BUILD", "PROCESS_STEPS", "DATA_STORY", "INFOGRAPHIC_SVG",
    "ANNOTATION_MAP",
})

TEACHER_ENTRY_PREFIX = "snippet-teacher-"
TEACHER_Z = 500  # above shots (z≈10), below the watermark (1000) and branding
# Caption band: a strip under the board, in the panel colour, where burned-in
# captions are centred. Shots never draw there — their canvas ends above it
# (a prompt-only "keep the strip clear" was ignored by hook shots).
CAPTION_BAND_FRAC = 0.22           # landscape share of the frame height
CAPTION_BAND_FRAC_PORTRAIT = 0.12
BAND_ENTRY_PREFIX = "snippet-lesson-band-"
BAND_Z = 450                       # above shots, below the teacher (500)
# Layouts whose board is a smaller canvas: the shot's timeline box is resized
# to the board area so its #shot-root lays out (and clips) inside it. Corner
# keeps the full frame — the teacher only covers a corner of it.
BOARD_RESIZED_LAYOUTS = ("side", "presenter")


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

def normalize_lesson_plan(raw: Any) -> Optional[Dict[str, Any]]:
    """Turn a request's `lesson` block (dict or pydantic model) into the plan
    dict the pipeline carries. None / disabled → None (lesson mode off)."""
    if raw is None:
        return None
    if hasattr(raw, "model_dump"):
        raw = raw.model_dump()
    if not isinstance(raw, dict) or not raw.get("enabled", True):
        return None
    teacher_raw = raw.get("teacher") or None
    teacher = None
    if isinstance(teacher_raw, dict) and str(teacher_raw.get("avatar_id") or "").strip():
        teacher = {
            "provider": "spatius",
            "avatar_id": str(teacher_raw["avatar_id"]).strip(),
            "name": (str(teacher_raw.get("name") or "").strip()[:60] or None),
            "title": (str(teacher_raw.get("title") or "").strip()[:60] or None),
        }
    layout = str(raw.get("layout") or "auto").strip().lower()
    if layout not in LAYOUT_PREFERENCES:
        layout = "auto"
    if teacher is None:
        layout = "board"
    subject = str(raw.get("subject") or "").strip()[:80] or None
    return {
        "enabled": True,
        "teacher": teacher,
        "layout": layout,
        "subject": subject,
        "worked_example": bool(raw.get("include_worked_example", raw.get("worked_example", True))),
        "recap": bool(raw.get("include_recap", raw.get("recap", True))),
    }


def has_teacher(plan: Optional[Dict[str, Any]]) -> bool:
    return bool(plan and plan.get("teacher") and plan["teacher"].get("avatar_id"))


# ─────────────────────────────────────────────────────────────────────────────
# Planner
# ─────────────────────────────────────────────────────────────────────────────

LESSON_RHYTHM_RULE = (
    "4. **LESSON PACING** — this is a LESSON, not a reel. A teacher explains while the board "
    "builds up; the viewer must have time to read, think and follow each step.\n"
    "   - A shot is one teaching SECTION: one idea, one step of a derivation, one worked-example "
    "step, or one recap point. Typical section 8-16 s; min 6 s; max 20 s.\n"
    "   - Hook (shot 0): 6-10 s — why this topic matters, posed as a question or a real-life case.\n"
    "   - Close (final shot): 8-14 s — recap of the 2-4 key takeaways.\n"
    "   - Shot count follows the content: roughly target_duration_s / 11 shots. There is NO "
    "12-shot cap in a lesson — a 10-minute lesson has ~50-60 sections.\n"
    "   - Within a section the board BUILDS: each sentence adds or highlights one element; it "
    "does not replace the board. Prefer EQUATION_BUILD / PROCESS_STEPS / TEXT_DIAGRAM / "
    "DATA_STORY / ANNOTATION_MAP / INFOGRAPHIC_SVG; use IMAGE_HERO only for a real-world example.\n"
    "   - Do NOT churn shot types for variety. Consecutive sections of one derivation keep the "
    "same shot type and visual language so the board feels continuous.\n"
    "   - `pacing_role`: use `hold` for derivation / worked-example steps, `breath` for hook, "
    "recap and transitions between concepts, `build` elsewhere. Avoid `hit`.\n"
)

_RHYTHM_START = "4. **RHYTHM PROFILE**"
_RHYTHM_END = "5. Total of all `duration_estimate_s`"


def planner_system_prompt(base: str) -> str:
    """Swap the reel rhythm rule for the lesson pacing rule. When the base
    prompt's wording drifts and the markers are gone, append an explicit
    override instead so the planner never runs a lesson on reel pacing."""
    start = base.find(_RHYTHM_START)
    end = base.find(_RHYTHM_END, start + 1) if start >= 0 else -1
    if start >= 0 and end > start:
        out = base[:start] + LESSON_RHYTHM_RULE + base[end:]
        return out.replace("RHYTHM PROFILE below", "LESSON PACING rule below")
    return base + (
        "\n\n## LESSON MODE OVERRIDE (wins over any rhythm / shot-count rule above)\n"
        + LESSON_RHYTHM_RULE
    )


def planner_user_block(plan: Dict[str, Any], *, target_duration_s: float, portrait: bool) -> str:
    """User-prompt block: lesson structure + the teacher_layout contract."""
    n_target = max(3, int(round(target_duration_s / 11.0)))
    parts: List[str] = [
        "",
        "LESSON MODE — this video is a lesson taught by a teacher at a board.",
        f"Plan about {n_target} teaching sections (target {target_duration_s:.0f}s ÷ ~11s).",
        "Structure, in order:",
        "  1. Hook — why it matters (a question, a real-life case, or a surprising fact).",
        "  2. Prerequisite check — one line recalling what the learner already knows (skip for very basic topics).",
        "  3. Concepts — one idea per section, simplest first; every term defined before it is used.",
    ]
    step = 4
    if plan.get("worked_example", True):
        parts.append(f"  {step}. Worked example — solve one representative problem step by step, one step per section.")
        step += 1
    parts.append(f"  {step}. Common mistake — one section on the most frequent misconception and how to avoid it.")
    step += 1
    if plan.get("recap", True):
        parts.append(f"  {step}. Recap — the 2-4 takeaways, as the final section.")
    if plan.get("subject"):
        parts.append(f"SUBJECT: {plan['subject']} — use the subject's own notation and conventions.")
    parts.append(
        "ACCURACY IS NON-NEGOTIABLE: every formula, number, unit and fact must be correct. "
        "Worked-example arithmetic must check out. Never invent data."
    )

    if has_teacher(plan):
        fixed = plan.get("layout") or "auto"
        if fixed != "auto":
            parts.append(
                f"TEACHER LAYOUT: fixed by the user — set `teacher_layout: \"{fixed}\"` on every shot."
            )
        else:
            parts.append(
                "TEACHER ON SCREEN: a real teacher (talking head) appears beside the board. On EVERY shot "
                "set `teacher_layout` to one of:\n"
                "  - \"presenter\": teacher fills half the frame; the board shows only a title / one key line. "
                "Use ONLY for the hook and short motivational or 'why it matters' moments — never for lists, "
                "recaps, steps or diagrams (the board half is too narrow).\n"
                "  - \"side\": teacher panel takes " + ("the bottom third" if portrait else "the right third")
                + "; the board uses the rest. Default for concept explanations and the recap.\n"
                "  - \"corner\": teacher is small in the bottom-right corner; the board gets almost the whole "
                "frame. Use for dense boards — derivations, worked-example steps, diagrams, data.\n"
                "  - \"board\": no teacher. Use rarely — only for a full-frame diagram that needs every pixel.\n"
                "Keep the layout steady across consecutive sections of one idea (no flip-flopping); change it "
                "when the lesson moves to a new phase."
            )
    else:
        parts.append("No on-screen teacher: set `teacher_layout: \"board\"` on every shot (or omit it).")
    return "\n".join(parts)


def default_layout_for(shot: Dict[str, Any], idx: int, n: int, plan: Dict[str, Any]) -> str:
    """Deterministic fallback when the planner omitted or garbled a layout."""
    if not has_teacher(plan):
        return "board"
    fixed = plan.get("layout") or "auto"
    if fixed != "auto":
        return fixed
    role = str(shot.get("intent_role") or "").lower()
    # Presenter leaves a half-frame board — fine for a hook's one line, too
    # narrow for a recap list (a prod recap collapsed to one-letter columns).
    if idx == 0 or role == "hook":
        return "presenter"
    if str(shot.get("shot_type") or "").upper() in _DENSE_TYPES:
        return "corner"
    return "side"


def apply_layouts(shots: List[Dict[str, Any]], plan: Optional[Dict[str, Any]]) -> Dict[str, int]:
    """Validate / fill `teacher_layout` on every shot in place. A user-fixed
    layout always wins over the planner's choice. Returns layout counts."""
    counts: Dict[str, int] = {k: 0 for k in LAYOUTS}
    if not plan:
        return counts
    n = len(shots)
    fixed = plan.get("layout") or "auto"
    teacher = has_teacher(plan)
    for i, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        chosen = str(shot.get("teacher_layout") or "").strip().lower()
        if not teacher:
            chosen = "board"
        elif fixed != "auto":
            chosen = fixed
        elif chosen not in LAYOUTS:
            chosen = default_layout_for(shot, i, n, plan)
        shot["teacher_layout"] = chosen
        counts[chosen] += 1
    return counts


# ─────────────────────────────────────────────────────────────────────────────
# Narration
# ─────────────────────────────────────────────────────────────────────────────

TEACHER_VOICE_BLOCK = (
    "\n\n## LESSON MODE — YOU ARE THE TEACHER (overrides any narrator / marketing voice above)\n"
    "Write as one warm, clear teacher speaking to one learner, not as a narrator or an ad.\n"
    "- Teach step by step: say what you are about to show, show it, then say what it means.\n"
    "- Point at the board in words: \"look at this term\", \"notice the right angle here\", "
    "\"this is the step most students skip\".\n"
    "- Define every term the first time you use it. One idea per sentence. Plain words over jargon.\n"
    "- In the worked example, say each step and WHY it is allowed; read every number out loud.\n"
    "- Occasionally ask the learner to think (\"pause and try the next step\") — then answer.\n"
    "- No hype, no slogans, no 'game-changer'. Encouraging, never condescending.\n"
    "- Every formula, number and fact must be correct; when unsure, say less rather than guess.\n"
)


# ─────────────────────────────────────────────────────────────────────────────
# Geometry
# ─────────────────────────────────────────────────────────────────────────────

def teacher_box(layout: str, width: int, height: int) -> Optional[Dict[str, int]]:
    """The frame region the teacher overlay occupies (x, y, w, h), or None."""
    if layout not in TEACHER_LAYOUTS:
        return None
    portrait = height > width
    if layout == "corner":
        if portrait:
            w, h = _even(width * 0.36), _even(height * 0.22)
        else:
            w, h = _even(width * 0.22), _even(height * 0.42)
        return {"x": width - w - _even(width * 0.012), "y": height - h, "w": w, "h": h}
    if layout == "bubble":
        d = _even(width * 0.30) if portrait else _even(height * 0.25)
        m = _even(min(width, height) * 0.04)
        return {"x": width - d - m, "y": height - d - m, "w": d, "h": d}
    if portrait:
        frac = 0.26 if layout == "side" else 0.38
        h = _even(height * frac)
        return {"x": 0, "y": height - h, "w": width, "h": h}
    frac = 0.25 if layout == "side" else 0.36
    w = _even(width * frac)
    return {"x": width - w, "y": 0, "w": w, "h": height}


def clip_size(layout: str, width: int, height: int) -> Optional[Tuple[int, int]]:
    """Pixel size of the teacher video inside its box."""
    box = teacher_box(layout, width, height)
    if box is None:
        return None
    bw, bh = box["w"], box["h"]
    if layout in OVERLAY_LAYOUTS:
        return bw, bh
    if width > height:
        # Landscape panel: head-and-shoulders bust standing at the bottom,
        # with head room above it for the name card.
        cw = bw
        ratio = 4 / 3 if layout == "side" else 1.22
        ch = _even(min(bh * 0.78, cw * ratio))
        return cw, ch
    # Portrait bands: teacher fills the band height.
    ch = bh
    cw = _even(min(bw, ch * 0.75))
    return cw, ch


def safe_area_text(layout: str, width: int, height: int) -> str:
    box = teacher_box(layout, width, height)
    if box is None:
        return ""
    x0, y0 = box["x"], box["y"]
    if layout in OVERLAY_LAYOUTS:
        mx, my = x0 - 24, y0 - 24
        return (f"the bottom-right corner — every pixel with x ≥ {mx}px AND y ≥ {my}px "
                f"(a {width - mx}×{height - my}px box)")
    if height > width:
        return f"the bottom band — every pixel with y ≥ {y0 - 16}px"
    return f"the right part of the frame — every pixel with x ≥ {x0 - 16}px"


def caption_band(layout: str, width: int, height: int) -> Dict[str, int]:
    """The caption band (frame coords): under the board, beside a landscape
    teacher panel, above a portrait teacher band."""
    portrait = height > width
    bh = _even(height * (CAPTION_BAND_FRAC_PORTRAIT if portrait else CAPTION_BAND_FRAC))
    box = teacher_box(layout, width, height)
    if box and layout not in OVERLAY_LAYOUTS:
        if portrait:
            return {"x": 0, "y": box["y"] - bh, "w": width, "h": bh}
        return {"x": 0, "y": height - bh, "w": box["x"], "h": bh}
    return {"x": 0, "y": height - bh, "w": width, "h": bh}


def board_area(layout: str, width: int, height: int) -> Dict[str, int]:
    """The shot's canvas: above the caption band, beside any teacher panel."""
    band = caption_band(layout, width, height)
    box = teacher_box(layout, width, height)
    if box and layout not in OVERLAY_LAYOUTS and width > height:
        return {"x": 0, "y": 0, "w": box["x"], "h": band["y"]}
    return {"x": 0, "y": 0, "w": width, "h": band["y"]}


# ─────────────────────────────────────────────────────────────────────────────
# Per-shot HTML prompt block
# ─────────────────────────────────────────────────────────────────────────────

def shot_prompt_block(plan: Dict[str, Any], layout: Optional[str], width: int, height: int) -> str:
    layout = layout if layout in LAYOUTS else "board"
    lines = [
        "\n\n## 🧑‍🏫 LESSON BOARD — this shot is one section of a taught lesson",
        "- The frame is a TEACHING BOARD: clean, calm, high-contrast, generous spacing. No decorative "
        "clutter, no stock-photo backgrounds behind text, no marketing styling.",
        "- BUILD UP, don't replace: reveal each element exactly when the narration reaches it "
        "(use the word timings) and KEEP earlier elements visible — dim them (opacity ~0.45) rather than "
        "removing them, and highlight the element currently being explained (accent colour, underline, "
        "circle, arrow).",
        "- Maths / science: typeset formulas with KaTeX; show a derivation as aligned lines, one new line "
        "per narrated step; label diagram parts; units on every quantity.",
        "- Powers are SUPERSCRIPTS: write `a^2` in KaTeX or `a<sup>2</sup>`. NEVER use Unicode subscript "
        "digits (₀₁₂₃…) for a power — `c₂` reads as \"c sub two\", not \"c squared\".",
        "- Every formula, number and label must be correct and match the narration exactly.",
        "- Text sizes for a learner: headings ≥ 52px, body ≥ 34px, formulas ≥ 44px "
        "(on 1920×1080; scale proportionally on other canvases).",
    ]
    if plan.get("subject"):
        lines.append(f"- Subject: {plan['subject']} — use its standard notation, symbols and units.")
    eff = layout if (has_teacher(plan) and layout in TEACHER_LAYOUTS) else "board"
    area = board_area(eff, width, height)
    lines.append(
        f"- **This shot's canvas is {area['w']}×{area['h']}px, not {width}×{height}.** `#shot-root` is exactly "
        "the board; the caption band" + (" and the teacher panel are" if eff in BOARD_RESIZED_LAYOUTS else " is")
        + f" added outside it. Lay everything out for {area['w']}×{area['h']} (percent / flex / grid; no "
        "fixed positions beyond it; nothing pinned to the bottom edge that needs to be read)."
    )
    if layout in TEACHER_LAYOUTS and has_teacher(plan):
        lines += [
            "",
            f"**TEACHER SAFE AREA — layout `{layout}`**: a live teacher video is composited ON TOP of "
            f"{safe_area_text(layout, width, height)}. Anything you place there will be hidden behind the teacher.",
        ]
        lines += [
            f"- Put ALL board content inside x ∈ [0, {area['w']}]px, y ∈ [0, {area['h']}]px"
            + (" and outside the bottom-right corner box." if layout in OVERLAY_LAYOUTS else "."),
            "- Keep the background in the teacher area plain (the same board background) — no text, "
            "images, diagrams or animated elements there.",
            "- Do NOT draw a person, avatar, face or presenter yourself — the real teacher is added later.",
        ]
        if layout == "presenter":
            lines.append(
                "- `presenter` sections are about the teacher speaking: show only a short title and at most "
                "one key line / formula on the board half."
            )
    return "\n".join(lines) + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# Board correctness: deterministic notation lint + the maths/facts check prompt
# ─────────────────────────────────────────────────────────────────────────────

_SUBSCRIPT_DIGITS = re.compile(r"[\u2080-\u2089]")
_POWER_WORDS = re.compile(r"\b(squared|cubed|to the power|power of|exponent)\b", re.IGNORECASE)
_SCRIPT_BLOCK = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG = re.compile(r"<[^>]+>")
_KATEX_CALL = re.compile(r"katex\.render\(\s*([\"'`])((?:\\.|(?!\1).)*)\1", re.DOTALL)
_TEX_DELIM = re.compile(r"\\\((.+?)\\\)|\$\$(.+?)\$\$", re.DOTALL)


def board_text(html_str: str) -> str:
    """What a learner can read on the board: visible text plus KaTeX sources
    (formulas often live only inside katex.render(...) calls)."""
    src = html_str or ""
    tex = [m.group(2) for m in _KATEX_CALL.finditer(src)]
    visible = _SCRIPT_BLOCK.sub(" ", src)
    tex += [a or b for a, b in _TEX_DELIM.findall(visible)]
    visible = _html.unescape(_TAG.sub(" ", visible))
    out = re.sub(r"\s+", " ", visible).strip()
    if tex:
        out += " || FORMULAS: " + " ; ".join(t.strip() for t in tex if t.strip())
    return out[:4000]


def notation_issues(html_str: str, narration: str) -> List[str]:
    """Definite notation mistakes we can see without a model."""
    issues: List[str] = []
    text = board_text(html_str)
    subs = sorted(set(_SUBSCRIPT_DIGITS.findall(text)))
    if subs and _POWER_WORDS.search(narration or ""):
        issues.append(
            "The board writes powers with Unicode SUBSCRIPT digits (" + "".join(subs) + ", e.g. \"c₂\") while "
            "the narration says squared/cubed — that reads as a subscript. Write powers as superscripts "
            "(KaTeX `c^2` or `c<sup>2</sup>`)."
        )
    return issues


FACT_CHECK_SYSTEM = (
    "You check one section of a taught lesson for DEFINITE errors before it is shown to learners. "
    "You get the narration (what the teacher says) and the text/formulas visible on the board. "
    "Report ONLY definite mistakes: wrong arithmetic, a wrong formula or law, wrong notation for what is "
    "said (e.g. a subscript where the teacher says 'squared'), numbers/units that contradict the "
    "narration, or a false fact. Ignore style, wording, layout, missing detail and anything you are "
    "unsure about. Names are not errors: words in the KNOWN PROPER NOUNS list (the institute or brand, "
    "the teacher, exams and acronyms the user wrote) are correct exactly as written — never report "
    "them as garbled, misspelt or wrong, and never 'fix' them into other words. Respond with ONE JSON object: "
    '{"errors": [{"board": "<the wrong text as shown>", "problem": "<why it is wrong>", "fix": "<correct text>"}]} '
    '— use {"errors": []} when the section is correct.'
)

# ALL-CAPS words in a user's prompt that are instructions, not names.
_CAPS_STOPWORDS = frozenset({
    "A", "I", "AN", "AND", "OR", "THE", "OF", "TO", "IN", "ON", "FOR", "IS", "IT", "BE", "AS", "AT",
    "BY", "WITH", "NOT", "NO", "DO", "DONT", "MUST", "SHOULD", "NEVER", "ALWAYS", "ONLY", "ALL", "ANY",
    "IMPORTANT", "NOTE", "NOTES", "WARNING", "VISUAL", "APPROACH", "VIDEO", "LESSON", "SCRIPT",
    "SECTION", "CHAPTER", "TOPIC", "STEP", "STEPS", "PART", "END", "START", "TITLE", "INTRO", "OUTRO",
    "YES", "OK", "PLEASE", "NEW", "USE", "MAKE", "SHOW", "ADD", "KEEP", "AVOID", "HTML", "JSON",
})
_CAPS_TOKEN = re.compile(r"(?<![A-Za-z0-9])([A-Z][A-Z0-9&.\-]*[A-Z0-9]|[A-Z]{2,})(?![a-z])")
_BRAND_NAME_KEYS = ("name", "brand_name", "institute_name", "organization", "organisation",
                    "title", "text", "logo_text", "heading")
_MAX_PROPER_NOUNS = 30


def _caps_tokens(text: str) -> List[str]:
    """ALL-CAPS name-like tokens (ITRC, JEE). Never tokens with digits — those
    are formulas / notation (CO2, H2SO4), exactly what the checker must still
    correct — and nothing from a prompt written mostly in capitals (there the
    caps are just shouted words: PHOTOSYNTHESIS, CLASS)."""
    words = re.findall(r"[A-Za-z]{2,}", text or "")
    if len(words) >= 4 and sum(1 for w in words if w.isupper()) * 2 > len(words):
        return []
    out: List[str] = []
    for m in _CAPS_TOKEN.finditer(text or ""):
        tok = m.group(1).strip(".-")
        letters = re.sub(r"[^A-Z]", "", tok)
        if len(letters) < 2 or tok in _CAPS_STOPWORDS or re.search(r"\d", tok):
            continue
        out.append(tok)
    return out


def _branding_names(branding: Any) -> List[str]:
    """Short visible strings of the ENABLED intro/outro/watermark sections:
    the institute / brand name lives there (text fields or the html)."""
    names: List[str] = []
    if not isinstance(branding, dict):
        return names
    for section in branding.values():
        if not isinstance(section, dict) or not section.get("enabled", False):
            continue
        for key in _BRAND_NAME_KEYS:
            val = section.get(key)
            if isinstance(val, str) and 0 < len(val.strip()) <= 60:
                names.append(val.strip())
        markup = section.get("html")
        if isinstance(markup, str) and markup:
            visible = _SCRIPT_BLOCK.sub(" ", markup)
            for chunk in _TAG.split(visible):
                chunk = re.sub(r"\s+", " ", _html.unescape(chunk)).strip()
                # A name, not a sentence: at most 4 words.
                if chunk and len(chunk) <= 40 and len(chunk.split()) <= 4:
                    names.append(chunk)
    return names


def known_proper_nouns(
    *,
    prompt: Optional[str] = None,
    branding: Any = None,
    brand_system_prompt: Optional[str] = None,
    teacher: Optional[Dict[str, Any]] = None,
    extra: Optional[Iterable[str]] = None,
) -> List[str]:
    """Names the board may legitimately show that a fact-checker could mistake
    for typos ("ITRC" read as a garbled "CHAPTER"): the institute / brand name
    from the run's branding, the teacher's name, ALL-CAPS tokens of the user's
    prompt and the brand direction, plus `extra`. Order-preserving, de-duped
    (case-insensitive), capped."""
    cands: List[str] = []
    cands += [str(x).strip() for x in (extra or []) if str(x or "").strip()]
    cands += _branding_names(branding)
    if isinstance(teacher, dict):
        tname = str(teacher.get("name") or "").strip()
        if tname:
            cands.append(tname)
    cands += _caps_tokens(prompt or "")
    cands += _caps_tokens(brand_system_prompt or "")
    out: List[str] = []
    seen = set()
    for c in cands:
        c = c.strip()[:60]
        key = c.lower()
        if not c or key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= _MAX_PROPER_NOUNS:
            break
    return out


def fact_check_user_prompt(
    *,
    narration: str,
    board: str,
    subject: Optional[str],
    proper_nouns: Optional[Iterable[str]] = None,
) -> str:
    nouns = [str(n).strip() for n in (proper_nouns or []) if str(n or "").strip()]
    return (
        (f"SUBJECT: {subject}\n" if subject else "")
        + (
            "KNOWN PROPER NOUNS (correct as written — never report or change them): "
            + ", ".join(nouns) + "\n"
            if nouns else ""
        )
        + f"NARRATION:\n{(narration or '').strip()[:2500]}\n\nBOARD:\n{board}"
    )


_NAME_PROBLEM = re.compile(r"garbl|spel|typo|gibberish|nonsens|acronym|abbreviat", re.I)


def _touches_proper_noun(board: str, fix: str, nouns: List[str], problem: str = "") -> bool:
    """True when the checker wants to 'correct' a known name itself: the
    flagged board text contains the name, the fix drops it, AND either the
    flagged text is (almost) only the name or the stated problem is about
    spelling / a garbled word. A real error in a longer line that merely
    mentions the name ("ITRC: 2 + 2 = 5" → "2 + 2 = 4") is kept."""
    b, f = board.lower(), fix.lower()
    for n in nouns:
        k = n.lower()
        pat = r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])"
        if not k or not re.search(pat, b) or k in f:
            continue
        rest = re.findall(r"[a-z0-9]+", re.sub(pat, " ", b))
        if not rest or _NAME_PROBLEM.search(problem or ""):
            return True
    return False


def parse_fact_check(data: Any, proper_nouns: Optional[Iterable[str]] = None) -> List[str]:
    """Normalise the checker's JSON into human-readable issue lines. Errors
    that would rewrite a known proper noun are dropped (belt and braces for
    the prompt rule)."""
    nouns = [str(n).strip() for n in (proper_nouns or []) if str(n or "").strip()]
    errs = (data or {}).get("errors") if isinstance(data, dict) else None
    out: List[str] = []
    for e in errs or []:
        if not isinstance(e, dict):
            continue
        board = str(e.get("board") or "").strip()[:160]
        problem = str(e.get("problem") or "").strip()[:240]
        fix = str(e.get("fix") or "").strip()[:160]
        if nouns and board and _touches_proper_noun(board, fix, nouns, problem):
            continue
        if board or problem:
            out.append(f'"{board}" — {problem}' + (f' → write: "{fix}"' if fix else ""))
    return out[:6]


def correction_prompt(issues: List[str], proper_nouns: Optional[Iterable[str]] = None) -> str:
    nouns = [str(n).strip() for n in (proper_nouns or []) if str(n or "").strip()]
    return (
        "The board in your previous shot HTML has DEFINITE errors a learner would copy down:\n"
        + "\n".join(f"  - {i}" for i in issues)
        + "\n\nFix exactly these errors (correct text, numbers and notation; powers as superscripts via "
        "KaTeX). Keep the layout, shot_pack tokens, animation_strategy and narration sync unchanged. "
        + (
            "Keep these proper nouns exactly as written: " + ", ".join(nouns) + ". "
            if nouns else ""
        )
        + "Return only the JSON shot object."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Timeline: group sections into teacher runs, build overlay entries
# ─────────────────────────────────────────────────────────────────────────────

_SHOT_ID = re.compile(r"^shot-(\d+)(?:-sub\d+)?$")


def shot_index_of(entry: Dict[str, Any]) -> Optional[int]:
    m = _SHOT_ID.match(str(entry.get("id") or ""))
    if m:
        return int(m.group(1))
    idx = entry.get("shot_idx")
    return int(idx) if isinstance(idx, int) else None


def teacher_runs(
    entries: Iterable[Dict[str, Any]],
    layout_by_shot: Dict[int, str],
    *,
    join_gap_s: float = 0.25,
) -> List[Dict[str, Any]]:
    """Contiguous stretches of the timeline that share one teacher layout.

    `entries` are timeline entries (absolute inTime/exitTime). Shots without a
    teacher layout (or "board") break a run. Overlay entries that share a
    shot's time are folded into that shot's run."""
    spans: List[Tuple[float, float, str]] = []
    for e in entries:
        si = shot_index_of(e)
        if si is None:
            continue
        lay = layout_by_shot.get(si) or "board"
        try:
            t0, t1 = float(e.get("inTime", 0.0)), float(e.get("exitTime", 0.0))
        except (TypeError, ValueError):
            continue
        if t1 <= t0:
            continue
        spans.append((t0, t1, lay))
    spans.sort(key=lambda s: (s[0], s[1]))

    runs: List[Dict[str, Any]] = []
    for t0, t1, lay in spans:
        if runs and t0 <= runs[-1]["end"] - 1e-6 and runs[-1]["layout"] != lay:
            # Overlapping entry (overlay / sub-shot) with a different layout —
            # the earlier, primary section wins the overlap.
            if t1 > runs[-1]["end"]:
                t0 = runs[-1]["end"]
            else:
                continue
        if runs and runs[-1]["layout"] == lay and t0 <= runs[-1]["end"] + join_gap_s:
            runs[-1]["end"] = max(runs[-1]["end"], t1)
            continue
        runs.append({"layout": lay, "start": t0, "end": t1})
    return [r for r in runs if r["layout"] in TEACHER_LAYOUTS and r["end"] - r["start"] >= 0.2]


def panel_colors(palette: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Panel background / text colours derived from the run's board palette."""
    bg = _hex((palette or {}).get("background")) or "#FBFAF6"
    text = _hex((palette or {}).get("text")) or "#1F2A44"
    muted = _hex((palette or {}).get("text_secondary")) or "#6B7280"
    accent = _hex((palette or {}).get("accent")) or _hex((palette or {}).get("primary")) or "#E8833A"
    return {
        "panel": _mix(bg, text, 0.06),
        "border": _mix(bg, text, 0.14),
        "text": text,
        "muted": muted,
        "accent": accent,
    }


def teacher_entry_html(
    *,
    layout: str,
    clip_url: str,
    width: int,
    height: int,
    teacher: Optional[Dict[str, Any]],
    palette: Optional[Dict[str, Any]] = None,
) -> str:
    box = teacher_box(layout, width, height)
    size = clip_size(layout, width, height)
    if box is None or size is None:
        return ""
    cw, ch = size
    colors = panel_colors(palette)
    url = _html.escape(clip_url, quote=True)
    name = _html.escape(str((teacher or {}).get("name") or ""))
    title = _html.escape(str((teacher or {}).get("title") or ""))
    font = "font-family:Inter,'Segoe UI',system-ui,-apple-system,sans-serif;"
    video = (
        f'<video class="lesson-teacher" src="{url}" autoplay muted playsinline preload="auto" '
        f'style="position:absolute;width:{cw}px;height:{ch}px;object-fit:fill;'
        + ("right:0;bottom:0;" if layout == "corner" else
           f"left:{(box['w'] - cw) // 2 if box['h'] >= box['w'] or layout == 'presenter' else box['w'] - cw}px;bottom:0;")
        + '"></video>'
    )
    if layout == "bubble":
        ring = max(3, _even(box["w"] * 0.016))
        label = ""
        if name:
            label = (
                f'<div style="position:absolute;left:50%;transform:translateX(-50%);bottom:{_even(box["h"] * 0.04)}px;'
                f'padding:3px 12px;border-radius:999px;background:{colors["panel"]};color:{colors["text"]};{font}'
                f'font-size:{max(12, int(height * 0.014))}px;font-weight:600;white-space:nowrap;">{name}</div>'
            )
        return (
            f'<div style="position:absolute;inset:0;pointer-events:none;">'
            f'<div style="position:absolute;inset:0;border-radius:50%;overflow:hidden;box-sizing:border-box;'
            f'background:{colors["panel"]};border:{ring}px solid {colors["accent"]};">'
            f'<video class="lesson-teacher" src="{url}" autoplay muted playsinline preload="auto" '
            f'style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;"></video>'
            f'</div>{label}</div>'
        )
    if layout == "corner":
        label = ""
        if name:
            label = (
                f'<div style="position:absolute;left:0;bottom:{_even(box["h"] * 0.06)}px;padding:6px 14px;'
                f'border-radius:999px;background:{colors["panel"]};border:1px solid {colors["border"]};'
                f'color:{colors["text"]};{font}'
                f'font-size:{max(14, int(height * 0.017))}px;font-weight:600;'
                f'box-shadow:0 4px 14px rgba(0,0,0,.12);">{name}</div>'
            )
        return f'<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;">{video}{label}</div>'

    portrait = height > width
    edge = "border-top" if portrait else "border-left"
    label = ""
    if name or title:
        fs = max(18, int(min(width, height) * 0.028))
        label = (
            f'<div style="position:absolute;left:{_even(box["w"] * 0.06)}px;top:{_even(box["h"] * 0.05)}px;'
            f'right:{_even(box["w"] * 0.06)}px;{font}">'
            + (f'<div style="font-size:{fs}px;font-weight:700;color:{colors["text"]};line-height:1.2;">{name}</div>' if name else "")
            + (f'<div style="margin-top:6px;font-size:{int(fs * 0.68)}px;color:{colors["muted"]};">{title}</div>' if title else "")
            + f'<div style="margin-top:12px;width:56px;height:5px;border-radius:3px;background:{colors["accent"]};"></div>'
            + "</div>"
        )
    return (
        f'<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;'
        f'background:{colors["panel"]};{edge}:1px solid {colors["border"]};">{label}{video}</div>'
    )


def build_teacher_entries(
    runs: List[Dict[str, Any]],
    clip_urls: List[Optional[str]],
    *,
    width: int,
    height: int,
    teacher: Optional[Dict[str, Any]],
    palette: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for k, (run, url) in enumerate(zip(runs, clip_urls)):
        if not url:
            continue
        box = teacher_box(run["layout"], width, height)
        html_str = teacher_entry_html(
            layout=run["layout"], clip_url=url, width=width, height=height,
            teacher=teacher, palette=palette,
        )
        if not box or not html_str:
            continue
        out.append({
            "id": f"{TEACHER_ENTRY_PREFIX}{k}",
            "inTime": round(float(run["start"]), 3),
            "exitTime": round(float(run["end"]), 3),
            "htmlStartX": box["x"],
            "htmlStartY": box["y"],
            "htmlEndX": box["x"] + box["w"],
            "htmlEndY": box["y"] + box["h"],
            "html": html_str,
            "z": TEACHER_Z,
            "entry_meta": {
                "kind": "lesson_teacher",
                "layout": run["layout"],
                "caption_box": caption_box(run["layout"], width, height),
            },
        })
    return out


def keep_out_zones(
    plan: Optional[Dict[str, Any]],
    layout: Optional[str],
    width: int,
    height: int,
    *,
    canvas_w: int,
    canvas_h: int,
) -> List[Dict[str, Any]]:
    """Rects (shot-canvas coords) a lesson shot must leave empty, for the bbox
    lint: the corner / bubble teacher where it overlaps the board. (Captions
    need no zone — the canvas ends above the caption band.)"""
    if not plan or not has_teacher(plan) or layout not in OVERLAY_LAYOUTS:
        return []
    box = teacher_box(layout, width, height)
    if not box or box["y"] - 16 >= canvas_h:
        return []
    m = 16
    return [{
        "l": max(0, box["x"] - m), "t": max(0, box["y"] - m),
        "r": canvas_w, "b": canvas_h, "name": "teacher",
    }]


def caption_box(layout: str, width: int, height: int) -> Dict[str, int]:
    """Where burned-in captions are centred: inside the caption band, left of
    a corner / bubble teacher. Read by generate_video.py (entry_meta)."""
    band = caption_band(layout, width, height)
    w = band["w"]
    box = teacher_box(layout, width, height)
    if box and layout in OVERLAY_LAYOUTS:
        w = min(w, box["x"] - _even(width * 0.0125))
    return {"x": band["x"], "w": max(_even(width * 0.3), w), "cy": band["y"] + band["h"] // 2}


def effective_layouts(
    layout_by_shot: Dict[int, str],
    runs: List[Dict[str, Any]],
    clip_urls: List[Optional[str]],
    entries: List[Dict[str, Any]],
) -> Dict[int, str]:
    """Per shot, the layout that will actually be on screen: a teacher layout
    only where its run got a clip, else the board fills the frame."""
    ok = [(float(r["start"]), float(r["end"]), r["layout"]) for r, u in zip(runs, clip_urls) if u]
    out: Dict[int, str] = {}
    for e in entries:
        si = shot_index_of(e)
        if si is None:
            continue
        try:
            mid = (float(e.get("inTime", 0)) + float(e.get("exitTime", 0))) / 2.0
        except (TypeError, ValueError):
            continue
        want = layout_by_shot.get(si) or "board"
        hit = next((lay for s0, s1, lay in ok if s0 - 1e-3 <= mid <= s1 + 1e-3 and lay == want), None)
        out.setdefault(si, hit or "board")
    return out


def fit_shots_to_board(entries: List[Dict[str, Any]], layout_by_shot: Dict[int, str], *, width: int, height: int) -> int:
    """Give every lesson shot entry its board canvas (above the caption band,
    beside a teacher panel). Returns how many entries were resized."""
    n = 0
    for e in entries:
        si = shot_index_of(e)
        if si is None:
            continue
        area = board_area(layout_by_shot.get(si) or "board", width, height)
        e["htmlStartX"], e["htmlStartY"] = area["x"], area["y"]
        e["htmlEndX"], e["htmlEndY"] = area["x"] + area["w"], area["y"] + area["h"]
        n += 1
    return n


def build_band_entries(
    entries: List[Dict[str, Any]],
    layout_by_shot: Dict[int, str],
    *,
    width: int,
    height: int,
    palette: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Caption-band overlay entries, merged across consecutive shots whose band
    has the same geometry. They carry the caption position for the renderer."""
    colors = panel_colors(palette)
    spans: List[Tuple[float, float, str]] = []
    for e in entries:
        si = shot_index_of(e)
        if si is None:
            continue
        try:
            spans.append((float(e["inTime"]), float(e["exitTime"]), layout_by_shot.get(si) or "board"))
        except (KeyError, TypeError, ValueError):
            continue
    spans.sort()
    merged: List[List[Any]] = []
    for t0, t1, lay in spans:
        geo = (caption_band(lay, width, height), caption_box(lay, width, height))
        if merged and merged[-1][3] == geo and t0 <= merged[-1][1] + 0.25:
            merged[-1][1] = max(merged[-1][1], t1)
        else:
            merged.append([t0, t1, lay, geo])
    out: List[Dict[str, Any]] = []
    for k, (t0, t1, lay, (band, cbox)) in enumerate(merged):
        out.append({
            "id": f"{BAND_ENTRY_PREFIX}{k}",
            "inTime": round(t0, 3),
            "exitTime": round(t1, 3),
            "htmlStartX": band["x"], "htmlStartY": band["y"],
            "htmlEndX": band["x"] + band["w"], "htmlEndY": band["y"] + band["h"],
            "html": (f'<div style="position:absolute;inset:0;pointer-events:none;background:{colors["panel"]};'
                     f'border-top:1px solid {colors["border"]};"></div>'),
            "z": BAND_Z,
            "entry_meta": {"kind": "lesson_band", "layout": lay, "caption_box": cbox},
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────

def _even(v: float) -> int:
    n = int(round(v))
    return n - (n % 2)


def _hex(v: Any) -> Optional[str]:
    s = str(v or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", s):
        return s.upper()
    if re.fullmatch(r"#[0-9a-fA-F]{3}", s):
        return "#" + "".join(c * 2 for c in s[1:]).upper()
    return None


def _mix(a: str, b: str, t: float) -> str:
    ra, ga, ba = (int(a[i:i + 2], 16) for i in (1, 3, 5))
    rb, gb, bb = (int(b[i:i + 2], 16) for i in (1, 3, 5))
    m = lambda x, y: max(0, min(255, int(round(x + (y - x) * t))))  # noqa: E731
    return "#{:02X}{:02X}{:02X}".format(m(ra, rb), m(ga, gb), m(ba, bb))
