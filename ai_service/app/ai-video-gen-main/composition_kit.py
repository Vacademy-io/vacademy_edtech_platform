"""Frame composition vocabulary — where things go on the canvas.

WHY THIS MODULE EXISTS
──────────────────────
Craft review (2026-08-20) traced "the layouts all look the same" to an
asymmetry in the per-shot prompt, not to model capability:

  • Concrete, enforceable guidance about TYPE PROPERTIES — line-height per
    tier, letter-spacing per face, weight deltas, descender padding, scrim
    rules — runs to several hundred lines (`_build_text_hierarchy_block`).
  • Concrete guidance about FRAME COMPOSITION — where the subject sits, what
    the type aligns to, where the negative space goes — was two lines of
    adjectives: "hero asymmetry ... off-axis anchors ... avoid centered
    hero+sub on every shot".
  • Meanwhile the workhorse card's exemplar — the single strongest signal in
    the prompt — is `.full-screen-center` → `.layout-hero` → centered h1 +
    centered sub + centered svg.

The model did what the prompt actually asked: it copied the example and
ignored the adjectives. Every shot came out centre-stacked. This module
replaces the adjectives with a named, concrete, per-shot-assigned vocabulary,
mirroring how `background_treatment` already works — planner declares it,
pipeline defaults it, the per-shot prompt enforces it with real code.

Compositions are ASSIGNED, not hoped for. `assign_compositions()` walks the
shot list and enforces variety structurally (no repeat inside a window, hard
cap on centre-stacked shots) because "aim for a distinct composition every
shot" as prose has been in the preamble for months and did not produce one.

The CSS lives here as a plain module string rather than inline in the
pipeline's preamble f-string. That is deliberate: CSS written directly into
that f-string needs every brace doubled, and getting it wrong fails at
generation time with `NameError: name 'position' is not defined` (cost a
debug cycle on 2026-08-20). Interpolated as a value, braces are inert.
"""

from __future__ import annotations

from typing import Any, Dict, List, Sequence

# ─────────────────────────────────────────────────────────────────────────────
# The vocabulary
# ─────────────────────────────────────────────────────────────────────────────
# Each entry carries:
#   css_class — the grid class in COMPOSITION_CSS. Stored, not derived from
#              the name: center_hero maps to .comp-center, full_bleed_overlay
#              to .comp-full-bleed, and deriving it silently mismatched both.
#   blurb    — one line for the ShotPlanner's menu (it picks by name)
#   contract — concrete skeleton injected into that shot's own prompt. This is
#              the part that actually changes output: it competes with the
#              card exemplar on the card exemplar's own terms (real code).
#   air      — where the negative space is meant to end up. Named so the model
#              treats emptiness as a designed element instead of filling it.
#   suits    — shot types this reads well on (advisory; used for defaults)

COMPOSITIONS: Dict[str, Dict[str, Any]] = {
    "center_hero": {
        "css_class": "comp-center",
        "blurb": (
            "Subject and type stacked on the optical centre. Calm, declarative, "
            "poster-like. The RIGHT choice for a title, a single number, a one-line "
            "thesis — and the WRONG choice three shots in a row."
        ),
        "air": "even margins all round; the frame breathes symmetrically",
        "suits": ("KINETIC_TITLE", "KINETIC_TEXT", "EQUATION_BUILD"),
        "contract": (
            "<div class='comp comp-center'>\n"
            "  <div class='comp-main'>\n"
            "    <span class='tracking-label'>EYEBROW</span>\n"
            "    <h1 class='text-display'>The one idea</h1>\n"
            "    <!-- subject sits under the type, both centred on the optical axis -->\n"
            "  </div>\n"
            "</div>"
        ),
    },
    "left_column": {
        "css_class": "comp-left-column",
        "blurb": (
            "Type held in the left third on a hard vertical grid line; the subject "
            "occupies — and bleeds out of — the right two thirds. The workhorse "
            "editorial frame: reads as designed rather than centred-by-default."
        ),
        "air": "a clean gutter between column and subject; nothing fills it",
        "suits": ("TEXT_DIAGRAM", "IMAGE_SPLIT", "DATA_STORY", "PROCESS_STEPS"),
        "contract": (
            "<div class='comp comp-left-column'>\n"
            "  <div class='comp-col'>\n"
            "    <span class='tracking-label'>SECTION</span>\n"
            "    <h1 class='text-display'>Left-aligned<br>display type</h1>\n"
            "    <p class='text-body'>One supporting line, same left edge.</p>\n"
            "  </div>\n"
            "  <div class='comp-subject'>\n"
            "    <!-- diagram / artifact / media. Allowed to bleed past the right edge. -->\n"
            "  </div>\n"
            "</div>"
        ),
    },
    "right_column": {
        "css_class": "comp-right-column",
        "blurb": (
            "Mirror of left_column — subject left, type in the right third. Use when "
            "the subject reads left-to-right into the type, or to break a run of "
            "left-column shots."
        ),
        "air": "gutter between subject and column",
        "suits": ("TEXT_DIAGRAM", "IMAGE_SPLIT", "ANNOTATION_MAP"),
        "contract": (
            "<div class='comp comp-right-column'>\n"
            "  <div class='comp-subject'><!-- artifact / diagram, may bleed left --></div>\n"
            "  <div class='comp-col'>\n"
            "    <span class='tracking-label'>SECTION</span>\n"
            "    <h1 class='text-display'>Type on<br>the right</h1>\n"
            "  </div>\n"
            "</div>"
        ),
    },
    "bottom_anchor": {
        "css_class": "comp-bottom-anchor",
        "blurb": (
            "Subject fills the upper frame and bleeds off the top edge; type is "
            "anchored to the bottom-left with real air above it. Cinematic — the "
            "bleed implies the subject continues beyond the frame."
        ),
        "air": "between the bottom of the subject and the type block",
        "suits": ("IMAGE_HERO", "VIDEO_HERO", "PRODUCT_HERO", "SOURCE_CLIP"),
        "contract": (
            "<div class='comp comp-bottom-anchor'>\n"
            "  <div class='comp-subject'><!-- bleeds past the top edge, intentionally cropped --></div>\n"
            "  <div class='comp-anchor'>\n"
            "    <span class='tracking-label'>LABEL</span>\n"
            "    <h1 class='text-display'>Anchored low</h1>\n"
            "  </div>\n"
            "</div>"
        ),
    },
    "corner_type": {
        "css_class": "comp-corner-type",
        "blurb": (
            "Most of the frame is deliberately empty. Type occupies one corner; a "
            "small subject sits in the diagonally opposite one. High-confidence, "
            "gallery-like. Needs short copy — it fails with a paragraph."
        ),
        "air": "the whole diagonal between the two anchors — leave it EMPTY",
        "suits": ("KINETIC_TEXT", "LOWER_THIRD", "ANIMATED_ASSET"),
        "contract": (
            "<div class='comp comp-corner-type'>\n"
            "  <div class='comp-anchor-tl'>\n"
            "    <h1 class='text-display'>Short<br>statement</h1>\n"
            "  </div>\n"
            "  <div class='comp-anchor-br'><!-- small subject, ~22% of frame width --></div>\n"
            "  <!-- the diagonal between them stays empty. That emptiness IS the design. -->\n"
            "</div>"
        ),
    },
    "margin_notes": {
        "css_class": "comp-margin-notes",
        "blurb": (
            "A wide main column with a narrow annotation gutter beside it, like a "
            "marked-up page. Annotations enter in the gutter and point INTO the main "
            "column. The strongest frame for a source being examined."
        ),
        "air": "the unused length of the gutter",
        "suits": ("ANNOTATION_MAP", "ARTICLE_FOCUS", "TEXT_DIAGRAM", "IMAGE_SPLIT"),
        "contract": (
            "<div class='comp comp-margin-notes'>\n"
            "  <div class='comp-body'><!-- the artifact / diagram / passage under study --></div>\n"
            "  <aside class='comp-gutter'>\n"
            "    <div class='comp-note'><span class='tracking-label'>01</span> first annotation</div>\n"
            "    <div class='comp-note'><span class='tracking-label'>02</span> second annotation</div>\n"
            "  </aside>\n"
            "  <!-- reveal notes one per narration beat; each may draw a leader line into the body -->\n"
            "</div>"
        ),
    },
    "stacked_offset": {
        "css_class": "comp-stacked-offset",
        "blurb": (
            "Vertical stack aligned to the 38% vertical grid line instead of the "
            "centre. Nearly the cost of a centred stack, but off-axis placement is "
            "most of what separates 'composed' from 'default'."
        ),
        "air": "the wider margin on the open side",
        "suits": ("KINETIC_TEXT", "TEXT_DIAGRAM", "EQUATION_BUILD", "DEVICE_MOCKUP"),
        "contract": (
            "<div class='comp comp-stacked-offset'>\n"
            "  <div class='comp-stack'>\n"
            "    <span class='tracking-label'>EYEBROW</span>\n"
            "    <h1 class='text-display'>Off-axis<br>stack</h1>\n"
            "    <!-- optional supporting element, same left edge -->\n"
            "  </div>\n"
            "</div>"
        ),
    },
    "full_bleed_overlay": {
        "css_class": "comp-full-bleed",
        "blurb": (
            "Media fills the entire frame; type overlays it on a scrim. Reserve for "
            "genuine atmosphere or a real establishing image — over a generic stock "
            "clip it is the most generic frame available."
        ),
        "air": "none by design — the scrim does the separation work",
        "suits": ("VIDEO_HERO", "IMAGE_HERO", "SOURCE_CLIP", "AI_VIDEO_HERO"),
        "contract": (
            "<div class='comp comp-full-bleed'>\n"
            "  <div class='comp-media'><!-- fills frame, object-fit:cover --></div>\n"
            "  <div class='comp-scrim'></div>\n"
            "  <div class='comp-overlay'><h1 class='text-display'>Over the image</h1></div>\n"
            "</div>"
        ),
    },
    "spine": {
        "css_class": "comp-spine",
        "blurb": (
            "A chronology or sequence laid along a spine — vertical or horizontal — "
            "with nodes for each step. Pairs with the .spine / .spine-node staging "
            "classes. For 'first, then, finally' narration."
        ),
        "air": "even intervals along the spine; do not crowd the nodes",
        "suits": ("PROCESS_STEPS", "DATA_STORY", "INFOGRAPHIC_SVG"),
        "contract": (
            "<div class='comp comp-spine'>\n"
            "  <div class='spine'>\n"
            "    <div class='spine-node'><!-- step 1 --></div>\n"
            "    <div class='spine-node'><!-- step 2 --></div>\n"
            "    <div class='spine-node'><!-- step 3 --></div>\n"
            "  </div>\n"
            "  <!-- reveal nodes in narration order; the spine itself may draw on -->\n"
            "</div>"
        ),
    },
    "artifact_study": {
        "css_class": "comp-artifact-study",
        "blurb": (
            "ONE artifact — a supplied plate, a document, a specimen — staged on a "
            "ground, held, pushed into, and annotated on top. The camera and the "
            "marker carry the explanation. One artifact studied for 15s beats three "
            "panels of type."
        ),
        "air": "the ground visible around the artifact; it should sit ON something",
        "suits": ("IMAGE_HERO", "ARTICLE_FOCUS", "ANNOTATION_MAP", "IMAGE_SPLIT"),
        "contract": (
            "<div class='comp comp-artifact-study stage-paper'>\n"
            "  <div class='comp-artifact artifact artifact-laid aged-edge'>\n"
            "    <!-- the artifact itself: uploaded plate preferred over generated art -->\n"
            "  </div>\n"
            "  <!-- annotate ON TOP as the narration cites each part: -->\n"
            "  <!--   .marker-hl over the term being named -->\n"
            "  <!--   a leader line + .tracking-label out to the margin -->\n"
            "  <!-- and push in: scale the wrapper 1.0 -> 1.08 across the hold -->\n"
            "</div>"
        ),
    },
}

COMPOSITION_NAMES = frozenset(COMPOSITIONS)

# Centre-stacked frames are the failure mode, not a banned choice: a title
# card genuinely wants one. Rationed rather than forbidden.
CENTERED = "center_hero"
MAX_CENTERED_FRACTION = 0.25
NO_REPEAT_WINDOW = 3

# Per shot type fallback, used when the planner omits the field. Mirrors
# SHOT_TYPE_BG_TREATMENT_DEFAULT's role for background_treatment.
SHOT_TYPE_COMPOSITION_DEFAULT: Dict[str, str] = {
    "KINETIC_TITLE": "center_hero",
    "KINETIC_TEXT": "stacked_offset",
    "EQUATION_BUILD": "center_hero",
    "TEXT_DIAGRAM": "left_column",
    "IMAGE_SPLIT": "left_column",
    "DATA_STORY": "left_column",
    "PROCESS_STEPS": "spine",
    "INFOGRAPHIC_SVG": "spine",
    "ANNOTATION_MAP": "margin_notes",
    "ARTICLE_FOCUS": "margin_notes",
    "IMAGE_HERO": "bottom_anchor",
    "VIDEO_HERO": "full_bleed_overlay",
    "SOURCE_CLIP": "full_bleed_overlay",
    # IMAGE_CLIP embeds the user's screenshot full-frame in its own HTML and
    # annotates on top. A column composition would fight that <img>, so it
    # takes the same frame as SOURCE_CLIP.
    "IMAGE_CLIP": "full_bleed_overlay",
    "AI_VIDEO_HERO": "full_bleed_overlay",
    "PRODUCT_HERO": "bottom_anchor",
    "DEVICE_MOCKUP": "stacked_offset",
    "LOWER_THIRD": "corner_type",
    "ANIMATED_ASSET": "corner_type",
}

# Rotation used when the per-type default would repeat inside the no-repeat
# window. Ordered so consecutive picks differ in where the weight sits.
_ROTATION: Sequence[str] = (
    "left_column",
    "bottom_anchor",
    "margin_notes",
    "right_column",
    "stacked_offset",
    "artifact_study",
    "corner_type",
    "spine",
)


def default_for(shot_type: str) -> str:
    """Composition a shot type falls back to when nothing else is specified."""
    return SHOT_TYPE_COMPOSITION_DEFAULT.get(
        str(shot_type or "").strip().upper(), "left_column"
    )


def normalize(value: Any, shot_type: str, *, allowed: Sequence[str] | None = None) -> str:
    """Coerce a planner-supplied value to a legal composition name.

    Mirrors the `background_treatment` normalizer: unknown or absent values
    fall back to the per-shot-type default rather than failing the run.
    """
    name = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    pool = set(allowed) & COMPOSITION_NAMES if allowed else COMPOSITION_NAMES
    if not pool:
        pool = COMPOSITION_NAMES
    if name in pool:
        return name
    fallback = default_for(shot_type)
    return fallback if fallback in pool else sorted(pool)[0]


def assign_compositions(
    shots: List[Dict[str, Any]],
    *,
    allowed: Sequence[str] | None = None,
) -> List[Dict[str, Any]]:
    """Give every shot a `composition`, enforcing variety structurally.

    Two rules, both there because the aspirational prose version of them has
    been in the preamble for months without producing varied frames:

      1. No composition repeats inside NO_REPEAT_WINDOW consecutive shots.
      2. At most MAX_CENTERED_FRACTION of shots may be centre-stacked.

    A planner-declared composition is honoured unless it breaks rule 1 or 2 —
    the planner sees the whole script and its intent beats a rotation table.
    Media-hero shot types keep full_bleed_overlay when they ask for it; the
    media IS the frame there and reflowing it into a column would fight the
    background contract.
    """
    pool = [c for c in (allowed or sorted(COMPOSITION_NAMES)) if c in COMPOSITION_NAMES]
    if not pool:
        pool = sorted(COMPOSITION_NAMES)

    max_centered = max(1, int(len(shots) * MAX_CENTERED_FRACTION)) if shots else 0
    centered_used = 0
    assigned: List[str] = []

    for idx, shot in enumerate(shots):
        shot_type = str(shot.get("shot_type") or "").strip().upper()
        want = normalize(shot.get("composition"), shot_type, allowed=pool)
        recent = assigned[-NO_REPEAT_WINDOW:]

        # full_bleed_overlay on a media-hero shot is exempt from the repeat
        # rule — the media is the composition and there is no column to move
        # the type into without contradicting background_treatment.
        media_hero = str(shot.get("background_treatment") or "") == "media_hero"
        exempt = want == "full_bleed_overlay" and media_hero

        blocked = (want in recent and not exempt) or (
            want == CENTERED and centered_used >= max_centered
        )
        if blocked:
            alt = next(
                (
                    c
                    for c in _ROTATION
                    if c in pool and c not in recent and c != CENTERED
                ),
                None,
            )
            # Every rotation candidate is in the recent window (very short
            # videos): take anything legal that isn't the immediately prior
            # shot, so we degrade to "not back-to-back" rather than throwing.
            if alt is None:
                alt = next(
                    (c for c in pool if not assigned or c != assigned[-1]), want
                )
            want = alt

        if want == CENTERED:
            centered_used += 1
        assigned.append(want)
        shot["composition"] = want

    return shots


def planner_menu_block() -> str:
    """The composition menu shown to the ShotPlanner, which picks per shot."""
    lines = [
        "**FRAME COMPOSITION — `composition` (per shot, RECOMMENDED)**:\n",
        "Every shot should declare a `composition` field naming WHERE things sit in "
        "the frame. This is the field that decides whether the video looks designed "
        "or looks like slides. Allowed values:\n",
    ]
    for name, spec in COMPOSITIONS.items():
        lines.append(f"- `\"{name}\"` — {spec['blurb']}\n")
    lines.append(
        "**Cross-shot rule: consecutive shots MUST NOT share a composition, and at "
        f"most {int(MAX_CENTERED_FRACTION * 100)}% of shots may use `center_hero`.** "
        "Two shots covering different ideas should not be the same frame recoloured. "
        "The pipeline re-assigns any shot that breaks this, so choosing deliberately "
        "keeps the decision yours rather than a rotation table's.\n"
        "If you omit the field, a conservative default is inferred from `shot_type`.\n\n"
    )
    return "".join(lines)


def contract_block(composition: str, shot_type: str = "") -> str:
    """The per-shot COMPOSITION CONTRACT — concrete skeleton for ONE frame.

    Deliberately shaped like the BACKGROUND CONTRACT (a named value plus the
    exact markup that satisfies it) because that is the pattern the per-shot
    model already reliably follows.
    """
    name = normalize(composition, shot_type)
    spec = COMPOSITIONS[name]
    return (
        "**🖼 COMPOSITION CONTRACT FOR THIS SHOT — "
        f"`{name}`**\n"
        f"{spec['blurb']}\n"
        f"Negative space: {spec['air']}.\n"
        "This composition is ASSIGNED. Build THIS frame — do not fall back to a "
        "centred hero+sub stack, and do not reproduce the shot card's example "
        "layout if it contradicts this one (the card's exemplar is generic; this "
        "is the frame chosen for this shot). The grid classes below are "
        "pre-injected in the global stylesheet:\n"
        "```html\n"
        f"{spec['contract']}\n"
        "```\n"
        "Fill it with this shot's real content and motion. You may add layers, "
        "bleed elements past the frame edge, and nest the staging-kit classes "
        "inside it. What you may NOT do is re-centre everything.\n\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
# CSS — injected into the global stylesheet
# ─────────────────────────────────────────────────────────────────────────────
# 12-column × 8-row grid so placements land on shared lines across shots
# (that shared alignment is what makes a set of frames feel like one film).
# Interpolated as a VALUE into the preamble f-string, so single braces here
# are correct and intentional — see the module docstring.

COMPOSITION_CSS = """
/* --- FRAME COMPOSITION GRID ---------------------------------------
   Text columns are align-items:stretch, never flex-start. With flex-start a
   heading is shrink-to-fit: its box hugs the text, so a phrase that WOULD fit
   the column wraps anyway — and because the box tracks the text, shrinking the
   font shrinks the box too and the overflow never clears. That is what put
   "TRIGEMIN / AL" on two lines in a 562px column that had room for it.
   Named frames. Every composition is a 12x8 grid so type and subjects
   land on the same lines from shot to shot. Placement is the design;
   .comp-center is ONE option, not the default. */
/* The container rule is repeated on every composition class, not just on
   .comp. A real run authored <div class="comp-spine"> without the .comp
   wrapper: the placement rules still matched, but there was no grid to place
   into, so the flex children collapsed to min-content and the labels rendered
   one letter per line down the left edge. Requiring two cooperating class
   names is a contract the model will drop sooner or later, so either form has
   to stand on its own. */
.comp,
.comp-center,
.comp-left-column,
.comp-right-column,
.comp-bottom-anchor,
.comp-corner-type,
.comp-margin-notes,
.comp-stacked-offset,
.comp-full-bleed,
.comp-spine,
.comp-artifact-study {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-template-rows: repeat(8, 1fr);
  padding: var(--spacing-safe-area, 5%);
  box-sizing: border-box;
}
/* min-width:0 lets a grid item shrink below min-content, which is what allows
   long labels to wrap. Keep it off text-bearing flex rows: those must overflow
   or shrink their type, never collapse to a one-character column. */
.comp > *, [class*="comp-"] > * { min-width: min-content; min-height: 0; }
/* min-height:0 is for the frame's grid CELLS (.comp-stack, .comp-col ...),
   which may be shorter than their content and let it overflow. The items
   INSIDE a cell's flex column — heading, rule, sub-line — must keep their
   content height. With 0 a heading in a column too short for it collapsed to
   a sliver while its lines still painted, and the sub-line laid out on top
   of them: "Recruiters prefer short resumes" printed across "PAGE, TWO MAX."
   (ITRC lesson, 2026-10-22). Now they overflow the cell instead of stacking. */
.comp > [class*="comp-"] > *,
[class*="comp-"] > [class*="comp-"] > * { min-height: auto; }
/* min-width:0 belongs to things that CAN shrink without becoming unreadable —
   media. Applied to a text-bearing grid child it permits the item to shrink
   below its content width, all the way to one character per line, which is
   exactly the failure it was meant to prevent. A real run collapsed a
   pipeline-authored `comp comp-spine` frame this way: the container was
   correct, the children were simply allowed to vanish. The floor is the
   longest word — text still wraps, it can no longer collapse. */
.comp img, .comp video, .comp svg, .comp canvas,
[class*="comp-"] img, [class*="comp-"] video,
[class*="comp-"] svg, [class*="comp-"] canvas { min-width: 0; }

/* centred — calm and declarative; rationed by assign_compositions() */
.comp-center .comp-main {
  grid-column: 3 / 11; grid-row: 3 / 7;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  gap: 0.6em;
}

/* type in a column on one side, subject bleeding off the other */
.comp-left-column .comp-col {
  grid-column: 1 / 6; grid-row: 2 / 8;
  display: flex; flex-direction: column;
  justify-content: center; align-items: stretch; text-align: left;
  gap: 0.5em; z-index: 2;
}
.comp-left-column .comp-subject {
  grid-column: 7 / 14; grid-row: 1 / 9;
  display: flex; align-items: center; justify-content: flex-start;
  overflow: visible;
}
.comp-right-column .comp-col {
  grid-column: 8 / 13; grid-row: 2 / 8;
  display: flex; flex-direction: column;
  justify-content: center; align-items: stretch; text-align: left;
  gap: 0.5em; z-index: 2;
}
.comp-right-column .comp-subject {
  grid-column: 1 / 7; grid-row: 1 / 9;
  display: flex; align-items: center; justify-content: flex-end;
  overflow: visible;
}

/* subject bleeds off the top, type anchored low-left */
.comp-bottom-anchor .comp-subject {
  grid-column: 1 / 13; grid-row: 1 / 7;
  display: flex; align-items: flex-end; justify-content: center;
  overflow: visible;
}
.comp-bottom-anchor .comp-anchor {
  grid-column: 1 / 9; grid-row: 7 / 9;
  display: flex; flex-direction: column;
  justify-content: flex-end; align-items: stretch; text-align: left;
  gap: 0.35em; z-index: 2;
}

/* two opposed corners, empty diagonal between them */
.comp-corner-type .comp-anchor-tl {
  grid-column: 1 / 7; grid-row: 1 / 4;
  display: flex; flex-direction: column;
  justify-content: flex-start; align-items: stretch; text-align: left;
}
.comp-corner-type .comp-anchor-br {
  grid-column: 9 / 13; grid-row: 6 / 9;
  display: flex; align-items: flex-end; justify-content: flex-end;
}

/* marked-up page: wide body, narrow annotation gutter */
.comp-margin-notes .comp-body {
  grid-column: 1 / 9; grid-row: 1 / 9;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.comp-margin-notes .comp-gutter {
  grid-column: 9 / 13; grid-row: 1 / 9;
  display: flex; flex-direction: column;
  justify-content: center; align-items: stretch; text-align: left;
  gap: 1.2em; padding-left: 1.2em;
  border-left: 1px solid color-mix(in srgb, var(--brand-text, #222) 22%, transparent);
}
.comp-margin-notes .comp-note {
  display: flex; flex-direction: column; gap: 0.25em;
  font-size: var(--font-scale-label, 0.95rem); line-height: 1.35;
  text-align: left;
}

/* off-axis stack on the 38% line */
.comp-stacked-offset .comp-stack {
  grid-column: 2 / 9; grid-row: 3 / 8;
  display: flex; flex-direction: column;
  justify-content: center; align-items: stretch; text-align: left;
  gap: 0.5em;
}

/* media fills the frame, type over a scrim */
.comp-full-bleed .comp-media {
  grid-column: 1 / 13; grid-row: 1 / 9;
  overflow: hidden;
}
.comp-full-bleed .comp-media > img,
.comp-full-bleed .comp-media > video {
  width: 100%; height: 100%; object-fit: cover;
}
.comp-full-bleed .comp-scrim {
  grid-column: 1 / 13; grid-row: 1 / 9;
  background: linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 58%);
  pointer-events: none;
}
.comp-full-bleed .comp-overlay {
  grid-column: 1 / 10; grid-row: 6 / 9;
  display: flex; flex-direction: column;
  justify-content: flex-end; align-items: stretch; text-align: left;
  gap: 0.35em; z-index: 3;
}

/* chronology / sequence along a spine */
.comp-spine .spine {
  grid-column: 2 / 12; grid-row: 3 / 7;
  display: flex; align-items: center; justify-content: space-between;
}

/* one artifact, staged and annotated */
.comp-artifact-study .comp-artifact {
  grid-column: 3 / 11; grid-row: 2 / 8;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
"""


__all__ = [
    "COMPOSITIONS",
    "COMPOSITION_NAMES",
    "COMPOSITION_CSS",
    "SHOT_TYPE_COMPOSITION_DEFAULT",
    "MAX_CENTERED_FRACTION",
    "NO_REPEAT_WINDOW",
    "default_for",
    "normalize",
    "assign_compositions",
    "planner_menu_block",
    "contract_block",
]


# ─────────────────────────────────────────────────────────────────────────────
# Exemplars — the part of the prompt the model actually imitates
# ─────────────────────────────────────────────────────────────────────────────
# Every shot card ships a centre-stacked example, and marketing mode already
# proved the fix: MARKETING_EXAMPLES swaps the exemplar per card because "the
# example code is the strongest signal in the prompt". Educational/aspirational
# runs never got that treatment — they got prose telling them to avoid the
# frame the example demonstrates.
#
# One exemplar is injected per shot (the assigned composition's), REPLACING the
# card's, so the prompt does not grow. Each one is written to be worth copying:
# real type hierarchy with explicit leading and weight, motion with named eases
# on narration beats, a back-half beat, and staging where the frame invites it.
# Deliberately NOT centred, and deliberately not decorative — the reveals are
# tied to what is being said.

EXEMPLARS: Dict[str, Dict[str, str]] = {
    "left_column": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='comp comp-left-column'>\n"
            "    <div class='comp-col'>\n"
            "      <span class='tracking-label' id='eyebrow' style='color:var(--brand-accent);'>MECHANISM</span>\n"
            "      <!-- a COLUMN is not a frame: the display tier is sized for full width,\n"
            "           so a column headline sits one tier down. Two lines, never three. -->\n"
            "      <h1 id='head' class='text-display' style=\"font-family:var(--font-heading);\n"
            "          font-size:var(--font-scale-h2);line-height:1.0;font-weight:900;margin:0.12em 0 0;\">\n"
            "        Pressure&nbsp;<span id='key' style='color:var(--brand-accent);'>falls</span><br>as speed rises\n"
            "      </h1>\n"
            "      <p id='sub' class='text-body' style='font-size:var(--font-scale-body);line-height:1.4;\n"
            "          font-weight:400;max-width:26ch;margin:0.5em 0 0;opacity:0;'>\n"
            "        The same air, moving faster over the curve.\n"
            "      </p>\n"
            "    </div>\n"
            "    <div class='comp-subject'>\n"
            "      <svg id='wing' viewBox='0 0 620 420' style='width:112%;overflow:visible;'>\n"
            "        <path id='foil' d='M60,250 C180,150 380,140 560,196 C400,250 200,286 60,250 Z'\n"
            "              fill='none' stroke='var(--brand-text)' stroke-width='3'/>\n"
            "        <path id='flow-1' d='M20,180 C200,120 400,116 600,168' fill='none'\n"
            "              stroke='var(--brand-accent)' stroke-width='2.4' stroke-dasharray='620' stroke-dashoffset='620'/>\n"
            "        <path id='flow-2' d='M20,300 C200,300 400,292 600,262' fill='none'\n"
            "              stroke='var(--brand-text)' stroke-width='2' opacity='0.45'\n"
            "              stroke-dasharray='620' stroke-dashoffset='620'/>\n"
            "      </svg>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 9.0s   composition: left_column\n"
            "   0.30s eyebrow + headline           (\"pressure\")\n"
            "   1.65s fast streamline draws        (\"as speed rises\")\n"
            "   3.40s slow streamline draws        (\"the same air\")\n"
            "   5.60s BACK HALF — key word lifts, sub-line arrives, foil eases up */\n"
            "gsap.from('#eyebrow', {opacity:0, y:-12, duration:0.5, delay:0.30, ease:'power3.out'});\n"
            "gsap.from('#head', {opacity:0, y:26, duration:0.7, delay:0.42, ease:'expo.out'});\n"
            "gsap.to('#flow-1', {strokeDashoffset:0, duration:1.1, delay:1.65, ease:'power2.inOut'});\n"
            "gsap.to('#flow-2', {strokeDashoffset:0, duration:1.4, delay:3.40, ease:'power2.inOut'});\n"
            "/* back half: the accent word is the subject of the phrase, so IT moves */\n"
            "gsap.to('#key', {scale:1.12, transformOrigin:'left center', duration:0.5, delay:5.60, ease:'back.out(1.8)'});\n"
            "gsap.to('#sub', {opacity:1, y:0, duration:0.6, delay:5.75, ease:'power3.out'});\n"
            "gsap.from('#sub', {y:16, duration:0.6, delay:5.75, ease:'power3.out'});\n"
            "gsap.to('#wing', {y:-14, duration:2.6, delay:5.60, ease:'sine.inOut'});\n"
            "/* ambient, never still */\n"
            "gsap.to('#foil', {y:'+=5', duration:4.5, repeat:-1, yoyo:true, ease:'sine.inOut'});"
        ),
    },
    "margin_notes": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='stage-paper'></div>\n"
            "  <div class='comp comp-margin-notes'>\n"
            "    <div class='comp-body'>\n"
            "      <div id='plate' class='artifact artifact-laid aged-edge' style='width:88%;padding:24px 28px 30px;'>\n"
            "        <span class='tracking-label' style='opacity:0.55;'>SOURCE &nbsp;·&nbsp; 1854 MAP</span>\n"
            "        <img src='UPLOADED_OR_STOCK' alt='' style='width:100%;display:block;margin-top:10px;'/>\n"
            "      </div>\n"
            "    </div>\n"
            "    <aside class='comp-gutter'>\n"
            "      <div class='comp-note' id='n1' style='opacity:0;'>\n"
            "        <span class='tracking-label' style='color:var(--brand-accent);'>01&nbsp;&nbsp;THE PUMP</span>\n"
            "        <span>Every death clusters within one street.</span>\n"
            "      </div>\n"
            "      <div class='comp-note' id='n2' style='opacity:0;'>\n"
            "        <span class='tracking-label' style='color:var(--brand-accent);'>02&nbsp;&nbsp;THE OUTLIER</span>\n"
            "        <span>The brewery, untouched. Its workers drank beer.</span>\n"
            "      </div>\n"
            "    </aside>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 12.0s   composition: margin_notes\n"
            "   0.30s plate settles onto the ground\n"
            "   2.10s note 01 enters the gutter        (\"one street\")\n"
            "   5.40s note 02 enters                    (\"the brewery\")\n"
            "   8.20s BACK HALF — push in on the outlier, dim note 01 */\n"
            "gsap.from('#plate', {opacity:0, y:30, rotate:-1.2, duration:0.9, delay:0.30, ease:'expo.out'});\n"
            "gsap.to('#n1', {opacity:1, duration:0.5, delay:2.10, ease:'power3.out'});\n"
            "gsap.from('#n1', {x:18, duration:0.5, delay:2.10, ease:'power3.out'});\n"
            "gsap.to('#n2', {opacity:1, duration:0.5, delay:5.40, ease:'power3.out'});\n"
            "gsap.from('#n2', {x:18, duration:0.5, delay:5.40, ease:'power3.out'});\n"
            "/* focus by suppression — the note being spoken is the only bright one */\n"
            "gsap.to('#n1', {opacity:0.34, duration:0.5, delay:8.20, ease:'power2.out'});\n"
            "gsap.to('#plate', {scale:1.09, duration:2.2, delay:8.20, ease:'power2.inOut'});\n"
            "gsap.to('#plate', {y:'+=6', duration:5.0, repeat:-1, yoyo:true, ease:'sine.inOut'});"
        ),
    },
    "bottom_anchor": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='comp comp-bottom-anchor'>\n"
            "    <div class='comp-subject'>\n"
            "      <img id='hero' src='STOCK_OR_AI' alt='' style='width:100%;height:118%;object-fit:cover;'/>\n"
            "    </div>\n"
            "    <div class='comp-scrim' style='position:absolute;inset:0;\n"
            "         background:linear-gradient(to top, var(--brand-bg) 22%, rgba(0,0,0,0) 62%);'></div>\n"
            "    <div class='comp-anchor'>\n"
            "      <span class='tracking-label' id='kicker' style='color:var(--brand-accent);'>1962 &nbsp;·&nbsp; ALASKA</span>\n"
            "      <h1 id='head' class='text-display' style=\"font-family:var(--font-heading);\n"
            "          font-size:var(--font-scale-h1);line-height:0.92;font-weight:900;margin:0.1em 0 0;\">\n"
            "        The wave arrived<br>eight hours later\n"
            "      </h1>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 8.0s   composition: bottom_anchor\n"
            "   0.00s slow push-in on the bleeding subject (runs the whole shot)\n"
            "   0.55s kicker\n"
            "   1.20s headline rises out of the anchor\n"
            "   4.90s BACK HALF — scrim deepens, headline settles up */\n"
            "gsap.fromTo('#hero', {scale:1.0}, {scale:1.10, duration:8.0, ease:'none'});\n"
            "gsap.from('#kicker', {opacity:0, y:14, duration:0.5, delay:0.55, ease:'power3.out'});\n"
            "gsap.from('#head', {opacity:0, y:38, duration:0.8, delay:1.20, ease:'expo.out'});\n"
            "gsap.to('.comp-scrim', {opacity:1.15, duration:2.4, delay:4.90, ease:'power2.inOut'});\n"
            "gsap.to('#head', {y:-10, duration:2.4, delay:4.90, ease:'sine.inOut'});"
        ),
    },
    "stacked_offset": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='halftone' style='position:absolute;inset:0;opacity:0.5;'></div>\n"
            "  <div class='comp comp-stacked-offset'>\n"
            "    <div class='comp-stack'>\n"
            "      <span class='tracking-label' id='k' style='color:var(--brand-accent);'>WHAT CHANGED</span>\n"
            "      <h1 class='text-display' style=\"font-family:var(--font-heading);\n"
            "          font-size:var(--font-scale-display);line-height:0.88;font-weight:900;margin:0.1em 0 0;\">\n"
            "        <span class='slam-wrapper'><span class='slam-text' id='w1'>TWELVE</span></span><br>\n"
            "        <span class='slam-wrapper'><span class='slam-text' id='w2'>SECONDS</span></span>\n"
            "      </h1>\n"
            "      <div id='rule' style='height:4px;width:0;background:var(--brand-accent);margin-top:0.4em;'></div>\n"
            "      <p id='sub' class='text-body' style='font-size:var(--font-scale-body);line-height:1.4;\n"
            "          max-width:30ch;margin:0.6em 0 0;opacity:0;'>The entire first flight.</p>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 7.0s   composition: stacked_offset\n"
            "   0.25s kicker | 0.70s / 1.05s word slams on the two stressed words\n"
            "   2.30s rule draws | 4.30s BACK HALF — sub-line, then the stack drifts up */\n"
            "gsap.from('#k', {opacity:0, x:-14, duration:0.45, delay:0.25, ease:'power3.out'});\n"
            "gsap.from('#w1', {yPercent:110, duration:0.55, delay:0.70, ease:'expo.out'});\n"
            "gsap.from('#w2', {yPercent:110, duration:0.55, delay:1.05, ease:'expo.out'});\n"
            "gsap.to('#rule', {width:'42%', duration:0.7, delay:2.30, ease:'power3.inOut'});\n"
            "gsap.to('#sub', {opacity:1, duration:0.55, delay:4.30, ease:'power3.out'});\n"
            "gsap.from('#sub', {y:14, duration:0.55, delay:4.30, ease:'power3.out'});\n"
            "gsap.to('.comp-stack', {y:-12, duration:2.4, delay:4.60, ease:'sine.inOut'});\n"
            "gsap.to('.halftone', {opacity:0.32, duration:5.0, repeat:-1, yoyo:true, ease:'sine.inOut'});"
        ),
    },
    "spine": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='comp comp-spine'>\n"
            "    <div class='spine'>\n"
            "      <div class='spine-node' id='s1'>\n"
            "        <span class='tracking-label' style='color:var(--brand-accent);'>01</span>\n"
            "        <div class='text-body' style='font-size:var(--font-scale-body);line-height:1.35;max-width:14ch;'>Antigen enters</div>\n"
            "      </div>\n"
            "      <div class='spine-node' id='s2' style='opacity:0;'>\n"
            "        <span class='tracking-label' style='color:var(--brand-accent);'>02</span>\n"
            "        <div class='text-body' style='font-size:var(--font-scale-body);line-height:1.35;max-width:14ch;'>Cell presents it</div>\n"
            "      </div>\n"
            "      <div class='spine-node' id='s3' style='opacity:0;'>\n"
            "        <span class='tracking-label' style='color:var(--brand-accent);'>03</span>\n"
            "        <div class='text-body' style='font-size:var(--font-scale-body);line-height:1.35;max-width:14ch;'>Antibody is made</div>\n"
            "      </div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 11.0s   composition: spine\n"
            "   nodes land on the narrated step, never on round numbers\n"
            "   1.40s step 1 | 4.20s step 2 | 6.90s step 3\n"
            "   8.80s BACK HALF — step 3 lifts, earlier steps recede (focus by suppression) */\n"
            "gsap.from('#s1', {opacity:0, y:18, duration:0.55, delay:1.40, ease:'power3.out'});\n"
            "gsap.to('#s2', {opacity:1, y:0, duration:0.55, delay:4.20, ease:'power3.out'});\n"
            "gsap.from('#s2', {y:18, duration:0.55, delay:4.20, ease:'power3.out'});\n"
            "gsap.to('#s3', {opacity:1, y:0, duration:0.55, delay:6.90, ease:'power3.out'});\n"
            "gsap.from('#s3', {y:18, duration:0.55, delay:6.90, ease:'power3.out'});\n"
            "gsap.to(['#s1','#s2'], {opacity:0.36, scale:0.97, duration:0.5, delay:8.80, ease:'power2.out'});\n"
            "gsap.to('#s3', {scale:1.06, duration:0.5, delay:8.80, ease:'expo.out'});"
        ),
    },
    "corner_type": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='comp comp-corner-type'>\n"
            "    <div class='comp-anchor-tl'>\n"
            "      <span class='tracking-label' id='k' style='color:var(--brand-accent);'>THE COST</span>\n"
            "      <h1 id='head' class='text-display' style=\"font-family:var(--font-heading);\n"
            "          font-size:var(--font-scale-display);line-height:0.86;font-weight:900;margin:0.12em 0 0;\">\n"
            "        NOTHING<br>WAS<br>SAVED\n"
            "      </h1>\n"
            "    </div>\n"
            "    <div class='comp-anchor-br'>\n"
            "      <svg id='mark' viewBox='0 0 200 200' style='width:100%;max-width:22vw;'>\n"
            "        <circle cx='100' cy='100' r='72' fill='none' stroke='var(--brand-accent)'\n"
            "                stroke-width='6' stroke-dasharray='452' stroke-dashoffset='452'/>\n"
            "        <path d='M62,100 L138,100' stroke='var(--brand-accent)' stroke-width='6'\n"
            "              stroke-dasharray='76' stroke-dashoffset='76'/>\n"
            "      </svg>\n"
            "    </div>\n"
            "    <!-- the diagonal between the anchors stays EMPTY. That emptiness is the design. -->\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 6.5s   composition: corner_type\n"
            "   0.30s kicker | 0.75s/1.05s/1.40s the three words land separately\n"
            "   3.60s BACK HALF — the mark draws and closes the frame */\n"
            "gsap.from('#k', {opacity:0, y:-10, duration:0.4, delay:0.30, ease:'power3.out'});\n"
            "gsap.from('#head', {opacity:0, x:-24, duration:0.7, delay:0.75, ease:'expo.out'});\n"
            "gsap.to('#mark circle', {strokeDashoffset:0, duration:0.9, delay:3.60, ease:'power2.inOut'});\n"
            "gsap.to('#mark path', {strokeDashoffset:0, duration:0.4, delay:4.40, ease:'expo.out'});\n"
            "gsap.to('#mark', {rotate:8, transformOrigin:'center', duration:2.4, delay:3.60, ease:'sine.inOut'});"
        ),
    },
    "artifact_study": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='stage-paper'></div>\n"
            "  <div class='stage-grid-patch' style='top:0;left:0;'></div>\n"
            "  <div class='comp comp-artifact-study'>\n"
            "    <div id='art' class='comp-artifact artifact artifact-laid aged-edge' style='padding:22px 26px 28px;'>\n"
            "      <span class='tracking-label' style='opacity:0.55;'>PLATE XI &nbsp;·&nbsp; 1543</span>\n"
            "      <img src='UPLOADED_PLATE' alt='' style='width:100%;display:block;margin-top:10px;'/>\n"
            "      <!-- annotate ON TOP of the artifact as each part is named -->\n"
            "      <span class='marker-hl' id='m1' style='position:absolute;left:34%;top:41%;opacity:0;'>scapula</span>\n"
            "      <span class='marker-hl' id='m2' style='position:absolute;left:52%;top:63%;opacity:0;'>humerus</span>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 13.0s   composition: artifact_study\n"
            "   0.30s the plate is laid down\n"
            "   2.60s marker over the first named part\n"
            "   6.10s marker over the second\n"
            "   8.40s BACK HALF — slow push-in; the camera does the explaining */\n"
            "gsap.from('#art', {opacity:0, y:34, rotate:-1.5, duration:1.0, delay:0.30, ease:'expo.out'});\n"
            "gsap.to('#m1', {opacity:1, duration:0.4, delay:2.60, ease:'power2.out'});\n"
            "gsap.from('#m1', {scaleX:0.2, transformOrigin:'left center', duration:0.45, delay:2.60, ease:'power3.out'});\n"
            "gsap.to('#m2', {opacity:1, duration:0.4, delay:6.10, ease:'power2.out'});\n"
            "gsap.from('#m2', {scaleX:0.2, transformOrigin:'left center', duration:0.45, delay:6.10, ease:'power3.out'});\n"
            "gsap.to('#art', {scale:1.12, duration:3.6, delay:8.40, ease:'power2.inOut'});\n"
            "gsap.to('#art', {y:'+=6', duration:5.2, repeat:-1, yoyo:true, ease:'sine.inOut'});"
        ),
    },
    "full_bleed_overlay": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;overflow:hidden;'>\n"
            "  <div class='comp comp-full-bleed'>\n"
            "    <div class='comp-media'>\n"
            "      <video id='bed' src='STOCK_VIDEO' autoplay muted playsinline></video>\n"
            "    </div>\n"
            "    <div class='comp-scrim'></div>\n"
            "    <div class='comp-overlay'>\n"
            "      <span class='tracking-label' id='k' style='color:#fff;opacity:0.8;'>THE NORTH SEA</span>\n"
            "      <h1 id='head' class='text-display' style=\"font-family:var(--font-heading);color:#fff;\n"
            "          font-size:var(--font-scale-h1);line-height:0.94;font-weight:900;margin:0.1em 0 0;\n"
            "          text-shadow:0 2px 18px rgba(0,0,0,0.55);\">\n"
            "        Nine metres,<br>every winter\n"
            "      </h1>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 7.5s   composition: full_bleed_overlay\n"
            "   0.45s kicker | 0.95s headline over the scrim\n"
            "   4.60s BACK HALF — scrim deepens as the line lands, type eases up */\n"
            "gsap.from('#k', {opacity:0, y:12, duration:0.45, delay:0.45, ease:'power3.out'});\n"
            "gsap.from('#head', {opacity:0, y:30, duration:0.75, delay:0.95, ease:'expo.out'});\n"
            "gsap.fromTo('.comp-scrim', {opacity:0.85}, {opacity:1.15, duration:2.6, delay:4.60, ease:'power2.inOut'});\n"
            "gsap.to('.comp-overlay', {y:-12, duration:2.6, delay:4.60, ease:'sine.inOut'});"
        ),
    },
    "right_column": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='comp comp-right-column'>\n"
            "    <div class='comp-subject'>\n"
            "      <svg id='chart' viewBox='0 0 560 400' style='width:108%;overflow:visible;'>\n"
            "        <line x1='60' y1='350' x2='530' y2='350' stroke='var(--brand-text)' stroke-width='2' opacity='0.35'/>\n"
            "        <rect class='bar' x='90'  y='350' width='58' height='0' fill='var(--brand-text)' opacity='0.35'/>\n"
            "        <rect class='bar' x='200' y='350' width='58' height='0' fill='var(--brand-text)' opacity='0.35'/>\n"
            "        <rect id='bar-hi' x='310' y='350' width='58' height='0' fill='var(--brand-accent)'/>\n"
            "        <rect class='bar' x='420' y='350' width='58' height='0' fill='var(--brand-text)' opacity='0.35'/>\n"
            "      </svg>\n"
            "    </div>\n"
            "    <div class='comp-col'>\n"
            "      <span class='tracking-label' id='k' style='color:var(--brand-accent);'>1987</span>\n"
            "      <h1 id='head' class='text-display' style=\"font-family:var(--font-heading);\n"
            "          font-size:var(--font-scale-h2);line-height:1.0;font-weight:900;margin:0.12em 0 0;\">\n"
            "        One year<br>broke the trend\n"
            "      </h1>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 9.5s   composition: right_column\n"
            "   0.40s kicker + headline\n"
            "   1.50s bars grow left to right (stagger, not one tween)\n"
            "   5.80s BACK HALF — the outlier bar is the subject of the phrase, so it lifts */\n"
            "gsap.from('#k', {opacity:0, y:-10, duration:0.4, delay:0.40, ease:'power3.out'});\n"
            "gsap.from('#head', {opacity:0, y:22, duration:0.7, delay:0.52, ease:'expo.out'});\n"
            "gsap.to('.bar', {attr:{y:170, height:180}, duration:0.7, delay:1.50, stagger:0.14, ease:'power3.out'});\n"
            "gsap.to('#bar-hi', {attr:{y:96, height:254}, duration:0.8, delay:1.92, ease:'expo.out'});\n"
            "gsap.to('.bar', {opacity:0.18, duration:0.5, delay:5.80, ease:'power2.out'});\n"
            "gsap.to('#bar-hi', {scaleY:1.06, transformOrigin:'bottom center', duration:0.6, delay:5.80, ease:'back.out(1.6)'});"
        ),
    },
    "center_hero": {
        "html": (
            "<div id='shot-root' style='position:absolute;inset:0;background:var(--brand-bg);overflow:hidden;'>\n"
            "  <div class='comp comp-center'>\n"
            "    <div class='comp-main'>\n"
            "      <span class='tracking-label' id='k' style='color:var(--brand-accent);'>CHAPTER TWO</span>\n"
            "      <h1 id='head' class='text-display' style=\"font-family:var(--font-heading);\n"
            "          font-size:var(--font-scale-display);line-height:0.88;font-weight:900;margin:0.14em 0 0;\">\n"
            "        THE&nbsp;<span id='key' style='color:var(--brand-accent);'>BLIND</span><br>SPOT\n"
            "      </h1>\n"
            "      <div id='rule' style='height:3px;width:0;background:var(--brand-accent);margin-top:0.5em;'></div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>"
        ),
        "script": (
            "/* TIMELINE MAP — 5.0s   composition: center_hero (title beat only)\n"
            "   0.25s kicker | 0.60s headline | 1.40s rule\n"
            "   3.10s BACK HALF — accent word pulses as it is spoken */\n"
            "gsap.from('#k', {opacity:0, y:-12, duration:0.45, delay:0.25, ease:'power3.out'});\n"
            "gsap.from('#head', {opacity:0, scale:0.94, duration:0.7, delay:0.60, ease:'expo.out'});\n"
            "gsap.to('#rule', {width:'34%', duration:0.6, delay:1.40, ease:'power3.inOut'});\n"
            "gsap.to('#key', {scale:1.1, transformOrigin:'center', duration:0.5, delay:3.10, ease:'back.out(1.8)'});"
        ),
    },
}

# Guideline lines that hard-prescribe the centred frame. Dropped when a
# composition is assigned, the same way _MARKETING_GUIDELINE_BANS drops the
# whiteboard prescriptions in marketing mode — otherwise the card's bullet
# list contradicts the contract that was just injected.
COMPOSITION_GUIDELINE_BANS: Sequence[str] = (
    "full-screen-center",
    "layout-hero",
    "single big concept in center",
    "centered",
)


# Shot types whose own html_template encodes a contract the pipeline depends on,
# not merely a layout suggestion. Swapping in a composition exemplar drops that
# contract silently:
#   IMAGE_CLIP  — `{{IMAGE_URL}}` is the placeholder the pipeline rewrites to the
#                 user's uploaded image. Without it the model never learns an
#                 image belongs in the shot, so it designs around empty space and
#                 the injected fallback <img> ends up behind an opaque panel.
#   SOURCE_CLIP — the template mandates a #000000 background because black is
#                 keyed out when the source footage is composited behind it. Any
#                 exemplar with a painted background hides the footage entirely.
# Both already ARE full-bleed compositions, so the exemplar adds nothing they
# don't have and costs them the one line that matters.
CONTRACT_BEARING_SHOT_TYPES: frozenset = frozenset({"IMAGE_CLIP", "SOURCE_CLIP"})


def exemplar_for(composition: str, shot_type: str = "") -> Dict[str, str] | None:
    """Composition-specific exemplar, or None to keep the card's own."""
    if str(shot_type or "").strip().upper() in CONTRACT_BEARING_SHOT_TYPES:
        return None
    return EXEMPLARS.get(normalize(composition, shot_type))


__all__ += [
    "EXEMPLARS",
    "COMPOSITION_GUIDELINE_BANS",
    "exemplar_for",
    "CONTRACT_BEARING_SHOT_TYPES",
]
