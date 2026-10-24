"""Vision-LLM reviewer for one generated shot.

Sends 1–3 PNG screenshots of a rendered shot to a vision-capable model (the
'vision_review' stage row; the registry's video default when unset) along with the shot's metadata and brand palette, and parses the
model's structured JSON verdict. Returns a normalized record the pipeline
can persist to vision_review_cases and act on (corrective regen, ship, log).

The rubric (SYSTEM_PROMPT) and the per-shot user template are deliberately
frozen as PROMPT_VERSION strings — every change bumps the version so DB
rows stay comparable across time.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# v2 → v3 (2026-05) after the Vacademy×Edzumo audit
# (vid_1778774930857_w8cwa1y). Three rubric changes:
#   1. TEXT_CLIPPED promoted from host-only (section 1c was hidden inside HOST
#      MODE) to a top-level rule that fires for every shot — the audited run had
#      a non-host KINETIC_TITLE shot whose headline ran past the canvas edge and
#      the v2 rubric had no rule to flag it.
#   2. NEW: WHITESPACE_COLLISION (sev 3) — catches "STARTSHERE" / "hands-onpractice"
#      where a color-accent span swallowed the leading space.
#   3. NEW: BG_DISCONTINUITY (sev 2) — fires only when a prior-shot reference
#      screenshot is supplied. Catches the "6 different backgrounds in 8 shots"
#      symptom the audited run had (cream → black → peach within one video).
# Rows in vision_review_cases carry this version so engineers can compare hit
# rates across rubric revisions.
PROMPT_VERSION = "v3"

# Cost per million tokens when the model's price can't be read from the
# `ai_models` registry: the live Isoquant rate for z-ai/glm-5.3-flash, the
# registry's video model. The estimate feeds the per-run review cost cap
# (`vision_review_run_cost_cap_usd`), so pricing GLM calls at the old Gemini
# 2.5 Pro rates ($1.25 / $5) tripped the cap about 10x early.
_DEFAULT_INPUT_COST_PER_M = 0.027   # USD per 1M input tokens (incl. image tokens)
_DEFAULT_OUTPUT_COST_PER_M = 0.49   # USD per 1M output tokens

try:
    from ai_service.app.constants.model_defaults import GLM_DEFAULT as _GLM_DEFAULT
except ImportError:
    try:
        from app.constants.model_defaults import GLM_DEFAULT as _GLM_DEFAULT  # type: ignore
    except ImportError:  # pragma: no cover - no ai_service package (render worker)
        _GLM_DEFAULT = "z-ai/glm-5.3-flash"


def model_cost_per_m(model: Optional[str]) -> tuple:
    """(input, output) USD per 1M tokens for `model` from the `ai_models`
    registry (cached in-process); None means the registry's video default,
    which is GLM. Falls back to the GLM constants above. Never raises."""
    try:
        try:
            from ai_service.app.constants.models import get_model_pricing as _gmp
        except ImportError:
            from app.constants.models import get_model_pricing as _gmp  # type: ignore
        pricing = _gmp(model or _GLM_DEFAULT) or {}
        inp = float(pricing.get("input_token_price") or 0.0) * 1_000_000
        outp = float(pricing.get("output_token_price") or 0.0) * 1_000_000
        if inp or outp:
            return inp, outp
    except Exception:  # noqa: BLE001 - telemetry/cap only; never break a review
        pass
    return _DEFAULT_INPUT_COST_PER_M, _DEFAULT_OUTPUT_COST_PER_M

ISSUE_CODES = frozenset({
    # Generic
    "LEGIBILITY",
    "TEXT_WRAP_BREAK",       # v2 — word splits mid-token, or single word wraps across two lines
    "TEXT_CLIPPED",          # v3 — promoted from host-only: any glyph past the canvas edge
    "WHITESPACE_COLLISION",  # NEW v3 — adjacent words read as one ("STARTSHERE", "hands-onpractice")
    "HIERARCHY",
    "PALETTE",
    "FRAMING",
    "LAYOUT",
    "NO_MOTION",
    "RESIDUAL",
    "IRRELEVANT_MEDIA",
    "SYNC_DRIFT",
    "BG_DISCONTINUITY",      # NEW v3 — bg/treatment differs sharply from prior shot (cross-shot)
    # Host-specific
    "HOST_FACE_COUNT",
    "TEXT_ON_FACE",
    "HOST_LAYOUT_MISMATCH",
    "HOST_IDENTITY_DRIFT",
})


# Persona header is mode-keyed (Phase A7): an educational explainer and a
# premium brand film are judged by the same STRUCTURAL rubric, but the
# persona + taste anchors differ — a reviewer told it's grading a lecture
# slide penalizes exactly the depth/motion the marketing prompt asked for.
_REVIEWER_HEADER_EDU = (
    "You are a strict, conservative video frame reviewer for an AI-generated educational explainer."
)
_REVIEWER_HEADER_MKT = (
    "You are a demanding motion-design director doing quality control on one shot of a premium "
    "BRAND FILM (an Apple/Linear/Stripe-grade launch video). Judge craft to that standard."
)

_REVIEWER_BODY = f"""Reviewer prompt version: {PROMPT_VERSION}.

You will see 1 to 3 screenshots from one shot in the order: early frame, middle frame, exit frame.
Your job is to identify SHIPPING-BLOCKING defects and IGNORE subjective taste calls.

Block the shot ONLY if one or more of the checks below clearly fails. Subjective preferences
("I would have used a different colour", "I'd have made the title bigger") are NEVER blocking.

CHECKLIST (apply in order):

1. LEGIBILITY
   - Every visible text element must be readable at this resolution.
   - Contrast must be sufficient (rough WCAG-AA — 4.5:1 for body text, 3:1 for large headlines).
   - Block (severity 3) if any visible text is illegible (tiny, low-contrast, or visually behind another element).

1b. TEXT_WRAP_BREAK  (DISTINCT from LEGIBILITY — text is readable, but laid out wrong)
   - Inspect every line of every text element CAREFULLY, especially headlines.
   - Block (severity 3, code TEXT_WRAP_BREAK) if ANY of these is true:
       (a) A single word is split across two lines (e.g. "UNDERSTAND-" on line 1, "ING" on line 2 — mid-word break).
       (b) A single short word sits alone on its own line because the line above ran out of room.
       (c) A two-word headline wraps so that one word is on each line when the design clearly intended a single line.
       (d) A line ends with a partial word and the rest is clipped off the canvas edge.
   - This is the most common defect we see in production. Be aggressive about flagging it.
   - Suggestion field MUST give a concrete CSS fix, e.g.:
       "Add max-width:88% and word-break:keep-all to the headline container."
       "Reduce font-size from Xrem to Yrem so the headline fits on one line."
       "Add hyphens:none to prevent the renderer from breaking 'PHOTOSYNTHESIS' across lines."

1c. TEXT_CLIPPED  (canvas-bounds violation — applies to EVERY shot, not just host)
   - A text element is clipped when ANY rendered glyph's bounding box extends
     outside the visible canvas at ANY of the supplied timestamps. Specifically:
       (a) The first character of a word whose left edge is at x<0 (e.g. "T" of
           "THE ULTIMATE" runs past the left edge — the leftmost glyph is cut).
       (b) The last character of a word whose right edge is at x>canvas_w.
       (c) Any character whose top/bottom touches y=0 or y=canvas_h.
   - Do NOT excuse this as "stylistic crop" or "intentional bleed" — for an AI
     explainer pipeline it is a shipping-blocking layout failure. Severity 3.
   - Suggestion field MUST recommend a concrete fix: demote the font tier
     (display → h1 → h2), add `max-width:92%` to the headline container, or
     break the line.

1d. WHITESPACE_COLLISION  (compare rendered text to narration)
   - Two visually-distinct words read as one because the space between them is
     missing or has collapsed. Examples we have seen ship:
       "STARTSHERE" (should be "STARTS HERE")
       "hands-onpractice" (should be "hands-on practice")
   - Compare the rendered text in the screenshot against the NARRATION excerpt
     supplied in the user prompt. If the narration says "STARTS HERE" but the
     screenshot reads "STARTSHERE" as one token, flag (severity 3, code
     WHITESPACE_COLLISION).
   - Suggestion: "Insert &nbsp; before the colored accent span" or "remove
     display:inline-block from the accent word; use a regular span with color
     only" — the underlying CSS bug is adjacent inline-block spans collapsing
     the inter-word whitespace.

2. HIERARCHY
   - The eye should land on the most important element first.
   - The most important word/value should be the largest.
   - Block (severity 3) ONLY if the visual hierarchy actively misleads (e.g. a footnote is bigger than the title).

3. PALETTE COMPLIANCE
   - Compare visible colours against the BRAND PALETTE supplied in the user prompt.
   - Block (severity 2-3) if a non-brand hex appears as a primary or accent colour.
   - Do NOT block if the brand palette appears at lower saturation due to overlays, or for neutrals used for body text or content-color reds/greens.

4. FRAMING
   - If a subject (image hero, product, character) is present, it must not be cropped at a damaging point (eyeline, chin, knees).
   - The most important content must not be cut off the frame.
   - Block (severity 3) if a subject is cropped in a way that breaks readability.

5. LAYOUT INTEGRITY
   - Elements must not visibly collide (text on top of text, image clipping a label, etc.).
   - Flexbox/grid must not have collapsed wrongly at this aspect ratio.
   - Block (severity 3) on visible collision.

6. MOTION PRESENCE
   - Compare early vs middle vs exit frames. Has anything changed?
   - For shots ≥3s: block (severity 2) if all frames are identical (static shot).
   - For shots <3s: motion presence is optional — do not block.

7. RESIDUAL ARTIFACTS (exit frame only)
   - The exit frame should not show a vignette overlay still visible, or a transition tween mid-flight (text 70% slid in).
   - Block (severity 3) if the exit frame is mid-transition.

8. STOCK-MEDIA RELEVANCE
   - If the SHOT TYPE is VIDEO_HERO or IMAGE_HERO, the visible media must plausibly match the visual description.
   - Block (severity 3) if the media is wildly off-topic (e.g. daytime stock photo for a "neon night alleys" shot).
   - Code: IRRELEVANT_MEDIA.

9. SYNC ALIGNMENT
   - For each sync_point time provided in the shot meta, the corresponding screenshot frame
     should show the related visual element entering or active at that moment.
   - Flag (severity 2) if the visual is fully static at the sync timestamp, or if the wrong
     element is animating. Code: SYNC_DRIFT.

10. BG_DISCONTINUITY  (cross-shot — applies ONLY when a PRIOR SHOT REFERENCE is supplied)
   - If the user message contains a "PRIOR SHOT REFERENCE" screenshot BEFORE the current
     shot's screenshots, compare the dominant background hue/treatment.
   - Flag (severity 2, code BG_DISCONTINUITY) if the current shot uses a sharply different
     background treatment than the prior shot — e.g. prior shot was a cream-bg motion-graphics
     composition, current shot is on a pure-black or pure-white background, or vice versa.
   - Two media_hero shots in a row (both VIDEO_HERO with stock footage) are NOT a violation —
     it's expected that stock-footage shots have their own backgrounds.
   - This is severity 2 only, never 3 — single-shot regen can't fix a cross-shot issue.
     Logged so we know the BG drift is occurring; treated as advisory for now.
   - When no PRIOR SHOT REFERENCE is supplied (first shot, or feature off), SKIP this check
     entirely — do not invent a violation.

HOST-SHOT MODE — applies only when host_present=true in the user prompt
   - The shot must contain EXACTLY ONE human face — the on-screen host.
   - Flag (severity 3, code HOST_FACE_COUNT) if you see TWO+ faces (e.g. host plus a stock-photo
     headshot inside an overlay card) or ZERO faces.
   - Flag (severity 3, code TEXT_ON_FACE) if any overlay text intersects the bounding box of the
     host's face/torso (lips, eyes, neck, chest).
   - (TEXT_CLIPPED is covered by section 1c above — applies to host shots and non-host shots alike.)
   - Flag (severity 3, code HOST_LAYOUT_MISMATCH) if host is on the wrong side of the canvas
     for the supplied host_layout (e.g. layout='free_right' means host expected on left half).
   - Flag (severity 2, code HOST_IDENTITY_DRIFT) if the host's apparent age/ethnicity/face structure
     differs noticeably from the supplied reference_face_url.

USER-AUTHORED 'TEXT ONLY' MODE — applies only when user_authored_no_imagery=true
   - Flag (severity 3, code IRRELEVANT_MEDIA) if any image, photograph, or human figure appears.

ISSUE CODES (use ONLY these, exact spelling): LEGIBILITY, TEXT_WRAP_BREAK, TEXT_CLIPPED,
WHITESPACE_COLLISION, HIERARCHY, PALETTE, FRAMING, LAYOUT, NO_MOTION, RESIDUAL,
IRRELEVANT_MEDIA, SYNC_DRIFT, BG_DISCONTINUITY, HOST_FACE_COUNT, TEXT_ON_FACE,
HOST_LAYOUT_MISMATCH, HOST_IDENTITY_DRIFT.

OUTPUT — return ONLY a JSON object, no markdown fences, no commentary:
{{
  "passes": <bool: true if no blocking issues>,
  "issues": [
    {{
      "code": "<one of the codes above>",
      "severity": <1=minor, 2=notable, 3=must-fix>,
      "description": "<one sentence pointing at the specific element>",
      "suggestion": "<one sentence telling the regen LLM exactly how to fix it>"
    }}
  ],
  "severity_max": <0..3 — max severity across issues, 0 if issues=[]>,
  "designer_score": <1..10 — separate from pass/fail: how close is this frame to something a
                     professional motion designer would ship? 9-10 = portfolio-grade craft;
                     7-8 = solid, polished; 5-6 = competent but flat/unremarkable; 3-4 = bare
                     text panel / clip-art feel / no visual interest; 1-2 = broken-looking.
                     Judge composition, depth, imagery, typography confidence, and whether the
                     frame has a focal point. This score NEVER blocks the shot — it is telemetry.>
}}

Rules of engagement:
- ≤4 issues per shot. Pick the most-important.
- Severity 3 is reserved for genuine breakage. Don't issue a 3 for taste.
- `designer_score` is where taste DOES go — be honest there, harsh even; just never convert
  taste into a blocking issue.
- If everything looks fine, return {{"passes": true, "issues": [], "severity_max": 0,
  "designer_score": <still grade it>}}.
"""

# Backward-compat: the educational reviewer prompt under its historical name.
SYSTEM_PROMPT = _REVIEWER_HEADER_EDU + "\n" + _REVIEWER_BODY

_MARKETING_REVIEWER_ADDENDUM = """
MARKETING-MODE JUDGING NOTES (this shot is from a BRAND FILM, not a lecture):
- Rich, layered treatments are INTENTIONAL, not defects: dark backgrounds, gradient meshes,
  brand-tinted vignettes, scrims over photography, glassmorphism, soft large-radius shadows,
  and tints derived from the brand palette (color-mix / rgba of a brand color) are NOT
  palette violations. Flag PALETTE only when a clearly foreign accent hue dominates the frame.
- Pure white/black used for contrast over imagery are neutrals, never violations.
- A CONSTANT, subtle finishing layer (faint film grain, a soft edge vignette, a gentle
  brand-tinted top glow) is part of these videos' design system and appears in EVERY frame
  including the exit frame. NEVER flag it as RESIDUAL or PALETTE. RESIDUAL still applies to
  transition artifacts that are clearly mid-flight (a wipe half-done, a dip-to-black still
  fading, an element frozen mid-slide).
- Anchor designer_score to launch-film craft: a bare text panel with no imagery, icon, or
  depth caps at 4; portfolio-grade composition with a confident focal point earns 9-10.
- Every STRUCTURAL check above (legibility, wrap breaks, clipping, collisions, motion,
  residuals, sync) applies unchanged — premium styling never excuses broken layout.
"""


def build_reviewer_system_prompt(mode: str = "educational") -> str:
    """Reviewer system prompt keyed by the run's resolved visual style mode."""
    m = (mode or "educational").strip().lower()
    if m in ("marketing", "bold"):
        return _REVIEWER_HEADER_MKT + "\n" + _REVIEWER_BODY + _MARKETING_REVIEWER_ADDENDUM
    return SYSTEM_PROMPT


def _build_user_prompt(
    *,
    shot: Dict[str, Any],
    shot_pack: Optional[Dict[str, Any]],
    canvas: str,
    host_meta: Optional[Dict[str, Any]],
    timestamps: List[float],
    palette: Optional[Dict[str, Any]] = None,
    has_prior_shot_reference: bool = False,
) -> str:
    # Brand palette comes from the run's style_guide (hex values), NOT from
    # shot_pack — shot_pack stores CSS var references (`var(--brand-primary)`),
    # which the vision model can't compare visually.
    palette = palette or {}
    font_scale = (shot_pack or {}).get("font_scale") or {}
    sync_points = shot.get("sync_points") or []
    sync_lines = "\n".join(
        f"  - t={float(sp.get('time', 0)):.2f}s — word={sp.get('word', '?')!r} action={sp.get('action', '?')!r}"
        for sp in sync_points[:8]
    ) or "  (none)"
    duration = float(shot.get("duration") or shot.get("end", 0) - shot.get("start", 0) or 0)
    narration = (shot.get("narration") or shot.get("script") or shot.get("narration_excerpt") or "").strip()
    if len(narration) > 600:
        narration = narration[:600] + "…"
    visual_desc = (shot.get("visual_description") or shot.get("visual_direction") or "").strip()
    if len(visual_desc) > 400:
        visual_desc = visual_desc[:400] + "…"

    parts = [
        "SHOT META",
        f"- Shot type: {shot.get('shot_type') or shot.get('type') or 'UNKNOWN'}",
        f"- Canvas: {canvas}",
        f"- Duration: {duration:.2f}s",
        f"- Narration: {narration!r}",
        f"- Director visual direction: {visual_desc!r}",
        f"- Sync points:\n{sync_lines}",
        f"- Screenshot timestamps (shot-relative seconds, in order): {timestamps}",
        "",
        "BRAND PALETTE (these are the dominant non-neutral colours that should appear)",
        f"- primary: {palette.get('primary', '(unset)')}",
        f"- accent:  {palette.get('accent', '(unset)')}",
        f"- text:    {palette.get('text', '(unset)')}",
        f"- bg:      {palette.get('background', '(unset)')}",
        "",
        "FONT SCALE (rem; for legibility reference)",
        f"- display: {font_scale.get('display', '(unset)')}",
        f"- h1:      {font_scale.get('h1', '(unset)')}",
        f"- body:    {font_scale.get('body', '(unset)')}",
    ]

    if host_meta and host_meta.get("host_present"):
        parts += [
            "",
            "HOST META",
            f"- host_present: true",
            f"- host_layout: {host_meta.get('host_layout', '(unset)')}",
            f"- expected_host_position: {host_meta.get('expected_host_position', '(unset)')}",
            f"- expected_overlay_zone:  {host_meta.get('expected_overlay_zone', '(unset)')}",
            f"- expected_face_count:    {host_meta.get('expected_face_count', 1)}",
            f"- reference_face_url:     {host_meta.get('reference_face_url', '(none)')}",
            f"- user_authored_no_imagery: {bool(host_meta.get('user_authored_no_imagery'))}",
        ]
    elif host_meta and host_meta.get("user_authored_no_imagery"):
        parts += [
            "",
            "USER-AUTHORED MODE",
            "- user_authored_no_imagery: true (NO images/photos/people allowed in this frame)",
        ]

    if has_prior_shot_reference:
        parts += [
            "",
            "CROSS-SHOT CONTEXT",
            "- A PRIOR SHOT REFERENCE screenshot will be supplied BEFORE the current-shot screenshots.",
            "- Apply rubric section 10 (BG_DISCONTINUITY) using the prior shot as the reference.",
            "- Do NOT review the prior shot itself — only use it to judge background continuity.",
        ]
    else:
        parts += [
            "",
            "CROSS-SHOT CONTEXT",
            "- No prior-shot reference supplied. SKIP rubric section 10 (BG_DISCONTINUITY).",
        ]

    parts += [
        "",
        "Return JSON only. Screenshots follow.",
    ]
    return "\n".join(parts)


def _parse_review_json(raw: str) -> Optional[Dict[str, Any]]:
    """Forgiving JSON parser — strips markdown fences, finds the outermost JSON object,
    falls back to truncation at the last close brace. Mirrors subject_extractor._parse_subjects_json.
    """
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    obj_start = text.find("{")
    if obj_start < 0:
        return None
    text = text[obj_start:]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        last_close = text.rfind("}")
        if last_close > 0:
            try:
                parsed = json.loads(text[: last_close + 1])
            except json.JSONDecodeError:
                return None
        else:
            return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _normalize_review(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce loose model output into a stable shape. Drops unknown issue codes
    rather than failing — the reviewer will still ship; we just don't act on
    bogus codes downstream."""
    issues_raw = parsed.get("issues") or []
    issues: List[Dict[str, Any]] = []
    sev_max = 0
    if isinstance(issues_raw, list):
        for item in issues_raw[:4]:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or "").strip().upper()
            if code not in ISSUE_CODES:
                logger.debug(f"reviewer returned unknown issue code (dropped): {code!r}")
                continue
            try:
                sev = int(item.get("severity") or 0)
            except (TypeError, ValueError):
                sev = 0
            sev = max(0, min(3, sev))
            sev_max = max(sev_max, sev)
            issues.append({
                "code": code,
                "severity": sev,
                "description": str(item.get("description") or "").strip()[:500],
                "suggestion": str(item.get("suggestion") or "").strip()[:500],
            })
    passes = bool(parsed.get("passes")) and not issues
    # Non-blocking aesthetic grade (1-10). None when the model omitted it —
    # downstream treats None as "not graded", never as a low score.
    designer_score: Optional[int] = None
    try:
        _ds = parsed.get("designer_score")
        if _ds is not None:
            designer_score = max(1, min(10, int(_ds)))
    except (TypeError, ValueError):
        designer_score = None
    return {
        "passes": passes,
        "issues": issues,
        "severity_max": sev_max,
        "designer_score": designer_score,
    }


def _png_to_data_url(png: bytes) -> str:
    return f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"


def review_shot(
    *,
    screenshots: List[bytes],
    shot: Dict[str, Any],
    shot_pack: Optional[Dict[str, Any]],
    canvas: str,
    timestamps: List[float],
    llm_chat: Callable[..., Any],
    host_meta: Optional[Dict[str, Any]] = None,
    palette: Optional[Dict[str, Any]] = None,
    prior_shot_screenshot: Optional[bytes] = None,  # v3 — for BG_DISCONTINUITY
    # V200: model resolution is the caller's responsibility — the pipeline
    # passes the matrix-resolved model_id from `_resolve_stage_model("vision_review")`
    # so admins can tune via the `ai_model_stage_assignments` table. None
    # lets the client pick the registry's video default (the GLM chain).
    model: Optional[str] = None,
    # Pro on OpenRouter consumes tokens on internal reasoning before emitting
    # JSON. 1200 then 2400 were BOTH still occasionally truncated (review came
    # back as cut-off/unparseable JSON → the gate silently no-ops and ships the
    # shot un-reviewed). 6000 gives headroom; output cost at $5/M is ~$0.03 per
    # shot — small on top of the input-token cost which dominates with 3 PNGs.
    max_tokens: int = 6000,
    temperature: float = 0.0,
    # None = the model's registry price (see model_cost_per_m).
    input_cost_per_m: Optional[float] = None,
    output_cost_per_m: Optional[float] = None,
    # Phase A7 — resolved visual style of the run ("educational" | "marketing"
    # | "bold"): swaps the reviewer persona so brand-film shots are judged by
    # a motion-design director, not an educational-slide reviewer.
    visual_style_mode: str = "educational",
) -> Dict[str, Any]:
    """Run the vision review against a single shot. Never raises — every error
    path returns a no-op record so the caller can ship the original HTML.

    Returns a record dict:
      - passes: bool
      - issues: [{code, severity, description, suggestion}]
      - severity_max: int (0..3)
      - review_ms: int
      - cost_usd: float
      - prompt_version: str (frozen)
      - raw: str  (model's raw response — kept for debugging, persisted to DB)
      - model: str
      - error: str | None (set on failure paths; passes will be True so the shot ships)
    """
    if not screenshots:
        return _no_op_record(prompt_version=PROMPT_VERSION, model=model, error="no screenshots")
    if input_cost_per_m is None or output_cost_per_m is None:
        _in_m, _out_m = model_cost_per_m(model)
        input_cost_per_m = _in_m if input_cost_per_m is None else input_cost_per_m
        output_cost_per_m = _out_m if output_cost_per_m is None else output_cost_per_m

    user_text = _build_user_prompt(
        shot=shot,
        shot_pack=shot_pack,
        canvas=canvas,
        host_meta=host_meta,
        timestamps=list(timestamps),
        palette=palette,
        has_prior_shot_reference=bool(prior_shot_screenshot),
    )

    # Build a multimodal user message. When a prior-shot screenshot is supplied,
    # it's inserted FIRST under a "PRIOR SHOT REFERENCE" label so the model can
    # apply the BG_DISCONTINUITY check (rubric section 10) against it. The
    # current shot's screenshots follow, labeled so the model never confuses
    # them with the prior reference.
    user_content: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
    if prior_shot_screenshot:
        user_content.append({
            "type": "text",
            "text": (
                "PRIOR SHOT REFERENCE (use only for BG_DISCONTINUITY check — "
                "do NOT review this shot, do NOT flag any issues on this image):"
            ),
        })
        user_content.append({
            "type": "image_url",
            "image_url": {"url": _png_to_data_url(prior_shot_screenshot)},
        })
        user_content.append({
            "type": "text",
            "text": "CURRENT SHOT (this is the shot to review — screenshots follow):",
        })
    for png in screenshots:
        user_content.append({
            "type": "image_url",
            "image_url": {"url": _png_to_data_url(png)},
        })

    messages = [
        {"role": "system", "content": build_reviewer_system_prompt(visual_style_mode)},
        {"role": "user", "content": user_content},
    ]

    started = time.monotonic()
    try:
        raw, usage = llm_chat(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
    except TypeError:
        # Older clients may not accept response_format kwarg — retry without it.
        try:
            raw, usage = llm_chat(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:
            logger.warning(f"vision review LLM call failed: {exc}")
            return _no_op_record(prompt_version=PROMPT_VERSION, model=model, error=str(exc))
    except Exception as exc:
        logger.warning(f"vision review LLM call failed: {exc}")
        return _no_op_record(prompt_version=PROMPT_VERSION, model=model, error=str(exc))

    review_ms = int((time.monotonic() - started) * 1000)

    parsed = _parse_review_json(raw or "")
    if parsed is None:
        logger.warning(f"vision review returned unparseable JSON; raw[:200]={ (raw or '')[:200]!r}")
        return _no_op_record(
            prompt_version=PROMPT_VERSION,
            model=model,
            error="unparseable JSON",
            raw=raw,
            review_ms=review_ms,
            usage=usage,
            input_cost_per_m=input_cost_per_m,
            output_cost_per_m=output_cost_per_m,
        )

    norm = _normalize_review(parsed)
    cost_usd = _estimate_cost(usage, input_cost_per_m, output_cost_per_m)

    return {
        **norm,
        "review_ms": review_ms,
        "cost_usd": cost_usd,
        "prompt_version": PROMPT_VERSION,
        "model": model,
        "raw": raw,
        "error": None,
    }


def _estimate_cost(usage: Optional[Dict[str, Any]], in_per_m: float, out_per_m: float) -> float:
    if not usage:
        return 0.0
    try:
        prompt = int(usage.get("prompt_tokens") or 0)
        completion = int(usage.get("completion_tokens") or 0)
    except (TypeError, ValueError):
        return 0.0
    cost = (prompt / 1_000_000.0) * in_per_m + (completion / 1_000_000.0) * out_per_m
    return round(cost, 6)


def _no_op_record(
    *,
    prompt_version: str,
    model: Optional[str],
    error: str,
    raw: Optional[str] = None,
    review_ms: int = 0,
    usage: Optional[Dict[str, Any]] = None,
    input_cost_per_m: float = _DEFAULT_INPUT_COST_PER_M,
    output_cost_per_m: float = _DEFAULT_OUTPUT_COST_PER_M,
) -> Dict[str, Any]:
    """Return a 'pass-through' record. The shot ships, no regen fires, no row
    is written by the caller (caller checks `error` → skips persistence)."""
    return {
        "passes": True,
        "issues": [],
        "severity_max": 0,
        "review_ms": review_ms,
        "cost_usd": _estimate_cost(usage, input_cost_per_m, output_cost_per_m),
        "prompt_version": prompt_version,
        "model": model,
        "raw": raw,
        "error": error,
    }
