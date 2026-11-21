"""What the website MCP could not do on its own when a client page had to match
the institute's live store: copy another site's look (copy_theme / theme_from),
see the live looks in the interview (brief_checklist), count a custom-HTML hero
as the hero (review), and upload a local file without base64 or a public tunnel
(upload_url)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services.page_quality import _hero_of  # noqa: E402

from test_website_edit_tool import authored_page, backend, ctx, run  # noqa: E402,F401
from test_website_tools import sample_config  # noqa: E402

MAIN_LOOK = sample_config()["globalSettings"]


def test_copy_look_takes_the_look_not_the_data():
    source = {**MAIN_LOOK, "theme": {**MAIN_LOOK["theme"], "palette": {"primary": "#883000", "cream": "#FDF6E8"}},
              "courseFormats": {"ebook": {"label": "E-books"}}, "siteCart": {"enabled": True},
              "layout": {"header": {"id": "h-main"}, "footer": {"id": "f-main"}}}
    target = {"theme": {"preset": "default"}, "fonts": {"family": "Mulish, sans-serif"},
              "layout": {"header": {"id": "h-own"}}, "naming": {"level": "Format"}}
    out = edit_mod.copy_look(source, target)
    assert out["theme"] == source["theme"] and out["fonts"] == source["fonts"] and out["mode"] == "light"
    assert "courseFormats" not in out and "siteCart" not in out and out["naming"] == {"level": "Format"}
    assert out["layout"] == {"header": {"id": "h-own"}}
    with_layout = edit_mod.copy_look(source, target, include_layout=True)
    assert with_layout["layout"] == {"header": {"id": "h-main"}, "footer": {"id": "f-main"}}


@pytest.mark.asyncio
async def test_create_site_theme_from_starts_with_the_live_look(backend):
    out = await run({"action": "create_site", "new_site_name": "comic", "theme_from": "main-site",
                     "theme": {"border_radius": "pill"}, "pages": [{**authored_page(), "route": "home"}]})
    assert out["created_site"] is True
    gs = json.loads(backend.created[0]["catalogue_json"])["globalSettings"]
    assert gs["theme"]["primaryColor"] == MAIN_LOOK["theme"]["primaryColor"]
    assert gs["fonts"] == MAIN_LOOK["fonts"]
    assert gs["theme"]["borderRadius"] == "pill"          # the explicit theme still overrides one setting


@pytest.mark.asyncio
async def test_create_page_theme_from_unknown_site_changes_nothing(backend):
    out = await run({"action": "create_page", "new_site_name": "comic", "theme_from": "no-such-site",
                     "page": {**authored_page(), "route": "home"}})
    assert out.get("error") and "no-such-site" in out.get("message", "")
    assert backend.created == []


@pytest.mark.asyncio
async def test_copy_theme_gives_an_existing_site_the_live_look(backend):
    await run({"action": "create_site", "new_site_name": "comic", "pages": [{**authored_page(), "route": "home"}]})
    out = await run({"action": "copy_theme", "tag_name": "comic", "from_tag_name": "main-site"})
    assert "error" not in out, out
    saved = backend.saved[-1]["config"]["globalSettings"]
    assert saved["theme"]["primaryColor"] == MAIN_LOOK["theme"]["primaryColor"]
    assert saved["fonts"] == MAIN_LOOK["fonts"]
    assert (await run({"action": "copy_theme", "tag_name": "comic", "from_tag_name": "comic"}))["error"] == "bad_request"
    assert (await run({"action": "copy_theme", "tag_name": "comic"}))["error"] == "missing_argument"


def test_site_looks_lists_live_sites_with_a_look_of_their_own():
    def row(tag, status, theme, pages=1):
        cfg = {"globalSettings": {"theme": theme, "fonts": {"family": "Lato, sans-serif"}}, "pages": [{}] * pages}
        return {"tag_name": tag, "status": status, "catalogue_json": json.dumps(cfg)}
    rows = [row("store", "ACTIVE", {"primaryColor": "#883000", "palette": {"primary": "#883000", "cream": "#FDF6E8"}}, 3),
            row("faqs", "ACTIVE", {"preset": "default"}),
            row("draft-site", "DRAFT", {"primaryColor": "#111111"}),
            row("contact", "ACTIVE", {"primaryColor": "#883000"}, 1)]
    looks = website_mod._site_looks(rows)
    assert [lk["tag_name"] for lk in looks] == ["store", "contact"]
    assert looks[0]["palette"] == {"primary": "#883000", "cream": "#FDF6E8"}
    assert looks[0]["fonts"] == {"body": "Lato, sans-serif"}


def test_review_counts_an_opening_h1_html_block_as_the_hero():
    html_hero = {"id": "hero-html", "type": "htmlBlock", "props": {"html": "<section><h1 class='t'>Comic</h1></section>"}}
    plain = {"id": "note", "type": "htmlBlock", "props": {"html": "<p>No heading</p>"}}
    faq = {"id": "faq", "type": "faqSection", "props": {}}
    assert _hero_of([html_hero, faq]) is html_hero
    assert _hero_of([plain, faq]) is None
    assert _hero_of([faq, html_hero]) is None             # only the block that opens the page


@pytest.mark.asyncio
async def test_upload_url_presigns_one_staging_file(monkeypatch):
    seen = {}

    class _S3:
        def presigned_post(self, key, content_type, max_bytes, expires_in):
            seen.update(key=key, content_type=content_type, max_bytes=max_bytes, expires_in=expires_in)
            return {"url": "https://bucket.s3.amazonaws.com/", "fields": {"key": key, "Content-Type": content_type},
                    "public_url": f"https://bucket.s3.amazonaws.com/{key}"}

    from app.services import s3_service
    monkeypatch.setattr(s3_service, "S3Service", _S3)
    out = await run({"action": "upload_url", "file_name": "/Users/me/Downloads/Section2 Preview RP Comic.zip"})
    assert seen["key"].startswith("page-builder/uploads/inst-1/") and seen["key"].endswith("/Section2-Preview-RP-Comic.zip")
    assert seen["content_type"] == "application/zip" and seen["max_bytes"] == 150 * 1024 * 1024
    assert out["file_url"].endswith(seen["key"]) and "import_scorm" in out["next"]
    assert '-F "file=@<path to Section2 Preview RP Comic.zip>"' in out["curl"]
    img = await run({"action": "upload_url", "file_name": "cover.PNG"})
    assert seen["content_type"] == "image/png" and "import_image" in img["next"]
    assert (await run({"action": "upload_url", "file_name": "tool.exe"}))["error"] == "bad_request"
    assert (await run({"action": "upload_url", "file_name": ".zip"}))["error"] == "bad_request"
