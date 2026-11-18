"""Scan Station build: one PDF per copy from scanned pages (builder + service).

No network: sources are local files or an httpx MockTransport, media uploads are
stubbed. One test runs the real spawned pool, so the worker import path and the
pickling of the job are checked too.
"""
from __future__ import annotations

import asyncio
import io
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")
fitz = pytest.importorskip("fitz")
httpx = pytest.importorskip("httpx")
from PIL import Image  # noqa: E402

from app.services.copy_check.scan_build import builder, service  # noqa: E402

A4_W, A4_H = 2480, 3508  # A4 at 300 dpi


def _marked_jpeg(width: int = A4_W, height: int = A4_H) -> bytes:
    """White page with a black square in the top-left corner."""
    img = np.full((height, width, 3), 255, np.uint8)
    img[100:400, 100:400] = 0
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    assert ok
    return buf.tobytes()


def _write(tmp_path, name: str, data: bytes) -> str:
    path = os.path.join(str(tmp_path), name)
    with open(path, "wb") as f:
        f.write(data)
    return path


def _dark_corner(pdf_bytes: bytes, page_no: int = 0) -> str:
    """Which corner of the rendered page holds the black marker."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pix = doc[page_no].get_pixmap(dpi=20, colorspace=fitz.csGRAY)
        g = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.stride)[:, :pix.width]
    finally:
        doc.close()
    h, w = g.shape
    corners = {
        "top-left": g[: h // 4, : w // 4], "top-right": g[: h // 4, -w // 4:],
        "bottom-left": g[-h // 4:, : w // 4], "bottom-right": g[-h // 4:, -w // 4:],
    }
    return min(corners, key=lambda k: corners[k].mean())


def _page(url: str, kind: str = "IMAGE", rotation: int = 0, page_index: int = 0, dpi: int = 300) -> dict:
    return {"url": url, "kind": kind, "page_index": page_index, "rotation": rotation, "dpi": dpi}


# ---- builder ----------------------------------------------------------------

def test_jpeg_pages_keep_size_and_original_bytes(tmp_path):
    jpeg = _marked_jpeg()
    src = _write(tmp_path, "a.jpg", jpeg)
    pdf = builder.build_pdf([_page("u1"), _page("u1")], {"u1": src})
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        assert doc.page_count == 2
        rect = doc[0].rect
        assert abs(rect.width - 595.2) < 1 and abs(rect.height - 841.9) < 1
        xref = doc[0].get_images(full=True)[0][0]
        assert doc.xref_stream_raw(xref) == jpeg  # embedded as it is, no re-encode
        assert "DCTDecode" in doc.xref_get_key(xref, "Filter")[1]
    finally:
        doc.close()
    assert _dark_corner(pdf) == "top-left"


def test_rotation_180_is_baked(tmp_path):
    src = _write(tmp_path, "a.jpg", _marked_jpeg())
    pdf = builder.build_pdf([_page("u1", rotation=180)], {"u1": src})
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        assert doc[0].rotation == 0
        assert abs(doc[0].rect.width - 595.2) < 1
    finally:
        doc.close()
    assert _dark_corner(pdf) == "bottom-right"


def test_rotation_90_is_clockwise_and_swaps_the_page_size(tmp_path):
    src = _write(tmp_path, "a.jpg", _marked_jpeg())
    pdf = builder.build_pdf([_page("u1", rotation=90)], {"u1": src})
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        assert doc[0].rotation == 0
        assert abs(doc[0].rect.width - 841.9) < 1 and abs(doc[0].rect.height - 595.2) < 1
    finally:
        doc.close()
    # Turned clockwise, the top-left corner ends up top-right.
    assert _dark_corner(pdf) == "top-right"


def test_png_is_converted_to_jpeg(tmp_path):
    img = np.full((A4_H // 2, A4_W // 2, 3), 255, np.uint8)
    img[50:200, 50:200] = 0
    ok, buf = cv2.imencode(".png", img)
    src = _write(tmp_path, "a.png", buf.tobytes())
    pdf = builder.build_pdf([_page("u1", dpi=150)], {"u1": src})
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        xref = doc[0].get_images(full=True)[0][0]
        assert "DCTDecode" in doc.xref_get_key(xref, "Filter")[1]
        assert abs(doc[0].rect.width - 595.2) < 1
    finally:
        doc.close()


def test_exif_orientation_is_transposed_and_reencoded(tmp_path):
    # Stored landscape with EXIF 6 ("turn 90 clockwise to view"): shown portrait.
    stored = Image.new("RGB", (A4_H // 4, A4_W // 4), "white")
    exif = Image.Exif()
    exif[0x0112] = 6
    out = io.BytesIO()
    stored.save(out, format="JPEG", exif=exif.tobytes())
    stream, w, h, reencoded = builder.image_stream(out.getvalue())
    assert reencoded and (w, h) == (A4_W // 4, A4_H // 4)
    assert stream != out.getvalue()


def test_pdf_source_pages_are_copied_in_order_and_turned(tmp_path):
    src_doc = fitz.open()
    for i in range(3):
        page = src_doc.new_page(width=595, height=842)
        page.insert_text((72, 100), f"SOURCE PAGE {i}", fontsize=20)
    src = _write(tmp_path, "pass.pdf", src_doc.tobytes())
    src_doc.close()

    pages = [_page("p", "PDF", page_index=2), _page("p", "PDF", page_index=0, rotation=180)]
    pdf = builder.build_pdf(pages, {"p": src})
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        assert doc.page_count == 2
        assert "SOURCE PAGE 2" in doc[0].get_text()
        assert "SOURCE PAGE 0" in doc[1].get_text()
        assert doc[1].rotation == 0  # baked
        # Text that was at the top now sits near the bottom of the page.
        block = doc[1].search_for("SOURCE PAGE 0")[0]
        assert block.y0 > doc[1].rect.height / 2
    finally:
        doc.close()


def test_over_the_size_cap_runs_shrink_scans(tmp_path, monkeypatch):
    from app.services.copy_check import annotator

    calls = []

    def fake_shrink(pdf_bytes, cap_bytes=0):
        calls.append(cap_bytes)
        return b"%PDF-small"

    monkeypatch.setattr(annotator, "shrink_scans", fake_shrink)
    monkeypatch.setattr(builder, "SIZE_CAP_BYTES", 1000)
    src = _write(tmp_path, "a.jpg", _marked_jpeg())
    out = os.path.join(str(tmp_path), "out.pdf")
    res = builder.build_copy([_page("u1")], {"u1": src}, out)
    assert calls == [1000]
    assert res == {"page_count": 1, "bytes": len(b"%PDF-small"), "error": None}
    with open(out, "rb") as f:
        assert f.read() == b"%PDF-small"


def test_too_many_pages_is_copy_too_large(tmp_path):
    src = _write(tmp_path, "a.jpg", _marked_jpeg(200, 280))
    res = builder.build_copy([_page("u1")] * 201, {"u1": src}, os.path.join(str(tmp_path), "o.pdf"))
    assert res["error"] == "COPY_TOO_LARGE"


def test_corrupt_or_truncated_image_is_an_error_not_a_raise(tmp_path):
    jpeg = _marked_jpeg()
    bad = _write(tmp_path, "bad.jpg", b"not an image at all")
    cut = _write(tmp_path, "cut.jpg", jpeg[: len(jpeg) // 3])
    assert builder.build_copy([_page("b")], {"b": bad}, os.path.join(str(tmp_path), "1.pdf"))["error"] == "BUILD_FAILED"
    assert builder.build_copy([_page("c")], {"c": cut}, os.path.join(str(tmp_path), "2.pdf"))["error"] == "BUILD_FAILED"


# ---- service (download -> pool -> upload) ----------------------------------

@pytest.fixture
def inline_pool(monkeypatch):
    """Run builds in this process (the real pool is covered by its own test)."""
    async def _inline(pages, sources, out_path):
        return builder.build_copy(pages, sources, out_path)

    monkeypatch.setattr(service, "_build_in_pool", _inline)


@pytest.fixture
def uploads(monkeypatch):
    seen = []

    async def fake_upload(content, file_name, *, institute_id, source_id, transport=None):
        seen.append({"name": file_name, "institute_id": institute_id, "source_id": source_id,
                     "pages": fitz.open(stream=content, filetype="pdf").page_count})
        return f"file-{len(seen)}"

    monkeypatch.setattr(service.media_upload, "upload_pdf", fake_upload)
    return seen


def _media(files: dict[str, bytes]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = files.get(str(request.url.copy_with(query=None)))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, content=body)

    return httpx.MockTransport(handler)


def test_a_corrupt_source_fails_only_its_copy(inline_pool, uploads):
    jpeg = _marked_jpeg(400, 566)
    transport = _media({"https://m/a.jpg": jpeg, "https://m/b.jpg": jpeg, "https://m/bad.jpg": b"garbage"})
    copies = [
        {"copy_key": "L1-S0", "file_name": "c0.pdf", "pages": [_page("https://m/a.jpg?sig=1"), _page("https://m/b.jpg")]},
        {"copy_key": "L1-S2", "file_name": "c1.pdf", "pages": [_page("https://m/bad.jpg")]},
        {"copy_key": "L1-S3", "file_name": "c2.pdf", "pages": [_page("https://m/missing.jpg")]},
        {"copy_key": "L1-S4", "file_name": "c3.pdf", "pages": [_page("https://m/b.jpg", rotation=180)]},
    ]
    out = asyncio.run(service.build_copies(copies, institute_id="inst-1", source_id="ASSESSMENT_SCAN_STATION",
                                           transport=transport))
    assert [r["copy_key"] for r in out] == ["L1-S0", "L1-S2", "L1-S3", "L1-S4"]
    assert out[0]["error"] is None and out[0]["file_id"] == "file-1" and out[0]["page_count"] == 2
    assert out[0]["bytes"] > 0
    assert out[1]["error"] == "BUILD_FAILED" and out[1]["file_id"] is None
    assert out[2]["error"] == "SOURCE_UNREADABLE"
    assert out[3]["error"] is None and out[3]["page_count"] == 1
    assert {u["institute_id"] for u in uploads} == {"inst-1"}
    assert {u["source_id"] for u in uploads} == {"ASSESSMENT_SCAN_STATION"}


def test_each_url_is_downloaded_once(inline_pool, uploads):
    hits = []
    jpeg = _marked_jpeg(400, 566)

    def handler(request):
        hits.append(str(request.url))
        return httpx.Response(200, content=jpeg)

    copies = [{"copy_key": f"k{i}", "file_name": f"c{i}.pdf", "pages": [_page("https://m/a.jpg")] * 2}
              for i in range(3)]
    out = asyncio.run(service.build_copies(copies, institute_id="i", source_id="S",
                                           transport=httpx.MockTransport(handler)))
    assert hits == ["https://m/a.jpg"]
    assert all(r["error"] is None for r in out)


def test_upload_failure_is_that_copys_error(inline_pool, monkeypatch):
    calls = []

    async def flaky(content, file_name, *, institute_id, source_id, transport=None):
        calls.append(file_name)
        if file_name == "c0.pdf":
            raise RuntimeError("PUT 403")
        return "ok-id"

    monkeypatch.setattr(service.media_upload, "upload_pdf", flaky)
    jpeg = _marked_jpeg(400, 566)
    copies = [{"copy_key": f"k{i}", "file_name": f"c{i}.pdf", "pages": [_page("https://m/a.jpg")]} for i in range(2)]
    out = asyncio.run(service.build_copies(copies, institute_id="i", source_id="S",
                                           transport=_media({"https://m/a.jpg": jpeg})))
    assert [r["error"] for r in out] == ["UPLOAD_FAILED", None]
    assert out[1]["file_id"] == "ok-id"


def test_copies_past_the_budget_time_out(monkeypatch, uploads):
    async def slow(pages, sources, out_path):
        await asyncio.sleep(5)
        return {"page_count": 1, "bytes": 1, "error": None}

    monkeypatch.setattr(service, "_build_in_pool", slow)
    copies = [{"copy_key": "k", "file_name": "c.pdf", "pages": [_page("https://m/a.jpg")]}]
    out = asyncio.run(service.build_copies(copies, institute_id="i", source_id="S", budget_seconds=0.3,
                                           transport=_media({"https://m/a.jpg": _marked_jpeg(40, 56)})))
    assert out[0]["error"] == "TIMEOUT"
    assert service._admit.taken == 0


def test_busy_when_the_admit_is_taken(monkeypatch):
    monkeypatch.setattr(service, "ADMIT_WAIT_SECONDS", 0.2)
    assert service._admit.try_take()
    try:
        with pytest.raises(service.ScanBuildBusy):
            asyncio.run(service.build_copies([], institute_id="i", source_id="S"))
    finally:
        service._admit.give_back()


def test_real_spawned_pool_builds_a_copy(tmp_path, uploads, monkeypatch):
    # Spawned workers re-import `app` from sys.path; under pytest a directory
    # above ai_service can come first and shadow it (ai_service has its own
    # __init__.py), so put ai_service first, as it is in the service image.
    monkeypatch.syspath_prepend(os.path.join(os.path.dirname(__file__), ".."))
    jpeg = _marked_jpeg(400, 566)
    copies = [{"copy_key": "k", "file_name": "c.pdf", "pages": [_page("https://m/a.jpg", rotation=180)]}]
    try:
        out = asyncio.run(service.build_copies(copies, institute_id="i", source_id="S",
                                               transport=_media({"https://m/a.jpg": jpeg})))
    finally:
        pool = service._pool
        if pool is not None:
            service._drop_broken_pool(pool)
    assert out[0]["error"] is None and out[0]["page_count"] == 1
    assert uploads[0]["pages"] == 1
