"""ShotPlanner — first LLM stage of the v3 AI video pipeline.

Replaces the v2 split of BeatPlanner → ScriptGenerator → Director with a single
upfront planning call that sees the full request (prompt, configs, uploads,
tier) and emits a complete shot plan. The next stage (NarrationWriter) fills
in per-shot narration text against this plan; per-shot TTS consumes it; the
per-shot HTML LLM implements each shot.

Contract:
- Inputs: prompt, target_duration_s, visual_preferences, tier_config,
  reference_assets, brand_brief, ai_video flags, language, audience.
- Output: a dict with `shots[]` (each carrying narration_brief, audio_policy,
  background_treatment, shot_type, duration_estimate_s, transition_in, plus
  shot-type-specific fields like image_prompt / video_query / ai_video_prompt)
  and plan-level `recurring_motifs[]` + `continuity_notes`.
- No word timings exist at this stage. `start_time` / `end_time` are derived
  from `duration_estimate_s` cumulatively and get reconciled to actual MP3
  durations after per-shot TTS via `_reconcile_shot_timings_after_tts`.

The module is self-contained and free of network dependencies — the LLM call
is injected as a `llm_chat` callable matching `OpenRouterClient.chat(...)`.
This matches the pattern used by `beat_planner.plan_beats`.

See: docs/ai_content/AI_VIDEO_ARCHITECTURE_CHANGES.md "Pipeline Reorder v3"
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from composition_kit import (
    assign_compositions,
    normalize as normalize_composition,
    planner_menu_block,
)


# ─────────────────────────────────────────────────────────────────────────────
# Enums and constants
# ─────────────────────────────────────────────────────────────────────────────

# Default pacing — matches BeatPlanner + Director conventions.
DEFAULT_WPM: float = 150.0

# Intent role enum — ported from BeatPlanner. ShotPlanner emits this per shot
# so downstream code can reason about narrative function without re-parsing.
INTENT_ROLES: Tuple[str, ...] = (
    "hook",
    "setup",
    "explanation",
    "example",
    "moment",
    "recap",
    "cta",
)

# Background-treatment enum — ported from Director. Cross-shot continuity
# contract: at most 2 distinct non-media-hero treatments per video.
BACKGROUND_TREATMENTS: Tuple[str, ...] = (
    "brand_solid",
    "brand_textured",
    "brand_gradient",
    "media_hero",
)

# Transition allow-list — must stay in sync with `transition_picker.py`
# `_KNOWN_TRANSITIONS` and the `TRANSITION_CSS_BLOCKS` in `prompts.py`.
TRANSITIONS: Tuple[str, ...] = (
    "cut",
    "fade",
    "slide_right",
    "slide_left",
    "slide_up",
    "zoom_in",
    "zoom_out",
    "wipe_right",
    "circle_iris",
    "diagonal_wipe",
    "hexagon_iris",
    "blinds_horizontal",
    "smash_cut",
    "dip_to_black",
)

# Audio-policy enum — mirrors `audio_policy_planner.AUDIO_POLICIES`. The
# stub assigns only the first two; later phases may add ducking variants.
AUDIO_POLICIES: Tuple[str, ...] = (
    "narration_only",
    "intrinsic_only",
    # Drama redesign: the shot is an AI-generated CHARACTER clip (the cast
    # member acting, NOT speaking) with the master narrator's VO playing OVER
    # it. Distinct from intrinsic_only (which silences the narrator) — here the
    # clip's own audio is muted and narration_brief is KEPT so the narrator
    # carries the beat. Lets a whole drama be filmed with the characters while
    # the narrator connects the scenes.
    "narration_over_clip",
)

# Shot types whose audio comes from their own video track. Mirrors
# `audio_policy_planner._INTRINSIC_AUDIO_CAPABLE_SHOT_TYPES`.
INTRINSIC_AUDIO_CAPABLE_SHOT_TYPES: Tuple[str, ...] = (
    "AI_VIDEO_HERO",
    "SOURCE_CLIP",
)

# Default `background_treatment` per shot type, applied when ShotPlanner
# omits the field. Mirrors `automation_pipeline._SHOT_TYPE_BG_TREATMENT_DEFAULT`
# to keep cross-shot continuity defaults consistent.
SHOT_TYPE_BG_TREATMENT_DEFAULT: Dict[str, str] = {
    "VIDEO_HERO": "media_hero",
    "IMAGE_HERO": "media_hero",
    "IMAGE_SPLIT": "media_hero",
    "ARTICLE_FOCUS": "media_hero",
    "SOURCE_CLIP": "media_hero",
    "IMAGE_CLIP": "media_hero",
    "AI_VIDEO_HERO": "media_hero",
    "ANNOTATION_MAP": "brand_textured",
    "DATA_STORY": "brand_textured",
    "PROCESS_STEPS": "brand_textured",
    "INFOGRAPHIC_SVG": "brand_textured",
    "TEXT_DIAGRAM": "brand_textured",
    "PRODUCT_HERO": "brand_gradient",
    "DEVICE_MOCKUP": "brand_solid",
    "KINETIC_TITLE": "brand_solid",
    "KINETIC_TEXT": "brand_solid",
    "LOWER_THIRD": "brand_solid",
    "EQUATION_BUILD": "brand_solid",
    "ANIMATED_ASSET": "brand_solid",
}


class ShotPlanError(Exception):
    """Unrecoverable failure during shot planning. The pipeline must fall
    back (today: legacy v2 BeatPlanner+Script+Director path; eventually:
    surface as a hard run failure once v3 is the only path)."""


# ─────────────────────────────────────────────────────────────────────────────
# System prompt
# ─────────────────────────────────────────────────────────────────────────────

SHOT_PLANNER_SYSTEM_PROMPT = (
    "You are the ShotPlanner — the FIRST creative stage of an AI video "
    "pipeline. You see the user's full request (prompt, configs, uploaded "
    "assets, tier, AI-video toggle) and produce a complete shot-by-shot plan. "
    "A separate stage (NarrationWriter) will then author the actual narration "
    "text per shot, and a per-shot HTML stage will implement each shot's "
    "visuals. Your job is to be the conductor — decide WHAT each shot shows, "
    "what it SHOULD say, and how shots flow together. You do NOT write the "
    "actual narration sentences; you write a brief telling the NarrationWriter "
    "what each shot's narration should convey.\n\n"

    "**FIRST — form the CREATIVE CONCEPT, then plan every shot to serve it.** Before any shots, decide:\n"
    "  • `controlling_idea` — the ONE surprising, true thing this video argues, in a single sentence "
    "(NOT a topic summary). Bad: 'a video about compound interest.' Good: 'Doing nothing is the most "
    "powerful financial move you'll ever make.'\n"
    "  • `tonal_register` — ad | explainer | tutorial | documentary | news | hype (sets the whole voice).\n"
    "  • `emotional_arc` — from → to (e.g. 'smug certainty → unease → humbled clarity').\n"
    "  • `visual_metaphor` — ONE concrete, animatable image that embodies the idea (e.g. 'a single coin "
    "that snowballs into an avalanche across the timeline'), or '' if none truly fits.\n"
    "  • `signature_device` — ONE recurring visual/motion gesture that should reappear across shots, or ''.\n"
    "  • `what_to_avoid` — the obvious/generic treatment to consciously reject (e.g. 'no generic "
    "students-on-laptops stock footage').\n"
    "Emit these as a top-level `creative_concept` object. Then EVERY shot must visibly execute it: the "
    "controlling idea and visual metaphor drive the plan, the signature device recurs (hook + a mid beat + "
    "close), and the emotional arc pays off. A plan whose shots don't serve the concept is failing.\n\n"

    "You decide:\n"
    "1. How many shots total (use the RHYTHM PROFILE below)\n"
    "2. Which SHOT TYPE each shot uses (from the catalog below)\n"
    "3. What each shot says — as a `narration_brief` (1-2 sentence intent)\n"
    "4. How long each shot is (`duration_estimate_s`) — NarrationWriter "
    "honors this; per-shot TTS rewrites it to the actual MP3 duration\n"
    "5. The visual content per shot (image/video prompts, layout intent)\n"
    "6. Cross-shot continuity (recurring_motifs, background_treatment)\n"
    "7. Audio policy per shot (whether master narration plays or the shot "
    "carries its own audio)\n\n"

    "**SHOT TYPE VOCABULARY** — these are building blocks to COMPOSE and SEQUENCE "
    "into a distinctive piece, not slots to fill. Combine and vary them; pick the "
    "type that best serves each beat's IDEA, not the nearest convenient label:\n"
    "- **IMAGE_HERO**: Full-screen image with Ken Burns zoom + text overlay. "
    "For hooks, real-world examples, dramatic moments. Needs `image_prompt`. "
    "**Do NOT pick IMAGE_HERO when narration depicts a digital interaction (phone, app, "
    "browser, chat, dashboard, code editor) — use DEVICE_MOCKUP instead.**\n"
    "- **DEVICE_MOCKUP**: Purpose-built HTML/CSS device interface (phone, browser tab, terminal, "
    "code editor, chat app, dashboard) constructed from primitives. Use whenever the narration "
    "depicts a digital interaction: receiving a message, opening an app, running a command, "
    "scrolling a feed, signing in, viewing a notification, sending a document. Strictly NO stock "
    "photo of the device — the whole point is that every interior element animates to narration. "
    "No `image_prompt` or `video_query` needed.\n"
    "- **VIDEO_HERO**: Full-screen stock video + text overlay. PREFERRED over IMAGE_HERO for real-world topics. "
    "Needs `video_query` (Pexels search terms).\n"
    "- **IMAGE_SPLIT**: Image on one side, text on the other. "
    "For explanations with visual reference. Needs `image_prompt`.\n"
    "- **TEXT_DIAGRAM**: Text + SVG/Mermaid diagram on clean background. "
    "The default for explanations, code, math, processes.\n"
    "- **LOWER_THIRD**: Key term banner at bottom of screen. "
    "Can overlay other shots (set `overlay: true`). For vocabulary, definitions.\n"
    "- **ANNOTATION_MAP**: Full-screen image with animated SVG arrows + labels. "
    "For anatomy, geography, labeled diagrams. Needs `image_prompt` with 'unlabeled, no text'.\n"
    "- **DATA_STORY**: Animated bar/line chart. "
    "Only when narration mentions specific numbers/statistics.\n"
    "- **PROCESS_STEPS**: Sequential numbered nodes with animated connectors. "
    "For algorithms, workflows, step-by-step processes (3-5 steps per shot).\n"
    "- **EQUATION_BUILD**: KaTeX equation terms revealing sequentially. "
    "For math formulas, physics laws, chemical equations.\n"
    "- **ANIMATED_ASSET**: Cutout images with transparent backgrounds + GSAP animation. "
    "For floating objects (molecules, planets, tools). Needs `image_prompt` with cutout instructions.\n"
    "- **KINETIC_TEXT**: Words appear exactly when spoken — pipeline-built, 100% accurate sync. "
    "Use for hooks, conclusions, key emphasis moments. No image/video needed.\n"
    "- **PRODUCT_HERO**: Single hero product/subject anchored center-stage. Background layers (solid color → halftone texture → geometric watermark → bold color) crossfade behind the subject via GSAP opacity. "
    "Badge (flat colored rect), tracking labels, and slam text orbit the subject. Use for product showcases, brand reels, origin stories. "
    "Needs `image_prompt` with cutout instructions.\n"
    "- **INFOGRAPHIC_SVG**: Pure SVG diagram/illustration that draws itself on screen via `stroke-dashoffset`. "
    "Courts, anatomy, process flows, maps, how-to mechanics. Uses its own cream+grid canvas — "
    "pick this for any beat that can be drawn rather than photographed. No photos — everything is drawn.\n"
    "- **KINETIC_TITLE**: Full-screen bold typography. Single phrase, word-wipe reveal (translateY 100%→0%), "
    "one accent-color word. Hooks, section headers ('1. THE PASS'), outros. "
    "Works as a hard cut between style worlds (e.g. from a photo-hero act into an illustrated infographic act).\n"
    "- **SOURCE_CLIP** *(only when source video is provided)*: Play a clip from the user's uploaded "
    "source video. The original footage (speaker, screen recording, demo) plays as the background "
    "with HTML overlays on top. Use for key quotes, soundbites, demo highlights — any moment where "
    "showing the real footage is more impactful than AI graphics. Specify `source_start` and "
    "`source_end` (seconds in the source video). No `image_prompt` or `video_query` needed.\n"
    "- **IMAGE_CLIP** *(only when source images are provided)*: Show one of the user's uploaded "
    "images full-frame with HTML annotations on top — callouts, highlight boxes, arrows, a label. "
    "This is the shot type for a screenshot, a scanned plate, a chart, a photograph the user "
    "supplied. Set `image_index` to choose WHICH upload. Never substitute a generated illustration "
    "for an uploaded image. No `image_prompt` or `video_query` needed.\n"
    "- **ARTICLE_FOCUS** *(only when scrape_url captured screenshots)*: Show the actual scraped "
    "article page with a slow zoom-pan toward a highlighted quote. Tells the viewer 'this is real, "
    "here is the source.' MUST set `template_id: \"article_focus_zoom_pan\"` and `template_params` "
    "with `screenshot_id` (one of the AVAILABLE ARTICLE SCREENSHOTS), `quote_text` (verbatim "
    "sentence, ≤120 chars), `highlight_box_pct` (rect to zoom toward, 0–100 scale), and optional "
    "`source_label` (e.g. 'BBC News'). Best at 3–5s shot duration.\n"
    "- **DIALOGUE_SCENE** *(only when dialogue scenes are enabled)*: A cinematic AI-generated clip "
    "of the CAST CHARACTERS on screen (storybook/drama beats), filmed against their locked "
    "reference faces. It comes in TWO flavors:\n"
    "    (a) SPEAKING — the characters talk. Set `dialogue` = ordered list of `{character, line}` "
    "(1-2 short lines, total spoken time ≤ 8s — the clip models hard-cap around 10s, so a "
    "longer exchange MUST be split across consecutive scene_continuity=\"continuous\" scenes or "
    "the last line is cut off); `audio_policy: \"intrinsic_only\"` (the clip carries its own "
    "lip-synced audio, master narrator silent); `narration_brief: \"\"`.\n"
    "    (b) SILENT ACTION — a character acts but does NOT speak (e.g. slumped over papers, "
    "reacting, a wordless emotional beat). Set `dialogue: []` (empty); `action_description` = "
    "one vivid sentence of what the character is DOING (no speech); `character_names` = who "
    "appears. Audio: default `audio_policy: \"intrinsic_only\"` (the clip carries its own "
    "ambient — NO narrator; this is how a PURE drama shows its characters between spoken "
    "scenes). ONLY if a narrator should speak over the shot, use `audio_policy: "
    "\"narration_over_clip\"` + a real `narration_brief`. Either way this films the actual "
    "character — NEVER cut to stock footage of a stranger.\n"
    "  BOTH flavors MUST set: `scene_description` = one vivid sentence staging the scene "
    "(location, mood, camera feel); `character_names` = the cast members appearing (so the shot "
    "films against their faces); `duration_estimate_s` between 5 and 15; `scene_continuity` = "
    "\"continuous\" ONLY "
    "when this shot carries on the SAME moment and location as the immediately previous "
    "DIALOGUE_SCENE (it will be visually chained from its last frame) — any time-skip (\"next "
    "morning\", \"later\") or location change MUST be \"new\"; `emotional_beat` = the feeling the "
    "scene must land (e.g. 'weary frustration', 'relief breaking into a smile') — the actors are "
    "directed to play it; `time_of_day` = when it happens (e.g. 'late night', 'bright morning') — "
    "the clip is lit for it; `location` = a short stable slug for the PLACE only (e.g. "
    "'maheshwari_office') — reuse the SAME slug whenever the story returns to that place, so the "
    "set stays the same room across scenes. NEVER encode time-of-day or lighting in the slug "
    "(NOT 'office_night'/'office_day' — same room at night and morning = SAME slug; time_of_day "
    "carries the lighting and the set is re-lit, not rebuilt). When you use DIALOGUE_SCENE anywhere, "
    "you MUST also emit a top-level `characters` array — [{name, visual_description, voice_hint}] — "
    "where `visual_description` is a REUSABLE VERBATIM portrait (age, build, hair, clothing, one "
    "distinctive detail) that stays IDENTICAL across the video, and `voice_hint` describes the "
    "voice (e.g. 'warm female voice, 30s, measured'). Keep the cast small (≤3). Interleave with "
    "narrated shots: narrator sets up → characters play the moment → narrator resolves.\n\n"

    "**RULES**:\n"
    "0. **Support visuals (MANDATORY per shot).** Every non-title shot MUST "
    "carry `support_visuals`: 2-4 items, each `{\"concept\": <short label of a "
    "CONCRETE, imageable thing the narration mentions>, \"phrase\": <the exact "
    "3-6 words of the narration_brief it belongs to>, \"kind\": \"photo\"|"
    "\"icon\"}`. Use \"photo\" for tangible scenes/objects/people (a patient "
    "walking, a goniometer on a knee, hands writing notes) and \"icon\" for "
    "abstract concepts (a step, a goal, a warning, a quiz). The pipeline "
    "pre-generates these into real imagery revealed AS the narrator speaks "
    "each phrase — this is what makes the video visual instead of a wall of "
    "text. Skip for KINETIC_TITLE/KINETIC_TEXT/LOWER_THIRD and DIALOGUE_SCENE "
    "(acted clips carry their own footage).\n"
    "1. First shot is the hook — pick whichever shot type sells the topic best "
    "(VIDEO_HERO / IMAGE_HERO for real-world openers, KINETIC_TITLE for bold-text hooks, "
    "INFOGRAPHIC_SVG for concept-first openers, PRODUCT_HERO for brand/subject reels).\n"
    "2. **Diversity floor.** Never use the same shot type 3 times in a row. A "
    "video of 6+ shots MUST use at least 4 DISTINCT shot types, and — when the "
    "topic permits — at least one high-craft type (INFOGRAPHIC_SVG, PRODUCT_HERO, "
    "DEVICE_MOCKUP, DATA_STORY, PROCESS_STEPS, or EQUATION_BUILD) rather than "
    "defaulting to TEXT_DIAGRAM + IMAGE_HERO for everything. Diversity is a FLOOR, "
    "not a quota — each type change must serve its beat; do not churn shot types "
    "just to vary.\n"
    "3. Follow the topic image_ratio guidance provided.\n"
    "4. **RHYTHM PROFILE** — pacing is NOT uniform; tempo CONTRAST is what makes editing feel directed "
    "rather than templated.\n"
    "   Baseline durations (a starting point, NOT a metronome):\n"
    "   - **Hook (shot 0)**:        target × 0.15,  min 3.5s, max 5.0s.\n"
    "   - **Body shots (middle)**:  average target × 0.10–0.13, min 2.5s, max 4.0s.\n"
    "   - **Close (final shot)**:   target × 0.17,  min 3.5s, max 5.5s.\n"
    "   Then SHAPE the rhythm: pick the video's climax/turn shot (usually a `moment`) and place it "
    "deliberately. Build toward it — progressively SHORTER body shots accelerate energy — OR drop into a "
    "sudden HOLD on the reveal. At least ONE body shot MUST deviate ≥40% from the average body duration "
    "(a fast ~1.8s punch or a held ~5s beat); if every body shot sits within a few tenths of the average, "
    "the video reads as a metronome — fix it.\n"
    "   Emit a per-shot `pacing_role` ∈ {build, hold, hit, breath}: `build` = momentum/accelerating, "
    "`hit` = the fast punchy beat, `hold` = the deliberate slow reveal/climax, `breath` = hook/close/reset.\n"
    "   The two examples below are ILLUSTRATIVE ARITHMETIC ONLY — do NOT reproduce a uniform body: "
    "30s ≈ hook 4.5s + ~7 VARIED body shots + close 5.0s; 45s ≈ hook 5.0s + ~10 VARIED body + close 5.0s.\n"
    "   Hook and close MUST breathe — cramming them sub-3.5s kills the open/close beat.\n"
    "   Longer than 5s on a body shot only when it carries heavy in-shot motion (PROCESS_STEPS, "
    "EQUATION_BUILD, DATA_STORY) or is a deliberate `hold` on the climax. Split content that needs longer.\n"
    "   NEVER pack more body shots than `(target - hook - close) / 2.5` allows — that's the floor.\n"
    "   For portrait/9:16, hook/close stays in the same range; body skews 0.5s faster (min 2.0s).\n"
    "   Cap shot count at 12 — anything beyond is over-packed.\n"
    "5. Total of all `duration_estimate_s` should equal the `target_duration_s` (±5%).\n"
    "6. LOWER_THIRD can overlap other shots (mark `overlay: true`).\n"
    "7. For cutout images (ANIMATED_ASSET), always specify 'isolated on solid [color] background, "
    "no other objects, clean edges' in `image_prompt`.\n"
    "8. Prefer VIDEO_HERO over IMAGE_HERO when topic has real-world visual component.\n"
    "9. KINETIC_TEXT must appear at most once per video and never back-to-back with another KINETIC_TEXT.\n"
    "10. **You own the visual style.** You decide the theme, background, and animation language for each shot — "
    "and whether they stay consistent or shift across the timeline. Coherence is usually good "
    "(matching shot families within an act), but a long video CAN change worlds between acts "
    "(e.g. photo hero → illustrated infographic → product hero outro) as long as each transition "
    "feels intentional. Use KINETIC_TITLE or a hard cut between shots to mark act changes.\n"
    "11. **INTENT ROLE = the DRAMATIC ARC** (`intent_role`, required per shot): one of `hook`, `setup`, "
    "`explanation`, `example`, `moment`, `recap`, `cta`. This is not just a label — the sequence MUST form "
    "an arc: the `hook` poses a tension or open question; `setup`/`explanation`/`example` shots ESCALATE "
    "toward it; at least one `moment` is the PAYOFF (the single shot a viewer would remember); the final "
    "shot (`cta` or `recap`) RESOLVES the exact tension the hook opened and calls back to it. A plan whose "
    "ending does not answer its opening is failing. Shot 0 is `hook`; the middle is mostly `explanation` "
    "with `example` / `moment` placed for build; the final shot is `cta` or `recap`.\n"
    "12. **BRAND ASSET USAGE — non-negotiable when reference assets are present**. "
    "When the user has uploaded reference assets (logos, product photos, brand marks — surfaced "
    "below as 🏷️ BRAND ANCHOR), the FIRST and LAST shots MUST be designed to embed at least one "
    "of those assets. Pick a shot_type that can host an `<img>` (PRODUCT_HERO, IMAGE_HERO, "
    "ANIMATED_ASSET, INFOGRAPHIC_SVG, DEVICE_MOCKUP) — NOT a text-only shot type (KINETIC_TITLE, "
    "KINETIC_TEXT, LOWER_THIRD) for the open/close. Plus: any shot tagged `role: \"product_proof\"` "
    "MUST also be an asset-hosting shot_type. The pipeline runs a post-render regex assertion on "
    "these shots — missing the reference triggers a corrective regen.\n\n"

    "**NARRATION BRIEF (per shot — required)**:\n"
    "Each shot carries a `narration_brief`: a 1-2 sentence description of what the NarrationWriter "
    "should say. NOT the actual sentences — a brief. The NarrationWriter will see the full plan and "
    "author coherent narration across all shots that honors each brief.\n"
    "Examples:\n"
    "  - hook: \"Set up the topic with a question or surprising claim. Tone: curious, energetic. \"\n"
    "          \"~10-12 words. Mention the subject by name once.\"\n"
    "  - explanation: \"Explain step 2 of the process: what the user does, why it matters. \"\n"
    "                 \"~15-20 words. Use concrete verbs.\"\n"
    "  - cta: \"Wrap with a confident close — invite the viewer to act. \"\n"
    "         \"~12 words. Brand name appears once.\"\n"
    "  - moment (purely visual): \"\" (empty brief — this shot rides on visuals; audio_policy=intrinsic_only).\n"
    "Word count per shot should track ~150 wpm × duration_estimate_s. A 4.5s shot ≈ 11 words.\n\n"

    "**AUDIO POLICY (per shot — required)**:\n"
    "Allowed values:\n"
    "- `\"narration_only\"` (default) — master TTS plays this shot's narration_brief expansion. "
    "Pick this for almost every shot.\n"
    "- `\"intrinsic_only\"` — this shot carries its own audio; master narration is silenced in "
    "this shot's window. Use for:\n"
    "    • SOURCE_CLIP shots where the user wants the speaker's original voice (your call: "
    "      if the source clip has a meaningful audible moment, pick intrinsic_only and emit "
    "      narration_brief=\"\"; otherwise narration_only and write a voice-over brief).\n"
    "    • AI_VIDEO_HERO shots with `ai_video_audio=true` (only on runs with audio_enabled).\n"
    "    • Pure visual moments where silence + visual carries the beat better than narration.\n"
    "- `\"narration_over_clip\"` — the shot is a CHARACTER clip (a cast member acting, NOT "
    "speaking) and the master narrator speaks OVER it. Use for the SILENT flavor of "
    "DIALOGUE_SCENE (see that shot type). Unlike intrinsic_only, the clip's own audio is muted "
    "and `narration_brief` is REQUIRED and KEPT — the narrator carries the beat.\n"
    "When `audio_policy=intrinsic_only`, `narration_brief` MUST be \"\" (empty string) — there is "
    "no narration to brief. When `audio_policy=narration_over_clip`, `narration_brief` MUST be "
    "non-empty.\n\n"

    "**BACKGROUND CONTINUITY — `background_treatment` (per shot, RECOMMENDED)**:\n"
    "Every non-media-hero shot should declare a `background_treatment` field. Allowed values:\n"
    "- `\"brand_solid\"`    — flat `var(--brand-bg)`. The default for typography, KINETIC_TITLE, "
    "LOWER_THIRD, DEVICE_MOCKUP, and any connective shot. Cheap, calm, brand-anchored.\n"
    "- `\"brand_textured\"` — `var(--brand-bg)` + halftone / dotgrid / fine line overlay. "
    "For data-dense shots (DATA_STORY, PROCESS_STEPS, INFOGRAPHIC_SVG, TEXT_DIAGRAM, ANNOTATION_MAP).\n"
    "- `\"brand_gradient\"` — `var(--brand-bg)` → 6% darker linear gradient. "
    "For PRODUCT_HERO and brand reels where 'world changes around the subject' is the pattern.\n"
    "- `\"media_hero\"`     — the visible media IS the background. "
    "Required for VIDEO_HERO, IMAGE_HERO, IMAGE_SPLIT, SOURCE_CLIP, AI_VIDEO_HERO, ARTICLE_FOCUS.\n"
    "**Cross-shot rule: use AT MOST 2 distinct non-media-hero treatments across the whole video.** "
    "Pick ONE primary treatment (typically brand_solid or brand_textured) and use it for ≥75% of "
    "non-media-hero shots. Media-hero shots are exempt from this count.\n"
    "If you omit the field, the pipeline infers a default from `shot_type` — but the inferred "
    "value is conservative; choose explicitly when a specific treatment serves the shot.\n"
    "NEVER let a per-shot LLM invent its own background hex — every non-media-hero shot honors "
    "`var(--brand-bg)` through this field.\n\n"

    + planner_menu_block() +

    "**OPTIONAL — `semantic_accents` (per-shot contrast color)**:\n"
    "When a shot's narration introduces a binary or ternary contrast that color would reinforce "
    "— warning vs success, real vs fake, before vs after, right vs wrong, brand vs hobby — add a "
    "`\"semantic_accents\": [...]` array to that shot. Allowed values: `\"warn\"` (red), "
    "`\"good\"` (green), `\"gold\"` (warm metallic). Pick at most TWO per shot. Leave the field "
    "absent on descriptive shots without a contrast.\n\n"

    "**OPTIONAL — `template_id` (deterministic shot composition)**:\n"
    "Some shots cleanly fit a pre-built composition layout. Setting `template_id` AND "
    "`template_params` renders that layout deterministically — NO per-shot LLM call and perfect "
    "cross-shot consistency, but ALSO zero bespoke direction for that shot. DEFAULT to directing "
    "the shot yourself (leave `template_id` null); reach for a template ONLY when you genuinely "
    "cannot improve on it, or when sibling-shot consistency demands the identical layout (e.g. a "
    "repeating stat card). Keep templated shots to roughly a THIRD of the video at most, and never "
    "use the same template twice unless it is an intentional recurring motif. Templates compose "
    "with any `shot_type`.\n\n"

    "**TRANSITION_IN** (required for every shot — pick exactly one):\n"
    "- `\"cut\"` — instant. KINETIC_TEXT (always), fast reels back-to-back shots.\n"
    "- `\"fade\"` — opacity 0→1, 0.4s. Default for education content, reflective beats.\n"
    "- `\"slide_right\"` — slides in from left. Narrative forward movement.\n"
    "- `\"slide_left\"` — slides in from right. Going back/revisiting. Use sparingly.\n"
    "- `\"slide_up\"` — rises from below. Topic elevation, list reveals.\n"
    "- `\"zoom_in\"` — scale 0.85→1.0. KINETIC_TITLE (always), key concept hooks.\n"
    "- `\"zoom_out\"` — scale 1.15→1.0. Revealing larger context.\n"
    "- `\"wipe_right\"` — clip-path sweeps from left. After topic-break beats, act transitions.\n"
    "- `\"circle_iris\"` — branded circular reveal expanding from center. Hero moments / act openers.\n"
    "- `\"diagonal_wipe\"` — diagonal stripe wipe. Forward-momentum reel cuts.\n"
    "- `\"hexagon_iris\"` — hexagonal iris reveal. Distinctive moments; opens and closes only.\n"
    "- `\"blinds_horizontal\"` — horizontal blinds reveal. Pairs naturally after KINETIC_TITLE.\n"
    "- `\"smash_cut\"` — instant cut + a brief white impact flash. Surprises, hard facts, high-energy hits.\n"
    "- `\"dip_to_black\"` — fade through black. A deliberate time jump or topic reset.\n"
    "Non-negotiable: KINETIC_TEXT → `cut`. KINETIC_TITLE → `zoom_in`. After KINETIC_TITLE → next "
    "shot uses `wipe_right` or `blinds_horizontal`. Default: `fade`. "
    "Use the branded mask reveals (`circle_iris` / `hexagon_iris` / `blinds_horizontal` / "
    "`diagonal_wipe`) sparingly — once per video on a hero moment is usually enough.\n\n"

    "**TOP-LEVEL `recurring_motifs` (RECOMMENDED — drives cross-shot consistency)**:\n"
    "Alongside `shots`, declare a top-level `recurring_motifs` array listing brand elements that "
    "MUST appear at the same screen position across every applicable shot. Examples:\n"
    "`recurring_motifs`: [\n"
    "  {`description`: 'Brand monogram (color X on transparent)',\n"
    "   `screen_position`: 'top-right, 64px from each edge, 48px tall',\n"
    "   `when_visible`: 'every shot except media_hero'},\n"
    "  {`description`: 'Bottom safe-area progress bar',\n"
    "   `screen_position`: 'bottom-edge full-width, 6px tall, fills with brand_accent over runtime',\n"
    "   `when_visible`: 'every shot'}\n"
    "]\n"
    "Each item: `description`, `screen_position`, `when_visible`. The per-shot LLM is handed "
    "this list verbatim — without it, every shot reinvents where the logo sits.\n\n"

    "**TOP-LEVEL `beat_map` (the COLOR SCRIPT — RECOMMENDED, shapes rhythm + music)**:\n"
    "Alongside `shots`, emit a top-level `beat_map`: an ordered list of SECTIONS (a section is a run of "
    "consecutive shots that share a mood). Each entry: `from_shot` + `to_shot` (inclusive shot indices), "
    "`emotion` (the section's feeling), `energy` (0.0–1.0 — how intense/fast the section feels), and "
    "`color_role` (which palette role leads: `base` | `brand` | `accent` | `warn` | `good` | `gold` — "
    "NEVER a raw hex; these map to the institute's brand tokens + semantic accents). The `energy` curve is "
    "a RHYTHM commitment: it MUST rise toward your climax/`moment` and drop on holds and the close — a flat "
    "curve (all sections within ~0.2 of each other) means you haven't shaped the video. This curve drives "
    "per-shot motion intensity AND the music dynamics (the score builds and drops with it). Cover every "
    "shot exactly once, in order.\n\n"

    "**OUTPUT ENVELOPE — NON-NEGOTIABLE**:\n"
    "Your response MUST be a JSON object. First character `{`. Last character `}`. No markdown "
    "fences, no preamble, no postamble. Top-level shape:\n"
    "  {\n"
    "    \"creative_concept\": { \"controlling_idea\": \"...\", \"tonal_register\": \"...\", "
    "\"emotional_arc\": \"...\", \"visual_metaphor\": \"...\", \"signature_device\": \"...\", "
    "\"what_to_avoid\": \"...\" },\n"
    "    \"shots\": [ {<shot dict>}, ... ],\n"
    "    \"continuity_notes\": \"<≤200 chars: how shots flow together>\",\n"
    "    \"recurring_motifs\": [ {<motif dict>}, ... ],   // see above\n"
    "    \"beat_map\": [ {\"from_shot\": 0, \"to_shot\": 1, \"emotion\": \"...\", \"energy\": 0.4, \"color_role\": \"base\"}, ... ]\n"
    "  }\n"
    "Each shot dict MUST include: `shot_index` (int), `shot_type` (string), `intent_role` (string), "
    "`narration_brief` (string, may be empty), `audio_policy` (string), `duration_estimate_s` "
    "(float), `transition_in` (string), `background_treatment` (string). Plus shot-type-specific "
    "fields (image_prompt, video_query, ai_video_prompt, source_start/source_end, template_id/"
    "template_params, etc.) as the catalog requires.\n"
)


# Verbalized Sampling — appended to the system prompt when the tier enables it.
# Breaks concept mode-collapse on cheap models by asking for an internal
# distribution of candidates and returning only the strongest. Output contract
# is unchanged (still ONE creative_concept), so the parser is untouched.
_VERBALIZED_SAMPLING_BLOCK = (
    "\n\n**CONCEPT DIVERGENCE (Verbalized Sampling)**:\n"
    "Before committing to the creative_concept, INTERNALLY generate THREE genuinely different "
    "controlling_idea candidates for THIS prompt + audience — spanning distinct angles (e.g. "
    "contrarian, emotional, mechanism-first) — each with a rough probability of being the "
    "strongest. Then pick the boldest viable one and output ONLY that single creative_concept "
    "(do NOT emit the alternatives or the probabilities). Goal: a less generic, less "
    "mode-collapsed concept — not extra text. Reject any candidate that merely restates the topic.\n"
)


# ─────────────────────────────────────────────────────────────────────────────
# User prompt builder
# ─────────────────────────────────────────────────────────────────────────────

def _img_label_for(index: int) -> str:
    """Spreadsheet-style label for an uploaded image: A..Z, then AA, AB, ..."""
    label = ""
    n = max(0, index)
    while True:
        label = chr(ord("A") + n % 26) + label
        n = n // 26 - 1
        if n < 0:
            break
    return label


def build_input_image_block(images: List[Dict[str, Any]]) -> str:
    """Describe the user's indexed images so the planner can place them.

    Each entry carries the metadata the image indexer produced: a caption, tags,
    the UI elements it recognised, and OCR blocks with NORMALISED bounding boxes.
    The bboxes are the reason this block is worth its tokens — they are what let
    an annotation land on the actual button being described rather than floating
    somewhere over the screenshot.

    OCR volume scales down as the image count rises so a 20-still run does not
    blow the prompt budget; mirrors the transcript budget on the video side.
    """
    n = len(images)
    # The image indexer emits meta / colors / ocr only — there is no caption
    # block, so `short`, `long`, `tags` and `ui_elements` below are almost
    # always absent in practice. OCR is therefore the ONLY signal saying what a
    # given upload actually depicts, which is what the planner matches against
    # when the prompt names a screenshot by content. `full_text` identifies a
    # screen far better per token than a handful of positioned blocks, so it
    # carries identity and the blocks carry placement.
    ocr_budget = max(6, 90 // max(1, n))
    text_budget = 280 if n > 10 else 420

    # Screens from one product share chrome — a nav bar, a footer, a sidebar.
    # Taken verbatim, the first 280 characters of every screenshot in a
    # walkthrough is the SAME menu, so each image describes itself identically
    # and the planner cannot tell them apart. Drop fragments that recur across
    # most of the batch; what survives is what makes each screen itself.
    def _fragments(ictx: Dict[str, Any]) -> List[str]:
        raw = ((ictx.get("context", {}) or {}).get("ocr", {}) or {}).get("full_text") or ""
        return [t.strip() for t in raw.split("\n") if t.strip()]

    # Frequency across the batch, used to RANK rather than to threshold. A cutoff
    # cannot work here: this product's nav bar appears on a quarter of the
    # screens, so any threshold loose enough to drop it also drops real content
    # that several screens legitimately share. Ranking needs no cutoff — the
    # rarest text on a screen is what distinguishes it, so it simply goes first
    # and the shared chrome falls off the end of the budget on its own.
    doc_freq: Dict[str, int] = {}
    for ictx in images:
        for frag in set(_fragments(ictx)):
            doc_freq[frag] = doc_freq.get(frag, 0) + 1

    sections: List[str] = []

    for idx, ictx in enumerate(images):
        blob = ictx.get("context", {}) or {}
        meta = blob.get("meta", {}) or {}
        caption = blob.get("caption", {}) or {}
        ocr_blocks = (blob.get("ocr", {}) or {}).get("blocks", []) or []
        faces = blob.get("faces", {}) or {}

        name = ictx.get("name", f"Image {_img_label_for(idx)}")
        mode = ictx.get("mode", "photo")
        url = ictx.get("source_public_url") or ictx.get("source_url", "")
        width = meta.get("width", ictx.get("width", 0))
        height = meta.get("height", ictx.get("height", 0))
        default_dur = ictx.get("duration_seconds", 5.0)

        sec = (
            f"\n### Image {_img_label_for(idx)}: \"{name}\" ({mode}, {width}x{height})\n"
            f"image_index: {idx}\n"
            f"source_public_url: {url}\n"
            f"default_duration_s: {default_dur}\n"
        )
        if caption.get("short"):
            sec += f"Caption: {caption['short']}\n"
        if caption.get("long"):
            sec += f"Detail: {caption['long']}\n"
        tags = ", ".join((caption.get("tags") or [])[:10])
        if tags:
            sec += f"Tags: {tags}\n"
        ui_elements = caption.get("ui_elements") or []
        if ui_elements:
            sec += f"UI elements visible: {', '.join(ui_elements[:10])}\n"
        frags = _fragments(ictx)
        # Most distinctive first, ties broken by where it sits on screen, then
        # restored to reading order once the budget is filled — the planner gets
        # what identifies this screen, still in the order a person would read it.
        ranked = sorted(range(len(frags)), key=lambda i: (doc_freq.get(frags[i], 1), i))
        chosen: List[int] = []
        used = 0
        for i in ranked:
            cost = len(frags[i]) + 3
            if used + cost > text_budget and chosen:
                break
            chosen.append(i)
            used += cost
        full_text = " · ".join(frags[i] for i in sorted(chosen))
        if full_text:
            sec += f"Text on screen: {full_text}\n"
        if ocr_blocks:
            lines = [
                f"  \"{b.get('text', '')}\" @ bbox_norm={b.get('bbox_norm', [])}"
                for b in ocr_blocks[:ocr_budget]
            ]
            sec += "OCR text blocks (normalized bboxes 0-1):\n" + "\n".join(lines) + "\n"
        if faces.get("detected"):
            free = ", ".join(faces.get("free_regions", []) or []) or "none"
            sec += f"Face detected (count={faces.get('face_count', 0)}). Safe overlay zones: {free}\n"
        sections.append(sec)

    rules = (
        "**IMAGE_CLIP RULES**:\n"
        f"- The user uploaded {n} image(s). They are the subject of this video, not "
        "decoration — show them. Give each one a beat unless the narration truly has "
        "no use for it.\n"
        f"- Each IMAGE_CLIP shot MUST set `image_index`, an integer from 0 to {n - 1} "
        f"inclusive (0 = Image A, 1 = Image B, ...). There are exactly {n} images; "
        f"{n} and above do not exist and would render the wrong screenshot.\n"
        "- Do NOT invent an illustration to stand in for an uploaded image. If a beat is "
        "about something an upload shows, use the upload.\n"
        "- For screenshots and diagrams, position callouts and arrows using the OCR "
        "bbox_norm coordinates so an annotation lands on the element it names.\n"
        "- For photos with faces, keep overlays inside the listed safe zones.\n"
        "- Default durations: photo 4s, screenshot 6s, diagram 8s. Lengthen when the "
        "narration at that image needs longer.\n"
        "- Between image beats, use graphic shot types (TEXT_DIAGRAM, PROCESS_STEPS, "
        "DATA_STORY, KINETIC_TITLE) to explain structure and numbers, so the video is "
        "not the same framed screenshot N times.\n"
    )
    return (
        "IMAGE_CLIP IS AVAILABLE — the user uploaded source images.\n"
        "\n## SOURCE IMAGE CONTEXTS\n" + "".join(sections) + "\n" + rules
    )


def build_shot_planner_user_prompt(
    *,
    prompt: str,
    target_duration_s: float,
    target_audience: str,
    language: str,
    content_type: str,
    tier: str,
    image_ratio: str,
    visual_preferences: Optional[Dict[str, Any]] = None,
    reference_assets: Optional[List[Dict[str, Any]]] = None,
    brand_brief: Optional[Dict[str, Any]] = None,
    ai_video_enabled: bool = False,
    ai_video_audio_enabled: bool = False,
    ai_video_cost_cap_usd: float = 1.50,
    ai_video_per_clip_usd: float = 0.24,
    source_clip_available: bool = False,
    dialogue_scenes_enabled: bool = False,
    dialogue_mode: str = "storybook",
    saved_cast: Optional[List[Dict[str, Any]]] = None,
    asset_asks_enabled: bool = False,
    article_screenshots: Optional[List[Dict[str, Any]]] = None,
    input_images: Optional[List[Dict[str, Any]]] = None,
    subject_domain: Optional[str] = None,
    cultural_context: Any = None,
    template_catalog_md: Optional[str] = None,
    valid_template_ids: Optional[List[str]] = None,
    lesson: Optional[Dict[str, Any]] = None,
) -> str:
    """Build the user-facing prompt for the ShotPlanner LLM call.

    Wraps the user's free-form prompt with configs, uploads, tier, and the
    ai_video / source_clip / article-focus availability hints so the LLM
    knows what gated shot types are accessible.
    """
    lines: List[str] = [
        f"USER REQUEST: {prompt}",
        f"TARGET DURATION: {target_duration_s:.1f} seconds",
        f"TARGET AUDIENCE: {target_audience}",
        f"LANGUAGE: {language}",
        f"CONTENT TYPE: {content_type}",
        f"QUALITY TIER: {tier}",
        f"IMAGE RATIO: {image_ratio} (16:9 = landscape; 9:16 = portrait)",
    ]
    if subject_domain:
        lines.append(f"SUBJECT DOMAIN: {subject_domain}")
    if lesson:
        from lesson_mode import planner_user_block
        lines.append(planner_user_block(
            lesson,
            target_duration_s=target_duration_s,
            portrait=str(image_ratio).strip() == "9:16",
        ))
        lines.append(
            "Keep each shot's JSON compact (narration_brief ≤ 30 words, visual_description ≤ 45 words) "
            "— a long lesson has many sections and the whole plan must fit in one response."
        )

    # Marketing shot-mix bias — fires ONLY for promotional/product content so
    # educational lectures (where TEXT_DIAGRAM is the right default) are
    # untouched. Counters the planner's default of routing every "explanation"
    # beat to a text/diagram panel, which is what makes marketing videos feel
    # text-heavy and robotic.
    _sd = (subject_domain or "").strip().lower()
    _ct = (content_type or "").strip().lower()
    if _sd in ("saas_marketing", "business_marketing", "saas_demo") or _ct in ("ad", "marketing"):
        lines.append("")
        lines.append(
            "MARKETING SHOT MIX — this is a promotional/product video, NOT a lecture. "
            "Lead with VISUALS, keep on-screen text minimal:\n"
            "  - FAVOR IMAGE_HERO / VIDEO_HERO / DEVICE_MOCKUP / PRODUCT_HERO / ANIMATED_ASSET "
            "(real imagery, footage, product & device moments) over text-panel shots.\n"
            "  - Use TEXT_DIAGRAM / INFOGRAPHIC_SVG SPARINGLY — at most ~1 in 4 shots, and only "
            "when a diagram genuinely beats showing it. Do NOT default explanations to TEXT_DIAGRAM.\n"
            "  - The hook MUST be a visual or kinetic-title moment, never a text diagram.\n"
            "  - Think modern brand film / social ad: imagery carries the story; text is punchy keywords."
        )

    # AI video gating
    if ai_video_enabled:
        audio_note = (
            "Audio MAY be enabled per-shot via `ai_video_audio=true` — use sparingly; "
            "audio variant raises cost from $0.03/s to $0.05/s."
            if ai_video_audio_enabled
            else "Audio mode is OFF — do NOT set `ai_video_audio: true`."
        )
        # Derive the REAL shot budget from the cap AND the selected model's
        # per-clip cost — NOT a hardcoded lite price. Full Veo ($1.60/clip)
        # funds ~7x fewer clips than lite ($0.24) for the same cap; hardcoding
        # 0.24 would make the planner plan far more AI shots than the cap can
        # fund, and the excess would silently demote to stock mid-video.
        _per_clip = ai_video_per_clip_usd if ai_video_per_clip_usd and ai_video_per_clip_usd > 0 else 0.24
        _ai_shot_budget = max(1, int(ai_video_cost_cap_usd / _per_clip))
        lines.append("")
        # AI_VIDEO_HERO has NO entry in this file's shot-type vocabulary —
        # the only place its required fields (`ai_video_prompt`,
        # `ai_video_duration_s` ∈ {4,6,8}, `video_query` fallback, ≥4s
        # duration) are actually taught is the v2 Director block. Without
        # it the planner emits AI_VIDEO_HERO shots missing those fields and
        # the orchestrator demotes every one to IMAGE_HERO — i.e. the user
        # opts in to AI footage and silently gets none. Reuse the block so
        # both planners teach the identical contract.
        try:
            from director_prompts import build_ai_video_director_block
            lines.append(build_ai_video_director_block(
                enabled=True,
                audio_enabled=bool(ai_video_audio_enabled),
                cost_cap_usd=ai_video_cost_cap_usd,
                shot_budget=_ai_shot_budget,
            ))
        except Exception:
            # Fallback: state the hard contract inline rather than leaving
            # the planner with no field spec at all.
            lines.append(
                f"AI_VIDEO_HERO IS ENABLED — budget ~{_ai_shot_budget} shot(s) "
                f"(cap ${ai_video_cost_cap_usd:.2f}). REQUIRED per shot: "
                "`ai_video_prompt` (vivid visual description, no in-frame text), "
                "`ai_video_duration_s` ∈ {4,6,8}, `video_query` (stock fallback "
                "terms), and duration_estimate_s ≥ 4.0."
            )
        lines.append(audio_note)
    else:
        lines.append("")
        lines.append(
            "AI_VIDEO_HERO IS NOT ENABLED — do NOT pick shot_type=AI_VIDEO_HERO. "
            "Use VIDEO_HERO / IMAGE_HERO / motion-graphics shots instead."
        )

    # Dialogue-scene gating (storybook/drama mode)
    if dialogue_scenes_enabled and str(dialogue_mode or "").lower() == "drama":
        lines.append("")
        lines.append(
            "DRAMA MODE — this is a PURE CHARACTER FILM with NO NARRATOR. The "
            "entire story is told through the CHARACTERS — their dialogue and "
            "their actions. There is NO master narrator voice anywhere in the "
            "video. EVERY beat is a DIALOGUE_SCENE filmed against the cast's "
            "faces. Build a dramatic arc (setup → tension → turn → resolution) "
            "across 3-6 scenes.\n"
            "ROUTING RULE — if a CHARACTER is on screen, it is a DIALOGUE_SCENE "
            "clip. Full stop. This includes beats where a character shows or "
            "uses a PRODUCT (a phone, a tablet, a laptop, a dashboard, an app): "
            "the character HOLDS or USES it IN the clip — e.g. 'Anjali turns her "
            "tablet toward Rohit, the app open on it'. Do NOT split the product "
            "into a separate screen/mockup shot — that breaks the drama and the "
            "visual continuity. A non-DIALOGUE_SCENE shot (DEVICE_MOCKUP / "
            "IMAGE_HERO / graphics) is allowed ONLY for a beat with LITERALLY NO "
            "PERSON in it, and in a character drama you should almost never need "
            "one — prefer folding the product into a character's hands.\n"
            "Decide each character beat by WHAT the character is doing:\n"
            "• A character SPEAKS → DIALOGUE_SCENE, speaking flavor (dialogue "
            "lines, audio_policy=intrinsic_only, narration_brief=\"\").\n"
            "• A character is SHOWN but not speaking (a wordless emotional beat — "
            "an anxious look, working late, a relieved smile, showing a screen) → "
            "DIALOGUE_SCENE, SILENT flavor (dialogue=[], action_description of "
            "what they DO, character_names, audio_policy=intrinsic_only, "
            "narration_brief=\"\"). The clip carries its OWN ambient — NO narrator.\n"
            "DIALOGUE LENGTH — the clips are ~10 seconds MAX (hard model cap). "
            "Keep each DIALOGUE_SCENE to AT MOST 2 short spoken lines (≈14 words "
            "/ ≈8 seconds of natural delivery total) so the speech FITS the clip "
            "and is never cut off mid-sentence. If an exchange needs more, SPLIT "
            "it across consecutive scenes marked scene_continuity=\"continuous\" "
            "(2 lines, then the next 2 lines) — never pack 3+ lines into one shot.\n"
            "Because there is NO narrator, the DIALOGUE across the scenes must "
            "carry the story. Use silent beats for wordless emotional "
            "punctuation, NOT to carry plot. Do NOT write any narration_brief.\n"
            "Every beat MUST list its cast in `character_names` so it films "
            "against their faces. Mark consecutive shots continuing the SAME "
            "moment/location scene_continuity=\"continuous\" (visually chained); "
            "any real time-skip or location change \"new\". Emit the top-level "
            "`characters` cast array with VERBATIM-reusable visual descriptions — "
            "the SAME characters recur across every scene."
        )
    elif dialogue_scenes_enabled:
        lines.append("")
        lines.append(
            "DIALOGUE SCENES ARE ENABLED — this video may include 1-4 DIALOGUE_SCENE shots "
            "(characters speaking on camera in fully AI-generated clips). Use them for the "
            "story's dramatic moments; keep the narrator for setup/resolution. Emit the "
            "top-level `characters` cast array with VERBATIM-reusable visual descriptions."
        )
    else:
        lines.append(
            "DIALOGUE SCENES ARE NOT ENABLED — do NOT pick shot_type=DIALOGUE_SCENE and do "
            "NOT emit a `characters` array."
        )
    if asset_asks_enabled:
        lines.append("")
        lines.append(
            "ASSET REQUESTS — the user is in assist mode and can hand you REAL assets. "
            "Where a real user asset would DRAMATICALLY beat anything generated, emit a "
            "top-level `asset_requests` array (AT MOST 4 items; only where authenticity "
            "matters — do not ask for things generation handles well). Each item: "
            "{\"shot_index\": <int or null>, \"kind\": \"screenshot|photo|data|inspiration\", "
            "\"ask\": <one plain question to the user>, \"why\": <one line on what it improves>, "
            "\"options\": [<2-3 strings, ONLY for kind=inspiration>]}. Use:\n"
            "  - kind=screenshot for every DEVICE_MOCKUP that depicts the user's own product "
            "(a real screenshot beats an invented interface every time);\n"
            "  - kind=photo when a real product/team/place photo would anchor a hero shot;\n"
            "  - kind=data when the narration will state a specific statistic — ask the user "
            "to confirm THEIR real number;\n"
            "  - kind=inspiration when you genuinely hesitate between visual directions — "
            "offer the options as short named choices.\n"
            "Every request is skippable — plan every shot to work WITHOUT the asset too."
        )

    if dialogue_scenes_enabled and saved_cast:
        lines.append("")
        cast_lines = "\n".join(
            f"  - {c.get('name')}: {c.get('visual_description')}"
            + (f" (voice: {c.get('voice_hint')})" if c.get('voice_hint') else "")
            for c in saved_cast if isinstance(c, dict) and c.get("name")
        )
        lines.append(
            "USE THIS EXISTING SAVED CAST — these characters already exist with locked "
            "portraits and voices from earlier videos in this series. Use EXACTLY these "
            "names, and emit EXACTLY these visual_description values VERBATIM in your "
            "top-level `characters` array. Do NOT invent new main characters (background "
            "extras without dialogue are fine):\n" + cast_lines
        )

    # Source clip gating
    if source_clip_available:
        lines.append(
            "SOURCE_CLIP IS AVAILABLE — the user has uploaded a source video. You MAY pick "
            "shot_type=SOURCE_CLIP for key quotes / soundbites; set `source_start` and "
            "`source_end` in seconds."
        )
    else:
        lines.append(
            "SOURCE_CLIP IS NOT AVAILABLE — no source video uploaded. Do NOT pick "
            "shot_type=SOURCE_CLIP."
        )

    # Indexed input images gating.
    # IMAGE_CLIP was previously reachable only from the deprecated v2 Director,
    # which built its own SOURCE IMAGE CONTEXTS block. On v3 the planner was
    # never told the user's screenshots existed, so an image-led run indexed
    # every still, paid for it, and then planned a video that referenced none
    # of them.
    if input_images:
        lines.append("")
        lines.append(build_input_image_block(input_images))
    else:
        lines.append(
            "IMAGE_CLIP IS NOT AVAILABLE — no source images uploaded. Do NOT pick "
            "shot_type=IMAGE_CLIP."
        )

    # Article screenshots gating
    if article_screenshots:
        lines.append("")
        lines.append("AVAILABLE ARTICLE SCREENSHOTS (for shot_type=ARTICLE_FOCUS):")
        for sc in article_screenshots[:8]:
            sc_id = sc.get("id") or sc.get("screenshot_id") or "?"
            label = sc.get("label") or sc.get("description") or ""
            lines.append(f"  - {sc_id}: {label[:140]}")
    else:
        lines.append(
            "ARTICLE_FOCUS NOT AVAILABLE (no scraped article screenshots). Do NOT pick "
            "shot_type=ARTICLE_FOCUS."
        )

    # Visual preferences
    if visual_preferences:
        active = [(fam, bias) for fam, bias in visual_preferences.items() if bias and bias != "auto"]
        if active:
            lines.append("")
            lines.append("VISUAL PREFERENCES (soft bias — content always wins on conflict):")
            for fam, bias in active:
                arrow = "PREFER" if bias == "high" else "AVOID"
                lines.append(f"  - {fam}: {arrow}")

    # Reference assets — two flavours coexist in this list:
    #   (a) Brand-anchor uploads from the institute (logo, hero asset)
    #       schema: {kind, name|filename, description?, s3_url?}
    #   (b) Pillar 3 web-prefetched references for named entities in prompt
    #       schema: {name, kind, image_url, source, title?, suggested_query?}
    # Both render under the same heading but with different action language —
    # brand uploads are about WHERE to anchor; web pre-fetches are about WHICH
    # url to embed verbatim.
    if reference_assets:
        _brand = [a for a in reference_assets if isinstance(a, dict) and not a.get("image_url")]
        _prefetched = [a for a in reference_assets if isinstance(a, dict) and a.get("image_url")]

        if _brand:
            lines.append("")
            if dialogue_scenes_enabled:
                # Story mode: user attachments are usually CAST face photos,
                # and the hook must be a story cold-open — never an asset card
                # (prod shipped a dark stranger-portrait hook this way).
                lines.append("🏷️  REFERENCE ASSETS provided by the user:")
                for a in _brand[:8]:
                    kind = a.get("kind") or a.get("type") or "asset"
                    name = a.get("name") or a.get("filename") or "unnamed"
                    desc = (a.get("description") or a.get("excerpt") or "").strip()
                    lines.append(f"  - [{kind}] {name}: {desc[:160]}")
                lines.append(
                    "STORY MODE RULES for these assets: any asset that depicts a PERSON or "
                    "FACE is a CAST reference — the casting pipeline uses it for character "
                    "portraits; do NOT embed it in any shot as an image. Only true brand "
                    "assets (logo, product shot, app screenshot) may be embedded, ideally "
                    "in the CLOSE shot. The HOOK (first shot) must be a cold-open STORY "
                    "moment — a character mid-action or mid-feeling (a silent-action "
                    "DIALOGUE_SCENE or a cinematic IMAGE_HERO of the story world) — never "
                    "a static portrait card or logo card."
                )
            else:
                lines.append("🏷️  BRAND ANCHOR — reference assets the FIRST and LAST shots MUST embed:")
                for a in _brand[:8]:
                    kind = a.get("kind") or a.get("type") or "asset"
                    name = a.get("name") or a.get("filename") or "unnamed"
                    desc = (a.get("description") or a.get("excerpt") or "").strip()
                    lines.append(f"  - [{kind}] {name}: {desc[:160]}")
                lines.append(
                    "REMINDER: open/close shots MUST be asset-hosting types (PRODUCT_HERO, IMAGE_HERO, "
                    "ANIMATED_ASSET, INFOGRAPHIC_SVG, DEVICE_MOCKUP) — NOT text-only shots."
                )

        # Pillar 3 — pre-fetched reference image URLs for named entities.
        # Each entity has a real URL the per-shot HTML LLM can embed verbatim.
        # ShotPlanner's job is to ALLOCATE these to specific shot_idx + shot_type
        # so the downstream pipeline knows where each URL belongs.
        if _prefetched:
            lines.append("")
            lines.append("🖼️  PRE-FETCHED REFERENCE IMAGES — entity → image URL mapping:")
            for a in _prefetched[:12]:
                _name = (a.get("name") or "").strip()
                _kind = (a.get("kind") or "entity").strip()
                _url = (a.get("image_url") or "").strip()
                _src = (a.get("source") or "").strip()
                if not _name or not _url:
                    continue
                lines.append(f"  - {_name} ({_kind}) [{_src or 'web'}] → {_url}")
            lines.append("")
            lines.append(
                "**For each entity above:** allocate a shot featuring that entity with "
                "`shot_type` = `IMAGE_HERO` (or `IMAGE_SPLIT` when paired with a "
                "caption / quote). The shot's HTML placeholder MUST use "
                "`<img data-img-source=\"reference\" data-reference-url=\"<exact URL>\">` "
                "so the renderer wires the URL through verbatim. These URLs are the "
                "HIGHEST-FIDELITY option — do NOT pick `data-img-source=\"web\"` or "
                "`\"generate\"` for these entities."
            )

    # Brand brief (extracted colors / fonts)
    if brand_brief:
        accent = brand_brief.get("accent_hex") or brand_brief.get("accent")
        bg = brand_brief.get("bg_hex") or brand_brief.get("background")
        font = brand_brief.get("font_family") or brand_brief.get("font")
        voice = brand_brief.get("voice") or {}
        brand_lines: List[str] = []
        if accent:
            brand_lines.append(f"  - Accent: {accent}")
        if bg:
            brand_lines.append(f"  - Background: {bg}")
        if font:
            brand_lines.append(f"  - Font: {font}")
        if voice:
            tone = voice.get("tone")
            caps = voice.get("caps_style")
            if tone:
                brand_lines.append(f"  - Tone: {tone}")
            if caps:
                brand_lines.append(f"  - Caps style: {caps}")
        if brand_lines:
            lines.append("")
            lines.append("BRAND BRIEF:")
            lines.extend(brand_lines)

    # CULTURAL CONTEXT — included near the END of the prompt so the LLM
    # reads region descriptors right before producing the plan. Empty when
    # region is "none" (culture-agnostic video — no over-constraining).
    if cultural_context is not None:
        try:
            block = cultural_context.to_prompt_block()
            if block:
                lines.append("")
                lines.append(block)
        except Exception:
            pass

    # TEMPLATE CATALOG — live list of registered shot templates. Placed at
    # the END so it's the most recent thing the LLM sees before emitting
    # `template_id`. Combined with a hard whitelist constraint to stop
    # the ShotPlanner from hallucinating IDs like `image_hero_standard`
    # or `process_3_steps` (seen in the Chanakya run).
    if template_catalog_md:
        lines.append("")
        lines.append(template_catalog_md)
    if valid_template_ids:
        # Hard whitelist — restated explicitly. Catalog markdown alone has
        # proven insufficient (LLMs default to plausible-sounding training-
        # data IDs). Listing the allowed values verbatim corrects it.
        _allow_list = ", ".join(f'"{tid}"' for tid in valid_template_ids)
        lines.append("")
        lines.append(
            f"**HARD CONSTRAINT**: `template_id` MUST be one of [{_allow_list}] or "
            f"`null`. Do NOT invent template IDs. If no listed template fits, "
            f"set `template_id: null` and the shot renders via the standard "
            f"per-shot LLM path."
        )

    lines.append("")
    lines.append("Output the JSON now. No commentary, no fences, no preamble.")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Parsing + normalization
# ─────────────────────────────────────────────────────────────────────────────

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def _strip_fences(text: str) -> str:
    """Strip ```json ... ``` fences the LLM sometimes adds despite instructions."""
    return _JSON_FENCE_RE.sub("", text).strip()


def _find_json_object(text: str) -> Optional[str]:
    """Locate the outermost {...} in `text` — tolerates LLM preamble/postamble."""
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


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        if isinstance(value, str):
            try:
                return int(value.strip())
            except (TypeError, ValueError):
                return default
        return default


def _word_count(text: str) -> int:
    return len([w for w in (text or "").split() if w.strip()])


def _normalize_shot(raw: Dict[str, Any], idx: int) -> Dict[str, Any]:
    """Coerce one raw LLM shot into the canonical shape, applying lazy defaults.

    Out-of-vocabulary fields fall back to safe defaults rather than raising —
    we'd rather degrade quality than fail planning. Downstream regen + post-
    render gates catch quality issues.
    """
    shot_type = str(raw.get("shot_type") or "").strip().upper()
    if not shot_type:
        shot_type = "TEXT_DIAGRAM"  # safest default

    intent_role = str(raw.get("intent_role") or "").strip().lower()
    if intent_role not in INTENT_ROLES:
        intent_role = "hook" if idx == 0 else "explanation"

    transition_in = str(raw.get("transition_in") or "").strip().lower()
    if transition_in not in TRANSITIONS:
        # KINETIC_TEXT/TITLE have non-negotiable defaults; everything else fades.
        if shot_type == "KINETIC_TEXT":
            transition_in = "cut"
        elif shot_type == "KINETIC_TITLE":
            transition_in = "zoom_in"
        else:
            transition_in = "fade"

    bg = str(raw.get("background_treatment") or "").strip().lower()
    if bg not in BACKGROUND_TREATMENTS:
        bg = SHOT_TYPE_BG_TREATMENT_DEFAULT.get(shot_type, "brand_solid")

    # Frame composition — where things sit in the frame. Same contract shape as
    # background_treatment: planner may declare it, unknown/absent falls back to
    # a per-shot-type default. Cross-shot variety is enforced later, over the
    # whole list, by assign_compositions().
    composition = normalize_composition(raw.get("composition"), shot_type)

    audio_policy = str(raw.get("audio_policy") or "").strip().lower()
    if audio_policy not in AUDIO_POLICIES:
        # Defensive: intrinsic-audio-capable types get intrinsic_only IF the
        # Director didn't say otherwise AND they have an intrinsic-audio hint
        # (ai_video_audio for AI_VIDEO_HERO, mute_tts_on_source_clips at run
        # level for SOURCE_CLIP — but we don't see run flags here, so default
        # to narration_only and let the AudioPolicyPlanner normalizer adjust).
        audio_policy = "narration_only"

    narration_brief = str(raw.get("narration_brief") or "").strip()
    # Contract: intrinsic_only shots have empty narration_brief (the clip's own
    # audio carries the beat). narration_over_clip is the OPPOSITE — the clip is
    # muted and the narrator speaks over it, so the brief is kept.
    if audio_policy == "intrinsic_only":
        narration_brief = ""

    duration = _coerce_float(raw.get("duration_estimate_s"), 0.0)
    if duration <= 0:
        # Estimate from brief word count at 150 wpm, fall back to 4s.
        if narration_brief:
            duration = _word_count(narration_brief) / (DEFAULT_WPM / 60.0)
        else:
            duration = 4.0
    duration = max(1.5, min(25.0, duration))

    out: Dict[str, Any] = {
        # Identity
        "shot_index": _coerce_int(raw.get("shot_index"), idx),
        "shot_type": shot_type,
        "intent_role": intent_role,
        # Narration (filled by NarrationWriter; narration_brief is the planner's intent)
        "narration_brief": narration_brief,
        "narration_text": "",  # NarrationWriter writes here
        # Audio
        "audio_policy": audio_policy,
        # Timing — start_time / end_time get derived after normalization
        "duration_estimate_s": round(duration, 2),
        # Visual presentation
        "background_treatment": bg,
        "composition": composition,
        "transition_in": transition_in,
        "overlay": bool(raw.get("overlay", False)),
    }

    # Pass-through fields when present
    for field in (
        "image_prompt",
        "video_query",
        "visual_description",
        "animation_strategy",
        "text_elements",
        "sync_points",
        "notes",
        "complexity_level",
        "template_id",
        "template_params",
        "semantic_accents",
        "ai_video_prompt",
        "ai_video_segments",
        "ai_video_duration_s",
        "ai_video_audio",
        "source_start",
        "source_end",
        # Which uploaded asset this shot shows. Without these in the
        # pass-through the planner's choice is silently dropped during
        # normalization and every clip shot falls back to asset 0.
        "image_index",
        "source_video_index",
        "role",
        "pacing_role",
        # Lesson mode: where the teacher sits for this section (lesson_mode.LAYOUTS).
        "teacher_layout",
        # DIALOGUE_SCENE (storybook/drama mode): spoken lines + scene staging.
        "dialogue",
        "scene_description",
        # Silent-character-clip flavor (drama redesign): what the cast member
        # DOES on screen while the narrator speaks over the shot.
        "action_description",
        "character_names",
        "scene_continuity",
        "emotional_beat",
        "time_of_day",
        # Narration-synced imagery (visual beats) — resolved to real
        # images/icons by the pipeline pre-pass before HTML generation.
        "support_visuals",
        "location",
        # Asset-request gate answers (assist): real user assets + figures.
        "user_asset_url",
        "user_asset_kind",
        "real_data",
    ):
        if field in raw and raw[field] is not None:
            out[field] = raw[field]

    if "support_visuals" in out:
        try:
            from support_visuals import normalize_support_visuals
            out["support_visuals"] = normalize_support_visuals(out["support_visuals"])
        except ImportError:
            pass  # keep raw list; the resolver normalizes defensively too
        if not out.get("support_visuals"):
            out.pop("support_visuals", None)

    return out


def _derive_shot_timings(shots: List[Dict[str, Any]]) -> None:
    """Walk shots in order, derive `start_time` / `end_time` from cumulative
    `duration_estimate_s`. Overlay shots inherit the timing of the prior
    non-overlay shot. Mutates shots in place.
    """
    cursor = 0.0
    last_non_overlay_start = 0.0
    last_non_overlay_end = 0.0
    for shot in shots:
        if shot.get("overlay"):
            # Overlays sit on top of the previous primary shot.
            shot["start_time"] = last_non_overlay_start
            shot["end_time"] = last_non_overlay_end
            continue
        dur = float(shot.get("duration_estimate_s") or 0.0)
        shot["start_time"] = round(cursor, 3)
        shot["end_time"] = round(cursor + dur, 3)
        last_non_overlay_start = shot["start_time"]
        last_non_overlay_end = shot["end_time"]
        cursor += dur


def _normalize_recurring_motifs(motifs: Any) -> List[Dict[str, str]]:
    """Coerce recurring_motifs into a list of {description, screen_position,
    when_visible} dicts. Drops malformed entries."""
    out: List[Dict[str, str]] = []
    if not isinstance(motifs, list):
        return out
    for m in motifs:
        if not isinstance(m, dict):
            continue
        desc = str(m.get("description") or "").strip()
        if not desc:
            continue
        out.append(
            {
                "description": desc,
                "screen_position": str(m.get("screen_position") or "").strip(),
                "when_visible": str(m.get("when_visible") or "every shot").strip(),
            }
        )
    return out


_MUSIC_MOOD_ENUM = frozenset({"default", "celebratory", "educational", "cinematic"})


def _normalize_music_plan(plan: Any) -> Optional[Dict[str, Any]]:
    """Coerce music_plan into the {overall_mood, overall_genre, chunks[]} shape
    consumed by music_generator. Returns None when the LLM omitted it or the
    payload is unrecoverable — caller falls back to `_build_default_music_plan`.

    Mirrors the Director's MUSIC_PLAN_EXTENSION contract; downstream code
    treats v2 Director output and v3 ShotPlanner output interchangeably.
    """
    if not isinstance(plan, dict):
        return None
    chunks_raw = plan.get("chunks")
    if not isinstance(chunks_raw, list) or not chunks_raw:
        return None
    chunks: List[Dict[str, Any]] = []
    for ch in chunks_raw:
        if not isinstance(ch, dict):
            continue
        prompt = str(ch.get("timestamped_prompt") or "").strip()
        if not prompt:
            continue
        try:
            start = float(ch.get("start_time") or 0.0)
            end = float(ch.get("end_time") or 0.0)
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        chunks.append(
            {
                "start_time": round(start, 3),
                "end_time": round(end, 3),
                "timestamped_prompt": prompt,
            }
        )
    if not chunks:
        return None
    return {
        "overall_mood": str(plan.get("overall_mood") or "").strip(),
        "overall_genre": str(plan.get("overall_genre") or "").strip(),
        "chunks": chunks,
    }


_BEAT_MAP_COLOR_ROLES = {"base", "brand", "accent", "warn", "good", "gold"}


def _normalize_beat_map(bm: Any) -> List[Dict[str, Any]]:
    """Preserve + sanitize the ShotPlanner's beat_map (the color/energy script).
    Each entry: from_shot/to_shot (ints), emotion (str), energy (float 0-1),
    color_role (brand-safe enum). Returns [] when absent."""
    if not isinstance(bm, list):
        return []
    out: List[Dict[str, Any]] = []
    for e in bm:
        if not isinstance(e, dict):
            continue
        try:
            fs = int(e.get("from_shot", e.get("shot_index", 0)))
            ts = int(e.get("to_shot", fs))
        except (TypeError, ValueError):
            continue
        energy = max(0.0, min(1.0, _coerce_float(e.get("energy"), 0.5)))
        role = str(e.get("color_role") or "base").strip().lower()
        if role not in _BEAT_MAP_COLOR_ROLES:
            role = "base"
        out.append({
            "from_shot": fs,
            "to_shot": max(fs, ts),
            "emotion": str(e.get("emotion") or "").strip(),
            "energy": round(energy, 2),
            "color_role": role,
        })
    return out


def _check_concept_conformance(plan: Dict[str, Any]) -> List[str]:
    """Deterministic conformance checks for the Phase-B gate: is the
    creative_concept complete and does the beat_map energy curve BUILD (not a
    flat metronome)? Returns a list of issue strings ([] = conformant). Pure +
    side-effect-free → unit-testable. Intentionally avoids fuzzy text-matching
    of the visual_metaphor / signature_device — a motif is visual, not a
    keyword, so that semantic check belongs to an LLM/vision judge, not regex."""
    issues: List[str] = []
    cc = plan.get("creative_concept") if isinstance(plan.get("creative_concept"), dict) else {}
    shots = plan.get("shots") if isinstance(plan.get("shots"), list) else []
    if not cc.get("controlling_idea"):
        issues.append("missing creative_concept.controlling_idea (decide the ONE thing this video argues)")
    if not cc.get("tonal_register"):
        issues.append("missing creative_concept.tonal_register")
    bm = plan.get("beat_map") if isinstance(plan.get("beat_map"), list) else []
    energies = [
        e.get("energy") for e in bm
        if isinstance(e, dict) and isinstance(e.get("energy"), (int, float))
    ]
    if len(energies) >= 2:
        if (max(energies) - min(energies)) < 0.2:
            issues.append("beat_map energy curve is flat (no build) — vary energy toward a climax and drop on holds/close")
    elif len(shots) >= 4 and not bm:
        issues.append("missing beat_map (the energy/color script) for a multi-section video")
    return issues


_TIME_JUMP_RE = re.compile(
    r"next (morning|day|evening|week|month)|the following|later that"
    r"|that (evening|night|afternoon)|hours later|days later"
    r"|weeks later|months later|meanwhile|elsewhere|back at",
    re.IGNORECASE,
)

# ~8-9s of natural speech at ~2.5 words/s. Above this a DIALOGUE_SCENE's lines
# cannot fit a single clip (the card caps spoken time at ~8s; Omni clips ≤10s).
_DIALOGUE_MAX_WORDS = 24


def _check_dialogue_conformance(plan: Dict[str, Any], dialogue_mode: str = "storybook") -> List[str]:
    """Deterministic contract checks for DIALOGUE_SCENE plans. Every prod
    dialogue defect traced to an LLM instruction with no code enforcement —
    this is the code enforcement. Returns issue strings ([] = conformant).
    Pure + side-effect-free → unit-testable."""
    issues: List[str] = []
    shots = plan.get("shots") if isinstance(plan.get("shots"), list) else []
    dlg = [
        s for s in shots
        if isinstance(s, dict) and str(s.get("shot_type") or "").upper() == "DIALOGUE_SCENE"
    ]
    if not dlg:
        return issues
    chars = [
        c for c in (plan.get("characters") or [])
        if isinstance(c, dict) and str(c.get("name") or "").strip()
    ]
    if not chars:
        issues.append(
            "DIALOGUE_SCENE shots present but the top-level `characters` cast array is "
            "missing/empty — emit it with a verbatim-reusable visual_description per character"
        )
    else:
        known = {str(c["name"]).strip().lower() for c in chars}
        missing = sorted({
            str(n).strip()
            for s in dlg for n in (s.get("character_names") or [])
            if str(n).strip() and str(n).strip().lower() not in known
        })
        if missing:
            issues.append(
                f"characters array is missing entries for: {missing} — every name in "
                "character_names must have a cast entry"
            )
    for s in dlg:
        idx = s.get("shot_index")
        cont = str(s.get("scene_continuity") or "").strip().lower()
        if cont not in ("continuous", "new"):
            issues.append(
                f"shot {idx}: DIALOGUE_SCENE must set scene_continuity to \"continuous\" "
                "(same moment+location as the previous dialogue shot) or \"new\""
            )
        scene = str(s.get("scene_description") or "")
        if cont == "continuous" and _TIME_JUMP_RE.search(scene):
            issues.append(
                f"shot {idx}: scene_continuity is \"continuous\" but scene_description "
                "implies a time/location jump — mark it \"new\""
            )
        words = sum(
            len(str(l.get("line") or "").split())
            for l in (s.get("dialogue") or []) if isinstance(l, dict)
        )
        if words > _DIALOGUE_MAX_WORDS:
            issues.append(
                f"shot {idx}: {words} words of dialogue cannot fit one clip — cut to "
                f"≤{_DIALOGUE_MAX_WORDS} words or split the scene into two continuous shots"
            )
    # No line may appear in TWO scenes. When a longer exchange is split
    # across continuous scenes, the planner/writer sometimes repeats the
    # boundary line — the viewer hears the same words twice across the cut.
    _seen_lines: Dict[str, Any] = {}
    for s in dlg:
        idx = s.get("shot_index")
        for l in (s.get("dialogue") or []):
            if not isinstance(l, dict):
                continue
            norm = re.sub(r"[^a-z0-9 ]", "", str(l.get("line") or "").lower()).strip()
            if len(norm.split()) < 3:
                continue  # short interjections ("yes", "okay") may repeat
            if norm in _seen_lines and _seen_lines[norm] != idx:
                issues.append(
                    f"shots {_seen_lines[norm]} and {idx}: the line "
                    f"\"{str(l.get('line'))[:60]}\" appears in BOTH scenes — every "
                    "line must be spoken exactly once; continue the exchange with "
                    "NEW words, never repeat across a cut"
                )
            else:
                _seen_lines[norm] = idx

    if str(dialogue_mode or "").lower() == "drama" and len(dlg) >= 2:
        # Ends-on-despair detector: the arc must MOVE. Compare the beat_map
        # emotions covering the first and last dialogue scenes when available.
        bm = plan.get("beat_map") if isinstance(plan.get("beat_map"), list) else []

        def _emotion_for(shot_idx: Any) -> str:
            try:
                si = int(shot_idx)
            except (TypeError, ValueError):
                return ""
            for seg in bm:
                try:
                    if int(seg.get("from_shot")) <= si <= int(seg.get("to_shot")):
                        return str(seg.get("emotion") or "").strip().lower()
                except (TypeError, ValueError):
                    continue
            return ""

        first_e = _emotion_for(dlg[0].get("shot_index"))
        last_e = _emotion_for(dlg[-1].get("shot_index"))
        if first_e and last_e and first_e == last_e:
            issues.append(
                f"drama arc does not move: opening and closing dialogue scenes share the same "
                f"beat_map emotion ('{first_e}') — the resolution must land on a DIFFERENT "
                "emotional beat than the setup"
            )
    return issues


def _normalize_creative_concept(cc: Any) -> Dict[str, str]:
    """Preserve the ShotPlanner's top-level creative_concept (controlling idea,
    tonal register, emotional arc, visual metaphor, signature device, what-to-avoid).
    Returns {} when absent so every downstream consumer can treat it as optional."""
    if not isinstance(cc, dict):
        return {}
    out: Dict[str, str] = {}
    for k in (
        "controlling_idea", "tonal_register", "emotional_arc",
        "visual_metaphor", "signature_device", "what_to_avoid",
    ):
        v = cc.get(k)
        if v:
            out[k] = str(v).strip()
    return out


def normalize_shot_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Apply normalization + lazy defaults to a parsed shot plan. Idempotent.

    Use this both inside `plan_shots()` (right after LLM response) and from
    the resume path (when a checkpoint-loaded plan needs the same defaults).
    """
    raw_shots = plan.get("shots") if isinstance(plan.get("shots"), list) else []
    normalized: List[Dict[str, Any]] = []
    for i, rs in enumerate(raw_shots):
        if not isinstance(rs, dict):
            continue
        normalized.append(_normalize_shot(rs, i))

    # Structural variety pass. The preamble has asked for "a distinct
    # composition every shot" in prose for months and still produced
    # centre-stacked frames throughout, so the no-repeat and centred-quota
    # rules are applied here over the whole list instead of hoped for.
    assign_compositions(normalized)

    _derive_shot_timings(normalized)

    audio_mood_raw = str(plan.get("audio_mood") or "").strip().lower()
    audio_mood = audio_mood_raw if audio_mood_raw in _MUSIC_MOOD_ENUM else ""

    return {
        "shots": normalized,
        "creative_concept": _normalize_creative_concept(plan.get("creative_concept")),
        "beat_map": _normalize_beat_map(plan.get("beat_map")),
        "continuity_notes": str(plan.get("continuity_notes") or "").strip(),
        "recurring_motifs": _normalize_recurring_motifs(plan.get("recurring_motifs")),
        "music_plan": _normalize_music_plan(plan.get("music_plan")),
        "audio_mood": audio_mood,
        # DIALOGUE_SCENE cast — [{name, visual_description, voice_hint}].
        # The verbatim visual_description block is what keeps a character
        # looking the same across independently generated clips.
        "characters": _normalize_characters(plan.get("characters")),
        "asset_requests": _normalize_asset_requests(plan.get("asset_requests")),
    }


def _normalize_asset_requests(raw: Any) -> List[Dict[str, Any]]:
    """Coerce the planner's agent-initiated asks. Empty when absent/malformed."""
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for i, r in enumerate(raw[:4]):
        if not isinstance(r, dict):
            continue
        kind = str(r.get("kind") or "").strip().lower()
        ask = str(r.get("ask") or "").strip()
        if kind not in ("screenshot", "photo", "data", "inspiration") or not ask:
            continue
        item: Dict[str, Any] = {
            "index": len(out),
            "kind": kind,
            "ask": ask[:300],
            "why": str(r.get("why") or "").strip()[:200],
        }
        try:
            item["shot_index"] = int(r.get("shot_index"))
        except (TypeError, ValueError):
            item["shot_index"] = None
        if kind == "inspiration":
            opts = [str(o).strip()[:120] for o in (r.get("options") or []) if str(o).strip()]
            item["options"] = opts[:3]
            if not item["options"]:
                continue  # an inspiration ask without options is useless
        out.append(item)
    return out


def _normalize_characters(raw: Any) -> List[Dict[str, str]]:
    """Coerce the plan-level cast list. Empty when absent/malformed."""
    out: List[Dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    for c in raw[:6]:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        out.append({
            "name": name[:60],
            "visual_description": str(c.get("visual_description") or "").strip()[:500],
            "voice_hint": str(c.get("voice_hint") or "").strip()[:120],
        })
    return out


def _parse_shot_plan(text: str) -> Dict[str, Any]:
    """Parse the LLM response into a normalized shot plan. Tries strict JSON
    first, then strips fences, then extracts the outermost {...} block.
    Raises ShotPlanError when no usable plan is recoverable."""
    candidates: List[str] = [text, _strip_fences(text)]
    extracted = _find_json_object(text)
    if extracted:
        candidates.append(extracted)

    last_err: Optional[Exception] = None
    for cand in candidates:
        cand = (cand or "").strip()
        if not cand:
            continue
        try:
            data = json.loads(cand)
        except Exception as err:
            last_err = err
            continue
        if not isinstance(data, dict):
            continue
        if not isinstance(data.get("shots"), list) or not data.get("shots"):
            continue
        return normalize_shot_plan(data)

    raise ShotPlanError(
        f"ShotPlanner produced no usable plan. Last parse error: {last_err}. "
        f"Response head: {text[:200]!r}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def plan_shots(
    *,
    prompt: str,
    target_duration_s: float,
    llm_chat: Callable[..., Tuple[str, Dict[str, Any]]],
    model: Optional[str] = None,
    target_audience: str = "General/Adult",
    language: str = "English",
    content_type: str = "VIDEO",
    tier: str = "premium",
    image_ratio: str = "16:9",
    visual_preferences: Optional[Dict[str, Any]] = None,
    reference_assets: Optional[List[Dict[str, Any]]] = None,
    brand_brief: Optional[Dict[str, Any]] = None,
    brand_system_prompt: Optional[str] = None,
    ai_video_enabled: bool = False,
    ai_video_audio_enabled: bool = False,
    ai_video_cost_cap_usd: float = 1.50,
    ai_video_per_clip_usd: float = 0.24,
    source_clip_available: bool = False,
    dialogue_scenes_enabled: bool = False,
    dialogue_mode: str = "storybook",
    saved_cast: Optional[List[Dict[str, Any]]] = None,
    asset_asks_enabled: bool = False,
    article_screenshots: Optional[List[Dict[str, Any]]] = None,
    input_images: Optional[List[Dict[str, Any]]] = None,
    subject_domain: Optional[str] = None,
    cultural_context: Any = None,
    template_catalog_md: Optional[str] = None,
    valid_template_ids: Optional[List[str]] = None,
    lesson: Optional[Dict[str, Any]] = None,
    include_music_plan: bool = False,
    music_plan_target_duration_s: Optional[float] = None,
    enforce_concept: bool = True,
    verbalized_sampling: bool = False,
    temperature: float = 0.6,
    max_tokens: int = 16000,
) -> Dict[str, Any]:
    """Plan the shots for a video.

    `llm_chat` is a callable matching `OpenRouterClient.chat(...)`:
        (messages, model=..., temperature=..., max_tokens=..., response_format=...)
        -> (text, usage)
    Passed in rather than instantiated here so callers can inject test doubles
    and so this module stays free of network deps.

    When `include_music_plan=True`, the Director's MUSIC_PLAN_EXTENSION is
    appended to the system prompt and ShotPlanner emits a top-level
    `music_plan` (mood/genre/timestamped chunks) + optional `audio_mood`.
    Mirrors the v2 Director contract so downstream music_generator code
    treats both plans interchangeably.

    Returns:
      {
        "shots":             [<normalized shot dicts>],   # never empty on success
        "continuity_notes":  "<≤200 chars>",
        "recurring_motifs":  [<normalized motif dicts>],
        "music_plan":        {<mood, genre, chunks>} | None,
        "audio_mood":        "<default|celebratory|educational|cinematic|"">",
        "usage":             {<llm token usage>},
        "raw":               "<raw llm response>",        # for telemetry / debug
        "wpm":               150.0,
      }

    Raises:
      ShotPlanError on unrecoverable parse failure. The caller MUST handle
      this — during the v2→v3 transition, fall back to the legacy
      ScriptGenerator+Director path.
    """
    if not prompt or not prompt.strip():
        raise ShotPlanError("ShotPlanner requires a non-empty prompt")
    if target_duration_s <= 0:
        raise ShotPlanError(
            f"ShotPlanner requires positive target_duration_s, got {target_duration_s!r}"
        )

    user_prompt = build_shot_planner_user_prompt(
        prompt=prompt,
        target_duration_s=target_duration_s,
        target_audience=target_audience,
        language=language,
        content_type=content_type,
        tier=tier,
        image_ratio=image_ratio,
        visual_preferences=visual_preferences,
        reference_assets=reference_assets,
        brand_brief=brand_brief,
        ai_video_enabled=ai_video_enabled,
        ai_video_audio_enabled=ai_video_audio_enabled,
        ai_video_cost_cap_usd=ai_video_cost_cap_usd,
        ai_video_per_clip_usd=ai_video_per_clip_usd,
        source_clip_available=source_clip_available,
        dialogue_scenes_enabled=dialogue_scenes_enabled,
        dialogue_mode=dialogue_mode,
        saved_cast=saved_cast,
        asset_asks_enabled=asset_asks_enabled,
        article_screenshots=article_screenshots,
        input_images=input_images,
        subject_domain=subject_domain,
        cultural_context=cultural_context,
        template_catalog_md=template_catalog_md,
        valid_template_ids=valid_template_ids,
        lesson=lesson,
    )

    system_content = SHOT_PLANNER_SYSTEM_PROMPT
    if lesson:
        # Lesson pacing replaces the reel rhythm rule (2.5-4 s body shots,
        # 12-shot cap) — that rule cannot express a 10-minute lesson.
        from lesson_mode import planner_system_prompt
        system_content = planner_system_prompt(system_content)
    if verbalized_sampling:
        system_content = system_content + _VERBALIZED_SAMPLING_BLOCK
    if include_music_plan:
        # Append the Director's MUSIC_PLAN_EXTENSION verbatim so v2 Director
        # and v3 ShotPlanner produce music_plan payloads under the same
        # contract — music_generator treats them interchangeably. The chunk
        # budget reminder goes in the user prompt instead of the system block
        # so it stays per-run.
        try:
            from director_prompts import MUSIC_PLAN_EXTENSION  # type: ignore
        except ImportError:
            MUSIC_PLAN_EXTENSION = ""  # type: ignore
        if MUSIC_PLAN_EXTENSION:
            system_content = system_content + MUSIC_PLAN_EXTENSION
            _mp_target = float(music_plan_target_duration_s or target_duration_s)
            _chunk_cap = 180.0
            _chunks_needed = max(1, int(-(-_mp_target // _chunk_cap)))  # ceil
            user_prompt = (
                user_prompt
                + f"\n\nMUSIC PLAN REMINDER: total narration ≈ {_mp_target:.1f}s. "
                f"Emit `music_plan.chunks` with {_chunks_needed} chunk(s) tiling "
                f"[0.0, {_mp_target:.1f}] with no gaps. Each chunk's "
                f"`timestamped_prompt` is one prose string with `[mm:ss]` markers "
                f"(chunk-relative; first marker `[00:00]`). Every prompt must "
                f"contain \"no vocals, no lyrics\". Match the music to the shots "
                f"you actually planned (instrumentation + tempo + mood derive "
                f"from the shot palette/energy, not a default warm-piano bed)."
            )

    # Brand direction (kit system_prompt or per-video override) goes LAST so it
    # reads as the final, authoritative brand layer — the block itself
    # subordinates to the JSON output contract so it can't break parsing.
    if brand_system_prompt:
        try:
            from director_prompts import build_brand_direction_block  # type: ignore
            system_content = system_content + build_brand_direction_block(brand_system_prompt)
        except Exception:
            system_content = system_content + (
                "\n\n## BRAND DIRECTION (apply throughout; output format still wins)\n"
                + str(brand_system_prompt).strip() + "\n"
            )

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_prompt},
    ]
    text, usage = llm_chat(
        messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    try:
        parsed = _parse_shot_plan(text or "")
    except ShotPlanError as _fmt_err:
        # Reasoning models sometimes answer with pure analysis prose and no
        # JSON at all ("Let me analyze this request carefully…"), despite
        # response_format. Prod: this failed BOTH attempts and dropped the
        # whole run to the v2 path. A format-corrective turn is far cheaper
        # (and far more likely to work) than re-running the same prompt,
        # which just reproduces the same behaviour.
        print(f"   ⚠️ ShotPlanner returned non-JSON ({_fmt_err}) — retrying with a format-corrective turn")
        # Asking again in words does not work on a model that has decided to
        # think out loud: prod has seen the corrective turn answer "The user
        # wants a valid JSON response. Let me carefully construct..." and burn
        # its whole budget reasoning, so nothing parses and the run drops to v2.
        #
        # Prefill instead of instruct. A trailing assistant turn containing "{"
        # leaves the model mid-object with no grammatical way back into prose,
        # which is far more reliable than any wording of "reply with JSON only".
        # The brace is ours, so it is prepended before parsing.
        _fix_messages = messages + [
            {"role": "user", "content": (
                "That response was not valid JSON. Do NOT explain, analyze, or "
                "add any commentary. Reply with ONE JSON object and nothing "
                "else — first character '{', last character '}' — containing "
                "the `shots` array (and the other top-level keys) exactly as "
                "specified above."
            )},
            {"role": "assistant", "content": "{"},
        ]
        _t2, _u2 = llm_chat(
            _fix_messages,
            model=model,
            temperature=0.1,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        _t2 = _t2 or ""
        # Some providers echo the prefill, others continue from it. Only add the
        # brace back when the continuation did not bring its own.
        _joined = _t2 if _t2.lstrip().startswith("{") else "{" + _t2
        try:
            parsed = _parse_shot_plan(_joined)
        except ShotPlanError:
            # Fall back to the raw continuation in case the prefill was echoed
            # in a shape the join mangled.
            parsed = _parse_shot_plan(_t2)
        text = _t2 or text
        for _k in ("prompt_tokens", "completion_tokens", "total_tokens"):
            try:
                usage[_k] = int((usage or {}).get(_k, 0) or 0) + int((_u2 or {}).get(_k, 0) or 0)
            except Exception:
                pass

    # Validation pass — strip any `template_id` the LLM invented despite the
    # whitelist constraint. Catches `image_hero_standard` / `process_3_steps`
    # style hallucinations BEFORE they reach the composer (where they'd just
    # log "unknown template_id" and fall back to LLM, costing tokens).
    if valid_template_ids is not None:
        _scrub_invalid_template_ids(parsed["shots"], set(valid_template_ids))

    usage = usage or {}

    # ── Conformance gate (Phase B) ──────────────────────────────────────────
    # Verify the plan serves its own creative_concept and that the beat_map
    # energy curve BUILDS (not a flat metronome). Dialogue runs additionally
    # get the DIALOGUE_SCENE contract lint (cast present, scene_continuity,
    # line budgets, arc movement) regardless of tier — every one of its rules
    # exists because a prod video shipped broken without it. On a concrete
    # structural miss, fire ONE corrective re-plan. Bounded, guarded,
    # ship-original-on-regression.
    # A lesson is structured hook → concepts → worked example → recap; the
    # concept contract's "energy RISES toward the climax" rule would push it
    # back toward reel structure, so lessons skip it.
    if lesson:
        enforce_concept = False

    def _conformance_issues(_p: Dict[str, Any]) -> List[str]:
        out: List[str] = []
        if enforce_concept:
            out += _check_concept_conformance(_p)
        if dialogue_scenes_enabled:
            out += _check_dialogue_conformance(_p, dialogue_mode)
        return out

    if enforce_concept or dialogue_scenes_enabled:
        _issues = _conformance_issues(parsed)
        if _issues:
            try:
                _corrective = (
                    "Your plan violates these required contracts:\n- "
                    + "\n- ".join(_issues)
                    + "\n\nRevise the FULL plan JSON: keep the same shot count and durations unless a "
                    "change is required, but make every shot serve the controlling_idea, ensure the "
                    "beat_map covers every shot with an energy curve that RISES toward the climax and "
                    "DROPS on holds/close, and fill any missing creative_concept fields. Return the "
                    "same JSON shape — first char '{', last char '}'."
                )
                _messages2 = messages + [
                    {"role": "assistant", "content": (text or "")[:6000]},
                    {"role": "user", "content": _corrective},
                ]
                _text2, _usage2 = llm_chat(
                    _messages2, model=model, temperature=temperature,
                    max_tokens=max_tokens, response_format={"type": "json_object"},
                )
                # The re-plan's tokens were spent whether or not it is kept (or
                # even parses) — merge them BEFORE the accept decision. They
                # used to be merged only on accept, so a rejected re-plan was
                # never billed.
                for _k in ("prompt_tokens", "completion_tokens"):
                    usage[_k] = int(usage.get(_k, 0) or 0) + int((_usage2 or {}).get(_k, 0) or 0)
                _parsed2 = _parse_shot_plan(_text2 or "")
                if valid_template_ids is not None:
                    _scrub_invalid_template_ids(_parsed2["shots"], set(valid_template_ids))
                # Accept the revision only if it kept the shots AND resolved ≥1 issue.
                if (
                    _parsed2.get("shots")
                    and len(_parsed2["shots"]) >= max(1, len(parsed["shots"]) - 1)
                    and len(_conformance_issues(_parsed2)) < len(_issues)
                ):
                    parsed = _parsed2
            except Exception:
                pass  # non-fatal — keep the original plan

    if lesson:
        from lesson_mode import apply_layouts
        _layout_counts = apply_layouts(parsed["shots"], lesson)
        print(f"   🧑‍🏫 Lesson plan: {len(parsed['shots'])} sections, teacher layouts {_layout_counts}")

    return {
        "shots": parsed["shots"],
        "creative_concept": parsed.get("creative_concept") or {},
        "beat_map": parsed.get("beat_map") or [],
        "continuity_notes": parsed["continuity_notes"],
        "recurring_motifs": parsed["recurring_motifs"],
        "music_plan": parsed.get("music_plan"),
        "audio_mood": parsed.get("audio_mood", ""),
        # DIALOGUE_SCENE cast + agent asset asks — _parse_shot_plan normalizes
        # both, but this return dict used to DROP them, which silently blanked
        # the dialogue cast (prod: characters:[] on every v3 run) and starved
        # the asset-request gate. Keep them flowing.
        "characters": parsed.get("characters") or [],
        "asset_requests": parsed.get("asset_requests") or [],
        "usage": _with_total_tokens(usage),
        "raw": text or "",
        "wpm": DEFAULT_WPM,
    }


def _with_total_tokens(usage: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """`usage` with total_tokens = prompt + completion (the billing contract:
    a provider that omits the total, or a merge that skipped it, must not hide
    the tokens from the stage's `total_tokens > 0` billing gate)."""
    out = dict(usage or {})
    try:
        out["total_tokens"] = int(out.get("prompt_tokens", 0) or 0) + int(out.get("completion_tokens", 0) or 0)
    except (TypeError, ValueError):
        pass
    return out


def _scrub_invalid_template_ids(
    shots: List[Dict[str, Any]],
    valid_ids: set,
) -> None:
    """Mutate shots in place: clear any `template_id` not in `valid_ids`.

    Mirror of the run-time check in `shot_template_composer.compose` — but
    catches the hallucinated IDs at planner-output time so the composer
    never has to log "unknown template_id". The shot falls through to the
    per-shot LLM path with no further intervention.

    When `valid_ids` is empty, this is a no-op (treat "unknown" as "skip
    validation" rather than "reject everything" — defensive).
    """
    if not valid_ids:
        return
    invalid_seen: List[str] = []
    for shot in shots:
        tid = shot.get("template_id")
        if isinstance(tid, str) and tid.strip() and tid not in valid_ids:
            invalid_seen.append(tid)
            # Strip both template_id and template_params — they're useless
            # without each other and the composer won't touch the shot.
            shot["template_id"] = None
            shot.pop("template_params", None)
    if invalid_seen:
        # Deduped, capped — useful for diagnostics without flooding the log.
        _unique = sorted(set(invalid_seen))
        print(
            f"   ⚠️ ShotPlanner emitted {len(invalid_seen)} invalid template_id(s) "
            f"(stripped to null): {_unique[:5]}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Smoke test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Standalone parse smoke test — no LLM required.
    fake_response = json.dumps(
        {
            "shots": [
                {
                    "shot_index": 0,
                    "shot_type": "KINETIC_TITLE",
                    "intent_role": "hook",
                    "narration_brief": "Open with a bold claim about Vacademy x Edzumo partnership.",
                    "audio_policy": "narration_only",
                    "duration_estimate_s": 4.5,
                    "transition_in": "zoom_in",
                    "background_treatment": "brand_solid",
                    "text_elements": ["VACADEMY × EDZUMO", "INDUSTRY-READY LEARNING"],
                },
                {
                    "shot_index": 1,
                    "shot_type": "VIDEO_HERO",
                    "intent_role": "setup",
                    "narration_brief": "Show the kind of learners we serve.",
                    "audio_policy": "narration_only",
                    "duration_estimate_s": 3.0,
                    "transition_in": "fade",
                    "background_treatment": "media_hero",
                    "video_query": "diverse college students working on laptops",
                },
                {
                    "shot_index": 2,
                    "shot_type": "PRODUCT_HERO",
                    "intent_role": "cta",
                    "narration_brief": "Wrap with the joint offering — confident, brand-forward.",
                    "audio_policy": "narration_only",
                    "duration_estimate_s": 5.0,
                    "transition_in": "fade",
                    "background_treatment": "brand_gradient",
                    "image_prompt": "stylised handshake icon isolated on transparent, clean edges",
                    "role": "product_proof",
                },
            ],
            "continuity_notes": "Brand solid throughout except media_hero in middle; logo top-right.",
            "recurring_motifs": [
                {
                    "description": "Vacademy V monogram, orange #FF7A1A on transparent",
                    "screen_position": "top-right, 64px from each edge, 48px tall",
                    "when_visible": "every shot except media_hero",
                }
            ],
        }
    )
    plan = _parse_shot_plan(fake_response)
    print(json.dumps(plan, indent=2))
    assert len(plan["shots"]) == 3
    assert plan["shots"][0]["shot_type"] == "KINETIC_TITLE"
    assert plan["shots"][0]["start_time"] == 0.0
    assert plan["shots"][0]["end_time"] == 4.5
    assert plan["shots"][1]["start_time"] == 4.5
    assert plan["shots"][2]["start_time"] == 7.5
    assert plan["recurring_motifs"][0]["description"].startswith("Vacademy")
    print("\nshot_planner.py smoke test passed.")
