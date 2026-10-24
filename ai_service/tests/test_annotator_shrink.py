"""A checked copy over media-service's 20 MB multipart cap was silently dropped
(511 MaxUploadSizeExceeded; a seven-page phone scan stored as PNG is ~29 MB
before any mark). The scans are re-encoded to fit; vector marks are untouched."""
import fitz
import pytest

from app.services.copy_check import annotator


def _scan_pdf(pages: int, side: int) -> bytes:
    """Pages that behave like phone scans: a smooth gradient with grain, which
    PNG stores poorly and JPEG well (pure noise would defeat JPEG too)."""
    import random
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        random.seed(i)
        rows = []
        for y in range(side):
            base = 200 - (y * 60 // side)
            rows.append(bytes(min(255, max(0, base + random.randint(-6, 6))) for _ in range(side * 3)))
        pix = fitz.Pixmap(fitz.csRGB, side, side, b"".join(rows), False)
        page.insert_image(page.rect, pixmap=pix)
        page.insert_text((40, 40), f"page {i + 1}", fontsize=12)
    return doc.tobytes()


def test_small_files_are_returned_untouched():
    pdf = _scan_pdf(1, 64)
    assert annotator.shrink_scans(pdf) is pdf


def test_oversized_scans_are_reencoded_smaller_capped_in_size_and_pages_survive():
    pdf = _scan_pdf(2, 2400)  # grainy 2400px "scans"; well over a 1 MB cap
    out = annotator.shrink_scans(pdf, cap_bytes=1_000_000)
    assert len(out) < len(pdf) * 0.5
    doc = fitz.open(stream=out, filetype="pdf")
    assert len(doc) == 2
    info = doc.extract_image(doc[0].get_images(full=True)[0][0])
    assert info["ext"] in ("jpeg", "jpg")
    assert max(info["width"], info["height"]) <= annotator._MAX_SCAN_SIDE_PX
    assert "page 1" in doc[0].get_text()  # the drawn text (a stand-in for marks) is intact
    assert annotator.UPLOAD_CAP_BYTES < 20 * 1024 * 1024


def test_transparent_pen_layers_survive_the_shrink_with_their_alpha():
    # The marks are RGBA PNGs laid over the scan; turning them into JPEG paints
    # their background black behind every tick and note (2026-09-21).
    import io
    from PIL import Image, ImageDraw
    pdf = _scan_pdf(1, 2400)
    doc = fitz.open(stream=pdf, filetype="pdf")
    layer = Image.new("RGBA", (120, 60), (0, 0, 0, 0))
    ImageDraw.Draw(layer).line([(5, 30), (40, 55), (110, 5)], fill=(200, 20, 20, 255), width=6)
    buf = io.BytesIO(); layer.save(buf, format="PNG")
    doc[0].insert_image(fitz.Rect(100, 100, 220, 160), stream=buf.getvalue(), overlay=True)
    pdf = doc.tobytes()

    out = annotator.shrink_scans(pdf, cap_bytes=1_000_000)
    d2 = fitz.open(stream=out, filetype="pdf")
    kinds = []
    for img in d2[0].get_images(full=True):
        info = d2.extract_image(img[0])
        kinds.append((info["ext"], bool(img[1]), info["width"]))
    # the scan became a capped JPEG; the pen layer is still a PNG with its soft mask
    assert any(ext in ("jpeg", "jpg") and w <= annotator._MAX_SCAN_SIDE_PX for ext, _, w in kinds)
    assert any(ext == "png" and has_mask for ext, has_mask, _ in kinds), kinds
