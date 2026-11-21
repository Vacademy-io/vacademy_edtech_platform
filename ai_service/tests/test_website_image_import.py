"""import_image's byte handling: type sniffing, SVG sanitising, downscale to
WebP for big art, and byte-for-byte storage for an ordinary image (the old
behaviour). Images are synthesised here — client artwork is never a fixture."""
import base64
import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from PIL import Image  # noqa: E402
from app.services.website_image_import import (  # noqa: E402
    KEEP_ORIGINAL_MAX_BYTES, MAX_EDGE_PX, ImageImportError, decode_base64_image, prepare_image,
    sanitize_svg_document, sniff_image_type,
)


def _png(w, h, noise=False, mode="RGB"):
    if noise:
        img = Image.frombytes("RGB", (w, h), os.urandom(w * h * 3))
    else:
        img = Image.linear_gradient("L").resize((w, h)).convert(mode)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_sniffing_trusts_bytes_not_headers():
    assert sniff_image_type(_png(4, 4)) == "image/png"
    jpg = io.BytesIO()
    Image.new("RGB", (4, 4)).save(jpg, format="JPEG")
    assert sniff_image_type(jpg.getvalue()) == "image/jpeg"
    assert sniff_image_type(b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>') == "image/svg+xml"
    assert sniff_image_type(b"<html><body>hi</body></html>") is None
    assert sniff_image_type(b"%PDF-1.7") is None


def test_an_ordinary_image_is_stored_byte_for_byte():
    raw = _png(1200, 800)
    out = prepare_image(raw, "image/png")
    assert out.data == raw and out.content_type == "image/png" and out.ext == "png"
    assert (out.width, out.height) == (1200, 800) and out.resized is False
    import hashlib
    assert out.sha256 == hashlib.sha256(raw).hexdigest()


def test_wide_art_is_downscaled_to_webp_at_2400px():
    raw = _png(4800, 1200, mode="RGBA")
    out = prepare_image(raw, "application/octet-stream")
    assert out.content_type == "image/webp" and out.ext == "webp" and out.resized
    assert max(out.width, out.height) == MAX_EDGE_PX and (out.width, out.height) == (2400, 600)
    assert Image.open(io.BytesIO(out.data)).format == "WEBP"


def test_files_over_the_old_6mb_cap_are_converted_not_refused():
    raw = _png(2000, 1100, noise=True)
    assert len(raw) > KEEP_ORIGINAL_MAX_BYTES
    out = prepare_image(raw, "image/png")
    assert out.content_type == "image/webp" and out.original_bytes == len(raw) and len(out.data) < len(raw)


def test_damaged_lying_and_bomb_images_are_refused():
    with pytest.raises(ImageImportError) as e:
        prepare_image(b"<html>not an image</html>", "image/png")
    assert e.value.code == "not_an_image"
    with pytest.raises(ImageImportError) as e:
        prepare_image(_png(800, 600)[:200], "image/png")
    assert e.value.code == "not_an_image"
    # A tiny file that claims 20000 x 20000 pixels.
    bomb = io.BytesIO()
    Image.new("1", (20000, 20000)).save(bomb, format="PNG")
    with pytest.raises(ImageImportError) as e:
        prepare_image(bomb.getvalue(), "image/png")
    assert e.value.code == "too_large"
    with pytest.raises(ImageImportError) as e:
        prepare_image(b"\x89PNG\r\n\x1a\n" + b"0" * 26_000_000, "image/png")
    assert e.value.code == "too_large"


def test_svg_is_sanitised_but_keeps_its_drawing():
    evil = (
        b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        b'width="20" height="10" onload="alert(1)">'
        b'<script>alert(2)</script>'
        b'<style>@import url(https://evil.example/x.css);</style>'
        b'<defs><linearGradient id="g"><stop offset="0" stop-color="#883000"/></linearGradient></defs>'
        b'<a xlink:href="javascript:alert(3)"><rect width="10" height="10" fill="url(#g)" '
        b'style="fill:url(https://evil.example/t)" onclick="x()"/></a>'
        b'<use href="https://evil.example/s.svg#a"/><use href="#g"/>'
        b'<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'
        b'<set attributeName="href" to="javascript:alert(4)"/>'
        b'<image href="data:image/png;base64,iVBORw0KGgo="/>'
        b'<image href="data:text/html;base64,PHNjcmlwdD4="/>'
        b'</svg>'
    )
    out = sanitize_svg_document(evil).decode()
    for bad in ("script", "onload", "onclick", "javascript", "evil.example", "foreignObject", "<set", "@import", "text/html"):
        assert bad not in out, bad
    assert 'fill="url(#g)"' in out and 'href="#g"' in out and "data:image/png;base64" in out
    assert "linearGradient" in out and 'width="20"' in out
    prepared = prepare_image(evil, "image/svg+xml")
    assert prepared.content_type == "image/svg+xml" and (prepared.width, prepared.height) == (20, 10)


def test_svg_without_namespace_gets_one_and_entities_are_refused():
    out = sanitize_svg_document(b'<svg width="4" height="4"><rect width="4" height="4"/></svg>')
    assert b'xmlns="http://www.w3.org/2000/svg"' in out
    lol = b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>'
    with pytest.raises(ImageImportError):
        sanitize_svg_document(lol)
    with pytest.raises(ImageImportError):
        sanitize_svg_document(b"<html><svg/></html>")


def test_base64_input_accepts_raw_and_data_urls_and_is_capped():
    raw = _png(10, 10)
    b64 = base64.b64encode(raw).decode()
    assert decode_base64_image(b64) == raw
    assert decode_base64_image("data:image/png;base64," + b64) == raw
    with pytest.raises(ImageImportError) as e:
        decode_base64_image("not base64!!")
    assert e.value.code == "bad_request"
    with pytest.raises(ImageImportError) as e:
        decode_base64_image("A" * 14_000_000)
    assert e.value.code == "too_large"


def test_svg_keeps_only_svg_elements_and_no_outside_loads():
    # An XHTML <img>/<meta> inside an SVG is a tracking pixel / redirect when
    # the file is opened directly from our CDN.
    raw = (
        b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml" '
        b'xmlns:x="urn:other" width="8" height="8">'
        b'<h:img src="https://evil.example/t.png"/>'
        b'<h:meta http-equiv="refresh" content="0;url=https://evil.example"/>'
        b'<x:thing/>'
        b'<image width="1" height="1" src="https://evil.example/b"/>'
        b'<filter id="f"><feImage href="https://evil.example/a.png"/></filter>'
        b'<rect width="8" height="8" fill="#883000"/>'
        b'</svg>'
    )
    out = prepare_image(raw, "image/svg+xml").data.decode()
    for bad in ("evil.example", "img", "meta", "refresh", "thing", "src="):
        assert bad not in out, bad
    assert 'fill="#883000"' in out and "<image" in out and "<feImage" in out


def test_css_escapes_do_not_hide_an_outside_url():
    raw = (
        b'<svg xmlns="http://www.w3.org/2000/svg">'
        b'<style>rect{fill:\\75rl(https://evil.example/x.svg#a)}</style>'
        b'<style>.a{background:image-set("https://evil.example/i.png" 1x)}</style>'
        b'<style>.b{fill:u\\rl(https://evil.example/c)}</style>'
        b'<style>.ok{fill:url(#g)}</style>'
        b'<rect style="fill:\\75rl(https://evil.example/y)" width="5" height="5"/>'
        b'<rect style="fill:url(#g)" width="5" height="5"/>'
        b'</svg>'
    )
    out = sanitize_svg_document(raw).decode()
    assert "evil.example" not in out
    assert ".ok{fill:url(#g)}" in out and 'style="fill:url(#g)"' in out


def test_a_plain_public_doctype_is_removed_not_refused():
    # Older Illustrator / Inkscape exports name the SVG 1.1 DTD.
    raw = (b'<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
           b'"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
           b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    out = prepare_image(raw, "image/svg+xml")
    assert b"DOCTYPE" not in out.data and b"<rect" in out.data and (out.width, out.height) == (10, 10)
    with pytest.raises(ImageImportError):  # an internal subset is still refused
        sanitize_svg_document(b'<!DOCTYPE svg [<!ATTLIST svg x CDATA "y">]><svg xmlns="http://www.w3.org/2000/svg"/>')


def _gif_frames(w, h, n=2):
    frames = [Image.new("P", (w, h), i) for i in range(n)]
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    return buf.getvalue()


def test_an_animated_gif_up_to_6mb_is_stored_as_sent_whatever_its_size():
    raw = _gif_frames(3000, 400)
    out = prepare_image(raw, "image/gif")
    assert out.data == raw and out.content_type == "image/gif" and not out.resized
    assert (out.width, out.height) == (3000, 400)


def test_a_flat_huge_png_is_refused_before_it_is_decoded():
    # 28 KB on the wire, ~80 MP: decoding it is what cost hundreds of MB.
    flat = io.BytesIO()
    Image.new("P", (8900, 8980), 7).save(flat, format="PNG")
    assert len(flat.getvalue()) < 100_000
    with pytest.raises(ImageImportError) as e:
        prepare_image(flat.getvalue(), "image/png")
    assert e.value.code == "too_large"


def test_a_big_jpeg_is_decoded_at_reduced_scale_and_kept_upright():
    # 9000 x 6000 is over the pixel budget at full size, fine via draft().
    img = Image.linear_gradient("L").resize((9000, 6000)).convert("RGB")
    exif = Image.Exif()
    exif[0x0112] = 6  # rotated 90° — must come out portrait
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70, exif=exif)
    out = prepare_image(buf.getvalue(), "image/jpeg")
    assert out.resized and out.content_type == "image/webp"
    assert (out.width, out.height) == (1600, 2400)


def test_banded_shrink_matches_a_whole_image_resize():
    from PIL import ImageChops
    from app.services import website_image_import as wi
    raw = _png(5000, 2600, noise=True)
    got = wi._shrink(Image.open(io.BytesIO(raw)), Image)
    ref = Image.open(io.BytesIO(raw)).convert("RGB").resize(got.size, Image.LANCZOS)
    assert got.size == (2400, 1248)
    assert max(hi for _, hi in ImageChops.difference(got, ref).getextrema()) <= 1  # no seams


def test_deeply_nested_svg_is_refused_cleanly_not_a_recursion_error():
    """RES-4: 5000 nested <g> (35 KB) must be an ImageImportError, never RecursionError."""
    deep = (b'<svg xmlns="http://www.w3.org/2000/svg">' + b"<g>" * 5000 + b"</g>" * 5000 + b"</svg>")
    with pytest.raises(ImageImportError) as exc:
        prepare_image(deep, "image/svg+xml")
    assert exc.value.code == "not_an_image"
    ok = (b'<svg xmlns="http://www.w3.org/2000/svg">' + b"<g>" * 100 + b"<rect/>" + b"</g>" * 100 + b"</svg>")
    assert b"<rect" in sanitize_svg_document(ok)
