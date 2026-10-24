"""NarrationWriter — second LLM stage of the v3 AI video pipeline.

Consumes the ShotPlanner output and authors per-shot narration text in a
single coherent LLM call. The model sees the full shot plan as context, so
narration flows naturally from shot to shot (single narrator voice). Each
shot's `narration_brief` + `duration_estimate_s` are honored as constraints.

Contract:
- Input:  a shot plan dict (output of `shot_planner.plan_shots`).
- Output: same shot plan with `shots[i].narration_text` filled in (in place,
  and returned). Shots with `audio_policy="intrinsic_only"` get empty text.
- Word count per shot ≈ 150 wpm × duration_estimate_s.

The LLM call is injected as a `llm_chat` callable matching
`OpenRouterClient.chat(...)` — mirrors the pattern in `shot_planner.py`
and `beat_planner.py` to keep the module free of network deps.

See: docs/ai_content/AI_VIDEO_ARCHITECTURE_CHANGES.md "Pipeline Reorder v3"
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple


DEFAULT_WPM: float = 150.0


class NarrationWriteError(Exception):
    """Unrecoverable failure during narration authoring."""


# ─────────────────────────────────────────────────────────────────────────────
# System prompt
# ─────────────────────────────────────────────────────────────────────────────

NARRATION_WRITER_SYSTEM_PROMPT = (
    "You are the NarrationWriter — the voice of an AI-generated video. The "
    "ShotPlanner has already decided shot structure (types, durations, visual "
    "intent). You receive that plan and write the actual narration sentences "
    "per shot. One coherent voice across all shots — the viewer must hear a "
    "single narrator, not a stitched-together collage.\n\n"

    "**INPUT YOU RECEIVE**:\n"
    "A JSON shot plan with:\n"
    "  - target_duration_s\n"
    "  - brand_voice (optional — tone, capitalization, punctuation conventions)\n"
    "  - shots[]: each carries shot_index, shot_type, intent_role, narration_brief, "
    "audio_policy, duration_estimate_s, and brief visual context\n\n"

    "**YOUR OUTPUT — NON-NEGOTIABLE JSON ENVELOPE**:\n"
    "Respond with EXACTLY one raw JSON object. First character `{`. Last `}`. "
    "No markdown fences, no preamble, no postamble.\n"
    "Shape:\n"
    "  {\n"
    "    \"shots\": [\n"
    "      { \"shot_index\": 0, \"narration_text\": \"...\" },\n"
    "      { \"shot_index\": 1, \"narration_text\": \"\" },\n"
    "      ...\n"
    "    ]\n"
    "  }\n"
    "Every input shot must have a matching output entry — same shot_index, in "
    "the same order.\n\n"

    "**RULES**:\n"
    "1. **WORD COUNT per shot ≈ 150 wpm × duration_estimate_s.** A 4.5s shot "
    "≈ 11 words. A 3.0s shot ≈ 7-8 words. A 5.5s shot ≈ 13-14 words. Stay "
    "within ±15% of the target — TTS will speak it at ~150 wpm and you want "
    "the audio to land inside the shot's allotted time.\n"
    "2. **HONOR narration_brief.** Each shot's brief tells you what it should "
    "say. Don't redirect; expand the brief into actual sentences.\n"
    "3. **audio_policy=intrinsic_only ⇒ narration_text=\"\".** No narration. "
    "Don't try to be helpful and write something — the shot carries its own "
    "audio (source clip speaker, Veo audio, etc.) and master narration is "
    "silenced in that window.\n"
    "4. **Single coherent voice.** Read the full plan before you write. The "
    "viewer hears one narrator: same tone, same capitalization style, same "
    "rhythm across shots. If shot 0 sets up a question, shot 1 doesn't start "
    "from scratch — it continues.\n"
    "5. **Honor brand_voice when provided — especially `tonal_register`.** "
    "`tonal_register` sets the whole emotional register; match it and do NOT "
    "collapse every video into the same upbeat explainer voice:\n"
    "   - `ad` / `hype`: confident, a little cocky; short declaratives; build to a payoff line.\n"
    "   - `explainer`: curious, clear, genuinely excited; lead with the surprising part, never textbook.\n"
    "   - `tutorial`: calm, direct, second-person ('you'); concrete verbs, no hype.\n"
    "   - `documentary` / `story`: hushed, sensory, present-tense; let images breathe; no sales pitch.\n"
    "   - `news`: measured, factual, present-tense urgency; let the facts carry the weight.\n"
    "   Also honor caps_style (`TITLE_ACCENT_ONLY`, `sentence_case`) and punctuation "
    "(`minimal`, `comma_friendly`). If brand_voice is absent, infer the register "
    "from the shots' intent_role and visual context — still don't default to generic upbeat.\n"
    "6. **Hook (shot 0) leads; the close depends on register/intent.** Open with a "
    "compelling first beat — a question, a claim, a cold concrete image. For "
    "teaching/sales registers (`explainer` / `tutorial` / `ad`) close the final shot "
    "with an EARNED call-to-action or confident wrap. For narrative registers "
    "(`documentary` / `story` / `trailer`, or a final shot whose intent_role is not "
    "`cta`) do NOT tack on a CTA — close on a line that lingers. The middle teaches or builds.\n"
    "7. **No filler.** Don't write words just to fill duration. Cut hard. The "
    "ShotPlanner can shrink durations if you write less than expected — that's "
    "fine. Don't pad.\n"
    "8. **No production notes, no shot directions.** Just the words the "
    "narrator says. Don't write `(pause)` or `[upbeat tone]` or `Scene 1:`. "
    "Just the spoken sentences.\n"
    "9. **No SSML, no escape codes.** Plain prose. The TTS pipeline handles "
    "voice control separately.\n"
    "10. **Numbers and acronyms**: write numbers as the narrator says them. "
    "`2026` → `\"twenty twenty-six\"` is wrong; write `\"2026\"` and let the "
    "TTS handle it. Acronyms with periods (`A.I.`) only when you specifically "
    "want them read letter-by-letter; otherwise write the acronym plain.\n"
    "11. **For shots with the same intent_role back-to-back** (e.g. two "
    "explanation shots), DO NOT repeat the same opener (`Now,`, `So,`, "
    "`Next,`). Vary connectives or drop them.\n"
    "12. **BANNED OPENERS — never start the video (or a shot) with these generic "
    "AI tells:** 'Have you ever wondered', 'Imagine a world where', 'In today's "
    "video', 'Did you know', 'Let's dive in', 'Picture this', 'Today we'll learn'. "
    "Open instead with a cold concrete scene, a contradiction/reversal ('They told "
    "you X. They were wrong.'), a single arresting number, an in-medias-res moment, "
    "or a sharp non-rhetorical question.\n"
    "13. **BANNED FILLER & CLICHÉ anywhere in the script:** 'fascinating', "
    "'important to note', 'as we can see', 'it turns out', 'at the end of the day', "
    "'delve', 'unlock', 'journey' (as a metaphor), 'game-changer', 'basically', "
    "'actually', 'in conclusion'. Cut them — say the concrete thing instead. Showing "
    "beats asserting: never tell the viewer something is interesting, make it interesting.\n"
    "14. **Serve the CREATIVE CONCEPT when the plan includes one.** The shot plan may carry a "
    "`creative_concept` (controlling_idea, tonal_register, emotional_arc, visual_metaphor, "
    "signature_device). The whole narration must advance the controlling idea and LAND the emotional "
    "arc; match the tonal_register (it wins over a generic brand tone if they conflict); name or evoke "
    "the visual metaphor in words where natural. Don't restate the concept verbatim — embody it.\n"
    "15. **GROUND EVERY CLAIM in the SOURCE REQUEST (when provided).** The input may carry a "
    "`source_request` — the user's original words. Any number, name, price, date, offer, or quote "
    "in the source that serves a shot's brief must appear VERBATIM in the narration — never round "
    "a statistic, never paraphrase it, never invent one. If the source has no specifics for a "
    "claim, write concrete sensory detail instead of vague hype — 'world-class', 'seamless', "
    "'cutting-edge', 'best-in-class' are BANNED unless attached to a fact from the source.\n"
    "16. **A shot's `real_data` field is a USER-CONFIRMED fact — state it VERBATIM** "
    "in that shot's narration; never round or paraphrase it.\n\n"

    "**HOOK CRAFT — the video's most valuable 4 seconds. Write the hook LAST, after the rest.**\n"
    "Pick ONE technique and execute it fully:\n"
    "  (a) QUANTIFIED CLAIM — a specific number that sounds wrong until explained.\n"
    "  (b) CURIOSITY GAP — name what the viewer will learn, withhold the mechanism "
    "('One habit separates the top 1% of students — and it costs nothing').\n"
    "  (c) DIRECT CALLOUT — name the viewer's exact situation in their own words.\n"
    "  (d) REVERSAL — state the common belief, break it in the same breath.\n"
    "  (e) COLD OPEN — drop into a concrete scene mid-action.\n"
    "The hook MUST open a loop that ONLY the final shot closes — write the pair together and make "
    "the close answer the hook's exact words. The hook line must also land the SAME idea as shot 0's "
    "visual (read its visual_description) — narration and image say one thing, not two.\n\n"

    "**CTA CRAFT (when the close is a CTA):** ONE action only, imperative verb first, name exactly "
    "where to go ('Start your free trial at vacademy.io'), ≤ 8 words. Never stack two asks. For "
    "story/documentary registers close on the image, not an ask.\n"
)


# Ad-copy craft for ad/hype registers — ported from the legacy v2 _draft_script
# product_promo block (automation_pipeline.py) so the v3 NarrationWriter, which
# marketing videos actually use, gets the same discipline. Appended to the
# system prompt by write_narration when the tonal register is ad/hype.
AD_NARRATION_EXTENSION = (
    "\n\n🛍️ AD-COPY MODE (this run's register is ad/hype):\n"
    "This is a product/brand ad, NOT an explainer. Write the narration as ad copy:\n"
    "- 3-act structure across the shots: HOOK (sensory image, ≤6 words) → PROMISE (one "
    "specific product benefit) → CALL (tagline + CTA). All three inside the word budget.\n"
    "- Punchy fragments, not long sentences. 'Snap. Crunch. Smile.' is ad copy. "
    "'Parle-G is a popular biscuit that has been enjoyed for decades' is NOT — that's an "
    "encyclopedia entry.\n"
    "- Use the source request's brand words verbatim — name the product, quote its claims. "
    "Never paraphrase the brand into a generic category ('a snack', 'a platform', 'a service').\n"
    "- BANNED agency boilerplate: 'in today's fast-paced world', 'have you ever wondered', "
    "'let's take your brand on an adventure', 'elevate your business', 'take your brand to "
    "the next level', 'marketing without borders'.\n"
    "- Close on a tagline, not a recap. Last ~5 words = brand + verb "
    "(e.g. 'Parle-G — taste the moment.').\n"
    "- Ad copy is short by definition. Do NOT pad to fill time — leave room for pauses, "
    "brand stings, product reveals.\n"
)


# ─────────────────────────────────────────────────────────────────────────────
# User prompt builder
# ─────────────────────────────────────────────────────────────────────────────

def _shot_summary_for_prompt(shot: Dict[str, Any]) -> Dict[str, Any]:
    """Compact representation of a shot for the user prompt — drop fields the
    NarrationWriter doesn't need to see (image_prompt, transitions, animation
    strategy, etc.) and keep only what shapes narration choice."""
    summary: Dict[str, Any] = {
        "shot_index": shot.get("shot_index"),
        "shot_type": shot.get("shot_type"),
        "intent_role": shot.get("intent_role"),
        "narration_brief": shot.get("narration_brief") or "",
        "audio_policy": shot.get("audio_policy") or "narration_only",
        "duration_estimate_s": shot.get("duration_estimate_s"),
    }
    # Include `role` if present (e.g., product_proof) — affects tone.
    if shot.get("role"):
        summary["role"] = shot["role"]
    # User-confirmed real figure (asset_request gate) — must appear verbatim.
    if shot.get("real_data"):
        summary["real_data"] = str(shot["real_data"])[:300]
    # Visual description helps the narrator describe what's on screen.
    if shot.get("visual_description"):
        summary["visual_description"] = str(shot["visual_description"])[:200]
    elif shot.get("notes"):
        summary["notes"] = str(shot["notes"])[:200]
    return summary


def build_narration_writer_user_prompt(
    *,
    shot_plan: Dict[str, Any],
    target_duration_s: float,
    target_audience: str,
    language: str,
    brand_voice: Optional[Dict[str, Any]] = None,
    continuity_notes: Optional[str] = None,
    wpm_override: Optional[float] = None,
    regen_note: Optional[str] = None,
    source_request: Optional[str] = None,
) -> str:
    """Compose the NarrationWriter user prompt from the ShotPlanner output.

    `wpm_override` (when set) replaces DEFAULT_WPM in the per-shot word budget —
    used by the v3 audio-overrun safety net to rewrite at the empirically
    measured TTS pace × 0.95. `regen_note` (when set) is prepended verbatim
    as an URGENT REVISION block so the LLM understands this is a corrective
    rewrite, not a fresh authoring call.
    """
    shots = shot_plan.get("shots") if isinstance(shot_plan.get("shots"), list) else []
    payload: Dict[str, Any] = {
        "target_duration_s": round(float(target_duration_s), 2),
        "language": language,
        "target_audience": target_audience,
        "shots": [_shot_summary_for_prompt(s) for s in shots if isinstance(s, dict)],
    }
    if brand_voice:
        payload["brand_voice"] = brand_voice
    if continuity_notes:
        payload["continuity_notes"] = str(continuity_notes)[:400]
    _cc = shot_plan.get("creative_concept")
    if isinstance(_cc, dict) and _cc:
        payload["creative_concept"] = _cc
    # The user's original request — the ground truth for every number, name,
    # price, and claim (system-prompt rule 15). Without it the writer can only
    # paraphrase 1-2 sentence briefs and back-fills with generic prose.
    if source_request and str(source_request).strip():
        payload["source_request"] = str(source_request).strip()[:1500]

    effective_wpm = float(wpm_override) if (wpm_override and wpm_override > 0) else DEFAULT_WPM
    expected_words = sum(
        max(0, int(round((float(s.get("duration_estimate_s") or 0.0)) * effective_wpm / 60.0)))
        for s in shots
        if isinstance(s, dict) and (s.get("audio_policy") or "narration_only") != "intrinsic_only"
    )

    lines: List[str] = []
    if regen_note:
        lines += [regen_note.strip(), ""]
    lines += [
        "SHOT PLAN:",
        json.dumps(payload, ensure_ascii=False, indent=2),
        "",
        f"EXPECTED TOTAL WORD COUNT (across all narrated shots): ~{expected_words} words "
        f"({effective_wpm:.0f} wpm × {target_duration_s:.1f}s minus intrinsic shots).",
    ]
    if wpm_override and wpm_override > 0 and abs(effective_wpm - DEFAULT_WPM) > 1.0:
        if effective_wpm > DEFAULT_WPM:
            lines.append(
                f"OVERRIDE: target pacing is {effective_wpm:.0f} wpm (FASTER than the default "
                f"{DEFAULT_WPM:.0f}) — this is a punchy, energetic register. You MAY write "
                f"proportionally MORE words per shot (denser, snappier delivery); keep it tight "
                f"and concrete, no filler."
            )
        else:
            lines.append(
                f"OVERRIDE: target pacing is {effective_wpm:.0f} wpm (SLOWER than the default "
                f"{DEFAULT_WPM:.0f}) — the TTS voice for this run is slower than typical. "
                f"Cut every shot's word count proportionally; keep the meaning, lose the filler."
            )
    lines += [
        "",
        "Author the narration now. Output the JSON object only.",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Parsing
# ─────────────────────────────────────────────────────────────────────────────

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def _strip_fences(text: str) -> str:
    return _JSON_FENCE_RE.sub("", text).strip()


def _find_json_object(text: str) -> Optional[str]:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if ch == "\\":
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _parse_narration_response(text: str) -> Dict[int, str]:
    """Parse the LLM response into {shot_index: narration_text}. Tolerates
    fences and preamble. Returns an empty dict on failure — caller decides
    whether to raise."""
    candidates: List[str] = [text, _strip_fences(text)]
    extracted = _find_json_object(text)
    if extracted:
        candidates.append(extracted)

    for cand in candidates:
        cand = (cand or "").strip()
        if not cand:
            continue
        try:
            data = json.loads(cand)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        shots = data.get("shots")
        if not isinstance(shots, list):
            continue
        out: Dict[int, str] = {}
        for entry in shots:
            if not isinstance(entry, dict):
                continue
            idx_raw = entry.get("shot_index")
            try:
                idx = int(idx_raw)
            except (TypeError, ValueError):
                continue
            txt = entry.get("narration_text")
            if txt is None:
                continue
            out[idx] = str(txt).strip()
        if out:
            return out
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic quality check (converts the prompt's banned lists from a bluff
# into a real gate — mirrors the concept-conformance corrective pattern in
# shot_planner.py). Pure string heuristics; no LLM, no network.
# ─────────────────────────────────────────────────────────────────────────────

_BANNED_OPENER_RE = re.compile(
    r"^\s*[\"'‘’“”]*\s*("
    r"have you ever wondered|imagine a world where|in today'?s video|did you know"
    r"|let'?s dive in|picture this|today we'?ll learn|welcome to|in today'?s fast[- ]paced world"
    r")\b",
    re.IGNORECASE,
)

_BANNED_FILLER_RE = re.compile(
    r"\b("
    r"fascinating|important to note|as we can see|it turns out|at the end of the day"
    r"|delve|game[- ]changer|in conclusion|elevate your business"
    r"|take your (?:brand|business) to the next level|unlock(?:ing)? the (?:power|potential|secrets?)"
    r")\b",
    re.IGNORECASE,
)

# Vague-hype adjectives that rule 15 bans unless attached to a source fact.
_VAGUE_HYPE_RE = re.compile(
    r"\b(world[- ]class|seamless(?:ly)?|cutting[- ]edge|best[- ]in[- ]class|state[- ]of[- ]the[- ]art)\b",
    re.IGNORECASE,
)

# Contrast/tension markers that make a hook feel specific rather than generic.
_HOOK_TENSION_RE = re.compile(
    r"(\d|%|\b(but|wrong|never|stop|not|no one|nobody|every|only|until|except|lost|missed?|slip)\b|\?)",
    re.IGNORECASE,
)

_CTA_VERB_RE = re.compile(
    r"\b(start|get|try|join|visit|book|enroll|enrol|download|see|discover|claim|grab|sign|call|talk|switch|build|launch)\b",
    re.IGNORECASE,
)


def check_narration_quality(
    shots: List[Dict[str, Any]],
    *,
    register: Optional[str] = None,
    wpm: float = DEFAULT_WPM,
) -> List[str]:
    """Scan drafted narration for deterministic quality violations.

    Returns human-readable issue strings (empty list = clean). Checks:
    banned openers / filler / vague hype, consecutive shots opening with the
    same word, per-shot word counts wildly off the duration budget, a hook
    with no tension marker (digit/contrast/question), and — for ad/hype —
    a close with no imperative verb.
    """
    issues: List[str] = []
    narrated = [
        s for s in shots
        if isinstance(s, dict)
        and (s.get("audio_policy") or "narration_only") != "intrinsic_only"
        and str(s.get("narration_text") or "").strip()
    ]
    if not narrated:
        return issues

    prev_first_word: Optional[str] = None
    for s in narrated:
        idx = s.get("shot_index")
        text = str(s.get("narration_text") or "").strip()

        m = _BANNED_OPENER_RE.match(text)
        if m:
            issues.append(f"shot {idx}: opens with banned generic opener '{m.group(1)}'")
        for m in _BANNED_FILLER_RE.finditer(text):
            issues.append(f"shot {idx}: banned filler/cliché '{m.group(1)}'")
        for m in _VAGUE_HYPE_RE.finditer(text):
            # Vague hype is allowed only when a digit (a fact) sits in the same shot.
            if not re.search(r"\d", text):
                issues.append(
                    f"shot {idx}: vague hype '{m.group(1)}' with no concrete fact in the shot"
                )

        first_word = re.sub(r"[^\w']", "", text.split()[0]).lower() if text.split() else ""
        if first_word and first_word == prev_first_word:
            issues.append(
                f"shot {idx}: starts with the same word ('{first_word}') as the previous shot"
            )
        prev_first_word = first_word

        dur = float(s.get("duration_estimate_s") or 0.0)
        if dur > 0:
            target = dur * wpm / 60.0
            words = len(text.split())
            if target >= 5 and (words < target * 0.55 or words > target * 1.45):
                issues.append(
                    f"shot {idx}: {words} words vs ~{target:.0f} budget "
                    f"({dur:.1f}s × {wpm:.0f}wpm) — off by >45%"
                )

    hook_text = str(narrated[0].get("narration_text") or "")
    if len(hook_text.split()) >= 4 and not _HOOK_TENSION_RE.search(hook_text):
        issues.append(
            "hook (shot 0): no tension marker — no number, no contrast word, no question; "
            "reads generic"
        )

    if (register or "").strip().lower() in ("ad", "hype"):
        close_text = str(narrated[-1].get("narration_text") or "")
        if not _CTA_VERB_RE.search(close_text):
            issues.append(
                "close (ad register): final shot has no imperative/action verb — "
                "ad copy must end on tagline/CTA energy"
            )

    return issues


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------------
# Author-supplied VO
# ---------------------------------------------------------------------------
# Briefs for factual subjects often ship the narration already written —
# "VO: ..." under each shot, plus rules like "keep every named test exactly as
# named". Paraphrasing that is not a style choice, it is a correctness bug: a
# clinical brief came back with a renamed test (head thrust -> head impulse),
# invented specifics (Ishihara plates, pinprick) and diagnostic qualifiers the
# author had explicitly ruled out, while required terms (PEARL, pterygoids)
# were dropped. When the author wrote the lines, speak the author's lines.

# A quoted VO block runs to its closing quote and is routinely hard-wrapped
# across several physical lines; matching a single line silently truncates it
# mid-sentence (which dropped "Record it as PEARL" from a brief that required
# the term). Prefer the quoted form, and fall back to one-line-per-VO only when
# the brief does not quote at all.
_VO_QUOTED_RE = re.compile(
    r"\bVO[ \t]*:[ \t]*[\"\u201c](.+?)[\"\u201d]", re.IGNORECASE | re.DOTALL
)
_VO_LINE_RE = re.compile(r"^[ \t]*VO[ \t]*:[ \t]*(.+?)[ \t]*$", re.IGNORECASE | re.MULTILINE)
_VO_MIN_CHARS = 20
_VO_MIN_LINES = 3


def extract_authored_vo(source_request: Optional[str]) -> List[str]:
    """Return the VO lines a brief supplies, in order. Empty when it supplies none."""
    if not source_request:
        return []

    def _clean(raw: str) -> str:
        return " ".join(raw.split())

    quoted = [
        _clean(m.group(1)) for m in _VO_QUOTED_RE.finditer(source_request)
    ]
    quoted = [q for q in quoted if len(q) >= _VO_MIN_CHARS]
    if len(quoted) >= _VO_MIN_LINES:
        return quoted

    out: List[str] = []
    for m in _VO_LINE_RE.finditer(source_request):
        line = _clean(m.group(1)).strip('"\u201c\u201d\u2018\u2019')
        if len(line) >= _VO_MIN_CHARS:
            out.append(line)
    return out if len(out) >= _VO_MIN_LINES else []


def apply_authored_vo(shots: List[Dict[str, Any]], authored: List[str]) -> bool:
    """Assign authored VO to the narrating shots, in order.

    Only fires on an exact 1:1 match against the shots that actually speak —
    a mismatch means the plan diverged from the brief's shot list, and
    assigning lines to the wrong shots is worse than paraphrasing them.
    """
    if not authored:
        return False
    narrating = [
        s for s in shots
        if str((s or {}).get("audio_policy") or "").strip().lower() != "intrinsic_only"
    ]
    if len(narrating) != len(authored):
        return False
    for shot, text in zip(narrating, authored):
        shot["narration_text"] = text
    for shot in shots:
        if shot not in narrating:
            shot["narration_text"] = ""
    return True


def write_narration(
    *,
    shot_plan: Dict[str, Any],
    llm_chat: Callable[..., Tuple[str, Dict[str, Any]]],
    model: Optional[str] = None,
    target_duration_s: Optional[float] = None,
    target_audience: str = "General/Adult",
    language: str = "English",
    brand_voice: Optional[Dict[str, Any]] = None,
    brand_system_prompt: Optional[str] = None,
    wpm_override: Optional[float] = None,
    regen_note: Optional[str] = None,
    source_request: Optional[str] = None,
    teaching_voice: bool = False,
    temperature: float = 0.7,
    max_tokens: int = 6000,
) -> Dict[str, Any]:
    """Author per-shot narration text. Mutates the input shot_plan's shots in
    place (writes `narration_text` on each) AND returns a dict with the usage
    + raw response for telemetry.

    Args:
      shot_plan:        the output of `shot_planner.plan_shots` — a dict with
                        a `shots` key. Must be normalized (each shot already
                        has `shot_index`, `audio_policy`, `duration_estimate_s`,
                        `narration_brief`).
      llm_chat:         callable matching OpenRouterClient.chat signature.
      model:            override the default model on the chat call.
      target_duration_s: total target duration (used in the prompt; if omitted,
                        sum of `duration_estimate_s` across shots is used).
      brand_voice:      optional voice guidance (tone, caps_style, punctuation).
      temperature:      LLM sampling temperature; default 0.7 for natural prose.

    Returns:
      {
        "shots":  [<the same shot dicts, with narration_text populated>],
        "usage":  {<llm usage dict>},
        "raw":    "<raw llm response text>",
      }

    Raises:
      NarrationWriteError when the response can't be parsed or covers no shots.
    """
    # An author who supplied the lines gets the lines. This runs before the
    # writer so the LLM is not asked to rewrite prose it must not touch — it
    # also saves the call entirely.
    _authored = extract_authored_vo(source_request)
    if _authored:
        _shots_in = shot_plan.get("shots") or []
        if apply_authored_vo(_shots_in, _authored):
            print(
                f"   \U0001f3a4 Narration: using {len(_authored)} author-supplied VO "
                "line(s) verbatim — writer skipped"
            )
            return {"shots": _shots_in, "usage": {}, "raw": "", "authored_vo": True}
        print(
            f"   \u26a0\ufe0f Narration: brief supplies {len(_authored)} VO line(s) but the plan "
            "has a different number of speaking shots — writing narration normally"
        )

    shots = shot_plan.get("shots") if isinstance(shot_plan.get("shots"), list) else None
    if not shots:
        raise NarrationWriteError("write_narration requires a shot_plan with non-empty shots[]")

    # If every shot is intrinsic_only, skip the LLM call — there's nothing to write.
    narrated_shots = [
        s for s in shots
        if isinstance(s, dict) and (s.get("audio_policy") or "narration_only") != "intrinsic_only"
    ]
    if not narrated_shots:
        for s in shots:
            if isinstance(s, dict):
                s["narration_text"] = ""
        return {"shots": shots, "usage": {}, "raw": ""}

    if target_duration_s is None or target_duration_s <= 0:
        target_duration_s = sum(
            float(s.get("duration_estimate_s") or 0.0)
            for s in shots if isinstance(s, dict)
        )
    if target_duration_s <= 0:
        raise NarrationWriteError("Cannot determine target_duration_s for narration")

    user_prompt = build_narration_writer_user_prompt(
        shot_plan=shot_plan,
        target_duration_s=target_duration_s,
        target_audience=target_audience,
        language=language,
        brand_voice=brand_voice,
        continuity_notes=shot_plan.get("continuity_notes"),
        wpm_override=wpm_override,
        regen_note=regen_note,
        source_request=source_request,
    )
    narration_system = NARRATION_WRITER_SYSTEM_PROMPT
    # Resolve the tonal register (brand_voice wins, then creative_concept) —
    # ad/hype registers get the ported v2 ad-copy craft block.
    _cc_reg = (shot_plan.get("creative_concept") or {}) if isinstance(
        shot_plan.get("creative_concept"), dict) else {}
    register = str(
        (brand_voice or {}).get("tonal_register")
        or _cc_reg.get("tonal_register")
        or ""
    ).strip().lower()
    if register in ("ad", "hype") and not teaching_voice:
        narration_system = narration_system + AD_NARRATION_EXTENSION
    if teaching_voice:
        # Lesson mode: a teacher at a board, not a narrator (lesson_mode.py).
        from lesson_mode import TEACHER_VOICE_BLOCK
        narration_system = narration_system + TEACHER_VOICE_BLOCK
    # Brand direction (kit system_prompt or per-video override) — shapes the
    # narration voice/tone too, not just the visuals. Subordinated to the JSON
    # output contract by the block wrapper.
    if brand_system_prompt:
        try:
            from director_prompts import build_brand_direction_block  # type: ignore
            narration_system = narration_system + build_brand_direction_block(brand_system_prompt)
        except Exception:
            narration_system = narration_system + (
                "\n\n## BRAND DIRECTION (apply throughout; output format still wins)\n"
                + str(brand_system_prompt).strip() + "\n"
            )
    messages = [
        {"role": "system", "content": narration_system},
        {"role": "user", "content": user_prompt},
    ]
    text, usage = llm_chat(
        messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    narration_by_idx = _parse_narration_response(text or "")
    if not narration_by_idx:
        raise NarrationWriteError(
            f"NarrationWriter response unparseable. Head: {(text or '')[:200]!r}"
        )

    def _apply(mapping: Dict[int, str]) -> None:
        """Write narration_text onto shots, honoring the audio_policy contract."""
        for s in shots:
            if not isinstance(s, dict):
                continue
            try:
                idx_int = int(s.get("shot_index"))
            except (TypeError, ValueError):
                continue
            if (s.get("audio_policy") or "narration_only") == "intrinsic_only":
                s["narration_text"] = ""
                continue
            s["narration_text"] = mapping.get(idx_int, "")

    _apply(narration_by_idx)

    # Deterministic quality gate + ONE corrective rewrite. The banned lists in
    # the system prompt used to be unenforced; this converts them into a real
    # gate at the cost of one extra cheap-model call only when the draft fails.
    effective_wpm = float(wpm_override) if (wpm_override and wpm_override > 0) else DEFAULT_WPM
    total_usage: Dict[str, Any] = dict(usage or {})
    try:
        issues = check_narration_quality(shots, register=register, wpm=effective_wpm)
    except Exception:
        issues = []
    if issues:
        print(f"   ✍️ Narration quality gate: {len(issues)} issue(s) — corrective rewrite")
        for _iss in issues[:6]:
            print(f"      - {_iss}")
        corrective = (
            "QUALITY REVIEW FAILED — your draft violates these rules:\n"
            + "\n".join(f"- {i}" for i in issues[:12])
            + "\n\nRewrite the narration fixing EVERY issue above. Keep everything that already "
            "works — change only what the issues name plus whatever each fix forces. Keep the "
            "same shot_index coverage and word budgets. Output the full corrected JSON object only."
        )
        try:
            text2, usage2 = llm_chat(
                messages
                + [
                    {"role": "assistant", "content": (text or "")[:6000]},
                    {"role": "user", "content": corrective},
                ],
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            # Tokens were spent regardless of whether the rewrite is kept —
            # merge usage BEFORE the accept/revert decision.
            for k, v in (usage2 or {}).items():
                if isinstance(v, (int, float)) and isinstance(total_usage.get(k), (int, float)):
                    total_usage[k] = total_usage[k] + v
                elif k not in total_usage:
                    total_usage[k] = v
            revised = _parse_narration_response(text2 or "")
            if revised:
                _apply(revised)
                new_issues = check_narration_quality(shots, register=register, wpm=effective_wpm)
                if len(new_issues) < len(issues):
                    print(
                        f"   ✍️ Corrective rewrite accepted: {len(issues)} → {len(new_issues)} issue(s)"
                    )
                    text = text2
                else:
                    print(
                        f"   ✍️ Corrective rewrite NOT better ({len(issues)} → {len(new_issues)}) — keeping first draft"
                    )
                    _apply(narration_by_idx)
        except Exception as _corr_err:
            print(f"   ⚠️ Corrective rewrite failed ({_corr_err}) — keeping first draft")
            _apply(narration_by_idx)

    # total_tokens is always prompt + completion (the billing contract): a
    # provider that omits it must not hide these tokens from billing.
    try:
        total_usage["total_tokens"] = (
            int(total_usage.get("prompt_tokens", 0) or 0)
            + int(total_usage.get("completion_tokens", 0) or 0)
        )
    except (TypeError, ValueError):
        pass
    return {"shots": shots, "usage": total_usage, "raw": text or ""}


# ─────────────────────────────────────────────────────────────────────────────
# Smoke test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sample_plan = {
        "shots": [
            {
                "shot_index": 0,
                "shot_type": "KINETIC_TITLE",
                "intent_role": "hook",
                "narration_brief": "Hook the viewer with the partnership claim.",
                "audio_policy": "narration_only",
                "duration_estimate_s": 4.5,
            },
            {
                "shot_index": 1,
                "shot_type": "SOURCE_CLIP",
                "intent_role": "moment",
                "narration_brief": "",
                "audio_policy": "intrinsic_only",
                "duration_estimate_s": 3.0,
            },
            {
                "shot_index": 2,
                "shot_type": "PRODUCT_HERO",
                "intent_role": "cta",
                "narration_brief": "Wrap with a confident call-to-action.",
                "audio_policy": "narration_only",
                "duration_estimate_s": 5.0,
            },
        ],
        "continuity_notes": "Brand-confident tone throughout.",
    }

    def fake_llm_chat(messages, **kwargs):
        # Return a mock response that matches the expected shape.
        response = json.dumps(
            {
                "shots": [
                    {
                        "shot_index": 0,
                        "narration_text": "Two leaders. One mission. Industry-ready learning starts here.",
                    },
                    {
                        "shot_index": 1,
                        "narration_text": "",  # intrinsic
                    },
                    {
                        "shot_index": 2,
                        "narration_text": "Vacademy plus Edzumo. Your next hire is on the way.",
                    },
                ]
            }
        )
        return response, {"input_tokens": 1500, "output_tokens": 80}

    result = write_narration(
        shot_plan=sample_plan,
        llm_chat=fake_llm_chat,
        target_duration_s=12.5,
    )
    print(json.dumps(result["shots"], indent=2, ensure_ascii=False))
    assert result["shots"][0]["narration_text"].startswith("Two leaders")
    assert result["shots"][1]["narration_text"] == ""
    assert "Vacademy" in result["shots"][2]["narration_text"]
    print("\nnarration_writer.py smoke test passed.")
