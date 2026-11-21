"""
Design-led site settings over ``website_edit`` (all DRAFT-only):

* set_theme: the named palette, applyToTokens and the content width, plus the
  Devanagari font faces — a Figma file's tokens, set exactly;
* set_catalog_settings: course formats + order, course languages + version
  groups, naming, the site cart — ids validated against the institute;
* website(strings) / set_translations: the site's other-language dictionary,
  merged, capped, markup stripped;
* bind_data: library / folder / product-page bindings, and the audit saying
  "bind" instead of "remove" to a caller who can edit.

Opt-in: a site without any of these settings gets the same results as before
(pinned below where a shared function changed).
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.routers.page_builder import _validate_global_patch  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tools_website_edit import (  # noqa: E402
    DEFAULT_GLOBAL_SETTINGS,
    apply_ops,
    catalog_settings_patch,
    merge_global_settings,
    merge_translations,
    theme_problems,
    theme_to_global_patch,
)
from app.services.catalogue_summary import summarize_global_settings  # noqa: E402
from app.services.page_audit import audit_component, audit_page  # noqa: E402

from types import SimpleNamespace  # noqa: E402

from app.services.assistant_tool_registry import ToolContext, execute_tool  # noqa: E402
from test_website_tools import _FakeDb, fake_admin_core, principal, sample_config  # noqa: E402

_FIXTURE = (Path(__file__).resolve().parents[2]
            / "frontend-admin-dashboard/src/routes/manage-pages/-components/__fixtures__/brahm-varchas-site.json")
needs_fixture = pytest.mark.skipif(not _FIXTURE.exists(), reason="admin fixtures not checked out next to ai_service")

LIB = "904e2152-f6b8-4c49-bfa0-e8849d13825f"
FOREIGN_LIB = "lib-of-another-institute"
FOLDER = "folder-dharma"
STORE = {"name": "Knowledge Streams – Store", "code": "7pc4tl", "status": "ACTIVE", "mappings": [{}]}
PATH_PAGE = {"name": "Path: Foundations", "code": "path01", "status": "DRAFT", "mappings": [{}, {}]}


def bv():
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def bv_course_ids():
    groups = bv()["globalSettings"]["courseLanguages"]["versionGroups"]
    return sorted({cid for g in groups for cid in g})


def bv_palette_args():
    pal = dict(bv()["globalSettings"]["theme"]["palette"])
    apply = pal.pop("applyToTokens")
    return {**pal, "apply_to_tokens": apply}


# ── backend stand-in ─────────────────────────────────────────────────────
#: The shared DB's course ownership (package ⋈ package_institute) for inst-1.
_DB = {"owned": set(), "fail": False, "queries": 0}


class _CourseDb(_FakeDb):
    def execute(self, stmt, params=None):
        if "package_institute" in str(stmt):
            _DB["queries"] += 1
            if _DB["fail"]:
                raise RuntimeError("db down")
            assert params["inst"] == "inst-1"
            return SimpleNamespace(fetchall=lambda: [(i,) for i in params["ids"] if i in _DB["owned"]])
        return super().execute(stmt, params)

    def rollback(self):
        pass


def ctx(roles=("ADMIN",)):
    return ToolContext(db=_CourseDb(), principal=principal(roles), keys=(), bearer_token="jwt")


class _Site:
    def __init__(self, config):
        self.config = config
        self.saved = []


@pytest.fixture
def site_backend(monkeypatch):
    """A one-site institute whose site config each test picks (sample_config by default)."""
    site = _Site(sample_config())
    calls = []
    # Owned courses include one the public catalogue search does not return (hidden / past its page).
    _DB.update(owned=set(bv_course_ids() if _FIXTURE.exists() else []) | {"course-1", "hidden-course"},
               fail=False, queries=0)
    base = fake_admin_core(calls)
    course_rows = [{"id": cid, "package_name": f"Course {i}", "level_name": "default", "package_session_id": f"ps-{i}"}
                   for i, cid in enumerate(bv_course_ids() if _FIXTURE.exists() else [])]
    course_rows.append({"id": "course-1", "package_name": "NEET 2027", "level_name": "Class 12", "package_session_id": "ps-x"})

    async def _call(ctx_, method, path, params=None, body=None, timeout=None):
        calls.append((method, path, params, body))
        row = {"id": "cat-1", "tag_name": "main-site", "status": "ACTIVE", "is_default": True,
               "catalogue_json": json.dumps(site.config)}
        if path.endswith("/course-catalogue/institute/get-all"):
            return [row]
        if path.endswith("/course-catalogue/institute/get/by-tag"):
            return row
        if path.endswith("/revision/save-draft"):
            cfg = json.loads(body["catalogue_json"])
            site.saved.append(cfg)
            return {"id": f"rev-{len(site.saved)}", "revision_no": 10 + len(site.saved), "status": "DRAFT"}
        if path.endswith("/revision/publish") or "publish" in path.split("/")[-1]:
            raise AssertionError("website_edit must never publish")
        if path.endswith("/packages/v2/search"):
            return {"content": course_rows}
        if path.endswith("/product-page/get-all"):
            return [STORE, PATH_PAGE]
        if path.endswith("/folder-library/libraries"):
            assert params["instituteId"] == "inst-1"
            return [{"id": LIB, "institute_id": "inst-1", "name": "Knowledge Streams", "node_count": 30},
                    {"id": FOREIGN_LIB, "institute_id": "inst-OTHER", "name": "Not ours"}]
        if path.endswith("/folder-library/tree"):
            assert params["libraryId"] == LIB
            return {"library": {"id": LIB}, "roots": [
                {"id": FOLDER, "node_type": "FOLDER", "title": "धर्म", "slug": "dharma", "children": [
                    {"id": "folder-vedas", "node_type": "FOLDER", "title": "Vedas", "children": []},
                    {"id": "pp-node", "node_type": "PRODUCT_PAGE", "title": "A path", "children": []}]}]}
        return await base(ctx_, method, path, params=params, body=body, timeout=timeout)

    monkeypatch.setattr(website_data, "_admin_core_json", _call)
    monkeypatch.setattr(edit_mod, "_admin_core_json", _call)
    monkeypatch.setattr(website_mod, "_admin_core_json", _call)
    site.calls = calls
    return site


async def run(args):
    return json.loads(await edit_mod.execute_website_edit(args, ctx()))


async def read(args):
    return json.loads(await website_mod.execute_website(args, ctx()))


# ══ C1 · theme: palette, content width, Devanagari faces ═════════════════
@needs_fixture
def test_bv_palette_and_width_map_to_exactly_the_fixture_theme():
    want = bv()["globalSettings"]["theme"]
    patch = theme_to_global_patch({"palette": bv_palette_args(), "content_max_width": 1152})
    assert patch == {"theme": {"palette": want["palette"], "contentMaxWidth": 1152}}
    gs = merge_global_settings(DEFAULT_GLOBAL_SETTINGS, patch)
    assert gs["theme"]["palette"] == want["palette"] and gs["theme"]["contentMaxWidth"] == 1152


@needs_fixture
@pytest.mark.asyncio
async def test_set_theme_writes_the_bv_palette_to_a_draft_and_keeps_the_rest(site_backend):
    out = await run({"action": "set_theme", "tag_name": "main-site",
                     "theme": {"palette": bv_palette_args(), "content_max_width": 1152, "fonts": {"body": "Lato"}}})
    assert out["saved_as"] == "draft"
    theme = site_backend.saved[-1]["globalSettings"]["theme"]
    assert theme["palette"] == bv()["globalSettings"]["theme"]["palette"]
    assert theme["contentMaxWidth"] == 1152
    assert theme["preset"] == "ocean" and theme["primaryColor"] == "#1D4ED8"        # untouched
    assert out["settings"]["palette"]["primary"] == "#883000" and out["settings"]["content_max_width"] == 1152


@pytest.mark.asyncio
async def test_palette_merges_key_by_key_and_null_removes_one(site_backend):
    site_backend.config["globalSettings"]["theme"]["palette"] = {"text": "#111111", "primary": "#222222", "applyToTokens": True}
    await run({"action": "set_theme", "tag_name": "main-site", "theme": {"palette": {"primary": "#abc", "text": None, "sand": "#F5EAC9"}}})
    assert site_backend.saved[-1]["globalSettings"]["theme"]["palette"] == {
        "primary": "#AABBCC", "sand": "#F5EAC9", "applyToTokens": True}


@pytest.mark.asyncio
async def test_unknown_palette_keys_bad_hex_and_widths_are_refused_with_a_message(site_backend):
    for theme, needle in (
        ({"palette": {"brand": "#112233"}}, "Unknown palette key"),
        ({"palette": {"primary": "red"}}, "must be hex"),
        ({"palette": {"primary": "#123456", "apply_to_tokens": "yes"}}, "apply_to_tokens"),
        ({"content_max_width": 5000}, "content_max_width"),
        ({"content_max_width": 1152.5}, "content_max_width"),
    ):
        out = await run({"action": "set_theme", "tag_name": "main-site", "theme": {"preset": "rose", **theme}})
        assert out["error"] == "bad_request" and needle in out["message"], theme
        assert "palette" in out["accepted"]
    assert site_backend.saved == []                      # nothing half-applied


def test_theme_patch_without_new_keys_is_unchanged():
    old_style = {"preset": "ocean", "primary_color": "#1d4ed8", "border_radius": "pill", "motion": "calm",
                 "fonts": {"body": "Poppins"}}
    assert theme_to_global_patch(old_style) == {
        "theme": {"preset": "ocean", "primaryColor": "#1D4ED8", "borderRadius": "pill"},
        "motion": {"personality": "calm"}, "fonts": {"enabled": True, "family": "Poppins, sans-serif"}}
    assert theme_problems(old_style) == []
    # merge on a site without a palette behaves as the old one-level merge
    gs = {"theme": {"preset": "default", "primaryColor": "#000000"}, "mode": "light"}
    assert merge_global_settings(gs, {"theme": {"preset": "rose", "primaryColor": None}}) == {
        "theme": {"preset": "rose"}, "mode": "light"}


def test_content_width_null_clears_it():
    gs = merge_global_settings({"theme": {"preset": "default", "contentMaxWidth": 1152}},
                               theme_to_global_patch({"content_max_width": None}))
    assert gs == {"theme": {"preset": "default"}}


def test_devanagari_faces_are_choices_and_map_to_stacks():
    assert {"Noto Sans Devanagari", "Mukta", "Hind", "Noto Serif Devanagari", "Tiro Devanagari Hindi"} <= set(website_mod.FONT_CHOICES)
    patch = theme_to_global_patch({"fonts": {"body": "Noto Sans Devanagari"}})
    assert patch["fonts"] == {"enabled": True, "family": '"Noto Sans Devanagari", sans-serif'}


@pytest.mark.asyncio
async def test_heading_font_on_a_hindi_site_is_flagged(site_backend):
    site_backend.config["globalSettings"]["i18n"] = {"enabled": True, "locales": [{"code": "en"}, {"code": "hi"}]}
    site_backend.config["globalSettings"]["fonts"] = {"enabled": True, "family": "Inter, sans-serif"}
    out = await run({"action": "set_theme", "tag_name": "main-site", "theme": {"fonts": {"body": "Lato", "heading": "Fraunces"}}})
    assert any("Devanagari" in w for w in out["warnings"])
    out = await run({"action": "set_theme", "tag_name": "main-site", "theme": {"fonts": {"body": "Lato"}}})
    assert "warnings" not in out


def test_copilot_global_patch_keeps_valid_palette_and_width_only():
    warnings = []
    out = _validate_global_patch({"theme": {"preset": "rose", "palette": {"primary": "#ABC", "brand": "#000000",
                                                                          "text": "nope", "sand": None, "applyToTokens": True},
                                            "contentMaxWidth": 1152}}, warnings)
    assert out == {"theme": {"preset": "rose", "palette": {"primary": "#aabbcc", "sand": None, "applyToTokens": True},
                             "contentMaxWidth": 1152}}
    assert any("brand" in w for w in warnings) and any("palette.text" in w for w in warnings)
    warnings = []
    assert _validate_global_patch({"theme": {"contentMaxWidth": 99999}}, warnings) == {}
    assert warnings
    # a patch without the new keys is filtered exactly as before
    warnings = []
    legacy = {"theme": {"preset": "navy", "headingScale": "compact", "primaryColor": "#123456"}, "motion": {"personality": "calm"}}
    assert _validate_global_patch(legacy, warnings) == {
        "theme": {"headingScale": "compact", "primaryColor": "#123456"}, "motion": {"personality": "calm"}}


def test_update_page_global_op_merges_the_palette_not_replaces_it():
    cfg = sample_config()
    cfg["globalSettings"]["theme"]["palette"] = {"text": "#111111", "primary": "#222222"}
    out = apply_ops(cfg, "p-home", [{"op": "updateGlobalSettings", "patch": {"theme": {"palette": {"primary": "#333333", "text": None}}}}])
    assert out["globalSettings"]["theme"]["palette"] == {"primary": "#333333"}
    assert out["globalSettings"]["theme"]["preset"] == "ocean"


@pytest.mark.asyncio
async def test_update_page_can_set_the_palette_through_the_sanitiser(site_backend):
    out = await run({"action": "update_page", "tag_name": "main-site", "page_route": "home", "ops": [
        {"op": "updateGlobalSettings", "patch": {"theme": {"palette": {"canvas": "#FFFDF8"}, "contentMaxWidth": 1152}}}]})
    assert out["saved_as"] == "draft"
    theme = site_backend.saved[-1]["globalSettings"]["theme"]
    assert theme["palette"] == {"canvas": "#fffdf8"} and theme["contentMaxWidth"] == 1152


def test_summary_of_a_site_without_design_settings_is_unchanged():
    summary = summarize_global_settings(sample_config()["globalSettings"])
    assert set(summary) == {"mode", "theme", "fonts", "audience", "site_wide_lead_popup", "payment_enabled",
                            "course_finder_enabled"}


# ══ C2 · catalogue settings ══════════════════════════════════════════════
def _bv_catalog_args():
    gs = bv()["globalSettings"]
    langs = gs["courseLanguages"]
    return {
        "course_formats": gs["courseFormats"],
        "course_format_order": gs["courseFormatOrder"],
        "course_languages": {"enabled": True, "languages": langs["languages"], "version_groups": langs["versionGroups"]},
        "naming": {"level": "Format"},
        "site_cart": {"enabled": True, "store_product_page_code": "7PC4TL"},
    }


@needs_fixture
def test_catalog_settings_reproduce_the_fixture():
    want = bv()["globalSettings"]
    patch, problems, notes = catalog_settings_patch(_bv_catalog_args(), {}, set(bv_course_ids()), [STORE])
    assert problems == [] and notes == []
    gs = merge_global_settings(DEFAULT_GLOBAL_SETTINGS, patch)
    for key in ("courseFormats", "courseFormatOrder", "courseLanguages", "naming", "siteCart"):
        assert gs[key] == want[key], key


@needs_fixture
@pytest.mark.asyncio
async def test_set_catalog_settings_saves_a_draft_and_summarises_it(site_backend):
    out = await run({"action": "set_catalog_settings", "tag_name": "main-site", "catalog_settings": _bv_catalog_args()})
    assert out["saved_as"] == "draft", out
    saved = site_backend.saved[-1]["globalSettings"]
    assert saved["siteCart"]["storeProductPageCode"] == "7pc4tl"
    assert len(saved["courseLanguages"]["versionGroups"]) == 5
    s = out["settings"]
    assert [f["key"] for f in s["course_formats"]][:3] == ["elearning", "ebook", "live"]
    assert s["course_languages"] == {"enabled": True, "languages": ["en", "hi"], "version_groups": 5}
    assert s["naming"] == {"level": "Format"} and s["site_cart"]["enabled"] is True


@needs_fixture
@pytest.mark.asyncio
async def test_a_foreign_course_id_in_a_version_group_is_refused(site_backend):
    ids = bv_course_ids()
    out = await run({"action": "set_catalog_settings", "tag_name": "main-site", "catalog_settings": {
        "course_languages": {"version_groups": [[ids[0], "course-of-another-institute"]]}}})
    assert out["error"] == "bad_request" and "not this institute's" in out["message"]
    assert site_backend.saved == []


@pytest.mark.asyncio
async def test_unknown_store_page_and_bad_shapes_are_refused(site_backend):
    out = await run({"action": "set_catalog_settings", "tag_name": "main-site",
                     "catalog_settings": {"site_cart": {"enabled": True, "store_product_page_code": "nope"}}})
    assert out["error"] == "bad_request" and "No product page" in out["message"]
    out = await run({"action": "set_catalog_settings", "tag_name": "main-site", "catalog_settings": {"colour": "red"}})
    assert "Unknown setting" in out["message"]
    assert site_backend.saved == []


def test_catalog_settings_caps_and_validation():
    many = {f"f{i}": {"label": f"Format {i}"} for i in range(21)}
    _, problems, _ = catalog_settings_patch({"course_formats": many}, {}, None, None)
    assert any("at most 20" in p for p in problems)
    _, problems, _ = catalog_settings_patch({"course_formats": {"Bad Key!": {"label": "x"}}}, {}, None, None)
    assert any("slug" in p for p in problems)
    _, problems, _ = catalog_settings_patch({"course_formats": {"ebook": {"levels": ["eBook"]}}}, {}, None, None)
    assert any("needs a label" in p for p in problems)
    _, problems, _ = catalog_settings_patch({"course_format_order": ["video"]}, {"courseFormats": {"ebook": {"label": "E"}}}, None, None)
    assert any("not one of the site's formats" in p for p in problems)
    groups = [[f"a{i}", f"b{i}"] for i in range(101)]
    _, problems, _ = catalog_settings_patch({"course_languages": {"version_groups": groups}}, {}, None, None)
    assert any("at most 100" in p for p in problems)
    _, problems, _ = catalog_settings_patch({"course_languages": {"version_groups": [["a", "b"], ["b", "c"]]}}, {}, {"a", "b", "c"}, None)
    assert any("belongs to one group" in p for p in problems)
    _, problems, _ = catalog_settings_patch({"course_formats": {"ebook": {"label": "E", "tags": ["a,b"]}}}, {}, None, None)
    assert any("without commas" in p for p in problems)


def test_catalog_settings_merge_and_strip_markup():
    gs = {"courseFormats": {"ebook": {"label": "E-books"}, "video": {"label": "Video"}}, "naming": {"level": "Level"}}
    patch, problems, notes = catalog_settings_patch({
        "course_formats": {"video": None, "audio": {"label": "<b>Audio</b> books"}},
        "naming": {"level": "Format", "course_plural": "Programmes"},
        "course_languages": {"version_groups": [["a", "b"]]},
    }, gs, {"a", "b"}, None)
    assert problems == []
    out = merge_global_settings(gs, patch)
    assert out["courseFormats"] == {"ebook": {"label": "E-books"}, "audio": {"label": "Audio books"}}
    assert out["naming"] == {"level": "Format", "coursePlural": "Programmes"}
    assert any("enabled" in n for n in notes)                 # groups fold only with grouping on


# ══ C3 · translations ════════════════════════════════════════════════════
def _bv_without_hindi():
    cfg = bv()
    hi = cfg["globalSettings"]["i18n"]["strings"].pop("hi")
    return cfg, hi


@needs_fixture
@pytest.mark.asyncio
async def test_strings_lists_every_untranslated_text_then_set_translations_makes_it_zero(site_backend):
    from app.services.site_strings import collect_site_strings
    cfg, hi = _bv_without_hindi()
    site_backend.config = cfg
    out = await read({"action": "strings", "tag_name": "main-site", "locale": "hi", "limit": 500})
    sources = collect_site_strings(cfg)
    assert out["untranslated_count"] == len(sources) == out["total_texts"] and out["percent"] == 0
    assert [u["text"] for u in out["untranslated"]] == sources
    assert out["untranslated"][0]["where"].startswith("header")
    # hi_check.py semantics: every text with a Latin letter is covered by the BV dictionary…
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": hi})
    assert out["saved_as"] == "draft"
    assert out["changes"]["added"] + out["changes"]["kept_as_base"] == len(hi)    # 'EN' and 'हिं' read the same
    assert out["coverage"]["untranslated"] == 1                 # …only the Hindi-authored 'सभी' is left
    # …and a text kept as is in Hindi is stored as itself (the panel's "Same as base").
    site_backend.config = site_backend.saved[-1]
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {"सभी": "सभी"}})
    assert out["changes"]["kept_as_base"] == 1 and out["coverage"]["untranslated"] == 0
    site_backend.config = site_backend.saved[-1]
    out = await read({"action": "strings", "tag_name": "main-site", "locale": "hi"})
    assert out["untranslated_count"] == 0 and out["percent"] == 100
    saved = site_backend.saved[-1]["globalSettings"]["i18n"]["strings"]["hi"]
    assert set(saved) == set(hi) | {"सभी"}
    # Plain texts are stored as sent; rich-text ones went through the builder's nh3 sanitiser (adds rel=…).
    assert {k: v for k, v in saved.items() if "<" not in k} == {k: v for k, v in {**hi, "सभी": "सभी"}.items() if "<" not in k}


def test_merge_translations_semantics():
    current = {"Courses": "पाठ्यक्रम", "Free": "मुफ़्त", "Old": "पुराना"}
    out, report = merge_translations(current, {
        "Old": None, "Free": "", "Courses": "पाठ्यक्रम", "Login": "<b>लॉग</b> इन<script>x()</script>",
        "<p>Rich <b>text</b></p>": "<p>समृद्ध <b>पाठ</b><script>alert(1)</script></p>",
        "Brand": "Brand", "Bad": 5, "": "x", "Empty": "<i></i>",
    })
    assert out["Courses"] == "पाठ्यक्रम" and "Old" not in out and "Free" not in out
    assert out["Login"] == "लॉग इनx()"                          # plain-text source: every tag removed
    assert "<b>पाठ</b>" in out["<p>Rich <b>text</b></p>"] and "script" not in out["<p>Rich <b>text</b></p>"]
    assert out["Brand"] == "Brand"
    assert report["removed"] == 2 and report["unchanged"] == 1 and report["kept_as_base"] == 1 and report["added"] == 2
    assert {s["source"] for s in report["skipped"]} == {"Bad", "", "Empty"}


@pytest.mark.asyncio
async def test_set_translations_never_wipes_and_respects_caps(site_backend):
    site_backend.config["globalSettings"]["i18n"] = {"enabled": True, "defaultLocale": "en",
                                                     "locales": [{"code": "en", "label": "EN"}, {"code": "hi", "label": "हिन्दी"}],
                                                     "strings": {"hi": {"Home": "होम"}, "mr": {"Home": "मुखपृष्ठ"}}}
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {"About": "हमारे बारे में"}})
    saved = site_backend.saved[-1]["globalSettings"]["i18n"]["strings"]
    assert saved == {"hi": {"Home": "होम", "About": "हमारे बारे में"}, "mr": {"Home": "मुखपृष्ठ"}}
    too_many = {f"Text {i}": f"पाठ {i}" for i in range(1500)}
    site_backend.config["globalSettings"]["i18n"]["strings"]["hi"] = {f"Old {i}": f"पु {i}" for i in range(1501)}
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": too_many})
    assert out["error"] == "too_large"
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {f"T{i}": "x" for i in range(1501)}})
    assert out["error"] == "bad_request"
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "en", "strings": {"Home": "Home"}})
    assert out["error"] == "base_locale"
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "h i", "strings": {"Home": "x"}})
    assert out["error"] == "bad_request"
    assert len(site_backend.saved) == 1


@pytest.mark.asyncio
async def test_enable_offers_the_language(site_backend):
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {"Home": "होम"}})
    assert "enable_hint" in out
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "enable": True})
    i18n = site_backend.saved[-1]["globalSettings"]["i18n"]
    assert i18n["enabled"] is True and i18n["defaultLocale"] == "en"
    assert i18n["locales"] == [{"code": "en", "label": "EN"}, {"code": "hi", "label": "हिन्दी"}]
    assert "enable_hint" not in out


# ══ C4 · bind_data + audit wording ══════════════════════════════════════
def _bindable_site():
    cfg = sample_config()
    cfg["globalSettings"]["layout"] = {"header": {"id": "header-1", "type": "header", "props": {
        "title": "Acme", "navigation": [{"label": "Home", "route": "home"}, {"label": "Knowledge Streams", "route": "/courses"}]}}}
    cfg["pages"][1]["components"].extend([
        {"id": "paths", "type": "learningPath", "enabled": True, "props": {"mode": "single", "productPageCode": ""}},
        {"id": "folders", "type": "folderBrowser", "enabled": True, "props": {"libraryId": ""}},
    ])
    return cfg


@pytest.mark.asyncio
async def test_bind_streams_and_mega_menu_to_a_library_on_a_draft(site_backend):
    site_backend.config = _bindable_site()
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "c-catalog",
                     "data_kind": "folderLibrary", "data_id": LIB})
    assert out["saved_as"] == "draft" and out["binding"]["prop"] == "props.streams.libraryId"
    streams = site_backend.saved[-1]["pages"][1]["components"][1]["props"]["streams"]
    assert streams == {"libraryId": LIB, "libraryName": "Knowledge Streams", "source": "folderLibrary", "enabled": True}

    site_backend.config = site_backend.saved[-1]
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "header",
                     "data_kind": "folderLibrary", "data_id": LIB})
    assert out["error"] == "no_target" and "nav_index" in out["message"]
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "header", "nav_index": 1,
                     "data_kind": "folderLibrary", "data_id": LIB})
    item = site_backend.saved[-1]["globalSettings"]["layout"]["header"]["props"]["navigation"][1]
    assert item["type"] == "megaMenu" and item["megaMenu"] == {"libraryId": LIB, "libraryName": "Knowledge Streams"}
    assert out["side_effects"]


@pytest.mark.asyncio
async def test_bind_refuses_ids_the_institute_does_not_own(site_backend):
    site_backend.config = _bindable_site()
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "folders",
                     "data_kind": "folderLibrary", "data_id": FOREIGN_LIB})
    assert out["error"] == "unknown_library" and out["available"] == [{"id": LIB, "name": "Knowledge Streams"}]
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "productPage", "data_id": "NOT-OURS"})
    assert out["error"] == "unknown_product_page"
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "folders",
                     "data_kind": "folder", "data_id": "pp-node", "library_id": LIB})
    assert out["error"] == "unknown_folder"                     # a product-page node is not a folder
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "c-cols",
                     "data_kind": "productPage", "data_id": "7pc4tl"})
    assert out["error"] == "no_target"
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "c-catalog",
                     "data_kind": "productPage", "data_id": "7pc4tl", "path": "streams.style"})
    assert out["error"] == "no_target"
    assert site_backend.saved == []


@pytest.mark.asyncio
async def test_bind_folder_product_page_and_learning_path_modes(site_backend):
    site_backend.config = _bindable_site()
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "folders",
                     "data_kind": "folder", "data_id": "folder-vedas", "library_id": LIB})
    props = site_backend.saved[-1]["pages"][1]["components"][3]["props"]
    assert props["rootFolderId"] == "folder-vedas" and props["libraryId"] == LIB
    site_backend.config = site_backend.saved[-1]
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "productPage", "data_id": "PATH01"})
    props = site_backend.saved[-1]["pages"][1]["components"][2]["props"]
    assert props["productPageCode"] == "path01" and props["productPageName"] == "Path: Foundations"
    site_backend.config = site_backend.saved[-1]
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "folderLibrary", "data_id": LIB})
    props = site_backend.saved[-1]["pages"][1]["components"][2]["props"]
    assert props["mode"] == "list" and props["libraryId"] == LIB
    assert any("list mode" in s for s in out["side_effects"])


@pytest.mark.asyncio
async def test_bind_featured_learning_path_codes_keeps_the_featured_list(site_backend):
    """F2: featured.code / pathExtras[i].code bind in place; the featured layout is never switched to single."""
    cfg = _bindable_site()
    cfg["pages"][1]["components"][2]["props"] = {
        "mode": "list", "listLayout": "featured", "libraryId": LIB, "featured": {"code": "", "badge": "Popular"},
        "pathExtras": [{"code": "", "steps": ["a"]}]}
    site_backend.config = cfg
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "productPage", "data_id": "PATH01"})
    assert out["error"] == "no_target" and "featured.code" in out["message"]
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "productPage", "data_id": "PATH01", "path": "featured.code"})
    assert out["binding"]["prop"] == "props.featured.code"
    props = site_backend.saved[-1]["pages"][1]["components"][2]["props"]
    assert props["mode"] == "list" and props["listLayout"] == "featured"
    assert props["featured"] == {"code": "path01", "badge": "Popular"} and "productPageCode" not in props
    site_backend.config = site_backend.saved[-1]
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "productPage", "data_id": "PATH01", "path": "pathExtras[0].code"})
    props = site_backend.saved[-1]["pages"][1]["components"][2]["props"]
    assert props["pathExtras"] == [{"code": "path01", "steps": ["a"]}] and props["mode"] == "list"
    assert "side_effects" not in out
    # Unknown codes are still refused, and the code path is only for learning paths.
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "paths",
                     "data_kind": "productPage", "data_id": "NOT-OURS", "path": "featured.code"})
    assert out["error"] == "unknown_product_page"
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "about", "section_id": "c-catalog",
                     "data_kind": "productPage", "data_id": "PATH01", "path": "featured.code"})
    assert out["error"] == "no_target"


def test_audit_says_bind_to_an_editor_and_remove_to_the_composer():
    comp = {"id": "paths", "type": "learningPath", "props": {"mode": "list"}}
    composer = audit_component(comp)
    assert composer[0]["code"] == "path-unbound" and composer[0]["hint"].startswith("Remove this component")
    editor = audit_component(comp, can_bind=True)
    assert "bind_data" in editor[0]["hint"] and "folderLibrary" in editor[0]["hint"]
    assert "Remove this component" not in editor[0]["hint"]
    page = {"components": [comp, {"id": "o", "type": "productPageOffer", "props": {}}, {"id": "f", "type": "folderBrowser", "props": {}}]}
    hints = {i["code"]: i["hint"] for i in audit_page(page, None, can_bind=True)}
    assert all("bind_data" in hints[c] for c in ("path-unbound", "offer-unbound", "folders-unbound"))
    assert all("Remove this component" in i["hint"] for i in audit_page(page, None) if i["code"].endswith("unbound"))




@pytest.mark.asyncio
async def test_mcp_results_say_bind_not_remove(site_backend):
    site_backend.config = _bindable_site()
    out = await run({"action": "create_page", "tag_name": "main-site", "page": {"route": "paths", "components": [
        {"id": "paths", "type": "learningPath", "props": {"mode": "list", "title": "Learning paths"}}]}})
    unbound = [i for i in out["design_issues"] if i["code"] == "path-unbound"]
    assert unbound and "bind_data" in unbound[0]["fix"] and "Remove this" not in unbound[0]["fix"]
    assert "page_route='paths'" in unbound[0]["fix"] and "folder_libraries" in unbound[0]["fix"]

    async def review(groups):
        setting = {"enabled_tools": list(groups), "role_overrides": {}}
        return json.loads(await execute_tool("website", {"action": "review", "tag_name": "main-site", "page_route": "about"},
                                             ctx(), setting))
    # A caller who can edit drafts is told to bind, on the right page…
    out = await review(["website_builder", "website_builder_edits"])
    fixes = [i["fix"] for i in out["pages"]["about"]["issues"] if i["code"] in ("path-unbound", "folders-unbound")]
    assert fixes and all("bind_data" in f and "page_route='about'" in f for f in fixes)
    # …a read-only caller keeps exactly the review it had before.
    read_only = await review(["website_builder"])
    plain = await read({"action": "review", "tag_name": "main-site", "page_route": "about"})
    assert read_only == plain
    assert not any("bind_data" in json.dumps(i) for i in read_only["pages"]["about"]["issues"])


@pytest.mark.asyncio
async def test_context_lists_folder_libraries_and_a_librarys_folders(site_backend):
    out = await read({"action": "context", "tag_name": "main-site"})
    assert out["folder_libraries"] == [{"id": LIB, "name": "Knowledge Streams", "node_count": 30}]   # not the foreign one
    assert "library_id" in out["folder_libraries_note"]
    out = await read({"action": "context", "tag_name": "main-site", "library_id": LIB})
    folders = out["library_folders"]["folders"]
    assert [(f["id"], f["depth"]) for f in folders] == [(FOLDER, 0), ("folder-vedas", 1)]     # folders only
    out = await read({"action": "context", "tag_name": "main-site", "library_id": FOREIGN_LIB})
    assert out["library_folders"]["error"] == "unknown_library"


@pytest.mark.asyncio
async def test_library_outage_is_fetch_failed_not_unknown_library(site_backend, monkeypatch):
    site_backend.config = _bindable_site()
    inner = website_data._admin_core_json

    async def _down(ctx_, method, path, **kw):
        if path.endswith("/folder-library/libraries"):
            return {"error": "fetch_failed", "status": 503}
        return await inner(ctx_, method, path, **kw)
    monkeypatch.setattr(website_data, "_admin_core_json", _down)
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "folders",
                     "data_kind": "folderLibrary", "data_id": LIB})
    assert out["error"] == "fetch_failed"
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "folders",
                     "data_kind": "folder", "data_id": FOLDER, "library_id": LIB})
    assert out["error"] == "fetch_failed"
    out = await read({"action": "context", "tag_name": "main-site"})
    assert out["folder_libraries"]["error"] == "fetch_failed"
    assert site_backend.saved == []


@pytest.mark.asyncio
async def test_bind_finds_the_section_on_any_page_without_page_route(site_backend):
    site_backend.config = _bindable_site()
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "folders",
                     "data_kind": "folderLibrary", "data_id": LIB})
    assert out["saved_as"] == "draft" and out["page_route"] == "about"
    assert site_backend.saved[-1]["pages"][1]["components"][3]["props"]["libraryId"] == LIB
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "nope",
                     "data_kind": "folderLibrary", "data_id": LIB})
    assert out["error"] == "unknown_section"
    assert {"page_route": "about", "section_id": "folders", "type": "folderBrowser"} in out["sections"]
    cfg = _bindable_site()
    cfg["pages"][0]["components"].append({"id": "folders", "type": "folderBrowser", "props": {}})
    site_backend.config = cfg
    out = await run({"action": "bind_data", "tag_name": "main-site", "section_id": "folders",
                     "data_kind": "folderLibrary", "data_id": LIB})
    assert out["error"] == "ambiguous_section" and out["pages"] == ["home", "about"]
    assert len(site_backend.saved) == 1


@pytest.mark.asyncio
async def test_an_explicit_path_never_creates_objects(site_backend):
    site_backend.config = _bindable_site()
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "home", "section_id": "c-hero",
                     "data_kind": "productPage", "data_id": "7pc4tl", "path": "a.b.c.d.e.f.productPageCode"})
    assert out["error"] == "no_target"
    assert site_backend.saved == []
    # An object the section already has is fine.
    site_backend.config["pages"][0]["components"][1]["props"]["offer"] = {"title": "Store"}
    out = await run({"action": "bind_data", "tag_name": "main-site", "page_route": "home", "section_id": "c-hero",
                     "data_kind": "productPage", "data_id": "7pc4tl", "path": "offer.productPageCode"})
    assert out["saved_as"] == "draft"
    assert site_backend.saved[-1]["pages"][0]["components"][1]["props"]["offer"] == {
        "title": "Store", "productPageCode": "7pc4tl", "productPageName": STORE["name"]}


@pytest.mark.asyncio
async def test_apply_to_tokens_alone_on_a_site_without_a_palette_is_refused(site_backend):
    out = await run({"action": "set_theme", "tag_name": "main-site", "theme": {"palette": {"apply_to_tokens": True}}})
    assert out["error"] == "bad_request" and "no palette colours" in out["message"]
    assert site_backend.saved == []
    site_backend.config["globalSettings"].setdefault("theme", {})["palette"] = {"primary": "#883000"}
    out = await run({"action": "set_theme", "tag_name": "main-site", "theme": {"palette": {"apply_to_tokens": True}}})
    assert site_backend.saved[-1]["globalSettings"]["theme"]["palette"] == {"primary": "#883000", "applyToTokens": True}


def test_apply_ops_drops_a_palette_with_no_colour_like_the_dashboard():
    cfg = sample_config()
    cfg["globalSettings"].pop("theme", None)
    out = apply_ops(cfg, "p-home", [{"op": "updateGlobalSettings", "patch": {"theme": {"palette": {"applyToTokens": True}}}}])
    assert "palette" not in out["globalSettings"]["theme"]
    out = apply_ops(cfg, "p-home", [{"op": "updateGlobalSettings", "patch": {"theme": {"preset": "rose"}}}])
    assert out["globalSettings"]["theme"] == {"preset": "rose"}           # no palette: as before


@needs_fixture
@pytest.mark.asyncio
async def test_version_groups_are_checked_against_the_admins_courses_not_the_public_search(site_backend):
    ids = bv_course_ids()
    out = await run({"action": "set_catalog_settings", "tag_name": "main-site", "catalog_settings": {
        "course_languages": {"version_groups": [[ids[0], "hidden-course"]]}}})
    assert out["saved_as"] == "draft", out                      # hidden from the catalogue, still the institute's
    assert _DB["queries"] == 1
    _DB["fail"] = True
    out = await run({"action": "set_catalog_settings", "tag_name": "main-site", "catalog_settings": {
        "course_languages": {"version_groups": [[ids[0], ids[1]]]}}})
    assert out["error"] == "fetch_failed" and "not this institute" not in out["message"]
    assert len(site_backend.saved) == 1


def test_a_format_key_is_removed_or_replaced_whatever_case_it_was_saved_in():
    gs = {"courseFormats": {"Ebook": {"label": "E-books"}, "video": {"label": "Video"}}}
    patch, problems, _ = catalog_settings_patch({"course_formats": {"ebook": None}}, gs, None, None)
    assert problems == []
    assert merge_global_settings(gs, patch)["courseFormats"] == {"video": {"label": "Video"}}
    patch, problems, _ = catalog_settings_patch({"course_formats": {"EBOOK": {"label": "Books"}}}, gs, None, None)
    assert merge_global_settings(gs, patch)["courseFormats"] == {"video": {"label": "Video"}, "ebook": {"label": "Books"}}


def test_long_rich_texts_up_to_the_dashboards_cap_can_be_saved():
    source = "<p>" + "Vedic knowledge " * 600 + "</p>"                  # ~9.6k characters, like a long rich-text section
    out, report = merge_translations({}, {source: "<p>" + "वैदिक ज्ञान " * 600 + "</p>"})
    assert report["added"] == 1 and source in out
    _, report = merge_translations({}, {"x" * 30001: "y"})
    assert report["skipped"]


@pytest.mark.asyncio
async def test_an_over_cap_dictionary_from_the_dashboard_can_still_shrink(site_backend):
    big = {f"Text {i}": f"पाठ {i}" for i in range(3005)}             # built in the dashboard, past the MCP's cap
    site_backend.config["globalSettings"]["i18n"] = {"enabled": True, "defaultLocale": "en", "strings": {"hi": dict(big)}}
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {"Text 1": None}})
    assert out["saved_as"] == "draft" and out["changes"]["removed"] == 1
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {"Text 2": "पा"}})
    assert out["saved_as"] == "draft"                              # shorter: does not grow it
    out = await run({"action": "set_translations", "tag_name": "main-site", "locale": "hi", "strings": {"New": "नया"}})
    assert out["error"] == "too_large"
    assert len(site_backend.saved) == 2
