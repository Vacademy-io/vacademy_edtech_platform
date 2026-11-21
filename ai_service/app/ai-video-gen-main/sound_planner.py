"""
Sound Planner — derives per-shot sound cues from the finished Director plan,
skill composer output, and narration emphasis signals. No LLM calls.

Design:
  1. Build a SOUND PALETTE once per video — 3-4 variations per role for
     variety. Topic-biased selection from script keywords (money → coins).
  2. Place cues at structural moments (transitions, reveals, emphasis)
     with subtle timing offsets for a natural feel.
  3. Use low volumes so sounds are background texture, not foreground.
  4. Respect global budgets so even a 30-shot video stays controlled.

The Director does NOT see sound information. Everything is derived from
signals the Director already produced for visual reasons.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

from sound_catalog import SoundCatalog, load_catalog


# ---------------------------------------------------------------------------
# Palette roles — the sonic vocabulary for one video
# ---------------------------------------------------------------------------
# Each video pre-selects ONE file for each of these roles. Every cue in the
# video draws from this fixed set so the viewer hears the same whoosh on
# every transition, the same chime on every reveal, etc.
PALETTE_ROLES = [
    "transition_whoosh",
    # Required by Rule D's riser-into-climax (marketing/bold) — without this
    # entry the palette never carries the role and the riser silently drops.
    "transition_riser",
    "impact",
    "ui_chime",
    "ui_click",
    "data_reveal",
    "ui_positive",
    # Mapped by _ACTION_TO_ROLE (error/fail events) but was missing here.
    "ui_negative",
]

# Synonym map: bridges natural-language words in the script to
# tag-style words in sound descriptions. For example, a script about
# "money management" produces the keyword "money" which alone won't
# match description "FOLEY, COINS, DROP" — but the synonym "coin" will.
TOPIC_SYNONYMS: Dict[str, List[str]] = {
    "money":       ["coin", "cash", "register", "dollar"],
    "finance":     ["coin", "cash", "money", "register"],
    "budget":      ["coin", "cash", "money"],
    "payment":     ["coin", "cash", "register"],
    "sports":      ["ball", "whistle", "crowd", "stadium"],
    "basketball":  ["basketball", "bounce", "ball"],
    "football":    ["ball", "whistle", "crowd"],
    "cricket":     ["ball", "bat", "crowd"],
    "volleyball":  ["ball", "whistle"],
    "cooking":     ["kitchen", "sizzle", "chop", "pan", "timer"],
    "food":        ["kitchen", "chop", "bite", "chew"],
    "science":     ["laboratory", "beaker", "bubble", "science"],
    "chemistry":   ["laboratory", "beaker", "bubble"],
    "physics":     ["impact", "collision", "force"],
    "water":       ["water", "splash", "drip", "rain"],
    "nature":      ["bird", "water", "wind", "rain", "forest"],
    "fire":        ["fire", "flame", "blaze"],
    "technology":  ["digital", "electronic", "computer", "click", "beep"],
    "coding":      ["keyboard", "type", "click", "digital"],
    "gaming":      ["arcade", "game", "8 bit", "retro"],
    "music":       ["musical", "instrument", "melody", "chord"],
    "bell":        ["bell", "chime", "ring"],
    "magic":       ["magic", "spell", "wand", "sparkle"],
    "space":       ["sci fi", "space", "laser"],
    "military":    ["gun", "explosion", "warfare"],
    "construction":["hammer", "drill", "saw", "construction"],
    "office":      ["paper", "stapler", "keyboard", "mouse"],
    "school":      ["bell", "chime", "pencil", "paper"],
}


# ---------------------------------------------------------------------------
# DEMOLISHED 2026-05: SHOT_TYPE_CUE + _FAMILY tables removed.
#
# Old behavior: every shot got an automatic signature cue (e.g. VIDEO_HERO
# → transition_whoosh at t=0), and every cross-family shot boundary got
# a pre-roll whoosh. Net effect: 10+ whooshes in a 53s video, with sound
# placed because the timeline said "cut here", not because anything on
# screen actually made a sound.
#
# New behavior: sound effects fire ONLY when the visual layer emits an
# event that a real-world version would produce sound for (button click,
# typewriter, counter tick, drawn underline, etc.). Events come from
# two sources:
#   1. Director's per-shot `sync_points[*].action` text (B1, mapped to
#      role via _ACTION_TO_ROLE below).
#   2. GSAP timeline scanner that parses each shot's generated HTML/JS
#      and emits cues on actual on-screen animations (Stage 2 — pipeline
#      attaches these as `entry["_sfx_events"]` before plan_sounds runs).
#
# If neither source emits an event for a shot, that shot is silent.
# That's the design — silence is the correct sound for "nothing audible
# happened on screen." We do NOT add filler cues to mark transitions.
# ---------------------------------------------------------------------------

_SHORT_SHOT = 2.0
_MIN_CUE_GAP = 0.30

# Density restraint — what separates "designed" from "every cut has a whoosh."
# Pro mixes leave negative space; consecutive cues within a tight window read
# as cheap. Density is tuned per-mood by `_DENSITY_TARGETS`:
#   - "max_in_window" / "_DENSITY_WINDOW_S": no more than N cues in any rolling
#     window of W seconds. Dense modes allow more.
#   - "min_avg_gap_s": after the window pass, drop the lowest-priority cues
#     until total_cues * min_avg_gap_s <= video_duration_s.
#
# Transition cues (role == "transition_whoosh"/"transition_riser") are protected
# from drops — they're tied to cuts. Other roles are dropped first.
_DENSITY_WINDOW_S = 5.0
# Retuned 2026-05 (second pass) after the auto-transition rules were
# demolished. Density was originally a defense against transition-spam
# in the old "whoosh on every cut" regime; with the new event-driven
# planner (GSAP scanner emits only audibility-worthy events, capped to
# ~6 per shot), density's main job is now ONLY to prevent runaway
# stacks in pathological cases (e.g. typewriter + 4 staggered reveals
# in a 1s window).
#
# Headline change: scanner-emitted events are TRUSTED. We protect all
# scanner-emitted cues from stage-2 drops; only true cluster-busts
# (too many cues in a tight window) get trimmed.
_DENSITY_TARGETS: Dict[str, Dict[str, float]] = {
    "sparse":      {"max_in_window": 2, "min_avg_gap_s": 4.0},
    "educational": {"max_in_window": 3, "min_avg_gap_s": 3.0},
    "normal":      {"max_in_window": 4, "min_avg_gap_s": 2.0},
    "default":     {"max_in_window": 4, "min_avg_gap_s": 2.0},
    "celebratory": {"max_in_window": 4, "min_avg_gap_s": 2.0},
    "cinematic":   {"max_in_window": 4, "min_avg_gap_s": 2.0},
    "dense":       {"max_in_window": 5, "min_avg_gap_s": 1.5},
}

# Stage 2 protected-cue priority: now LOWER (was 40) because the
# scanner pre-filters for meaningfulness. Every scanner-emitted cue
# represents a real on-screen event we want to hear; only drop them
# when drastically over budget.
_STAGE2_PRIORITY_FLOOR = 20


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def plan_sounds(
    entries: List[Dict[str, Any]],
    shots: List[Dict[str, Any]],
    words: List[Dict[str, Any]],
    tier_config: Dict[str, Any],
    video_id: str = "",
    catalog: Optional[SoundCatalog] = None,
    script_text: str = "",
    visual_style_mode: Optional[str] = None,
) -> None:
    """Mutate `entries` in place, adding `sound_cues` to each.

    The palette is built once from the script topic and reused for every
    cue in the video — same whoosh on every transition, same chime on
    every reveal. This gives the video a consistent sonic identity.
    """
    if not tier_config.get("sound_enabled"):
        for e in entries:
            e["sound_cues"] = []
        return

    cat = catalog if catalog is not None else load_catalog()
    if cat is None:
        for e in entries:
            e["sound_cues"] = []
        return

    # ── Step 1: build the video's sound palette (one file per role) ──
    palette = _build_sound_palette(cat, video_id, script_text)

    # ── Step 2: index Director shots for sync_point lookup ──
    shots_by_index: Dict[int, Dict[str, Any]] = {}
    for s in shots:
        try:
            idx = int(s.get("shot_index", 0))
        except (TypeError, ValueError):
            idx = 0
        shots_by_index[idx] = s

    # Per-shot cap (`sound_max_cues_per_shot` in tier_config) is no longer
    # honored as a hard ceiling. The video-level cap + _MIN_CUE_GAP + the
    # planner's own role-selection logic do the anti-clutter work. The
    # _SHORT_SHOT clamp below still applies: any shot < _SHORT_SHOT (1.8s
    # by default) gets at most 1 cue regardless of content, so a 0.5s
    # transition doesn't get 3 chimes stacked into it. The tier_config
    # field is read for back-compat logging only.
    _legacy_per_shot_cap = tier_config.get("sound_max_cues_per_shot")
    if _legacy_per_shot_cap is not None:
        # Silent ignore — no warning spam, just record that the legacy
        # value was present in case ops needs to audit.
        pass
    max_per_video: int = int(tier_config.get("sound_max_cues_per_video", 20))

    total_cues = 0

    ordered = sorted(entries, key=lambda e: float(e.get("start", 0)))

    # Initialize sound_cues on every entry up front so transition cues for
    # shot N can be appended to entry N-1 *after* it has already been
    # finalized. The loop appends to its own entry's list, and the next
    # iteration's transition rule appends to the previous entry's list.
    for e in ordered:
        e["sound_cues"] = []

    for entry in ordered:
        if total_cues >= max_per_video:
            continue

        shot_idx = int(entry.get("index", 0))
        director_shot = shots_by_index.get(shot_idx, {})
        start_time = float(entry.get("start", 0.0))
        end_time = float(entry.get("end", start_time + 1.0))
        duration = max(0.01, end_time - start_time)

        cues: List[Dict[str, Any]] = []

        # ── Rule A: GSAP-scanner events (visual-layer-driven, primary) ────
        # The pipeline runs the GSAP scanner over each shot's generated
        # HTML/JS BEFORE plan_sounds; it attaches a list of detected
        # animation events to entry["_sfx_events"]. Each event:
        #   {t: <relative-to-shot-start>, role: <sfx role>, volume_mul: f,
        #    label: "typewriter"|"counter_tick"|"slide_in"|"underline_draw"
        #    |"button_appear"|"scale_pulse"|...}
        # Source of truth for "this shot has a sound-worthy event."
        gsap_events = entry.get("_sfx_events") or []
        for ev in gsap_events:
            role = (ev.get("role") or "").strip().lower()
            if not role or role not in palette:
                continue
            try:
                t = float(ev.get("t", 0.0))
            except (TypeError, ValueError):
                continue
            if t < 0 or t > duration:
                continue
            cue = _cue_from_palette(
                palette, role,
                shot_idx, f"gsap:{ev.get('label', '?')}",
                t=t,
                volume_mul=float(ev.get("volume_mul", 0.8) or 0.8),
                no_natural_offset=True,  # GSAP times are sample-accurate
            )
            if cue:
                # Carry the scanner's label through to sfx_palette_planner
                # so prompt selection can be label-driven ("typewriter",
                # "bar_grow") instead of role-only.
                cue["label"] = str(ev.get("label", "")).strip().lower()
                cue["event_duration"] = float(ev.get("duration", 0.5) or 0.5)
                cues.append(cue)

        # ── Rule B: Director sync_points with `action` text ────────────
        # Secondary source when GSAP didn't emit, or when Director called
        # out something the scanner didn't catch. Maps action keyword →
        # role via _ACTION_TO_ROLE. Only fires for actionable text — we
        # do NOT fall through to a per-shot "signature" sound.
        event_cues = _resolve_event_cues_from_sync_points(
            palette=palette,
            shot=director_shot,
            start_time=start_time,
            duration=duration,
            shot_idx=shot_idx,
        )
        cues.extend(event_cues)

        # ── Rule C: Skill-derived audio events ────────────────────────
        # Coding/Question slides explicitly mark interaction beats. These
        # ARE real on-screen events (button reveal, answer correct, etc.)
        # so we keep them.
        skill_events = entry.get("_skill_audio_events") or []
        for ev in skill_events:
            role = ev.get("role") or ""
            t = float(ev.get("t", 0.0))
            volume_mul_skill = float(ev.get("volume_mul", 1.0))
            if role not in palette:
                continue
            if t < 0 or t > duration:
                continue
            cue = _cue_from_palette(
                palette, role,
                shot_idx, f"skill:{ev.get('skill_id', '?')}",
                t=t, volume_mul=volume_mul_skill,
            )
            if cue:
                cues.append(cue)

        # NOTE: removed (2026-05) — Rule 1 (transition pre-roll), Rule 2b
        # (per-shot signature), Rule 4 (emphasis fallback). These all
        # added sound WITHOUT a corresponding on-screen audible event;
        # net effect was "10 whooshes per 53s video" with the user
        # describing the result as distracting / funny / unprofessional.
        # Shots with no detected events are now SILENT by design.

        # ── Dedup (same-role cues within MIN_GAP) ────────────────────
        cues = _dedup_and_space(cues, min_gap=_MIN_CUE_GAP)

        # ── Short-shot clamp (≤ 1 cue per very short shot) ───────────
        # A 0.5s shot shouldn't host 3 cues even if 3 events fired in it.
        # Stack the highest-priority and drop the rest.
        shot_cap = 1 if duration < _SHORT_SHOT else max_per_video
        remaining = max(0, max_per_video - total_cues)
        cap = min(shot_cap, remaining)
        if len(cues) > cap:
            def _priority(c: Dict[str, Any]) -> float:
                return float(c.get("volume", 0))
            cues.sort(key=_priority, reverse=True)
            cues = cues[:cap]

        cues.sort(key=lambda c: float(c.get("t", 0)))
        # Append local cues to whatever is already on the entry. A transition
        # cue from a previous iteration's pre-roll attaches to entry[i-1]
        # *after* entry[i-1] is finalized, so we must extend, not replace.
        entry["sound_cues"].extend(_public_cue(c) for c in cues)

        total_cues += len(cues)

    # ── Rule D (2026-07): mode-gated transition stingers ──────────────
    # The 2026-05 demolition removed ALL transition sound — the right call
    # for lecture content, where a whoosh on every cut read as spam. But
    # for marketing/bold videos the CUT IS the event: a tasteful stinger
    # on the few hardest cuts (+ one riser into the climax) is what makes
    # the edit feel produced. Strictly capped (≤3 whooshes + 1 riser per
    # video), only on high-energy transition types, only in marketing/bold
    # modes — educational stays exactly as silent as today.
    if (visual_style_mode or "").strip().lower() in ("marketing", "bold"):
        remaining_budget = max(0, max_per_video - total_cues)
        if remaining_budget > 0:
            n_stingers = _plan_marketing_transition_stingers(
                ordered, shots_by_index, palette, budget=remaining_budget,
            )
            total_cues += n_stingers

    # Final pass: sort each entry's cues by t. Transition pre-rolls were
    # appended after their host entry's local cues were sorted, so the list
    # is no longer monotonic until we sort here.
    for e in ordered:
        e["sound_cues"].sort(key=lambda c: float(c.get("t", 0)))

    # ── Context attach: narration excerpt + shot type per cue ──────
    # Gives downstream sfx_palette_planner enough to build content-aware
    # fal-elevenlabs prompts (e.g. "warm uplifting bell for a milestone
    # number reveal" instead of the generic "warm bell tone"). Cheap —
    # one O(words × cues) scan but words and cues both stay small.
    _attach_cue_context(ordered, words)

    # ── Density restraint (the "negative-space" pass) ──────────────
    # Walks the video globally and drops over-dense cues. Transitions
    # are protected; impact/positive/data_reveal cues are protected from
    # stage-2 drops unless drastically over budget.
    #
    # Density mode is resolved in priority order:
    #   1. tier_config["audio_density_mode"] when explicitly set to a
    #      non-default value ("sparse", "dense", etc.)
    #   2. tier_config["audio_mood"] when set (mirrors the SFX palette
    #      planner — celebratory video → celebratory density)
    #   3. "normal" as the safe default
    _explicit_mode = str(tier_config.get("audio_density_mode") or "").lower()
    _mood_for_density = str(tier_config.get("audio_mood") or "").lower()
    if _explicit_mode in _DENSITY_TARGETS and _explicit_mode not in ("normal", "default"):
        density_mode = _explicit_mode
    elif _mood_for_density in _DENSITY_TARGETS:
        density_mode = _mood_for_density
    else:
        density_mode = _explicit_mode or "default"
    dropped = _enforce_density(ordered, density_mode)
    if dropped:
        # Recompute total for the log line.
        total_cues = sum(len(e["sound_cues"]) for e in ordered)
        try:
            import logging as _lg
            _lg.getLogger(__name__).info(
                "[sound] density pass: mode=%s dropped=%d remaining=%d",
                density_mode, dropped, total_cues,
            )
        except Exception:
            pass

    # Log palette summary
    _log_palette(palette, total_cues, len(ordered))


# Transition types energetic enough to earn a stinger in marketing mode.
_STINGER_TRANSITIONS = frozenset({
    "smash_cut", "whip_pan", "zoom_in", "zoom_out",
    "slide_left", "slide_up", "circle_iris", "dip_to_black",
})
_MAX_STINGER_WHOOSHES = 3


def _plan_marketing_transition_stingers(
    ordered: List[Dict[str, Any]],
    shots_by_index: Dict[int, Dict[str, Any]],
    palette: Dict[str, Any],
    *,
    budget: int,
) -> int:
    """Rule D — emit a few high-value transition stingers for marketing/bold.

    - ≤ `_MAX_STINGER_WHOOSHES` `transition_whoosh` cues, only at cuts whose
      Director-declared `transition_in` is a high-energy type.
    - ONE `transition_riser` pre-rolled at the end of the shot BEFORE the
      video's climax (first `pacing_role=="hold"` or `intent_role=="moment"`).
    Appends `_public_cue`-shaped cues directly onto the entries (mirrors the
    main loop) and returns how many were added. Respects `budget`.
    """
    added = 0

    # One riser into the climax.
    if budget > 0:
        climax_pos: Optional[int] = None
        for pos, entry in enumerate(ordered):
            shot = shots_by_index.get(int(entry.get("index", 0)), {})
            if (str(shot.get("pacing_role") or "").lower() == "hold"
                    or str(shot.get("intent_role") or "").lower() == "moment"):
                climax_pos = pos
                break
        if climax_pos is not None and climax_pos > 0:
            prev = ordered[climax_pos - 1]
            prev_dur = max(
                0.01, float(prev.get("end", 0.0)) - float(prev.get("start", 0.0))
            )
            if prev_dur >= 1.2:  # too short a shot can't host a riser tail
                lead = min(1.6, prev_dur * 0.6)
                cue = _cue_from_palette(
                    palette, "transition_riser",
                    int(prev.get("index", 0)), "stinger:riser_into_climax",
                    t=max(0.0, prev_dur - lead), volume_mul=0.8,
                    no_natural_offset=True,
                )
                if cue:
                    prev["sound_cues"].append(_public_cue(cue))
                    added += 1

    # Whooshes on the hardest cuts (never the hook — start from entry 1).
    whooshes = 0
    for entry in ordered[1:]:
        if whooshes >= _MAX_STINGER_WHOOSHES or added >= budget:
            break
        shot = shots_by_index.get(int(entry.get("index", 0)), {})
        trans = str(shot.get("transition_in") or "").strip().lower()
        if trans not in _STINGER_TRANSITIONS:
            continue
        cue = _cue_from_palette(
            palette, "transition_whoosh",
            int(entry.get("index", 0)), f"stinger:{trans}",
            t=0.0, volume_mul=0.75, no_natural_offset=True,
        )
        if cue:
            entry["sound_cues"].append(_public_cue(cue))
            whooshes += 1
            added += 1

    if added:
        try:
            import logging as _lg
            _lg.getLogger(__name__).info(
                "[sound] marketing stingers: %d added (%d whoosh, %d riser)",
                added, whooshes, added - whooshes,
            )
        except Exception:
            pass
    return added


def _attach_cue_context(
    entries: List[Dict[str, Any]],
    words: List[Dict[str, Any]],
) -> None:
    """Stash per-cue context on each cue: shot_type + narration window text.

    Window: ±1.5s around the cue's absolute time. The downstream SFX
    palette planner uses this to build content-aware fal prompts so each
    cue's sound is purpose-built for what's actually happening on screen
    instead of a generic role-only prompt.

    Words list is the same the planner consumes for emphasis anchors;
    each entry has `time` (absolute) and `word` (text). Robust to either
    shape (some upstream code uses `text` instead).
    """
    if not entries:
        return
    # Pre-sort words by time for O(log N) lookup later if it ever matters.
    safe_words: List[Tuple[float, str]] = []
    for w in (words or []):
        try:
            t_abs = float(w.get("time", w.get("start", 0.0)))
        except (TypeError, ValueError):
            continue
        txt = (w.get("word") or w.get("text") or "").strip()
        if txt:
            safe_words.append((t_abs, txt))
    safe_words.sort(key=lambda x: x[0])

    def _window_text(abs_t: float, half_s: float = 1.5) -> str:
        lo, hi = abs_t - half_s, abs_t + half_s
        toks: List[str] = []
        for t_w, txt in safe_words:
            if t_w < lo:
                continue
            if t_w > hi:
                break
            toks.append(txt)
        return " ".join(toks)[:200]

    for entry in entries:
        e_start = float(entry.get("start", 0.0))
        shot_type = str(entry.get("_shot_type", "") or "")
        for cue in entry.get("sound_cues") or []:
            try:
                t_rel = float(cue.get("t", 0.0))
            except (TypeError, ValueError):
                t_rel = 0.0
            abs_t = e_start + t_rel
            cue["context"] = {
                "shot_type": shot_type,
                "text": _window_text(abs_t),
            }


def _enforce_density(entries: List[Dict[str, Any]], mode: str) -> int:
    """Drop over-dense cues video-globally. Returns count dropped.

    Two-stage:
      1. Sliding-window: no more than `max_in_window` cues in any
         `_DENSITY_WINDOW_S` window.
      2. Average-gap floor: total cues × `min_avg_gap_s` <= video_dur.

    Transition cues (transition_whoosh, transition_riser) are protected
    in stage 1 — a cut without a whoosh reads as a bug. Other roles are
    dropped first.
    """
    target = _DENSITY_TARGETS.get(mode, _DENSITY_TARGETS["default"])
    max_in_window = int(target["max_in_window"])
    min_avg_gap_s = float(target["min_avg_gap_s"])

    # Flatten to (abs_t, entry_idx, cue_idx_in_entry, cue) sorted by abs_t.
    flat: List[Tuple[float, int, int, Dict[str, Any]]] = []
    for ei, e in enumerate(entries):
        e_start = float(e.get("start", 0.0))
        for ci, cue in enumerate(e.get("sound_cues") or []):
            abs_t = e_start + float(cue.get("t", 0.0))
            flat.append((abs_t, ei, ci, cue))
    flat.sort(key=lambda x: x[0])
    if not flat:
        return 0

    def _is_transition(c: Dict[str, Any]) -> bool:
        return (c.get("role") or "").lower() in (
            "transition_whoosh", "transition_riser",
        )

    def _priority(c: Dict[str, Any]) -> int:
        # Higher = more important (less likely to drop).
        role = (c.get("role") or "").lower()
        if role.startswith("transition_"):
            return 100
        if role == "impact":
            return 60
        if role in ("ui_positive", "data_reveal"):
            return 40
        return 20

    keep_flags = [True] * len(flat)

    # ── Stage 1: sliding-window cap ────────────────────────────────
    for i, (t_i, _, _, cue_i) in enumerate(flat):
        if not keep_flags[i]:
            continue
        # Count kept neighbors in [t_i - WIN, t_i + WIN].
        window_indices = []
        for j in range(len(flat)):
            if not keep_flags[j]:
                continue
            if abs(flat[j][0] - t_i) <= _DENSITY_WINDOW_S:
                window_indices.append(j)
        if len(window_indices) <= max_in_window:
            continue
        # Over budget — drop lowest priority non-transition first.
        sorted_for_drop = sorted(
            window_indices,
            key=lambda j: (_priority(flat[j][3]),
                           -float(flat[j][3].get("volume") or 0)),
        )
        n_drop = len(window_indices) - max_in_window
        for j in sorted_for_drop:
            if n_drop <= 0:
                break
            if _is_transition(flat[j][3]):
                continue  # never drop transitions in stage 1
            if not keep_flags[j]:
                continue
            keep_flags[j] = False
            n_drop -= 1

    # ── Stage 2: average-gap floor across the whole video ──────────
    video_dur = max(0.5, flat[-1][0] - flat[0][0]) if len(flat) >= 2 else 1.0
    # Use full video duration if we can derive it from entries.
    if entries:
        last_e = entries[-1]
        possible_end = float(last_e.get("end") or last_e.get("start") or 0.0)
        if possible_end > video_dur:
            video_dur = possible_end
    kept_count = sum(1 for k in keep_flags if k)
    # round() (not int()) so we don't floor 30/6.5 = 4.6 down to 4.
    # Adds one cue of slack for content-dense videos.
    max_total = round(video_dur / min_avg_gap_s) if min_avg_gap_s > 0 else kept_count
    # Hard-over budget: we'd need to drop more than the priority floor allows.
    # In that case stage 2 will drop ALL low-priority cues then start cutting
    # impacts/positives. Below this threshold we leave impacts/positives alone.
    drastically_over = kept_count > int(max_total * 1.5)

    if kept_count > max_total:
        kept_indices = [i for i, k in enumerate(keep_flags) if k]
        # Sort ascending by priority, then descending by volume (i.e. drop
        # low-priority quiet cues first).
        kept_indices.sort(key=lambda i: (_priority(flat[i][3]),
                                          -float(flat[i][3].get("volume") or 0)))
        to_drop = kept_count - max_total
        for i in kept_indices:
            if to_drop <= 0:
                break
            # Protect punchline cues unless drastically over budget.
            if (not drastically_over
                    and _priority(flat[i][3]) >= _STAGE2_PRIORITY_FLOOR):
                continue
            keep_flags[i] = False
            to_drop -= 1

    # ── Write back: rebuild each entry's sound_cues ───────────────
    new_cues_per_entry: Dict[int, List[Tuple[int, Dict[str, Any]]]] = {}
    dropped = 0
    for idx, (_, ei, ci, cue) in enumerate(flat):
        if keep_flags[idx]:
            new_cues_per_entry.setdefault(ei, []).append((ci, cue))
        else:
            dropped += 1
    for ei, e in enumerate(entries):
        kept = new_cues_per_entry.get(ei, [])
        kept.sort(key=lambda x: x[0])
        e["sound_cues"] = [c for _, c in kept]
    return dropped


# ---------------------------------------------------------------------------
# Sound Palette — built once per video
# ---------------------------------------------------------------------------

def _extract_topic_keywords(script_text: str) -> List[str]:
    """Pull topic-signal words from the narration script.

    Returns lowercased keywords including synonym expansions. For example,
    "managing your money" → ["managing", "your", "money", "coin", "cash",
    "register", "dollar"] so sound descriptions like "FOLEY, COINS, DROP"
    get a match.
    """
    if not script_text:
        return []
    # Tokenize to unique lowercased words (3+ chars to skip articles)
    raw_words = set(re.findall(r"[a-zA-Z]{3,}", script_text.lower()))
    expanded: Set[str] = set(raw_words)
    for word in raw_words:
        synonyms = TOPIC_SYNONYMS.get(word, [])
        for syn in synonyms:
            expanded.add(syn)
    return list(expanded)


# Per-role intent phrases used as the semantic-search query. Describes the
# FEEL of the sound (not its category) so the embedding model can rank the
# bucket by what the cue is actually trying to communicate.
_ROLE_INTENT_PHRASES: Dict[str, str] = {
    "transition_whoosh": "smooth cinematic whoosh, brief scene transition, clean tail",
    "transition_riser":  "building riser, ascending pitch, dramatic lead-in",
    "ui_chime":          "gentle bell tone, soft chime, warm reveal sparkle",
    "ui_positive":       "warm uplifting confirmation chime, success feedback, encouraging",
    "ui_negative":       "soft descending tone, neutral error feedback, not harsh",
    "ui_click":          "crisp short click, neutral UI tap, brief",
    "data_reveal":       "subtle tonal tick, ascending pitch, data emerging, brief sparkle",
    "impact":            "deep cinematic impact, full-spectrum thud, no metallic ring",
    "ambient_loop":      "subtle ambient background texture, gentle, non-distracting",
}


def _build_sound_palette(
    cat: SoundCatalog,
    video_id: str,
    script_text: str,
) -> Dict[str, Any]:
    """Pre-select 3-4 sound files per role for variety.

    Sounds within a role are rotated via a counter so consecutive
    transitions don't reuse the same file.

    Uses semantic search (`find_by_intent`) when the catalog has embeddings
    loaded; otherwise falls back to keyword-overlap (`resolve_for_topic`)
    which is the legacy behavior.
    """
    topic_kws = _extract_topic_keywords(script_text)
    # Short, free-text version of the topic for semantic queries — first
    # ~200 chars of the script gives the embedder enough signal without
    # blowing token budget.
    topic_text = (script_text or "").strip().replace("\n", " ")[:200]

    has_semantic = getattr(cat, "_embeddings", None) is not None

    palette: Dict[str, Any] = {}
    for role in PALETTE_ROLES:
        if not cat.has_role(role):
            continue
        variations: List[Dict[str, Any]] = []
        seen_urls: Set[str] = set()
        used_ids: Set[str] = set()

        if has_semantic:
            # Compose a query that pairs the role's intent with the video
            # topic. Same query for all 4 picks; deduping via `used_ids`
            # gives us the top-4 distinct semantic neighbors.
            role_intent = _ROLE_INTENT_PHRASES.get(role, role.replace("_", " "))
            query = f"{role_intent}. Context: {topic_text}" if topic_text else role_intent
            for i in range(4):
                picked = cat.find_by_intent(
                    query,
                    role=role,
                    used_ids=used_ids,
                    fallback_seed_salt=f"{video_id}:{i}",
                    exclude_urls=seen_urls,
                )
                if not picked:
                    break
                if picked.get("url", "") in seen_urls:
                    # Same URL surfaced via a different file_id collision —
                    # advance used_ids to force a different pick next iter.
                    fid = picked.get("file_id")
                    if fid:
                        used_ids.add(fid)
                    continue
                variations.append(picked)
                seen_urls.add(picked.get("url", ""))
                fid = picked.get("file_id")
                if fid:
                    used_ids.add(fid)
        else:
            # Legacy keyword-overlap palette.
            for i in range(4):
                seed = f"{video_id}:palette:{role}:{i}"
                if topic_kws:
                    picked = cat.resolve_for_topic(role, topic_kws, seed_key=seed, exclude_urls=seen_urls)
                else:
                    picked = cat.resolve(role, seed_key=seed, exclude_urls=seen_urls)
                if picked and picked.get("url", "") not in seen_urls:
                    variations.append(picked)
                    seen_urls.add(picked.get("url", ""))

        if variations:
            palette[role] = variations
            palette[f"_{role}_counter"] = 0
    return palette


def _log_palette(
    palette: Dict[str, Any],
    total_cues: int,
    total_shots: int,
) -> None:
    parts = []
    for role in PALETTE_ROLES:
        entry = palette.get(role)
        if entry:
            if isinstance(entry, list):
                first = entry[0]
                name = first.get("description", "")[:25]
                score = first.get("score")
                score_str = f" s={score:.2f}" if score is not None else ""
                parts.append(f"{role}={name}{score_str} (+{len(entry)-1})")
            else:
                name = entry.get("description", "")[:35]
                parts.append(f"{role}={name}")
    if parts:
        print(f"   🎵 Sound palette: {', '.join(parts)}")
    # Per-role detailed audit so we can see exactly what was picked and why.
    for role in PALETTE_ROLES:
        entry = palette.get(role)
        if isinstance(entry, list):
            for i, v in enumerate(entry):
                score = v.get("score")
                score_str = f"score={score:.3f} " if score is not None else ""
                print(
                    f"   🎵 [palette] {role}[{i}] {score_str}"
                    f"cat={v.get('category','')!r} "
                    f"desc={v.get('description','')[:60]!r}"
                )
    print(
        f"   🔊 Sound Planner placed {total_cues} cues across "
        f"{total_shots} shots"
    )


# ---------------------------------------------------------------------------
# Cue resolution — always from the palette
# ---------------------------------------------------------------------------

def _cue_from_palette(
    palette: Dict[str, Any],
    role: str,
    shot_idx: int,
    slot: str,
    *,
    t: float,
    volume_mul: float,
    no_natural_offset: bool = False,
) -> Optional[Dict[str, Any]]:
    """Build a cue dict using a rotated file from the palette's variations.

    Each call advances the role's rotation counter so consecutive cues
    of the same role use different sound files.

    `no_natural_offset` skips the 30-80ms hash offset for cues whose
    placement must be sample-accurate (transition whooshes leading a cut,
    title impact hits). Default offset is fine for chimes/clicks.
    """
    variations = palette.get(role)
    if not variations:
        return None
    # Handle both old (single dict) and new (list) palette formats
    if isinstance(variations, dict):
        picked = variations
    else:
        counter_key = f"_{role}_counter"
        idx = palette.get(counter_key, 0) % len(variations)
        picked = variations[idx]
        palette[counter_key] = idx + 1

    # Apply volume reduction — sounds should be subtle background texture
    base_volume = picked.get("volume_hint", 0.5)
    # Reduce all volumes by 40% so they don't compete with narration
    volume = max(0.0, min(1.0, base_volume * volume_mul * 0.6))

    if no_natural_offset:
        adjusted_t = round(float(t), 3)
    else:
        # Add slight natural offset (0.03-0.08s) so sounds don't land exactly
        # on shot boundaries — feels more organic
        import hashlib
        offset_hash = int(hashlib.md5(f"{shot_idx}:{slot}".encode()).hexdigest()[:4], 16)
        natural_offset = 0.03 + (offset_hash % 50) / 1000.0  # 0.03-0.08s
        adjusted_t = max(0.0, round(float(t) + natural_offset, 3))

    return {
        "id": f"sfx_{shot_idx}_{slot}",
        "t": adjusted_t,
        "url": picked.get("url"),
        "volume": round(volume, 3),
        "role": role,
        "file_id": picked.get("file_id"),
        "duration": round(picked.get("duration", 0.0), 3),
        "_source": slot,
    }


# NOTE: `_resolve_signature_cue` and `_find_emphasis_anchor` removed
# (2026-05) along with the auto-signature / emphasis-fallback rules they
# served. Both were sources of "sound because the timeline says so"
# rather than "sound because something audible happened." If a future
# rule needs per-shot deterministic placement at sync_points, lift the
# small helper inline rather than reviving the full table.


# ---------------------------------------------------------------------------
# B1 — Visual-event-driven cueing (action keyword → role)
# ---------------------------------------------------------------------------

# Each sync_point may carry an `action` string describing what happens
# on screen at that time (e.g. "fadeIn subtitle", "annotate title with
# underline", "highlight callout"). Map keywords → cue role so the
# sound matches the visual event, not the shot-type bucket.
#
# Order matters — first match wins. The patterns prefer specific events
# over generic ones (so "annotate title with underline" picks `impact`
# from "annotate", not `ui_chime` from a later "title" pattern).
_ACTION_TO_ROLE: List[Tuple[re.Pattern, str, float]] = [
    # Hard punctuating events — emphasis on a specific word/element.
    (re.compile(r"\b(annotate|underline|highlight\s*callout|emphas)\b", re.I),
     "impact", 0.90),
    # Numbers/data appearing — bar grows, counter ticks, chart enters.
    (re.compile(r"\b(chart|graph|bar|number|count\s*up|counter|stat|data|percent)\b", re.I),
     "data_reveal", 0.85),
    # Positive milestones / celebratory beats.
    (re.compile(r"\b(checkmark|tick|approve|confirm|success|done|complete|won|winner|celebr)\b", re.I),
     "ui_positive", 0.85),
    # Negative / error cues.
    (re.compile(r"\b(error|fail|cross|x\s*mark|wrong|incorrect|warning|deny)\b", re.I),
     "ui_negative", 0.75),
    # Type-in / split-reveal / typewriter — energetic text appear.
    (re.compile(r"\b(splitreveal|split\s*reveal|typewrite|typewriter|type\s*in)\b", re.I),
     "ui_positive", 0.80),
    # Buttons / UI clicks / select.
    (re.compile(r"\b(button|click|tap|select|toggle|switch)\b", re.I),
     "ui_click", 0.65),
    # Soft reveals — fadeIn, slideIn, appear, show.
    (re.compile(r"\b(fadein|fade\s*in|slidein|slide\s*in|appear|reveal|show|enter|popin|pop\s*in)\b", re.I),
     "ui_chime", 0.80),
    # Camera/scene moves — zoom, push-in, dolly. Treat as gentle impact.
    (re.compile(r"\b(zoom|push\s*in|dolly|pan\s*to)\b", re.I),
     "impact", 0.70),
]


def _action_to_role(action: str) -> Optional[Tuple[str, float]]:
    """Map a sync_point.action string to (role, volume_mul). Returns
    None when no keyword matches — caller falls back to a default."""
    if not action or not isinstance(action, str):
        return None
    for pat, role, vol in _ACTION_TO_ROLE:
        if pat.search(action):
            return (role, vol)
    return None


def _resolve_event_cues_from_sync_points(
    *,
    palette: Dict[str, Any],
    shot: Dict[str, Any],
    start_time: float,
    duration: float,
    shot_idx: int,
) -> List[Dict[str, Any]]:
    """Emit one cue per Director-provided sync_point whose `action` text
    maps to a known role. Returns [] when sync_points are missing or
    every action is empty/unmapped — caller then falls back to the
    shot-type signature rule.

    Each sync_point is treated as a discrete visual event with its own
    role. The downstream density restraint will trim if a single shot
    over-emits.
    """
    sync_points = shot.get("sync_points") or []
    if not sync_points:
        return []

    out: List[Dict[str, Any]] = []
    seen_t: List[float] = []  # de-dup very-close events within this shot
    for sp in sync_points:
        try:
            abs_t = float(sp.get("time", 0))
        except (TypeError, ValueError):
            continue
        rel = abs_t - start_time
        # Allow tiny negative slop (-0.05) the same way _shot_relative_sync_times does.
        if rel < -0.05 or rel > duration - 0.05:
            continue
        rel = max(0.0, rel)

        # Within-shot de-dup: ignore points within MIN_GAP of one we already kept.
        if any(abs(rel - prev) < _MIN_CUE_GAP for prev in seen_t):
            continue

        action = str(sp.get("action") or "").strip()
        mapped = _action_to_role(action)
        if mapped is None:
            # No actionable text — skip (signature fallback in caller).
            # We could emit a default ui_chime here, but that would
            # double-cue with the signature rule. Prefer letting the
            # signature path handle the "no events" case cleanly.
            continue
        role, volume_mul = mapped
        if role not in palette:
            continue
        cue = _cue_from_palette(
            palette, role,
            shot_idx, f"event:{action[:40]}",
            t=rel, volume_mul=volume_mul,
            # Event cues should land sample-accurately on the visual
            # frame — disable the natural-offset wobble.
            no_natural_offset=True,
        )
        if cue:
            # Carry the Director's action verbatim so sfx_palette_planner
            # can render an event-specific prompt (e.g. "underline draw"
            # → pen-scratch sound, not generic chime).
            cue["label"] = action.lower()[:60]
        if cue:
            out.append(cue)
            seen_t.append(rel)
    return out


# NOTE (2026-05): `_shot_relative_sync_times` and `_find_emphasis_anchor`
# removed alongside the rules that called them. Sync_point timing is now
# resolved inline in `_resolve_event_cues_from_sync_points`; emphasis
# fallback no longer exists (silent shots are intentional).


# ---------------------------------------------------------------------------
# Dedup + suppression
# ---------------------------------------------------------------------------

def _dedup_and_space(
    cues: List[Dict[str, Any]],
    min_gap: float,
) -> List[Dict[str, Any]]:
    """Enforce min gap; transition + non-transition pairs co-exist."""
    if not cues:
        return cues
    ordered = sorted(cues, key=lambda c: float(c.get("t", 0)))
    kept: List[Dict[str, Any]] = []

    def _is_transition(c: Dict[str, Any]) -> bool:
        return c.get("_source") == "transition"

    for cue in ordered:
        t = float(cue.get("t", 0))
        if kept and (t - float(kept[-1].get("t", 0))) < min_gap:
            prev = kept[-1]
            both_non_transition = not _is_transition(prev) and not _is_transition(cue)
            if both_non_transition:
                if float(cue.get("volume", 0)) > float(prev.get("volume", 0)):
                    kept.pop()
                else:
                    continue
        kept.append(cue)
    return kept


# ---------------------------------------------------------------------------
# Payload cleanup
# ---------------------------------------------------------------------------

def _public_cue(cue: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": cue.get("id"),
        "t": cue.get("t"),
        "url": cue.get("url"),
        "volume": cue.get("volume"),
        "role": cue.get("role"),
        "duration": cue.get("duration"),
        # `label` is the GSAP scanner's event kind ("typewriter",
        # "bar_grow", ...) or the Director's action text. sfx_palette_planner
        # uses it to pick the prompt for the SFX generator, replacing the
        # old role+mood prompt selection. When absent, planner falls back
        # to role-only prompt.
        "label": cue.get("label"),
        # `event_duration` is how long the visual event lasts (informs the
        # generator's target duration). Falls back to cue's intrinsic duration.
        "event_duration": cue.get("event_duration"),
        # context for downstream sfx_palette_planner — surrounding narration
        # text + shot type. Populated by _attach_cue_context after density.
        "context": cue.get("context"),
    }
