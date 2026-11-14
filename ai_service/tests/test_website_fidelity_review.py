"""
Review fidelity mode and the opt-in widgets' forms.

A page built from a design (Figma, a screenshot) carries ``meta.designSource``;
review then judges it in FIDELITY mode: the design wins over the landing-page
taste rules, and only what a visitor would see as broken still counts. The
Brahm Varchas site (the real site that uses every new widget) is the golden:
all three pages must pass in that mode. Everything else — generic pages, their
review verdicts, their forms — must come out exactly as before
(fidelity_corpus_golden.json was produced on origin/main).
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.mcp.server import SERVER_INSTRUCTIONS  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tools_website_edit import clean_design_source  # noqa: E402
from app.services.catalogue_summary import (  # noqa: E402
    capture_surfaces,
    collect_capture_surfaces,
    run_publish_checks,
)
from app.services.page_audit import audit_page  # noqa: E402
from app.services.page_quality import (  # noqa: E402
    SCORE_BAR,
    content_page_type,
    review_mode,
    review_page,
    review_with_audit,
)

import fidelity_corpus  # noqa: E402
from test_website_tools import _FakeDb, fake_admin_core, principal, sample_config  # noqa: E402
from app.services.assistant_tool_registry import ToolContext  # noqa: E402

BV_PATH = (Path(__file__).resolve().parents[2] / "frontend-admin-dashboard" / "src" / "routes" / "manage-pages"
           / "-components" / "__fixtures__" / "brahm-varchas-site.json")
GOLDEN_PATH = Path(__file__).resolve().parent / "fidelity_corpus_golden.json"

BV_TALK = "f8814f46-a9ec-4e1a-b98f-0ca50d9e8325"
BV_NOTIFY = "c103a5e0-b79f-43f0-8883-66cffdd134d7"
BV_NEWSLETTER = "7bffbbd1-3e58-49e4-846a-30dee15f453a"

FIGMA_URL = "https://www.figma.com/design/AbCdEf0123456789xyz/Brahm-Varchas?node-id=1-247&t=SHARETOKEN123&m=dev"


def bv_site():
    if not BV_PATH.exists():
        pytest.skip("Brahm Varchas fixture not in this checkout")
    return json.loads(BV_PATH.read_text())


def _issues(r, kind=None):
    return [i["code"] for i in r["issues"] if kind is None or i["kind"] == kind]


# ── the golden: Brahm Varchas passes in fidelity mode ────────────────────
def test_brahm_varchas_passes_on_every_page_in_fidelity_mode():
    site = bv_site()
    assert [p["route"] for p in site["pages"]] == ["home", "courses", "learning-paths"]
    for i, page in enumerate(site["pages"]):
        page_type, fidelity = review_mode(page, None, True)
        page_type = page_type or ("homepage" if i == 0 else "about")
        r = review_with_audit(page, site["globalSettings"], page_type, fidelity=fidelity)
        assert r["score"] >= SCORE_BAR and r["passes"], (page["route"], r["issues"])
        assert not _issues(r, "fix"), page["route"]
        assert r["mode"] == "fidelity"


def test_brahm_varchas_is_a_catalog_page_and_its_hero_and_stats_count():
    site = bv_site()
    home, courses, paths = site["pages"]
    assert content_page_type(home) == content_page_type(courses) == "catalog"
    assert content_page_type(paths) is None                     # heroSection page: the caller's guess stands
    # Even judged as a landing page, the catalogue hero is the hero and its live stats are the proof.
    r = review_page(home, site["globalSettings"], "homepage")
    assert "no-hero" not in _issues(r) and "no-proof" not in _issues(r)
    # Standard mode still holds the design to the landing rules it does not meet.
    assert not review_with_audit(home, site["globalSettings"], "homepage")["passes"]


def test_review_roles_come_from_the_pattern_registry(monkeypatch, tmp_path):
    from app.services import page_quality
    parts, whole = page_quality._review_roles()
    assert dict(parts["courseCatalog"])["hero"] == {"hero", "proof"}     # catalog.hero reviewAs
    assert "hero" in whole["heroSection"]                                # hero.editorial
    # No catalog export: the built-in roles keep the review working the same way.
    page_quality._review_roles.cache_clear()
    monkeypatch.setattr(page_quality, "_CATALOG_PATH", tmp_path / "missing.json")
    try:
        home = bv_site()["pages"][0]
        r = review_page(home, bv_site()["globalSettings"], "homepage")
        assert "no-hero" not in _issues(r) and "no-proof" not in _issues(r)
    finally:
        page_quality._review_roles.cache_clear()


def test_a_catalogue_hero_without_a_title_is_still_flagged():
    page = copy.deepcopy(bv_site()["pages"][0])
    page["components"][0]["props"]["hero"]["title"] = ""
    r = review_with_audit(page, None, "catalog", fidelity=True)
    assert "hero-no-headline" in _issues(r, "fix") and not r["passes"]


# ── generic pages: unchanged ─────────────────────────────────────────────
def test_generic_pages_review_and_forms_exactly_as_before():
    golden = json.loads(GOLDEN_PATH.read_text())
    now = fidelity_corpus.standard_snapshot(review_with_audit, review_page, audit_page, sample_config,
                                            collect_capture_surfaces, run_publish_checks)
    assert json.loads(json.dumps(now, sort_keys=True)) == golden


def test_a_one_section_generic_landing_page_without_a_design_still_fails():
    one = next(p for name, p, _ in fidelity_corpus.generic_pages() if name == "one-section")
    assert review_mode(one) == (None, False)
    r = review_with_audit(one, None, "homepage")
    assert not r["passes"] and "too-few-sections" in _issues(r, "fix")
    assert "mode" not in r


def test_explicit_arguments_win_over_the_page_meta():
    page = {"route": "x", "meta": {"designSource": {"kind": "figma"}, "pageType": "catalog"}, "components": []}
    assert review_mode(page) == ("catalog", True)
    assert review_mode(page, "about", False) == ("about", False)
    assert review_mode(page, "not-a-type") == ("catalog", True)
    assert review_mode({"components": []}, None, True) == (None, True)


# ── fidelity keeps the correctness rules ─────────────────────────────────
def test_fidelity_mode_still_fails_what_a_visitor_sees_broken():
    page = {"route": "home", "components": [
        {"id": "grid", "type": "featureGrid", "props": {"headerText": "Why", "features": []}},
        {"id": "cta", "type": "ctaBanner", "props": {"heading": "Join", "button": {"text": ""}}},
        {"id": "path", "type": "learningPath", "props": {"title": "Paths", "mode": "list"}},
        {"id": "dim", "type": "ctaBanner", "props": {"heading": "Hi", "button": {"text": "Go"}, "textColor": "#777777", "backgroundColor": "#888888"}},
        {"id": "copy", "type": "textBlock", "props": {"content": "<p>Lorem ipsum dolor sit amet</p>"}},
    ]}
    r = review_with_audit(page, None, "homepage", fidelity=True)
    codes = set(_issues(r))
    assert {"empty-section", "cta-no-button", "path-unbound", "low-contrast", "placeholder-copy"} <= codes
    assert not r["passes"]
    # ...while the taste rules are gone.
    assert not codes & {"too-few-sections", "no-hero", "no-proof", "weak-ending", "too-short", "unstyled", "flat-page"}


def test_fidelity_placeholder_check_reads_only_visible_text():
    page = {"route": "home", "components": [
        {"id": "soon", "type": "featureGrid", "props": {"headerText": "Coming soon", "features": [
            {"title": "Sanskrit", "image": "https://cdn.example.org/placeholder.png", "iconName": "Placeholder"},
            {"title": "Ganit"}, {"title": "Khagol"}]}},
    ]}
    r = review_with_audit(page, None, "homepage", fidelity=True)
    assert "placeholder-copy" not in _issues(r)
    # Standard mode is unchanged: "coming soon" and a placeholder image name both count there.
    assert "placeholder-copy" in _issues(review_with_audit(page, None, "homepage"))
    page["components"][0]["props"]["features"][1]["title"] = "Your institute name"
    assert "placeholder-copy" in _issues(review_with_audit(page, None, "homepage", fidelity=True), "fix")


def test_split_learning_paths_are_not_a_duplicate_heading_in_fidelity_mode_only():
    paths = next(p for name, p, _ in fidelity_corpus.generic_pages() if name == "paths")
    assert "duplicate-heading" in [i["code"] for i in audit_page(paths, None, page_type="about")]
    assert "duplicate-heading" not in [i["code"] for i in audit_page(paths, None, page_type="about", fidelity=True)]
    twins = {"route": "x", "components": [
        {"id": "a", "type": "featureGrid", "props": {"headerText": "Why us", "features": [{"title": "A"}]}},
        {"id": "b", "type": "featureGrid", "props": {"headerText": "Why us", "features": [{"title": "B"}]}},
    ]}
    assert "duplicate-heading" in [i["code"] for i in audit_page(twins, None, fidelity=True)]


# ── design_source ────────────────────────────────────────────────────────
def test_design_source_keeps_only_the_link_and_the_frame():
    ds = clean_design_source({"url": FIGMA_URL, "frame": "<b>Courses</b>"})
    assert ds == {"kind": "figma", "url": "https://www.figma.com/design/AbCdEf0123456789xyz/Brahm-Varchas?node-id=1-247",
                  "fileKey": "AbCdEf0123456789xyz", "nodeId": "1:247", "frame": "Courses"}
    assert "SHARETOKEN" not in json.dumps(ds)
    creds = clean_design_source("https://user:secret@www.figma.com/file/AbCdEf0123456789xyz/x#frag")
    assert creds["url"] == "https://www.figma.com/file/AbCdEf0123456789xyz/x" and "secret" not in json.dumps(creds)
    assert clean_design_source({"url": "https://example.org/shot.png?sig=abc", "kind": "screenshot"}) == {
        "kind": "screenshot", "url": "https://example.org/shot.png"}
    assert clean_design_source({"url": "http://www.figma.com/design/AbCdEf0123456789xyz/x"}) is None
    assert clean_design_source({"url": "javascript:alert(1)"}) is None
    assert clean_design_source({"kind": "figma", "node_id": "12-34"}) == {"kind": "figma", "nodeId": "12:34"}
    assert clean_design_source(None) is None and clean_design_source(42) is None and clean_design_source({}) is None


def ctx():
    return ToolContext(db=_FakeDb(), principal=principal(), keys=(), bearer_token="jwt")


class _Saves:
    def __init__(self):
        self.saved = []
        self.created = []


def _campaign(cid, name, status="ACTIVE"):
    return {"id": cid, "campaign_name": name, "status": status, "campaign_type": "WEBSITE",
            "institute_id": "inst-1", "institute_custom_fields": []}


BV_CAMPAIGNS = {
    BV_TALK: _campaign(BV_TALK, "Talk to us"),
    BV_NOTIFY: _campaign(BV_NOTIFY, "Notify me"),
    BV_NEWSLETTER: _campaign(BV_NEWSLETTER, "Knowledge Streams – Newsletter"),
    "camp-old": _campaign("camp-old", "Closed", status="INACTIVE"),
}


@pytest.fixture
def bv_backend(monkeypatch):
    """admin-core serving the Brahm Varchas site as 'main-site', recording draft saves."""
    site = bv_site()
    row = {"id": "cat-bv", "tag_name": "main-site", "status": "ACTIVE", "is_default": True,
           "catalogue_json": json.dumps(site), "updated_at": "2026-10-09T10:00:00"}
    rec = _Saves()
    rec.row = row
    base = fake_admin_core([])

    async def _call(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/course-catalogue/institute/get-all"):
            rows = [row] + [{"id": f"cat-new-{i}", "tag_name": c["tag_name"], "status": "DRAFT", "is_default": False,
                             "catalogue_json": c["catalogue_json"]} for i, c in enumerate(rec.created)]
            return rows
        if path.endswith("/course-catalogue/institute/get/by-tag"):
            if params["tagName"] == "main-site":
                return row
            for i, c in enumerate(rec.created):
                if c["tag_name"] == params["tagName"]:
                    return {"id": f"cat-new-{i}", "tag_name": c["tag_name"], "status": "DRAFT", "is_default": False,
                            "catalogue_json": c["catalogue_json"]}
            return {"error": "fetch_failed", "status": 404}
        if path.endswith("/revision/save-draft"):
            rec.saved.append(json.loads(body["catalogue_json"]))
            return {"id": f"rev-{len(rec.saved)}", "revision_no": 10 + len(rec.saved), "status": "DRAFT"}
        if path.endswith("/course-catalogue/create"):
            rec.created.append(body["catalogues"][0])
            return {"ok": True}
        if path.endswith("/audience/campaigns"):
            return {"content": list(BV_CAMPAIGNS.values()), "total_elements": len(BV_CAMPAIGNS)}
        if "/open/v1/audience/campaign/inst-1/" in path:
            return BV_CAMPAIGNS.get(path.rsplit("/", 1)[-1]) or {"error": "fetch_failed", "status": 404}
        return await base(ctx_, method, path, params=params, body=body, timeout=timeout)

    monkeypatch.setattr(website_data, "_admin_core_json", _call)
    monkeypatch.setattr(website_mod, "_admin_core_json", _call)
    monkeypatch.setattr(edit_mod, "_admin_core_json", _call)
    return rec


async def website(args):
    return json.loads(await website_mod.execute_website(args, ctx()))


async def edit(args):
    return json.loads(await edit_mod.execute_website_edit(args, ctx()))


@pytest.mark.asyncio
async def test_review_action_takes_fidelity_and_page_type(bv_backend):
    out = await website({"action": "review", "tag_name": "main-site", "fidelity": True})
    assert out["passes"] is True and out["score"] >= 85, out["pages"]
    assert {r: (p["mode"], p["page_type"]) for r, p in out["pages"].items()} == {
        "home": ("fidelity", "catalog"), "courses": ("fidelity", "catalog"), "learning-paths": ("fidelity", "about")}
    assert "never add sections" in out["next"]
    std = await website({"action": "review", "tag_name": "main-site"})
    assert std["passes"] is False and "mode" not in std["pages"]["home"]
    one = await website({"action": "review", "tag_name": "main-site", "page_route": "learning-paths",
                         "page_type": "homepage", "fidelity": True})
    assert one["pages"]["learning-paths"]["page_type"] == "homepage" and one["passes"] is True


@pytest.mark.asyncio
async def test_create_page_with_a_design_source_is_reviewed_in_fidelity_mode(bv_backend, monkeypatch):
    page = copy.deepcopy(bv_site()["pages"][0])
    page["route"] = "home-figma"
    out = await edit({"action": "create_page", "tag_name": "main-site", "page": page,
                      "design_source": {"url": FIGMA_URL, "frame": "Courses"}})
    assert out["saved_as"] == "draft" and out["review_mode"] == "fidelity"
    assert out["quality"]["mode"] == "fidelity" and out["quality"]["passes"] is True, out["quality"]
    assert not [i for i in out["design_issues"] if i["severity"] == "error"], out["design_issues"]
    saved = bv_backend.saved[-1]["pages"][-1]
    # The published catalogue JSON is public: the page keeps kind / node / frame, never the link or file key.
    assert saved["meta"] == {"designSource": {"kind": "figma", "nodeId": "1:247", "frame": "Courses"}, "pageType": "catalog"}
    assert "AbCdEf0123456789xyz" not in json.dumps(bv_backend.saved[-1]) and "figma.com" not in json.dumps(bv_backend.saved[-1])
    # ...while the caller gets back what it sent, cleaned, and is told so.
    assert out["design_source"]["fileKey"] == "AbCdEf0123456789xyz" and "NOT stored" in out["design_source_note"]
    # The website review picks the mode up from the page itself.
    async def _draft(ctx_, catalogue_id):
        return {"id": "rev-d", "revision_no": 7, "source": "AI_COPILOT", "catalogue_json": json.dumps(bv_backend.saved[-1])}
    monkeypatch.setattr(website_data, "get_draft", _draft)
    r = await website({"action": "review", "tag_name": "main-site", "page_route": "home-figma"})
    assert r["pages"]["home-figma"]["mode"] == "fidelity" and r["passes"] is True
    # update_page keeps the design and keeps auditing in its mode.
    upd = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "home-figma",
                      "ops": [{"op": "update", "id": "home-not-sure", "propsPatch": {"heading": "Still not sure?"}}]})
    assert upd["quality"]["mode"] == "fidelity"
    assert bv_backend.saved[-1]["pages"][-1]["meta"]["designSource"]["kind"] == "figma"


@pytest.mark.asyncio
async def test_create_page_without_a_design_source_is_unchanged(bv_backend):
    page = {"route": "plain", "components": [{"id": "t", "type": "textBlock", "props": {"content": "<p>Hello there</p>"}}]}
    out = await edit({"action": "create_page", "tag_name": "main-site", "page": page})
    assert "review_mode" not in out and "mode" not in out["quality"]
    assert "meta" not in bv_backend.saved[-1]["pages"][-1]


@pytest.mark.asyncio
async def test_create_site_with_a_design_source_marks_every_page(bv_backend):
    pages = copy.deepcopy(bv_site()["pages"])
    out = await edit({"action": "create_site", "new_site_name": "bv-figma", "pages": pages,
                      "design_source": {"kind": "figma", "url": FIGMA_URL}})
    assert out["created_site"] is True and out["review_mode"] == "fidelity"
    created = json.loads(bv_backend.created[0]["catalogue_json"])
    assert [p["meta"]["pageType"] for p in created["pages"]] == ["catalog", "catalog", "about"]
    assert all(p["meta"]["designSource"] == {"kind": "figma", "nodeId": "1:247"} for p in created["pages"])
    assert "AbCdEf0123456789xyz" not in json.dumps(created) and "AbCdEf0123456789xyz" not in json.dumps(bv_backend.saved[-1])
    # No error-level design issue on any page of the faithful site.
    for route, issues in (out.get("design_issues") or {}).items():
        assert not [i for i in issues if i["severity"] == "error"], (route, issues)


def test_server_instructions_point_reviews_at_the_creation_mode():
    assert "until review passes in the mode the page was created in" in SERVER_INSTRUCTIONS
    assert "design_source" in SERVER_INSTRUCTIONS and "fidelity" in SERVER_INSTRUCTIONS


# ── B5: the new widgets' forms ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_lead_summary_lists_every_brahm_varchas_campaign(bv_backend):
    out = await website({"action": "lead_summary", "tag_name": "main-site"})
    assert {f["campaign_id"] for f in out["forms"]} == {BV_TALK, BV_NOTIFY, BV_NEWSLETTER}
    assert out["forms_without_campaign"] == []
    footer = next(f for f in out["forms"] if f["campaign_id"] == BV_NEWSLETTER)
    assert footer["section_id"] == "footer" and footer["page_route"] is None
    assert footer["surface_path"] == "props.newsletter.audienceId"
    second = [f for f in out["forms"] if f.get("surface_path") == "props.secondaryButton.audienceId"]
    assert {f["page_route"] for f in second} == {"home", "courses", "learning-paths"}
    notify = [f for f in out["forms"] if f["surface"] == "notify_step"]
    assert {f["section_id"] for f in notify} == {"paths", "paths-more"}
    data = out["forms_wired_in_data"]
    assert {f["section_id"] for f in data} == {"home-catalog", "courses-catalog"}
    assert all("folder library" in f["campaigns_from"] for f in data)


def test_widget_surfaces_cover_spotlight_buttons_and_steps():
    catalog = {"id": "cat", "type": "courseCatalog", "props": {"columnSections": [
        {"id": "s", "kind": "spotlight", "slides": [{"id": "a", "title": "Flagship", "cta": {"label": "Ask us", "action": "open-form"},
                                                     "steps": [{"title": "Survey", "audienceId": "camp-1"}, {"title": "Course", "route": "/x"}]}]},
        {"id": "f", "kind": "free-courses"},
    ]}}
    paths = {s["path"]: s for s in capture_surfaces(catalog)}
    assert set(paths) == {"props.columnSections[0].slides[0].cta.audienceId", "props.columnSections[0].slides[0].steps[0].audienceId"}
    assert paths["props.columnSections[0].slides[0].cta.audienceId"]["required"] is True
    # A plain catalogue (no in-grid sections) has no surfaces, as before.
    assert capture_surfaces({"id": "c", "type": "courseCatalog", "props": {"title": "All"}}) == []


def test_publish_checks_flag_unwired_band_and_spotlight_buttons():
    config = {"pages": [{"id": "p", "route": "home", "seo": {"metaDescription": "x"}, "components": [
        {"id": "band", "type": "ctaBanner", "props": {"variant": "band", "heading": "Hi", "button": {"text": "Go", "action": "navigate"},
                                                     "secondaryButton": {"text": "Talk to us", "action": "openForm"}}},
        {"id": "cat", "type": "courseCatalog", "props": {"columnSections": [
            {"id": "s", "kind": "spotlight", "slides": [{"id": "a", "title": "F", "cta": {"label": "Ask", "action": "open-form"}}]}]}},
        {"id": "off", "type": "ctaBanner", "props": {"variant": "band", "heading": "Hi", "button": {"text": "Go"},
                                                    "secondaryButton": {"text": "Talk", "action": "openForm", "enabled": False}}},
    ]}]}
    errors = [i["component_id"] for i in run_publish_checks(config) if i["severity"] == "error"]
    assert errors == ["band", "cat"]


@pytest.mark.asyncio
async def test_link_lead_form_wires_the_footer_newsletter_into_the_layout(bv_backend):
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "section_id": "footer", "audience_id": BV_TALK})
    assert out["saved_as"] == "draft" and "Footer newsletter" in out["summary_of_change"]
    news = bv_backend.saved[-1]["globalSettings"]["layout"]["footer"]["props"]["newsletter"]
    assert news["audienceId"] == BV_TALK and news["audienceName"] == "Talk to us"
    # Pages are untouched.
    assert bv_backend.saved[-1]["pages"] == bv_site()["pages"]

    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "section_id": "footer", "audience_id": "camp-old"})
    assert out["error"] == "campaign_inactive"
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "section_id": "footer", "audience_id": "camp-elsewhere"})
    assert out["error"] == "unknown_campaign"
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "section_id": "footer", "audience_id": BV_TALK,
                      "surface_path": "props.leftSection.text"})
    assert out["error"] == "unknown_surface" and out["available"] == ["props.newsletter.audienceId"]
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "section_id": "header", "audience_id": BV_TALK})
    assert out["error"] == "not_a_form"


@pytest.mark.asyncio
async def test_link_lead_form_surface_path_wires_just_one_button(bv_backend):
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "page_route": "learning-paths",
                      "section_id": "lp-institutions", "audience_id": BV_NOTIFY,
                      "surface_path": "props.secondaryButton.audienceId"})
    assert out["saved_as"] == "draft"
    band = next(c for c in bv_backend.saved[-1]["pages"][2]["components"] if c["id"] == "lp-institutions")
    assert band["props"]["secondaryButton"]["audienceId"] == BV_NOTIFY
    assert band["props"]["button"]["audienceId"] == BV_TALK                  # the other button is left alone

    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "page_route": "learning-paths",
                      "section_id": "paths", "audience_id": BV_TALK,
                      "surface_path": "props.pathExtras[0].comingSoon[0].audienceId"})
    path = next(c for c in bv_backend.saved[-1]["pages"][2]["components"] if c["id"] == "paths")
    assert path["props"]["pathExtras"][0]["comingSoon"][0]["audienceId"] == BV_TALK


# ── review findings (lane b45) ───────────────────────────────────────────
def test_a_single_unbound_section_alone_fails_fidelity_review():
    """The audit is fidelity mode's correctness gate: its `fix` items are fixes there."""
    for comp in (
        {"id": "path", "type": "learningPath", "props": {"title": "Paths", "mode": "list"}},
        {"id": "cta", "type": "ctaBanner", "props": {"heading": "Join", "button": {"text": ""}}},
        {"id": "grid", "type": "featureGrid", "props": {"headerText": "Why", "features": []}},
    ):
        page = {"route": "home", "meta": {"designSource": {"kind": "figma"}}, "components": [
            {"id": "hero", "type": "heroSection", "props": {"layout": "centered", "left": {
                "title": "Brahm Varchas", "buttons": [{"text": "Explore", "action": "navigate", "target": "#paths"}]}}},
            comp,
        ]}
        page_type, fidelity = review_mode(page)
        r = review_with_audit(page, None, page_type or "homepage", fidelity=fidelity)
        assert fidelity and not r["passes"], (comp["id"], r)
        assert [i["component_id"] for i in r["issues"] if i["kind"] == "fix"] == [comp["id"]], r["issues"]
        # Standard mode reports the audit exactly as before (merged as warnings).
        std = review_with_audit(page, None, "homepage")
        assert all(i["kind"] == "warn" for i in std["issues"] if i.get("component_id") == comp["id"])


def test_fidelity_mode_fails_broken_sections_without_any_placeholder_copy():
    page = {"route": "home", "components": [
        {"id": "path", "type": "learningPath", "props": {"title": "Paths", "productPageCode": ""}},
        {"id": "cta", "type": "ctaBanner", "props": {"heading": "Join", "button": {"text": ""}}},
        {"id": "grid", "type": "featureGrid", "props": {"headerText": "Why", "features": []}},
    ]}
    r = review_with_audit(page, None, "homepage", fidelity=True)
    assert not r["passes"]
    assert {"path-unbound", "cta-no-button", "empty-section"} <= set(_issues(r, "fix"))
    assert "placeholder-copy" not in _issues(r)


def test_two_broken_sections_of_the_same_kind_are_both_reported_in_fidelity_mode():
    page = {"route": "home", "components": [
        {"id": "a", "type": "featureGrid", "props": {"headerText": "Why", "features": []}},
        {"id": "b", "type": "stepsProcess", "props": {"headerText": "How", "steps": []}},
    ]}
    r = review_with_audit(page, None, "homepage", fidelity=True)
    assert sorted(i["component_id"] for i in r["issues"] if i["code"] == "empty-section") == ["a", "b"]


def test_a_catalogue_hero_does_not_hide_a_broken_hero_section():
    catalog = copy.deepcopy(bv_site()["pages"][0]["components"][0])
    page = {"route": "home", "components": [
        catalog,
        {"id": "split", "type": "heroSection", "props": {"layout": "split", "left": {"title": ""}}},
    ]}
    for fidelity in (False, True):
        r = review_with_audit(page, None, "homepage", fidelity=fidelity)
        fixes = {(i["code"], i.get("component_id")) for i in r["issues"] if i["kind"] == "fix"}
        assert {("hero-no-headline", "split"), ("hero-split-no-image", "split")} <= fixes, (fidelity, r["issues"])
        assert not r["passes"]
    # Fidelity mode checks every heroSection, not just the first.
    two = {"route": "x", "components": [
        {"id": "h1", "type": "heroSection", "props": {"layout": "centered", "left": {"title": "One", "buttons": [{"text": "Go"}]}}},
        {"id": "h2", "type": "heroSection", "props": {"layout": "split", "left": {"title": "Two", "buttons": [{"text": "Go"}]}}},
    ]}
    r = review_page(two, None, "about", fidelity=True)
    assert ("hero-split-no-image", "h2") in {(i["code"], i.get("component_id")) for i in r["issues"]}


def test_fidelity_placeholder_check_reads_text_inside_link_image_and_tag_objects():
    def page(props):
        return {"route": "x", "components": [{"id": "c", "type": "featureGrid", "props": {
            "headerText": "Why", "features": [{"title": "A"}, {"title": "B"}, {"title": "C"}], **props}}]}
    for props in (
        {"ctaLink": {"label": "Lorem ipsum", "url": "/x"}},
        {"heroImage": {"src": "https://cdn.x/a.png", "alt": "Your institute name"}},
        {"tags": ["Lorem ipsum"]},
        {"secondaryAction": {"text": "Description here"}},
    ):
        r = review_with_audit(page(props), None, "about", fidelity=True)
        assert "placeholder-copy" in _issues(r, "fix"), props
    # The data values themselves are still skipped.
    r = review_with_audit(page({"ctaLink": "https://example.com/placeholder", "heroImage": "placeholder.png"}),
                          None, "about", fidelity=True)
    assert "placeholder-copy" not in _issues(r)


def test_publish_checks_word_an_unwired_spotlight_as_hidden():
    config = {"pages": [{"id": "p", "route": "home", "seo": {"metaDescription": "x"}, "components": [
        {"id": "cat", "type": "courseCatalog", "props": {"columnSections": [
            {"id": "s", "kind": "spotlight", "slides": [{"id": "a", "title": "F", "cta": {"label": "Ask", "action": "open-form"}}]}]}},
    ]}]}
    [issue] = [i for i in run_publish_checks(config) if i["severity"] == "error"]
    assert issue["title"] == "A spotlight button opens a form but no campaign is selected"
    assert "hidden" in issue["fix"] and "does nothing" not in issue["fix"]


@pytest.mark.asyncio
async def test_lead_summary_gives_every_surface_its_path_and_the_spotlight_its_own_problem(bv_backend):
    site = bv_site()
    cat = site["pages"][0]["components"][0]
    cat["props"].setdefault("columnSections", []).append(
        {"id": "spot", "kind": "spotlight", "slides": [{"id": "s1", "title": "Flagship", "cta": {"label": "Ask us", "action": "open-form"}}]})
    site["pages"][2]["components"][0]["props"]["left"]["buttons"] = [
        {"text": "Talk", "action": "openForm", "audienceId": BV_TALK}, {"text": "Notify", "action": "openForm"}]
    bv_backend.row["catalogue_json"] = json.dumps(site)
    out = await website({"action": "lead_summary", "tag_name": "main-site"})
    every = out["forms"] + out["forms_without_campaign"]
    assert all(f.get("surface_path") for f in every), [f for f in every if not f.get("surface_path")]
    hero = {f["surface_path"] for f in every if f["section_id"] == "lp-hero"}
    assert hero == {"props.left.buttons[0].audienceId", "props.left.buttons[1].audienceId"}
    spot = next(f for f in out["forms_without_campaign"] if f["section_id"] == "home-catalog")
    assert spot["problem"] == "is hidden until a campaign is chosen"


@pytest.mark.asyncio
async def test_link_lead_form_on_a_named_page_never_falls_back_to_the_site_chrome(bv_backend):
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "page_route": "home",
                      "section_id": "footer", "audience_id": BV_TALK})
    assert out["error"] == "unknown_section"
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "page_route": "no-such-page",
                      "section_id": "footer", "audience_id": BV_TALK})
    assert out["error"] == "unknown_page"
    assert bv_backend.saved == []


@pytest.mark.asyncio
async def test_link_lead_form_on_a_chrome_section_without_an_id_reports_not_a_form(bv_backend):
    site = bv_site()
    site["globalSettings"]["layout"]["header"].pop("id", None)
    bv_backend.row["catalogue_json"] = json.dumps(site)
    out = await edit({"action": "link_lead_form", "tag_name": "main-site", "section_id": "header", "audience_id": BV_TALK})
    assert out["error"] == "not_a_form" and "header" in out["message"]


@pytest.mark.asyncio
async def test_create_page_with_a_design_source_reports_an_unbound_section_as_an_error(bv_backend):
    page = {"route": "paths-figma", "components": [
        {"id": "hero", "type": "heroSection", "props": {"layout": "centered", "left": {"title": "Paths", "buttons": [{"text": "See", "action": "navigate", "target": "#p"}]}}},
        {"id": "p", "type": "learningPath", "props": {"title": "Pick a path", "mode": "list"}},
    ]}
    out = await edit({"action": "create_page", "tag_name": "main-site", "page": page, "design_source": FIGMA_URL})
    assert out["review_mode"] == "fidelity"
    assert [i["code"] for i in out["design_issues"] if i["severity"] == "error"] == ["path-unbound"]
    assert out["quality"]["passes"] is False
    # Without a design source, design_issues are reported exactly as before (warnings).
    page["route"] = "paths-plain"
    out = await edit({"action": "create_page", "tag_name": "main-site", "page": page})
    assert not [i for i in out["design_issues"] if i["severity"] == "error"]


@pytest.mark.asyncio
async def test_create_site_takes_a_design_source_per_page(bv_backend):
    pages = copy.deepcopy(bv_site()["pages"])
    pages[0]["design_source"] = {"url": "https://www.figma.com/design/AbCdEf0123456789xyz/BV?node-id=1-2", "frame": "Home"}
    pages[2]["design_source"] = {"kind": "figma", "node_id": "3-9", "frame": "Paths"}
    out = await edit({"action": "create_site", "new_site_name": "bv-frames", "pages": pages,
                      "design_source": {"kind": "figma", "node_id": "1-247"}})
    created = json.loads(bv_backend.created[0]["catalogue_json"])
    assert [p["meta"]["designSource"] for p in created["pages"]] == [
        {"kind": "figma", "nodeId": "1:2", "frame": "Home"}, {"kind": "figma", "nodeId": "1:247"},
        {"kind": "figma", "nodeId": "3:9", "frame": "Paths"}]
    assert set(out["design_sources"]) == {"home", "courses", "learning-paths"}
    assert "design_source" not in json.dumps([{k: v for k, v in p.items() if k != "meta"} for p in created["pages"]])


@pytest.mark.asyncio
async def test_update_page_sets_and_clears_a_design_source(bv_backend, monkeypatch):
    out = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths",
                      "design_source": {"url": FIGMA_URL, "frame": "Paths"}})
    assert out["saved_as"] == "draft" and out["review_mode"] == "fidelity" and out["quality"]["mode"] == "fidelity"
    saved = bv_backend.saved[-1]
    lp = saved["pages"][2]
    assert lp["meta"] == {"designSource": {"kind": "figma", "nodeId": "1:247", "frame": "Paths"}, "pageType": "about"}
    assert lp["components"] == bv_site()["pages"][2]["components"] and "figma.com" not in json.dumps(saved)

    async def _draft(ctx_, catalogue_id):
        return {"id": "rev-d", "revision_no": 7, "source": "AI_COPILOT", "catalogue_json": json.dumps(bv_backend.saved[-1])}
    monkeypatch.setattr(website_data, "get_draft", _draft)
    got = await website({"action": "get_page", "tag_name": "main-site", "page_route": "learning-paths"})
    assert got["design_source"] == {"kind": "figma", "nodeId": "1:247", "frame": "Paths"}
    assert got["review_mode"] == "fidelity" and got["page_type"] == "about"

    out = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths",
                      "design_source": {"clear": True}})
    assert out["review_mode"] == "standard" and "meta" not in bv_backend.saved[-1]["pages"][2]
    out = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths",
                      "design_source": {"url": "http://insecure.example/x"}})
    assert out["error"] == "invalid_design_source"
    out = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths"})
    assert out["error"] == "missing_argument"


@pytest.mark.asyncio
async def test_update_page_treats_a_null_design_source_as_not_given(bv_backend, monkeypatch):
    """F4: clients that send every optional parameter as null must not clear the design or save a no-op."""
    await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths",
                "design_source": {"url": FIGMA_URL, "frame": "Paths"}})
    designed = bv_backend.saved[-1]

    async def _draft(ctx_, catalogue_id):
        return {"id": "rev-d", "revision_no": 7, "source": "AI_COPILOT", "catalogue_json": json.dumps(designed)}
    monkeypatch.setattr(website_data, "get_draft", _draft)
    saves = len(bv_backend.saved)
    for empty in (None, ""):
        out = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths",
                          "design_source": empty})
        assert out["error"] == "missing_argument"
    assert len(bv_backend.saved) == saves                        # no no-op draft
    op = {"op": "update", "id": designed["pages"][2]["components"][0]["id"], "propsPatch": {"title": "Paths"}}
    out = await edit({"action": "update_page", "tag_name": "main-site", "page_route": "learning-paths",
                      "ops": [op], "design_source": None})
    assert "error" not in out and "design source cleared" not in json.dumps(out)
    assert bv_backend.saved[-1]["pages"][2]["meta"]["designSource"]["nodeId"] == "1:247"


@pytest.mark.asyncio
async def test_review_accepts_fidelity_sent_as_a_string(bv_backend):
    out = await website({"action": "review", "tag_name": "main-site", "fidelity": "true"})
    assert all(p.get("mode") == "fidelity" for p in out["pages"].values()) and out["passes"] is True
    out = await website({"action": "review", "tag_name": "main-site", "fidelity": "false"})
    assert not any("mode" in p for p in out["pages"].values())
