"""
Generic pages (no design source, none of this month's opt-in widgets) and the
standard-mode verdicts the review, audit and form summaries gave them BEFORE
fidelity mode and the widget capture surfaces existed.

``standard_snapshot()`` is what test_website_fidelity_review compares against
fidelity_corpus_golden.json, which was produced by running the same function
on origin/main (4a6aebee84), before this change. If a deliberate change to the
standard review moves one of these, regenerate it and say why in the commit.
"""
from typing import Any, Dict, List


def _good_page() -> Dict[str, Any]:
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


def generic_pages() -> List[Dict[str, Any]]:
    """(name, page, page_type) for the review corpus."""
    thin = {"route": "home", "components": [
        {"id": "hero", "type": "heroSection", "props": {"layout": "split", "left": {"title": "Welcome to our platform where learning meets excellence and every student thrives every day", "subheading": "x"}}},
        {"id": "text", "type": "textBlock", "props": {"content": "<p>" + "word " * 260 + "</p>"}},
        {"id": "stats", "type": "statsHighlights", "props": {"headerText": "Numbers", "stats": [{"label": "Learners", "value": "many"}]}},
    ]}
    one_section = {"route": "home", "components": [
        {"id": "hero", "type": "heroSection", "props": {"layout": "centered", "left": {"title": "Learn with us", "buttons": [{"text": "Enquire", "action": "openForm", "audienceId": "c1"}]}}},
    ]}
    coming_soon = _good_page()
    coming_soon["components"][2]["props"]["features"][0]["title"] = "Crash course coming soon"
    courses = {"route": "courses", "components": [
        {"id": "cat", "type": "courseCatalog", "props": {"title": "All courses", "showFilters": True}},
        # Not the "band" variant: secondaryButton is not drawn, so it is no form.
        {"id": "cta", "type": "ctaBanner", "props": {"heading": "Need help choosing?", "button": {"text": "Talk to us", "action": "openForm", "audienceId": ""},
                                                       "secondaryButton": {"text": "Call us", "action": "openForm"}}},
    ]}
    # Two learningPath sections with the same heading but no design source:
    # still a duplicate heading in standard mode.
    paths = {"route": "learning-paths", "components": [
        {"id": "p1", "type": "learningPath", "props": {"title": "Pick a path", "productPageCode": "abc"}},
        {"id": "p2", "type": "learningPath", "props": {"title": "Pick a path", "mode": "list", "libraryId": "lib"}},
    ]}
    placeholder_key = {"route": "about", "components": [
        {"id": "nl", "type": "newsletterSignup", "props": {"title": "Stay in touch", "placeholder": "placeholder text"}},
    ]}
    return [
        ("good", _good_page(), "homepage"),
        ("thin", thin, "homepage"),
        ("one-section", one_section, "homepage"),
        ("coming-soon", coming_soon, "homepage"),
        ("courses", courses, "course-landing"),
        ("paths", paths, "about"),
        ("placeholder-key", placeholder_key, "about"),
    ]


def standard_snapshot(review_with_audit, review_page, audit_page, sample_config,
                      collect_capture_surfaces, run_publish_checks) -> Dict[str, Any]:
    out: Dict[str, Any] = {"review": {}, "beauty": {}, "audit": {}}
    for name, page, page_type in generic_pages():
        r = review_with_audit(page, {"theme": {"primaryColor": "#0F766E"}}, page_type)
        out["review"][name] = [r["score"], r["passes"], [[i["kind"], i["code"], i.get("component_id")] for i in r["issues"]]]
        b = review_page(page, None, page_type)
        out["beauty"][name] = [b["score"], b["passes"], [[i["kind"], i["code"]] for i in b["issues"]]]
        out["audit"][name] = [[i["severity"], i["code"], i["message"]] for i in audit_page(page, None, page_type=page_type)]
    config = sample_config()
    for i, page in enumerate(config["pages"]):
        r = review_with_audit(page, config["globalSettings"], "homepage" if i == 0 else "about")
        out["review"]["sample:" + page["route"]] = [r["score"], r["passes"], [[x["kind"], x["code"], x.get("component_id")] for x in r["issues"]]]
    out["surfaces"] = collect_capture_surfaces(config)
    out["publish_checks"] = run_publish_checks(config)
    corpus = {"pages": [{**page, "id": name, "route": name} for name, page, _ in generic_pages()]}
    out["corpus_surfaces"] = collect_capture_surfaces(corpus)
    out["corpus_publish_checks"] = run_publish_checks(corpus)
    return out
