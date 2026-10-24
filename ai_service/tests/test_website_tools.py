"""
Website builder tools: the compact page summaries the model reads, the
publish-check port, and the `website` / `audience_forms` actions against a
faked admin-core.

The summaries are what make a megabyte catalogue usable in a chat, so most of
this pins down WHAT they say: where a block's data comes from, which forms are
wired to a campaign, and what the dashboard would warn about.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_audience as audience_mod  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tool_registry import (  # noqa: E402
    ASSISTANT_TOOLS,
    GROUP_LABELS,
    ToolContext,
    execute_tool,
    is_tool_allowed,
)
from app.services.catalogue_summary import (  # noqa: E402
    capture_surfaces,
    collect_capture_surfaces,
    component_label,
    data_binding,
    editor_url,
    find_page,
    learner_site_url,
    run_publish_checks,
    summarize_global_settings,
    summarize_page,
)


# ── fixtures ─────────────────────────────────────────────────────────────
def sample_config():
    return {
        "globalSettings": {
            "mode": "light",
            "theme": {"preset": "ocean", "primaryColor": "#1D4ED8", "borderRadius": "rounded"},
            "fonts": {"enabled": True, "family": "Inter, sans-serif", "headingFamily": "Fraunces, serif"},
            "audience": "adults",
            "leadCollection": {"enabled": True, "mandatory": False, "inviteLink": None, "fields": []},
            "payment": {"enabled": True, "provider": "razorpay", "fields": []},
            "tracking": {},
        },
        "pages": [
            {
                "id": "p-home", "route": "home", "title": "Home",
                "seo": {"metaTitle": "Acme Coaching", "metaDescription": "NEET & JEE coaching in Pune"},
                "components": [
                    {"id": "c-header", "type": "header", "enabled": True, "props": {
                        "title": "Acme", "navLinks": [{"label": "About", "route": "about"}, {"label": "Fees", "route": "fees"}],
                        "authLinks": [{"label": "Enquire now", "route": "", "audienceId": "camp-1"}],
                    }},
                    {"id": "c-hero", "type": "heroSection", "enabled": True, "props": {
                        "left": {"title": "Crack NEET 2027", "buttons": [
                            {"text": "Book a demo", "action": "openForm", "audienceId": ""},
                        ]},
                    }},
                    {"id": "c-courses", "type": "courseShowcase", "enabled": True,
                     "props": {"title": "New courses", "source": "newest", "limit": 3}},
                    {"id": "c-offer", "type": "productPageOffer", "enabled": True,
                     "props": {"title": "Batches", "productPageCode": "", "productPageName": ""}},
                    {"id": "c-lead", "type": "leadForm", "enabled": True,
                     "props": {"title": "Register", "audienceId": "camp-1", "audienceName": "Admissions 2027"}},
                    {"id": "c-text", "type": "textBlock", "enabled": True,
                     "props": {"content": "<h2>Why us</h2><p>Replace this with your story.</p>"}},
                ],
            },
            {
                "id": "p-about", "route": "about", "title": "About", "seo": {},
                "components": [
                    {"id": "c-cols", "type": "columnLayout", "enabled": True, "props": {"slots": [[
                        {"id": "c-contact", "type": "contactForm", "enabled": True,
                         "props": {"heading": "Get in touch", "audienceId": ""}},
                    ]]}},
                    {"id": "c-catalog", "type": "courseCatalog", "enabled": True,
                     "props": {"title": "All courses", "showFilters": True,
                               "filtersConfig": [{"label": "Level", "field": "level_name"}]}},
                ],
            },
        ],
    }


def principal(roles=("ADMIN",), is_root=False):
    return PinnedPrincipal(user_id="user-1", institute_id="inst-1", roles=list(roles),
                           permissions=[], is_root_user=is_root)


class _FakeDb:
    """Answers the two SQL lookups the tools make against the shared DB."""
    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "learner_portal_base_url" in sql:
            return SimpleNamespace(first=lambda: ("sites.acme.edu",))
        if "SELECT name FROM institutes" in sql:
            return SimpleNamespace(first=lambda: ("Acme Coaching",))
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])


def ctx(roles=("ADMIN",)):
    return ToolContext(db=_FakeDb(), principal=principal(roles), keys=(), bearer_token="jwt")


CATALOGUE_ROW = {
    "id": "cat-1", "tag_name": "main-site", "status": "ACTIVE", "is_default": True,
    "catalogue_json": json.dumps(sample_config()), "updated_at": "2026-09-10T10:00:00",
}

CAMPAIGN = {
    "id": "camp-1", "campaign_name": "Admissions 2027", "status": "ACTIVE",
    "campaign_type": "WEBSITE", "campaign_objective": "LEAD_GENERATION", "institute_id": "inst-1",
    "institute_custom_fields": [
        {"field_id": "f1", "is_mandatory": True, "individual_order": 2, "status": "ACTIVE",
         "custom_field": {"id": "f1", "field_name": "Email", "field_type": "TEXT"}},
        {"field_id": "f2", "is_mandatory": True, "individual_order": 1, "status": "ACTIVE",
         "custom_field": {"id": "f2", "field_name": "Full Name", "field_type": "TEXT"}},
    ],
}


def fake_admin_core(calls):
    """A stand-in for _admin_core_json keyed on (method, path)."""
    async def _call(ctx_, method, path, params=None, body=None, timeout=None):
        calls.append((method, path, params, body))
        if path.endswith("/course-catalogue/institute/get-all"):
            return [CATALOGUE_ROW]
        if path.endswith("/course-catalogue/institute/get/by-tag"):
            return CATALOGUE_ROW if params["tagName"] == "main-site" else {"error": "fetch_failed", "status": 404}
        if path.endswith("/revision/draft"):
            return {"error": "fetch_failed", "status": 204}   # no draft
        if path.endswith("/revision/history"):
            return [{"id": "r1", "revision_no": 3, "status": "PUBLISHED", "created_at": "2026-09-01T00:00:00"},
                    {"id": "r0", "revision_no": 2, "status": "DISCARDED"}]
        if path.endswith("/packages/v2/search"):
            return {"content": [
                {"id": "course-1", "package_name": "NEET 2027", "level_name": "Class 12", "session_name": "default",
                 "min_plan_actual_price": 45000, "currency": "INR", "package_session_id": "ps-1"},
                {"id": "course-2", "package_name": "Foundation", "level_name": "default", "min_plan_actual_price": 0},
            ]}
        if path.endswith("/product-page/get-all"):
            return [{"name": "NEET Batches", "code": "NEET27", "status": "ACTIVE", "mappings": [{}, {}]}]
        if path.endswith("/audience/campaigns"):
            return {"content": [CAMPAIGN], "total_elements": 1}
        if path.endswith("/audience/leads"):
            return {"content": [{"response_id": "resp-1", "submitted_at_local": "2026-09-15T08:30:00",
                                 "parent_name": "Riya", "parent_email": "riya@example.com",
                                 "parent_mobile": "9999", "source_id": "main-site", "conversion_status": "NEW"}],
                    "total_elements": 12}
        if "/open/v1/audience/campaign/inst-1/camp-1" in path:
            return CAMPAIGN
        if "/open/v1/audience/campaign/" in path:
            return {"error": "fetch_failed", "status": 404}
        if path.endswith("/folder-library/libraries"):
            return []                                    # an institute without folder libraries
        if path.endswith("/catalogue-analytics/summary"):
            return {"views": 120, "visitors": 80, "sessions": 90, "leads": 4,
                    "daily": [{"day": "2026-09-14", "views": 60, "visitors": 40}],
                    "pages": [{"name": "home", "count": 100}], "sources": [{"name": "google", "count": 50}]}
        raise AssertionError(f"unexpected call {method} {path}")
    return _call


@pytest.fixture
def admin_core(monkeypatch):
    calls = []
    monkeypatch.setattr(website_data, "_admin_core_json", fake_admin_core(calls))
    monkeypatch.setattr(website_mod, "_admin_core_json", fake_admin_core(calls))
    monkeypatch.setattr(audience_mod, "_admin_core_json", fake_admin_core(calls))
    return calls


def enabled(*groups):
    return {"enabled_tools": list(groups), "role_overrides": {}}


# ── registry wiring ──────────────────────────────────────────────────────
def test_tools_are_registered_with_their_own_groups():
    assert ASSISTANT_TOOLS["website"].key() == "website_builder"
    assert ASSISTANT_TOOLS["audience_forms"].key() == "audience_forms"
    assert ASSISTANT_TOOLS["website"].mode == "READ"
    assert ASSISTANT_TOOLS["audience_forms"].mode == "READ"
    assert GROUP_LABELS["website_builder"] and GROUP_LABELS["audience_forms"]


def test_default_on_for_admins_only_when_unconfigured():
    assert is_tool_allowed("website", principal(("ADMIN",)), None)
    assert not is_tool_allowed("website", principal(("TEACHER",)), None)
    assert not is_tool_allowed("website", principal(("ADMIN",)), enabled("institute_overview"))
    assert is_tool_allowed("website", principal(("TEACHER",)), enabled("website_builder"))


def test_schema_has_one_action_enum():
    props = website_mod.WEBSITE_SCHEMA["function"]["parameters"]["properties"]
    assert set(props["action"]["enum"]) == set(website_mod.WEBSITE_ACTIONS)
    assert website_mod.WEBSITE_SCHEMA["function"]["parameters"]["required"] == ["action"]


# ── summaries ────────────────────────────────────────────────────────────
def test_labels_fall_back_to_split_camel_case():
    assert component_label("heroSection") == "Hero Section"
    assert component_label("somethingNew") == "Something New"


def test_data_binding_explains_where_data_comes_from():
    page = sample_config()["pages"][0]
    by_id = {c["id"]: c for c in page["components"]}
    assert data_binding(by_id["c-courses"]) == "newest courses (live), limit 3"
    assert "NONE selected" in data_binding(by_id["c-offer"])
    assert 'campaign "Admissions 2027" (camp-1)' in data_binding(by_id["c-lead"])
    assert "NO campaign selected" in data_binding(by_id["c-hero"])
    assert data_binding(by_id["c-text"]) is None
    assert "filters: Level" in data_binding(sample_config()["pages"][1]["components"][1])


def test_capture_surfaces_cover_forms_links_and_buttons():
    page = sample_config()["pages"][0]
    by_id = {c["id"]: c for c in page["components"]}
    header = capture_surfaces(by_id["c-header"])
    assert header[0]["kind"] == "header_link" and header[0]["audience_id"] == "camp-1"
    hero = capture_surfaces(by_id["c-hero"])
    assert hero[0]["kind"] == "button" and hero[0]["path"] == "props.left.buttons[0].audienceId"
    assert hero[0]["audience_id"] == ""
    lead = capture_surfaces(by_id["c-lead"])
    assert lead[0]["required"] is True and lead[0]["path"] == "props.audienceId"


def test_collect_capture_surfaces_descends_into_column_slots():
    surfaces = collect_capture_surfaces(sample_config())
    contact = [s for s in surfaces if s["section_id"] == "c-contact"]
    assert contact and contact[0]["page_route"] == "about" and contact[0]["required"] is False


def test_summarize_page_is_compact_and_ordered():
    page = summarize_page(sample_config()["pages"][0])
    assert [s["id"] for s in page["sections"]] == ["c-header", "c-hero", "c-courses", "c-offer", "c-lead", "c-text"]
    hero = page["sections"][1]
    assert hero["label"] == "Hero Section" and hero["heading"] == "Crack NEET 2027"
    assert page["seo"]["meta_description"] == "NEET & JEE coaching in Pune"
    assert "copy" not in page["sections"][5]


def test_summarize_page_include_copy_strips_html():
    page = summarize_page(sample_config()["pages"][0], include_copy=True)
    text_block = page["sections"][5]
    assert any("Why us" in c for c in text_block["copy"])
    assert not any("<" in c for c in text_block["copy"])


def test_global_settings_summary():
    gs = summarize_global_settings(sample_config()["globalSettings"])
    assert gs["theme"] == {"preset": "ocean", "primary_color": "#1D4ED8", "border_radius": "rounded"}
    assert gs["fonts"] == {"body": "Inter, sans-serif", "heading": "Fraunces, serif"}
    assert gs["site_wide_lead_popup"] == {"enabled": True, "mandatory": False}
    assert gs["payment_enabled"] is True


def test_find_page_by_route_or_id_case_insensitive():
    cfg = sample_config()
    assert find_page(cfg, "/About")["id"] == "p-about"
    assert find_page(cfg, "p-home")["route"] == "home"
    assert find_page(cfg, None)["route"] == "home"
    assert find_page(cfg, "nope") is None


# ── publish checks (port) ────────────────────────────────────────────────
def test_publish_checks_match_the_dashboard():
    issues = run_publish_checks(sample_config())
    titles = [i["title"] for i in issues]
    assert "A button opens a form but no campaign is selected" in titles
    assert "A course section has no product page selected" in titles
    assert "Placeholder text is still on the page" in titles
    assert "No analytics connected" in titles
    assert any("“About” has no meta description" == t for t in titles)
    assert any("Fees" in t and "doesn’t exist" in t for t in titles)
    # Errors sort first.
    severities = [i["severity"] for i in issues]
    assert severities == sorted(severities, key=lambda s: 0 if s == "error" else 1)
    # A wired header link is not a dead nav link, and the lead form with a campaign is fine.
    assert not any("Enquire now" in t for t in titles)
    assert "A Lead Form section has no campaign selected" not in titles


# ── URLs ─────────────────────────────────────────────────────────────────
def test_site_and_editor_urls():
    assert learner_site_url("my site", "sites.acme.edu", "https://learner.vacademy.io") == "https://sites.acme.edu/my%20site"
    assert learner_site_url("t", None, "https://learner.vacademy.io/") == "https://learner.vacademy.io/t"
    assert editor_url("https://dash.vacademy.io", "t", "about", "c-1") == \
        "https://dash.vacademy.io/manage-pages/editor/t?page=about&section=c-1"


# ── website actions ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_unknown_action_is_refused():
    out = json.loads(await website_mod.execute_website({"action": "publish"}, ctx()))
    assert out["error"] == "unknown_action" and "list" in out["available"]


@pytest.mark.asyncio
async def test_list_sites(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "list"}, ctx()))
    site = out["sites"][0]
    assert site["tag_name"] == "main-site"
    assert site["live_url"] == "https://sites.acme.edu/main-site"
    assert site["has_unpublished_draft"] is False
    assert site["published_revision_no"] == 3
    assert site["pages"] == ["home", "about"]
    assert "/manage-pages/editor/main-site" in site["editor_url"]


@pytest.mark.asyncio
async def test_get_page_defaults_to_the_default_site_and_first_page(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "get_page"}, ctx()))
    assert out["tag_name"] == "main-site" and out["page"]["route"] == "home"
    assert out["showing"] == "published"
    assert out["page"]["sections"][2]["data_binding"] == "newest courses (live), limit 3"


@pytest.mark.asyncio
async def test_get_page_unknown_site_lists_options(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "get_page", "tag_name": "other"}, ctx()))
    assert out["error"] == "unknown_site" and out["available"] == ["main-site"]


@pytest.mark.asyncio
async def test_context_returns_only_real_ids(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "context"}, ctx()))
    assert [c["name"] for c in out["courses"]] == ["NEET 2027", "Foundation"]
    assert "session" not in out["courses"][0]          # "default" session dropped
    assert out["product_pages"][0]["code"] == "NEET27"
    camp = out["lead_campaigns"][0]
    assert camp["id"] == "camp-1" and camp["leads_received"] == 12
    assert out["site"]["settings"]["theme"]["preset"] == "ocean"
    # No folder libraries: the context reads exactly as it did before they were listed.
    assert set(out) == {"action", "site", "courses", "product_pages", "lead_campaigns", "rules"}


@pytest.mark.asyncio
async def test_lead_summary_separates_wired_from_unwired(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "lead_summary"}, ctx()))
    wired = {f["section_id"]: f for f in out["forms"]}
    assert wired["c-lead"]["campaign_id"] == "camp-1" and wired["c-lead"]["leads_received"] == 12
    assert wired["c-header"]["surface"] == "header_link"
    unwired = {f["section_id"]: f for f in out["forms_without_campaign"]}
    assert "does nothing" in unwired["c-hero"]["problem"]
    assert "falls back" in unwired["c-contact"]["problem"]
    assert out["site_wide_popup"]["enabled"] is True


@pytest.mark.asyncio
async def test_audit_filters_by_page(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "audit", "page_route": "about"}, ctx()))
    assert any("About" in e["title"] for e in out["warnings"])
    assert not any(e.get("page_route") == "home" for e in out["errors"] + out["warnings"])
    # Site-wide issues (no page) are kept.
    assert any(w["title"] == "No analytics connected" for w in out["warnings"])


@pytest.mark.asyncio
async def test_analytics_normalises_days(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "analytics", "days": 12}, ctx()))
    assert out["days"] == 30 and out["views"] == 120 and out["top_pages"][0]["name"] == "home"


@pytest.mark.asyncio
async def test_brief_checklist_reports_known_facts(admin_core, monkeypatch):
    async def no_media(ctx_, kind, limit):
        return []
    monkeypatch.setattr(website_mod, "_load_media", no_media)
    out = json.loads(await website_mod.execute_website({"action": "brief_checklist"}, ctx()))
    assert [s["step"] for s in out["checklist"]][:4] == ["identity", "proof", "audience_tone", "colours"]
    assert out["known"]["institute_name"] == "Acme Coaching"
    assert out["known"]["existing_site"]["tag_name"] == "main-site"
    assert out["known"]["lead_campaigns"] == [{"id": "camp-1", "name": "Admissions 2027"}]
    assert "ocean" in out["choices"]["theme_presets"]


@pytest.mark.asyncio
async def test_execute_tool_pins_identity_and_gates(admin_core):
    out = json.loads(await execute_tool("website", {"action": "list", "institute_id": "evil"}, ctx(), enabled("website_builder")))
    assert out["sites"][0]["tag_name"] == "main-site"
    assert admin_core[0][2]["instituteId"] == "inst-1"      # pinned, not "evil"
    denied = json.loads(await execute_tool("website", {"action": "list"}, ctx(("TEACHER",)), enabled("institute_overview")))
    assert denied["error"] == "tool_not_permitted"


# ── audience_forms actions ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_audience_list_shows_where_campaigns_are_used(admin_core):
    out = json.loads(await audience_mod.execute_audience_forms({"action": "list"}, ctx()))
    camp = out["campaigns"][0]
    assert camp["name"] == "Admissions 2027" and camp["leads_received"] == 12
    assert any("main-site/home" in u and "Lead Form" in u for u in camp["used_on"])


@pytest.mark.asyncio
async def test_audience_get_orders_fields(admin_core):
    out = json.loads(await audience_mod.execute_audience_forms({"action": "get", "audience_id": "camp-1"}, ctx()))
    assert [f["label"] for f in out["fields"]] == ["Full Name", "Email"]
    assert out["public_form_url"].endswith("/audience-response?instituteId=inst-1&audienceId=camp-1")


@pytest.mark.asyncio
async def test_audience_get_refuses_unknown_campaign(admin_core):
    out = json.loads(await audience_mod.execute_audience_forms({"action": "get", "audience_id": "camp-x"}, ctx()))
    assert out["error"] == "unknown_campaign"
    out = json.loads(await audience_mod.execute_audience_forms({"action": "get"}, ctx()))
    assert out["error"] == "missing_argument" and out["needs"] == ["audience_id"]


@pytest.mark.asyncio
async def test_audience_leads_mask_contact_for_non_admins(admin_core):
    admin = json.loads(await audience_mod.execute_audience_forms({"action": "leads", "audience_id": "camp-1"}, ctx()))
    assert admin["leads"][0]["email"] == "riya@example.com" and admin["contact_details_included"]
    teacher = json.loads(await audience_mod.execute_audience_forms({"action": "leads", "audience_id": "camp-1"}, ctx(("TEACHER",))))
    assert "email" not in teacher["leads"][0] and "phone" not in teacher["leads"][0]
    assert teacher["leads"][0]["name"] == "Riya"


# ── audience_forms_edit (additive writes) ────────────────────────────────
@pytest.fixture
def audience_backend(monkeypatch):
    calls = []
    base = fake_admin_core(calls)
    state = {"created": [], "updated": [], "submitted": []}

    async def _call(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/v1/audience/campaign") and method == "POST":
            state["created"].append(body)
            return "camp-new"
        if path.endswith("/v1/audience/campaign/camp-1") and method == "PUT":
            state["updated"].append(body)
            return "camp-1"
        if path.endswith("/lead/submit-catalogue"):
            state["submitted"].append(body)
            return "resp-test"
        return await base(ctx_, method, path, params=params, body=body, timeout=timeout)

    monkeypatch.setattr(website_data, "_admin_core_json", _call)
    monkeypatch.setattr(audience_mod, "_admin_core_json", _call)
    return state


def test_audience_edit_tool_is_write_and_off_by_default():
    spec = ASSISTANT_TOOLS["audience_forms_edit"]
    assert spec.mode == "WRITE" and spec.key() == "audience_forms_edits"
    assert not is_tool_allowed("audience_forms_edit", principal(("ADMIN",)), None)


@pytest.mark.asyncio
async def test_create_campaign_seeds_default_fields(audience_backend):
    out = json.loads(await audience_mod.execute_audience_forms_edit({"action": "create", "name": "Open Day"}, ctx()))
    assert out["campaign"] == {"id": "camp-new", "name": "Open Day", "status": "ACTIVE", "objective": "LEAD_GENERATION"}
    body = audience_backend["created"][0]
    assert body["institute_id"] == "inst-1" and body["campaign_type"] == "WEBSITE"
    fields = body["institute_custom_fields"]
    assert [f["custom_field"]["field_name"] for f in fields] == ["Full Name", "Email", "Phone Number"]
    assert fields[0]["type"] == "AUDIENCE_FORM" and fields[0]["is_mandatory"] is True and fields[2]["is_mandatory"] is False
    assert "camp-new" in out["next"]


@pytest.mark.asyncio
async def test_update_fields_is_additive(audience_backend):
    out = json.loads(await audience_mod.execute_audience_forms_edit({
        "action": "update_fields", "audience_id": "camp-1",
        "fields": [{"label": "email", "required": False}, {"label": "Class", "type": "DROPDOWN", "options": ["11", "12"]}],
    }, ctx()))
    body = audience_backend["updated"][0]
    sent = body["institute_custom_fields"]
    # Existing fields kept (Full Name, Email) in their order; Email changed; Class appended.
    assert [f["custom_field"]["field_name"] for f in sent] == ["Full Name", "Email", "Class"]
    assert sent[1]["is_mandatory"] is False and sent[1]["custom_field"]["id"] == "f1" and sent[1]["field_id"] == "f1"
    assert sent[2]["custom_field"]["field_type"] == "DROPDOWN" and json.loads(sent[2]["custom_field"]["config"]) == {"options": ["11", "12"]}
    assert out["added"] == ["Class"] and out["changed"] == ["Email"]
    assert body["institute_id"] == "inst-1" and "institute_custom_fields" in body


@pytest.mark.asyncio
async def test_update_fields_refuses_foreign_campaign(audience_backend):
    out = json.loads(await audience_mod.execute_audience_forms_edit({"action": "update_fields", "audience_id": "camp-x", "fields": [{"label": "X"}]}, ctx()))
    assert out["error"] == "unknown_campaign" and audience_backend["updated"] == []


@pytest.mark.asyncio
async def test_send_test_lead_uses_the_public_pipeline(audience_backend):
    out = json.loads(await audience_mod.execute_audience_forms_edit({"action": "send_test_lead", "audience_id": "camp-1"}, ctx()))
    body = audience_backend["submitted"][0]
    assert body["audience_id"] == "camp-1" and body["source_type"] == "TEST_SUBMISSION" and body["institute_id"] == "inst-1"
    assert out["delivered"] is True and out["leads_received"] == 12


@pytest.mark.asyncio
async def test_button_surfaces_get_campaign_names_from_the_institute_list(admin_core):
    # Header links / buttons store only the id (the editor never writes audienceName
    # there); the summary must still say which campaign, by name.
    out = json.loads(await website_mod.execute_website({"action": "get_page"}, ctx()))
    header = out["page"]["sections"][0]
    assert 'campaign "Admissions 2027" (camp-1)' in header["data_binding"]
    out = json.loads(await website_mod.execute_website({"action": "lead_summary"}, ctx()))
    header = next(f for f in out["forms"] if f["section_id"] == "c-header")
    assert header["campaign_name"] == "Admissions 2027"


def test_site_url_is_none_without_a_learner_domain():
    # A dead link to the shared learner host (which serves ANOTHER institute) is
    # worse than no link — the learner app resolves the institute from the domain.
    assert learner_site_url("t", None, "") is None
    assert learner_site_url("t", "", "") is None
    assert learner_site_url("t", "sites.acme.edu", "") == "https://sites.acme.edu/t"


@pytest.mark.asyncio
async def test_list_explains_missing_portal_domain(admin_core):
    class _NoDomainDb(_FakeDb):
        def execute(self, stmt, params=None):
            sql = str(stmt)
            if "learner_portal_base_url" in sql:
                return SimpleNamespace(first=lambda: (None,))
            if "institute_domain_routing" in sql:
                return SimpleNamespace(fetchall=lambda: [("vacademy.io", "admin-acme"), ("acme.edu", "*")])
            return super().execute(stmt, params)
    c = ToolContext(db=_NoDomainDb(), principal=principal(), keys=(), bearer_token="jwt")
    out = json.loads(await website_mod.execute_website({"action": "list"}, c))
    # admin-* portals are skipped; the wildcard LEARNER row gives the bare domain.
    assert out["sites"][0]["live_url"] == "https://acme.edu/main-site"

    class _NothingDb(_NoDomainDb):
        def execute(self, stmt, params=None):
            if "institute_domain_routing" in str(stmt):
                return SimpleNamespace(fetchall=lambda: [])
            return super().execute(stmt, params)
    c = ToolContext(db=_NothingDb(), principal=principal(), keys=(), bearer_token="jwt")
    out = json.loads(await website_mod.execute_website({"action": "list"}, c))
    assert out["sites"][0]["live_url"] is None and "no learner-portal domain" in out["live_url_note"]


# ── identity + institute profile ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_whoami_returns_user_and_institute_without_any_toggle(monkeypatch):
    from app.services import assistant_tool_registry as reg

    async def fake_auth(ctx_, method, path, params=None, **kw):
        assert path.endswith("/user-details/get") and params == {"userId": "user-1", "instituteId": "inst-1"}
        return {"full_name": "Priya Sharma", "email": "priya@acme.edu", "mobile_number": "+91 99", "profile_pic_file_id": "pic-1"}

    async def fake_admin(ctx_, method, path, params=None, body=None, timeout=None):
        assert path.endswith("/institute/v1/details-non-batches/inst-1")
        return {"institute_name": "Shiksha Nation", "institute_logo_file_id": "logo-1", "institute_theme_code": "emerald",
                "learner_portal_url": "https://learn.shikshanation.com", "admin_portal_url": "https://admin.shikshanation.com",
                "setting": json.dumps({"setting": {"NAMING_SETTING": {"data": {"data": [
                    {"key": "Course", "systemValue": "Course", "customValue": "Program"},
                    {"key": "Level", "systemValue": "Level", "customValue": "Level"}]}}}})}

    async def fake_media(ctx_, file_id):
        return f"https://cdn/{file_id}.png" if file_id else None

    monkeypatch.setattr(reg, "_auth_json", fake_auth)
    monkeypatch.setattr(reg, "_admin_core_json", fake_admin)
    monkeypatch.setattr(reg, "_media_public_url", fake_media)

    # No settings, TEACHER role: still allowed — identity only.
    out = json.loads(await execute_tool("whoami", {"institute_id": "evil"}, ctx(("TEACHER",)), {"enabled_tools": [], "role_overrides": {}}))
    assert out["user"] == {"user_id": "user-1", "roles": ["TEACHER"], "full_name": "Priya Sharma", "email": "priya@acme.edu",
                           "mobile": "+91 99", "profile_photo_url": "https://cdn/pic-1.png"}
    assert out["institute"]["name"] == "Shiksha Nation" and out["institute"]["logo_url"] == "https://cdn/logo-1.png"
    assert out["institute"]["theme"] == "emerald" and out["institute"]["terminology"] == {"Course": "Program"}
    assert "Priya Sharma" in out["note"] and "Shiksha Nation" in out["note"]

    # The overview's profile section is the same data, but that tool IS gated.
    out = json.loads(await execute_tool("get_institute_overview", {"sections": ["profile"]}, ctx(), {"enabled_tools": ["institute_overview"], "role_overrides": {}}))
    assert out["profile"]["name"] == "Shiksha Nation"
    denied = json.loads(await execute_tool("get_institute_overview", {"sections": ["profile"]}, ctx(), {"enabled_tools": [], "role_overrides": {}}))
    assert denied["error"] == "tool_not_permitted"


# ── schema: the contract the connected LLM composes against ─────────────
@pytest.mark.asyncio
async def test_schema_is_compact_by_default_and_detailed_on_request():
    out = json.loads(await website_mod.execute_website({"action": "schema"}, ctx()))
    types = {c["type"] for c in out["components"]}
    assert {"heroSection", "featureGrid", "leadForm", "courseCatalog", "faqSection"} <= types
    assert "header" not in types and "footer" not in types           # chrome goes through set_layout
    assert all("what" in c and "props" in c for c in out["components"])
    assert out["examples"] == {} and "hint" in out
    assert out["design_rules"] and out["doctrine"] and out["page_contract"]
    assert "ocean" in out["theme_choices"]["presets"]
    # 40k before the design-pattern registry (~42.5k after): it added the header/footer contract, the
    # site-settings contract, the pattern-id index and the components' dataBound/usage/escapeHatch notes.
    assert len(json.dumps(out)) < 45_000

    out = json.loads(await website_mod.execute_website({"action": "schema", "page_type": "courses", "section_types": ["heroSection", "nope"]}, ctx()))
    assert list(out["examples"]) == ["heroSection"] and "title" in out["examples"]["heroSection"]["left"]
    assert out["archetype"]["page_type"] == "courses" and "DIRECTORY" in out["archetype"]["rules"]


@pytest.mark.asyncio
async def test_get_page_positions_and_looks(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "get_page"}, ctx()))
    secs = out["page"]["sections"]
    assert [s["position"] for s in secs] == [1, 2, 3, 4, 5, 6]
    assert all("looks" in s for s in secs)
    assert 'buttons: "Book a demo"' in secs[1]["looks"]


@pytest.mark.asyncio
async def test_find_section_action(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "find_section", "query": "Register"}, ctx()))
    assert out["count"] == 1 and out["matches"][0]["section_id"] == "c-lead" and out["matches"][0]["path"] == "props.title"
    out = json.loads(await website_mod.execute_website({"action": "find_section"}, ctx()))
    assert out["error"] == "missing_argument"


@pytest.mark.asyncio
async def test_review_action_scores_every_page(admin_core):
    out = json.loads(await website_mod.execute_website({"action": "review"}, ctx()))
    assert set(out["pages"]) == {"home", "about"} and out["bar"] == 85
    assert isinstance(out["score"], int) and out["passes"] is False       # the sample site is deliberately rough
    assert all(i["fix"] for p in out["pages"].values() for i in p["issues"])


@pytest.mark.asyncio
async def test_list_media_ranks_hero_worthy_first(monkeypatch):
    from app.services import assistant_tool_registry as reg
    async def files(ctx_, method, base, path, **kw):
        return [
            {"file_detail": {"id": "a", "url": "https://cdn/a.png", "file_name": "logo.png", "file_type": "image/png", "width": 300, "height": 300}},
            {"file_detail": {"id": "b", "url": "https://cdn/b.jpg", "file_name": "campus.jpg", "file_type": "image/jpeg", "width": 1600, "height": 900}},
            {"file_detail": {"id": "c", "url": "https://cdn/c.pdf", "file_name": "brochure.pdf", "file_type": "application/pdf"}},
            {"file_detail": {"id": "d", "url": "https://cdn/d.jpg", "file_name": "class.jpg", "file_type": "image/jpeg", "width": 800, "height": 1200}},
        ]
    monkeypatch.setattr(reg, "_service_json", files)
    out = json.loads(await website_mod.execute_website({"action": "list_media"}, ctx()))
    assert [m["name"] for m in out["images"]] == ["campus.jpg", "class.jpg", "logo.png"]
    assert out["images"][0]["hero_worthy"] is True and "hero_worthy" not in out["images"][2]


@pytest.mark.asyncio
async def test_preview_is_wired_and_fails_softly(admin_core, monkeypatch):
    from app.services import page_preview
    async def fake_render(**kw):
        assert kw["tag_name"] == "main-site" and kw["page_route"] == "home" and kw["base_url"] == "sites.acme.edu"
        return {"png_base64": "AAAA", "width": 1280, "height": 3000}
    monkeypatch.setattr(page_preview, "render_preview", fake_render)
    out = json.loads(await website_mod.execute_website({"action": "preview"}, ctx()))
    assert out["image_png_base64"] == "AAAA" and out["height"] == 3000
    assert out["showing"] == "published" and "from the published site" in out["note"]


def _with_stale_draft(monkeypatch, calls):
    """admin-core reports a draft started before the live site last changed."""
    real = fake_admin_core(calls)
    async def _call(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/revision/draft"):
            return {"id": "rev-d", "revision_no": 7, "source": "MANUAL", "catalogue_json": "{\"pages\": []}",
                    "updated_at": "2026-09-02T00:00:00", "live_changed_since_draft": True,
                    "live_revision_no": 9, "live_updated_at": "2026-10-08T12:00:00"}
        return await real(ctx_, method, path, params, body, timeout)
    monkeypatch.setattr(website_data, "_admin_core_json", _call)


@pytest.mark.asyncio
async def test_list_flags_a_draft_older_than_live(admin_core, monkeypatch):
    _with_stale_draft(monkeypatch, admin_core)
    site = json.loads(await website_mod.execute_website({"action": "list"}, ctx()))["sites"][0]
    assert site["has_unpublished_draft"] is True
    assert site["draft"]["older_than_live"] is True and site["draft"]["revision_no"] == 7


@pytest.mark.asyncio
async def test_preview_of_a_stale_draft_says_it_shows_the_published_site(admin_core, monkeypatch):
    from app.services import page_preview
    _with_stale_draft(monkeypatch, admin_core)
    async def fake_render(**kw):
        assert kw["config"]["pages"][0]["route"] == "home"     # the published config, not the empty draft
        return {"png_base64": "AAAA", "width": 1280, "height": 3000}
    monkeypatch.setattr(page_preview, "render_preview", fake_render)
    out = json.loads(await website_mod.execute_website({"action": "preview"}, ctx()))
    assert out["showing"] == "published"
    assert "from the published site" in out["note"] and "current draft" not in out["note"]
    assert out["stale_draft"]["live_revision_no"] == 9


def test_preview_url_adds_scheme_to_bare_institute_host():
    from app.services.page_preview import _preview_url
    assert _preview_url("sites.acme.edu", "main site") == "https://sites.acme.edu/main%20site?preview=true"
    assert _preview_url("http://localhost:5173/", "x") == "http://localhost:5173/x?preview=true"
