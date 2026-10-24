"""
website(action='preview') in fidelity mode and website(action='compare'),
against a faked admin-core serving the Brahm Varchas site and a faked render.

Pins: a plain preview call is unchanged; a language must be one of the site's;
compare reads only images this platform stores (never a caller's URL); and the
MCP result carries every tile and the side-by-side as images.
"""
import asyncio
import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services import page_preview, website_data  # noqa: E402
from app.services.assistant_tool_registry import ToolContext  # noqa: E402

FIXTURE = (Path(__file__).resolve().parents[2] / "frontend-admin-dashboard/src/routes/manage-pages/-components"
           / "__fixtures__/brahm-varchas-site.json")
BUCKET, CDN = "vacademy-media", "https://cdn.example.net"


def bv_site():
    if not FIXTURE.exists():
        pytest.skip("Brahm Varchas fixture not in this checkout")
    return json.loads(FIXTURE.read_text())


class _FakeDb:
    def execute(self, stmt, params=None):
        if "learner_portal_base_url" in str(stmt):
            return SimpleNamespace(first=lambda: ("learn.brahmvarchas.in",))
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])


def ctx(images=True):
    principal = PinnedPrincipal(user_id="user-1", institute_id="inst-1", roles=["ADMIN"], permissions=[], is_root_user=False)
    return ToolContext(db=_FakeDb(), principal=principal, keys=(), bearer_token="jwt", images_as_content=images)


@pytest.fixture
def bv(monkeypatch):
    config = bv_site()
    row = {"id": "cat-bv", "tag_name": "bv", "status": "ACTIVE", "is_default": True,
           "catalogue_json": json.dumps(config), "updated_at": "2026-10-09T10:00:00"}

    async def admin_core(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/course-catalogue/institute/get-all"):
            return [row]
        if path.endswith("/course-catalogue/institute/get/by-tag"):
            return row
        if path.endswith("/revision/draft"):
            return {"error": "fetch_failed", "status": 204}
        if path.endswith("/revision/history"):
            return []
        raise AssertionError(f"unexpected call {method} {path}")

    monkeypatch.setattr(website_data, "_admin_core_json", admin_core)
    monkeypatch.setattr(website_mod, "_admin_core_json", admin_core)
    monkeypatch.setattr(website_data, "_settings", lambda: SimpleNamespace(
        learner_dashboard_url="https://learner.example", aws_bucket_name=BUCKET, aws_s3_public_bucket=None,
        cdn_public_base_url=CDN, media_server_base_url="https://media.example.net", admin_dashboard_url="https://admin"))
    monkeypatch.setattr(website_mod, "_settings", website_data._settings)
    return config


def call(args, images=True):
    return json.loads(asyncio.run(website_mod.execute_website(args, ctx(images))))


def jpeg(img):
    return cv2.imencode(".jpg", img)[1].tobytes()


def b64(s):
    return base64.b64encode(s.encode()).decode()


# ── preview ──────────────────────────────────────────────────────────────
def test_a_plain_preview_call_is_unchanged(bv, monkeypatch):
    seen = {}

    async def render(**kw):
        seen.update(kw)
        return {"png_base64": "AAAA", "width": 1280, "height": 3000}
    monkeypatch.setattr(page_preview, "render_preview", render)
    out = call({"action": "preview", "page_route": "courses"})
    assert set(seen) == {"base_url", "tag_name", "page_route", "config", "section_id", "viewport"}
    assert seen["viewport"] == "desktop" and seen["base_url"] == "learn.brahmvarchas.in"
    assert set(out) == {"action", "tag_name", "page_route", "showing", "image_png_base64", "width", "height", "note"}


def test_fidelity_preview_returns_tiles_sections_and_language(bv, monkeypatch):
    seen = {}

    async def render(**kw):
        seen.update(kw)
        return {"png_base64": "T0", "width": 1440, "height": 4300, "page_height": 4300, "truncated": False,
                "tiles": [{"png_base64": b64(f"t{i}"), "top": i * 1800, "height": 1800} for i in range(3)],
                "sections": [{"id": "header-1", "top": 0, "height": 64}, {"id": "courses-catalog", "top": 64, "height": 3000},
                             {"id": "courses-not-sure", "top": 3064, "height": 240}, {"id": "footer-1", "top": 3304, "height": 996}]}
    monkeypatch.setattr(page_preview, "render_preview", render)
    out = call({"action": "preview", "page_route": "courses", "width": 1440, "lang": "hi"})
    assert seen["width"] == 1440 and seen["lang"] == "hi" and seen["sections"] is True
    assert out["mode"] == "fidelity" and out["lang"] == "hi"
    assert out["image_png_base64"] == b64("t0") and out["images_base64"] == [b64("t1"), b64("t2")]
    assert [(s["id"], s["type"]) for s in out["sections"]] == [
        ("header-1", "header"), ("courses-catalog", "courseCatalog"), ("courses-not-sure", "ctaBanner"), ("footer-1", "footer")]


def test_fidelity_alone_means_1440_with_sections(bv, monkeypatch):
    seen = {}

    async def render(**kw):
        seen.update(kw)
        return {"png_base64": "x", "width": 1440, "height": 900, "tiles": [{"png_base64": "x", "top": 0, "height": 900}]}
    monkeypatch.setattr(page_preview, "render_preview", render)
    call({"action": "preview", "fidelity": True, "sections": False})
    assert seen["width"] == 1440 and seen["sections"] is False


def test_a_page_built_from_a_design_previews_in_fidelity_mode(bv, monkeypatch):
    bv["pages"][1]["meta"] = {"designSource": {"kind": "figma", "fileKey": "abc", "nodeId": "1:36"}}
    row = json.dumps(bv)

    async def admin_core(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/revision/draft"):
            return {"error": "fetch_failed", "status": 204}
        if path.endswith("/revision/history"):
            return []
        return [{"id": "c", "tag_name": "bv", "status": "ACTIVE", "is_default": True, "catalogue_json": row}] \
            if path.endswith("get-all") else {"id": "c", "tag_name": "bv", "status": "ACTIVE", "catalogue_json": row}
    monkeypatch.setattr(website_data, "_admin_core_json", admin_core)
    seen = {}

    async def render(**kw):
        seen.update(kw)
        return {"png_base64": "x", "width": 1440, "height": 900, "tiles": []}
    monkeypatch.setattr(page_preview, "render_preview", render)
    assert call({"action": "preview", "page_route": "courses"})["mode"] == "fidelity"
    assert seen["width"] == 1440


def test_a_language_the_site_does_not_have_is_refused(bv, monkeypatch):
    async def render(**kw):
        raise AssertionError("no render for a bad language")
    monkeypatch.setattr(page_preview, "render_preview", render)
    out = call({"action": "preview", "lang": "ta"})
    assert out["error"] == "unknown_language" and out["available"] == ["en", "hi"]
    # F10: the fix names the MCP's own way to add the language, not only the editor.
    assert "website_edit(action='set_translations'" in out["fix"] and "enable=true" in out["fix"]


# ── compare ──────────────────────────────────────────────────────────────
def _design_and_render():
    """A design of four bands and a render of the same page whose CTA band lost its second button."""
    def page(with_second):
        img = np.full((1600, 1440, 3), 250, dtype=np.uint8)
        img[:64] = 255
        img[64:1100] = (232, 246, 253)
        cv2.putText(img, "All courses", (160, 200), cv2.FONT_HERSHEY_SIMPLEX, 2, (20, 20, 20), 3)
        img[1100:1300] = (8, 18, 26)
        cv2.rectangle(img, (900, 1170), (1080, 1230), (60, 110, 90), -1)
        if with_second:
            cv2.rectangle(img, (1100, 1170), (1280, 1230), (230, 230, 230), 2)
        img[1300:] = (215, 234, 245)
        return img
    return page(True), page(False)


def _fake_render(rendered, seen):
    async def render(**kw):
        seen.update(kw)
        return {"png_base64": "x", "width": 1440, "height": 1600, "page_height": 1600, "truncated": False, "tiles": [],
                "full_jpeg": jpeg(rendered),
                "sections": [{"id": "header-1", "top": 0, "height": 64, "text": "Courses"},
                             {"id": "courses-catalog", "top": 64, "height": 1036, "text": "All courses"},
                             {"id": "courses-not-sure", "top": 1100, "height": 200,
                              "text": "Not sure which course is right for you?\nFind your path"},
                             {"id": "footer-1", "top": 1300, "height": 300, "text": "Brahm Varchas"}]}
    return render


def test_compare_reads_our_stored_image_and_returns_section_hints(bv, monkeypatch):
    design, rendered = _design_and_render()
    del bv["pages"][1]["components"][1]["props"]["secondaryButton"]
    row = json.dumps(bv)

    async def admin_core(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/revision/draft"):
            return {"error": "fetch_failed", "status": 204}
        if path.endswith("/revision/history"):
            return []
        return [{"id": "c", "tag_name": "bv", "status": "ACTIVE", "is_default": True, "catalogue_json": row}] \
            if path.endswith("get-all") else {"id": "c", "tag_name": "bv", "status": "ACTIVE", "catalogue_json": row}
    monkeypatch.setattr(website_data, "_admin_core_json", admin_core)
    reads = []

    def read_s3(bucket, key, cap):
        reads.append((bucket, key))
        return cv2.imencode(".png", design)[1].tobytes()
    monkeypatch.setattr(website_mod, "_read_s3_object", read_s3)
    seen = {}
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(rendered, seen))
    out = call({"action": "compare", "page_route": "courses", "lang": "en", "reference": {
        "asset_url": f"{CDN}/page-builder/imports/inst-1/photo-1.png", "frame_width": 1440,
        "sections": [{"name": "Header", "id": "1:37", "top": 0, "height": 64},
                     {"name": "Hero + Main", "id": "1:69", "top": 64, "height": 1036},
                     {"name": "Help band", "id": "1:435", "top": 1100, "height": 200,
                      "texts": ["Not sure which course is right for you?", "Find your path", "Talk to us"]},
                     {"name": "Footer", "id": "1:444", "top": 1300, "height": 300}]}})
    assert reads == [(BUCKET, "page-builder/imports/inst-1/photo-1.png")]
    assert seen["width"] == 1440 and seen["sections"] is True and seen["section_text"] and seen["full_image"]
    assert out["overall"]["sections_paired"] == 4 and out["missing_sections"] == []
    cta = next(s for s in out["sections"] if s["section_id"] == "courses-not-sure")
    assert cta["figma_nodes"] == ["1:435"] and cta["missing_text"] == ["Talk to us"]
    assert cta["hints"][0]["prop_path"] == "props.secondaryButton"
    assert base64.b64decode(out["image_png_base64"])[:2] == b"\xff\xd8"
    # The same findings, in the audit's shape (audit_reference_fidelity).
    assert any(i["code"] == "reference-text-missing" and i.get("component_id") == "courses-not-sure"
               for i in out["issues"])


def test_compare_never_fetches_an_address_it_was_handed(bv, monkeypatch):
    import httpx

    class Boom:
        def __init__(self, *a, **kw):
            raise AssertionError("no network for a caller's URL")
    monkeypatch.setattr(httpx, "AsyncClient", Boom)
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda *a: (_ for _ in ()).throw(AssertionError("no S3")))

    async def media(ctx_, kind, limit):
        return [{"file_id": "f-1", "url": f"{CDN}/media/f-1.png"}]
    monkeypatch.setattr(website_mod, "_load_media", media)
    for url in ("http://169.254.169.254/latest/meta-data", "https://evil.example/figma.png",
                "https://other-bucket.s3.amazonaws.com/x.png", f"{CDN}.evil.com/x.png",
                "https://ec2-1-2-3-4.ap-south-1.compute.amazonaws.com/x.png", "https://d123.cloudfront.net/x.png",
                # our bucket, but not this institute's: another institute's import, an unscoped one, any key
                f"{CDN}/page-builder/imports/inst-2/photo-1.png", f"{CDN}/page-builder/imports/photo-1.png",
                f"https://{BUCKET}.s3.amazonaws.com/private/report.png",
                f"{CDN}/page-builder/imports/inst-1/../inst-2/x.png"):
        out = call({"action": "compare", "reference": {"asset_url": url}})
        assert out["error"] == "reference_not_allowed", url
    out = call({"action": "compare", "reference": {"url": "https://www.figma.com/design/abc"}})
    assert out["error"] == "bad_request" and "never fetched" in out["message"]


def _serve(config, monkeypatch):
    row = json.dumps(config)

    async def admin_core(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/revision/draft"):
            return {"error": "fetch_failed", "status": 204}
        if path.endswith("/revision/history"):
            return []
        return [{"id": "c", "tag_name": "bv", "status": "ACTIVE", "is_default": True, "catalogue_json": row}] \
            if path.endswith("get-all") else {"id": "c", "tag_name": "bv", "status": "ACTIVE", "catalogue_json": row}
    monkeypatch.setattr(website_data, "_admin_core_json", admin_core)


def test_compare_never_reads_an_unscoped_object_written_into_the_callers_own_draft(bv, monkeypatch):
    """SEC-1: a bucket URL the caller put into its own site config is not 'an image of this institute'."""
    reads = []
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda b, k, c: reads.append((b, k)) or b"x")

    async def media(ctx_, kind, limit):
        return []
    monkeypatch.setattr(website_mod, "_load_media", media)
    stolen = f"https://{BUCKET}.s3.amazonaws.com/inst-2/proctoring/snap.jpg"
    bv["pages"][0].setdefault("components", []).insert(0, {
        "id": "x-1", "type": "text", "props": {"content": stolen, "image": stolen}})
    _serve(bv, monkeypatch)
    out = call({"action": "compare", "reference": {"asset_url": stolen}})
    assert out["error"] == "reference_not_allowed" and reads == []


def test_compare_accepts_a_site_image_from_the_public_bucket(bv, monkeypatch):
    design, _ = _design_and_render()
    reads = []

    def read_s3(bucket, key, cap):
        reads.append((bucket, key))
        return cv2.imencode(".png", design)[1].tobytes()
    monkeypatch.setattr(website_mod, "_read_s3_object", read_s3)
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(design, {}))
    base = website_data._settings()
    monkeypatch.setattr(website_mod, "_settings", lambda: SimpleNamespace(**{**vars(base), "aws_s3_public_bucket": BUCKET}))
    url = f"https://{BUCKET}.s3.amazonaws.com/site/hero.png"
    bv["pages"][0].setdefault("components", []).insert(0, {"id": "x-1", "type": "hero", "props": {"image": url}})
    _serve(bv, monkeypatch)
    out = call({"action": "compare", "page_route": "courses", "reference": {"asset_url": url}})
    assert "error" not in out and reads == [(BUCKET, "site/hero.png")]


def test_compare_asset_ids_must_be_the_callers_own_uploads(bv, monkeypatch):
    async def media(ctx_, kind, limit):
        return [{"file_id": "f-1", "url": f"{CDN}/media/f-1.png"}]
    monkeypatch.setattr(website_mod, "_load_media", media)
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda b, k, c: b"not an image")
    assert call({"action": "compare", "reference": {"asset_id": "f-2"}})["error"] == "unknown_asset"
    out = call({"action": "compare", "reference": {"tiles": [{"asset_id": "f-1"}]}})
    assert out["error"] == "bad_image" and "reference image" in out["message"]


def test_compare_refuses_what_it_cannot_do_yet(bv):
    assert call({"action": "compare"})["error"] == "missing_argument"
    assert call({"action": "compare", "reference": {"import_id": "imp-1", "frame_id": "1:36"}})["error"] == "reference_unavailable"
    assert call({"action": "compare", "reference": {"tiles": [{"asset_url": "x"}] * 13}})["error"] == "bad_request"
    assert call({"action": "compare", "reference": {"asset_url": "x", "sections": "all"}})["error"] == "bad_request"


def test_compare_tiles_are_stitched_top_to_bottom(bv, monkeypatch):
    design, rendered = _design_and_render()
    halves = {"a.png": design[:800], "b.png": design[800:]}
    monkeypatch.setattr(website_mod, "_read_s3_object",
                        lambda bucket, key, cap: cv2.imencode(".png", halves[key.rsplit("/", 1)[-1]])[1].tobytes())
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(design, {}))
    imports = f"{CDN}/page-builder/imports/inst-1"
    out = call({"action": "compare", "page_route": "courses",
                "reference": {"tiles": [{"asset_url": f"{imports}/a.png"}, {"asset_url": f"{imports}/b.png"}]}})
    assert out["overall"]["passes"] is True and out["design_sections_from"] == "bands"


def _no_render(monkeypatch):
    async def render(**kw):
        raise AssertionError("nothing is rendered for a bad request")
    monkeypatch.setattr(page_preview, "render_preview", render)


@pytest.mark.parametrize("sections", [["x"], [{"top": "nan", "height": 10}], [{"top": "inf", "height": 10}],
                                      [{"top": 0, "height": "1e999"}], [{"top": 0}], [{"top": -5, "height": 10}],
                                      [{"top": 0, "height": 10, "texts": "Talk to us"}]])
def test_bad_design_sections_are_refused_before_anything_is_read_or_rendered(bv, monkeypatch, sections):
    _no_render(monkeypatch)
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda *a: (_ for _ in ()).throw(AssertionError("no S3")))
    out = call({"action": "compare", "reference": {
        "asset_url": f"{CDN}/page-builder/imports/inst-1/p.png", "sections": sections}})
    assert out["error"] == "bad_request" and "reference.sections" in out["message"]
    assert call({"action": "compare", "reference": {"asset_url": "x", "frame_width": "nan"}})["error"] == "bad_request"
    assert call({"action": "compare", "width": 99999, "reference": {"asset_url": "x"}})["error"] == "bad_request"


def test_a_design_too_tall_in_total_is_refused_before_the_render(bv, monkeypatch):
    _no_render(monkeypatch)
    tall = cv2.imencode(".png", np.full((3000, 360, 3), 200, np.uint8))[1].tobytes()   # 12000px tall at 1440
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda bucket, key, cap: tall)
    tile = {"asset_url": f"{CDN}/page-builder/imports/inst-1/t.png"}
    out = call({"action": "compare", "reference": {"tiles": [tile] * 12}})
    assert out["error"] == "too_large" and "reference image" in out["message"]


def test_images_on_this_site_and_in_the_media_library_are_allowed(bv, monkeypatch):
    design, rendered = _design_and_render()
    png = cv2.imencode(".png", design)[1].tobytes()
    reads = []
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda bucket, key, cap: reads.append(key) or png)
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(rendered, {}))
    site_image = f"{CDN}/site/hero.png"
    bv["pages"][1]["components"][0]["props"]["backgroundImage"] = site_image
    row = json.dumps(bv)

    async def admin_core(ctx_, method, path, params=None, body=None, timeout=None):
        if path.endswith("/revision/draft"):
            return {"error": "fetch_failed", "status": 204}
        if path.endswith("/revision/history"):
            return []
        return [{"id": "c", "tag_name": "bv", "status": "ACTIVE", "is_default": True, "catalogue_json": row}] \
            if path.endswith("get-all") else {"id": "c", "tag_name": "bv", "status": "ACTIVE", "catalogue_json": row}
    monkeypatch.setattr(website_data, "_admin_core_json", admin_core)

    async def media(ctx_, kind, limit):
        return [{"file_id": "f-9", "url": f"https://{BUCKET}.s3.amazonaws.com/media/f-9.png"}]
    monkeypatch.setattr(website_mod, "_load_media", media)
    assert "overall" in call({"action": "compare", "page_route": "courses", "reference": {"asset_url": site_image}})
    assert "overall" in call({"action": "compare", "page_route": "courses",
                              "reference": {"asset_url": f"https://{BUCKET}.s3.amazonaws.com/media/f-9.png"}})
    assert reads == ["site/hero.png", "media/f-9.png"]


def test_an_asset_id_is_found_among_all_the_callers_uploads_not_the_top_200(bv, monkeypatch):
    from app.services import assistant_tool_registry as registry
    files = [{"file_detail": {"id": f"big-{i}", "url": f"{CDN}/m/big-{i}.png", "file_type": "image/png",
                              "file_name": f"b{i}.png", "width": 2000, "height": 1000}} for i in range(250)]
    files.append({"file_detail": {"id": "mine", "url": f"{CDN}/m/mine.png", "file_type": "image/png",
                                  "file_name": "design.png", "width": 300, "height": 200}})

    async def service_json(ctx_, method, base, path, **kw):
        return files
    monkeypatch.setattr(registry, "_service_json", service_json)
    assert len(asyncio.run(website_mod._load_media(ctx(), "any", 200))) == 200
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda bucket, key, cap: b"not an image")
    out = call({"action": "compare", "reference": {"asset_id": "mine"}})
    assert out["error"] == "bad_image"                    # found and read, not "unknown_asset"


def test_a_header_the_render_could_not_measure_is_not_a_missing_section(bv, monkeypatch):
    design, rendered = _design_and_render()
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda bucket, key, cap: cv2.imencode(".png", design)[1].tobytes())
    base = _fake_render(rendered, {})

    async def render(**kw):
        out = await base(**kw)
        out["sections"] = [s for s in out["sections"] if s["id"] != "header-1"]    # as before the fix
        return out
    monkeypatch.setattr(page_preview, "render_preview", render)
    ref = {"asset_url": f"{CDN}/page-builder/imports/inst-1/p.png",
           "sections": [{"name": "Header", "top": 0, "height": 64}, {"name": "Main", "top": 64, "height": 1036},
                        {"name": "Help", "top": 1100, "height": 200}, {"name": "Footer", "top": 1300, "height": 300}]}
    out = call({"action": "compare", "page_route": "courses", "reference": ref})
    assert out["missing_sections"] == [] and out["chrome_bands"][0]["matched_by"] == "header"


def test_the_page_against_its_own_render_passes(bv, monkeypatch):
    _, rendered = _design_and_render()
    monkeypatch.setattr(website_mod, "_read_s3_object",
                        lambda bucket, key, cap: cv2.imencode(".png", rendered)[1].tobytes())
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(rendered, {}))
    out = call({"action": "compare", "page_route": "courses",
                "reference": {"asset_url": f"{CDN}/page-builder/imports/inst-1/p.png"}})
    assert out["overall"]["passes"] is True and out["missing_sections"] == []


def test_a_busy_comparer_answers_busy(bv, monkeypatch):
    from app.services import visual_compare as vc
    design, rendered = _design_and_render()
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda bucket, key, cap: cv2.imencode(".png", design)[1].tobytes())
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(rendered, {}))
    monkeypatch.setattr(website_mod, "_COMPARE_SLOT_WAIT_S", 0.01)

    async def scenario():
        monkeypatch.setattr(vc, "COMPARE_SLOTS", asyncio.Semaphore(0))
        return json.loads(await website_mod.execute_website(
            {"action": "compare", "page_route": "courses",
             "reference": {"asset_url": f"{CDN}/page-builder/imports/inst-1/p.png"}}, ctx()))
    assert asyncio.run(scenario())["error"] == "compare_busy"


def test_the_in_product_assistant_gets_no_base64_from_the_new_modes(bv, monkeypatch):
    design, rendered = _design_and_render()
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda bucket, key, cap: cv2.imencode(".png", design)[1].tobytes())
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(rendered, {}))
    out = call({"action": "compare", "page_route": "courses",
                "reference": {"asset_url": f"{CDN}/page-builder/imports/inst-1/p.png"}}, images=False)
    assert "image_png_base64" not in out and out["images_omitted"] and "overall" in out

    async def tiles(**kw):
        return {"png_base64": "x", "width": 1440, "height": 3600,
                "tiles": [{"png_base64": "T" * 1000, "top": i * 1800, "height": 1800} for i in range(2)]}
    monkeypatch.setattr(page_preview, "render_preview", tiles)
    out = call({"action": "preview", "width": 1440}, images=False)
    assert "image_png_base64" not in out and "images_base64" not in out and out["images"]

    async def plain(**kw):
        return {"png_base64": "AAAA", "width": 1280, "height": 3000}
    monkeypatch.setattr(page_preview, "render_preview", plain)
    assert call({"action": "preview"}, images=False)["image_png_base64"] == "AAAA"     # unchanged


def test_import_image_stores_under_the_institute(monkeypatch):
    import httpx
    from app.repositories import editor_media_asset_repository as repo_mod
    from app.services import assistant_tools_website_edit as edit
    from app.services import s3_service, safe_http

    png = cv2.imencode(".png", np.full((8, 8, 3), 200, np.uint8))[1].tobytes()

    async def _fetch(url, **kw):
        return safe_http.FetchResult(url=url, status_code=200, headers=httpx.Headers({"content-type": "image/png"}),
                                     content=png)
    monkeypatch.setattr(safe_http, "safe_fetch", _fetch)
    keys = []

    class _S3:
        def upload_file_content(self, content, name, s3_key=None, content_type=None):
            keys.append(s3_key)
            return f"{CDN}/{s3_key}"

    class _Repo:
        def __init__(self, *a, **k): pass
        def find_by_metadata(self, *a, **k): return None
        def create(self, **kw): pass
    monkeypatch.setattr(s3_service, "S3Service", _S3)
    monkeypatch.setattr(repo_mod, "EditorMediaAssetRepository", _Repo)
    out = asyncio.run(edit._import_one_image({"url": "https://example.com/a.png"}, ctx()))
    assert keys[0].startswith("page-builder/imports/inst-1/photo-") and out["url"].endswith(keys[0])


# ── the MCP result ───────────────────────────────────────────────────────
def test_mcp_result_sends_every_tile_as_an_image(monkeypatch):
    from app.mcp import adapter

    async def fake_execute(name, args, ctx_, gate):
        return json.dumps({"action": "preview", "image_png_base64": "AAA", "images_base64": ["BBB", "CCC"], "width": 1440})
    monkeypatch.setattr(adapter, "execute_tool", fake_execute)
    principal = PinnedPrincipal(user_id="u", institute_id="i", roles=["ADMIN"], permissions=[], is_root_user=False)
    res = asyncio.run(adapter.call_tool(name="website", arguments={"action": "preview"}, principal=principal,
                                        platform_token=None, db=None, mcp_setting={"enabled": True}))
    kinds = [c.type for c in res.content]
    assert kinds == ["image", "image", "image", "text"]
    assert [c.data for c in res.content[:3]] == ["AAA", "BBB", "CCC"]
    assert "images_base64" not in res.content[3].text and "image_png_base64" not in res.content[3].text


def test_a_cancelled_compare_keeps_its_slot_until_the_worker_thread_ends(bv, monkeypatch):
    """RES-2: cancelling the request must not let a second compare start beside the running thread."""
    import threading
    from app.services import visual_compare as vc

    design, rendered = _design_and_render()
    monkeypatch.setattr(website_mod, "_read_s3_object", lambda b, k, c: cv2.imencode(".png", design)[1].tobytes())
    monkeypatch.setattr(page_preview, "render_preview", _fake_render(rendered, {}))
    started, release = threading.Event(), threading.Event()
    real = vc.decode_reference

    def slow(blobs, width):
        started.set()
        release.wait(10)
        return real(blobs, width)
    monkeypatch.setattr(vc, "decode_reference", slow)
    slots = asyncio.Semaphore(1)
    monkeypatch.setattr(vc, "COMPARE_SLOTS", slots)
    args = {"action": "compare", "page_route": "courses",
            "reference": {"asset_url": f"{CDN}/page-builder/imports/inst-1/p.png"}}

    async def scenario():
        task = asyncio.ensure_future(website_mod.execute_website(args, ctx()))
        while not started.is_set():
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert slots.locked()                 # the thread still runs: the slot stays taken
        release.set()
        for _ in range(500):
            if not slots.locked():
                break
            await asyncio.sleep(0.01)
        assert not slots.locked()             # freed when the thread finished
    asyncio.run(scenario())
