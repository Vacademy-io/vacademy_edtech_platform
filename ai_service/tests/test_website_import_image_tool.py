"""website_edit(import_image) end to end, with the network, S3 and the media
library faked: Figma links, SSRF refusals through the real safe_fetch rules,
downscaling, base64 input, 16-per-call batches, sha256 dedup and the record in
the institute's editor media library."""
import base64
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
from PIL import Image  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services import safe_http  # noqa: E402

from test_website_edit_tool import ctx  # noqa: E402


def _png(w, h):
    buf = io.BytesIO()
    Image.linear_gradient("L").resize((w, h)).convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


async def run(args):
    return json.loads(await edit_mod.execute_website_edit(args, ctx()))


@pytest.fixture
def stores(monkeypatch):
    """Fake S3 + media library; records what the tool stored and recorded."""
    rec = {"uploads": [], "records": [], "existing": {}}

    class _S3:
        def upload_file_content(self, content, name, s3_key=None, content_type=None):
            rec["uploads"].append({"bytes": len(content), "key": s3_key, "content_type": content_type})
            return f"https://d1om4dxj9e7kkd.cloudfront.net/{s3_key}"

    class _Repo:
        def __init__(self, *a, **k):
            pass

        def find_by_metadata(self, institute_id, **fields):
            url = rec["existing"].get((institute_id, fields.get("sha256")))
            return type("Row", (), {"url": url})() if url else None

        def create(self, **kw):
            rec["records"].append(kw)

    from app.repositories import editor_media_asset_repository as repo_mod
    from app.services import s3_service
    monkeypatch.setattr(s3_service, "S3Service", _S3)
    monkeypatch.setattr(repo_mod, "EditorMediaAssetRepository", _Repo)
    return rec


def _serve(monkeypatch, body, ctype="application/octet-stream", status=200):
    seen = []

    async def _fetch(url, **kw):
        seen.append((url, kw))
        return safe_http.FetchResult(url=url, status_code=status, headers=httpx.Headers({"content-type": ctype}), content=body)
    monkeypatch.setattr(safe_http, "safe_fetch", _fetch)
    return seen


@pytest.mark.asyncio
@pytest.mark.parametrize("url,hint", [
    ("https://www.figma.com/design/c3DrF8i0qcRGQNayyAX4jI/BV?node-id=1-36", "Figma page"),
    ("http://localhost:3845/assets/3e49e.png", "data_base64"),
])
async def test_figma_links_that_are_not_files_get_a_useful_refusal(url, hint, monkeypatch, stores):
    seen = _serve(monkeypatch, b"")
    out = await run({"action": "import_image", "url": url})
    assert out["error"] == "bad_request" and hint in out["message"]
    assert seen == [] and stores["uploads"] == []


@pytest.mark.asyncio
async def test_a_large_figma_asset_is_downscaled_hashed_and_recorded(monkeypatch, stores):
    raw = _png(4800, 3000)
    url = "https://www.figma.com/api/mcp/asset/6aa436fd-14a3-40db-812b-0ae7b405ed3c/3e49e.png"
    seen = _serve(monkeypatch, raw)  # Figma serves octet-stream: the bytes decide
    out = await run({"action": "import_image", "url": url, "kind": "banner", "caption": "Hero art"})
    assert seen[0][1]["max_bytes"] == 25_000_000
    assert out["content_type"] == "image/webp" and (out["width"], out["height"]) == (2400, 1500)
    assert out["figma_asset"] is True and len(out["sha256"]) == 64 and out["original_bytes"] == len(raw)
    assert out["url"].startswith("https://d1om4dxj9e7kkd.cloudfront.net/page-builder/imports/inst-1/banner-")
    assert out["url"].endswith(".webp")
    assert stores["uploads"][0]["content_type"] == "image/webp"
    record = stores["records"][0]
    assert record["institute_id"] == "inst-1" and record["created_by_user_id"] == "user-1"
    assert record["source_url"] == url and record["kind"] == "image" and record["source"] == "upload"
    assert record["metadata"]["origin"] == "website_import_image" and record["metadata"]["sha256"] == out["sha256"]


@pytest.mark.asyncio
async def test_an_ordinary_png_is_stored_exactly_as_before(monkeypatch, stores):
    raw = _png(800, 600)
    _serve(monkeypatch, raw, ctype="image/png")
    out = await run({"action": "import_image", "url": "https://example.com/logo.png", "kind": "logo"})
    assert out["bytes"] == len(raw) and out["content_type"] == "image/png" and "resized" not in out
    assert out["url"].endswith(".png") and "figma_asset" not in out


@pytest.mark.asyncio
async def test_the_same_file_again_returns_the_hosted_copy(monkeypatch, stores):
    import hashlib
    raw = _png(300, 200)
    sha = hashlib.sha256(raw).hexdigest()
    stores["existing"][("inst-1", sha)] = "https://d1om4dxj9e7kkd.cloudfront.net/page-builder/imports/inst-1/photo-old.png"
    _serve(monkeypatch, raw, ctype="image/png")
    out = await run({"action": "import_image", "url": "https://example.com/again.png"})
    assert out["deduplicated"] is True and out["url"].endswith("photo-old.png")
    assert stores["uploads"] == [] and stores["records"] == []


@pytest.mark.asyncio
async def test_base64_input_needs_no_url(monkeypatch, stores):
    raw = _png(64, 64)
    out = await run({"action": "import_image", "data_base64": "data:image/png;base64," + base64.b64encode(raw).decode(),
                     "file_name": "logo.png", "kind": "logo"})
    assert out["source"] == "upload:logo.png" and out["bytes"] == len(raw)
    assert stores["records"][0]["source_url"] is None and stores["records"][0]["metadata"]["file_name"] == "logo.png"
    bad = await run({"action": "import_image", "data_base64": base64.b64encode(b"<html>x</html>").decode()})
    assert bad["error"] == "not_an_image"


@pytest.mark.asyncio
async def test_svg_imports_are_sanitised(monkeypatch, stores):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" onload="alert(1)"><script>x</script><path d="M0 0L1 1"/></svg>'
    _serve(monkeypatch, svg, ctype="image/svg+xml")
    out = await run({"action": "import_image", "url": "https://www.figma.com/api/mcp/asset/x/1c0c9.svg"})
    assert out["content_type"] == "image/svg+xml" and out["url"].endswith(".svg")
    assert out["bytes"] < len(svg)


@pytest.mark.asyncio
async def test_a_batch_takes_sixteen_and_names_the_rest(monkeypatch, stores):
    async def one(args, ctx_):
        return {"url": "https://cdn/" + args["url"].rsplit("/", 1)[-1]}
    monkeypatch.setattr(edit_mod, "_import_one_image", one)
    urls = [f"https://a.com/{i}.png" for i in range(18)]
    out = await run({"action": "import_image", "urls": urls})
    assert len(out["imported"]) == 16 and out["skipped"] == urls[16:]
    assert [r["url"] for r in out["imported"]] == [f"https://cdn/{i}.png" for i in range(16)]


@pytest.mark.asyncio
async def test_redirect_to_the_metadata_address_is_refused(monkeypatch, stores):
    """The real safe_fetch rules: the first hop is public, its redirect is not."""
    hops = []

    async def _resolve(host, port):
        return ["93.184.216.34"]

    async def _hop(target, headers, max_bytes, timeout):
        hops.append(target.url)
        return 302, httpx.Headers({"location": "https://169.254.169.254/latest/meta-data/iam"}), None
    monkeypatch.setattr(safe_http, "_resolve_host", _resolve)
    monkeypatch.setattr(safe_http, "_fetch_one", _hop)
    out = await run({"action": "import_image", "url": "https://images.example.com/a.png"})
    assert out["error"] == "bad_request" and "not a public website" in out["message"]
    assert hops == ["https://images.example.com/a.png"] and stores["uploads"] == []


@pytest.mark.asyncio
async def test_a_rebinding_dns_answer_is_refused(monkeypatch, stores):
    async def _resolve(host, port):
        return ["93.184.216.34", "10.0.0.7"]

    async def _hop(*a, **k):  # pragma: no cover — must never be reached
        raise AssertionError("fetched despite a private address")
    monkeypatch.setattr(safe_http, "_resolve_host", _resolve)
    monkeypatch.setattr(safe_http, "_fetch_one", _hop)
    out = await run({"action": "import_image", "url": "https://rebind.example.com/a.png"})
    assert out["error"] == "bad_request"


@pytest.mark.asyncio
async def test_url_and_base64_together_are_refused_not_half_ignored(monkeypatch, stores):
    seen = _serve(monkeypatch, _png(10, 10), "image/png")
    b64 = base64.b64encode(_png(12, 12)).decode()
    for extra in ({"url": "https://cdn.example.com/a.png"}, {"urls": ["https://cdn.example.com/a.png"]}):
        out = await run({"action": "import_image", "data_base64": b64, "file_name": "x.png", **extra})
        assert out["error"] == "bad_request" and "not both" in out["message"]
    assert seen == [] and stores["uploads"] == []


@pytest.mark.asyncio
async def test_list_media_applies_kind_to_imported_images_too(monkeypatch):
    from app.services import assistant_tools_website as site_mod

    async def _uploads(ctx_, kind, limit):
        return []
    monkeypatch.setattr(site_mod, "_load_media", _uploads)
    monkeypatch.setattr(site_mod, "_load_imported_images", lambda inst, limit: [
        {"url": "https://d1om4dxj9e7kkd.cloudfront.net/a.png", "kind": "logo"},
        {"url": "https://d1om4dxj9e7kkd.cloudfront.net/b.png", "kind": "photo"},
        {"url": "https://d1om4dxj9e7kkd.cloudfront.net/c.png", "kind": "banner"},
    ])
    logos = await site_mod._action_list_media({"kind": "logo"}, ctx())
    assert [i["kind"] for i in logos["imported"]] == ["logo"]
    photos = await site_mod._action_list_media({"kind": "photo", "limit": 1}, ctx())
    assert [i["kind"] for i in photos["imported"]] == ["photo"]
    everything = await site_mod._action_list_media({}, ctx())
    assert len(everything["imported"]) == 3


@pytest.mark.asyncio
async def test_one_unexpected_failure_never_loses_the_rest_of_the_batch(monkeypatch, stores):
    """RES-4: an exception in one image is reported for that url; the others stay in 'imported'."""
    async def one(args, ctx_):
        if args["url"].endswith("/bad.svg"):
            raise RecursionError("maximum recursion depth exceeded")
        return {"url": "https://cdn/" + args["url"].rsplit("/", 1)[-1]}
    monkeypatch.setattr(edit_mod, "_import_one_image", one)
    out = await run({"action": "import_image", "urls": ["https://a.com/1.png", "https://a.com/bad.svg", "https://a.com/2.png"]})
    assert [r["url"] for r in out["imported"]] == ["https://cdn/1.png", "https://cdn/2.png"]
    assert out["failed"] == [{"error": "import_failed", "source": "https://a.com/bad.svg",
                              "message": "This image could not be imported; the others were not affected."}]
