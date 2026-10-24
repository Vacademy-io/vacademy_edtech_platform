"""
Design-pattern registry over the MCP: the generated schema catalog carries the
patterns / chrome / site-settings contract exported from the learner registry
(frontend-learner-dashboard-app/src/routes/$tagName/-ai/design-patterns.ts),
website(action='schema') passes them on, and website(action='patterns')
serves a pattern's minimal and full JSON.

The catalog is generated (scripts/export-catalogue-schema-catalog.mjs); these
tests pin what the Python side relies on, and that the generated full examples
never carry the Brahm Varchas fixture's ids or uploaded-asset URLs.
"""
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services.assistant_tool_registry import ToolContext  # noqa: E402

CATALOG_PATH = Path(__file__).resolve().parents[1] / "app" / "data" / "catalogue_schema_catalog.json"
REPO = Path(__file__).resolve().parents[2]
ADMIN_COPY = REPO / "frontend-admin-dashboard/src/routes/manage-pages/-utils/generated/design-patterns.json"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
BRAND = re.compile(r"brahm ?varchas|bvshiksha|ब्रह्म|translate knowledge", re.I)
LEAVE_EMPTY = re.compile(r"^<[^<>]*leave empty[^<>]*>$")


def ctx():
    # schema / patterns read only the checked-in catalog: no database, no service call.
    principal = PinnedPrincipal(user_id="user-1", institute_id="inst-1", roles=["ADMIN"], permissions=[], is_root_user=False)
    return ToolContext(db=SimpleNamespace(), principal=principal, keys=(), bearer_token="jwt")


def catalog():
    return json.loads(CATALOG_PATH.read_text())


async def run(args):
    return json.loads(await website_mod.execute_website(args, ctx()))


# ── the generated catalog ────────────────────────────────────────────────
def test_catalog_carries_patterns_chrome_contract_and_recipes():
    cat = catalog()
    ids = [p["id"] for p in cat["patterns"]]
    assert len(ids) == len(set(ids)) and len(ids) >= 30
    assert {"catalog.hero", "catalog.streams.icons", "cta.band", "footer.brand", "global.palette", "header.megaMenu"} <= set(ids)
    assert set(cat["chrome"]) == {"header", "footer"}
    assert {"barSize", "navStyle", "megaMenuStyle", "cartDisplay"} <= set(cat["chrome"]["header"]["fields"])
    assert "theme.palette" in cat["globalSettingsContract"]["fields"]
    known = set(ids)
    for recipe in cat["recipes"]:
        for page in recipe["pages"]:
            for section in page["sections"]:
                assert set(section["patterns"]) <= known
        assert set(recipe["site"]) <= known


def test_catalog_names_every_new_widget_prop():
    """R1: the contract had none of these before the registry."""
    text = json.dumps(catalog(), ensure_ascii=False)
    for name in ("filterSidebar", "columnSections", "cardStyle", "palette", "courseFormats", "versionGroups",
                 "megaMenu", '"band"', '"brand"', '"cards"', "contentMaxWidth", "courseLanguages", "titleAccent",
                 "listLayout", "secondaryButton", "quickFilterBar", "resultsHeader"):
        assert name in text, name


def test_capabilities_list_the_new_variants():
    comps = {c["type"]: c for c in catalog()["components"]}
    assert "cards" in comps["stepsProcess"]["capabilities"]
    assert "band" in comps["ctaBanner"]["capabilities"] and "secondaryButton" in comps["ctaBanner"]["capabilities"]
    assert "editorial" in comps["heroSection"]["capabilities"]
    for t in ("courseCatalog", "learningPath", "header", "footer"):
        assert comps[t].get("capabilities"), t
    assert "NEVER ADD" in comps["learningPath"]["dataBound"]


def test_chrome_capabilities_keep_ids_out_and_fit_the_budget():
    comps = {c["type"]: c for c in catalog()["components"]}
    for t in ("header", "footer"):
        assert "never a page section" not in comps[t]["capabilities"], t  # the composer may emit chrome (allow_chrome)
        assert "leave it empty" in comps[t]["capabilities"], t
    assert "Leave every audienceId EMPTY" in comps["ctaBanner"]["capabilities"]
    # Every composer / copilot / restyle / chrome prompt carries these: keep the growth deliberate.
    assert sum(len(c.get("capabilities") or "") for c in comps.values()) <= 8500


def test_full_examples_never_carry_fixture_ids_or_assets():
    for p in catalog()["patterns"]:
        if "full" not in p:
            continue
        text = json.dumps(p["full"], ensure_ascii=False)
        assert not UUID.search(text), p["id"]
        assert "cloudfront.net" not in text, p["id"]
        for code in ("forbvy", "ks61g1", "7pc4tl"):
            assert f'"{code}"' not in text, p["id"]


def test_full_examples_never_carry_fixture_links_or_brand():
    """A copied footer must not link another institute to Brahm Varchas' policies, socials or name."""
    for p in catalog()["patterns"]:
        authored = {k: v for k, v in p.items() if k not in ("full", "fullSource")}
        assert not BRAND.search(json.dumps(authored, ensure_ascii=False)), p["id"]
        if "full" not in p:
            continue
        text = json.dumps(p["full"], ensure_ascii=False)
        assert not BRAND.search(text), p["id"]
        assert not re.search(r"https?://", text), p["id"]


def _bound_values(root, path):
    nodes = [root]
    for seg in path.split("."):
        key, each = re.sub(r"(\[\]|\{\})$", "", seg), seg.endswith("[]")
        nxt = []
        for n in nodes:
            v = n.get(key) if isinstance(n, dict) else None
            if v is None:
                continue
            nxt.extend(v if each and isinstance(v, list) else [v])
        nodes = nxt
    out = []
    for v in nodes:
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, list):  # an id list, or versionGroups' list of id lists
            out.extend(y for x in v for y in (x if isinstance(x, list) else [x]) if isinstance(y, str))
        elif isinstance(v, dict):
            out.extend(v.keys())
    return [v for v in out if v]


def test_bound_placeholders_say_leave_empty():
    """Writes do not check ids, so no example may invite the AI to paste one (it must stay empty)."""
    checked = 0
    for p in catalog()["patterns"]:
        for b in p.get("bound") or []:
            for root in (p["minimal"], p.get("full") or {}):
                for v in _bound_values(root, b):
                    assert LEAVE_EMPTY.match(v), (p["id"], b, v)
                    checked += 1
    assert checked > 20


def test_every_pattern_targets_a_known_block():
    cat = catalog()
    types = {c["type"] for c in cat["components"]} | {"globalSettings"}
    for p in cat["patterns"]:
        assert p["component"] in types, p["id"]
        assert p["minimal"] and p["looksLike"] and p["figmaCues"], p["id"]


@pytest.mark.skipif(not ADMIN_COPY.exists(), reason="admin app not in this checkout")
def test_admin_copy_matches_the_catalog():
    admin = json.loads(ADMIN_COPY.read_text())
    cat = catalog()
    assert admin["patterns"] == cat["patterns"]
    assert admin["recipes"] == cat["recipes"]


# ── website(action='schema') ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_schema_adds_chrome_contract_patterns_and_component_notes():
    out = await run({"action": "schema"})
    types = {c["type"] for c in out["components"]}
    assert "header" not in types and "footer" not in types
    assert set(out["chrome"]) == {"header", "footer"}
    assert "set_layout" in out["chrome"]["header"]["how"]
    assert "megaMenuStyle" in out["chrome"]["header"]["fields"]
    assert "theme.palette" in out["globalSettingsContract"]["fields"]
    assert out["globalSettingsContract"]["writable_now"]
    assert "catalog.hero" in out["patterns"]["courseCatalog"]
    assert "footer.brand" in out["patterns"]["footer"]
    comps = {c["type"]: c for c in out["components"]}
    assert "NEVER ADD" in comps["learningPath"]["dataBound"]
    assert comps["detailBlocks"]["usage"]
    assert comps["htmlBlock"]["escapeHatch"]
    assert "dataBound" not in comps["heroSection"]


@pytest.mark.asyncio
async def test_schema_keeps_its_existing_keys():
    out = await run({"action": "schema", "section_types": ["heroSection"]})
    for key in ("page_contract", "html_page_contract", "doctrine", "design_rules", "design_languages", "style_schema",
                "theme_choices", "components", "examples", "ops_contract"):
        assert key in out, key
    assert all({"type", "label", "what", "props"} <= set(c) for c in out["components"])
    assert list(out["examples"]) == ["heroSection"]


# ── website(action='patterns') ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_patterns_rules_keep_ids_empty_and_deep_merge():
    out = await run({"action": "patterns"})
    rules = out["rules"]
    assert "leave every bound path EMPTY" in rules and "link_lead_form" in rules
    assert "DEEP-merge" in rules and "columnSections" in rules
    assert "not even one from website(context)" in rules
    recipe = next(r for r in catalog()["recipes"] if r["id"] == "editorial-catalogue")
    assert "Deep-merge" in recipe["pages"][0]["sections"][0]["note"]


@pytest.mark.asyncio
async def test_patterns_without_filter_is_an_index():
    out = await run({"action": "patterns"})
    assert out["action"] == "patterns"
    assert out["count"] == len(out["patterns"]) >= 30
    # The index stays compact: the registry's short label, no JSON.
    assert all(set(p) == {"id", "label", "component", "looks_like"} for p in out["patterns"])
    assert {r["id"] for r in out["recipes"]} >= {"editorial-catalogue", "learning-paths", "brand-chrome"}
    assert "placeholder" in out["rules"]


@pytest.mark.asyncio
async def test_patterns_by_id_returns_minimal_and_full():
    out = await run({"action": "patterns", "ids": ["catalog.hero", "cta.band"]})
    assert [p["id"] for p in out["patterns"]] == ["catalog.hero", "cta.band"]
    hero = out["patterns"][0]
    assert hero["minimal"]["hero"]["enabled"] is True
    assert hero["full"]["hero"]["popular"] and hero["full_source"].startswith("brahm-varchas-site#")
    assert hero["figmaCues"] and hero["pitfalls"]
    band = out["patterns"][1]
    assert band["full"]["secondaryButton"]["audienceId"].startswith("<audienceId")
    assert "unknown_ids" not in out


@pytest.mark.asyncio
async def test_patterns_reports_unknown_ids():
    out = await run({"action": "patterns", "ids": ["catalog.hero", "nope.nothing"]})
    assert [p["id"] for p in out["patterns"]] == ["catalog.hero"]
    assert out["unknown_ids"] == ["nope.nothing"] and "catalog.hero" in out["available_ids"]
    # A model that sends one id as a string still gets it.
    single = await run({"action": "patterns", "ids": "footer.brand"})
    assert [p["id"] for p in single["patterns"]] == ["footer.brand"]


@pytest.mark.asyncio
async def test_patterns_by_component_and_query():
    many = await run({"action": "patterns", "component": "courseCatalog"})
    assert many["count"] > 6 and all("minimal" not in p for p in many["patterns"]) and "hint" in many
    assert {p["component"] for p in many["patterns"]} == {"courseCatalog"}

    few = await run({"action": "patterns", "component": "footer"})
    assert {p["id"] for p in few["patterns"]} == {"footer.brand", "footer.newsletter"}
    assert all("minimal" in p for p in few["patterns"])

    found = await run({"action": "patterns", "query": "phone"})
    assert "cta.band.app" in {p["id"] for p in found["patterns"]}

    none = await run({"action": "patterns", "query": "zzzz-not-a-look"})
    assert none["count"] == 0 and "hint" in none


@pytest.mark.asyncio
async def test_patterns_by_id_covers_the_largest_recipe():
    cat = catalog()
    for recipe in cat["recipes"]:
        ids = [i for page in recipe["pages"] for s in page["sections"] for i in s["patterns"]] + recipe["site"]
        out = await run({"action": "patterns", "ids": ids})
        assert out["count"] == len(set(ids)), recipe["id"]
        assert "skipped_ids" not in out and "truncated" not in out


@pytest.mark.asyncio
async def test_patterns_by_id_reports_what_it_skipped():
    every = [p["id"] for p in catalog()["patterns"]]
    out = await run({"action": "patterns", "ids": every})
    cap = website_mod._PATTERN_MAX_IDS
    assert out["count"] == cap and len(every) > cap
    assert out["skipped_ids"] == every[cap:] and out["truncated"] is True
    assert "call again" in out["hint"]
    again = await run({"action": "patterns", "ids": out["skipped_ids"]})
    assert [p["id"] for p in again["patterns"]] == every[cap:]


@pytest.mark.asyncio
async def test_patterns_filter_ergonomics():
    # Any casing of a block type works.
    out = await run({"action": "patterns", "component": "CourseCatalog"})
    assert out["count"] > 6 and {p["component"] for p in out["patterns"]} == {"courseCatalog"}
    # An unknown block type lists the real ones.
    bad = await run({"action": "patterns", "component": "megaFooter"})
    assert bad["count"] == 0 and bad["unknown_component"] == "megaFooter"
    assert "courseCatalog" in bad["available_components"] and "globalSettings" in bad["available_components"]
    # ids win over filters, and the response says so.
    mixed = await run({"action": "patterns", "ids": ["cta.band"], "component": "footer", "query": "phone"})
    assert [p["id"] for p in mixed["patterns"]] == ["cta.band"]
    assert mixed["ignored_filters"] == ["component", "query"] and "ignored" in mixed["hint"]


@pytest.mark.asyncio
async def test_unknown_action_lists_patterns():
    out = await run({"action": "nope"})
    assert out["error"] == "unknown_action" and "patterns" in out["available"]
