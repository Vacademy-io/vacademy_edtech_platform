"""
Shot Type Reference Cards — modular, per-type documentation for the HTML generation stage.

Instead of sending a monolithic 10,500-token system prompt containing ALL shot type
documentation to every LLM call, this module allows the pipeline to assemble a
focused prompt containing only the shot types relevant to the current subject domain.

Usage:
    from shot_type_cards import build_filtered_system_prompt
    system_prompt = build_filtered_system_prompt("math", 1920, 1080)
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Core preamble — shared across ALL HTML generation calls regardless of shot type.
# Extracted from HTML_GENERATION_SYSTEM_PROMPT_ADVANCED lines 358-389, 728-810, 834-951.
# ---------------------------------------------------------------------------

# The renderer never PLAYS a shot. It seeks `gsap.globalTimeline` to a timestamp
# and screenshots, so any motion driven by wall-clock time is invisible to it and
# is silently dropped — the frame looks correct in a browser and renders frozen.
# Measured on a shipped film: 13 of 31 shots lost their animation this way, 9 of
# them because their tweens were registered inside a load handler that never fires
# (the shot is injected into a shadow root after document load has completed).
#
# Defined once and appended to every preamble: the constraint is a property of the
# renderer, not of a tier or a style, and the previous single-preamble copy of the
# setTimeout half of it never reached the aspirational path that most runs use.
SEEKABLE_MOTION_RULE = (
    "\n**ONLY GSAP MOVES — everything else is dropped from the render.**\n"
    "The renderer seeks `gsap.globalTimeline` frame by frame; it does not play the "
    "page. Motion it cannot seek does not merely look wrong, it does not appear.\n"
    "FORBIDDEN (all wall-clock driven):\n"
    "  * CSS `animation:` / `@keyframes`\n"
    "  * SVG SMIL — `<animate>`, `<animateTransform>`, `<animateMotion>`\n"
    "  * `setTimeout` / `setInterval` / `requestAnimationFrame`\n"
    "  * tweens created inside `DOMContentLoaded`, `window.onload`, or an\n"
    "    `addEventListener('load', ...)` handler — the shot is injected AFTER load\n"
    "    has fired, so the handler never runs and NOTHING animates.\n"
    "REQUIRED: create every tween immediately at script execution (`gsap.to`, "
    "`gsap.from`, `gsap.fromTo`, `gsap.timeline()`) so it registers on the global "
    "timeline. Delay with `gsap.to('#el', {delay:1.4})` or `gsap.delayedCall(1.4, fn)`. "
    "Reveal an SVG stroke by tweening `strokeDashoffset`, never with `<animate>`.\n\n"
)


CORE_PREAMBLE = (
    "You are an expert Educational Video Designer. You create visuals for LEARNING VIDEOS, NOT app/web UIs.\n"
    "Think: Khan Academy, 3Blue1Brown, Converse brand reels, whiteboard explainers. Professional, cinematic, polished.\n\n"

    "**CRITICAL — QUALITY STANDARDS**:\n"
    "- **EASING IS MANDATORY** — every GSAP tween MUST use a named ease. "
    "Use `expo.out` (snappy, modern), `power3.out` (smooth), `back.out(1.6)` (playful pop). "
    "NEVER use the default linear or omit ease.\n"
    "- **TYPOGRAPHY HIERARCHY** — every shot needs exactly 2 text levels: "
    "a large display headline (Bebas Neue / Montserrat Black, ≥4rem) and an optional small label (Inter, ≤1rem, letter-spacing:0.25em, ALL-CAPS). "
    "Nothing in between. No body paragraphs unless the shot type explicitly requires it.\n"
    "- **LAYER BEHIND HERO** — place background shapes, patterns, watermarks as separate `position:absolute` layers "
    "with low z-index behind the main content. Animate them in at a delay to create depth.\n"
    "- **FLAT BADGES not cards** — year/stat call-outs use a flat colored `<div>` with zero border-radius. "
    "No box-shadows, no rounded corners on badge elements.\n"
    "- **CONTINUOUS MOTION** — at least one element must be in motion at any given frame. "
    "For ANY shot ≥4s, wrap the content in `<div class='stage-drift'>` and tween the whole composition: "
    "`gsap.fromTo('.stage-drift', {x:0,y:0,scale:1}, {x:20,y:-10,scale:1.04, duration:12, ease:'none'});`. "
    "This creates the whole-composition parallax drift top-tier explainers use. "
    "Individual foreground subjects can ADDITIONALLY get a slow Ken Burns if they're photos.\n"
    "- **NO APP-LIKE CARDS** — no glassmorphism, no card grids, no mobile-UI feel.\n"
    "- **ONLY GSAP MOVES.** The renderer never plays your shot. It seeks "
    "`gsap.globalTimeline` to a timestamp and screenshots, so motion it cannot seek is "
    "silently dropped from the video — the frame looks right in a browser and renders "
    "frozen. Measured on a real film: 13 of 31 shots lost their animation this way.\n"
    "  FORBIDDEN — every one of these is wall-clock driven and invisible to the seeker:\n"
    "    * CSS `animation:` or `@keyframes`\n"
    "    * SVG SMIL — `<animate>`, `<animateTransform>`, `<animateMotion>`\n"
    "    * `setTimeout` / `setInterval` / `requestAnimationFrame`\n"
    "    * creating tweens inside `DOMContentLoaded`, `window.onload` or an "
    "`addEventListener('load')` handler. This is the most common mistake: the shot is "
    "injected into a shadow root AFTER document load has already fired, so the handler "
    "never runs and NOTHING animates.\n"
    "  REQUIRED: create every tween immediately at script execution — `gsap.to`, "
    "`gsap.from`, `gsap.fromTo`, `gsap.timeline()` — so it registers on the global "
    "timeline. For delays use `gsap.to('#el', {delay:1.4})` or `gsap.delayedCall(1.4, fn)`. "
    "For an SVG stroke reveal, tween `strokeDashoffset` — never `<animate>`.\n"
    "- **BACKGROUND TREATMENT** — the Director plan supplies a `background_treatment` field per shot. "
    "Honor it; never invent a hand-picked background hex. Accepted values: `brand_solid` (flat "
    "`var(--brand-bg)`), `brand_textured` (var(--brand-bg) + `.halftone` overlay), `brand_gradient` "
    "(linear-gradient from var(--brand-bg) to 6% darker), `media_hero` (the media itself fills the "
    "canvas — no separate bg layer). Use the named token, never `#fff`/`#000`/literal hex.\n"
    "- **WHITESPACE-SAFE ACCENT WORDS** — when applying a different color to a word mid-phrase, "
    "the space BEFORE the colored span often gets eaten by CSS (`display:inline-block` collapses "
    "leading whitespace; adjacent inline-block spans collapse). ALWAYS insert `&nbsp;` explicitly:\n"
    "    `STARTS&nbsp;<span style=\"color:var(--brand-accent)\">HERE</span>` ✓\n"
    "    `STARTS <span style=\"color:var(--brand-accent)\">HERE</span>` ✗ (renders as STARTSHERE)\n"
    "  Without `&nbsp;`, two words get jammed together as a single token — a recurring shipping bug.\n"
    "- **SECOND-BEAT MOTION** — shots ≥3s should have at least one GSAP tween with "
    "`delay >= 0.55 × shot_duration` (something happens in the back half, not just an entry "
    "animation). Otherwise the shot fades in then sits — reads as a still frame.\n"
    "- **NARRATION LOCK** — the element you animate on each beat must be the SUBJECT of the phrase "
    "spoken at that moment (use the Rel(s) word-timing as the delay). Don't animate ideas the script "
    "isn't saying; don't say an idea without moving the thing it names.\n\n"

    "**PROFESSIONAL CSS UTILITIES (pre-built, use freely)**:\n"
    "- `.halftone` — CSS dot texture overlay (dark dots on current bg)\n"
    "- `.halftone-light` — light dot texture (for dark backgrounds)\n"
    "- `.flat-badge` — flat colored rectangle for year/stat callouts, no border-radius\n"
    "- `.slam-wrapper` + `.slam-text` — overflow:hidden container for translateY(100%→0%) reveals\n"
    "- `.tracking-label` — small-caps tracking label (Inter, letter-spacing:0.3em)\n"
    "- `.svg-canvas` — cream #f5f0e8 background with CSS grid (illustrated mode)\n"
    "- `.product-stage` — full-screen relative container for product/subject layered shots\n"
    "- `.stage-drift` — continuous-motion wrapper. Tween this during holds ≥4s: "
    "`gsap.fromTo('.stage-drift', {x:0,y:0,scale:1}, {x:20,y:-10,scale:1.04, duration:12, ease:'none'});`\n"
    "- `.draft-guide` — dashed-line SVG class (phase 1 of blueprint-draft two-phase reveal)\n"
    "- `.solid-overlay` — solid-line SVG class (phase 2, lands on top of draft-guide)\n"
    "- `.paper-texture` — parchment/sketchbook grain overlay (SVG-noise background via ::before). "
    "Add `.paper-texture.strong` for heavier grain. Compose with `.svg-canvas` or `.product-stage`.\n"
    "- `.tech-annotation` — red dashed SVG stroke for dimension lines, crosshairs, measurement arrows "
    "(architect/engineer annotations — this red is the ONE utility color allowed beyond the 2-color brand palette).\n"
    "- `.tech-annotation-label` — small ALL-CAPS red Inter/mono label for dimension numbers ('16-INCH', '0.0 MM', '5MM BEZEL').\n"
    "- `.tech-annotation-caption` — small italic serif caption for 'Fig. 1 — description' fig captions.\n"
    "- `.vignette-overlay` — full-screen radial darkening layer (z-index:50). "
    "Tween `opacity:0→1` over 0.6s with `power2.in` for cinematic scene-exit.\n\n"

    "**SVG FILTERS (pre-registered in global <defs>)**:\n"
    "- `filter=\"url(#roughen)\"` — hand-drawn wobble on any SVG `<path>/<rect>/<line>/<circle>`. "
    "Preserves stroke-dashoffset animation (LLM favorite — makes clean bezier paths look like architect sketches).\n"
    "- `filter=\"url(#roughen-strong)\"` — more aggressive wobble for bolder sketch feel.\n\n"

    "**PLATFORM CAPABILITIES**:\n"
    "1. **Math**: Use LaTeX: `$$ E=mc^2 $$` (renders via KaTeX).\n"
    "2. **Code**: Use `<pre><code class='language-python'>...</code></pre>` (Prism.js).\n"
    "3. **Diagrams**: Use `<div class='mermaid'>graph TD; A-->B;</div>` (Mermaid.js).\n"
    "4. **SVG Animations**: Draw lines, animate icons, show processes with `stroke-dashoffset`. NEVER draw letters, numbers, or words as SVG paths — hand-authored letterform paths render as illegible scribbles. Path-drawing is for shapes, arrows, diagrams, underlines, circles-around-things ONLY. Handwritten-LOOKING text must be REAL text in a handwriting font (e.g. Caveat, Shadows Into Light) revealed progressively (clip-path or per-word opacity), which stays legible at any size.\n"
    "5. **Images**: Use stock photos (preferred) or AI generation:\n"
    "   `<img class='generated-image' data-img-prompt='description' data-img-source='stock' src='placeholder.png' />`\n"
    "   - `data-img-source='stock'` **(PREFERRED)**: Real-world stock photography (Pexels).\n"
    "   - `data-img-source='generate'`: AI-generated. Use ONLY for: cutouts, fictional scenes, stylized art.\n"
    "   - Cutouts: add `data-cutout='true'` and end prompt with 'isolated on solid [color] background, clean edges'.\n"
    "   - **Subject continuity** (recurring character/product/location across shots): "
    "add `data-subject-id='stable_slug'` to the `<img>` tag. Use the SAME slug "
    "for every shot featuring that subject. The pipeline auto-detects most "
    "recurring subjects, but an explicit tag is the safest. The first shot "
    "generates normally; subsequent shots feed the cached image to Seedream "
    "as a reference so the subject looks identical across the timeline. "
    "Best for: PRODUCT_HERO chains, IMAGE_HERO/ANIMATED_ASSET sequences with a "
    "named character, brand reels.\n"
    "6. **Icons**: Iconify — `<iconify-icon icon='mdi:atom' width='48'></iconify-icon>`. "
    "Sets: `mdi:`, `lucide:`, `tabler:`, `noto:`, `fluent-emoji:`.\n"
    "7. **SVG Maps**: `<img src='https://vacademy-media.s3.ap-south-1.amazonaws.com/assets/maps/us.svg' class='map-svg'/>`. "
    "Animate with GSAP.\n\n"
) + SEEKABLE_MOTION_RULE

# ---------------------------------------------------------------------------
# Animation tools — shared reference for all shot types.
# Extracted from lines 728-810.
# ---------------------------------------------------------------------------

ANIMATION_TOOLS = (
    "**ANIMATION TOOLS AVAILABLE**:\n"
    "1. **Text Appearance** - fadeIn, typewriter, popIn, slideUp, showThenAnnotate\n"
    "2. **Vivus.js** - Draw SVG paths (handwriting effect): `animateSVG('id', 100);`. NEVER draw letters, numbers, or words as SVG paths — hand-authored letterform paths render as illegible scribbles. Path-drawing is for shapes, arrows, diagrams, underlines, circles-around-things ONLY. Handwritten-LOOKING text must be REAL text in a handwriting font (e.g. Caveat, Shadows Into Light) revealed progressively (clip-path or per-word opacity), which stays legible at any size.\n"
    "3. **Rough Notation** - Hand-drawn annotations: `annotate('#el', {type:'underline', color:'#dc2626'});`\n"
    "   Types: 'underline', 'circle', 'box', 'highlight', 'strike-through', 'bracket'\n"
    "4. **GSAP** - General animations (gsap.from, gsap.to, gsap.fromTo)\n"
    "5. **Howler.js** - Sound effects: `playSound('pop');`\n"
    "6. **KaTeX** - Math: `$$ E=mc^2 $$`\n"
    "7. **Mermaid** - Flowcharts: `<div class='mermaid'>graph TD; A-->B;</div>`\n"
    "8. **Iconify** - 275k+ icons: `<iconify-icon icon='mdi:name' width='48'></iconify-icon>`\n"
    "9. **splitReveal** - Cinematic text entrance: `splitReveal('#title', {type:'chars', stagger:0.03});`\n"
    "10. **gsap.delayedCall** — seekable timed callback: `gsap.delayedCall(2.5, () => annotate('#el', {type:'underline'}));` "
    "Use instead of setTimeout — it lives on the GSAP globalTimeline.\n"
    "11. **Anime.js** — Stagger grids, SVG morphing, spring physics. MUST register seekable instances with `_animeR()`. "
    "For ambient loops use `autoplay:true` (no registration needed).\n\n"

    "**ANIME.JS PATTERNS** (use for effects GSAP handles poorly):\n"
    "```javascript\n"
    "// --- Pattern A: Stagger grid entrance (halftone dots, icon grids, particle reveals) ---\n"
    "// Best for: arrays of dots/icons that should radiate from center outward\n"
    "const dotAnim = anime({\n"
    "  targets: '.dot',           // CSS selector resolved from shadow root\n"
    "  scale: [0, 1],\n"
    "  opacity: [0, 1],\n"
    "  delay: anime.stagger(40, {grid: [10, 10], from: 'center'}),\n"
    "  duration: 400,\n"
    "  easing: 'easeOutElastic(1, .5)',\n"
    "  autoplay: false,           // REQUIRED for frame-seeking\n"
    "});\n"
    "_animeR({instance: dotAnim, startMs: 0});  // register at 0ms into this shot\n\n"

    "// --- Pattern B: SVG morphing (shape transitions — FREE, unlike GSAP MorphSVG) ---\n"
    "// Best for: icon shape transforms, logo builds, concept transitions\n"
    "const morph = anime({\n"
    "  targets: '#shape path',\n"
    "  d: [\n"
    "    {value: 'M50,100 L150,100 L100,20 Z'},     // triangle\n"
    "    {value: 'M50,50 L150,50 L150,150 L50,150 Z'}  // square\n"
    "  ],\n"
    "  duration: 800,\n"
    "  easing: 'easeInOutQuart',\n"
    "  autoplay: false,\n"
    "});\n"
    "_animeR({instance: morph, startMs: 2000});  // starts 2s into the shot\n\n"

    "// --- Pattern C: Spring entrance (organic, physical feel) ---\n"
    "// Best for: badges, cards, UI elements that should feel physical\n"
    "const spring = anime({\n"
    "  targets: '#badge',\n"
    "  translateY: ['-120%', '0%'],\n"
    "  duration: 600,\n"
    "  easing: 'spring(1, 80, 10, 0)',  // mass, stiffness, damping, velocity\n"
    "  autoplay: false,\n"
    "});\n"
    "_animeR({instance: spring, startMs: 300});\n\n"

    "// --- Pattern D: Looping pulse / ambient glow (autoplay:true — no seek needed) ---\n"
    "// Best for: background rings, breathing effects, idle state indicators\n"
    "anime({  // Note: no _animeR() for loops — autoplay:true runs in real time\n"
    "  targets: '#ring',\n"
    "  scale: [1, 1.4],\n"
    "  opacity: [0.5, 0],\n"
    "  duration: 1200,\n"
    "  easing: 'easeOutSine',\n"
    "  loop: true,\n"
    "  autoplay: true,\n"
    "});\n"
    "```\n\n"

    "**ANIME.JS RULES**:\n"
    "- ALWAYS use `autoplay: false` + `_animeR({instance, startMs})` for any animation that should sync to narration.\n"
    "- `startMs` is milliseconds AFTER shot start when the animation begins (e.g. startMs:500 = triggers 0.5s into shot).\n"
    "- Use Anime.js INSTEAD OF GSAP for: stagger grids, SVG d-attribute morphing, spring physics.\n"
    "- Use GSAP for: timeline sequencing, motionPath, text splits, general tweens.\n"
    "- Ambient loops (breathing rings, idle pulses) can use `autoplay:true` — no registration needed.\n\n"

    "**TEXT APPEARANCE PATTERN (how text shows up in learning videos)**:\n"
    "```javascript\n"
    "fadeIn('#text', 0.5, 0);           // Simple fade (most common)\n"
    "popIn('#text', 0.4, 0);            // Subtle scale up\n"
    "typewriter('#text', 1.5, 0);       // Letter by letter\n"
    "showThenAnnotate('#text', '#key', 'underline', '#dc2626', 0, 0.8);  // All-in-one\n"
    "```\n\n"

    "**THE LEARNING VIDEO PATTERN**:\n"
    "1. Short text appears (1-2 lines matching narration)\n"
    "2. Pause briefly\n"
    "3. Key term gets annotated (underline/circle/highlight)\n"
    "4. Optional: diagram draws while annotation is visible\n\n"
)

# ---------------------------------------------------------------------------
# Educational design principles — shared.
# Extracted from lines 834-951.
# ---------------------------------------------------------------------------

EDUCATIONAL_PRINCIPLES = (
    "**EDUCATIONAL DESIGN PRINCIPLES**:\n"
    "1. **ONE CONCEPT AT A TIME**: Each shot = one idea. No clutter.\n"
    "2. **ANNOTATE KEY TERMS**: Use Rough Notation to underline/circle important words.\n"
    "3. **DRAW, DON'T JUST SHOW**: Use Vivus to draw diagrams as if sketching on a whiteboard.\n"
    "4. **SIMPLE TEXT**: Large, readable text. Key term + brief explanation. That's it.\n"
    "5. **SIGNALING**: Use arrows, circles, highlights to direct attention.\n\n"

    "**PROGRESSIVE DISCLOSURE (MANDATORY for complex concepts)**:\n"
    "Build understanding layer by layer within each shot:\n"
    "1. Show the main heading/question FIRST (delay: 0)\n"
    "2. Draw/reveal the first part of the diagram (delay: 2-3s, sync to word timing)\n"
    "3. Annotate the key term being spoken (sync to word timing)\n"
    "4. Add the next layer of detail (delay: 5-7s)\n"
    "Each reveal should ADD to what's on screen, NOT replace it.\n\n"

    "**DUAL CODING PRINCIPLE (MANDATORY)**:\n"
    "Every shot that introduces a new concept MUST include BOTH:\n"
    "1. TEXT (the concept name + brief explanation)\n"
    "2. A VISUAL (SVG diagram, flowchart, comparison, annotated image, or code block)\n"
    "Text-only shots are ONLY acceptable for Key Takeaway cards and LOWER_THIRD overlays.\n\n"
)

# ---------------------------------------------------------------------------
# Image prompt guidelines — shared.
# Extracted from lines 694-726.
# ---------------------------------------------------------------------------

IMAGE_PROMPT_GUIDELINES = (
    "**IMAGE PROMPT GUIDELINES (for data-img-prompt)**:\n"
    "Write descriptive, cinematic prompts (20-50 words) for AI image generation:\n"
    "- Specify style: 'realistic photograph', 'scientific illustration', 'watercolor'\n"
    "- Specify composition: 'close-up', 'wide shot', 'aerial view', 'cross-section'\n"
    "- Specify lighting: 'cinematic lighting', 'soft natural light', 'dramatic side lighting'\n"
    "- Specify aspect: always think {aspect_label}\n"
    "- AVOID: text in images, logos, watermarks, human faces\n"
    "DEFAULT TO STOCK. USE GENERATE only for: cutouts, fictional scenes, custom illustrations.\n\n"

    "**SHOT DISTRIBUTION** (scale to segment duration):\n"
    "- ~15s segment -> 2 shots | ~25s -> 3 shots | ~40s -> 4-5 shots\n"
    "- Real-world topics: ~50% shots with stock video/image backgrounds.\n"
    "- Abstract topics (math, code): video only for hooks/conclusions.\n\n"
)

# ---------------------------------------------------------------------------
# IMAGE ROUTING RULE — 4-tier decision tree taught to the per-shot LLM so it
# picks the right `data-img-source` upfront. Companion to the runtime cascade
# in automation_pipeline.py (which fixes wrong choices post-hoc).
# ---------------------------------------------------------------------------

IMAGE_ROUTING_RULE = (
    "**IMAGE SOURCE ROUTING — 4 TIERS** (pick the right `data-img-source` upfront):\n"
    "\n"
    "1. **`data-img-source=\"reference\"`** + `data-reference-url=\"<url>\"`\n"
    "   → For any entity listed in PRE-FETCHED REFERENCE IMAGES / BRAND ANCHOR.\n"
    "     These URLs are the HIGHEST-FIDELITY option — real photographs / the\n"
    "     user's own uploaded logo. Use them whenever the script mentions the\n"
    "     entity by name. NEVER ask AI generation to recreate a real brand logo.\n"
    "\n"
    "2. **`data-img-source=\"stock\"`** + `data-img-query=\"<3-6 keyword phrase>\"`\n"
    "   → For COMMON, generic subjects ('students library', 'office meeting',\n"
    "     'city skyline', 'success abstract'). Stock libraries (Pexels/Pixabay)\n"
    "     are keyword-search engines: short noun phrases retrieve well.\n"
    "     REQUIRED: emit BOTH `data-img-prompt` (cinematic description for the\n"
    "     pipeline's fallback to AI gen) AND `data-img-query` (3-6 keyword\n"
    "     phrase for the actual stock search). Example:\n"
    "       <img data-img-source=\"stock\"\n"
    "            data-img-prompt=\"cinematic wide shot of an office meeting...\"\n"
    "            data-img-query=\"office meeting professionals\"\n"
    "            src=\"placeholder.png\" />\n"
    "\n"
    "3. **`data-img-source=\"web\"`** + `data-img-query=\"<entity name + context>\"`\n"
    "   → For NAMED real-world subjects (people, places, products, events,\n"
    "     specific institutions), AND for any subject with cultural /\n"
    "     demographic specificity ('indian student studying', 'delhi street',\n"
    "     'iit delhi campus'). Stock can't index these well; Google Images can.\n"
    "     The pipeline filters web results for dimensions and host quality\n"
    "     before shipping. Example:\n"
    "       <img data-img-source=\"web\"\n"
    "            data-img-prompt=\"cinematic wide shot of the Indian Parliament...\"\n"
    "            data-img-query=\"sansad bhavan indian parliament building\"\n"
    "            src=\"placeholder.png\" />\n"
    "\n"
    "4. **`data-img-source=\"generate\"`** (AI image gen) — LAST RESORT\n"
    "   → For HYPER-SPECIFIC cultural moments that neither stock nor web can\n"
    "     serve (e.g. 'rural Bihar classroom 1990s'), fictional scenes, or\n"
    "     cutout assets (`data-cutout=\"true\"`). AI gen invents — do NOT use\n"
    "     it for real logos, real people, real landmarks (use reference/web).\n"
    "\n"
    "RULE OF THUMB: query length ≤ 3 generic words → stock; cultural / named\n"
    "subject → web; can't find it anywhere → generate.\n\n"
)


def build_cultural_context_block(cultural_context: Any) -> str:
    """Format the CulturalContext as a `<CULTURAL_CONTEXT>` block for the LLM.

    Returns empty string when `cultural_context` is None or its `region` is
    `"none"` (culture-agnostic content — no region keyword injection).
    Delegated to the dataclass's own `to_prompt_block` method so the format
    stays in one place; this wrapper just guards None.
    """
    if cultural_context is None:
        return ""
    try:
        return cultural_context.to_prompt_block() or ""
    except Exception:
        return ""

# ---------------------------------------------------------------------------
# DO NOT rules — shared.
# Extracted from lines 892-898.
# ---------------------------------------------------------------------------

DO_NOT_RULES = (
    "**DO NOT USE**:\n"
    "- Drop-shadows / box-shadows on elements\n"
    "- Glassmorphism or heavy blur effects (gradient scrims over images ARE fine)\n"
    "- Card-heavy layouts that look like apps\n"
    "- Fancy entrance animations for text (no flying/bouncing/spinning)\n"
    "- Gradient backgrounds on cards or containers (only on image overlays)\n"
    "- Rounded card grids that look like mobile UI\n"
    "- **setTimeout for animations** — use GSAP `delay:` or `gsap.delayedCall()` instead. setTimeout never fires in the renderer.\n\n"
)


# ---------------------------------------------------------------------------
# Aspirational variants — used at ultra / super_ultra to reduce templating.
#
# The defensive CORE_PREAMBLE + DO_NOT_RULES pair was tuned to keep cheap
# models inside a safe visual envelope. At ultra+ the model is capable enough
# that those guardrails become a uniformity tax: every shot inherits the same
# "exactly 2 text levels", "wrap in stage-drift", "no shadows / gradients /
# card grids" recipe and outputs converge on a single look.
#
# These aspirational variants keep the *technical* rails (named easing, no
# setTimeout, palette tokens from the shot pack, narration sync) and drop
# the *stylistic* bans, plus add an explicit override clause so any residual
# "mandatory stage-drift" / "SIMPLE TEXT" guidance still embedded in the
# shot-card or educational principles blocks below them is downgraded to a
# default suggestion instead of a hard requirement.
# ---------------------------------------------------------------------------

STAGING_KIT = (
    "\n**DOCUMENTARY STAGING KIT (preferred over flat panels)**:\n"
    "Reference documentaries do not put text on a background — they STAGE artifacts on a "
    "surface and let camera movement and annotation do the explaining. These classes are "
    "pre-injected; compose them:\n"
    "- GROUND (pick one, never a flat fill): `.stage-paper` (cream + faint grid), "
    "`.stage-slate` (dark + grid), `.stage-desk` (wood). Add `.stage-grid-patch` in a corner "
    "as a compositional accent.\n"
    "- ARTIFACT: wrap an image in `<div class='artifact'>` for a real shadow + slight tilt; "
    "add `.artifact-laid` so it lies ON the surface in perspective, `.artifact-tilt-r` to "
    "tilt the other way, `.print-frame` for a photo print, `.aged-edge` for an old document, "
    "`.film-strip` to frame footage or a still as 35mm.\n"
    "- ANNOTATION IS A CHARACTER: `<span class='marker-hl'>` draws a marker stroke over the "
    "exact words the narration is citing; `<hr class='swash-underline'>` is a hand-drawn "
    "underline. Use `annotate(...)` for circles/arrows. Point AT the evidence.\n"
    "- CHRONOLOGY: `.spine` (dashed axis) + `.spine-node` (ringed dot) for dated sequences, "
    "with items alternating sides.\n"
    "- CAMERA: prefer HOLDING one artifact and pushing in on the detail being narrated "
    "(`gsap.to(el,{scale:1.18, x:-90, duration:8, ease:'none'})`) over cutting to a new "
    "invented layout every beat. One artifact studied for 15s beats three panels of text.\n"
    "- Two or three staged objects with depth and shadow read as film. A centered headline "
    "over a flat rectangle reads as a slide deck. Choose the former.\n\n"
)

CORE_PREAMBLE_ASPIRATIONAL = (
    "You are an expert Educational Video Designer creating premium, distinctive visuals for LEARNING VIDEOS.\n"
    "Think: 3Blue1Brown, Vox Explained, Apple keynote inserts, top brand reels — visually rich, memorable, never templated.\n"
    "Two shots covering different ideas should never look like recolored copies of each other.\n\n"

    "**DESIGN PHILOSOPHY**:\n"
    "Design for visual impact. Each shot should feel intentionally composed for its specific narration and concept, "
    "not assembled from a recipe. Deviate from any default conventions in the guidance below when the narrative "
    "justifies it. Aim for a distinct composition every shot — different focal anchors, different rhythms, "
    "different visual metaphors — even within the same shot type.\n\n"

    "**TECHNICAL CORRECTNESS (still mandatory)**:\n"
    "- **EASING** — every GSAP tween MUST use a named ease (`expo.out`, `power3.out`, `back.out(1.6)`, "
    "`power2.inOut`, `circ.out`, etc.). Never use the default linear or omit `ease`.\n"
    "- **NO setTimeout** — the renderer seeks `gsap.globalTimeline` frame-by-frame. "
    "Use `gsap.to('#el', {delay:1.4})` or `gsap.delayedCall(1.4, fn)`. setTimeout never fires.\n"
    "- **PALETTE & TYPOGRAPHY TOKENS** — use the shot pack tokens supplied in the user prompt verbatim. "
    "Do not invent new colors, font sizes, spacings, or eases outside the shared design system; that is "
    "how cross-shot drift creeps in.\n"
    "- **NARRATION SYNC** — animate to the word timings provided. Reveals should land on emphasis words, "
    "not on round-number delays.\n"
    "- **LEGIBILITY** — display text remains readable: enough contrast vs. background, body and labels "
    "never below ~0.95rem for landscape / ~1.1rem for portrait.\n"
    "- **BACKGROUND CONTRACT** — the Director plan supplies a `background_treatment` field for "
    "every shot. Honor it; never invent your own background:\n"
    "    `brand_solid`    → `<div id='shot-root' style='background:var(--brand-bg);...'>`. Nothing else.\n"
    "    `brand_textured` → solid `var(--brand-bg)` plus the `.halftone` (or `.halftone-light` on "
    "dark bg) overlay class as a separate position:absolute layer behind hero content.\n"
    "    `brand_gradient` → `background:linear-gradient(135deg, var(--brand-bg) 0%, "
    "color-mix(in srgb, var(--brand-bg) 94%, #000) 100%);` (6% darker stop).\n"
    "    `media_hero`     → the visible media (stock video / hero image / SVG illustration) is the "
    "background. Use the asset to fill the canvas; no separate brand-bg layer.\n"
    "  NEVER use hand-picked hex (`#fff`, `#000`, `#0a0e27`, etc.) as a shot background. The "
    "`var(--brand-bg)` CSS variable resolves to the institute's brand color — using literal hex "
    "produces the 'six different backgrounds in one video' bug we just spent a sprint fixing.\n"
    "- **WHITESPACE-SAFE ACCENT WORDS** — when applying a different color to a word mid-phrase, the "
    "space BEFORE the colored span often gets eaten by CSS (adjacent inline-block spans collapse; "
    "`display:inline-block` kills the leading whitespace). Always insert `&nbsp;` explicitly at the "
    "boundary, like:\n"
    "    `STARTS&nbsp;<span style=\"color:var(--brand-accent)\">HERE</span>` ✓\n"
    "    `STARTS <span style=\"color:var(--brand-accent)\">HERE</span>` ✗ (may render as STARTSHERE)\n"
    "    `<span>STARTS</span><span style=\"color:...\">HERE</span>` ✗ (definitely STARTSHERE)\n"
    "  Same rule applies BEFORE any colored span, inline-block, or word-wipe element that holds a "
    "single word. For word-wipe motion, each `<div style='overflow:hidden'>` wrapper should hold "
    "the whole word plus any trailing `&nbsp;` it needs.\n\n"

    "**WHAT TO PURSUE (aspirational, not prescriptive)**:\n"
    "- Distinctive composition: hero asymmetry, layered SVG illustration, large-scale type, deliberate "
    "negative space, unexpected framing, off-axis anchors. Avoid centered hero+sub on every shot.\n"
    "- Rich custom SVG: hand-crafted diagrams, annotated illustrations, motion-pathed elements, draw-on "
    "strokes — not just stock icons placed on a flat background. SVG is your strongest tool here; use it.\n"
    "- Multiple ambient motion layers (target 3+): drift on the composition wrapper, breathing/yoyo on a "
    "secondary subject, slow rotation or opacity pulse on a background pattern, glow pulse on a hero "
    "element. One `.stage-drift` tween is NOT enough on its own — design at least three independent "
    "loops on different DOM layers so no part of the frame is ever fully still.\n"
    "- **Second-beat motion (back-half life)**: every shot ≥3s MUST include at least one tween that "
    "fires in the back half — i.e. a GSAP tween with `delay >= 0.55 × shot_duration`. The 'fade in "
    "then sit' pattern (every animation at delay ≤ 0.6s, then the canvas stares at the viewer for 2s) "
    "makes shots feel like still frames — a recurring symptom in the v2026-05 audit. Add a delayed "
    "secondary reveal, an accent bar that slides in late, a number that rolls, a label that "
    "cross-fades to a follow-up label, a background watermark that scales in. Pull the delay from "
    "the WORD TIMINGS table where possible — back-half beats should land on an emphasis word, not "
    "on a round number like 2.0s. The animation density validator enforces this; shots that fail "
    "trigger a corrective regen.\n"
    "- Built UI over photographed UI: when the narration depicts a digital interaction (phone, app, "
    "chat, browser, code editor, dashboard, document), CONSTRUCT the interface in HTML/CSS — frame, "
    "status bar, header, message bubbles, metadata strips — so every element can animate to narration. "
    "Stock photos of phones or screens read as generic and cannot choreograph; reserve stock photography "
    "for atmospherics, hooks, and real-world subjects (people, places, materials).\n"
    "- Typography as a graphic element: scale, tracking, kinetic splits, paired display + small-caps label. "
    "Use 2 levels when minimal is right, 3 when the content demands hierarchy. The 'exactly 2 levels' "
    "rule is a default, not a ceiling.\n"
    "- Effects judged by impact: shadows, gradients, blur, glassmorphism are ALLOWED when they serve "
    "the composition (depth, focus, mood, separation). Avoid them when they're decorative noise. "
    "Default = no effect; override with intent.\n"
    "- **3D PERSPECTIVE LAYERS** — for parallax depth, declare `style='perspective:1200px'` on the "
    "shot's outermost wrapper, then use `transform:translateZ(-Npx)` on background layers and "
    "`transform:translateZ(+Npx)` on hero layers. Combined with the `.stage-drift` x/y tween, you get "
    "true parallax (closer layers move faster) without per-element animation. Use sparingly — heavy "
    "z-translation on >3 layers gets visually noisy. Card flips with `rotateY()` are a separate "
    "valid use case for hard cuts between sub-compositions inside one shot.\n"
    "- **SVG FILTERS (premium polish)** — beyond the pre-registered `roughen` filter, you can define "
    "and use `motion-blur`, `glow`, and `displace` filters inline in `<defs>`:\n"
    "    `<filter id='hero-blur'><feGaussianBlur stdDeviation='0 4'/></filter>` (anisotropic motion blur on x-axis)\n"
    "    `<filter id='hero-glow'><feGaussianBlur stdDeviation='6'/><feMerge><feMergeNode/><feMergeNode in='SourceGraphic'/></feMerge></filter>`\n"
    "  Apply via `filter='url(#hero-blur)'` on the relevant `<g>` or `<text>`. Reserve motion-blur "
    "for fast-moving hero elements (whip-pan reveals, slam-in titles) where the blur sells the speed.\n"
    "- **BRANDED EASING VOCABULARY** — the shot_pack (supplied to you as JSON in the user prompt) "
    "carries named eases at `shot_pack.ease.entry`, `.exit`, `.emphasis`, `.snappy`, `.settle`. "
    "These are LOOKUP KEYS — read the resolved value from the shot_pack JSON and INLINE it in your "
    "GSAP. Example: if the shot_pack shows `ease: { snappy: 'expo.out', entry: 'power3.out' }`, "
    "write `gsap.to('#el', {opacity:1, duration:0.4, ease:'expo.out'})` — i.e. the literal "
    "string `'expo.out'`. NEVER write `ease: shot_pack.ease.snappy` literally in JS — "
    "`shot_pack` isn't a runtime variable; it's a Python-side construct. Picking eases from this "
    "vocabulary instead of ad-hoc `power2.out` keeps the video's motion language consistent — what "
    "makes the result feel 'designed' rather than 'generated'.\n\n"

    "**MULTI-ACT STRUCTURE FOR LONG SHOTS**:\n"
    "If your shot's duration is ≥12s AND the narration crosses two or more distinct sentences/ideas, "
    "do NOT stretch one composition across the whole hold. Build 2–3 visually distinct sub-compositions "
    "(acts) and CUT between them on sentence boundaries. Each act gets its own layout, its own focal "
    "subject, and its own typographic treatment; the cut is a hard transition, not a fade.\n"
    "Cut utilities are PRE-INJECTED in the global stylesheet — use them directly, do not redeclare:\n"
    "- `.flash.white`, `.flash.red`, `.flash.black` — full-screen flash overlays at z-index 55. "
    "`.flash.red` uses `mix-blend-mode:difference` for an aggressive warning cut.\n"
    "- `.glitch-cut` — chromatic-aberration flicker (0.18s) at z-index 56, triggered by "
    "`gsap.set('.glitch-cut', {display:'block'})`.\n"
    "Layout your acts as siblings inside the `.stage-drift` wrapper, each starting at opacity 0:\n"
    "```html\n"
    "<div class='stage-drift'>\n"
    "  <div id='act-1' class='act'>...</div>\n"
    "  <div id='act-2' class='act' style='opacity:0'>...</div>\n"
    "  <div id='act-3' class='act' style='opacity:0'>...</div>\n"
    "</div>\n"
    "<div class='flash white' id='flash-white'></div>\n"
    "<div class='flash red'   id='flash-red'></div>\n"
    "```\n"
    "Cut pattern at timestamp T:\n"
    "```js\n"
    "gsap.to('#flash-white', {opacity:0.7, duration:0.07, delay:T, ease:'none',\n"
    "  onComplete: () => gsap.to('#flash-white', {opacity:0, duration:0.25, ease:'power2.out'})});\n"
    "gsap.to('#act-2', {opacity:1, duration:0.5, delay:T, ease:'power3.inOut'});\n"
    "// previous act stays visible underneath; flash hides the swap\n"
    "```\n"
    "A 20s shot covering 4 sentences should typically be 3 acts; pace the cuts to land on sentence "
    "boundaries from the WORD TIMINGS table, not on round-number delays.\n\n"

    "**PERSIST-AND-MORPH (continuity across beats)**:\n"
    "When a later beat is a variation of an earlier one — a diagram gaining a label, a shape becoming "
    "the next shape, a number rolling, a chart growing a bar — TRANSFORM the existing element instead "
    "of clearing it and redrawing. Matching parts stay put; only the differences move. This is what "
    "makes an explainer feel like one continuous thought instead of a slideshow.\n"
    "- **Stable semantic ids**: give persistent elements meaningful ids (`#orbit`, `#cell`, "
    "`#equation-lhs`) and REUSE the same id across beats/acts. Animate the SAME node forward; do not "
    "create `#cell-2` to replace `#cell`.\n"
    "- **How to morph** (true GSAP MorphSVG is NOT available — use these): position/scale/rotation → "
    "`gsap.to('#id', {x,y,scale,rotation,duration,ease})` on the persistent node; SVG outline change → "
    "Anime.js `d`-attribute morph (Pattern B) on the SAME `<path>`; layout reflow → FLIP by hand (read "
    "old box, set new layout, `gsap.from('#id', {x:dx,y:dy})`) or call `morphElement('#id', {...})` if "
    "that helper is available; genuine swap → CROSS-FADE on a shared anchor (new enters opacity 0 over "
    "the old, old fades as new rises). Never a hard clear-then-draw on a continuity element.\n"
    "Reserve hard cuts (the flash/glitch act-cuts above) for genuinely NEW compositions; use "
    "persist-and-morph when the next beat continues the current one.\n\n"

    "**FOCUS-BY-SUPPRESSION (one subject per beat)**:\n"
    "Each beat has ONE focal element — the thing the narration is about right now. On that beat, PUSH "
    "BACK everything else so the eye goes straight to the focus, using the stable ids above. If the "
    "`setFocus(focusSel, dimSel)` / `dimOthers(...)` helpers are available use them; otherwise plain GSAP:\n"
    "```js\n"
    "// at the beat's Rel(s) delay T, focusing #cell:\n"
    "gsap.to(['#label','#legend','#bg-diagram'], {opacity:0.35, filter:'saturate(0.4)', scale:0.97, duration:0.4, ease:'power2.out', delay:T});\n"
    "gsap.to('#cell', {opacity:1, filter:'saturate(1)', scale:1.04, duration:0.4, ease:'expo.out', delay:T});\n"
    "```\n"
    "When focus moves to the next subject on a later beat, RESTORE the previous one (opacity:1, "
    "filter:'saturate(1)', scale:1) as you suppress the new non-focal set — focus shifts, it doesn't "
    "accumulate dimming. Group non-focal selectors in one array (one tween). Keep suppressed opacity "
    "≥0.3 so context stays legible — de-emphasis, not removal. A suppression/lift on an emphasis word "
    "also counts as your back-half second-beat motion.\n\n"

    "**PLAN BEFORE YOU CODE — TIMELINE MAP**:\n"
    "Begin your `<script>` block with a TIMELINE MAP comment that lists every narration phrase with its "
    "absolute timestamp and the animation it triggers. Then implement against the map. Every emphasis "
    "word in the WORD TIMINGS table should anchor at least one beat — reveals, annotations, scale "
    "punches, color swaps, cuts. Round-number delays (1.0s, 2.0s, 3.0s) are a sign you ignored the "
    "timing data; pull `delay:` values from the Rel(s) column.\n"
    "Format:\n"
    "```js\n"
    "/* TIMELINE MAP — Total: 20.0s\n"
    "   ──────────────────────────────────────\n"
    "   ACT 1 (0.0s – 10.0s) — \"protect your investment, demand transparency\"\n"
    "     0.40s  eyebrow + sub-line fade in        (\"protect\")\n"
    "     2.50s  headline word 1 slam              (\"demand\")\n"
    "     3.10s  headline word 2 slam              (\"transparency\")\n"
    "     4.00s  phone enters from right\n"
    "     4.70s  proof msg 1 + receipt check 1     (\"photos / fabric arrives\")\n"
    "     6.40s  proof msg 2 + receipt check 2     (\"video / sewing lines\")\n"
    "     8.10s  proof msg 3 + receipt check 3     (\"pre-shipment report\")\n"
    "   ACT 2 (10.0s – 15.5s) — \"you aren't a partner — you're a gamble\"\n"
    "     10.00s red flash + cut to act 2\n"
    "     12.60s line1 reveal                       (\"you aren't a partner\")\n"
    "     13.60s strike-through on \"partner\"\n"
    "     14.10s headline slam                      (\"GAMBLE\")\n"
    "   ACT 3 (15.5s – 20.0s) — \"a real brand, from a hobby\"\n"
    "     15.50s white flash + cut to act 3\n"
    "     16.95s brand-side reveal                  (\"a real brand\")\n"
    "     18.10s vs-text reveal                     (\"from\")\n"
    "     18.55s hobby-side reveal                  (\"a hobby\")\n"
    "*/\n"
    "```\n"
    "This is not optional polish — the planning step is what produces choreographed shots instead of "
    "decorated ones.\n\n"

    "**VISUAL-NARRATION LOCK (extends the TIMELINE MAP)**:\n"
    "The element that MOVES on a given beat must BE the grammatical subject of the phrase spoken at "
    "that timestamp. When the narration says 'the cell divides', the cell animates — not a label, not "
    "the background. Two hard rules:\n"
    "  1. NEVER animate a concept that isn't being narrated right now — no decorative reveals on words "
    "the script never says. Every TIMELINE MAP entry already cites the narrated phrase that triggers "
    "it; make the moving element match the noun in that phrase.\n"
    "  2. NEVER narrate a concept with no corresponding visual change — if the phrase introduces a new "
    "idea, SOMETHING must move, reveal, transform, or get signaled on that beat. A spoken idea over a "
    "static frame is a missed beat.\n"
    "Ambient loops (drift, breathing, glow) are exempt — they're texture, not beats; the lock governs "
    "the narration-triggered reveals in your map.\n\n"

    "**SEMANTIC ACCENT COLOR**:\n"
    "When the Director detects a narration contrast (warning vs success, real vs fake, before vs after, "
    "right vs wrong), it flags the shot with `semantic_accents: [...]` and the pipeline injects a "
    "**🎨 SEMANTIC ACCENTS FOR THIS SHOT** block into the user prompt below containing the canonical "
    "hex values to use. Define those as local CSS vars in your `<style>` block and apply them ONLY "
    "to the contrasting element — the rest of the composition stays on the brand palette so cohesion "
    "holds. The injected vars are: `--warn` (danger/red-flag), `--good` (success/check), `--gold` "
    "(premium/elevated).\n"
    "If no semantic-accent block appears in the user prompt, this shot is descriptive without a "
    "contrast — do NOT introduce off-brand colors on your own initiative. Use the brand palette only.\n\n"

    "**CSS UTILITIES (available toolkit, NOT requirements)**:\n"
    "- `.halftone`, `.halftone-light` — dot-texture overlays\n"
    "- `.flat-badge` — flat colored callout, no border-radius\n"
    "- `.slam-wrapper` + `.slam-text` — overflow-hidden translateY reveal container\n"
    "- `.tracking-label` — small-caps tracking label (Inter, letter-spacing:0.3em)\n"
    "- `.svg-canvas` — cream #f5f0e8 illustrated background with grid\n"
    "- `.product-stage` — full-screen relative container for layered subjects\n"
    "- `.stage-drift` — ambient composition drift wrapper. Use when a slow camera feel suits the shot; "
    "skip when the shot has its own internal motion or wants a static, framed feel.\n"
    "- `.draft-guide` / `.solid-overlay` — blueprint two-phase reveal pair\n"
    "- `.paper-texture`, `.paper-texture.strong` — parchment grain overlay\n"
    "- `.tech-annotation`, `.tech-annotation-label`, `.tech-annotation-caption` — red dashed engineer "
    "annotations (the one allowed utility color outside the shot-pack palette)\n"
    "- `.vignette-overlay` — radial darkening for cinematic exits\n\n"

    "**SVG FILTERS (pre-registered)**:\n"
    "- `filter=\"url(#roughen)\"` — hand-drawn wobble; preserves stroke-dashoffset animation\n"
    "- `filter=\"url(#roughen-strong)\"` — bolder sketch feel\n\n"

    "**PLATFORM CAPABILITIES**:\n"
    "1. **Math**: `$$ E=mc^2 $$` (KaTeX).\n"
    "2. **Code**: `<pre><code class='language-python'>...</code></pre>` (Prism.js).\n"
    "3. **Diagrams**: `<div class='mermaid'>graph TD; A-->B;</div>`.\n"
    "4. **SVG Animations**: stroke-dashoffset draws, motion paths, morph transforms via Anime.js. NEVER draw letters, numbers, or words as SVG paths — hand-authored letterform paths render as illegible scribbles. Path-drawing is for shapes, arrows, diagrams, underlines, circles-around-things ONLY. Handwritten-LOOKING text must be REAL text in a handwriting font (e.g. Caveat, Shadows Into Light) revealed progressively (clip-path or per-word opacity), which stays legible at any size.\n"
    "5. **Images**: stock-first, AI-generate for cutouts / fictional / stylized art. Use "
    "`data-subject-id='stable_slug'` for recurring subjects across shots.\n"
    "6. **Icons**: `<iconify-icon icon='mdi:atom' width='48'></iconify-icon>` "
    "(sets: mdi:, lucide:, tabler:, noto:, fluent-emoji:).\n"
    "7. **SVG Maps**: `https://vacademy-media.s3.ap-south-1.amazonaws.com/assets/maps/us.svg`.\n\n"

    "**OVERRIDES OVER ANY GUIDANCE BELOW**:\n"
    "The shot card, educational principles, and any other guidance after this preamble may contain directives "
    "such as 'wrap content in `.stage-drift`', 'exactly 2 text levels', 'SIMPLE TEXT — that's it', "
    "'NO APP-LIKE CARDS', or lists of effects to avoid. In aspirational mode those are DEFAULT suggestions, "
    "not requirements. If a different composition, hierarchy, or effect serves this shot's narration and "
    "visual concept better, take that path. The technical rails above (easing, no setTimeout, palette tokens, "
    "narration sync, legibility) remain hard requirements.\n\n"
) + SEEKABLE_MOTION_RULE

# ---------------------------------------------------------------------------
# Marketing / bold mode — a COMPILED design language, not an override.
#
# Craft-review finding (2026-07-07): marketing runs previously received the
# full educational/whiteboard doctrine (persona, flat bans, DUAL CODING text
# mandates, whiteboard example code) followed by a prose-only "premium
# override" — and the concrete whiteboard examples beat the prose every time.
# These blocks REPLACE the educational persona/principles for marketing/bold
# runs so the prompt makes one coherent argument, and MARKETING_EXAMPLES
# below swaps each key shot card's exemplar so the strongest signal in the
# prompt (example code) demonstrates the premium look instead of fighting it.
# ---------------------------------------------------------------------------

MARKETING_PREAMBLE = (
    "You are a senior motion designer at a premium brand studio — the person who makes "
    "launch films for Apple, Linear, Stripe, and Vercel. You are composing ONE shot of a "
    "short brand film. It must look expensive, intentional, and finished.\n\n"

    "**CRITICAL — QUALITY STANDARDS**:\n"
    "- **EASING IS MANDATORY** — every GSAP tween MUST use a named ease. Entrances: "
    "`expo.out` / `power3.out`; hero pops: `back.out(1.4)`; settles: `power2.inOut`. "
    "NEVER default linear.\n"
    "- **DEPTH IS PREMIUM** — layer the frame: a rich background (soft gradient mesh, "
    "brand-tinted vignette, faint texture) behind an elevated hero surface "
    "(`box-shadow: 0 24px 60px -20px rgba(0,0,0,.35)`, 12–28px radii, hairline border). "
    "Never a dead-flat fill behind a headline.\n"
    "- **TYPOGRAPHY IS THE HERO** — big confident type, tight tracking, strong weight "
    "contrast (one ultra-bold line + one light line), one accent-colored key word. "
    "≤ 5 words per headline. Set headlines in `var(--font-display)` and body/labels in "
    "`var(--font-body)` — the run's design identity resolves them; never hardcode a family.\n"
    "- **CONTINUOUS LIFE** — no frame is ever static: a slow Ken-Burns/parallax on media, "
    "a gentle float on the hero, a shimmer across a key word. Shots ≥3s need a tween "
    "firing in the back half (`delay >= 0.55 × shot_duration`).\n"
    "- **NARRATION LOCK** — the element you animate on each beat must be the SUBJECT of "
    "the phrase spoken at that moment (use the Rel(s) word-timing as the delay).\n"
    "- **BACKGROUND TREATMENT** — honor the Director's `background_treatment` token "
    "(`brand_solid` / `brand_textured` / `brand_gradient` / `media_hero`) as the BASE "
    "layer; build your mesh/vignette/texture ON TOP of it with the brand palette. "
    "Never invent a hand-picked hex.\n"
    "- **WHITESPACE-SAFE ACCENT WORDS** — when coloring a word mid-phrase, insert "
    "`&nbsp;` explicitly before the span: "
    "`STARTS&nbsp;<span style=\"color:var(--brand-accent)\">HERE</span>` — otherwise "
    "adjacent inline-block spans collapse the space and render as STARTSHERE.\n"
    "- **NO setTimeout** — the renderer seeks `gsap.globalTimeline` frame-by-frame. "
    "Use GSAP `delay:` or `gsap.delayedCall()`. setTimeout never fires.\n\n"
) + SEEKABLE_MOTION_RULE

MARKETING_PRINCIPLES = (
    "**BRAND-FILM DESIGN PRINCIPLES**:\n"
    "1. **ONE FOCAL IDEA PER SHOT** — a single hero moment, composed deliberately. "
    "Imagery leads; text supports.\n"
    "2. **KEYWORDS, NEVER THE NARRATION** — the narration is SPOKEN; putting the same "
    "sentence on screen is the #1 tell of robotic AI video. On-screen text = a punchy "
    "headline (≤5 words), a stat, a label. NO body paragraphs, NO caption sentences, "
    "NO bullet lists of full sentences.\n"
    "3. **EVERY ELEMENT EARNS A VISUAL** — a feature/step/stat never appears as a bare "
    "text row: pair it with a meaningful `<iconify-icon>` in a brand-tinted chip, a "
    "photo, a device frame, or an animated SVG shape.\n"
    "4. **RESTRAINT IS ALSO PREMIUM** — one perfect full-bleed image with a 3-word "
    "headline can beat any busy composition. When the beat is emotional, show LESS: "
    "large negative space is a deliberate, welcome choice.\n"
    "5. **CHOREOGRAPH THE REVEAL** — elements arrive in a deliberate stagger synced to "
    "the narration's word timing; each reveal ADDS to the frame, never replaces it.\n\n"
)

# Guideline lines dropped from shot cards in marketing mode — they prescribe
# the whiteboard look the compiled preamble no longer wants.
_MARKETING_GUIDELINE_BANS = (
    "cream",
    "Never a dark background",
    "flat colored",
    "no box-shadow",
    "zero border-radius",
    "white text with text-shadow",
)


# Marketing exemplars — swapped in for the card's html_template/script_block
# in marketing/bold mode. Each demonstrates the compiled design language:
# layered background (mesh + texture over the brand base), elevated hero
# surface with soft shadow, iconify chips, staggered eased entrances with
# blur-in, an accent word, and a back-half tween. The example is the
# strongest signal in the prompt — it must SHOW the premium look.
MARKETING_EXAMPLES: Dict[str, Dict[str, str]] = {
    "IMAGE_HERO": {
        "html": (
            "<div class='image-hero' style='position:relative; overflow:hidden;'>\n"
            "  <img class='generated-image'\n"
            "       data-img-prompt='editorial photograph, confident founder in a sunlit studio, shallow depth of field, cinematic color grade, {aspect_label}'\n"
            "       data-ken-burns='zoom-in' src='placeholder.png' />\n"
            "  <!-- brand-tinted vignette + bottom scrim: depth over the photo -->\n"
            "  <div style='position:absolute; inset:0;\n"
            "       background: radial-gradient(120% 90% at 70% 20%, transparent 55%, rgba(0,0,0,.45)),\n"
            "                   linear-gradient(to top, rgba(0,0,0,.55), transparent 45%);'></div>\n"
            "  <div style='position:absolute; left:6%; bottom:10%; max-width:44%;'>\n"
            "    <div id='hero-label' style='opacity:0; display:inline-flex; align-items:center; gap:.5em;\n"
            "         padding:.45em .9em; border-radius:999px; border:1px solid rgba(255,255,255,.35);\n"
            "         backdrop-filter:blur(8px); color:#fff; font:600 .95rem var(--font-body);\n"
            "         letter-spacing:.22em;'>\n"
            "      <iconify-icon icon='mdi:lightning-bolt' width='18'></iconify-icon> LAUNCH WEEK\n"
            "    </div>\n"
            "    <h1 id='hero-title' style='opacity:0; margin:.35em 0 0; color:#fff;\n"
            "        font:800 6.5rem/1.02 var(--font-display); letter-spacing:-0.02em;'>\n"
            "      Built to&nbsp;<span style='color:var(--brand-accent)'>win</span>\n"
            "    </h1>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script": (
            "gsap.fromTo('#hero-label', {opacity:0, y:24, filter:'blur(8px)'},\n"
            "  {opacity:1, y:0, filter:'blur(0px)', duration:.7, delay:.4, ease:'expo.out'});\n"
            "gsap.fromTo('#hero-title', {opacity:0, y:44, filter:'blur(10px)'},\n"
            "  {opacity:1, y:0, filter:'blur(0px)', duration:.9, delay:.75, ease:'power3.out'});\n"
            "// back-half: the accent word breathes so the frame never sits still\n"
            "gsap.to('#hero-title span', {opacity:.75, yoyo:true, repeat:-1, duration:1.6,\n"
            "  delay:2.4, ease:'power2.inOut'});\n"
        ),
    },
    "PRODUCT_HERO": {
        "html": (
            "<div class='svg-canvas' style='position:relative; display:flex; align-items:center;\n"
            "     justify-content:center; overflow:hidden;'>\n"
            "  <!-- layered bg: mesh glow + halftone texture over the brand base -->\n"
            "  <div style='position:absolute; inset:0;\n"
            "       background: radial-gradient(60% 55% at 30% 25%, color-mix(in srgb, var(--brand-accent) 22%, transparent), transparent 70%),\n"
            "                   radial-gradient(50% 60% at 78% 75%, color-mix(in srgb, var(--brand-primary) 18%, transparent), transparent 70%);'></div>\n"
            "  <div class='halftone' style='position:absolute; inset:0; opacity:.16;'></div>\n"
            "  <div id='ph-stage' style='position:relative; display:flex; align-items:center; gap:4.5rem;'>\n"
            "    <img id='ph-product' class='generated-image'\n"
            "         data-img-prompt='premium product photograph, floating at a slight angle, studio rim light, isolated, {aspect_label}'\n"
            "         data-cutout src='placeholder.png'\n"
            "         style='opacity:0; width:34vw; filter: drop-shadow(0 40px 70px rgba(0,0,0,.45));' />\n"
            "    <div style='max-width:34vw;'>\n"
            "      <span id='ph-kicker' style='opacity:0; display:block; color:var(--brand-accent);\n"
            "            font:600 1rem var(--font-body); letter-spacing:.28em;'>MEET THE NEW</span>\n"
            "      <h1 id='ph-name' style='opacity:0; margin:.15em 0; color:var(--brand-text);\n"
            "          font:800 5.4rem/1 var(--font-display); letter-spacing:-0.02em;'>Studio&nbsp;Pro</h1>\n"
            "      <div id='ph-chip' style='opacity:0; display:inline-flex; align-items:center; gap:.5em;\n"
            "           margin-top:.6em; padding:.5em 1em; border-radius:14px;\n"
            "           background: color-mix(in srgb, var(--brand-primary) 14%, transparent);\n"
            "           border:1px solid color-mix(in srgb, var(--brand-primary) 35%, transparent);\n"
            "           box-shadow: 0 18px 44px -18px rgba(0,0,0,.35); color:var(--brand-text);\n"
            "           font:600 1.05rem var(--font-body);'>\n"
            "        <iconify-icon icon='mdi:rocket-launch' width='22'></iconify-icon> 2× faster\n"
            "      </div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script": (
            "gsap.fromTo('#ph-product', {opacity:0, y:60, rotate:-6, scale:.92},\n"
            "  {opacity:1, y:0, rotate:0, scale:1, duration:1.1, delay:.3, ease:'back.out(1.4)'});\n"
            "gsap.fromTo('#ph-kicker', {opacity:0, y:18}, {opacity:1, y:0, duration:.6, delay:.9, ease:'expo.out'});\n"
            "gsap.fromTo('#ph-name', {opacity:0, y:30, filter:'blur(8px)'},\n"
            "  {opacity:1, y:0, filter:'blur(0px)', duration:.8, delay:1.05, ease:'power3.out'});\n"
            "gsap.fromTo('#ph-chip', {opacity:0, scale:.8}, {opacity:1, scale:1, duration:.55, delay:1.5, ease:'back.out(1.6)'});\n"
            "// back-half: product floats; glow drifts\n"
            "gsap.to('#ph-product', {y:-14, yoyo:true, repeat:-1, duration:2.6, delay:2, ease:'power2.inOut'});\n"
        ),
    },
    "DEVICE_MOCKUP": {
        "html": (
            "<div class='svg-canvas' style='position:relative; display:flex; align-items:center;\n"
            "     justify-content:center; overflow:hidden;'>\n"
            "  <div style='position:absolute; inset:0;\n"
            "       background: radial-gradient(70% 60% at 50% 0%, color-mix(in srgb, var(--brand-primary) 16%, transparent), transparent 75%);'></div>\n"
            "  <!-- laptop frame: chrome built AROUND the screen; animate the DEVICE -->\n"
            "  <div id='dm-device' style='opacity:0; position:relative; width:58vw; border-radius:18px;\n"
            "       background:#0b0d12; padding:1.1rem 1.1rem 1.6rem; border:1px solid rgba(255,255,255,.08);\n"
            "       box-shadow: 0 34px 80px -24px rgba(0,0,0,.55);'>\n"
            "    <div style='display:flex; gap:.45em; margin-bottom:.8rem;'>\n"
            "      <span style='width:.75em;height:.75em;border-radius:50%;background:#ff5f57'></span>\n"
            "      <span style='width:.75em;height:.75em;border-radius:50%;background:#febc2e'></span>\n"
            "      <span style='width:.75em;height:.75em;border-radius:50%;background:#28c840'></span>\n"
            "    </div>\n"
            "    <div style='border-radius:10px; overflow:hidden; aspect-ratio:16/9; background:#11141b;'>\n"
            "      <!-- the screen content: real screenshot when provided, else composed UI -->\n"
            "      <img class='generated-image' data-img-prompt='clean modern SaaS dashboard interface, dark theme, data cards, {aspect_label}'\n"
            "           src='placeholder.png' style='width:100%; height:100%; object-fit:cover; object-position:top;' />\n"
            "    </div>\n"
            "  </div>\n"
            "  <div id='dm-callout' style='opacity:0; position:absolute; right:8%; top:18%;\n"
            "       display:flex; align-items:center; gap:.6em; padding:.7em 1.1em; border-radius:14px;\n"
            "       background: color-mix(in srgb, var(--brand-bg) 70%, transparent); backdrop-filter: blur(10px);\n"
            "       border:1px solid color-mix(in srgb, var(--brand-accent) 40%, transparent);\n"
            "       box-shadow: 0 18px 44px -16px rgba(0,0,0,.4); color:var(--brand-text);\n"
            "       font:700 1.3rem var(--font-body);'>\n"
            "    <iconify-icon icon='mdi:trending-up' width='26' style='color:var(--brand-accent)'></iconify-icon>\n"
            "    +40% enrollments\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script": (
            "gsap.fromTo('#dm-device', {opacity:0, y:70, rotateX:8, scale:.94},\n"
            "  {opacity:1, y:0, rotateX:0, scale:1, duration:1.0, delay:.35, ease:'power3.out'});\n"
            "gsap.fromTo('#dm-callout', {opacity:0, x:30, scale:.85},\n"
            "  {opacity:1, x:0, scale:1, duration:.6, delay:1.4, ease:'back.out(1.5)'});\n"
            "// back-half: subtle device parallax keeps the frame alive\n"
            "gsap.to('#dm-device', {y:-10, yoyo:true, repeat:-1, duration:3, delay:2.2, ease:'power2.inOut'});\n"
        ),
    },
    "DATA_STORY": {
        "html": (
            "<div class='svg-canvas' style='position:relative; display:flex; flex-direction:column;\n"
            "     align-items:center; justify-content:center; overflow:hidden;'>\n"
            "  <div style='position:absolute; inset:0;\n"
            "       background: radial-gradient(55% 50% at 50% 30%, color-mix(in srgb, var(--brand-accent) 14%, transparent), transparent 75%);'></div>\n"
            "  <span id='ds-label' style='opacity:0; color:var(--brand-text); opacity:.7;\n"
            "        font:600 1rem var(--font-body); letter-spacing:.3em;'>CONVERSION LIFT</span>\n"
            "  <div id='ds-num' style='opacity:0; display:flex; align-items:baseline; gap:.15em; margin:.1em 0;\n"
            "       color:var(--brand-accent); font:800 11rem/1 var(--font-display); letter-spacing:-0.03em;\n"
            "       text-shadow: 0 30px 60px color-mix(in srgb, var(--brand-accent) 35%, transparent);'>\n"
            "    <span id='ds-count'>0</span><span style='font-size:.45em'>%</span>\n"
            "  </div>\n"
            "  <div id='ds-context' style='opacity:0; display:inline-flex; align-items:center; gap:.55em;\n"
            "       padding:.55em 1.1em; border-radius:999px;\n"
            "       background: color-mix(in srgb, var(--brand-primary) 12%, transparent);\n"
            "       border:1px solid color-mix(in srgb, var(--brand-primary) 30%, transparent);\n"
            "       color:var(--brand-text); font:600 1.2rem var(--font-body);'>\n"
            "    <iconify-icon icon='mdi:account-group' width='24'></iconify-icon> across 500+ institutes\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script": (
            "gsap.fromTo('#ds-label', {opacity:0, y:16}, {opacity:.7, y:0, duration:.5, delay:.3, ease:'expo.out'});\n"
            "gsap.fromTo('#ds-num', {opacity:0, scale:.85, filter:'blur(10px)'},\n"
            "  {opacity:1, scale:1, filter:'blur(0px)', duration:.8, delay:.55, ease:'back.out(1.3)'});\n"
            "// count-up synced to the spoken number\n"
            "gsap.to('#ds-count', {innerText:40, duration:1.4, delay:.7, ease:'power2.out', snap:{innerText:1}});\n"
            "gsap.fromTo('#ds-context', {opacity:0, y:22}, {opacity:1, y:0, duration:.6, delay:1.7, ease:'power3.out'});\n"
            "// back-half shimmer on the number\n"
            "gsap.to('#ds-num', {scale:1.03, yoyo:true, repeat:-1, duration:2.2, delay:2.6, ease:'power2.inOut'});\n"
        ),
    },
    "KINETIC_TITLE": {
        "html": (
            "<!-- KINETIC_TITLE (brand-film): deep brand bg + glow, word-wipe, 1 accent word -->\n"
            "<div class='svg-canvas' style='position:relative; display:flex; align-items:center;\n"
            "     justify-content:center; overflow:hidden;'>\n"
            "  <div style='position:absolute; inset:0;\n"
            "       background: radial-gradient(65% 55% at 50% 45%, color-mix(in srgb, var(--brand-accent) 18%, transparent), transparent 72%);'></div>\n"
            "  <div style='display:flex; gap:.32em; line-height:1; position:relative;'>\n"
            "    <div style='overflow:hidden; padding-bottom:.08em;'>\n"
            "      <span id='kt-0' style='display:inline-block; transform:translateY(110%);\n"
            "            font:800 8rem var(--font-display); letter-spacing:-0.02em;\n"
            "            color:var(--brand-text);'>OWN</span>\n"
            "    </div>\n"
            "    <div style='overflow:hidden; padding-bottom:.08em;'>\n"
            "      <span id='kt-1' style='display:inline-block; transform:translateY(110%);\n"
            "            font:800 8rem var(--font-display); letter-spacing:-0.02em;\n"
            "            color:var(--brand-text);'>THE</span>\n"
            "    </div>\n"
            "    <div style='overflow:hidden; padding-bottom:.08em;'>\n"
            "      <span id='kt-2' style='display:inline-block; transform:translateY(110%);\n"
            "            font:800 8rem var(--font-display); letter-spacing:-0.02em;\n"
            "            color:var(--brand-accent); text-shadow: 0 24px 60px color-mix(in srgb, var(--brand-accent) 40%, transparent);'>MOMENT</span>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script": (
            "gsap.to('#kt-0', {y:0, duration:.7, delay:.35, ease:'expo.out'});\n"
            "gsap.to('#kt-1', {y:0, duration:.7, delay:.5, ease:'expo.out'});\n"
            "gsap.to('#kt-2', {y:0, duration:.8, delay:.68, ease:'back.out(1.3)'});\n"
            "// back-half: accent word glow breathes\n"
            "gsap.to('#kt-2', {opacity:.8, yoyo:true, repeat:-1, duration:1.8, delay:2.2, ease:'power2.inOut'});\n"
        ),
    },
    "IMAGE_SPLIT": {
        "html": (
            "<div style='position:relative; display:grid; grid-template-columns: 54% 46%; height:100%; overflow:hidden;'>\n"
            "  <div style='position:relative; overflow:hidden;'>\n"
            "    <img id='is-img' class='generated-image'\n"
            "         data-img-prompt='candid photograph, students collaborating around a laptop, warm natural light, editorial, {aspect_label}'\n"
            "         data-ken-burns='pan-right' src='placeholder.png'\n"
            "         style='width:100%; height:100%; object-fit:cover;' />\n"
            "    <div style='position:absolute; inset:0; background:linear-gradient(to right, transparent 60%, var(--brand-bg));'></div>\n"
            "  </div>\n"
            "  <div style='position:relative; display:flex; flex-direction:column; justify-content:center;\n"
            "       padding:0 5vw; background:var(--brand-bg);'>\n"
            "    <div style='position:absolute; inset:0;\n"
            "         background: radial-gradient(80% 60% at 100% 20%, color-mix(in srgb, var(--brand-primary) 12%, transparent), transparent 70%);'></div>\n"
            "    <h2 id='is-title' style='opacity:0; position:relative; margin:0; color:var(--brand-text);\n"
            "        font:800 4.6rem/1.05 var(--font-display); letter-spacing:-0.02em;'>\n"
            "      Every lead,&nbsp;<span style='color:var(--brand-accent)'>answered</span>\n"
            "    </h2>\n"
            "    <div style='position:relative; display:flex; flex-direction:column; gap:.8em; margin-top:1.6em;'>\n"
            "      <div id='is-f1' style='opacity:0; display:flex; align-items:center; gap:.7em;\n"
            "           color:var(--brand-text); font:600 1.35rem var(--font-body);'>\n"
            "        <span style='display:flex; padding:.5em; border-radius:12px;\n"
            "              background: color-mix(in srgb, var(--brand-accent) 16%, transparent);\n"
            "              box-shadow: 0 12px 30px -12px rgba(0,0,0,.35);'>\n"
            "          <iconify-icon icon='mdi:whatsapp' width='26' style='color:var(--brand-accent)'></iconify-icon>\n"
            "        </span> WhatsApp built in\n"
            "      </div>\n"
            "      <div id='is-f2' style='opacity:0; display:flex; align-items:center; gap:.7em;\n"
            "           color:var(--brand-text); font:600 1.35rem var(--font-body);'>\n"
            "        <span style='display:flex; padding:.5em; border-radius:12px;\n"
            "              background: color-mix(in srgb, var(--brand-primary) 16%, transparent);\n"
            "              box-shadow: 0 12px 30px -12px rgba(0,0,0,.35);'>\n"
            "          <iconify-icon icon='mdi:bell-ring' width='26' style='color:var(--brand-primary)'></iconify-icon>\n"
            "        </span> Follow-ups on autopilot\n"
            "      </div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script": (
            "gsap.fromTo('#is-title', {opacity:0, y:34, filter:'blur(8px)'},\n"
            "  {opacity:1, y:0, filter:'blur(0px)', duration:.8, delay:.45, ease:'power3.out'});\n"
            "gsap.fromTo('#is-f1', {opacity:0, x:-26}, {opacity:1, x:0, duration:.6, delay:1.1, ease:'expo.out'});\n"
            "gsap.fromTo('#is-f2', {opacity:0, x:-26}, {opacity:1, x:0, duration:.6, delay:1.45, ease:'expo.out'});\n"
            "// back-half: icon chips pulse gently in sequence\n"
            "gsap.to('#is-f1 span', {scale:1.06, yoyo:true, repeat:1, duration:.5, delay:2.6, ease:'power2.inOut'});\n"
            "gsap.to('#is-f2 span', {scale:1.06, yoyo:true, repeat:1, duration:.5, delay:3.1, ease:'power2.inOut'});\n"
        ),
    },
}


DO_NOT_RULES_TECHNICAL = (
    "**HARD CONSTRAINTS** (technical only — stylistic bans are intentionally relaxed in aspirational mode):\n"
    "- **setTimeout for animations** — use GSAP `delay:` or `gsap.delayedCall()`. setTimeout never fires "
    "in the renderer.\n"
    "- **Unnamed eases / linear default** — every GSAP tween must specify a named ease.\n"
    "- **Hardcoded colors / sizes outside the shot pack** — always use the supplied tokens so the video "
    "feels like one designer authored every shot. Local `--warn / --good / --gold` semantic vars are "
    "an explicit exception (see SEMANTIC ACCENT COLOR above).\n"
    "- **Vertical text or high-rotation type** — keep text readable; max ±15° rotation, no `writing-mode: "
    "vertical-*` for narration-bearing copy.\n"
    "- **Emoji as content icons** — 📸 🎥 📋 etc. render inconsistently across video frames, can't pick "
    "up brand color, and read as casual. Use inline SVG (with `stroke=\"var(--brand-primary)\"`) or "
    "Iconify (`<iconify-icon icon='mdi:camera' width='32'></iconify-icon>`) instead. Decorative emoji "
    "in editorial flourishes are fine; emoji standing in for diagram/UI elements are not.\n\n"
)


EDUCATIONAL_PRINCIPLES_ASPIRATIONAL = (
    "**EDUCATIONAL DESIGN PRINCIPLES**:\n"
    "1. **ONE CONCEPT AT A TIME**: Each shot = one idea. No clutter — but 'one idea' can be expressed "
    "with rich, layered visuals.\n"
    "2. **ANNOTATE KEY TERMS**: Use Rough Notation to underline/circle important words.\n"
    "3. **DRAW, DON'T JUST SHOW**: Use Vivus / SVG draw-on / motion paths to construct diagrams "
    "as if sketching on a whiteboard. Custom SVG > stock icons.\n"
    "4. **SIGNALING**: Use arrows, circles, highlights, focal scale, and contrast to direct attention. "
    "Text density is a design choice — minimal when minimal is right, layered when the concept demands it.\n\n"

    "**PROGRESSIVE DISCLOSURE** (recommended for complex concepts):\n"
    "Build understanding layer by layer within each shot:\n"
    "1. Show the main heading/question FIRST (delay: 0)\n"
    "2. Draw/reveal the first part of the diagram (delay: 2-3s, sync to word timing)\n"
    "3. Annotate the key term being spoken (sync to word timing)\n"
    "4. Add the next layer of detail (delay: 5-7s)\n"
    "Each reveal should ADD to what's on screen, NOT replace it.\n\n"

    "**DUAL CODING PRINCIPLE**:\n"
    "Shots that introduce a new concept should pair:\n"
    "1. TEXT (the concept name + brief explanation)\n"
    "2. A VISUAL (SVG diagram, flowchart, comparison, annotated image, or code block)\n"
    "Text-only shots are reserved for Key Takeaway cards and LOWER_THIRD overlays.\n\n"
)


# Substrings that flag a stage-drift / static-frame mandate inside a card
# guideline. When aspirational mode is active, any guideline line containing
# one of these is dropped — the override clause in the preamble already says
# "those are defaults, not requirements", but leaving the prescriptive
# sentence in the prompt anyway sends the model mixed signals.
_ASPIRATIONAL_GUIDELINE_BANS = (
    "wrap the content in `.stage-drift`",
    "wrap the content in .stage-drift",
    "No static frames",
    "so the whole composition drifts during any hold",
    "MUST WRAP in `.stage-drift`",
    "MUST WRAP in .stage-drift",
)


def _relax_card_for_aspirational(card_text: str) -> str:
    """Strip prescriptive stage-drift / no-static-frames mandate lines from a
    formatted shot-type card and neutralize canonical `.stage-drift` wrappers
    in the example HTML so they read as one option among many rather than the
    canonical pattern. Used only when `aspirational=True` is passed to
    `build_per_shot_system_prompt`.
    """
    out_lines = []
    for line in card_text.splitlines():
        if any(ban in line for ban in _ASPIRATIONAL_GUIDELINE_BANS):
            continue
        out_lines.append(line)
    text = "\n".join(out_lines)
    # Drop the canonical `.stage-drift` wrapper from example HTML so the model
    # doesn't anchor on it as the one true layout. The `.stage-drift` utility
    # remains documented and available — just no longer shown as the default
    # composition wrapper in every card.
    text = text.replace(
        "<div class='stage-drift full-screen-center'>",
        "<div class='full-screen-center'>",
    )
    text = text.replace(
        "<div class=\"stage-drift full-screen-center\">",
        "<div class=\"full-screen-center\">",
    )
    return text


# ═══════════════════════════════════════════════════════════════════════════
# SHOT TYPE CARDS — one per shot type, self-contained documentation.
# ═══════════════════════════════════════════════════════════════════════════

SHOT_TYPE_CARDS: Dict[str, Dict[str, Any]] = {

    # ------------------------------------------------------------------
    # TEXT_DIAGRAM — the default shot type for explanations
    # ------------------------------------------------------------------
    "TEXT_DIAGRAM": {
        "id": "TEXT_DIAGRAM",
        "name": "Text + Diagram",
        "category": "text",
        "description": "Text + SVG/Mermaid diagram on clean background — the workhorse shot for explanations.",
        "use_for": "Abstract concepts, code, math, processes, comparisons — anything that needs focus.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["coding", "math", "science", "language", "general"],
        "html_template": (
            "<div class='full-screen-center'>\n"
            "  <div class='layout-hero'>\n"
            "    <h1 class='text-display'>What is an <span id='api-term'>API</span>?</h1>\n"
            "    <p class='text-body'>A way for programs to <span id='talk-term'>talk to each other</span></p>\n"
            "    <svg id='api-diagram' viewBox='0 0 500 150' style='margin-top:40px;'>\n"
            "      <rect x='20' y='50' width='120' height='60' fill='var(--primary-color)' rx='8'/>\n"
            "      <text x='80' y='85' fill='#fff' text-anchor='middle'>App A</text>\n"
            "      <path d='M150,80 L350,80' stroke='var(--text-color)' stroke-width='3' fill='none'/>\n"
            "      <rect x='360' y='50' width='120' height='60' fill='var(--primary-color)' rx='8'/>\n"
            "      <text x='420' y='85' fill='#fff' text-anchor='middle'>App B</text>\n"
            "    </svg>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "animateSVG('api-diagram', 120);\n"
            "gsap.delayedCall(1.5, () => annotate('#api-term', {type:'underline', color:'#dc2626', duration:600}));\n"
            "gsap.delayedCall(2.0, () => annotate('#talk-term', {type:'highlight', color:'#fef08a', duration:600}));\n"
        ),
        "guidelines": [
            "WRAP content in `<div class='full-screen-center'>...</div>`",
            "Use `.layout-split` for Text on left, Visual (SVG/diagram) on right",
            "Use `.layout-hero` for single big concept in center",
            "Keep backgrounds clean — solid color from the palette",
            "Use Mermaid for flowcharts, SVG for custom diagrams, KaTeX for math",
        ],
        "includes_key_takeaway": True,
        "includes_wrong_right": True,
    },

    # ------------------------------------------------------------------
    # IMAGE_HERO — full-screen image with Ken Burns
    # ------------------------------------------------------------------
    "IMAGE_HERO": {
        "id": "IMAGE_HERO",
        "name": "Image Hero",
        "category": "cinematic",
        "description": "Full-screen image with Ken Burns zoom + text overlay.",
        "use_for": "Hook/opening, real-world examples, dramatic moments, introducing new topics.",
        "requires_image": True,
        "requires_video": False,
        "preferred_domains": ["history", "science", "general", "language"],
        "html_template": (
            "<div class='image-hero'>\n"
            "  <img class='generated-image'\n"
            "       data-img-prompt='realistic photograph of a scientist examining DNA, cinematic, {aspect_label}'\n"
            "       data-ken-burns='zoom-in'\n"
            "       src='placeholder.png' />\n"
            "  <div class='image-text-overlay gradient-bottom'>\n"
            "    <h1 id='hero-title' style='opacity:0'>The Building Blocks of Life</h1>\n"
            "    <p id='hero-sub' style='opacity:0'>Every living thing carries a unique code</p>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "fadeIn('#hero-title', 0.8, 0.5);\n"
            "fadeIn('#hero-sub', 0.6, 1.2);\n"
        ),
        "guidelines": [
            "Ken Burns options: `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `pan-up`, `zoom-pan-tl`",
            "Ken Burns works best on shots 8-15s. Below 6s the motion feels jarring.",
            "Gradient options: `gradient-bottom` (default), `gradient-top`, `gradient-full`, `gradient-center`",
            "Text overlay: white text with text-shadow for readability over images",
            "Image fills entire screen — text appears over a gradient scrim",
        ],
    },

    # ------------------------------------------------------------------
    # VIDEO_HERO — full-screen stock video background
    # ------------------------------------------------------------------
    "VIDEO_HERO": {
        "id": "VIDEO_HERO",
        "name": "Video Hero",
        "category": "cinematic",
        "description": "Full-screen stock video background with text overlay. STRONGLY PREFERRED over IMAGE_HERO for real-world topics.",
        "use_for": "Nature scenes, city time-lapses, lab footage, atmospheric openings, any scene with motion.",
        "requires_image": False,
        "requires_video": True,
        "preferred_domains": ["history", "science", "general"],
        "html_template": (
            "<div class='video-hero'>\n"
            "  <video class='stock-video' data-video-query='aerial ocean waves coral reef swimming fish'\n"
            "         autoplay muted loop playsinline></video>\n"
            "  <div class='image-text-overlay gradient-bottom'>\n"
            "    <h1 id='hero-title' style='opacity:0'>Life Under the Sea</h1>\n"
            "    <p id='hero-sub' style='opacity:0'>Exploring marine ecosystems</p>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "fadeIn('#hero-title', 0.8, 0.5);\n"
            "fadeIn('#hero-sub', 0.6, 1.2);\n"
        ),
        "guidelines": [
            "Good video queries: 'aerial forest sunrise mist', 'chemistry lab beaker bubbling', 'microscope cells biology'",
            "Same gradient overlay classes as IMAGE_HERO: gradient-bottom, gradient-full, gradient-center",
            "Stock videos are free (Pexels) — prefer over plain backgrounds for real-world topics",
            "DON'T force a video background behind content that needs focus (math, code, dense text)",
        ],
    },

    # ------------------------------------------------------------------
    # IMAGE_SPLIT — image on one side, text on the other
    # ------------------------------------------------------------------
    "IMAGE_SPLIT": {
        "id": "IMAGE_SPLIT",
        "name": "Image Split",
        "category": "cinematic",
        "description": "Image on one side, text on the other.",
        "use_for": "Explaining a concept with a real-world visual reference.",
        "requires_image": True,
        "requires_video": False,
        "preferred_domains": ["science", "history", "general", "language"],
        "html_template": (
            "<div class='image-split-layout'>\n"
            "  <div class='split-image'>\n"
            "    <img class='generated-image'\n"
            "         data-img-prompt='close-up of plant cells under electron microscope, green chloroplasts, scientific illustration'\n"
            "         data-ken-burns='pan-right'\n"
            "         src='placeholder.png' />\n"
            "  </div>\n"
            "  <div class='split-text'>\n"
            "    <h2 id='split-title' style='opacity:0'>Chloroplasts</h2>\n"
            "    <p id='split-body' style='opacity:0'>These tiny green organelles capture sunlight for photosynthesis.</p>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "fadeIn('#split-title', 0.5, 0.3);\n"
            "fadeIn('#split-body', 0.5, 0.8);\n"
        ),
        "guidelines": [
            "Ken Burns on the image side for subtle motion",
            "Text side: heading + 1-3 bullet points or short paragraph",
            "Portrait mode: stack top/bottom with `grid-template-rows: 1fr 1fr`",
        ],
    },

    # ------------------------------------------------------------------
    # LOWER_THIRD — key term banner at bottom
    # ------------------------------------------------------------------
    "LOWER_THIRD": {
        "id": "LOWER_THIRD",
        "name": "Lower Third",
        "category": "text",
        "description": "Key term banner at bottom of screen. Can OVERLAY other shots.",
        "use_for": "Introducing vocabulary, definitions, key facts.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["language", "science", "general", "history"],
        "html_template": (
            "<div class='lower-third'>\n"
            "  <div class='lt-accent-bar'></div>\n"
            "  <div class='lt-content'>\n"
            "    <span class='lt-label'>KEY TERM</span>\n"
            "    <span class='lt-text'>Photosynthesis — Converting sunlight into chemical energy</span>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": "",
        "guidelines": [
            "Slides in from left with CSS animation (built-in ltSlideIn keyframe)",
            "Can overlay IMAGE_HERO, VIDEO_HERO, or other shots",
            "Keep text concise: term + brief definition",
        ],
    },

    # ------------------------------------------------------------------
    # ANNOTATION_MAP — full-screen image with SVG arrows + labels
    # ------------------------------------------------------------------
    "ANNOTATION_MAP": {
        "id": "ANNOTATION_MAP",
        "name": "Annotation Map",
        "category": "cinematic",
        "description": "Full-screen image with animated SVG arrows + labels drawn on top.",
        "use_for": "Anatomy, geography, architecture, 'parts of X' — any labeled visual.",
        "requires_image": True,
        "requires_video": False,
        "preferred_domains": ["science", "history"],
        "html_template": (
            "<div class='annotation-map-container'>\n"
            "  <img class='generated-image annotation-map-bg'\n"
            "       data-img-prompt='cross-section of human heart, unlabeled, no text overlay, clinical illustration, {aspect_label}'\n"
            "       data-ken-burns='zoom-in'\n"
            "       src='placeholder.png' />\n"
            "  <svg id='anno-svg' class='annotation-overlay' viewBox='0 0 {canvas_width} {canvas_height}'>\n"
            "    <defs>\n"
            "      <marker id='ah1' markerWidth='10' markerHeight='7' refX='9' refY='3.5' orient='auto'>\n"
            "        <polygon points='0 0,10 3.5,0 7' fill='#ffffff'/>\n"
            "      </marker>\n"
            "    </defs>\n"
            "    <path id='a1' d='M750,420 L600,580' stroke='#ffffff' stroke-width='3' fill='none' marker-end='url(#ah1)'/>\n"
            "    <text id='l1' x='760' y='410' fill='#ffffff' font-size='30' font-family='Montserrat' font-weight='700' opacity='0'>Left Ventricle</text>\n"
            "  </svg>\n"
            "</div>\n"
        ),
        "script_block": (
            "animateSVG('anno-svg', 80);\n"
            "gsap.delayedCall(0.9, () => fadeIn('#l1', 0.4, 0));\n"
        ),
        "guidelines": [
            "Image prompt MUST include 'unlabeled, no text overlay' so SVG labels are readable",
            "Use Vivus (animateSVG) to draw arrows progressively",
            "Stagger label fadeIns after arrows are drawn",
            "SVG viewBox must match canvas dimensions: viewBox='0 0 {canvas_width} {canvas_height}'",
        ],
    },

    # ------------------------------------------------------------------
    # DATA_STORY — animated D3.js chart
    # ------------------------------------------------------------------
    "DATA_STORY": {
        "id": "DATA_STORY",
        "name": "Data Story",
        "category": "data",
        "description": "Animated bar/line chart that builds during narration. ONE highlighted bar in accent color, rest neutral — reference-grade 2-color system.",
        "use_for": "Historical population data, scientific measurements, statistics with real numbers, 'this week vs last 4 weeks' style comparisons.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["science", "history", "general"],
        "html_template": (
            "<!-- DATA_STORY: neutral bars + ONE accent highlight bar. Wrap in .stage-drift for slow camera pan during hold. -->\n"
            "<div class='stage-drift full-screen-center'>\n"
            "  <h2 id='chart-title' style='opacity:0; font-family:Bebas Neue,Impact,sans-serif; font-size:3rem; letter-spacing:0.05em;'>WEEKLY TRENDS</h2>\n"
            "  <div id='bar-row' style='display:flex; gap:28px; align-items:flex-end; height:320px; margin-top:40px;'>\n"
            "    <div class='bar bar-neutral' style='width:90px; height:140px; background:var(--brand-text,#111); transform:scaleY(0); transform-origin:bottom center;'></div>\n"
            "    <div class='bar bar-neutral' style='width:90px; height:170px; background:var(--brand-text,#111); transform:scaleY(0); transform-origin:bottom center;'></div>\n"
            "    <div class='bar bar-neutral' style='width:90px; height:130px; background:var(--brand-text,#111); transform:scaleY(0); transform-origin:bottom center;'></div>\n"
            "    <div class='bar bar-neutral' style='width:90px; height:165px; background:var(--brand-text,#111); transform:scaleY(0); transform-origin:bottom center;'></div>\n"
            "    <div class='bar bar-accent' id='hero-bar' style='width:110px; height:290px; background:var(--brand-accent); transform:scaleY(0); transform-origin:bottom center;'></div>\n"
            "  </div>\n"
            "  <div id='labels' style='display:flex; gap:28px; margin-top:12px; font-family:Inter,sans-serif; font-size:0.85rem; letter-spacing:0.18em; text-transform:uppercase;'>\n"
            "    <span style='width:90px;text-align:center;opacity:0'>WK 1</span>\n"
            "    <span style='width:90px;text-align:center;opacity:0'>WK 2</span>\n"
            "    <span style='width:90px;text-align:center;opacity:0'>WK 3</span>\n"
            "    <span style='width:90px;text-align:center;opacity:0'>WK 4</span>\n"
            "    <span style='width:110px;text-align:center;opacity:0;color:var(--brand-accent)'>THIS WK</span>\n"
            "  </div>\n"
            "  <div id='stat-callout' style='opacity:0; margin-top:32px; font-family:Bebas Neue,Impact,sans-serif; font-size:4.5rem; color:var(--brand-accent); line-height:0.95; letter-spacing:0.04em;'>$3.5 BILLION</div>\n"
            "  <div id='stat-source' style='opacity:0; margin-top:4px; font-family:Inter,sans-serif; font-size:1.1rem; color:var(--brand-text);'>Kleiner Perkins</div>\n"
            "</div>\n"
        ),
        "script_block": (
            "// 1. Title wipes in\n"
            "gsap.fromTo('#chart-title', {opacity:0, y:-20}, {opacity:1, y:0, duration:0.4, delay:0.1, ease:'expo.out'});\n"
            "// 2. Neutral bars grow from baseline (staggered 120ms, bottom-anchored scaleY)\n"
            "gsap.to('.bar-neutral', {scaleY:1, duration:0.6, delay:0.5, stagger:0.12, ease:'power3.out'});\n"
            "// 3. Week labels fade in under each bar\n"
            "gsap.to('#labels span', {opacity:1, duration:0.3, delay:1.0, stagger:0.1, ease:'power2.out'});\n"
            "// 4. Hero accent bar slams in AFTER neutrals settle — bouncy, dominant\n"
            "gsap.to('#hero-bar', {scaleY:1, duration:0.7, delay:1.8, ease:'back.out(1.4)'});\n"
            "// 5. Stat callout appears next to hero bar\n"
            "gsap.fromTo('#stat-callout', {opacity:0, x:30}, {opacity:1, x:0, duration:0.5, delay:2.4, ease:'expo.out'});\n"
            "gsap.fromTo('#stat-source', {opacity:0, x:30}, {opacity:1, x:0, duration:0.4, delay:2.7, ease:'power3.out'});\n"
            "// 6. MANDATORY continuous hold drift — slow diagonal pan of the whole composition (12s easy loop)\n"
            "gsap.fromTo('.stage-drift', {scale:1, x:0, y:0}, {scale:1.04, x:20, y:-10, duration:12, delay:0, ease:'none'});\n"
        ),
        "guidelines": [
            "Only use when narration explicitly mentions numbers/data worth visualizing.",
            "TWO-COLOR RULE: neutral bars use `var(--brand-text)` (usually near-black), ONE hero bar uses `var(--brand-accent)` (brand orange/red). Never three colors.",
            "BOTTOM-ANCHORED GROWTH: every bar must have `transform-origin:bottom center` + `transform:scaleY(0)` initial state, then GSAP `scaleY:1` with `power3.out` ease. Stagger neutrals 120ms apart, then delay the hero bar so it 'slams in last' (dominant reveal).",
            "HERO BAR EASE: use `back.out(1.4)` on the accent bar for a bouncy settle — this is the visual climax of the shot.",
            "CALLOUT TEXT: always follow the hero bar with a large Bebas Neue stat (`$3.5 BILLION`, `250K+`, etc.) + small Inter source label. Entrance: slide in from the right 400ms after the hero bar with `expo.out`.",
            "CONTINUOUS MOTION: wrap the content in `.stage-drift` and run `gsap.fromTo('.stage-drift', {x:0,y:0,scale:1}, {x:20,y:-10,scale:1.04, duration:12, ease:'none'})` so the whole composition drifts during any hold ≥4s. No static frames.",
            "For D3-driven charts, same rules apply: use `transition().delay((_,i)=>600+i*120).ease(d3.easeCubicOut)` and reserve `var(--brand-accent)` for the highlighted data point only.",
        ],
    },

    # ------------------------------------------------------------------
    # PROCESS_STEPS — sequential numbered nodes
    # ------------------------------------------------------------------
    "PROCESS_STEPS": {
        "id": "PROCESS_STEPS",
        "name": "Process Steps",
        "category": "data",
        "description": "Sequential step-by-step flow with numbered nodes connected by animated arrows.",
        "use_for": "Algorithms, biological processes, manufacturing steps, historical sequences, how-to explanations.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["coding", "science", "math", "general"],
        "html_template": (
            "<div class='full-screen-center'>\n"
            "  <div class='process-flow'>\n"
            "    <div id='ps-1' class='process-node' style='opacity:0'>\n"
            "      <div class='node-num'>1</div>\n"
            "      <div class='node-body'>\n"
            "        <div class='node-title'>Gather Data</div>\n"
            "        <div class='node-desc'>Collect raw information from sources</div>\n"
            "      </div>\n"
            "    </div>\n"
            "    <svg id='pc-1' class='process-connector' viewBox='0 0 20 40'>\n"
            "      <path d='M10,0 L10,30 M4,22 L10,34 L16,22' stroke='currentColor' stroke-width='2.5' fill='none'/>\n"
            "    </svg>\n"
            "    <div id='ps-2' class='process-node' style='opacity:0'>\n"
            "      <div class='node-num'>2</div>\n"
            "      <div class='node-body'>\n"
            "        <div class='node-title'>Process & Analyze</div>\n"
            "        <div class='node-desc'>Apply algorithms to find patterns</div>\n"
            "      </div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "fadeIn('#ps-1', 0.5, 0);\n"
            "gsap.delayedCall(1.8, () => animateSVG('pc-1', 35));\n"
            "gsap.delayedCall(2.6, () => fadeIn('#ps-2', 0.5, 0));\n"
        ),
        "guidelines": [
            "Use 3-5 steps per shot. For more steps, split into two shots.",
            "Steps reveal one-by-one with Vivus-drawn connectors between them",
            "Annotate the final step with `annotate('#ps-N .node-title', {type:'box', color:'#10b981'})`",
            "Adjust timing using word timestamps",
        ],
    },

    # ------------------------------------------------------------------
    # EQUATION_BUILD — KaTeX terms revealing sequentially
    # ------------------------------------------------------------------
    "EQUATION_BUILD": {
        "id": "EQUATION_BUILD",
        "name": "Equation Build",
        "category": "data",
        "description": "KaTeX equation terms reveal one-by-one in sync with narration.",
        "use_for": "Math formulas, physics laws, chemistry equations — any formula explained term-by-term.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["math", "science"],
        "html_template": (
            "<div class='full-screen-center'>\n"
            "  <div class='layout-hero'>\n"
            "    <h2 id='eq-ctx' style='opacity:0'>Kinetic Energy Formula</h2>\n"
            "    <div class='equation-build-row'>\n"
            "      <span id='eq-0' class='eq-term' style='opacity:0'>$$KE$$</span>\n"
            "      <span id='eq-1' class='eq-sep' style='opacity:0'>$$=$$</span>\n"
            "      <span id='eq-2' class='eq-term' style='opacity:0'>$$\\frac{1}{2}$$</span>\n"
            "      <span id='eq-3' class='eq-term' style='opacity:0'>$$mv^2$$</span>\n"
            "    </div>\n"
            "    <p id='eq-note' style='opacity:0;font-size:22px;margin-top:40px;'>measured in Joules (J)</p>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "fadeIn('#eq-ctx', 0.5, 0);\n"
            "gsap.delayedCall(1.2, () => fadeIn('#eq-0', 0.4, 0));\n"
            "gsap.delayedCall(2.0, () => fadeIn('#eq-1', 0.3, 0));\n"
            "gsap.delayedCall(2.8, () => fadeIn('#eq-2', 0.4, 0));\n"
            "gsap.delayedCall(3.6, () => fadeIn('#eq-3', 0.4, 0));\n"
            "gsap.delayedCall(4.8, () => fadeIn('#eq-note', 0.5, 0));\n"
            "gsap.delayedCall(5.2, () => annotate('#eq-0', {type:'circle', color:'#dc2626', strokeWidth:3, duration:700}));\n"
        ),
        "guidelines": [
            "KaTeX auto-renders on page load even if elements are opacity:0. Revealing with fadeIn shows pre-rendered math.",
            "Add `.eq-term` class to main variables, `.eq-sep` to operators/equals signs",
            "Each term is its own `<span>` for sequential reveal",
            "Annotate key terms after all visible using Rough Notation",
        ],
    },

    # ------------------------------------------------------------------
    # PRODUCT_HERO — single subject/product, background layers animate behind
    # ------------------------------------------------------------------
    "PRODUCT_HERO": {
        "id": "PRODUCT_HERO",
        "name": "Product Hero",
        "category": "cinematic",
        "description": "Single hero product/subject stays center-stage while background layers (color, texture, watermark, geometric shapes) animate in behind it. Classic brand reel / product showcase style.",
        "use_for": "Product showcases, brand reels, historical artifact focus ('1917'), company origin stories, single-subject explainers. The subject never moves — the world changes around it.",
        "requires_image": True,
        "requires_video": False,
        "preferred_domains": ["general", "history", "science", "saas_marketing", "business_marketing", "visual_storytelling"],
        "html_template": (
            "<!-- PRODUCT_HERO: hero subject fixed center, layers animate behind -->\n"
            "<div class='product-stage'>\n"
            "\n"
            "  <!-- LAYER 0: Base background color (always visible) -->\n"
            "  <div id='bg-base' style='position:absolute;inset:0;background:var(--brand-bg);z-index:0;'></div>\n"
            "\n"
            "  <!-- LAYER 1: Texture overlay (halftone/pattern) — fades in at ~3s -->\n"
            "  <div id='bg-texture' class='halftone' style='position:absolute;inset:0;z-index:1;opacity:0;\n"
            "       background-color:var(--brand-primary);'></div>\n"
            "\n"
            "  <!-- LAYER 2: Background watermark/geometric shape — scales in softly -->\n"
            "  <svg id='bg-mark' viewBox='0 0 400 400'\n"
            "       style='position:absolute;width:130%;height:130%;top:-15%;left:-15%;z-index:2;opacity:0;'>\n"
            "    <!-- Example: large circle watermark. Replace with star, logo shape, etc. -->\n"
            "    <circle cx='200' cy='200' r='185'\n"
            "            fill='none' stroke='rgba(255,255,255,0.1)' stroke-width='2'\n"
            "            stroke-dasharray='14 6'/>\n"
            "    <text x='200' y='215' text-anchor='middle'\n"
            "          fill='rgba(255,255,255,0.06)' font-family='Bebas Neue,Impact,sans-serif'\n"
            "          font-size='72' letter-spacing='18'>BRAND</text>\n"
            "  </svg>\n"
            "\n"
            "  <!-- FLAT BADGE: year / stat — slams in from top -->\n"
            "  <div style='position:absolute;top:11%;left:50%;transform:translateX(-50%);z-index:8;overflow:hidden;'>\n"
            "    <div id='badge' class='flat-badge' style='transform:translateY(-120%);'>\n"
            "      1917\n"
            "    </div>\n"
            "  </div>\n"
            "\n"
            "  <!-- HERO SUBJECT IMAGE (cutout, always center-stage) -->\n"
            "  <img id='subject' class='generated-image'\n"
            "       data-img-prompt='white product centered, isolated on solid white background, no other objects, clean edges, professional product photography'\n"
            "       data-cutout='true' src='placeholder.png'\n"
            "       style='position:absolute;bottom:22%;left:50%;transform:translateX(-50%);\n"
            "              width:74%;max-width:580px;z-index:10;opacity:0;' />\n"
            "\n"
            "  <!-- TRACKING LABEL: small word appears below subject -->\n"
            "  <div id='label-a' class='tracking-label'\n"
            "       style='position:absolute;bottom:16%;left:50%;transform:translateX(-50%);\n"
            "              z-index:11;opacity:0;'>HARDWOOD</div>\n"
            "\n"
            "  <!-- SLAM TEXT: bottom tagline wipes up last -->\n"
            "  <div style='position:absolute;bottom:4%;left:0;right:0;text-align:center;z-index:20;'\n"
            "       class='slam-wrapper'>\n"
            "    <div id='slam' class='slam-text' style='color:var(--brand-text);'>THE ICON</div>\n"
            "  </div>\n"
            "\n"
            "</div>\n"
        ),
        "script_block": (
            "// 1. Subject photo entrance — drops in from slight top offset\n"
            "gsap.fromTo('#subject', {opacity:0, y:-30}, {opacity:1, y:0, duration:0.7, delay:0.2, ease:'power3.out'});\n"
            "// 2. Badge slams in from above\n"
            "gsap.to('#badge', {y:'0%', duration:0.45, delay:0.4, ease:'expo.out'});\n"
            "// 3. Subtle continuous scale on subject (Ken Burns feel)\n"
            "gsap.to('#subject', {scale:1.04, duration:9, delay:0.2, ease:'none'});\n"
            "// 4. Background texture crossfade (act 2 — halfway through shot)\n"
            "gsap.to('#bg-texture', {opacity:1, duration:0.9, delay:3.5, ease:'power2.inOut'});\n"
            "gsap.to('#bg-base', {opacity:0, duration:0.9, delay:3.5, ease:'power2.inOut'});\n"
            "// 5. Watermark scales in softly behind subject\n"
            "gsap.fromTo('#bg-mark', {scale:0.55, opacity:0}, {scale:1, opacity:1, duration:2.0, delay:3.8, ease:'power2.out'});\n"
            "// 6. Tracking label fades in\n"
            "gsap.to('#label-a', {opacity:1, duration:0.5, delay:5.0, ease:'power2.out'});\n"
            "// 7. Slam text wipes up\n"
            "gsap.to('#slam', {y:'0%', duration:0.55, delay:7.5, ease:'expo.out'});\n"
        ),
        "guidelines": [
            "SUBJECT: always `position:absolute`, `data-cutout='true'`, bottom 20–30% of frame, width 65–80%. Never move it.",
            "BACKGROUND ACTS: build 2–3 'acts' by crossfading layers — solid color → texture (halftone/SVG lines) → watermark/geometric shape.",
            "FLAT BADGE: use `.flat-badge` class. Zero border-radius. Black text on accent color. Font: Bebas Neue.",
            "TRACKING LABEL: `.tracking-label` — small ALL-CAPS, wide letter-spacing, appears between subject and slam text.",
            "SLAM TEXT: use `.slam-wrapper` + `.slam-text`. Last thing to appear. translateY(100%→0%) with `expo.out`.",
            "BACKGROUND WATERMARK: large SVG (130% canvas), opacity 0.06–0.12, scales from 0.5 to 1. Brand circle, star, or logo shape.",
            "HALFTONE TEXTURE: use `class='halftone'` on a background layer. Apply brand color as `background-color`.",
            "CONTINUOUS MOTION: apply a 8–12s slow GSAP scale (1→1.05) on the subject and a slow drift on bg-mark.",
            "COLOR ACTS: bg-base starts as light/neutral. bg-texture (halftone layer) can be brand-primary for a bold act 2.",
            "DO NOT move the subject between acts — only the background layers change.",
            "BRAND-ANCHOR: when a BRAND ANCHOR block appears in the user prompt, slam-text + tracking-label MUST reference the named product/brand. 'THE ICON' in the template is an EXAMPLE — replace with the actual brand (e.g. 'PARLE-G' as slam-text, 'INDIA'S BISCUIT' as tracking-label). For PRODUCT_HERO shots, the subject `<img>` SHOULD use `data-img-source=\"reference\"` with a brand image URL when one is provided.",
        ],
    },

    # ------------------------------------------------------------------
    # KINETIC_TEXT — pipeline-built word-sync (no LLM HTML)
    # ------------------------------------------------------------------
    "KINETIC_TEXT": {
        "id": "KINETIC_TEXT",
        "name": "Kinetic Text",
        "category": "text",
        "description": "Words appear exactly when spoken — GSAP tweens are built directly from Whisper timestamps. 100% accurate sync. Pipeline generates HTML; no LLM call needed for this type.",
        "use_for": "Hooks, conclusions, emphasis moments. Use at most once per video.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["general", "language", "science", "math"],
        "html_template": (
            "<!-- KINETIC_TEXT is pipeline-generated. Each word is a <span> with a GSAP fromTo tween. -->\n"
            "<div class='kinetic-text-container'>\n"
            "  <span id='kw-0' class='kw' style='opacity:0'>Word</span>\n"
            "  <span id='kw-1' class='kw' style='opacity:0'>after</span>\n"
            "  <span id='kw-2' class='kw' style='opacity:0'>word</span>\n"
            "</div>\n"
        ),
        "script_block": (
            "// Example — the pipeline generates the real tween per word from Whisper timestamps:\n"
            "gsap.fromTo('#kw-0', {opacity:0, y:20}, {opacity:1, y:0, duration:0.25, delay:0.0});\n"
            "gsap.fromTo('#kw-1', {opacity:0, y:20}, {opacity:1, y:0, duration:0.25, delay:0.55});\n"
            "gsap.fromTo('#kw-2', {opacity:0, y:20}, {opacity:1, y:0, duration:0.25, delay:0.92});\n"
        ),
        "guidelines": [
            "Do not write KINETIC_TEXT HTML manually — the pipeline builds it from Whisper word timestamps.",
            "Use at most once per video. Never place two KINETIC_TEXT shots back-to-back.",
            "Best for hooks ('What if everything you knew was wrong?') and conclusions.",
        ],
    },

    # ------------------------------------------------------------------
    # INFOGRAPHIC_SVG — pure SVG draw-on illustration, no photos
    # ------------------------------------------------------------------
    "INFOGRAPHIC_SVG": {
        "id": "INFOGRAPHIC_SVG",
        "name": "Infographic SVG",
        "category": "illustration",
        "description": "Pure inline SVG that draws itself on screen via stroke-dashoffset. No photos, no AI images. Cream background with CSS grid. 2-color brand palette only.",
        "use_for": "Sports plays, anatomy, diagrams, process flows, maps, how-to explainers — anything spatial or mechanical that can be DRAWN, not photographed.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["science", "biology", "general", "sports", "geography", "history"],
        "html_template": (
            "<!-- INFOGRAPHIC_SVG: cream+grid+paper-grain bg, 2-color content palette, red tech annotations,\n"
            "     hand-drawn wobble via filter='url(#roughen)', stroke-dashoffset draw-on, blueprint-style. -->\n"
            "<div class='svg-canvas paper-texture'>\n"
            "  <div class='stage-drift'>\n"
            "\n"
            "    <!-- Yellow flat-badge label top-left (slides in from left) -->\n"
            "    <div id='scene-label' class='flat-badge' style='position:absolute; top:8%; left:6%;\n"
            "         transform:translateX(-110%); font-size:1.3rem; padding:6px 16px;'>A NEW DIMENSION.</div>\n"
            "\n"
            "    <!-- Main line-art diagram wrapped in roughen filter for architect-sketch wobble -->\n"
            "    <svg id='diagram' viewBox='0 0 900 500'\n"
            "         style='position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);\n"
            "                width:72%; max-width:1000px;'>\n"
            "\n"
            "      <!-- === CONTENT LAYER: hand-drawn line art === -->\n"
            "      <g filter='url(#roughen)' stroke='var(--brand-text,#111)' stroke-width='2.8' fill='none'>\n"
            "        <!-- Laptop body outline -->\n"
            "        <rect id='laptop-screen' x='180' y='100' width='540' height='260' rx='8'\n"
            "              pathLength='1' stroke-dasharray='1' stroke-dashoffset='1'/>\n"
            "        <rect id='laptop-base'   x='140' y='360' width='620' height='36' rx='4'\n"
            "              pathLength='1' stroke-dasharray='1' stroke-dashoffset='1'/>\n"
            "        <!-- Small crosshair target in center of screen — used as zoom-through target on exit -->\n"
            "        <circle id='focus-target' cx='450' cy='230' r='14' fill='var(--brand-text,#111)'\n"
            "                opacity='0' style='transform-origin:450px 230px;'/>\n"
            "      </g>\n"
            "\n"
            "      <!-- === ANNOTATION LAYER: red dashed dimension lines (engineering markup) === -->\n"
            "      <g>\n"
            "        <!-- Top dimension: width -->\n"
            "        <line x1='180' y1='78' x2='720' y2='78' class='tech-annotation'\n"
            "              pathLength='1' stroke-dasharray='1' stroke-dashoffset='1'/>\n"
            "        <text x='450' y='68' text-anchor='middle' class='tech-annotation-label' opacity='0'>16-INCH DISPLAY</text>\n"
            "        <!-- Right dimension: bezel -->\n"
            "        <line x1='740' y1='100' x2='740' y2='360' class='tech-annotation'\n"
            "              pathLength='1' stroke-dasharray='1' stroke-dashoffset='1'/>\n"
            "        <text x='760' y='230' class='tech-annotation-label' opacity='0'\n"
            "              transform='rotate(90 760 230)'>5MM BEZEL</text>\n"
            "      </g>\n"
            "    </svg>\n"
            "\n"
            "    <!-- Fig caption (italic serif, bottom-left) -->\n"
            "    <div id='fig-caption' class='tech-annotation-caption' style='position:absolute; bottom:6%; left:6%;\n"
            "         opacity:0;'>Fig. 1 — Redesigned thermal architecture.</div>\n"
            "  </div>\n"
            "\n"
            "  <!-- Vignette overlay for scene-exit darkening (kept opacity:0 until shot end) -->\n"
            "  <div class='vignette-overlay'></div>\n"
            "</div>\n"
        ),
        "script_block": (
            "// Assume SHOT_END is the shot duration (pass from caller). Example timeline for a 5s shot.\n"
            "const SHOT_END = 5.0;\n"
            "\n"
            "// 0. MANDATORY continuous hold drift — whole composition drifts diagonally (12s loop)\n"
            "gsap.fromTo('.stage-drift', {x:0,y:0,scale:1}, {x:20,y:-10,scale:1.04, duration:12, ease:'none'});\n"
            "\n"
            "// 1. Draw primary line art — stroke-dashoffset works cleanly with filter='url(#roughen)'\n"
            "gsap.to('#laptop-screen', {strokeDashoffset:0, duration:1.0, delay:0.3, ease:'power2.inOut'});\n"
            "gsap.to('#laptop-base',   {strokeDashoffset:0, duration:0.5, delay:0.9, ease:'power2.inOut'});\n"
            "\n"
            "// 2. Draw red dashed dimension lines (engineering annotations)\n"
            "gsap.to('.tech-annotation', {strokeDashoffset:0, duration:0.7, delay:1.3, stagger:0.1, ease:'power2.out'});\n"
            "gsap.to('.tech-annotation-label', {opacity:1, duration:0.4, delay:1.7, stagger:0.1, ease:'power2.out'});\n"
            "\n"
            "// 3. Yellow flat-badge slams in from left (headline)\n"
            "gsap.to('#scene-label', {x:'0%', duration:0.45, delay:2.0, ease:'expo.out'});\n"
            "\n"
            "// 4. Focus target dot pops in (used as the zoom-through target on scene exit)\n"
            "gsap.fromTo('#focus-target', {scale:0, opacity:0},\n"
            "    {scale:1, opacity:1, duration:0.35, delay:2.4, ease:'back.out(2)', transformOrigin:'center center'});\n"
            "\n"
            "// 5. Italic serif fig caption fades in (textbook feel)\n"
            "gsap.to('#fig-caption', {opacity:1, duration:0.5, delay:2.8, ease:'power2.out'});\n"
            "\n"
            "// === SCENE EXIT — pick ONE of the two patterns below ===\n"
            "\n"
            "// OPTION A: ZOOM-THROUGH TRANSITION (camera pushes into focus-target)\n"
            "gsap.to('#focus-target', {scale:25, duration:0.8, delay:SHOT_END-0.8, ease:'power3.in'});\n"
            "gsap.to('.stage-drift', {opacity:0, duration:0.3, delay:SHOT_END-0.3, ease:'power2.in'});\n"
            "\n"
            "// OPTION B: VIGNETTE EXIT (radial darkening — cinematic breath-beat)\n"
            "// gsap.to('.vignette-overlay', {opacity:1, duration:0.6, delay:SHOT_END-0.6, ease:'power2.in'});\n"
            "\n"
            "// === BALL MOTIONPATH example (use for arcs, trajectories) ===\n"
            "// if (window.MotionPathPlugin) gsap.registerPlugin(MotionPathPlugin);\n"
            "// gsap.to('#ball', {motionPath:{path:'#arc', align:'#arc', alignOrigin:[0.5,0.5]},\n"
            "//     duration:1.5, delay:2.6, ease:'power1.inOut'});\n"
            "\n"
            "// === BLUEPRINT DRAFT pattern (for multi-node diagrams — pipelines, flow charts) ===\n"
            "// <g class='draft-guide'><path pathLength='1' stroke-dasharray='1' stroke-dashoffset='1'/></g>\n"
            "// <g class='solid-overlay'><path opacity='0'/></g>\n"
            "// gsap.to('.draft-guide path',   {strokeDashoffset:0, duration:1.2, stagger:0.08, ease:'power2.inOut'});\n"
            "// gsap.to('.solid-overlay path', {opacity:1, duration:0.3, delay:1.6, stagger:0.1, ease:'expo.out'});\n"
            "// gsap.fromTo('.node-badge', {x:-30, opacity:0},\n"
            "//     {x:0, opacity:1, duration:0.4, delay:2.2, stagger:0.12, ease:'expo.out'});\n"
        ),
        "guidelines": [
            "BACKGROUND: ALWAYS use `<div class='svg-canvas'>` as root — it provides cream #f5f0e8 + CSS grid.",
            "PALETTE: ONLY `var(--brand-primary)` and `var(--brand-accent)`. Never add a third color.",
            "DRAW-ON PATTERN (canonical): Add `pathLength='1' stroke-dasharray='1' stroke-dashoffset='1'` to every <path>/<rect>/<line>/<circle>/<ellipse> that should draw in. Then `gsap.to(el, {strokeDashoffset:0, duration:X, delay:Y, ease:'power2.inOut'});`.",
            "**BLUEPRINT DRAFT** (two-phase reveal — used by top-tier explainers like 'How to Play Volleyball'): "
            "Phase 1 draws a faint DASHED guide for the whole topology first. Phase 2 overlays SOLID-black nodes/badges on top. "
            "The dashed guide feels like an architect drafting, the solid overlay feels like ink landing. Example: "
            "`<g id='draft' stroke='rgba(0,0,0,0.35)' stroke-width='1.5' stroke-dasharray='4 4' fill='none'>"
            "<path d='M50,200 L200,200 L200,100 L400,100' pathLength='1' stroke-dashoffset='1'/></g>` "
            "then for the solid overlay: `<g id='solid' stroke='var(--brand-text)' stroke-width='2.5' fill='none'>"
            "<path d='M50,200 L200,200 L200,100 L400,100' opacity='0'/></g>`. "
            "Script: `gsap.to('#draft path', {strokeDashoffset:0, duration:1.2, ease:'power2.inOut', stagger:0.08});` "
            "then `gsap.to('#solid path', {opacity:1, duration:0.3, delay:1.4, stagger:0.1, ease:'expo.out'});`. "
            "Use this for: pipeline diagrams, flow charts, agent topologies, architectural schematics, map connectors.",
            "**PAPER GRAIN TEXTURE**: Add `.paper-texture` class to `.svg-canvas` root: "
            "`<div class='svg-canvas paper-texture'>` — applies a fibrous parchment noise overlay via SVG data-URI. "
            "Use `.paper-texture.strong` for a heavier sketchbook feel. Required for the 'MacBook Neo blueprint' look.",
            "**HAND-DRAWN WOBBLE**: Wrap line-art SVG elements in `<g filter='url(#roughen)'>` to make "
            "clean bezier paths look like architect sketches. Preserves `stroke-dashoffset` animation so "
            "draw-on still works. Use `url(#roughen-strong)` for bolder wobble. Example: "
            "`<g filter='url(#roughen)'><rect id='laptop' ... pathLength='1' stroke-dashoffset='1'/></g>`.",
            "**TECH ANNOTATIONS** (red dashed dimension lines — engineering drafting feel): "
            "Use `.tech-annotation` class for red dashed SVG strokes. Example: "
            "`<line x1='100' y1='40' x2='500' y2='40' class='tech-annotation' pathLength='1' stroke-dashoffset='1'/>` "
            "with a `<text class='tech-annotation-label' x='300' y='30'>16-INCH DISPLAY</text>` above it. "
            "Pair with `.tech-annotation-caption` italic serif for 'Fig. 1 — description' fig captions. "
            "Red annotations DON'T violate the 2-color rule — they read as 'utility markup', not content.",
            "**ZOOM-THROUGH TRANSITION** (scene exit via zoom into an element): "
            "Pick a small element in the current scene (crosshair dot, badge corner, node marker) and tween "
            "`gsap.to('#target', {scale:25, x:(window.innerWidth/2 - targetX), y:(window.innerHeight/2 - targetY), duration:0.8, delay:shotEnd-0.8, ease:'power3.in'});` "
            "Combine with `gsap.to('.stage-drift', {opacity:0, duration:0.3, delay:shotEnd-0.3, ease:'power2.in'});` "
            "for a seamless camera-push transition between scenes. Used in the MacBook Neo video between laptop → chip → OLED scenes.",
            "**VIGNETTE EXIT TRANSITION** (cinematic fade-out darkening from edges): "
            "Add `<div class='vignette-overlay'></div>` as the last child. Tween at the end of the shot: "
            "`gsap.to('.vignette-overlay', {opacity:1, duration:0.6, delay:shotEnd-0.6, ease:'power2.in'});` "
            "Gives a dramatic breath-beat before the outro. Pair with `.stage-drift` scale-up for "
            "zoom-while-darkening effect.",
            "CIRCLE/DOT ENTRANCE: `gsap.to('.dots', {scale:1, opacity:1, stagger:0.12, delay:1.0, ease:'back.out(2)', transformOrigin:'center center'});` (set initial scale:0, opacity:0 inline).",
            "BALL MOTION PATH: `<path id='arc' d='M...' fill='none' stroke='none'/>` + `<circle id='ball'/>` + `gsap.to('#ball', {motionPath:{path:'#arc', align:'#arc'}, duration:1.5, ease:'power1.inOut'});` — always guard with `if(window.MotionPathPlugin) gsap.registerPlugin(MotionPathPlugin);`.",
            "ISOMETRIC LAYOUT (optional for courts/maps): `<g style='transform:rotateX(60deg) rotateZ(-45deg); transform-style:preserve-3d;'>`.",
            "SECTION BADGE SLIDE-IN: `<div style='overflow:hidden;display:inline-block'><div id='badge' style='background:var(--brand-accent);padding:6px 18px;transform:translateX(-110%);border-radius:4px;'>1. THE PASS</div></div>` + `gsap.to('#badge',{x:'0%',duration:0.45,ease:'expo.out'});`.",
            "DO NOT: use `<img>`, `<video>`, `data-img-prompt`, dark backgrounds, more than 2 colors.",
            "DO NOT: use `background-image` referencing external URLs in any style attribute.",
            "STAGGER timing: entrance for each SVG element should be 0.1-0.2s apart. Keep total shot ≤5s.",
        ],
    },

    # ------------------------------------------------------------------
    # KINETIC_TITLE — bold full-screen typography, word-wipe reveal
    # ------------------------------------------------------------------
    "KINETIC_TITLE": {
        "id": "KINETIC_TITLE",
        "name": "Kinetic Title",
        "category": "text",
        "description": "Full-screen bold typography on cream background. Word-wipe reveal (translateY 100%→0%) with one accent-color word. For hooks, section intros, and outros.",
        "use_for": "Opening hooks, section headers ('1. THE PASS'), concluding calls-to-action ('GET OUT THERE AND PLAY'). No diagrams — single powerful phrase only.",
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["general", "sports", "language", "history", "science"],
        "html_template": (
            "<!-- KINETIC_TITLE: cream bg, massive type, word-wipe reveal, 1 accent word -->\n"
            "<div class='svg-canvas' style='display:flex; flex-direction:column; align-items:center;\n"
            "     justify-content:center; overflow:hidden;'>\n"
            "\n"
            "  <!-- Word-wipe reveal: each word wrapped in overflow:hidden container -->\n"
            "  <div style='display:flex; flex-wrap:wrap; gap:0.3em; justify-content:center;\n"
            "       align-items:flex-end; line-height:1;'>\n"
            "\n"
            "    <div style='overflow:hidden;'>\n"
            "      <span id='kw-0' style='display:inline-block; transform:translateY(100%);\n"
            "          font-family:Bebas Neue,Impact,sans-serif; font-size:8rem;\n"
            "          color:var(--brand-primary); letter-spacing:0.06em;'>GET</span>\n"
            "    </div>\n"
            "\n"
            "    <div style='overflow:hidden;'>\n"
            "      <span id='kw-1' style='display:inline-block; transform:translateY(100%);\n"
            "          font-family:Bebas Neue,Impact,sans-serif; font-size:8rem;\n"
            "          color:var(--brand-primary); letter-spacing:0.06em;'>OUT</span>\n"
            "    </div>\n"
            "\n"
            "    <div style='overflow:hidden;'>\n"
            "      <span id='kw-2' style='display:inline-block; transform:translateY(100%);\n"
            "          font-family:Bebas Neue,Impact,sans-serif; font-size:8rem;\n"
            "          color:var(--brand-primary); letter-spacing:0.06em;'>THERE</span>\n"
            "    </div>\n"
            "\n"
            "    <div style='overflow:hidden;'>\n"
            "      <span id='kw-3' style='display:inline-block; transform:translateY(100%);\n"
            "          font-family:Bebas Neue,Impact,sans-serif; font-size:8rem;\n"
            "          color:var(--brand-accent); letter-spacing:0.06em;'>AND PLAY</span>\n"
            "    </div>\n"
            "\n"
            "  </div>\n"
            "\n"
            "  <!-- Optional: badge section intro (uncomment for section headers) -->\n"
            "  <!-- <div style='overflow:hidden;display:inline-block;margin-top:2rem;'>\n"
            "    <div id='badge' style='background:var(--brand-accent);color:#fff;\n"
            "        padding:8px 24px;border-radius:4px;font-family:Bebas Neue,sans-serif;\n"
            "        font-size:1.8rem;letter-spacing:0.1em;transform:translateX(-110%);'>1. THE PASS</div>\n"
            "  </div> -->\n"
            "\n"
            "</div>\n"
        ),
        "script_block": (
            "// Word-wipe: translateY(100% → 0%) staggered per word\n"
            "gsap.to('#kw-0', {y:'0%', duration:0.4, delay:0.05, ease:'power3.out'});\n"
            "gsap.to('#kw-1', {y:'0%', duration:0.4, delay:0.20, ease:'power3.out'});\n"
            "gsap.to('#kw-2', {y:'0%', duration:0.4, delay:0.35, ease:'power3.out'});\n"
            "gsap.to('#kw-3', {y:'0%', duration:0.45, delay:0.50, ease:'expo.out'});\n"
            "// For badge slide-in (if used):\n"
            "// gsap.to('#badge', {x:'0%', duration:0.45, delay:0.2, ease:'expo.out'});\n"
        ),
        "guidelines": [
            "BACKGROUND: Use `<div class='svg-canvas'>` — cream #f5f0e8 with grid. Never a dark background.",
            "TYPOGRAPHY: Bebas Neue or Impact, 7-10rem. All caps. Lots of whitespace.",
            "ACCENT WORD: The last word or key word gets `color:var(--brand-accent)`. All others use `var(--brand-primary)`. CRITICAL: when the accent word is NOT on its own flexbox line, insert `&nbsp;` before the colored span — `STARTS&nbsp;<span style='color:var(--brand-accent)'>HERE</span>` — otherwise adjacent inline-blocks collapse the whitespace and the words render as one (`STARTSHERE`). The word-wipe template below works because each word is its own flexbox child with `gap:0.3em`; if you deviate from that, you own the spacing.",
            "WORD-WIPE PATTERN: Wrap each word in `<div style='overflow:hidden'><span id='kw-N' style='display:inline-block;transform:translateY(100%)'>WORD</span></div>`. Animate: `gsap.to('#kw-N', {y:'0%', duration:0.4, delay:N*0.15, ease:'power3.out'});`.",
            "SECTION BADGE: `<div style='overflow:hidden;display:inline-block'><div id='badge' style='background:var(--brand-accent);transform:translateX(-110%)'>1. THE PASS</div></div>` + `gsap.to('#badge',{x:'0%',duration:0.45,ease:'expo.out'});`.",
            "KEEP IT MINIMAL: one phrase, 2-5 words. No body text, no diagrams, no images.",
            "Ideal duration: 1.5-3s. The words should all be visible by the 1s mark.",
            "BRAND-ANCHOR: when a BRAND ANCHOR block appears in the user prompt, the word(s) MUST reference the named product/brand. The 'GET OUT THERE AND PLAY' template above is an EXAMPLE only — replace with brand-specific copy (e.g. 'PARLE-G — TASTE THE MOMENT'). Never ship generic agency taglines like 'Let's take your brand on an adventure'.",
        ],
    },

    # ------------------------------------------------------------------
    # ANIMATED_ASSET — cutout images with GSAP animation
    # ------------------------------------------------------------------
    "ANIMATED_ASSET": {
        "id": "ANIMATED_ASSET",
        "name": "Animated Asset",
        "category": "interactive",
        "description": "Cutout images with transparent backgrounds, positioned absolutely, animated with GSAP.",
        "use_for": "Illustrating concepts with floating objects — molecules, planets, animals, tools, historical artifacts.",
        "requires_image": True,
        "requires_video": False,
        "preferred_domains": ["science", "history", "general"],
        "html_template": (
            "<div style='position:relative; width:{canvas_width}px; height:{canvas_height}px; overflow:hidden;'>\n"
            "  <h1 id='title' style='opacity:0; position:absolute; top:80px; left:100px;\n"
            "      font-family:Montserrat,sans-serif; font-size:64px; font-weight:800;\n"
            "      color:var(--text-color,#fff);'>The Water Cycle</h1>\n"
            "  <img id='cloud' class='generated-image'\n"
            "       data-img-prompt='single white fluffy cumulus cloud, centered, isolated on solid dark blue background, no other objects, clean edges'\n"
            "       data-cutout='true' src='placeholder.png'\n"
            "       style='position:absolute; top:60px; right:100px; width:350px; opacity:0;' />\n"
            "  <img id='sun' class='generated-image'\n"
            "       data-img-prompt='bright yellow sun with gentle rays, centered, isolated on solid dark navy background, no other objects, clean edges'\n"
            "       data-cutout='true' src='placeholder.png'\n"
            "       style='position:absolute; top:30px; left:200px; width:200px; opacity:0;' />\n"
            "</div>\n"
        ),
        "script_block": (
            "fadeIn('#title', 0.5, 0);\n"
            "gsap.fromTo('#sun', {scale:0, opacity:0}, {scale:1, opacity:1, duration:1.2, delay:0.3, ease:'back.out(1.7)'});\n"
            "gsap.fromTo('#cloud', {x:300, opacity:0}, {x:0, opacity:1, duration:1.5, delay:0.8, ease:'power2.out'});\n"
        ),
        "guidelines": [
            "Use `position:absolute` for ALL elements so they can be placed freely",
            "Image prompts MUST describe a SINGLE object on a SOLID, HIGH-CONTRAST background for clean cutout",
            "  Good: 'single red apple, centered, isolated on solid white background, studio lighting'",
            "  Bad: 'apples on a table in a kitchen' (complex background = rough edges)",
            "ALWAYS end cutout prompts with: 'isolated on solid [color] background, no other objects, clean edges'",
            "Choose background color that CONTRASTS with the object",
            "Always include `data-cutout=\"true\"` on images needing background removal",
            "Keep animations simple: float-in, drop, scale-up, slide, gentle rotation",
            "Max 3 elements animating simultaneously. Stagger reveals 300-500ms apart.",
            "Easing: `power2.out` (standard), `expo.out` (grand), `sine.inOut` (smooth loops). Avoid `linear`.",
            "After entrance animation, objects must STAY VISIBLE during narration — don't animate out.",
        ],
    },
    # ------------------------------------------------------------------
    # DEVICE_MOCKUP — purpose-built HTML/CSS UI for digital interactions
    # (phone, browser, terminal, dashboard, chat) instead of a stock photo
    # of one. Every element is animatable; nothing is locked into a JPEG.
    # ------------------------------------------------------------------
    "DEVICE_MOCKUP": {
        "id": "DEVICE_MOCKUP",
        "name": "Device Mockup",
        "category": "ui",
        "description": (
            "Purpose-built HTML/CSS device interface — phone, browser tab, terminal window, "
            "code editor, chat app, or dashboard — constructed from primitives so every "
            "element can animate to narration. Strictly NO stock photo of the device."
        ),
        "use_for": (
            "Any moment whose narration depicts a digital interaction: receiving a chat message, "
            "opening a browser tab, running a command, scrolling a dashboard, signing into an app, "
            "watching code update, viewing a notification, sending a document. Stock photos of "
            "phones / screens read as generic and cannot be choreographed; build the UI instead."
        ),
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": [
            "saas_marketing", "saas_demo", "business_marketing",
            "coding", "general", "input_video_demo",
        ],
        "html_template": (
            "<!-- DEVICE_MOCKUP — phone variant. Browser / terminal / dashboard variants in guidelines. -->\n"
            "<!-- Layout: composition wrapper (.stage-drift) + device frame + interior + flash overlay slot. -->\n"
            "<div class='stage-drift' style='display:flex; align-items:center; justify-content:center;\n"
            "     background: linear-gradient(135deg, #f0e5d0 0%, #e0d2b8 100%);'>\n"
            "  <div class='phone' style='position:relative; width:320px; max-width:80%; height:620px;\n"
            "       max-height:85%; background:#1a120a; border-radius:36px; padding:12px;\n"
            "       box-shadow:0 24px 60px rgba(0,0,0,0.4); transform:rotate(-3deg) translateY(20px);\n"
            "       opacity:0;'>\n"
            "    <!-- Notch -->\n"
            "    <div style='position:absolute; top:18px; left:50%; transform:translateX(-50%);\n"
            "         width:100px; height:22px; background:#0a0604; border-radius:12px; z-index:10;'></div>\n"
            "    <!-- Screen -->\n"
            "    <div style='width:100%; height:100%; background:#fdf8ec; border-radius:26px;\n"
            "         padding:44px 14px 14px 14px; overflow:hidden; position:relative;\n"
            "         display:flex; flex-direction:column; gap:0.6rem;'>\n"
            "      <!-- Status bar (fake clock + signal/wifi/battery) -->\n"
            "      <div style='position:absolute; top:14px; left:24px; right:24px;\n"
            "           display:flex; justify-content:space-between;\n"
            "           font-family:Fira Code,monospace; font-size:0.65rem; font-weight:700;\n"
            "           letter-spacing:0.1em; color:var(--brand-text);'>\n"
            "        <span>9:41</span><span>● ● ● ●</span>\n"
            "      </div>\n"
            "      <!-- Header strip -->\n"
            "      <div style='display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0.8rem;\n"
            "           border-bottom:1px solid rgba(110,100,83,0.15);'>\n"
            "        <div style='width:32px; height:32px; border-radius:50%;\n"
            "             background:var(--brand-primary); color:#fff;\n"
            "             display:flex; align-items:center; justify-content:center;\n"
            "             font-family:Bebas Neue,sans-serif;'>FM</div>\n"
            "        <div>\n"
            "          <div style='font-size:0.78rem; font-weight:700;'>Factory Manager</div>\n"
            "          <div style='font-size:0.62rem; color:#16a34a; font-weight:600;'>● online</div>\n"
            "        </div>\n"
            "      </div>\n"
            "      <!-- Message 1 — text bubble -->\n"
            "      <div id='msg-1' class='msg' style='opacity:0; transform:translateY(20px) scale(0.9);\n"
            "           transform-origin:bottom left; max-width:88%;'>\n"
            "        <div style='padding:0.4rem; background:#fff; border-radius:14px;\n"
            "             border-bottom-left-radius:4px;\n"
            "             box-shadow:0 2px 8px rgba(0,0,0,0.06); font-size:0.78rem;'>\n"
            "          Fabric arrived. Batch 402 logged.\n"
            "        </div>\n"
            "      </div>\n"
            "      <!-- Message 2 — photo proof with metadata strip -->\n"
            "      <div id='msg-2' class='msg' style='opacity:0; transform:translateY(20px) scale(0.9);\n"
            "           max-width:88%;'>\n"
            "        <div style='padding:0.4rem; background:#fff; border-radius:14px;'>\n"
            "          <div style='width:100%; height:90px; border-radius:10px; position:relative;\n"
            "               background:linear-gradient(135deg,#9c8770,#6e6453);'>\n"
            "            <div style='position:absolute; bottom:4px; left:6px;\n"
            "                 font-family:Fira Code,monospace; font-size:0.55rem; font-weight:700;\n"
            "                 color:#fff; background:rgba(0,0,0,0.5); padding:1px 6px;\n"
            "                 border-radius:3px; letter-spacing:0.1em;'>FABRIC · BATCH 402</div>\n"
            "          </div>\n"
            "        </div>\n"
            "      </div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "// Phone enters and breathes\n"
            "gsap.fromTo('.phone', {opacity:0, y:20, scale:0.92},\n"
            "  {opacity:1, y:0, scale:1, duration:0.7, delay:0.3, ease:'power3.out'});\n"
            "gsap.to('.phone', {y:-8, duration:2.5, delay:1.2,\n"
            "  repeat:-1, yoyo:true, ease:'sine.inOut'});\n"
            "// Messages reveal one-by-one synced to narration beats\n"
            "// Pull `delay:` values from the WORD TIMINGS table — do NOT use round numbers\n"
            "gsap.to('#msg-1', {opacity:1, y:0, scale:1, duration:0.5,\n"
            "  delay:1.0, ease:'back.out(1.5)'});\n"
            "gsap.to('#msg-2', {opacity:1, y:0, scale:1, duration:0.5,\n"
            "  delay:2.4, ease:'back.out(1.5)'});\n"
        ),
        "guidelines": [
            "Build the device CHROME from primitives — frame, notch, status bar, header. NEVER use a stock photo of a phone, browser, or screen.",
            "Phone variant: rounded body with `border-radius:36px`, padding for the notch, dark frame color (#0a0604 or similar), screen tilt of -3° to 4° feels organic.",
            "Browser variant: chrome bar with three traffic-light dots (#fc625d, #fdbc40, #34c749), URL pill, tab strip. Body interior is the actual page being shown.",
            "Terminal variant: black/charcoal body, top bar with traffic lights, monospace text inside, blinking cursor (`@keyframes blink {50% {opacity:0}}`). Use ANSI-style colors for output.",
            "Code editor variant: dark bg (#1e1e2e or similar), syntax-highlighted span colors (Prism.js or hand-coded), line numbers in muted gray gutter, optional file tab.",
            "Dashboard variant: side nav bar, header with user avatar, content grid with chart cards. Each card is a `.bento-card` with a sparkline/bar SVG inside.",
            "EVERY interactive element gets its own id and animates to narration: notification dots ping in, messages slide+scale on emphasis words, status text typewrites in.",
            "Reveal pattern: device enters at 0.0–0.5s (scale + rotate + fade), one element appears per narration emphasis word, ambient breath/yoyo on the device for the hold.",
            "Multi-message sequences (chat, log streams, code typing): pull each `delay:` from the Rel(s) column of WORD TIMINGS. Do NOT space them on round numbers.",
            "Inline SVG icons inside the device — emoji 📸 🎥 📋 inside a phone screen render badly across video frames. Use Iconify (`<iconify-icon icon='mdi:camera-outline' width='14'>`) or hand-coded SVG.",
            "Allowed off-brand colors INSIDE the device chrome: traffic-light dots, REC indicator red, signal-bar grey. Outside the chrome, stay on brand palette + Director-flagged semantic accents.",
        ],
    },

    # ------------------------------------------------------------------
    # IMAGE_CLIP — display an indexed source image full-frame with HTML
    # overlays on top. Unlike SOURCE_CLIP, the image URL is embedded
    # directly in the HTML (no render-worker compositing needed) — the
    # planner reads source_public_url from the image asset context and
    # places it as the background <img>.
    # ------------------------------------------------------------------
    "IMAGE_CLIP": {
        "id": "IMAGE_CLIP",
        "name": "Source Image Clip",
        "category": "static",
        "description": (
            "Display a user-uploaded image full-frame with HTML overlays "
            "(captions, lower thirds, callouts, annotations). Use for "
            "presenting photographs, screenshots, diagrams, or any uploaded "
            "still image as a beat in the generated video."
        ),
        "use_for": (
            "Showing a photograph during narration about a person/place, "
            "displaying a screenshot while explaining a UI, "
            "presenting a diagram while walking through a concept."
        ),
        "requires_image": False,  # the image is supplied via the asset context, not requested
        "requires_video": False,
        # NOT included in 'general' — IMAGE_CLIP is only useful when an
        # image asset is provided; without one, the {{IMAGE_URL}} placeholder
        # has no real URL to substitute and the shot would render broken.
        "preferred_domains": [
            "input_image_photo", "input_image_screenshot", "input_image_diagram",
            "input_mixed_assets",
        ],
        "html_template": (
            "<!-- IMAGE_CLIP: full-frame image with HTML overlays.\n"
            "     Replace {{IMAGE_URL}} with the source_public_url from the\n"
            "     image asset context. Image renders as background; overlays\n"
            "     stack on top with z-index. -->\n"
            "<div style='width:100%; height:100%; position:relative; background:#000;'>\n"
            "  <img src='{{IMAGE_URL}}'\n"
            "       style='position:absolute; inset:0; width:100%; height:100%;\n"
            "              object-fit:cover; z-index:0;' />\n"
            "\n"
            "  <!-- Optional dim layer for caption legibility -->\n"
            "  <div style='position:absolute; inset:0; background:linear-gradient(\n"
            "       180deg, transparent 50%, rgba(0,0,0,0.55) 100%); z-index:1;'></div>\n"
            "\n"
            "  <!-- Lower-third caption -->\n"
            "  <div style='position:absolute; bottom:8%; left:5%; right:5%; z-index:2;\n"
            "       background:rgba(0,0,0,0.7); padding:1.2rem 2rem; border-radius:0.5rem;\n"
            "       border-left:4px solid var(--brand-accent);'>\n"
            "    <div id='caption-text' style='font-family:Inter,sans-serif; font-size:1.8rem;\n"
            "         color:#fff; font-weight:600; opacity:0; transform:translateY(10px);'>\n"
            "      A timely caption goes here\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n"
        ),
        "script_block": (
            "// Animate caption in\n"
            "gsap.to('#caption-text', {opacity:1, y:0, duration:0.5, delay:0.3, ease:'power3.out'});\n"
        ),
        "guidelines": [
            "Use the source_public_url from the asset context as the <img> src — "
            "do NOT use data-img-prompt or data-video-query (the image is supplied).",
            "Image fills the frame via object-fit:cover. Overlays render on top via z-index.",
            "Keep overlays in the BOTTOM 30% of the screen so the image's subject stays visible.",
            "Use semi-transparent dark backgrounds (rgba(0,0,0,0.7)) for caption readability.",
            "Suggested elements: captions, lower thirds, name titles, OCR-derived callouts.",
            "Default duration suggestions: photo 4s, screenshot 6s, diagram 8s. Override "
            "via planner timing if narration warrants longer dwell.",
            "For screenshots/diagrams: feel free to draw attention to OCR-detected regions "
            "with annotation arrows or boxes positioned relative to the image's bbox_norm coords.",
        ],
    },

    # ------------------------------------------------------------------
    # SOURCE_CLIP — play a clip from the indexed source video with
    # transparent HTML overlays on top (captions, lower thirds, callouts)
    # ------------------------------------------------------------------
    "SOURCE_CLIP": {
        "id": "SOURCE_CLIP",
        "name": "Source Video Clip",
        "category": "video",
        "description": (
            "Play a clip from the indexed source video. The viewer sees the original footage "
            "(the speaker, the interview setting, the screen recording). HTML overlays render "
            "ON TOP of the video with a transparent background. Use for key quotes, soundbites, "
            "emotional moments, or showing the original content."
        ),
        "use_for": (
            "Showing the original speaker during impactful quotes, "
            "displaying screen recordings during key demonstrations, "
            "any moment where the source footage is more powerful than AI graphics."
        ),
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["input_video_podcast", "input_video_demo", "general"],
        "html_template": (
            "<!-- SOURCE_CLIP: overlay on top of source video footage -->\n"
            "<!-- CRITICAL: background MUST be #000000 (black) — black pixels become transparent -->\n"
            "<!-- during compositing. The source video plays behind all non-black content. -->\n"
            "<div style='width:100%; height:100%; position:relative; background:#000000;'>\n"
            "\n"
            "  <!-- Lower-third caption (bottom 20% of screen) -->\n"
            "  <div style='position:absolute; bottom:8%; left:5%; right:5%;\n"
            "       background:rgba(0,0,0,0.7); padding:1.2rem 2rem; border-radius:0.5rem;\n"
            "       border-left:4px solid var(--brand-accent);'>\n"
            "    <div id='caption-text' style='font-family:Inter,sans-serif; font-size:1.8rem;\n"
            "         color:#fff; font-weight:600; opacity:0; transform:translateY(10px);'>\n"
            "      Design is how it works\n"
            "    </div>\n"
            "  </div>\n"
            "\n"
            "  <!-- Optional: speaker name title -->\n"
            "  <div id='name-tag' style='position:absolute; bottom:28%; left:5%;\n"
            "       opacity:0; transform:translateX(-20px);'>\n"
            "    <span style='font-family:Bebas Neue,sans-serif; font-size:1.3rem;\n"
            "         color:var(--brand-accent); letter-spacing:0.12em;'>STEVE JOBS</span>\n"
            "  </div>\n"
            "\n"
            "</div>\n"
        ),
        "script_block": (
            "// Animate caption in\n"
            "gsap.to('#caption-text', {opacity:1, y:0, duration:0.5, delay:0.3, ease:'power3.out'});\n"
            "// Animate name tag in\n"
            "gsap.to('#name-tag', {opacity:1, x:0, duration:0.4, delay:0.6, ease:'power2.out'});\n"
        ),
        "guidelines": [
            "Background MUST be solid #000000 (black). Black pixels become transparent during compositing.",
            "All non-black content renders as overlay on top of the source video footage.",
            "Keep overlays in the BOTTOM 30% of the screen — don't cover the speaker's face.",
            "Use semi-transparent dark backgrounds (rgba(0,0,0,0.7)) for text readability.",
            "Suggested elements: captions, lower thirds, name titles, callout arrows, stats.",
            "DO NOT use <img> tags or data-img-prompt — the video itself is the visual.",
            "DO NOT use data-video-query — the source video is already playing.",
            "Animations should be subtle — the video content is the star, overlays support it.",
        ],
    },

    # ------------------------------------------------------------------
    # ARTICLE_FOCUS — show the actual scraped article page as evidence,
    # zoom-pan toward a quote pulled from the article body. ONLY available
    # for news_recap videos when scrape_url captured page screenshots.
    # Renders deterministically via the article_focus_zoom_pan template;
    # the per-shot HTML LLM is bypassed.
    # ------------------------------------------------------------------
    "ARTICLE_FOCUS": {
        "id": "ARTICLE_FOCUS",
        "name": "Article Focus",
        "category": "evidence",
        "description": (
            "Showcase the source article — the actual web page screenshot from scrape_url — "
            "with a slow GSAP zoom-pan toward a highlighted quote box. Tells the viewer "
            "'this is real, here is the source.' Optionally pairs the screenshot with an "
            "animated pull-quote overlay carrying the verbatim sentence from the article."
        ),
        "use_for": (
            "news_recap videos where a URL was scraped. Use 1–2 ARTICLE_FOCUS shots per "
            "video — typically one early (above_fold) to anchor the source, and optionally "
            "one mid-video (mid/footer) to cite a quote."
        ),
        "requires_image": False,
        "requires_video": False,
        "preferred_domains": ["news_recap", "documentary", "general"],
        # Renders via the deterministic template registry; no per-shot LLM call.
        "default_template_id": "article_focus_zoom_pan",
        "html_template": (
            "<!-- ARTICLE_FOCUS: rendered by template article_focus_zoom_pan. -->\n"
            "<!-- The Director sets template_id and template_params; the pipeline -->\n"
            "<!-- bypasses the per-shot LLM and composes the HTML deterministically. -->\n"
        ),
        "script_block": "",
        "guidelines": [
            "Set `template_id`: 'article_focus_zoom_pan' on the shot to bypass per-shot LLM.",
            "Required `template_params`: { screenshot_id, quote_text, highlight_box_pct, accent_color }.",
            "`screenshot_id` MUST match one of the AVAILABLE ARTICLE SCREENSHOTS in the user prompt "
            "(typically 'above_fold' for the hero anchor, 'mid' or 'footer' for evidence beats, "
            "'inline_0..N' for inline article images).",
            "`quote_text` is the verbatim sentence from the article you want overlaid (≤ 120 chars).",
            "`highlight_box_pct`: { x_pct, y_pct, w_pct, h_pct } — rect in 0–100 scale to zoom toward. "
            "Default to {x_pct:5, y_pct:8, w_pct:90, h_pct:50} if you don't have a precise location.",
            "Best at 3–5s shot duration. Long enough to read the quote; short enough to keep pace.",
        ],
        "director_inputs": {
            "template_id": "article_focus_zoom_pan",
            "template_params": [
                "screenshot_id",
                "quote_text",
                "highlight_box_pct",
                "accent_color",
            ],
        },
    },
}


# ═══════════════════════════════════════════════════════════════════════════
# Key Takeaway + Wrong vs Right — reusable patterns included with TEXT_DIAGRAM
# ═══════════════════════════════════════════════════════════════════════════

KEY_TAKEAWAY_PATTERN = (
    "**KEY TAKEAWAY CARD (USE AT END OF EACH CONCEPT)**:\n"
    "```html\n"
    "<div class='key-takeaway'>\n"
    "  <div class='takeaway-icon'>💡</div>\n"
    "  <div class='takeaway-content'>\n"
    "    <span class='takeaway-label'>Key Takeaway</span>\n"
    "    <p class='takeaway-text'>Photosynthesis converts sunlight into food for plants.</p>\n"
    "  </div>\n"
    "</div>\n"
    "```\n\n"
)

WRONG_RIGHT_PATTERN = (
    "**WRONG VS RIGHT (USE FOR COMMON MISTAKES)**:\n"
    "```html\n"
    "<div class='wrong-right-container'>\n"
    "  <div class='wrong-box'>\n"
    "    <div class='wr-header'><span class='wr-icon'>❌</span> Common Mistake</div>\n"
    "    <p class='wr-text'>Plants eat soil to grow</p>\n"
    "  </div>\n"
    "  <div class='right-box'>\n"
    "    <div class='wr-header'><span class='wr-icon'>✅</span> Actually...</div>\n"
    "    <p class='wr-text'>Plants make their own food using sunlight!</p>\n"
    "  </div>\n"
    "</div>\n"
    "```\n"
    "Animate: show wrong first (`fadeIn('.wrong-box', 0.5, 0)`), then right (`fadeIn('.right-box', 0.5, 1.5)`).\n\n"
)

DIAGRAM_TEMPLATES = (
    "**PRE-BUILT DIAGRAM TEMPLATES (data-attribute auto-render)**:\n"
    "1. **Timeline**: `<div data-diagram='timeline' data-items='[{\"year\":\"1969\",\"label\":\"Moon Landing\"}]'></div>`\n"
    "2. **Comparison**: `<div data-diagram='comparison' data-left='{\"title\":\"Pros\",\"items\":[\"Fast\"]}' data-right='{\"title\":\"Cons\",\"items\":[\"Limited\"]}'></div>`\n"
    "3. **Cycle**: `<div data-diagram='cycle' data-items='[\"Evaporation\",\"Condensation\",\"Precipitation\"]'></div>`\n"
    "4. **Hierarchy**: `<div data-diagram='hierarchy' data-root='{\"label\":\"Kingdom\",\"children\":[{\"label\":\"Phylum\"}]}'></div>`\n"
    "5. **Venn**: `<div data-diagram='venn' data-sets='[{\"label\":\"Plants\"},{\"label\":\"Animals\"}]' data-overlap='[\"Eukaryotic\"]'></div>`\n"
    "6. **Data Chart**: `<div data-diagram='data-chart' data-type='bar' data-values='[{\"label\":\"Q1\",\"value\":42}]'></div>`\n"
    "Use these instead of Mermaid for simple structured diagrams.\n\n"
)


# ═══════════════════════════════════════════════════════════════════════════
# Domain → shot type mapping
# ═══════════════════════════════════════════════════════════════════════════

# Maps subject domains to the shot types they should have access to.
# TEXT_DIAGRAM is always included. Order matters — first listed = most preferred.
DOMAIN_SHOT_TYPES: Dict[str, List[str]] = {
    # Education domains
    "coding": ["TEXT_DIAGRAM", "PROCESS_STEPS", "DATA_STORY", "IMAGE_SPLIT", "DEVICE_MOCKUP"],
    "history": ["IMAGE_HERO", "VIDEO_HERO", "IMAGE_SPLIT", "ANIMATED_ASSET", "TEXT_DIAGRAM", "LOWER_THIRD"],
    "science": ["IMAGE_SPLIT", "ANIMATED_ASSET", "TEXT_DIAGRAM", "ANNOTATION_MAP", "PROCESS_STEPS", "VIDEO_HERO"],
    "biology": ["ANNOTATION_MAP", "ANIMATED_ASSET", "IMAGE_SPLIT", "PROCESS_STEPS", "TEXT_DIAGRAM", "VIDEO_HERO"],
    "chemistry": ["ANIMATED_ASSET", "EQUATION_BUILD", "PROCESS_STEPS", "TEXT_DIAGRAM", "IMAGE_SPLIT"],
    "geography": ["VIDEO_HERO", "IMAGE_HERO", "ANNOTATION_MAP", "IMAGE_SPLIT", "TEXT_DIAGRAM", "DATA_STORY"],
    "math": ["TEXT_DIAGRAM", "EQUATION_BUILD", "PROCESS_STEPS"],
    "language": ["TEXT_DIAGRAM", "IMAGE_HERO", "LOWER_THIRD", "IMAGE_SPLIT"],
    # Marketing / business domains
    "saas_marketing": ["VIDEO_HERO", "DEVICE_MOCKUP", "IMAGE_HERO", "TEXT_DIAGRAM", "DATA_STORY", "IMAGE_SPLIT"],
    "business_marketing": ["VIDEO_HERO", "DEVICE_MOCKUP", "IMAGE_HERO", "TEXT_DIAGRAM", "DATA_STORY", "IMAGE_SPLIT"],
    "saas_demo": ["DEVICE_MOCKUP", "IMAGE_SPLIT", "PROCESS_STEPS", "TEXT_DIAGRAM", "ANNOTATION_MAP", "IMAGE_HERO"],
    # Creative domains
    "visual_storytelling": ["VIDEO_HERO", "IMAGE_HERO", "IMAGE_SPLIT", "ANIMATED_ASSET", "LOWER_THIRD"],
    # Illustrated SVG mode — pure SVG, no photos
    "illustrated_svg": ["KINETIC_TITLE", "INFOGRAPHIC_SVG", "KINETIC_TEXT"],
    # Product showcase — subject-centric brand reel
    "product_showcase": ["PRODUCT_HERO", "KINETIC_TITLE", "DATA_STORY", "LOWER_THIRD"],
    # Default
    "general": ["IMAGE_HERO", "VIDEO_HERO", "TEXT_DIAGRAM", "IMAGE_SPLIT", "ANIMATED_ASSET", "PROCESS_STEPS", "DEVICE_MOCKUP", "LOWER_THIRD"],
    # Input video modes — SOURCE_CLIP is the primary shot type
    "input_video_podcast": ["SOURCE_CLIP", "KINETIC_TITLE", "TEXT_DIAGRAM", "DATA_STORY", "LOWER_THIRD"],
    "input_video_demo": ["SOURCE_CLIP", "DEVICE_MOCKUP", "KINETIC_TITLE", "TEXT_DIAGRAM", "PROCESS_STEPS", "ANNOTATION_MAP", "LOWER_THIRD"],
    # Input image modes — IMAGE_CLIP is the primary shot type. Each mode's
    # secondary catalog matches what the image's metadata can support:
    #   photo      → caption-driven storytelling (lower thirds, kinetic titles)
    #   screenshot → UI walkthrough (annotation, process steps)
    #   diagram    → concept exposition (text diagram, data story)
    "input_image_photo": ["IMAGE_CLIP", "KINETIC_TITLE", "LOWER_THIRD", "TEXT_DIAGRAM"],
    # TEXT_DIAGRAM + DATA_STORY earn their place here: a product walkthrough
    # has to explain structure and numbers between the screenshots, and
    # without them a 15-still run has only one visual idea (a framed
    # screenshot) repeated for its whole length. Both are pure-graphics
    # types, so neither can fabricate a UI that contradicts the real one.
    "input_image_screenshot": [
        "IMAGE_CLIP", "ANNOTATION_MAP", "PROCESS_STEPS",
        "TEXT_DIAGRAM", "DATA_STORY", "LOWER_THIRD", "KINETIC_TITLE",
    ],
    "input_image_diagram": ["IMAGE_CLIP", "TEXT_DIAGRAM", "DATA_STORY", "KINETIC_TITLE", "LOWER_THIRD"],
    # Mixed assets — user picked at least one video AND at least one image.
    # Catalog is the union of the two primary clip types plus every shot
    # type that appears in either input_video_demo or input_image_diagram —
    # this preserves the secondary catalog options (DEVICE_MOCKUP, PROCESS_STEPS,
    # DATA_STORY) that single-asset domains have, so mixed flows aren't a
    # downgrade vs picking one kind alone.
    "input_mixed_assets": [
        "SOURCE_CLIP", "IMAGE_CLIP",
        "KINETIC_TITLE", "TEXT_DIAGRAM", "LOWER_THIRD",
        "DEVICE_MOCKUP", "PROCESS_STEPS", "ANNOTATION_MAP", "DATA_STORY",
    ],
}


def get_cards_for_domain(subject_domain: str) -> List[str]:
    """Return shot type IDs relevant to a subject domain.

    Always includes TEXT_DIAGRAM as the baseline. For domains not explicitly
    mapped, returns the 'general' set.
    """
    types = DOMAIN_SHOT_TYPES.get(subject_domain, DOMAIN_SHOT_TYPES["general"])
    # Ensure TEXT_DIAGRAM is always present
    if "TEXT_DIAGRAM" not in types:
        types = ["TEXT_DIAGRAM"] + types
    return types


def _format_card(
    card: Dict[str, Any],
    *,
    marketing: bool = False,
    composition: str = "",
) -> str:
    """Format a single shot type card as prompt text.

    `marketing=True` swaps in the card's MARKETING_EXAMPLES exemplar (when one
    exists) and drops whiteboard-prescribing guideline lines — the example code
    is the strongest signal in the prompt, so in marketing mode it must SHOW
    the premium look rather than the flat educational look.

    `composition` does the same job for the assigned frame. Every card's own
    exemplar is centre-stacked (`.full-screen-center` > `.layout-hero` > centred
    h1 + sub + svg), so educational runs were shown the one frame the preamble
    prose asks them to avoid — and the example won, every time. Passing a
    composition swaps in an exemplar that BUILDS that frame, and drops the
    guideline bullets that hard-prescribe centring so the card stops
    contradicting the contract.
    """
    html = card["html_template"]
    script = card.get("script_block")
    composition_bans: tuple = ()
    if marketing:
        ex = MARKETING_EXAMPLES.get(card["id"])
        if ex:
            html = ex["html"]
            script = ex["script"]
    elif composition:
        try:
            from composition_kit import (
                COMPOSITION_GUIDELINE_BANS,
                exemplar_for,
            )

            cex = exemplar_for(composition, card.get("id", ""))
            if cex:
                html = cex["html"]
                script = cex["script"]
                composition_bans = tuple(COMPOSITION_GUIDELINE_BANS)
        except Exception:
            # Never fail prompt assembly over an exemplar swap — the card's
            # own example is a valid fallback.
            pass
    lines = [
        f"**SHOT TYPE: {card['id']}** — {card['description']}",
        f"USE FOR: {card['use_for']}",
        "```html",
        html.rstrip(),
        "```",
    ]
    if script:
        lines.append("```javascript")
        lines.append(script.rstrip())
        lines.append("```")
    if card.get("guidelines"):
        kept = [
            g for g in card["guidelines"]
            if not (marketing and any(ban in g for ban in _MARKETING_GUIDELINE_BANS))
            and not any(ban in g for ban in composition_bans)
        ]
        if kept:
            lines.append("Guidelines:")
            for g in kept:
                lines.append(f"- {g}")
    lines.append("")  # blank line separator
    return "\n".join(lines)


def build_filtered_system_prompt(
    subject_domain: str,
    width: int = 1920,
    height: int = 1080,
) -> str:
    """Build a system prompt containing only the shot types relevant to a subject domain.

    This replaces the monolithic HTML_GENERATION_SYSTEM_PROMPT_ADVANCED with a
    focused prompt that is 38-67% smaller depending on the domain.
    """
    aspect_label = "9:16 portrait" if width < height else "16:9"
    is_portrait = width < height

    # 1. Core preamble (always included)
    parts = [CORE_PREAMBLE]

    # 2. Shot type cards (domain-filtered)
    card_ids = get_cards_for_domain(subject_domain)
    parts.append(
        "**CINEMATIC SHOT TYPES (use these for high-quality videos)**:\n"
        "MIX these with text-based shots for visual variety.\n\n"
    )
    for cid in card_ids:
        card = SHOT_TYPE_CARDS.get(cid)
        if card:
            formatted = _format_card(card)
            # Replace dimension placeholders
            formatted = (
                formatted
                .replace("{canvas_width}", str(width))
                .replace("{canvas_height}", str(height))
                .replace("{aspect_label}", aspect_label)
            )
            parts.append(formatted)

    # 3. Image prompt guidelines (if any image-capable cards are included)
    has_image_cards = any(
        SHOT_TYPE_CARDS.get(cid, {}).get("requires_image") or
        SHOT_TYPE_CARDS.get(cid, {}).get("requires_video")
        for cid in card_ids
    )
    if has_image_cards:
        parts.append(
            IMAGE_PROMPT_GUIDELINES
            .replace("{aspect_label}", aspect_label)
        )

    # 4. Animation tools (always included)
    parts.append(ANIMATION_TOOLS)

    # 5. Educational principles (always included)
    parts.append(EDUCATIONAL_PRINCIPLES)

    # 6. Key Takeaway + Wrong vs Right patterns (if TEXT_DIAGRAM is included)
    if "TEXT_DIAGRAM" in card_ids:
        parts.append(KEY_TAKEAWAY_PATTERN)
        parts.append(WRONG_RIGHT_PATTERN)
        parts.append(DIAGRAM_TEMPLATES)

    # 7. DO NOT rules
    parts.append(DO_NOT_RULES)

    # 8. Layout rules
    parts.append(
        "**LAYOUT RULES**:\n"
        "- For text/diagram shots: WRAP content in `<div class='full-screen-center'>...</div>`\n"
        "- Use `.layout-split` for: Text on left, Visual on right\n"
        "- Use `.layout-hero` for: Single big concept in center\n"
        "- Use `.image-hero` for: Full-screen cinematic image with text overlay\n"
        "- Use `.image-split-layout` for: Image on one side, text on the other\n"
        "- Keep backgrounds clean — solid color from palette (except IMAGE_HERO which uses image)\n\n"
    )

    # 9. Portrait mode rules
    if is_portrait:
        parts.append(
            "**PORTRAIT MODE (9:16) LAYOUT RULES**:\n"
            "- Stack ALL content vertically — never side-by-side.\n"
            "- Use `grid-template-columns: 1fr` (single column) instead of `1fr 1fr`.\n"
            "- Image-split layouts: stack TOP/BOTTOM with `grid-template-rows: 1fr 1fr`.\n"
            "- Use larger font sizes — viewers are on mobile.\n\n"
        )

    # 10. Output JSON format
    parts.append(
        "Output JSON with 2-4 'shots' per segment. Each shot: one concept, clean visual, annotations for key terms.\n\n"
    )

    return "\n".join(parts)


def build_per_shot_system_prompt(
    shot_type: str,
    width: int = 1920,
    height: int = 1080,
    *,
    aspirational: bool = False,
    cultural_context: Any = None,
    mode: str = "educational",
    composition: str = "",
) -> str:
    """Build a system prompt with only ONE shot type card.

    Used by Phase 2+3 (Director → per-shot HTML generation).
    Even smaller than build_filtered_system_prompt — includes only the single
    card needed plus shared tools and principles.

    When `aspirational=True` (wired on at ultra / super_ultra), swaps the
    defensive preamble + DO-NOT list for variants that drop the stylistic
    bans and the mandatory `.stage-drift` / 2-text-levels prescriptions while
    keeping the technical rails. Reduces cross-shot templating.

    `mode` is the resolved visual style ("educational" | "marketing" | "bold").
    marketing/bold COMPILES a coherent brand-film prompt: motion-designer
    persona, brand-film principles, technical-only DO-NOTs, and premium
    exemplars swapped into the shot card — instead of the old approach of
    stacking a prose override on top of the whiteboard doctrine (which the
    whiteboard example code always beat). See MARKETING_PREAMBLE above.

    `composition` (optional) — the frame composition assigned to THIS shot by
    the ShotPlanner / `composition_kit.assign_compositions`. When supplied, a
    COMPOSITION CONTRACT block is injected carrying the concrete skeleton for
    that frame. This exists because the card exemplars are all centre-stacked
    and the model copies the example over the prose: the contract has to speak
    in code to outrank them. See composition_kit for the full rationale.

    `cultural_context` (optional `CulturalContext` instance) — when present
    AND has a region, the prompt gets a `<CULTURAL_CONTEXT>` block teaching
    the LLM to write region-aware image prompts. The 4-tier routing rule is
    always included for image-bearing shot types regardless of region.
    """
    aspect_label = "9:16 portrait" if width < height else "16:9"
    is_marketing = mode in ("marketing", "bold")

    card = SHOT_TYPE_CARDS.get(shot_type)
    if not card:
        # Fallback to TEXT_DIAGRAM if unknown type
        card = SHOT_TYPE_CARDS["TEXT_DIAGRAM"]

    if is_marketing:
        # Marketing/bold: one coherent design language regardless of tier.
        preamble = MARKETING_PREAMBLE
        do_not = DO_NOT_RULES_TECHNICAL
        principles = MARKETING_PRINCIPLES
    else:
        preamble = (CORE_PREAMBLE_ASPIRATIONAL + STAGING_KIT) if aspirational else CORE_PREAMBLE
        do_not = DO_NOT_RULES_TECHNICAL if aspirational else DO_NOT_RULES
        principles = EDUCATIONAL_PRINCIPLES_ASPIRATIONAL if aspirational else EDUCATIONAL_PRINCIPLES

    card_text = (
        # The composition exemplar only applies to aspirational (ultra) runs.
        # Marketing has its own compiled design language and takes precedence;
        # standard/premium keep the conservative card example.
        _format_card(
            card,
            marketing=is_marketing,
            composition=composition if (composition and aspirational) else "",
        )
        .replace("{canvas_width}", str(width))
        .replace("{canvas_height}", str(height))
        .replace("{aspect_label}", aspect_label)
    )
    if is_marketing:
        # Cards without a marketing exemplar keep their educational example —
        # strip its whiteboard-look prescriptions the same way aspirational does.
        card_text = _relax_card_for_aspirational(card_text)
    elif aspirational:
        card_text = _relax_card_for_aspirational(card_text)

    parts = [preamble, card_text]

    if card.get("requires_image") or card.get("requires_video"):
        parts.append(
            IMAGE_PROMPT_GUIDELINES.replace("{aspect_label}", aspect_label)
        )
        # 4-tier source-routing rule teaches the LLM to pick `data-img-source`
        # correctly upfront so the runtime cascade fires less often. Included
        # only for image-bearing shot types — pure-text shots don't need it.
        parts.append(IMAGE_ROUTING_RULE)

    parts.append(ANIMATION_TOOLS)
    parts.append(principles)
    parts.append(do_not)

    # TEXT BOUND BOX — per-line character caps. LLMs respect lookup tables more
    # reliably than they respect CSS-clamp arithmetic; spelling out the cap per
    # tier kills the "headline runs off canvas" failure mode (e.g. shot 2 of
    # vid_1778774930857_w8cwa1y where "THE ULTIMATE ECOSYSTEM." clipped at
    # left edge because h1 resolved to ~1500px on a 1280px canvas).
    parts.append(_build_text_bound_box_block(width, height))

    # CULTURAL CONTEXT — placed near the END (high-recency position) so the
    # LLM remembers to weave region descriptors into image prompts. Empty
    # when region is "none" (no-op for culture-agnostic videos).
    cultural_block = build_cultural_context_block(cultural_context)
    if cultural_block:
        parts.append(cultural_block)

    # COMPOSITION CONTRACT — late in the prompt, deliberately: it must be read
    # AFTER the shot card's (centre-stacked) exemplar, and recency matters.
    #
    # Skipped for marketing/bold: that mode is a COMPILED design language whose
    # whole point is that the prompt makes one coherent argument (see
    # MARKETING_PREAMBLE). Layering a contract that says "do not reproduce the
    # card's example layout" on top of exemplars chosen to demonstrate the
    # premium look is exactly the stacked-override pattern that mode was built
    # to replace.
    if composition and not is_marketing:
        from composition_kit import contract_block as _composition_contract

        parts.append(_composition_contract(composition, shot_type))

    # OUTPUT FORMAT — strict JSON envelope. Three JSON parse failures on shots
    # 2/3/4 of the same run were caused by the per-shot prompt never asserting
    # the envelope at all (Director prompt does; per-shot didn't).
    parts.append(OUTPUT_FORMAT_BLOCK)

    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Canvas-aware text rules — 4-bucket lookup keyed on (orientation, resolution)
# ─────────────────────────────────────────────────────────────────────────────
#
# Audit (post-Met-Gala, 2026-05) found the previous binary portrait/landscape
# rule produced:
#   • portrait 720 H1 13-char × 88px overflows safe area by 81px
#   • landscape 720 H1 22-char × 128px overflows by 653px (catastrophic)
#   • portrait 1080 inherits 720-tuned caps → text looks under-sized for HD
# Switching to a 4-bucket lookup keyed on actual canvas dimensions fixes
# every overflow case AND scales the visual proportions up on HD canvases.
#
# Values were derived from the constraint:
#       chars × font-px × avg-glyph-em ≤ safe-area-width
# where safe-area = 92% of canvas width (4% inset both sides) and
# avg-glyph-em is per-font (Bebas Neue 0.50, Montserrat Black 0.65,
# Inter Bold 0.60, Inter Regular 0.50). All buckets verified to leave
# ≥5% safe-area slack for descenders + sub-pixel rounding.

# Each value is `(char_cap, font_px_ceiling, clamp_str)`. The clamp string
# is what the LLM should use verbatim in CSS; the px ceiling is what the
# bbox lint enforces.
_CANVAS_TIER_RULES: Dict[str, Dict[str, Tuple[int, int, str]]] = {
    # Portrait 720×1280 (most reels — Met Gala canvas)
    "portrait_720": {
        "display": (8,  100, "clamp(2rem, min(14vw, 8vh), 6.25rem)"),
        "h1":      (10,  76, "clamp(1.6rem, min(10.5vw, 6vh), 4.75rem)"),
        "h2":      (18,  50, "clamp(1.2rem, min(7vw, 4vh), 3.1rem)"),
        "body":    (40,  24, "clamp(0.95rem, min(3.4vw, 1.9vh), 1.5rem)"),
        "label":   (30,  14, "clamp(0.75rem, 1.9vmin, 0.9rem)"),
    },
    # Portrait 1080×1920 (HD portrait)
    "portrait_1080": {
        "display": (11, 144, "clamp(2.5rem, min(13vw, 7.5vh), 9rem)"),
        "h1":      (12, 112, "clamp(2rem, min(10vw, 5.8vh), 7rem)"),
        "h2":      (22,  68, "clamp(1.4rem, min(6.3vw, 3.5vh), 4.25rem)"),
        "body":    (52,  32, "clamp(1.05rem, min(3vw, 1.7vh), 2rem)"),
        "label":   (38,  18, "clamp(0.85rem, 1.7vmin, 1.1rem)"),
    },
    # Landscape 1280×720 (720p landscape — supported but previously broken)
    "landscape_720": {
        "display": (11, 132, "clamp(2.5rem, min(10.3vw, 18.3vh), 8.25rem)"),
        "h1":      (16,  96, "clamp(2rem, min(7.5vw, 13.3vh), 6rem)"),
        "h2":      (26,  60, "clamp(1.4rem, min(4.7vw, 8.3vh), 3.75rem)"),
        "body":    (52,  28, "clamp(1rem, min(2.2vw, 3.9vh), 1.75rem)"),
        "label":   (38,  16, "clamp(0.8rem, 1.5vmin, 1rem)"),
    },
    # Landscape 1920×1080 (HD landscape — original design target)
    "landscape_1080": {
        "display": (14, 168, "clamp(2.75rem, min(8.75vw, 15.5vh), 10.5rem)"),
        "h1":      (20, 116, "clamp(2rem, min(6vw, 10.7vh), 7.25rem)"),
        "h2":      (32,  76, "clamp(1.5rem, min(4vw, 7vh), 4.75rem)"),
        "body":    (62,  32, "clamp(1rem, min(1.7vw, 3vh), 2rem)"),
        "label":   (50,  20, "clamp(0.9rem, 1.2vmin, 1.25rem)"),
    },
}


def _canvas_bucket(width: int, height: int) -> str:
    """Pick the 4-bucket key for the given canvas. The breakpoint at the
    long-side dimension 720 vs 1080 is what distinguishes 720p from HD:
      portrait_720   : 720×1280   (long side 1280)
      portrait_1080  : 1080×1920  (long side 1920)
      landscape_720  : 1280×720   (long side 1280)
      landscape_1080 : 1920×1080  (long side 1920)
    Off-spec canvases (e.g. 1440 portrait) bucket to the nearest standard
    by long-side comparison — values still leave margin so we degrade gracefully.
    """
    is_portrait = width < height
    long_side = max(width, height)
    is_hd = long_side >= 1700  # halfway between 1280 and 1920
    if is_portrait:
        return "portrait_1080" if is_hd else "portrait_720"
    return "landscape_1080" if is_hd else "landscape_720"


def _build_text_bound_box_block(width: int, height: int) -> str:
    """Per-line character caps the LLM must respect for the current canvas.

    Lookup table > formula: LLMs handle "max 14 chars/line at display tier"
    more reliably than "0.55 × font-px × chars < 92% × canvas_w". Values are
    derived from the constraint `chars × font-px × glyph-em ≤ safe-area-width`
    for each canvas bucket — see `_CANVAS_TIER_RULES` above.
    """
    bucket = _canvas_bucket(width, height)
    rules = _CANVAS_TIER_RULES[bucket]
    bucket_label = bucket.replace("_", " ").title()
    table_lines = [
        f"   {bucket_label} {width}×{height}",
        "   ─────────────────────────",
        f"   display tier   →  {rules['display'][0]:>3d} chars/line max",
        f"   h1 tier        →  {rules['h1'][0]:>3d} chars/line max",
        f"   h2 tier        →  {rules['h2'][0]:>3d} chars/line max",
        f"   body tier      →  {rules['body'][0]:>3d} chars/line max",
    ]
    table = "\n".join(table_lines) + "\n"
    return (
        "**TEXT BOUND BOX (per-line character caps — non-negotiable)**:\n"
        f"Canvas is {width}×{height}. For text inside the safe area (4% inset both axes),\n"
        "use these MAX characters per LINE at each font tier:\n\n"
        f"{table}\n"
        "If your copy exceeds the cap at the chosen tier:\n"
        "  1. Break into multiple lines (each line still under the cap), OR\n"
        "  2. Demote one tier (display → h1 → h2), OR\n"
        "  3. Shorten the copy to the essential 2–4 words.\n"
        "Glyph clipping at the canvas edge is a SHIPPING-BLOCKING error — the\n"
        "post-render bbox lint will flag it and force a regen.\n\n"
        + _build_font_size_ceiling_block(width, height)
        + _build_text_hierarchy_block(width, height)
        + _build_back_half_motion_block()
    )


def _build_font_size_ceiling_block(width: int, height: int) -> str:
    """Pillar 2.5 (canvas-aware) — explicit `font-size` CSS-value ceilings keyed
    to the 4-bucket lookup. Both the clamp string AND the px ceiling come from
    `_CANVAS_TIER_RULES`. Met-Gala audit (vid_1778837267767_ibwlsbk) shipped
    `font-size: clamp(5rem, min(34vw, 25vh), …)` on a 2-char word — chars/line
    was fine but rendered glyphs were 245px tall on a 1280px canvas. The
    canvas-tuned clamp here can't produce that result on any supported size.
    """
    bucket = _canvas_bucket(width, height)
    rules = _CANVAS_TIER_RULES[bucket]
    orientation = "portrait" if width < height else "landscape"
    lines = [
        "**FONT-SIZE CEILING (non-negotiable, prompts the bbox lint)**:",
        f"Canvas is {width}×{height} {orientation}. Use these MAX CSS `font-size`",
        "values — NEVER exceed the upper clamp on the right:",
    ]
    for tier_label, key in (
        ("Display / hero text",      "display"),
        ("H1 / kinetic title",       "h1"),
        ("H2 / sub-headline",        "h2"),
        ("Body / narration",         "body"),
        ("Tracking labels",          "label"),
    ):
        _ch, px, clamp = rules[key]
        lines.append(f"  • {tier_label:24s} `{clamp}`  (≤ {px} px)")
    lines.extend([
        "",
        "The HARD ceiling on the right of each clamp is what the post-render",
        "bbox lint enforces. Picking the clamp values verbatim from this table",
        "guarantees the first-pass renders inside the safe area on the current",
        f"canvas ({orientation} {width}×{height}). Larger glyphs clip and look amateur.",
        "",
    ])
    return "\n".join(lines) + "\n"


def _build_text_hierarchy_block(width: int, height: int) -> str:
    """Phase 2 — visual-quality rules that govern not just whether text FITS,
    but whether it LOOKS GOOD. Met-Gala audit found multiple shots where text
    technically fit the canvas but read as amateur (busy backgrounds without
    scrim, line-height too loose for display, clipped descenders, no font-
    weight hierarchy). Covers:
      • line-height per tier
      • letter-spacing per font/tier
      • font-weight contrast scale
      • text-on-media scrim / shadow
      • descender clearance
      • multi-line leading override
      • final 'looks good' checklist the LLM self-evaluates against
    """
    orientation = "portrait" if width < height else "landscape"
    return (
        "**TEXT HIERARCHY (look-good rules — not just fit)**:\n"
        f"Canvas {width}×{height} {orientation}. Text that FITS but breaks one\n"
        "of these rules still reads as amateur. The LLM must address each:\n\n"

        "• **line-height** (CRITICAL — default 1.2 is wrong for display text):\n"
        "    Display / hero    → `line-height: 0.95;`  (hero text needs tight stack)\n"
        "    H1 / kinetic       → `line-height: 1.0;`\n"
        "    H2 / sub-headline → `line-height: 1.1;`\n"
        "    Body / narration  → `line-height: 1.4;`   (readable prose leading)\n"
        "    Tracking label    → `line-height: 1.2;`\n\n"

        "• **letter-spacing** (font-aware — wrong tracking ages the design):\n"
        "    Bebas Neue        → `letter-spacing: 0.02em;`  (condensed wants slight tracking)\n"
        "    Montserrat Black  → `letter-spacing: -0.01em;` (heavy weight wants tight)\n"
        "    Inter (any)       → `letter-spacing: 0;`        (designed neutral)\n"
        "    UPPERCASE labels  → `letter-spacing: 0.16em;`   (caps always need open tracking)\n\n"

        "• **font-weight contrast** (visible hierarchy needs ≥300-weight delta):\n"
        "    Display / hero    → `font-weight: 900;` (or 800 for serif/script faces)\n"
        "    H1 / kinetic       → `font-weight: 800;`\n"
        "    H2 / sub-headline → `font-weight: 700;` (or 600)\n"
        "    Body / narration  → `font-weight: 400;` or `500;`\n"
        "    Tracking label    → `font-weight: 700;` (uppercase + bold = anchor weight)\n\n"

        "• **text-on-media contrast** (when text sits over photo / video):\n"
        "  Add ONE of these — never ship bare text on a busy image:\n"
        "  (1) **Linear-gradient scrim**: place a `<div>` between media and text:\n"
        "      `background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 60%);`\n"
        "      Anchor the dark stop to the side text sits on (top/bottom/left/right).\n"
        "  (2) **Text shadow** for short callouts only:\n"
        "      `text-shadow: 0 2px 12px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.4);`\n"
        "  (3) **Solid 12-16% panel** behind the text block with backdrop-filter blur(8px).\n"
        "  Bare white-on-photo without ANY of the above is a SHIPPING DEFECT (Met-Gala\n"
        "  audit: 10 of 11 reviewed shots flagged for irrelevant-media-as-background and\n"
        "  text-bleed-over-photo).\n\n"

        "• **descender clearance** (j / g / p / q / y clip on tight containers):\n"
        "  Any element with `overflow:hidden` containing text needs\n"
        "  `padding-bottom: 0.15em;` to clear descenders. Skip ONLY for ALL-CAPS\n"
        "  text where descenders are impossible (label tier with `text-transform:uppercase`).\n\n"

        "• **multi-line leading override** (when text wraps to 2-3 lines):\n"
        "  Tight the leading by 0.1: display lines stack at 0.85, h1 at 0.9, h2 at 1.0.\n"
        "  3+ lines of display text is almost always a design failure — demote the tier.\n\n"

        "• **looks-good self-check** (answer YES to each before emitting):\n"
        "    1. Is the longest line of each tier under its char cap above?\n"
        "    2. Does the displayed font-size match the tier's clamp ceiling?\n"
        "    3. Is the weight contrast ≥300 between hero text and body text?\n"
        "    4. If text is over media: is there a scrim, shadow, or backdrop panel?\n"
        "    5. Does the tightest container have `padding-bottom: 0.15em` for descenders?\n"
        "    6. Is line-height set explicitly (not inherited from default 1.2)?\n\n"
    )


def _build_back_half_motion_block() -> str:
    """Pillar 2.6 — hoisted back-half-motion requirement to the top-of-prompt
    bound-box rules so the LLM treats it as a SHIPPING-BLOCKING constraint, not
    a buried best-practice. The animation validator already enforces this, but
    too many shots in v2026-05 audit shipped failing this check (6 of 15 in the
    Met Gala run). Restating here at higher prominence + a concrete copy-paste
    idiom is cheaper than another regen pass.
    """
    return (
        "**BACK-HALF MOTION (non-negotiable, validator rejects failing shots)**:\n"
        "Every shot ≥3 s MUST include at least one GSAP tween whose `delay`\n"
        "value is `>= 0.55 × shot_duration`. Front-loading every animation\n"
        "into the first 0.6 s — then leaving the canvas frozen for 2+ s —\n"
        "makes the shot read as a still frame. This is what the validator\n"
        "flags and what currently triggers 30-40% of the corrective regens.\n\n"
        "Pick ONE of these copy-paste idioms (use word_timings emphasis words\n"
        "to anchor the delay when available):\n"
        "  • `gsap.to('#accent', {scaleX:1, duration:0.45, delay: <0.6 × dur>, ease:'expo.out'});`\n"
        "  • `gsap.to('#caption', {opacity:0, duration:0.3, delay: <0.65 × dur>});`\n"
        "    paired with `gsap.to('#caption-b', {opacity:1, duration:0.4, delay: <0.7 × dur>});`\n"
        "  • `gsap.fromTo('#bg-mark', {scale:0.6, opacity:0}, {scale:1, opacity:1, duration:1.4, delay: <0.55 × dur>});`\n"
        "  • A counter rolling from N₁→N₂ that completes in the back half.\n"
        "Front-load NOTHING that ends before the 50% mark unless ANOTHER\n"
        "element fires in the back half to carry the eye.\n\n"
    )


OUTPUT_FORMAT_BLOCK = (
    "**OUTPUT FORMAT (non-negotiable)**:\n"
    "- Respond with EXACTLY one raw JSON object.\n"
    "- First character must be `{`. Last character must be `}`.\n"
    "- No markdown fences, no code fences, no preamble or postamble.\n"
    "- Inside JSON string values, escape `//` as `\\/\\/` if needed; never emit\n"
    "  raw `//` comments — they will be interpreted as comment delimiters and\n"
    "  break the parser.\n"
)


# Pillar 2.4 — instruction to skip the per-shot boilerplate the LLM
# currently re-emits on every shot (SVG <defs>, Google Fonts @import, brand
# palette CSS vars, text-safety rules). The renderer pre-injects all four
# into every rendered frame, so the LLM emitting them is pure waste — the
# Met-Gala audit measured ~22 KB of identical preamble per shot × 15 shots
# = ~330 KB of LLM completion tokens spent on duplicates.
# The rule is gated behind a tier knob `shot_html_shared_preamble_enabled`
# so it can be A/B tested before defaulting on. When off, this block is
# omitted from the prompt and the LLM keeps generating boilerplate as before.
SHARED_PREAMBLE_RULE = (
    "**SHARED PREAMBLE (DO NOT RE-EMIT — saves ~30% of your output tokens)**:\n"
    "Your shot HTML will be wrapped by the renderer with a SHARED preamble that\n"
    "ALREADY contains:\n"
    "  • `<svg><defs>` with the `roughen` / `roughen-strong` SVG filters.\n"
    "  • `@import url('…fonts.googleapis.com…')` for Montserrat, Inter, Bebas\n"
    "    Neue, Poppins, Fira Code.\n"
    "  • The `:root { --brand-primary, --brand-accent, --brand-text, --brand-bg,\n"
    "    --brand-svg-stroke, --brand-svg-fill, --brand-annotation }` CSS vars\n"
    "    derived from the institute's style_guide.\n"
    "  • Universal text-safety rules: `* { overflow-wrap:break-word; word-break:\n"
    "    break-word; box-sizing:border-box; }` plus the `[class*=\"-char\"]` and\n"
    "    `[class*=\"-letter\"]` keep-all overrides.\n\n"
    "**DO NOT** emit any of the above in your output. Start your HTML at the\n"
    "`<div id=\"shot-root\">` element and reference the brand variables (e.g.\n"
    "`color: var(--brand-text)`) and SVG filters (e.g. `filter:url(#roughen)`)\n"
    "directly. The post-LLM stripper will scrub redundant `<svg><defs>`, font\n"
    "`@import` and `:root { --brand-*… }` blocks if you emit them — it just\n"
    "costs you tokens for the same final output.\n\n"
)


def maybe_append_shared_preamble_rule(prompt: str, enabled: bool) -> str:
    """Helper for callers (`build_per_shot_system_prompt` consumers) that
    want the dedup rule appended only when the tier knob is on. Keeps the
    rule out of the prompt entirely on tiers that aren't ready for it
    so we don't pay token cost for an instruction the renderer ignores."""
    if not enabled:
        return prompt
    return prompt + "\n\n" + SHARED_PREAMBLE_RULE


# Pillar 2.4 — list of regex patterns the post-LLM stripper drops from the
# per-shot HTML when `shot_html_shared_preamble_enabled` is True. Each
# pattern is line-anchored to avoid catching legitimate content (e.g. an
# `<svg>` chart inside the shot body shouldn't match the `<svg><defs>`
# pattern because it has different attributes). Patterns are written
# defensively — when in doubt, the stripper leaves content alone.
SHARED_PREAMBLE_STRIP_PATTERNS = [
    # SVG <defs> wrapper with the `roughen` filter (Met-Gala exact pattern)
    r'<svg\s+width="0"\s+height="0"[^>]*>\s*<defs>.*?</defs>\s*</svg>',
    # Google Fonts @import (legitimate per-shot fonts are rare)
    r'@import\s+url\([\'"]https?://fonts\.googleapis\.com/css2\?[^\)]*\)\s*;',
    # :root brand palette block (catches any combination of --brand-* vars)
    r':root\s*\{\s*(?:--brand-[a-z-]+:\s*[^;]+;\s*|--primary-color:\s*[^;]+;\s*|--accent-color:\s*[^;]+;\s*|--text-color:\s*[^;]+;\s*|/\*[^*]*\*/\s*)+\}',
    # Universal text-safety reset
    r'\*\s*\{\s*overflow-wrap:\s*break-word\s*;\s*word-break:\s*break-word\s*;\s*box-sizing:\s*border-box\s*;\s*\}',
]


def strip_shared_preamble(html: str) -> str:
    """Pillar 2.4 — strip the redundant boilerplate the LLM tends to re-emit
    even after being told not to. Idempotent: running on already-clean HTML
    is a no-op. Returns the cleaned string. Caller decides when to invoke
    (gated by tier knob `shot_html_shared_preamble_enabled` to allow A/B
    runs against the un-stripped output)."""
    import re as _re
    out = html or ""
    for pat in SHARED_PREAMBLE_STRIP_PATTERNS:
        out = _re.sub(pat, "", out, flags=_re.IGNORECASE | _re.DOTALL)
    # Squash leading whitespace runs left behind by removed `<style>` blocks
    out = _re.sub(r"<style>\s*</style>", "", out)
    out = _re.sub(r"\n\s*\n\s*\n+", "\n\n", out)
    return out.lstrip()


def build_ai_video_inline_teaching_block(
    *,
    enabled: bool,
    audio_enabled: bool = False,
    cost_cap_usd: float = 1.50,
) -> str:
    """Per-shot HTML LLM teaching block for the inline `<aivideo>` tag (Phase 6).

    Returns "" when `enabled=False` so the prompt stays clean for runs
    without AI video. When enabled, this block tells the per-shot LLM that
    it MAY drop `<aivideo>` tags into composite shot HTML when stock /
    generated stills can't capture the motion the shot wants.

    Stays in sync with `ai_video_composer.py`'s tag syntax — any changes
    to attribute names / allowed values must be reflected in both places.
    """
    if not enabled:
        return ""

    lines = [
        "",
        "## INLINE `<aivideo>` (fal.ai Veo, ENABLED FOR THIS RUN)",
        "",
        "You MAY embed AI-generated video clips INSIDE a composite shot's HTML "
        "using the `<aivideo>` tag. Use SPARINGLY — each tag costs $0.12–$0.24 "
        f"(720p, 4–8s). The run has a hard ${cost_cap_usd:.2f} cap; once exceeded, "
        "additional `<aivideo>` tags resolve to a placeholder.",
        "",
        "**Tag syntax (self-closing OR with explicit close):**",
        "  <aivideo",
        '    data-prompt="a coral reef teeming with fish, slow current"',
        '    data-duration="6"',
        '    data-audio="false"',
        '    data-aspect="16:9"',
        "  ></aivideo>",
        "",
        "**Attributes:**",
        "  data-prompt (REQUIRED) — visual description, third-person present "
        "tense; describe action, subject, framing, lighting; avoid in-frame text",
        "  data-duration (4 | 6 | 8) — defaults to 8 if omitted; other values "
        "snap to the nearest allowed",
        "  data-aspect (16:9 | 9:16) — defaults to the shot's canvas orientation",
        "  data-audio (true | false) — defaults to false; only takes effect "
        "when run-level audio is on AND the host shot's audio_policy is "
        "intrinsic_only (most shots can't enable inline audio)",
        "",
        "**Best fits for inline `<aivideo>`:**",
        "- Side-by-side comparisons where each panel needs its own moving footage",
        "- Picture-in-picture overlays (small Veo clip inside a larger composite)",
        "- A motion-graphic shot with one cinematic accent",
        "",
        "**Do NOT use `<aivideo>`:**",
        "- For full-canvas video shots — the Director should set shot_type=AI_VIDEO_HERO instead",
        "- More than 2 per shot — composite shots with 3+ Veo clips read as chaotic and burn budget",
        "- For routine visuals stock photos / CSS gradients could carry",
        "",
        "The tag resolves to a `<video autoplay muted loop>` element styled to "
        "fill its parent. Position with normal CSS — the composer fills the "
        "tag's bounding box with `object-fit: cover`.",
    ]
    if audio_enabled:
        lines.extend([
            "",
            "**Audio mode is ON for this run.** Inline `data-audio=\"true\"` only "
            "takes effect when the host shot's `audio_policy` is "
            "`intrinsic_only` — i.e. the Director already silenced narration "
            "for the shot. Otherwise the tag's audio is muted regardless of "
            "what you set.",
        ])
    lines.append("")
    return "\n".join(lines)
