"""website_edit(import_scorm) and the scormViewer launchUrl rule, with the
network and admin-core faked: a SCORM zip is checked (zip, imsmanifest.xml,
size) before it is sent to admin-core's scorm/v1/upload, the launch_url comes
back for a scormViewer block, and a launchUrl we do not host is stripped."""
import base64
import io
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
from app.routers.page_builder import clean_urls  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services import safe_http  # noqa: E402
from app.services import website_scorm_import as scorm_mod  # noqa: E402

from test_website_edit_tool import ctx  # noqa: E402

LAUNCH = "https://vacademy-media-storage-public.s3.amazonaws.com/scorm/abc/vacademy_player_v2.html"


def _zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


SCORM = _zip({"imsmanifest.xml": "<manifest/>", "res/index.html": "<html></html>"})


async def run(args):
    return json.loads(await edit_mod.execute_website_edit(args, ctx()))


@pytest.fixture
def admin_core(monkeypatch):
    """Fake admin-core upload; records what was sent."""
    sent = []

    async def _upload(package, base_url, headers):
        sent.append({"name": package.file_name, "bytes": len(package.data), "headers": headers})
        return {"launch_url": LAUNCH, "scorm_version": "1.2", "launch_path": "res/index.html"}

    monkeypatch.setattr(scorm_mod, "upload_to_admin_core", _upload)
    return sent


def _serve(monkeypatch, body, status=200):
    async def _fetch(url, **kw):
        return safe_http.FetchResult(url=url, status_code=status,
                                     headers=httpx.Headers({"content-type": "application/zip"}), content=body)
    monkeypatch.setattr(safe_http, "safe_fetch", _fetch)


@pytest.mark.asyncio
async def test_base64_scorm_zip_returns_launch_url(admin_core):
    out = await run({"action": "import_scorm", "data_base64": base64.b64encode(SCORM).decode(), "file_name": "preview.zip"})
    assert out["launch_url"] == LAUNCH and out["scorm_version"] == "1.2"
    assert admin_core[0]["name"] == "preview.zip"
    # The caller's own token, scoped to the pinned institute.
    assert admin_core[0]["headers"]["Authorization"].startswith("Bearer ") and admin_core[0]["headers"]["clientId"]
    assert "scormViewer" in out["next"]


@pytest.mark.asyncio
async def test_url_scorm_zip_is_fetched_and_named_from_the_link(monkeypatch, admin_core):
    _serve(monkeypatch, SCORM)
    out = await run({"action": "import_scorm", "url": "https://example.org/files/Section2-Preview.zip"})
    assert out["launch_url"] == LAUNCH
    assert admin_core[0]["name"] == "Section2-Preview.zip"


@pytest.mark.asyncio
async def test_zip_without_manifest_is_refused_before_upload(monkeypatch, admin_core):
    # A client folder zip that only holds the SCORM zip inside it.
    outer = _zip({"Client folder/Section2-Preview.zip": SCORM})
    _serve(monkeypatch, outer)
    out = await run({"action": "import_scorm", "url": "https://example.org/bundle.zip"})
    assert out["error"] == "not_scorm" and "inner SCORM zip" in out["message"]
    assert admin_core == []


@pytest.mark.asyncio
async def test_not_a_zip_and_http_and_both_sources_are_refused(monkeypatch, admin_core):
    _serve(monkeypatch, b"%PDF-1.7 not a zip")
    assert (await run({"action": "import_scorm", "url": "https://example.org/a.zip"}))["error"] == "bad_request"
    assert (await run({"action": "import_scorm", "url": "http://example.org/a.zip"}))["error"] == "bad_request"
    both = await run({"action": "import_scorm", "url": "https://example.org/a.zip", "data_base64": "UEsDBA=="})
    assert both["error"] == "bad_request"
    assert admin_core == []


@pytest.mark.asyncio
async def test_oversized_base64_is_refused_without_decoding(admin_core, monkeypatch):
    monkeypatch.setattr(scorm_mod, "MAX_BASE64_BYTES", 10)
    out = await run({"action": "import_scorm", "data_base64": base64.b64encode(SCORM).decode()})
    assert out["error"] == "too_large" and admin_core == []


def test_launch_url_keeps_only_hosted_packages():
    warnings = []
    kept = clean_urls({"launchUrl": LAUNCH}, {LAUNCH}, warnings)
    assert kept["launchUrl"] == LAUNCH and warnings == []
    stripped = clean_urls({"launchUrl": "https://evil.example/page.html"}, {LAUNCH}, warnings)
    assert stripped["launchUrl"] == "" and "SCORM launch URL" in warnings[0]


def test_hosted_launch_url_is_on_the_asset_allow_list():
    found = edit_mod._asset_urls_in({"type": "scormViewer", "props": {"launchUrl": LAUNCH}}, set())
    assert LAUNCH in found
    assert not edit_mod._asset_urls_in({"props": {"launchUrl": "https://evil.example/x.html"}}, set())


def test_html_block_keeps_its_own_hosted_images_only():
    html = (f'<div><img src="{LAUNCH.replace("scorm/abc/vacademy_player_v2.html", "imports/cover.png")}" alt="c">'
            '<img src=\'https://evil.example/x.png\'></div>')
    found = edit_mod._asset_urls_in({"type": "htmlBlock", "props": {"html": html}}, set())
    assert found == {LAUNCH.replace("scorm/abc/vacademy_player_v2.html", "imports/cover.png")}
