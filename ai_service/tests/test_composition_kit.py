"""Frame-composition vocabulary and the variety guarantees around it.

Context: "the layouts all look the same" was traced to the per-shot prompt
carrying hundreds of concrete lines about type properties and two lines of
adjectives about frame composition, while the workhorse card exemplar was a
centred hero+sub stack. composition_kit replaces the adjectives with an
assigned, concrete vocabulary. These tests pin the parts that can regress
silently: the variety rules, the fallback behaviour, and the fact that the
contract actually reaches the prompt.
"""

import os
import re
import shutil
import subprocess
import sys

import pytest

sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "app", "ai-video-gen-main")
)

import composition_kit as ck  # noqa: E402


def _shots(*types):
    return [{"shot_type": t} for t in types]


# ── the vocabulary itself ───────────────────────────────────────────────────

def test_every_composition_has_a_contract_and_a_css_class():
    """A composition the model can name but not build is worse than none —
    it would be told to use a frame whose classes don't exist."""
    for name, spec in ck.COMPOSITIONS.items():
        assert spec["blurb"].strip(), name
        assert spec["air"].strip(), name
        assert spec["contract"].strip(), name
        css_class = spec["css_class"]
        assert css_class in spec["contract"], f"{name} contract lacks {css_class}"
        assert "." + css_class in ck.COMPOSITION_CSS, f"{name} has no CSS: {css_class}"


def test_css_has_no_negative_grid_lines():
    """`grid-column: -1 / 8` on a 12-col grid resolves to lines 8..13 — the
    opposite side from the one intended. Two of these shipped in the first
    draft of this module and put the subject on the wrong side of the frame."""
    for prop, value in re.findall(r"(grid-(?:column|row)):\s*([^;]+);", ck.COMPOSITION_CSS):
        assert not value.strip().startswith("-"), f"{prop}: {value}"
        assert "/ -" not in value, f"{prop}: {value}"


def test_every_shot_type_default_is_a_real_composition():
    for shot_type, comp in ck.SHOT_TYPE_COMPOSITION_DEFAULT.items():
        assert comp in ck.COMPOSITION_NAMES, f"{shot_type} -> {comp}"


# ── normalization: mirrors background_treatment's contract ─────────────────

def test_unknown_and_absent_values_fall_back_per_shot_type():
    assert ck.normalize("", "PROCESS_STEPS") == "spine"
    assert ck.normalize(None, "ANNOTATION_MAP") == "margin_notes"
    assert ck.normalize("not_a_composition", "TEXT_DIAGRAM") == "left_column"


def test_normalize_accepts_hyphen_and_space_spellings():
    """The planner is an LLM; it will write margin-notes and 'margin notes'."""
    assert ck.normalize("margin-notes", "TEXT_DIAGRAM") == "margin_notes"
    assert ck.normalize("Margin Notes", "TEXT_DIAGRAM") == "margin_notes"


def test_normalize_respects_an_allowed_subset():
    """Configurability: an identity may restrict the vocabulary. A value
    outside the subset must not survive just because it is globally legal."""
    got = ck.normalize("corner_type", "TEXT_DIAGRAM", allowed=["left_column", "spine"])
    assert got in ("left_column", "spine")


# ── the variety guarantees (the actual point of the module) ────────────────

def test_no_composition_repeats_back_to_back():
    shots = ck.assign_compositions(_shots(*(["TEXT_DIAGRAM"] * 8)))
    got = [s["composition"] for s in shots]
    assert all(a != b for a, b in zip(got, got[1:])), got


def test_no_repeat_inside_the_window():
    shots = ck.assign_compositions(_shots(*(["TEXT_DIAGRAM"] * 12)))
    got = [s["composition"] for s in shots]
    for i in range(len(got)):
        window = got[max(0, i - ck.NO_REPEAT_WINDOW) : i]
        assert got[i] not in window, f"{got[i]} repeats at {i}: {got}"


def test_centred_frames_are_rationed_not_banned():
    """center_hero is right for a title card and wrong for a whole video.
    A deck of ten shots all asking for it must not get it ten times."""
    shots = [{"shot_type": "KINETIC_TITLE", "composition": "center_hero"} for _ in range(10)]
    got = [s["composition"] for s in ck.assign_compositions(shots)]
    assert got.count("center_hero") <= max(1, int(10 * ck.MAX_CENTERED_FRACTION))
    assert "center_hero" in got, "rationed, not banned"


def test_planner_intent_is_honoured_when_it_breaks_no_rule():
    """The planner sees the whole script; its choice beats the rotation table
    whenever it is legal."""
    shots = [
        {"shot_type": "TEXT_DIAGRAM", "composition": "artifact_study"},
        {"shot_type": "TEXT_DIAGRAM", "composition": "margin_notes"},
        {"shot_type": "TEXT_DIAGRAM", "composition": "corner_type"},
    ]
    got = [s["composition"] for s in ck.assign_compositions(shots)]
    assert got == ["artifact_study", "margin_notes", "corner_type"]


def test_media_hero_shots_keep_full_bleed_back_to_back():
    """On a media_hero shot the media IS the frame; reflowing consecutive ones
    into columns would contradict background_treatment."""
    shots = [
        {"shot_type": "VIDEO_HERO", "background_treatment": "media_hero",
         "composition": "full_bleed_overlay"},
        {"shot_type": "IMAGE_HERO", "background_treatment": "media_hero",
         "composition": "full_bleed_overlay"},
    ]
    got = [s["composition"] for s in ck.assign_compositions(shots)]
    assert got == ["full_bleed_overlay", "full_bleed_overlay"]


def test_assignment_is_idempotent():
    """normalize_shot_plan runs on the resume path too — a second pass must
    not reshuffle every frame out from under a half-rendered run."""
    shots = ck.assign_compositions(
        _shots("KINETIC_TITLE", "TEXT_DIAGRAM", "IMAGE_HERO", "PROCESS_STEPS", "TEXT_DIAGRAM")
    )
    first = [s["composition"] for s in shots]
    again = [s["composition"] for s in ck.assign_compositions(shots)]
    assert first == again


def test_short_videos_do_not_crash_when_the_pool_is_exhausted():
    """With a 1-composition pool every candidate is inside the window. The
    rule must degrade, not raise."""
    shots = ck.assign_compositions(_shots("TEXT_DIAGRAM", "TEXT_DIAGRAM"),
                                   allowed=["left_column"])
    assert [s["composition"] for s in shots] == ["left_column", "left_column"]


def test_empty_shot_list_is_fine():
    assert ck.assign_compositions([]) == []


# ── the prompt blocks ──────────────────────────────────────────────────────

def test_planner_menu_lists_every_composition():
    menu = ck.planner_menu_block()
    for name in ck.COMPOSITIONS:
        assert f'`"{name}"`' in menu, name
    assert "MUST NOT share a composition" in menu


def test_contract_block_carries_real_markup():
    block = ck.contract_block("margin_notes", "TEXT_DIAGRAM")
    assert "comp-margin-notes" in block
    assert "comp-gutter" in block
    # It has to outrank the card exemplar explicitly, not just coexist with it.
    assert "do not reproduce the shot card's example layout" in block


def test_contract_block_never_raises_on_junk():
    """A malformed planner value must not take down shot generation."""
    assert "COMPOSITION CONTRACT" in ck.contract_block("nonsense", "TEXT_DIAGRAM")
    assert "COMPOSITION CONTRACT" in ck.contract_block("", "")


# ── integration: does it actually reach the prompt? ────────────────────────

def test_composition_reaches_the_per_shot_prompt():
    from shot_type_cards import build_per_shot_system_prompt

    with_comp = build_per_shot_system_prompt(
        "TEXT_DIAGRAM", aspirational=True, composition="margin_notes"
    )
    assert "COMPOSITION CONTRACT" in with_comp
    assert "comp-margin-notes" in with_comp
    # Recency matters: the contract must be read AFTER the shot card's exemplar.
    # (That exemplar is now the composition's own, since _format_card swaps it —
    # the contract still lands last so it governs.)
    assert with_comp.index("COMPOSITION CONTRACT") > with_comp.index("SHOT TYPE:")


def test_prompt_is_unchanged_when_no_composition_is_assigned():
    """Legacy/v2 paths pass nothing; they must not get a stray block."""
    from shot_type_cards import build_per_shot_system_prompt

    assert "COMPOSITION CONTRACT" not in build_per_shot_system_prompt(
        "TEXT_DIAGRAM", aspirational=True
    )


def test_shot_planner_emits_a_composition_for_every_shot():
    from shot_planner import normalize_shot_plan

    plan = normalize_shot_plan({
        "shots": [
            {"shot_type": "KINETIC_TITLE", "narration_brief": "Opening line."},
            {"shot_type": "TEXT_DIAGRAM", "narration_brief": "First idea."},
            {"shot_type": "TEXT_DIAGRAM", "narration_brief": "Second idea."},
            {"shot_type": "TEXT_DIAGRAM", "narration_brief": "Third idea."},
        ]
    })
    comps = [s["composition"] for s in plan["shots"]]
    assert all(c in ck.COMPOSITION_NAMES for c in comps), comps
    assert all(a != b for a, b in zip(comps, comps[1:])), comps


def test_planner_system_prompt_advertises_the_field():
    from shot_planner import SHOT_PLANNER_SYSTEM_PROMPT

    assert "FRAME COMPOSITION" in SHOT_PLANNER_SYSTEM_PROMPT
    assert "`\"margin_notes\"`" in SHOT_PLANNER_SYSTEM_PROMPT


# ── exemplars: the part of the prompt the model imitates ───────────────────

def test_every_composition_has_an_exemplar():
    """A composition with no exemplar falls back to the card's centred one,
    which is the exact failure this system exists to fix."""
    missing = [n for n in ck.COMPOSITIONS if n not in ck.EXEMPLARS]
    assert not missing, missing


def test_exemplars_build_their_own_composition():
    for name, ex in ck.EXEMPLARS.items():
        css_class = ck.COMPOSITIONS[name]["css_class"]
        assert css_class in ex["html"], f"{name} exemplar does not use {css_class}"
        assert "id='shot-root'" in ex["html"], f"{name} exemplar lacks a shot root"


def test_no_exemplar_reintroduces_the_centred_wrapper():
    """.full-screen-center / .layout-hero are the centre-stacked frame. An
    exemplar that used them would teach the very thing being replaced."""
    for name, ex in ck.EXEMPLARS.items():
        assert "full-screen-center" not in ex["html"], name
        assert "layout-hero" not in ex["html"], name


def test_exemplars_respect_the_technical_rails():
    """These are the hard requirements in the preamble. An exemplar that broke
    one would teach every shot to break it — the example outranks the prose."""
    for name, ex in ck.EXEMPLARS.items():
        js = ex["script"]
        assert "setTimeout" not in js, f"{name}: setTimeout never fires under a seek"
        # Every tween needs a named ease; count eases against tween calls.
        tweens = js.count("gsap.to(") + js.count("gsap.from(") + js.count("gsap.fromTo(")
        assert tweens >= 3, f"{name}: only {tweens} tweens — too static"
        assert js.count("ease:") >= tweens, (
            f"{name}: {tweens} tweens but {js.count('ease:')} eases — "
            "linear/default easing is banned"
        )


def test_exemplars_have_a_timeline_map_and_a_back_half_beat():
    """Two preamble requirements the old exemplars never demonstrated: plan
    before you code, and don't fade in then sit."""
    for name, ex in ck.EXEMPLARS.items():
        assert "TIMELINE MAP" in ex["script"], name
        assert "BACK HALF" in ex["script"] or "back half" in ex["script"], name


def test_exemplars_avoid_hardcoded_background_hex():
    """The 'six different backgrounds in one video' bug. Backgrounds come from
    var(--brand-bg); literal hex on a shot background is banned."""
    for name, ex in ck.EXEMPLARS.items():
        html = ex["html"]
        for marker in ("background:#", "background-color:#", "background: #"):
            assert marker not in html.replace(" ", "").replace("background:#fff0", ""), name


def test_exemplar_swap_replaces_the_card_example():
    from shot_type_cards import build_per_shot_system_prompt as build

    got = build("TEXT_DIAGRAM", aspirational=True, composition="left_column")
    assert "comp-left-column" in got
    assert "full-screen-center" not in got, "centred exemplar must be gone"


def test_centring_guidelines_are_dropped_with_the_swap():
    """Otherwise the card's bullet list ('WRAP content in .full-screen-center')
    contradicts the contract injected below it."""
    from shot_type_cards import build_per_shot_system_prompt as build

    got = build("TEXT_DIAGRAM", aspirational=True, composition="left_column")
    assert "layout-hero" not in got


def test_lower_tiers_keep_the_conservative_card_example():
    """standard/premium are not aspirational; nothing changes for them."""
    from shot_type_cards import build_per_shot_system_prompt as build

    got = build("TEXT_DIAGRAM", composition="left_column")
    assert "full-screen-center" in got


def test_marketing_keeps_its_compiled_design_language():
    """marketing/bold is a coherent compiled prompt. Layering a composition
    contract on top of it is the stacked-override pattern it replaced."""
    from shot_type_cards import build_per_shot_system_prompt as build

    got = build("TEXT_DIAGRAM", aspirational=True, mode="marketing",
                composition="left_column")
    assert "COMPOSITION CONTRACT" not in got
    assert "comp-left-column" not in got


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_every_exemplar_script_is_valid_javascript():
    """An exemplar is copied by every shot assigned that composition, so a
    syntax error in one propagates instead of failing once. The left_column
    exemplar was rendered end-to-end in the browser; this covers the other
    nine cheaply."""
    for name, ex in ck.EXEMPLARS.items():
        # Wrap in a function: the scripts are statement sequences, and `gsap`
        # is a runtime global we are not asserting on here.
        src = "function __exemplar(){\n" + ex["script"] + "\n}"
        proc = subprocess.run(
            ["node", "--check", "-"], input=src, capture_output=True, text=True
        )
        assert proc.returncode == 0, f"{name} script is invalid JS:\n{proc.stderr}"


def test_every_exemplar_html_has_balanced_tags():
    """A cheap structural check — an unclosed div in an exemplar teaches every
    copying shot to emit one."""
    for name, ex in ck.EXEMPLARS.items():
        html = ex["html"]
        for tag in ("div", "svg", "h1", "aside"):
            opens = len(re.findall(rf"<{tag}[\s>]", html))
            closes = html.count(f"</{tag}>")
            assert opens == closes, f"{name}: {tag} {opens} open vs {closes} closed"


def test_exemplars_do_not_leak_backticks_into_the_prompt():
    """These strings land in a prompt, not in the dispatcher template, so this
    is about model confusion rather than a parse error — a stray backtick reads
    as a markdown fence and can truncate the example the model copies."""
    for name, ex in ck.EXEMPLARS.items():
        assert "`" not in ex["html"], name
        assert "`" not in ex["script"], name


def test_composition_classes_work_without_the_comp_wrapper():
    """A real run authored <div class="comp-spine"> with no .comp wrapper.

    The placement rules still matched, but there was no grid to place into, so
    the flex children collapsed to min-content and the step labels rendered one
    letter per line down the left edge of an otherwise empty frame. Requiring
    two cooperating class names is a contract the model will drop sooner or
    later, so each composition class must establish the container itself.
    """
    css = ck.COMPOSITION_CSS
    container_rule = css[css.index(".comp,") : css.index("box-sizing: border-box;")]
    for name, spec in ck.COMPOSITIONS.items():
        assert f".{spec['css_class']},\n" in container_rule or \
               f".{spec['css_class']} {{" in container_rule, (
            f"{name}: .{spec['css_class']} does not establish the grid on its own"
        )


def test_text_rows_cannot_collapse_below_min_content():
    """min-width:0 is what lets a grid item shrink so long labels wrap; applied
    to a text-bearing flex row it is what produces the one-letter column."""
    assert "min-width: min-content" in ck.COMPOSITION_CSS


def test_items_inside_a_text_column_keep_their_height():
    """min-height:0 belongs to grid CELLS. On the heading and sub-line inside a
    cell's flex column it let the heading collapse to a sliver while its lines
    still painted, so the sub-line printed across them ("Recruiters prefer
    short resumes" over "PAGE, TWO MAX.", ITRC lesson 2026-10-22)."""
    css = ck.COMPOSITION_CSS
    rule = '.comp > [class*="comp-"] > *,\n[class*="comp-"] > [class*="comp-"] > * { min-height: auto; }'
    assert rule in css
    # it must come after (and out-rank) the cell rule it narrows
    assert css.index(rule) > css.index('[class*="comp-"] > * { min-width: min-content; min-height: 0; }')


def test_image_clip_takes_the_whole_frame():
    """IMAGE_CLIP embeds the user's screenshot full-frame in its own HTML.

    It was absent from both default maps, so a screenshot-led video (the
    `input_image_screenshot` domain, where IMAGE_CLIP is the PRIMARY shot type)
    had almost every shot told to build a 5-of-12-column text layout on a flat
    brand background — directly contradicting the mandatory full-frame <img>.
    """
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app", "ai-video-gen-main"))
    import shot_planner as sp

    assert ck.default_for("IMAGE_CLIP") == "full_bleed_overlay"
    # media_hero is what earns the repeat exemption below; without it every
    # second screenshot gets reflowed into a column by the no-repeat rule.
    assert sp.SHOT_TYPE_BG_TREATMENT_DEFAULT["IMAGE_CLIP"] == "media_hero"


def test_consecutive_screenshots_all_keep_the_full_frame():
    """The no-repeat rule must not reflow a run of screenshots into columns."""
    shots = [
        {"shot_type": "IMAGE_CLIP", "background_treatment": "media_hero"}
        for _ in range(5)
    ]
    ck.assign_compositions(shots)
    assert [s["composition"] for s in shots] == ["full_bleed_overlay"] * 5


def test_media_contract_cards_keep_their_own_exemplar():
    """Two cards carry a contract in their html_template, not just a layout.

    IMAGE_CLIP's template is the only place `{{IMAGE_URL}}` — the placeholder
    the pipeline rewrites to the user's uploaded image — is taught. SOURCE_CLIP's
    mandates a #000000 background because black is keyed out when the source
    footage is composited behind it.

    Swapping in a composition exemplar replaced both silently. The IMAGE_CLIP
    shot then designed around empty space with no idea an image belonged in it,
    and SOURCE_CLIP painted a background over the footage it was meant to reveal.
    Both already ARE full-bleed compositions, so the exemplar added nothing.
    """
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app", "ai-video-gen-main"))
    import shot_type_cards as stc

    for shot_type, marker in (("IMAGE_CLIP", "{{IMAGE_URL}}"), ("SOURCE_CLIP", "#000000")):
        assert ck.exemplar_for(ck.default_for(shot_type), shot_type) is None, shot_type
        prompt = stc.build_per_shot_system_prompt(
            shot_type, 1920, 1080, aspirational=True, composition="full_bleed_overlay"
        )
        assert marker in prompt, f"{shot_type} lost its contract: {marker}"


def test_non_media_cards_still_get_the_composition_exemplar():
    """The guard must not disable the composition system generally — that is the
    whole mechanism that stopped every shot coming out centre-stacked."""
    for shot_type in ("TEXT_DIAGRAM", "PROCESS_STEPS", "KINETIC_TITLE"):
        assert ck.exemplar_for(ck.default_for(shot_type), shot_type) is not None, shot_type


def test_text_children_cannot_collapse_to_one_character():
    """`min-width: 0` on a .comp child is what permits a grid item to shrink
    below its content width — all the way to one character per line.

    It was added so long labels wrap instead of overflowing, with a min-content
    floor only on `.comp-spine .spine > *`. A pipeline-authored frame with a
    correct `comp comp-spine` container but no `.spine` child therefore had
    nothing protecting it, and its parameter labels rendered vertically, one
    letter each. Media keeps the 0 floor — an image can shrink without
    becoming unreadable; a sentence cannot.
    """
    css = ck.COMPOSITION_CSS
    assert '.comp > *, [class*="comp-"] > * { min-width: min-content; min-height: 0; }' in css
    assert ".comp > * { min-width: 0;" not in css
    for tag in ("img", "video", "svg", "canvas"):
        assert f".comp {tag}" in css or f'[class*="comp-"] {tag}' in css
