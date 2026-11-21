"""Guards for the three ways a copilot "make my page look like this mockup"
rebuild came out wrong (Smart AI Academy, 2026-09-14):

1. every insert said afterId null, and null means PREPEND, so the sections
   landed in reverse order with the hero at the bottom;
2. the hero carried a navy backgroundColor and textColor #FFFFFF, but the
   renderer paints hero copy with token classes, so it rendered navy-on-navy;
3. iconName values came from Lucide (MessageSquare, Users, Monitor, Award),
   which the Phosphor-based renderer draws as nothing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

pb = pytest.importorskip("app.routers.page_builder")


def _req(components):
    class Req:
        page = {"id": "home", "components": components}
        images = []
        allow_chrome = False
    return Req()


_CATALOG = {"components": [{"type": "heroSection"}, {"type": "featureGrid"}, {"type": "sectionHeading"}, {"type": "stepsProcess"}]}


def test_consecutive_null_inserts_keep_their_emitted_order():
    ops = {
        "reply": "ok",
        "ops": [
            {"op": "insert", "afterId": None, "component": {"id": "hero", "type": "heroSection", "props": {"layout": "split"}}},
            {"op": "insert", "afterId": None, "component": {"id": "strip", "type": "featureGrid", "props": {"features": []}}},
            {"op": "insert", "afterId": None, "component": {"id": "courses", "type": "featureGrid", "props": {"features": []}}},
        ],
    }
    clean, _, _ = pb._sanitize_ops(__import__("json").dumps(ops), _req([]), _CATALOG)
    assert [o["afterId"] for o in clean] == [None, "hero", "strip"], (
        "an insert following another insert must chain onto it, or the editor's "
        "prepend semantics reverse the whole page"
    )


def test_insert_may_anchor_on_an_id_inserted_earlier_in_the_batch():
    ops = {
        "reply": "ok",
        "ops": [
            {"op": "insert", "afterId": "existing", "component": {"id": "a", "type": "featureGrid", "props": {"features": []}}},
            {"op": "insert", "afterId": "a", "component": {"id": "b", "type": "featureGrid", "props": {"features": []}}},
        ],
    }
    clean, _, warnings = pb._sanitize_ops(
        __import__("json").dumps(ops),
        _req([{"id": "existing", "type": "featureGrid", "props": {}}]),
        _CATALOG,
    )
    assert [o["afterId"] for o in clean] == ["existing", "a"]
    assert not any("not on page" in w for w in warnings)


def test_dark_hero_is_marked_dark_and_mirrors_its_colour_to_style():
    comp = pb.sanitize_component(
        {"id": "hero", "type": "heroSection", "props": {"backgroundColor": "#0F1E4D", "textColor": "#FFFFFF", "left": {"title": "x"}}},
        {"heroSection"}, False, set(), set(), [],
    )
    assert "dark" in comp["style"]["customClass"].split()
    assert comp["style"]["backgroundColor"] == "#0F1E4D"


def test_light_hero_is_left_alone():
    comp = pb.sanitize_component(
        {"id": "hero", "type": "heroSection", "props": {"backgroundColor": "#F8FAFC", "left": {"title": "x"}}},
        {"heroSection"}, False, set(), set(), [],
    )
    assert "dark" not in (comp.get("style") or {}).get("customClass", "")


def test_section_heading_colour_is_mirrored_to_style_to_avoid_the_seam():
    comp = pb.sanitize_component(
        {"id": "h", "type": "sectionHeading", "props": {"title": "Popular Courses", "backgroundColor": "#F8FAFC"}},
        {"sectionHeading"}, False, set(), set(), [],
    )
    assert comp["style"]["backgroundColor"] == "#F8FAFC"


@pytest.mark.parametrize(
    "given,title,expected",
    [
        ("MessageSquare", "ChatGPT for Everyone", "ChatsCircle"),
        ("Users", "AI for Teachers", "UsersThree"),
        ("UserCog", "Expert Guidance", "UsersThree"),
        ("Monitor", "Flexible Online Classes", "Globe"),
        ("Award", "Certificates", "Medal"),
        ("brain", "Introduction to AI", "Brain"),          # case-insensitive library name
        ("graduation-cap", "", "GraduationCap"),          # hyphenated alias
        ("LucideZapIcon", "", "Lightbulb"),               # suffix stripped, alias hit
        ("Whatever", "Earn a certificate on completion", "Certificate"),  # keyword fallback
        ("Whatever", "", None),                           # nothing to go on
    ],
)
def test_icon_names_are_mapped_onto_the_renderer_set(given, title, expected):
    assert pb.normalize_icon_name(given, title) == expected


def test_feature_grid_icons_are_normalised_in_place_and_unknowns_dropped():
    comp = pb.sanitize_component(
        {
            "id": "strip", "type": "featureGrid",
            "props": {"features": [
                {"iconName": "UserCog", "title": "Expert Guidance"},
                {"iconName": "Brain", "title": "Intro"},
                {"iconName": "Zzzz", "title": "Zzzz"},
            ]},
        },
        {"featureGrid"}, False, set(), set(), [],
    )
    feats = comp["props"]["features"]
    assert feats[0]["iconName"] == "UsersThree"
    assert feats[1]["iconName"] == "Brain"
    assert "iconName" not in feats[2]
    assert all(f.get("iconName", "Brain") in pb._FEATURE_ICONS for f in feats)


def test_copilot_prompt_lists_the_icon_library_and_the_rebuild_recipe():
    src = open(pb.__file__, encoding="utf-8").read()
    body = src[src.index("def _build_edit_prompt"):src.index("def _sanitize_ops")]
    assert "## ICON LIBRARY" in body
    assert "FULL-PAGE DESIGN" in body
    assert "afterId = the id of the section you inserted" in body


def test_anchor_id_filed_under_props_is_hoisted_to_the_component():
    comp = pb.sanitize_component(
        {"id": "h", "type": "sectionHeading", "props": {"title": "Popular Courses", "anchorId": "#Courses"}},
        {"sectionHeading"}, False, set(), set(), [],
    )
    assert comp["anchorId"] == "courses"
    assert "anchorId" not in comp["props"]


def test_attached_mockup_is_not_usable_as_page_art():
    mock = "https://cdn.example.com/template-sheet.png"
    brief = "C: FULL-PAGE DESIGN.\nTemplate 1 - Professional Navy (Recommended)\n..."
    assert pb._mockup_urls_from_brief(brief, [mock]) == {mock}
    assert pb._mockup_urls_from_brief("B: a photo of the campus gate", [mock]) == set()
    ops = {"reply": "ok", "ops": [{"op": "insert", "afterId": None, "component": {
        "id": "hero", "type": "heroSection", "props": {"layout": "split", "right": {"image": mock}}}}]}

    class Req:
        page = {"id": "home", "components": []}
        images = [pb.PageImage(url=mock, kind="banner")]
        allow_chrome = False
    clean, _, warnings = pb._sanitize_ops(__import__("json").dumps(ops), Req(), _CATALOG, mockup_urls={mock})
    assert clean[0]["component"]["props"]["right"]["image"] == ""
    assert any("Stripped unknown image URL" in w for w in warnings)


def test_dead_hero_anchor_is_pointed_at_the_section_it_meant():
    comps = [
        {"id": "hero", "type": "heroSection", "props": {"left": {"buttons": [{"text": "Explore Courses", "target": "#courses"}]}}},
        {"id": "offer-features", "type": "featureGrid", "props": {"headerText": "What we offer"}},
        {"id": "courses-heading", "type": "sectionHeading", "props": {"title": "Our Courses"}},
        {"id": "courses-grid", "type": "featureGrid", "props": {}},
    ]
    warnings: list = []
    pb.resolve_dead_anchors(comps, warnings)
    assert comps[2]["anchorId"] == "courses", "id/title containing the target word wins"
    assert "anchorId" not in comps[1]
    assert any("Pointed '#courses'" in w for w in warnings)


def test_anchor_resolver_keeps_existing_anchors_and_warns_when_nothing_fits():
    comps = [
        {"id": "hero", "type": "heroSection", "props": {"left": {"buttons": [{"target": "#pricing"}, {"target": "#courses"}]}}},
        {"id": "grid", "type": "featureGrid", "anchorId": "courses", "props": {}},
        {"id": "faq", "type": "faqSection", "props": {"headerText": "Questions"}},
    ]
    warnings: list = []
    pb.resolve_dead_anchors(comps, warnings)
    assert comps[1]["anchorId"] == "courses"
    assert "anchorId" not in comps[2]
    assert any("'#pricing' has no matching section" in w for w in warnings)


def test_copilot_only_stamps_anchors_on_inserted_sections():
    ops = {"reply": "ok", "ops": [
        {"op": "insert", "afterId": None, "component": {"id": "hero", "type": "heroSection", "props": {"left": {"buttons": [{"target": "#courses"}]}}}},
        {"op": "insert", "afterId": None, "component": {"id": "courses-grid", "type": "featureGrid", "props": {"features": []}}},
    ]}
    existing = [{"id": "old-courses", "type": "featureGrid", "props": {"headerText": "Courses"}}]
    clean, _, warnings = pb._sanitize_ops(__import__("json").dumps(ops), _req(existing), _CATALOG)
    assert clean[1]["component"]["anchorId"] == "courses"
    assert "anchorId" not in existing[0]


def test_photo_briefs_never_strip_the_admins_own_image():
    # "A photo…" starts with the letter A but is class B in substance — a real
    # photo the admin wants placed must stay usable.
    assert pb._mockup_urls_from_brief("A photo of the campus gate at sunrise", ["u"]) == set()
    assert pb._mockup_urls_from_brief("B) A logo of the institute on white", ["u"]) == set()
    assert pb._mockup_urls_from_brief("A) SCREENSHOT of a 3-column feature section", ["u"]) == {"u"}
    assert pb._mockup_urls_from_brief("Image 1: A) MOCKUP of a hero band", ["u"]) == {"u"}
    # ambiguous (both kinds of words) fails safe
    assert pb._mockup_urls_from_brief("A) SCREENSHOT of a gallery of photos", ["u"]) == set()


def test_icon_keyword_fallback_matches_whole_words_only():
    assert pb.normalize_icon_name("Zzz", "Practical Training") != "Brain"   # 'ai' inside 'Training'
    assert pb.normalize_icon_name("Zzz", "AI for Teachers") in ("Brain", "UsersThree")
    assert pb.normalize_icon_name("123", "") is None                        # empty key must not match every alias


def test_dark_hero_under_a_background_image_is_not_guessed():
    comp = pb.sanitize_component(
        {"id": "h", "type": "heroSection", "props": {"backgroundColor": "#0B1F3A", "backgroundImage": "https://x/y.jpg", "left": {"title": "t"}}},
        {"heroSection"}, False, set(), {"https://x/y.jpg"}, [],
    )
    assert "dark" not in (comp.get("style") or {}).get("customClass", "")


def test_component_level_anchor_wins_and_props_copy_is_cleared():
    comp = pb.sanitize_component(
        {"id": "h", "type": "sectionHeading", "anchorId": "Top-Courses", "props": {"title": "x", "anchorId": "stale"}},
        {"sectionHeading"}, False, set(), set(), [],
    )
    assert comp["anchorId"] == "top-courses"
    assert "anchorId" not in comp["props"]


def test_hero_subheading_is_folded_into_description_when_description_is_empty():
    comp = pb.sanitize_component(
        {"id": "hero", "type": "heroSection", "props": {"left": {"title": "T", "subheading": "Practical AI education."}}},
        {"heroSection"}, False, set(), set(), [],
    )
    assert comp["props"]["left"]["description"] == "Practical AI education."
    assert "subheading" not in comp["props"]["left"]


def test_hero_subheading_is_kept_when_a_description_already_exists():
    comp = pb.sanitize_component(
        {"id": "hero", "type": "heroSection", "props": {"left": {"title": "T", "subheading": "S", "description": "<p>D</p>"}}},
        {"heroSection"}, False, set(), set(), [],
    )
    assert comp["props"]["left"]["description"] == "D"   # the string cleaner strips markup from every AI prop
    assert comp["props"]["left"]["subheading"] == "S"


def test_steps_icons_are_left_alone_because_that_key_is_dual_purpose():
    # stepsProcess resolves steps[].icon through the library OR renders it as
    # raw text (an emoji), so normalising it would strip authored emojis.
    comp = pb.sanitize_component(
        {"id": "s", "type": "stepsProcess", "props": {"nodeStyle": "icon", "steps": [
            {"icon": "🚀", "title": "Apply"},
            {"icon": "MessageSquare", "title": "Chat with us"},
        ]}},
        {"stepsProcess"}, False, set(), set(), [],
    )
    assert [st["icon"] for st in comp["props"]["steps"]] == ["🚀", "MessageSquare"]
    assert "features" not in comp["props"]


def test_copilot_prompt_names_the_step_icon_key_the_renderer_reads():
    src = open(pb.__file__, encoding="utf-8").read()
    body = src[src.index("def _build_edit_prompt"):src.index("def _sanitize_ops")]
    assert "steps[].icon " in body or "steps[].icon (" in body
    assert "steps[].iconName" not in body


def test_button_targets_are_slugged_like_anchors_so_the_dom_lookup_matches():
    # The learner scrolls with getElementById (case-sensitive). A hero that
    # says target '#Courses' must end up pointing at the slugged anchor.
    comps = [
        {"id": "hero", "type": "heroSection", "props": {"left": {"buttons": [{"target": "#Courses"}], "button": {"target": "#Top Courses"}}}},
        {"id": "courses-grid", "type": "featureGrid", "props": {"headerText": "Our courses"}},
        {"id": "top", "type": "sectionHeading", "anchorId": "top-courses", "props": {"title": "Top"}},
        {"id": "cta", "type": "ctaBanner", "props": {"button": {"text": "Go", "url": "#Courses"}}},
    ]
    warnings: list = []
    pb.resolve_dead_anchors(comps, warnings)
    assert comps[0]["props"]["left"]["buttons"][0]["target"] == "#courses"
    assert comps[0]["props"]["left"]["button"]["target"] == "#top-courses"
    assert comps[3]["props"]["button"]["url"] == "#courses"
    assert comps[1]["anchorId"] == "courses"
    assert "anchorId" not in comps[2] or comps[2]["anchorId"] == "top-courses"


def test_non_hash_targets_are_never_touched():
    comps = [
        {"id": "hero", "type": "heroSection", "props": {"left": {"buttons": [{"target": "/Website/Programs"}, {"target": "https://X.example/Y"}]}}},
        {"id": "cta", "type": "ctaBanner", "props": {"button": {"url": "/Contact"}}},
    ]
    pb.resolve_dead_anchors(comps, [])
    assert [b["target"] for b in comps[0]["props"]["left"]["buttons"]] == ["/Website/Programs", "https://X.example/Y"]
    assert comps[1]["props"]["button"]["url"] == "/Contact"
