"""Unit tests for the IntentRouter visual-preferences free-text scanner.

The scanner is pure-regex / pure-python and has no network or LLM
dependencies, so we exercise it directly. Tests cover:
  - empty / None inputs
  - each family pattern (positive match)
  - each family pattern with negation (no/not/less/avoid/etc.)
  - text density patterns (minimal / low / rich)
  - merge_visual_preferences priority (free-text wins on overlap)
  - polarity tie-breaker (high wins over no when both seen)
  - false-positive non-matches (e.g. "demographic" doesn't match "graphic")

Run with:
    cd ai_service && python tests/test_visual_preferences_scanner.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# The scanner functions are pure-regex / pure-python with no dependencies on
# pydantic / sqlalchemy / FastAPI. The intent_router_service module *does*
# import those at the top, so importing the package normally pulls in the
# whole tree. We bypass that by reading the file source and exec-ing only
# the trailing block that defines our targets — keeps unit tests runnable
# without a fully-installed venv (CI provides one; local dev may not).
AI_SERVICE = Path(__file__).resolve().parent.parent
_SCANNER_SRC = (AI_SERVICE / "app/services/intent_router_service.py").read_text()
_MARKER = "# Visual preferences — free-text scanner"
_scanner_block = _SCANNER_SRC[_SCANNER_SRC.index(_MARKER):]
_ns: dict = {}
exec(  # noqa: S102 — controlled, file-local source
    "from typing import List, Tuple, Optional, Dict\nimport re\n" + _scanner_block,
    _ns,
)
extract_visual_preferences_from_text = _ns["extract_visual_preferences_from_text"]
merge_visual_preferences = _ns["merge_visual_preferences"]

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"

_passed = 0
_failed: list[tuple[str, str]] = []


def assert_eq(name: str, got, expected) -> None:
    global _passed
    if got == expected:
        _passed += 1
        print(f"  {PASS} {name}")
    else:
        _failed.append((name, f"expected {expected!r}, got {got!r}"))
        print(f"  {FAIL} {name}")
        print(f"      expected: {expected!r}")
        print(f"      got:      {got!r}")


def assert_match(name: str, prompt: str, family: str, expected: str | None) -> None:
    """Assert that the scanner's output for `family` on `prompt` is `expected`."""
    out = extract_visual_preferences_from_text(prompt)
    assert_eq(name, out.get(family), expected)


def assert_density(name: str, prompt: str, expected: str | None) -> None:
    out = extract_visual_preferences_from_text(prompt)
    assert_eq(name, out.get("text_density"), expected)


# ─────────────────────────────────────────────────────────────────────────
# Empty / None
# ─────────────────────────────────────────────────────────────────────────
print("\n── empty / None inputs ──")

assert_eq(
    "None input → all None keys",
    extract_visual_preferences_from_text(None),  # type: ignore[arg-type]
    {
        "stock_video": None, "ai_imagery": None, "svg_illustrated": None,
        "motion_graphics": None, "app_ui_mockup": None, "ai_video": None, "text_density": None,
    },
)
assert_eq(
    "empty string → all None keys",
    extract_visual_preferences_from_text(""),
    {
        "stock_video": None, "ai_imagery": None, "svg_illustrated": None,
        "motion_graphics": None, "app_ui_mockup": None, "ai_video": None, "text_density": None,
    },
)
assert_eq(
    "neutral prompt → no flags",
    {k: v for k, v in extract_visual_preferences_from_text(
        "Create a video about quantum mechanics for high school students"
    ).items() if v is not None},
    {},
)


# ─────────────────────────────────────────────────────────────────────────
# stock_video positive matches
# ─────────────────────────────────────────────────────────────────────────
print("\n── stock_video positive ──")

for phrase in [
    "use lots of stock video",
    "include stock footage of cities",
    "real footage of the moon landing",
    "live video clips",
    "use videos for the b-roll",
    "stock clips work well here",
]:
    assert_match(f"'{phrase}' → high", phrase, "stock_video", "high")


# ─────────────────────────────────────────────────────────────────────────
# Negation flips polarity
# ─────────────────────────────────────────────────────────────────────────
print("\n── negation flips polarity ──")

assert_match("'no stock video' → no", "no stock video please", "stock_video", "no")
assert_match("'avoid stock footage' → no", "avoid stock footage in the hook", "stock_video", "no")
assert_match("'less stock video' → no", "use less stock video", "stock_video", "no")
assert_match("'without stock' → no", "without stock footage", "stock_video", "no")
assert_match(
    "'avoid app mockups' → app=no",
    "Avoid app mockups, focus on stock video",
    "app_ui_mockup",
    "no",
)
# Same prompt: stock should be high (not negated)
assert_match(
    "same prompt: stock=high (not negated)",
    "Avoid app mockups, focus on stock video",
    "stock_video",
    "high",
)


# ─────────────────────────────────────────────────────────────────────────
# Polarity tie-breaker: high wins when both seen for same family
# ─────────────────────────────────────────────────────────────────────────
print("\n── polarity tie-breaker ──")

assert_match(
    "high wins over no when both for same family",
    "use stock video here, but avoid stock footage in the outro",
    "stock_video",
    "high",
)


# ─────────────────────────────────────────────────────────────────────────
# ai_imagery
# ─────────────────────────────────────────────────────────────────────────
print("\n── ai_imagery ──")

assert_match("'AI generated images'", "use AI generated images throughout", "ai_imagery", "high")
assert_match("'AI-generated photo'", "I want an AI-generated photo for the hero", "ai_imagery", "high")
assert_match("'generated imagery'", "lots of generated imagery", "ai_imagery", "high")
assert_match("'no AI images'", "no AI images please", "ai_imagery", "no")


# ─────────────────────────────────────────────────────────────────────────
# svg_illustrated
# ─────────────────────────────────────────────────────────────────────────
print("\n── svg_illustrated ──")

assert_match("'infographic'", "make it an infographic", "svg_illustrated", "high")
assert_match("'SVG diagrams'", "use SVG diagrams to explain", "svg_illustrated", "high")
assert_match("'illustrated'", "an illustrated explainer", "svg_illustrated", "high")
assert_match("'sketched'", "with sketched annotations", "svg_illustrated", "high")
assert_match("'hand-drawn'", "in a hand-drawn style", "svg_illustrated", "high")
assert_match("'no diagrams'", "no diagrams; just photos", "svg_illustrated", "no")


# ─────────────────────────────────────────────────────────────────────────
# motion_graphics
# ─────────────────────────────────────────────────────────────────────────
print("\n── motion_graphics ──")

assert_match("'motion graphics'", "use motion graphics for the data", "motion_graphics", "high")
assert_match("'animated chart'", "show an animated chart", "motion_graphics", "high")
assert_match("'animated charts' (plural)", "use animated charts to show growth", "motion_graphics", "high")
assert_match("'kinetic typography'", "kinetic typography for the hook", "motion_graphics", "high")


# ─────────────────────────────────────────────────────────────────────────
# app_ui_mockup
# ─────────────────────────────────────────────────────────────────────────
print("\n── app_ui_mockup ──")

assert_match("'app UI'", "show the app UI in detail", "app_ui_mockup", "high")
assert_match("'mobile app'", "explain the mobile app workflow", "app_ui_mockup", "high")
assert_match("'web app'", "this web app does X", "app_ui_mockup", "high")
assert_match("'app screens'", "walk through the app screens", "app_ui_mockup", "high")
assert_match("'app mockups'", "include some app mockups", "app_ui_mockup", "high")
assert_match("'dashboard mockup'", "show a dashboard mockup", "app_ui_mockup", "high")


# ─────────────────────────────────────────────────────────────────────────
# Text density
# ─────────────────────────────────────────────────────────────────────────
print("\n── text density ──")

assert_density(
    "'no text on screen, just visuals' → minimal (both phrases agree)",
    "no text on screen, just visuals",
    "minimal",
)
assert_density(
    "'no text' alone → minimal",
    "Make it cinematic with no text",
    "minimal",
)
assert_density(
    "'just visuals' → minimal",
    "Just visuals and narration, please",
    "minimal",
)
assert_density(
    "'less text' → low",
    "Use less text on screen",
    "low",
)
assert_density(
    "'minimize text' → low",
    "Minimize text — keep it tight",
    "low",
)
assert_density(
    "'too much text' → low",
    "the previous video had too much text",
    "low",
)
assert_density(
    "'lots of text' → rich",
    "Use lots of text and clear labels",
    "rich",
)
assert_density(
    "'title cards everywhere' → rich",
    "Title cards everywhere",
    "rich",
)
assert_density(
    "neutral text → None",
    "Make a video about photosynthesis",
    None,
)


# ─────────────────────────────────────────────────────────────────────────
# Multi-family in one prompt
# ─────────────────────────────────────────────────────────────────────────
print("\n── multi-family combo ──")

prompt = "I want SVG diagrams, no stock video, less text on screen"
out = extract_visual_preferences_from_text(prompt)
assert_eq(
    f"'{prompt}' multi-family",
    {k: v for k, v in out.items() if v is not None},
    {"svg_illustrated": "high", "stock_video": "no", "text_density": "low"},
)


# ─────────────────────────────────────────────────────────────────────────
# False-positive guards
# ─────────────────────────────────────────────────────────────────────────
print("\n── false-positive guards ──")

# "demographic" contains "graphic" — should NOT match motion_graphics.
# We don't have "graphic" as a bare keyword; we require "motion graphics" or
# "animated chart" etc. So this is a regression sanity check.
assert_eq(
    "'demographic' does not match motion_graphics",
    extract_visual_preferences_from_text("demographic data of users").get("motion_graphics"),
    None,
)
# "no app" without UI keyword should not flip app_ui_mockup.
assert_eq(
    "'there's no app for that' does not match",
    extract_visual_preferences_from_text("There's no app for that").get("app_ui_mockup"),
    None,
)


# ─────────────────────────────────────────────────────────────────────────
# merge_visual_preferences — free-text wins on overlap
# ─────────────────────────────────────────────────────────────────────────
print("\n── merge_visual_preferences ──")

merged = merge_visual_preferences(
    {"stock_video": "high", "svg_illustrated": "no"},
    extract_visual_preferences_from_text("I want SVG diagrams"),  # svg=high
)
assert_eq(
    "free-text svg=high overrides slider svg=no",
    merged["svg_illustrated"],
    "high",
)
assert_eq(
    "slider stock=high preserved (not in free-text)",
    merged["stock_video"],
    "high",
)
assert_eq(
    "untouched key remains None",
    merged["motion_graphics"],
    None,
)

# Empty structured + empty free-text → all keys None
empty = merge_visual_preferences(None, {
    "stock_video": None, "ai_imagery": None, "svg_illustrated": None,
    "motion_graphics": None, "app_ui_mockup": None, "text_density": None,
})
assert_eq(
    "merge of empty inputs yields all-None map",
    empty,
    {
        "stock_video": None, "ai_imagery": None, "svg_illustrated": None,
        "motion_graphics": None, "app_ui_mockup": None, "ai_video": None, "text_density": None,
    },
)


# ─────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────
print()
if _failed:
    print(f"{FAIL} {len(_failed)} failed, {_passed} passed")
    for name, msg in _failed:
        print(f"  - {name}: {msg}")
    sys.exit(1)
print(f"{PASS} {_passed} tests passed")
