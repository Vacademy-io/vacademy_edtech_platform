"""The beauty review: opinionated, actionable, scored."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.catalogue_summary import find_text, visual_summary  # noqa: E402
from app.services.page_quality import SCORE_BAR, review_page, review_with_audit  # noqa: E402

from test_website_tools import sample_config  # noqa: E402


def good_page():
    return {"route": "home", "components": [
        {"id": "hero", "type": "heroSection", "props": {"layout": "centered", "eyebrow": {"text": "Admissions open", "style": "badge"},
         "left": {"title": "Crack NEET 2027 with us", "subheading": "Small batches, daily doubts.",
                  "buttons": [{"text": "Book a demo", "action": "openForm", "audienceId": "c1"}, {"text": "See batches", "action": "navigate", "target": "#courses"}]}},
         "style": {"backgroundColor": "#FFF7ED", "layout": {"width": "full"}}},
        {"id": "proof", "type": "statsHighlights", "props": {"headerText": "Results", "stats": [{"label": "Selections", "value": "92%"}, {"label": "Years", "value": "14"}, {"label": "Batch", "value": "25"}]},
         "style": {"backgroundColor": "#0F766E"}},
        {"id": "why", "type": "featureGrid", "props": {"headerText": "Why us", "features": [{"title": "A"}, {"title": "B"}, {"title": "C"}]}},
        {"id": "courses", "type": "courseShowcase", "props": {"title": "Batches", "source": "newest", "limit": 3}},
        {"id": "how", "type": "stepsProcess", "props": {"headerText": "How it works", "steps": [{"title": "1"}, {"title": "2"}, {"title": "3"}]}},
        {"id": "quotes", "type": "testimonialSection", "props": {"headerText": "Parents say", "testimonials": [{"quote": "Great", "name": "R"}, {"quote": "Good", "name": "S"}]}},
        {"id": "cta", "type": "ctaBanner", "props": {"heading": "Ready?", "button": {"text": "Enquire", "action": "openForm", "audienceId": "c1"}}, "style": {"backgroundLayers": [{"type": "linear", "from": "#0F766E", "to": "#115E59"}]}},
    ]}


def test_a_well_built_landing_page_passes():
    r = review_page(good_page(), {"theme": {"primaryColor": "#0F766E"}}, "homepage")
    assert r["passes"] and r["score"] >= SCORE_BAR, r["issues"]
    assert r["bar"] == SCORE_BAR


def test_a_flat_thin_page_fails_with_concrete_fixes():
    page = {"route": "home", "components": [
        {"id": "hero", "type": "heroSection", "props": {"layout": "split", "left": {"title": "Welcome to our platform where learning meets excellence and every student thrives every day", "subheading": "x"}}},
        {"id": "text", "type": "textBlock", "props": {"content": "<p>" + "word " * 260 + "</p>"}},
        {"id": "stats", "type": "statsHighlights", "props": {"headerText": "Numbers", "stats": [{"label": "Learners", "value": "many"}]}},
    ]}
    r = review_page(page, None, "homepage")
    codes = {i["code"] for i in r["issues"]}
    assert not r["passes"] and r["score"] < SCORE_BAR
    assert {"too-few-sections", "no-conversion", "hero-headline-long", "hero-no-cta", "hero-split-no-image",
            "wall-of-text", "stats-no-numbers", "placeholder-copy"} <= codes
    # fix items first, and every issue tells the model what to do
    assert r["issues"][0]["kind"] == "fix" and all(i["fix"] for i in r["issues"])
    assert any(i.get("component_id") == "hero" for i in r["issues"])


def test_rhythm_rules():
    page = good_page()
    page["components"].insert(3, {"id": "why2", "type": "featureGrid", "props": {"headerText": "More", "features": [{"title": "A"}, {"title": "B"}, {"title": "C"}, {"title": "D"}, {"title": "E"}]}})
    for c in page["components"]:
        c.pop("style", None)
    r = review_page(page, None, "homepage")
    codes = {i["code"] for i in r["issues"]}
    assert {"adjacent-twins", "flat-page", "unstyled", "grid-count"} <= codes


def test_too_many_accent_colours_is_flagged_but_neutrals_are_not():
    page = good_page()
    for c, col in zip(page["components"], ["#FFF7ED", "#0F766E", "#1D4ED8", "#DC2626", "#7C3AED", "#F3F4F6", "#111827"]):
        c["style"] = {"backgroundColor": col}
    r = review_page(page, {"theme": {"primaryColor": "#0F766E"}}, "homepage")
    assert any(i["code"] == "too-many-colours" for i in r["issues"])


def test_review_merges_the_builder_audit_without_duplicates():
    r = review_with_audit(good_page(), {"theme": {"primaryColor": "#0F766E"}}, "homepage")
    codes = [i["code"] for i in r["issues"]]
    assert len(codes) == len(set(codes))


def test_html_pages_are_reviewed_lightly():
    page = {"route": "x", "components": [{"id": "h", "type": "htmlPage", "props": {"html": "<h1>Hi</h1>", "css": ""}}]}
    r = review_page(page, None, "homepage")
    assert [i["code"] for i in r["issues"]] == ["html-thin"]


# ── screenshot-driven edits: positions, looks, find_section ──────────────
def test_visual_summary_reads_like_a_description():
    hero = good_page()["components"][0]
    looks = visual_summary(hero)
    assert "band #FFF7ED" in looks and "layout centered" in looks and 'buttons: "Book a demo" / "See batches"' in looks and "full width" in looks
    cta = good_page()["components"][6]
    assert visual_summary(cta).startswith("gradient band")


def test_find_text_returns_the_exact_prop_path():
    hits = find_text(sample_config(), "book a demo")
    assert hits and hits[0]["section_id"] == "c-hero" and hits[0]["path"] == "props.left.buttons[0].text" and hits[0]["position"] == 2
    hits = find_text(sample_config(), "why us")
    assert hits[0]["section_id"] == "c-text" and hits[0]["is_html"] is True and "Why us" in hits[0]["snippet"]
    assert find_text(sample_config(), "why us", page_route="about") == []
    assert find_text(sample_config(), "") == []


def test_preview_presents_the_wanted_page_as_root():
    from app.services.page_preview import _as_root_page
    cfg = sample_config()
    out = _as_root_page(cfg, "about")
    assert out["pages"][0]["route"] == "homepage" and out["pages"][0]["id"] == "home"
    assert out["pages"][0]["components"][0]["id"] == "c-cols"          # the about page, ids untouched
    assert [p["route"] for p in out["pages"][1:]] == ["home"]
    assert cfg["pages"][1]["route"] == "about"                           # input untouched
