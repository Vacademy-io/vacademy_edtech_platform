"""One image-key rule for both sides of the sanitiser.

page_builder's stripper (clean_urls) and the MCP's asset allow-list
(website_edit._asset_urls_in) used two hand-kept key sets: `imageUrl` was
stripped but never allow-listed (every MCP-authored stream icon came out
blank), list items were never allow-listed, and newer keys such as
`filterSidebar.promo.screenImage` passed BOTH unchecked (any URL could be
hotlinked). Both now call page_builder.is_image_key / is_image_list_key."""
import copy
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

pb = pytest.importorskip("app.routers.page_builder")
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402

_FIXTURE = (Path(__file__).resolve().parents[2] / "frontend-admin-dashboard" / "src" / "routes" / "manage-pages"
            / "-components" / "__fixtures__" / "brahm-varchas-site.json")
OURS = "https://d1om4dxj9e7kkd.cloudfront.net/CATALOGUE/inst/icon-vedas.png"
FOREIGN = "https://hotlink.example.com/stolen.png"


@pytest.mark.parametrize("key,is_image", [
    ("image", True), ("src", True), ("logo", True), ("imageUrl", True), ("screenImage", True),
    ("previewImageUrl", True), ("coverImage", True), ("ogImage", True), ("fallbackSrc", True),
    ("url", False), ("route", False), ("imagePosition", False), ("imageAlt", False), ("title", False),
])
def test_one_key_rule(key, is_image):
    assert pb.is_image_key(key) is is_image


def test_the_brahm_varchas_pages_round_trip_through_create_page():
    if not _FIXTURE.exists():
        pytest.skip("Brahm Varchas fixture not in this checkout")
    site = json.loads(_FIXTURE.read_text())
    for page in site["pages"]:
        original = copy.deepcopy(page)
        clean, _issues, warnings = edit_mod._sanitize_authored_page(copy.deepcopy(page), "landing", site["globalSettings"])
        assert not [w for w in warnings if "image" in w.lower()], warnings
        # The one documented normalisation: a band's props.backgroundColor is
        # mirrored into style when the section has a layout (sanitize_component).
        for comp, orig in zip(clean["components"], original["components"]):
            added = comp.get("style", {}).get("backgroundColor")
            if added and "backgroundColor" not in (orig.get("style") or {}):
                assert added == orig["props"].get("backgroundColor")
                comp["style"].pop("backgroundColor")
                if not comp["style"] and "style" not in orig:
                    comp.pop("style")
        assert clean == original, page["route"]


def _catalog_page(stream_image, promo_image, collage=None):
    props = {
        "streams": {"enabled": True, "source": "tags", "variant": "icons",
                    "items": [{"key": "vedas", "label": "Vedas", "tag": "stream-vedas", "imageUrl": stream_image}]},
        "filterSidebar": {"enabled": True, "variant": "editorial",
                          "promo": {"enabled": True, "screenImage": promo_image, "title": "Get the app"}},
    }
    comps = [{"id": "catalog", "type": "courseCatalog", "props": props}]
    if collage is not None:
        comps.append({"id": "about", "type": "heroSection", "props": {"layout": "split", "imageCollage": collage,
                                                                       "left": {"heading": "About"}}})
    return {"route": "courses", "title": "Courses", "components": comps}


def test_an_institute_stream_icon_survives_and_a_hotlink_does_not():
    clean, _, warnings = edit_mod._sanitize_authored_page(_catalog_page(OURS, FOREIGN), "landing", None)
    props = clean["components"][0]["props"]
    assert props["streams"]["items"][0]["imageUrl"] == OURS
    assert props["filterSidebar"]["promo"]["screenImage"] == ""
    assert any("screenImage" in w for w in warnings)
    clean, _, _ = edit_mod._sanitize_authored_page(_catalog_page(FOREIGN, OURS), "landing", None)
    props = clean["components"][0]["props"]
    assert props["streams"]["items"][0]["imageUrl"] == "" and props["filterSidebar"]["promo"]["screenImage"] == OURS


def test_image_list_items_are_allow_listed():
    clean, _, _ = edit_mod._sanitize_authored_page(_catalog_page(OURS, OURS, collage=[OURS, FOREIGN]), "landing", None)
    hero = next(c for c in clean["components"] if c["id"] == "about")
    assert hero["props"]["imageCollage"] == [OURS]


def test_copilot_patch_keeps_art_already_on_the_page():
    page = _catalog_page(OURS, OURS)
    ops = {"reply": "ok", "ops": [{"op": "update", "id": "catalog", "propsPatch": {
        "filterSidebar": {"enabled": True, "variant": "editorial",
                          "promo": {"enabled": True, "screenImage": OURS, "title": "Learn anywhere"}},
        "streams": {"items": [{"key": "x", "imageUrl": FOREIGN}]},
    }}]}

    class Req:
        images = []
        allow_chrome = False
    Req.page = page
    clean, _, warnings = pb._sanitize_ops(json.dumps(ops), Req(), {"components": [{"type": "courseCatalog"}]})
    patch = clean[0]["propsPatch"]
    assert patch["filterSidebar"]["promo"]["screenImage"] == OURS
    assert patch["streams"]["items"][0]["imageUrl"] == ""


def test_chrome_edit_keeps_the_logo_it_echoes_and_strips_a_new_url():
    current = {"layout": {"header": {"type": "header", "props": {"logo": OURS, "title": "BV"}}}}
    merged = pb._merge_chrome(current, {"layout": {"header": {"props": {"logo": OURS, "title": "Brahm Varchas"}}}}, [])
    assert merged["layout"]["header"]["props"] == {"logo": OURS, "title": "Brahm Varchas"}
    merged = pb._merge_chrome(current, {"layout": {"header": {"props": {"logo": FOREIGN}}}}, [])
    assert merged["layout"]["header"]["props"]["logo"] == ""
