"""
The deterministic core of design_import (app/services/figma_design_import.py)
on a small SYNTHETIC design: every layer is called 'Frame', so matching must
come from structure and text, the way most Figma files are named. (The client's
real design is scored separately by evals/figma_bv, never committed.)
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import figma_design_import as fdi  # noqa: E402
from app.services.assistant_tools_website_edit import (  # noqa: E402
    FONT_STACKS, theme_problems, theme_to_global_patch,
)

CATALOG = json.loads((Path(__file__).resolve().parents[1] / "app" / "data" / "catalogue_schema_catalog.json").read_text())
PATTERNS = CATALOG["patterns"]


def _t(i, text, x, y, w=200, h=20):
    return f'<text id="9:{i}" name="{text}" x="{x}" y="{y}" width="{w}" height="{h}" />'


def _f(i, x, y, w, h, *kids, name="Frame", tag="frame"):
    inner = "".join(kids)
    return f'<{tag} id="9:{i}" name="{name}" x="{x}" y="{y}" width="{w}" height="{h}">{inner}</{tag}>'


def _button(i, label, x, y, w=160, h=44):
    """A box with one centred text — a button with no name and no code."""
    return _f(i, x, y, w, h, _t(i + 1, label, 20, 12, w - 40, 20))


def design_xml(trailing=True):
    header = _f(100, 0, 0, 1440, 64,
                _f(101, 144, 8, 48, 48, tag="rounded-rectangle"),
                _f(102, 400, 22, 500, 20, _t(103, "Courses", 0, 0, 60), _t(104, "Teachers", 100, 0, 60),
                   _t(105, "Fees", 200, 0, 40), _t(106, "Contact", 300, 0, 60)),
                _f(107, 1100, 18, 90, 30, _t(108, "हिन्दी", 8, 6, 30, 16), _t(109, "EN", 50, 6, 20, 16)))
    hero = _f(200, 0, 64, 1440, 360,
              _t(201, "Home / Courses", 144, 40, 120),
              _t(202, "Every course we teach", 144, 80, 600, 52),
              _t(203, "Board, competitive and foundation courses for classes 6 to 12, online and on campus.", 144, 140, 800, 24),
              _t(204, "48", 1100, 80, 30, 28), _t(205, "courses", 1100, 110, 80, 16),
              _t(206, "3", 1200, 80, 20, 28), _t(207, "campuses", 1200, 110, 80, 16),
              _f(208, 144, 200, 1152, 60, _t(209, "Search courses, subjects or teachers", 50, 20, 600, 20),
                 _button(210, "Search", 1000, 8, 120, 44)),
              _f(212, 144, 290, 600, 30, _t(213, "Popular:", 0, 6, 60, 18),
                 _button(214, "JEE", 70, 0, 60, 30), _button(216, "NEET", 140, 0, 70, 30),
                 _button(218, "Olympiad", 220, 0, 90, 30)))
    band = _f(300, 0, 424, 1440, 220,
              _t(301, "Not sure which course fits?", 144, 60, 600, 40),
              _t(302, "Tell us your class and goal and a counsellor will call you back today.", 144, 110, 700, 22),
              _button(303, "Talk to us", 1000, 80, 160, 48), _button(305, "See fees", 1180, 80, 120, 48))
    steps_cards = "".join(
        _f(410 + 10 * k, 144 + 390 * k, 100, 372, 200,
           _t(411 + 10 * k, str(k + 1), 24, 24, 20, 20),
           _t(412 + 10 * k, f"Step title {k + 1}", 24, 60, 300, 24),
           _t(413 + 10 * k, "One short line that explains what happens in this step.", 24, 100, 320, 40))
        for k in range(3))
    steps = _f(400, 0, 644, 1440, 360, _t(401, "How admission works", 144, 40, 500, 36),
               _f(402, 0, 0, 1440, 360, steps_cards))
    col = lambda i, x, head, links: _f(i, x, 40, 200, 200, _t(i + 1, head, 0, 0, 100, 22),  # noqa: E731
                                       *[_t(i + 2 + j, l, 0, 32 + 28 * j, 120, 20) for j, l in enumerate(links)])
    footer = _f(500, 0, 1004, 1440, 420,
                _t(501, "Acme Academy", 144, 40, 300, 56),
                _t(502, "A school for curious minds since 1998, in three cities and online.", 144, 110, 400, 44),
                _t(503, "Stay in touch", 700, 40, 200, 24),
                _f(504, 700, 80, 300, 44, _t(505, "Your email address", 12, 12, 200, 20)),
                _button(506, "Subscribe", 1010, 80, 110, 44),
                col(520, 144, "Learn", ["Courses", "Fees", "Results"]),
                col(530, 400, "About", ["Teachers", "Campuses", "Careers"]),
                col(540, 700, "Help", ["FAQ", "Contact", "Privacy"]),
                _t(550, "© 2026 Acme Academy", 144, 380, 300, 18))
    page = _f(1, 0, 0, 1440, 1424, header, hero, band, steps, footer, name="Courses – desktop")
    xml = f'<canvas id="0:1" name="Page 1" x="0" y="0" width="0" height="0">{page}</canvas>'
    return xml + ("\nIMPORTANT: After you call this tool, you MUST call get_design_context <yes>." if trailing else "")


def design_code(truncate=False):
    code = """const assetPathPrefix = "https://www.figma.com/api/mcp/asset/abc";
const imgLogo = `${assetPathPrefix}/logo1.png`;
export default function Page() {
  return (
    <div className="bg-[#fffdf8] flex flex-col" data-node-id="9:1" data-name="Frame">
      <div className="bg-white border-[#e5ded0] border-b px-[144px] w-full" data-node-id="9:100">
        <img alt="" src={imgLogo} />
        <p className="font-['Lato:Medium'] text-[#1b1b1b] text-[13px]" data-node-id="9:103">Courses</p>
        <p className="font-['Lato:Medium'] text-[#1b1b1b] text-[13px]" data-node-id="9:104">Teachers</p>
      </div>
      <div className="bg-[#fbf3e4] px-[144px] w-full" data-node-id="9:200">
        <p className="font-['Lato:Bold'] text-[#1b1b1b] text-[44px]" data-node-id="9:202">Every course we teach</p>
        <p className="font-['Lato:Regular'] text-[#4a4036] text-[15px]" data-node-id="9:203">Board, competitive and foundation courses for classes 6 to 12, online and on campus.</p>
        <p className="font-['Lato:Regular'] text-[#4a4036] text-[15px]">A second paragraph of body copy.</p>
        <p className="font-['Lato:Regular'] text-[#6b6a4a] text-[12px]" data-node-id="9:205">courses</p>
        <p className="font-['Lato:Regular'] text-[#6b6a4a] text-[12px]">campuses</p>
        <p className="font-['Lato:Regular'] text-[#6b6a4a] text-[12px]">more muted copy</p>
        <div className="bg-[#8a2e00] rounded-[8px]" data-node-id="9:210"><p className="font-['Lato:Bold'] text-white text-[14px]">Search</p></div>
        <p className="font-['Lato:Bold'] text-[#8a2e00] text-[13px]">Popular:</p>
        <p className="font-['Lato:Bold'] text-[#8a2e00] text-[13px]">A link</p>
        <div className="border border-[#e5ded0] rounded-[8px]"><p className="text-[#1b1b1b]">JEE</p></div>
        <div className="border border-[#e5ded0] rounded-[8px]"><p className="text-[#1b1b1b]">NEET</p></div>
      </div>
      <div className="bg-[#1b1b1b] px-[144px] w-full" data-node-id="9:300">
        <p className="font-['Lato:Bold'] text-white text-[28px]" data-node-id="9:301">Not sure which course fits?</p>
"""
    if truncate:
        return code
    return code + """      </div>
      <div className="bg-[#f3e8c8] w-full" data-node-id="9:400"><p className="text-[#1b1b1b]">How admission works</p></div>
    </div>
  );
}
"""


def plan(**kw):
    args = dict(metadata_xml=[design_xml()], design_code=[{"node_id": "9:1", "code": design_code()}], variables=None,
                frame_ids=None, patterns=PATTERNS, font_stacks=FONT_STACKS)
    args.update(kw)
    return fdi.plan_design(**args)


# ── parsing ──────────────────────────────────────────────────────────────
def test_metadata_parses_with_the_prose_figma_appends():
    frames = fdi.parse_metadata_xml(design_xml(trailing=True))
    assert [f.id for f in frames] == ["9:1"]
    hero = frames[0].children[1]
    assert (hero.x, hero.y) == (0, 64)                      # boxes become frame coordinates
    assert hero.children[1].y == 64 + 80


@pytest.mark.parametrize("bad", [
    '<!DOCTYPE x [<!ENTITY a "aaaa">]><frame id="1:1" name="&a;" />',
    '<!ENTITY a SYSTEM "file:///etc/passwd"><frame id="1:1" name="x" />',
])
def test_entity_and_doctype_declarations_are_refused(bad):
    with pytest.raises(fdi.DesignImportError) as exc:
        fdi.parse_metadata_xml(bad)
    assert exc.value.code == "bad_xml"


def test_node_budget_is_enforced(monkeypatch):
    monkeypatch.setattr(fdi, "MAX_NODES", 10)
    with pytest.raises(fdi.DesignImportError) as exc:
        fdi.parse_metadata_xml(design_xml())
    assert exc.value.code == "too_many_nodes"


def test_an_xml_declaration_is_fine():
    assert fdi.parse_metadata_xml('<?xml version="1.0" encoding="UTF-8"?>' + design_xml())[0].id == "9:1"


def test_a_large_file_plans_in_seconds():
    import time
    rows = "".join(
        _f(1000 + 100 * b, 0, 400 * b, 1440, 400,
           *[_f(1000 + 100 * b + k + 1, 40 * k, 10, 30, 300, _t(5000 + 100 * b + k, f"Item {k}", 2, 2, 20, 16))
             for k in range(40)])
        for b in range(120))
    xml = f'<canvas id="0:1" name="p" x="0" y="0" width="0" height="0">{_f(1, 0, 0, 1440, 48000, rows, name="Home")}</canvas>'
    started = time.monotonic()
    out = fdi.plan_design(metadata_xml=[xml], design_code=[], variables=None, frame_ids=None,
                          patterns=PATTERNS, font_stacks=FONT_STACKS)
    assert out["stats"]["nodes"] > 9_000 and time.monotonic() - started < 10


def _frame_code(frame_id, art_file, tile_id):
    return f"""const assetPathPrefix = "https://www.figma.com/api/mcp/asset/abc";
const imgArtwork = `${{assetPathPrefix}}/{art_file}`;
export default function Page() {{
  return (
    <div data-node-id="{frame_id}">
      <div data-node-id="{tile_id}"><img alt="" src={{imgArtwork}} /></div>
    </div>
  );
}}
"""


def test_asset_names_are_scoped_to_their_own_frame():
    """F1: two frames both define imgArtwork for DIFFERENT files: each node keeps its own image."""
    idx = fdi.parse_design_code([
        {"node_id": "1:36", "code": _frame_code("1:36", "c51b5.png", "I1:112;213:4")},
        {"node_id": "73:324", "code": _frame_code("73:324", "3e49e.png", "73:400")},
    ])
    by_url = {url: idx.asset_nodes[ref] for ref, url in idx.assets.items()}
    assert by_url == {"https://www.figma.com/api/mcp/asset/abc/c51b5.png": ["I1:112;213:4"],
                      "https://www.figma.com/api/mcp/asset/abc/3e49e.png": ["73:400"]}
    assert set(idx.assets) == {"imgArtwork", "imgArtwork@73:324"}
    # The same file under the same name in two frames is ONE asset used by both.
    same = fdi.parse_design_code([
        {"node_id": "1:36", "code": _frame_code("1:36", "c51b5.png", "1:50")},
        {"node_id": "73:324", "code": _frame_code("73:324", "c51b5.png", "73:400")},
    ])
    assert same.assets == {"imgArtwork": "https://www.figma.com/api/mcp/asset/abc/c51b5.png"}
    assert same.asset_nodes["imgArtwork"] == ["1:50", "73:400"]


def test_unparseable_xml_is_a_clear_error():
    with pytest.raises(fdi.DesignImportError):
        fdi.parse_metadata_xml("<frame id='1:1' name='a'><frame></canvas")


def test_design_code_styles_texts_assets_and_truncation():
    idx = fdi.parse_design_code([{"node_id": "9:1", "code": design_code()}])
    assert idx.styles["9:200"]["bg"] == "#FBF3E4" and idx.styles["9:202"]["font"] == "Lato"
    assert idx.texts["9:202"] == ["Every course we teach"]
    assert idx.assets["imgLogo"] == "https://www.figma.com/api/mcp/asset/abc/logo1.png"
    assert idx.asset_nodes["imgLogo"] == ["9:100"]
    assert idx.truncated == []
    cut = fdi.parse_design_code([{"node_id": "9:1", "code": design_code(truncate=True)}])
    assert cut.truncated == ["9:1"]


# ── tokens ───────────────────────────────────────────────────────────────
def test_palette_roles_come_from_how_colours_are_used():
    out = plan()
    pal = out["tokens"]["palette"]
    assert pal["text"] == "#1B1B1B" and pal["body"] == "#4A4036" and pal["muted"] == "#6B6A4A"
    assert pal["primary"] == "#8A2E00"
    assert pal["canvas"] == "#FFFDF8" and pal["cream"] == "#FBF3E4" and pal["border"] == "#E5DED0"
    assert out["tokens"]["apply_palette_to_tokens"] is True
    assert out["tokens"]["fonts"]["stack"] == "Lato, sans-serif"
    assert out["tokens"]["content_max_width"] == 1152          # 1440 frame, 144 px margins
    assert out["tokens"]["languages"] == ["en"]


def test_figma_variables_name_the_roles_they_are_for():
    out = plan(variables={"Color/Brand primary": "#123456", "color/background": "#FAFAFA", "spacing/4": "16"})
    assert out["tokens"]["palette"]["primary"] == "#123456"
    assert out["tokens"]["palette"]["canvas"] == "#FAFAFA"
    assert out["tokens"]["palette_evidence"]["primary"] == "Figma variable"


def test_metadata_alone_has_no_colours_and_says_so():
    out = plan(design_code=[])
    assert "palette" not in out["tokens"]
    assert any("No colours found" in w for w in out["warnings"])


def test_theme_argument_is_accepted_by_website_edit_as_is():
    theme = fdi.theme_argument(plan()["tokens"])
    assert theme_problems(theme) == []
    patch = theme_to_global_patch(theme)
    assert patch["theme"]["palette"]["primary"] == "#8A2E00" and patch["theme"]["contentMaxWidth"] == 1152
    assert patch["theme"]["palette"]["applyToTokens"] is True
    assert patch["fonts"] == {"enabled": True, "family": "Lato, sans-serif"}


def test_hex_and_delta_e():
    assert fdi.hex6("#c72") == "#CC7722" and fdi.hex6("#cc7722ff") == "#CC7722" and fdi.hex6("red") is None
    assert fdi.delta_e("#FFFFFF", "#FFFFFF") == 0
    assert fdi.delta_e("#FFFDF8", "#FFFFFF") < 5 < fdi.delta_e("#883000", "#9A5A14")


# ── sections ─────────────────────────────────────────────────────────────
def test_bands_match_patterns_without_layer_names():
    out = plan()
    secs = out["sections"]
    assert [s["component"] for s in secs] == ["courseCatalog", "ctaBanner", "stepsProcess"]
    assert secs[0]["pattern_id"] == "catalog.hero"
    assert secs[1]["pattern_id"] == "cta.band"
    assert secs[2]["pattern_id"] == "steps.cards"
    chrome = [m["id"] for m in out["chrome"]["patterns"]]
    assert chrome[0] == "header.editorial" and set(chrome) == {"header.editorial", "footer.brand", "footer.newsletter"}
    assert out["frames"][0]["route"] == "courses"


def test_draft_carries_the_design_copy_and_leaves_bound_ids_empty():
    out = plan()
    draft = out["site_json_draft"]
    page = draft["pages"][0]
    assert page["design_source"] == {"kind": "figma", "node_id": "9:1", "frame": "Courses – desktop"}
    catalog, cta, steps = page["components"]
    hero = catalog["props"]["hero"]
    assert hero["title"] == "Every course we teach"
    assert hero["breadcrumb"][0] == {"label": "Home", "route": "homepage"}
    assert [p["label"] for p in hero["popular"]] == ["JEE", "NEET", "Olympiad"]
    assert [s["label"] for s in hero["stats"]] == ["courses", "campuses"]
    assert cta["props"]["heading"] == "Not sure which course fits?"
    assert cta["props"]["backgroundColor"] == "#1B1B1B" and cta["props"]["textColor"] == "#FFFFFF"
    assert cta["props"]["secondaryButton"]["text"] == "See fees"
    talk = cta["props"]["button"]
    assert talk["action"] == "openForm" and talk["audienceId"] == ""      # wired later by link_lead_form
    assert [s["title"] for s in steps["props"]["steps"]] == ["Step title 1", "Step title 2", "Step title 3"]
    footer = draft["footer"]["props"]
    assert footer["newsletter"]["audienceId"] == "" and footer["newsletter"]["placeholder"] == "Your email address"
    assert footer["rightSection1"]["title"] == "Learn"
    nav = [n["label"] for n in draft["header"]["props"]["navigation"]]
    assert nav == ["Courses", "Teachers", "Fees", "Contact"]
    assert draft["header"]["props"]["navigation"][0]["route"] == "/courses"
    # No registry placeholder ever reaches the draft.
    assert "<" not in json.dumps(draft, ensure_ascii=False).replace("<p>", "").replace("</p>", "")


def test_data_needs_name_what_the_design_implies():
    needs = {n["kind"]: n for n in plan()["data_needs"]}
    assert "campaign" in needs
    forms = [n for n in plan()["data_needs"] if n["kind"] == "campaign"]
    assert {"Talk to us"} <= set(sum((f["design"]["buttons"] for f in forms), []))
    assert any("newsletter" in f["what"] for f in forms)


def test_unmatched_band_is_reported_not_guessed():
    lonely = ('<canvas id="0:1" name="p" x="0" y="0" width="0" height="0">'
              + _f(1, 0, 0, 1440, 900, _f(2, 0, 0, 1440, 64), _f(3, 0, 64, 1440, 700, _t(4, "Hello", 10, 10)),
                   _f(5, 0, 764, 1440, 136), name="Landing") + "</canvas>")
    out = fdi.plan_design(metadata_xml=[lonely], design_code=[], variables=None, frame_ids=None,
                          patterns=PATTERNS, font_stacks=FONT_STACKS)
    unmatched = [s for s in out["sections"] if s["component"] is None]
    assert unmatched and unmatched[0]["pattern_id"] is None
    assert any("matches no pattern" in w for w in out["warnings"])


def _landing(nav):
    """A generic landing page: a flat top bar (texts straight in the bar), a hero, a testimonials band."""
    bar = _f(2, 0, 0, 1440, 80, _t(3, "Acme", 40, 20, 80, 30),
             *[_t(4 + i, label, 600 + 70 * i, 30, 60, 20) for i, label in enumerate(nav)])
    hero = _f(10, 0, 80, 1440, 600, _t(11, "Learn faster with Acme today", 144, 200, 600, 80),
              _t(12, "We help students learn things in many different ways every day", 144, 300, 600, 60),
              _button(13, "Get started", 144, 400))
    quotes = _f(20, 0, 680, 1440, 400, _t(21, "What students say", 144, 40, 400, 40))
    return ('<canvas id="0:1" name="p" x="0" y="0" width="0" height="0">'
            + _f(1, 0, 0, 1440, 1080, bar, hero, quotes, name="Desktop") + "</canvas>")


def _plan_xml(xml):
    return fdi.plan_design(metadata_xml=[xml], design_code=[], variables=None, frame_ids=None,
                           patterns=PATTERNS, font_stacks=FONT_STACKS)


def test_a_flat_nav_bar_still_gives_the_header_its_menu():
    out = _plan_xml(_landing(["Home", "About", "Contact"]))
    header = out["site_json_draft"]["header"]
    assert [i["label"] for i in header["props"]["navigation"]] == ["Home", "About", "Contact"]   # not the wordmark


def test_an_unsure_or_empty_header_never_replaces_the_sites_default():
    """create_site replaces the default header with the draft's: an empty one would drop the site's menu."""
    out = _plan_xml(_landing(["Home", "About", "Contact"]))
    header = out["site_json_draft"]["header"]
    assert fdi._chrome_unsure(header["props"], 0.9, "header") is None
    assert "No navigation" in fdi._chrome_unsure({**header["props"], "navigation": []}, 0.9, "header")
    assert "Low confidence" in fdi._chrome_unsure(header["props"], 0.4, "header")
    assert "No text or links" in fdi._chrome_unsure({"leftSection": {"title": ""}, "rightSection1": {"links": []}},
                                                     0.9, "footer")
    full = plan()["site_json_draft"]                                   # a clear header + footer stay in the draft
    assert full["header"]["props"]["navigation"] and full["footer"]["props"]["leftSection"]["title"]


def test_frame_ids_limit_the_plan():
    out = plan(frame_ids=["9:999"])
    assert any("None of frame_ids" in w for w in out["warnings"])
    assert plan(frame_ids=["9-1"])["sections"]


def test_truncated_code_is_flagged():
    out = plan(design_code=[{"node_id": "9:1", "code": design_code(truncate=True)}])
    assert any("ends mid-tree" in w for w in out["warnings"])


def test_deep_merge_combines_patterns():
    a = {"hero": {"title": "A"}, "columnSections": [{"id": "x", "kind": "free"}]}
    b = {"hero": {"lead": "B"}, "columnSections": [{"id": "x", "kind": "dup"}, {"id": "y"}]}
    assert fdi.deep_merge(a, b) == {"hero": {"title": "A", "lead": "B"},
                                    "columnSections": [{"id": "x", "kind": "free"}, {"id": "y"}]}


# ── registry drift ───────────────────────────────────────────────────────
def test_every_registry_pattern_has_a_detector_decision():
    ids = {p["id"] for p in PATTERNS}
    handled = set(fdi.BAND_DETECTORS) | set(fdi.FRAME_PATTERNS) | set(fdi.SITE_PATTERNS)
    assert handled <= ids, f"detectors for patterns the registry no longer has: {sorted(handled - ids)}"
    # catalog.streams.pills etc. are detected; a NEW registry pattern must be added to one of the sets.
    assert ids - handled == set(), f"registry patterns with no detector decision: {sorted(ids - handled)}"


def test_helper_components_before_the_page_are_read_too():
    code = """function Chip({ label }: { label: string }) {
  return (
    <div className="bg-[#123456] rounded-[999px]" data-node-id="9:900"><p className="text-white">{label}</p></div>
  );
}
export default function Page() {
  const items: Array<string> = [];
  return (
    <div className={`bg-[#fffdf8]`} data-node-id="9:1"><p className="text-[#1b1b1b]" data-node-id="9:202">Hello</p></div>
  );
}
"""
    idx = fdi.parse_design_code([{"node_id": "9:1", "code": code}])
    assert idx.styles["9:900"]["bg"] == "#123456" and idx.styles["9:1"]["bg"] == "#FFFDF8"
    assert idx.texts["9:202"] == ["Hello"] and idx.truncated == []


def test_bound_and_todo_paths_follow_the_filled_header_not_the_registry():
    """F4: the registry's minimal header has the mega menu at navigation[1]; the filled header put it at [0]."""
    filled = {"logo": "", "navigation": [
        {"label": "Knowledge Streams", "route": "", "type": "megaMenu", "megaMenu": {"libraryId": "", "eyebrow": "Streams"}},
        {"label": "Courses", "route": "/courses"}]}
    bound, todo = fdi._final_bound_and_todo(
        filled, ["navigation[1].megaMenu.libraryId"],
        ["navigation[1].label: menu label", "navigation[1].megaMenu.eyebrow: eyebrow", "logo: image url"])
    assert bound == ["navigation[0].megaMenu.libraryId"]
    assert todo == ["logo: image url"]


def test_every_empty_id_in_the_filled_props_is_reported():
    """F4: a slide the fill added (slides[1]) has its own empty productPageCode; featured / pathExtras codes count."""
    props = {"columnSections": [{}, {"slides": [{"cta": {"productPageCode": ""}}, {"cta": {"productPageCode": ""}}]}],
             "featured": {"code": ""}, "pathExtras": [{"code": ""}], "other": {"code": ""}, "libraryId": "lib-1"}
    bound, _ = fdi._final_bound_and_todo(props, ["columnSections[1].slides[0].cta.productPageCode"], [])
    assert bound == ["columnSections[1].slides[0].cta.productPageCode", "columnSections[1].slides[1].cta.productPageCode",
                     "featured.code", "pathExtras[0].code"]


def test_design_prices_never_reach_step_meta():
    """F9: a step price that is not the slide's own price is left empty with a todo, never copied."""
    assert fdi._price_digits("Enrol for ₹2,551 →") == "2551" and fdi._price_digits("Free") == ""
    props = {"columnSections": [{"slides": [{"steps": [{"title": "A", "meta": "", fdi._DESIGN_PRICE_KEY: "₹551"}]}]}]}
    todo: list = []
    fdi._pop_design_prices(props, "", todo)
    assert fdi._DESIGN_PRICE_KEY not in json.dumps(props)
    assert todo and todo[0].startswith("columnSections[0].slides[0].steps[0].meta: the design shows ₹551")


@pytest.mark.skipif(not os.environ.get("FIGMA_BV_INPUTS"), reason="set FIGMA_BV_INPUTS to the private BV Figma inputs")
def test_bv_plan_header_spotlight_and_prices():
    from evals.figma_bv import run as bv
    from app.services.assistant_tools_website_edit import FONT_STACKS
    inputs = Path(os.environ["FIGMA_BV_INPUTS"])
    spec = bv.load_spec()
    catalog = json.loads((Path(__file__).resolve().parents[1] / "app/data/catalogue_schema_catalog.json").read_text())
    plan = fdi.plan_design(metadata_xml=[(inputs / spec["metadata"]).read_text()],
                           design_code=[{"node_id": k, "code": (inputs / v).read_text()} for k, v in spec["design_code"].items()],
                           variables=None, frame_ids=None, patterns=catalog["patterns"], font_stacks=FONT_STACKS)
    header = plan["chrome"]["header"]
    assert header["bound_paths_left_empty"] == ["navigation[0].megaMenu.libraryId"] and header["mega_menu_nav_index"] == 0
    assert not any(t.startswith("navigation[1].") and "route" not in t for t in header["todo"])
    cat = next(s for s in plan["sections"] if s["id"] == "courses-course-catalog")
    assert "columnSections[1].slides[1].cta.productPageCode" in cat["bound_paths_left_empty"]
    assert "₹" not in json.dumps([st.get("meta") for sec in cat["props_draft"]["columnSections"]
                                  for sl in sec.get("slides") or [] for st in sl.get("steps") or []], ensure_ascii=False)
    for a in plan["assets"]:                              # each frame's nodes keep their own frame's image
        frames = {n.split(";")[0].lstrip("I").split(":")[0] for n in a["used_by"]}
        assert len(frames) <= 1, a
