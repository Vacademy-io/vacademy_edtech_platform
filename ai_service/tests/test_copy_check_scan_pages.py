"""Scan Station page features (scan/pages.py) and capped downloads (scan/fetch.py).

The real DPI decides the physical scale of every later measure, so where it
comes from is reported (JFIF / EXIF / PDF / ASSUMED) and implausible values
fall back to 300 ASSUMED. No network: downloads use httpx.MockTransport.
"""
from __future__ import annotations

import asyncio
import io
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from app.services.copy_check.scan import fetch, pages
from copy_check_scan_synth import front_page, jpeg_bytes


def _a4(dpi: int) -> np.ndarray:
    page = front_page(seed=1, label=True)
    w, h = int(8.27 * dpi), int(11.69 * dpi)
    return np.asarray(Image.fromarray(page).resize((w, h)))


def _write(tmp_path: Path, name: str, data: bytes) -> str:
    p = tmp_path / name
    p.write_bytes(data)
    return str(p)


def test_jfif_dpi(tmp_path):
    path = _write(tmp_path, "a.jpg", jpeg_bytes(_a4(200), dpi=200))
    res = pages.extract_file(path, "IMAGE", 100)
    assert res.error is None and len(res.pages) == 1
    p = res.pages[0]
    assert (p.dpi, p.dpi_source) == (200.0, "JFIF")
    assert (p.width_px, p.height_px) == (int(8.27 * 200), int(11.69 * 200))
    # kept features are small: the maps and two JPEG strips, never full pixels
    assert p.dark.shape == (212, 150)
    assert p.header_up.shape == (120, 200) and p.header_down.shape == (120, 200)
    for strip in (p.strip_up, p.strip_down):
        im = Image.open(io.BytesIO(strip))
        assert max(im.size) <= pages.STRIP_LONG_EDGE


def test_jfif_unit_zero_density_from_image_capture(tmp_path):
    # macOS Image Capture writes density (300, 300) with unit 0 (aspect only)
    data = bytearray(jpeg_bytes(_a4(300), dpi=None, quality=60))
    app0 = data.index(b"JFIF\x00")
    data[app0 + 7:app0 + 12] = bytes([0, 1, 44, 1, 44])    # unit 0, Xdensity 300, Ydensity 300
    with Image.open(io.BytesIO(bytes(data))) as im:
        assert im.info["jfif_unit"] == 0 and im.info["jfif_density"] == (300, 300)
    p = pages.extract_file(_write(tmp_path, "ic.jpg", bytes(data)), "IMAGE", 100).pages[0]
    assert (p.dpi, p.dpi_source) == (300.0, "JFIF")


def test_exif_dpi(tmp_path):
    exif = Image.Exif()
    exif[282] = 150.0
    exif[283] = 150.0
    exif[296] = 2
    buf = io.BytesIO()
    Image.fromarray(_a4(150)).save(buf, format="JPEG", exif=exif.tobytes(), quality=85)
    with Image.open(io.BytesIO(buf.getvalue())) as im:
        assert im.info.get("jfif_unit", 0) == 0     # no JFIF density: EXIF must decide
    path = _write(tmp_path, "b.jpg", buf.getvalue())
    p = pages.extract_file(path, "IMAGE", 100).pages[0]
    assert (p.dpi, p.dpi_source) == (150.0, "EXIF")


def test_pdf_dpi_from_image_vs_mediabox(tmp_path):
    import fitz

    png = io.BytesIO()
    Image.fromarray(_a4(150)).save(png, format="PNG")
    doc = fitz.open()
    for _ in range(2):
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=png.getvalue())
    path = _write(tmp_path, "c.pdf", doc.tobytes())
    res = pages.extract_file(path, "PDF", 100)
    assert res.error is None and res.total_pages == 2 and len(res.pages) == 2
    for i, p in enumerate(res.pages):
        assert p.page_index == i
        assert p.dpi_source == "PDF"
        assert abs(p.dpi - 150.0) < 2.0
        assert abs(p.width_px - 1240) <= 3


def test_pdf_pages_are_capped(tmp_path):
    import fitz

    doc = fitz.open()
    for _ in range(3):
        doc.new_page(width=595, height=842)
    path = _write(tmp_path, "d.pdf", doc.tobytes())
    res = pages.extract_file(path, "PDF", 2)
    assert res.total_pages == 3 and len(res.pages) == 2
    # a vector page has no embedded image: the DPI is assumed
    assert res.pages[0].dpi_source == "ASSUMED" and res.pages[0].dpi == 300.0


def test_assumed_dpi_fallbacks(tmp_path):
    # 72 DPI stated on a 300 DPI scan would mean a 34-inch page: not believed
    path = _write(tmp_path, "e.jpg", jpeg_bytes(_a4(300)[:, :, :], dpi=72, quality=60))
    p = pages.extract_file(path, "IMAGE", 100).pages[0]
    assert (p.dpi, p.dpi_source) == (300.0, "ASSUMED")
    buf = io.BytesIO()
    Image.fromarray(_a4(100)).save(buf, format="PNG")
    p = pages.extract_file(_write(tmp_path, "f.png", buf.getvalue()), "IMAGE", 100).pages[0]
    assert p.dpi_source == "ASSUMED"


def test_unreadable_and_oversized_files(tmp_path, monkeypatch):
    bad = _write(tmp_path, "g.jpg", jpeg_bytes(_a4(100))[:3000])
    assert pages.extract_file(bad, "IMAGE", 100).error == pages.ERR_UNREADABLE
    assert pages.extract_file(_write(tmp_path, "h.pdf", b"%PDF-1.4 junk"), "PDF", 100).error == pages.ERR_UNREADABLE
    monkeypatch.setattr(pages, "MAX_PIXELS", 1000)
    ok = _write(tmp_path, "i.jpg", jpeg_bytes(_a4(100)))
    assert pages.extract_file(ok, "IMAGE", 100).error == pages.ERR_TOO_LARGE


def _transport(sizes: dict[str, int]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        if name not in sizes:
            return httpx.Response(404)
        return httpx.Response(200, content=b"x" * sizes[name])
    return httpx.MockTransport(handler)


def test_fetch_aborts_past_the_file_cap_and_isolates_failures(tmp_path):
    specs = [fetch.FetchSpec("1:0", "https://m/ok?sig=secret", ".img"),
             fetch.FetchSpec("1:1", "https://m/big?sig=secret", ".img"),
             fetch.FetchSpec("1:2", "https://m/missing?sig=secret", ".img"),
             fetch.FetchSpec("1:3", "file:///etc/passwd", ".img")]
    got, too_large = asyncio.run(fetch.fetch_all(
        specs, tmp_path, max_file_bytes=1000, max_load_bytes=10_000,
        transport=_transport({"ok": 500, "big": 5000})))
    assert not too_large
    assert got["1:0"].error is None and Path(got["1:0"].path).stat().st_size == 500
    assert got["1:1"].error == fetch.ERR_FILE_TOO_LARGE
    assert got["1:2"].error == fetch.ERR_FETCH
    assert got["1:3"].error == fetch.ERR_FETCH
    assert not any(p.name.startswith("f1") for p in tmp_path.iterdir())   # partial file removed


def test_fetch_stops_at_the_load_cap(tmp_path):
    specs = [fetch.FetchSpec(f"1:{i}", f"https://m/f{i}", ".img") for i in range(6)]
    got, too_large = asyncio.run(fetch.fetch_all(
        specs, tmp_path, max_file_bytes=1000, max_load_bytes=2500,
        transport=_transport({f"f{i}": 800 for i in range(6)})))
    assert too_large
    assert any(f.error == fetch.ERR_LOAD_TOO_LARGE for f in got.values())


def test_safe_url_drops_the_query():
    assert fetch.safe_url("https://s3/x.jpg?X-Amz-Signature=abc") == "https://s3/x.jpg"


def _faint_pencil_back_300() -> np.ndarray:
    """A 300 DPI back with only a short light-pencil answer ('x = 12.5 cm'):
    strokes 2 px wide at luma 170. INTER_AREA to 100 DPI averages them with the
    paper to about Y 205, above the neutral ink cut (180)."""
    import cv2

    w, h = 2481, 3507
    page = np.full((h, w, 3), 242, np.uint8)
    for y in range(480, h - 150, 96):
        cv2.line(page, (0, y), (w - 1, y), (175, 200, 235), 2)
    cv2.line(page, (285, 0), (285, h - 1), (235, 150, 150), 4)
    for k, ch in enumerate("x=12.5cm"):
        cv2.putText(page, ch, (900 + k * 60, 1500), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (170, 170, 170), 2, cv2.LINE_AA)
    return page


def test_faint_pencil_back_is_not_blank(tmp_path):
    from app.services.copy_check.scan import ink

    page = _faint_pencil_back_300()
    buf = io.BytesIO()
    Image.fromarray(page).save(buf, format="PNG", dpi=(300, 300))
    p = pages.extract_file(_write(tmp_path, "pencil.png", buf.getvalue()), "IMAGE", 100).pages[0]
    assert p.dpi == 300.0
    cls = ink.classify(p.ink_per_10k, p.blob_mm2, 1.0, 3.0, 4.0)
    assert cls != ink.BLANK, (p.ink_per_10k, p.blob_mm2)
    # the reason: measured on a 100 DPI render, the same page would be dropped
    low = ink.measure(pages._resize_to(page, 1 / 3), 100)
    assert ink.classify(*low, 1.0, 3.0, 4.0) == ink.BLANK, low


def test_ink_is_measured_at_most_at_300_dpi(tmp_path, monkeypatch):
    from app.services.copy_check.scan import ink

    seen = []
    real = ink.measure
    monkeypatch.setattr(ink, "measure", lambda rgb, dpi: seen.append((rgb.shape[:2], dpi)) or real(rgb, dpi))
    for dpi in (200, 400):
        path = _write(tmp_path, f"p{dpi}.jpg", jpeg_bytes(_a4(dpi), dpi=dpi, quality=70))
        p = pages.extract_file(path, "IMAGE", 100).pages[0]
        assert p.dpi == float(dpi) and p.dark.shape == (212, 150)
    (shape200, at200), (shape400, at400) = seen
    assert at200 == 200.0 and shape200 == (int(11.69 * 200), int(8.27 * 200))
    assert at400 == 300.0 and abs(shape400[0] - int(11.69 * 300)) <= 1


def test_blank_300_dpi_back_stays_blank(tmp_path):
    from app.services.copy_check.scan import ink

    page = _faint_pencil_back_300()
    page[1300:1600, 850:1500] = 242          # rub the answer out: rules and margin only
    path = _write(tmp_path, "blank.jpg", jpeg_bytes(page, dpi=300, quality=85))
    p = pages.extract_file(path, "IMAGE", 100).pages[0]
    assert ink.classify(p.ink_per_10k, p.blob_mm2, 1.0, 3.0, 4.0) == ink.BLANK, (p.ink_per_10k, p.blob_mm2)
