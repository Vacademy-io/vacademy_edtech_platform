"""The site palette and content width survive every AI path that re-clamps the
theme (live bug, 2026-10-10: "Add page with AI" or "make the corners sharper"
wiped Brahm Varchas's 16-colour palette and its 1152 px content width).

  * /v1/generate and /v1/site pin `_coerce_global_settings(site theme)` and the
    wizard shallow-merges the result over globalSettings — replacing `theme`;
  * /v1/site-chrome `_merge_chrome` assigns the clamp's `theme` back.

A site WITHOUT a palette or width must come out exactly as before."""
import copy
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

pb = pytest.importorskip("app.routers.page_builder")

_FIXTURE = (Path(__file__).resolve().parents[2] / "frontend-admin-dashboard" / "src" / "routes" / "manage-pages"
            / "-components" / "__fixtures__" / "brahm-varchas-site.json")


@pytest.fixture
def bv():
    if not _FIXTURE.exists():
        pytest.skip("Brahm Varchas fixture not in this checkout")
    return json.loads(_FIXTURE.read_text())["globalSettings"]


def _wizard_apply(site_gs, pinned):
    """editor-store updateGlobalSettings: a SHALLOW merge."""
    return {**site_gs, **pinned}


def test_generate_and_site_pin_keep_the_palette(bv):
    # AiPageWizard sends {theme, fonts, motion} as global_settings ("keep my theme").
    pinned = pb._coerce_global_settings({k: bv[k] for k in ("theme", "fonts", "motion")})
    assert pinned["theme"]["palette"] == bv["theme"]["palette"]  # values as authored (no re-casing)
    assert pinned["theme"]["contentMaxWidth"] == 1152
    applied = _wizard_apply(bv, pinned)
    assert applied["theme"] == bv["theme"]
    assert applied["fonts"] == bv["fonts"] and applied["motion"] == bv["motion"]


def test_chrome_edit_keeps_the_palette(bv):
    merged = pb._merge_chrome(bv, {"theme": {"borderRadius": "sharp"}}, [])
    assert merged["theme"]["borderRadius"] == "sharp"
    assert merged["theme"]["palette"] == bv["theme"]["palette"]
    assert merged["theme"]["contentMaxWidth"] == 1152
    assert merged["theme"]["primaryColor"] == "#883000"
    # Everything the chrome editor may not touch is untouched.
    for key in bv:
        if key not in ("theme", "fonts", "motion"):
            assert merged[key] == bv[key], key


def test_chrome_palette_edits_merge_per_colour(bv):
    merged = pb._merge_chrome(bv, {"theme": {"palette": {"accent": "#AA5500", "gold": None, "bogus key": "#000000",
                                                       "olive": "olive"}}}, [])
    pal = merged["theme"]["palette"]
    assert pal["accent"] == "#AA5500" and "gold" not in pal
    assert pal["olive"] == bv["theme"]["palette"]["olive"]  # a non-hex value never replaces a colour
    assert "bogus key" not in pal and pal["text"] == bv["theme"]["palette"]["text"]
    assert pal["applyToTokens"] is True
    cleared = pb._merge_chrome(bv, {"theme": {"palette": None, "contentMaxWidth": None}}, [])
    assert "palette" not in cleared["theme"] and "contentMaxWidth" not in cleared["theme"]


@pytest.mark.parametrize("raw,expected", [
    (1152, 1152), ("1200", 1200), (1151.6, 1152), (1151.5, 1152), (320, 320), (2400, 2400),
    (5000, None), (100, None), (2400.6, None), ("1100px", None),
])
def test_content_width_follows_the_renderer_rule(raw, expected):
    # resolveContentMaxWidth: Math.round, then 320–2400 or nothing — never a clamp.
    out = pb._coerce_global_settings({"theme": {"contentMaxWidth": raw}})
    assert out["theme"].get("contentMaxWidth") == expected


def test_an_out_of_range_width_is_not_narrowed_by_an_unrelated_edit():
    # The renderer ignores 3000 (default width); clamping it to 2400 on "make
    # corners sharp" visibly narrowed the page.
    merged = pb._merge_chrome({"theme": {"contentMaxWidth": 3000}}, {"theme": {"borderRadius": "sharp"}}, [])
    assert merged["theme"].get("contentMaxWidth") is None


def test_the_model_cannot_add_a_palette_or_width_to_a_site_without_one():
    proposal = {"theme": {"preset": "ocean", "palette": {"canvas": "#000000", "applyToTokens": True},
                          "contentMaxWidth": 1000}}
    # Unpinned /v1/generate: the model's own globalSettings.
    out = pb._coerce_global_settings(copy.deepcopy(proposal), model_proposed=True)
    assert "palette" not in out["theme"] and "contentMaxWidth" not in out["theme"]
    # /v1/site-chrome on a site with neither.
    site = {"theme": {"preset": "forest", "borderRadius": "rounded"}}
    merged = pb._merge_chrome(site, copy.deepcopy(proposal), [])
    assert "palette" not in merged["theme"] and "contentMaxWidth" not in merged["theme"]
    assert merged["theme"]["preset"] == "ocean"  # the rest of the proposal still applies
    # The same settings sent by the CALLER (a pinned theme) are the admin's own.
    pinned = pb._coerce_global_settings(copy.deepcopy(proposal))
    assert pinned["theme"]["palette"] == {"canvas": "#000000", "applyToTokens": True}
    assert pinned["theme"]["contentMaxWidth"] == 1000


def test_the_model_may_edit_a_palette_and_width_the_site_has(bv):
    merged = pb._merge_chrome(bv, {"theme": {"palette": {"accent": "#AA5500"}, "contentMaxWidth": 1280}}, [])
    assert merged["theme"]["palette"]["accent"] == "#AA5500"
    assert merged["theme"]["contentMaxWidth"] == 1280


def test_junk_width_keeps_the_sites_own():
    out = pb._coerce_global_settings({"theme": {"contentMaxWidth": "wide"}}, base={"theme": {"contentMaxWidth": 1152}})
    assert out["theme"]["contentMaxWidth"] == 1152
    out = pb._coerce_global_settings({"theme": {"contentMaxWidth": True}})
    assert "contentMaxWidth" not in out["theme"]


def test_palette_values_are_validated():
    out = pb._coerce_global_settings({"theme": {"palette": {
        "text": "#1a1208", "body": "#abc", "muted": "red", "canvas": "url(javascript:x)", "applyToTokens": "yes",
        "customBrand": "#123456", "<script>": "#000000",
    }}})
    assert out["theme"]["palette"] == {"text": "#1a1208", "body": "#abc", "customBrand": "#123456"}
    assert "palette" not in pb._coerce_global_settings({"theme": {"palette": {"muted": "red"}}})["theme"]


def test_a_site_without_palette_or_width_is_unchanged():
    gs = {"theme": {"preset": "ocean", "borderRadius": "pill", "primaryColor": "#2255AA"},
          "fonts": {"family": "Poppins"}, "motion": {"personality": "lively"}}
    before = copy.deepcopy(gs)
    out = pb._coerce_global_settings(gs)
    assert gs == before
    assert set(out["theme"]) == {"preset", "atmosphere", "headingScale", "borderRadius", "primaryColor"}
    merged = pb._merge_chrome(gs, {"theme": {"borderRadius": "sharp"}}, [])
    assert set(merged["theme"]) == {"preset", "atmosphere", "headingScale", "borderRadius", "primaryColor"}
    # A model's own proposal (no base) gains nothing it did not send.
    assert set(pb._coerce_global_settings({"theme": {"preset": "forest"}})["theme"]) == {
        "preset", "atmosphere", "headingScale", "borderRadius"}
