"""
visual_compare: a rendered page against its design, section by section.

Unit-level on synthetic pages (bands of colour with text and blocks drawn in),
so no browser and no network. The block props come from the real Brahm
Varchas fixture, so a hint names the prop that page would need. A last test
runs on the Brahm Varchas Figma renders when FIGMA_BV_FIG_DIR points at them
(client material, never committed).
"""
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from app.services import visual_compare as vc  # noqa: E402

FIXTURE = (Path(__file__).resolve().parents[2] / "frontend-admin-dashboard/src/routes/manage-pages/-components"
           / "__fixtures__/brahm-varchas-site.json")

W = 720
CREAM, WHITE, DARK, OLIVE = (232, 246, 253), (255, 255, 255), (8, 18, 26), (60, 110, 90)   # BGR


def _band(colour, height, label, seed, buttons=()):
    """A band with a heading, a few 'text lines' and blocks — enough structure for SSIM to mean something."""
    rng = np.random.default_rng(seed)
    img = np.full((height, W, 3), colour, dtype=np.uint8)
    ink = (240, 240, 240) if sum(colour) < 200 else (30, 30, 30)
    cv2.putText(img, label, (40, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, ink, 2)
    for i in range(int(rng.integers(2, 5))):
        y = 80 + i * 26
        if y + 10 < height:
            cv2.rectangle(img, (40, y), (40 + int(rng.integers(200, 600)), y + 8), ink, -1)
    for i in range(int(rng.integers(0, 4))):
        x = 40 + i * 170
        if height > 260:
            cv2.rectangle(img, (x, 180), (x + 150, min(height - 20, 180 + 140)), tuple(int(c) for c in rng.integers(0, 255, 3)), -1)
    for i, text in enumerate(buttons):
        x = 420 + i * 150
        cv2.rectangle(img, (x, height // 2 - 20), (x + 135, height // 2 + 20), OLIVE, -1)
        cv2.putText(img, text, (x + 12, height // 2 + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return img


def _page(bands):
    """bands: [(id, colour, height, label, seed, buttons)] → (image, sections with boxes)."""
    imgs, sections, top = [], [], 0
    for sid, colour, height, label, seed, buttons in bands:
        imgs.append(_band(colour, height, label, seed, buttons))
        sections.append({"id": sid, "top": top, "height": height, "text": "\n".join([label, *buttons])})
        top += height
    return np.vstack(imgs), sections


DESIGN_BANDS = [
    ("header-1", WHITE, 64, "Brahm Varchas", 1, ()),
    ("hero", CREAM, 360, "All courses", 2, ()),
    ("catalog", WHITE, 900, "New here? Start free", 3, ()),
    ("courses-not-sure", DARK, 200, "Not sure which course?", 4, ("Find your path", "Talk to us")),
    ("footer-1", CREAM, 420, "Stay connected", 5, ()),
]


def _design_sections(sections, bands=DESIGN_BANDS):
    return [{"name": s["id"], "id": f"1:{i}", "top": s["top"], "height": s["height"], "texts": [b[3], *b[5]]}
            for i, (s, b) in enumerate(zip(sections, bands))]


def _bv_components():
    if not FIXTURE.exists():
        pytest.skip("Brahm Varchas fixture not in this checkout")
    site = json.loads(FIXTURE.read_text())
    page = next(p for p in site["pages"] if p["route"] == "courses")
    return {c["id"]: c for c in page["components"]}


# ── colour, images ───────────────────────────────────────────────────────
def test_ciede2000_matches_the_published_reference_pairs():
    # Sharma, Wu & Dalal (2005), table 1, pairs 1, 7 and 17.
    assert vc.delta_e2000((50, 2.6772, -79.7751), (50, 0, -82.7485)) == pytest.approx(2.0425, abs=1e-4)
    assert vc.delta_e2000((50, 0, 0), (50, -1, 2)) == pytest.approx(2.3669, abs=1e-4)
    assert vc.delta_e2000((50, 2.5, 0), (73, 25, -18)) == pytest.approx(27.1492, abs=1e-4)
    assert vc.delta_e2000((60, 10, 10), (60, 10, 10)) == 0


def test_image_size_reads_headers_without_decoding():
    img = np.zeros((30, 50, 3), dtype=np.uint8)
    for ext in (".png", ".jpg", ".webp"):
        ok, buf = cv2.imencode(ext, img)
        assert ok and vc.image_size(buf.tobytes()) == (50, 30), ext
    assert vc.image_size(b"GIF89a....") is None


def test_decode_refuses_huge_or_foreign_images_before_decoding():
    bomb = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 30000, 30000) + b"\x08\x02\x00\x00\x00"
    with pytest.raises(vc.CompareError) as exc:
        vc.decode_image(bomb)
    assert exc.value.code == "too_large"
    with pytest.raises(vc.CompareError) as exc:
        vc.decode_image(b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    assert exc.value.code == "bad_image"
    with pytest.raises(vc.CompareError):
        vc.decode_image(b"x" * (vc.MAX_IMAGE_BYTES + 1))


def test_transparent_pixels_are_composited_on_white():
    rgba = np.zeros((4, 4, 4), dtype=np.uint8)
    rgba[:2, :, :] = (0, 0, 255, 255)                     # opaque red top half
    out = vc.decode_image(cv2.imencode(".png", rgba)[1].tobytes())
    assert out.shape == (4, 4, 3)
    assert tuple(out[0, 0]) == (0, 0, 255) and tuple(out[3, 3]) == (255, 255, 255)


def test_sixteen_bit_pngs_keep_their_colours():
    rgb16 = np.zeros((8, 8, 3), np.uint16)
    rgb16[:] = (26 * 257, 18 * 257, 8 * 257)                 # BGR of #081a1a-ish, as 16-bit samples
    out = vc.decode_image(cv2.imencode(".png", rgb16)[1].tobytes())
    assert out.dtype == np.uint8 and tuple(out[0, 0]) == (26, 18, 8)
    assert vc.dominant_color(out)["hex"] == "#08121a"
    rgba16 = np.zeros((8, 8, 4), np.uint16)
    rgba16[:4] = (0, 0, 65535, 65535)                        # opaque red top half
    rgba16[4:] = (0, 0, 0, 0)                                # transparent bottom half
    out = vc.decode_image(cv2.imencode(".png", rgba16)[1].tobytes())
    assert out.dtype == np.uint8 and tuple(out[0, 0]) == (0, 0, 255) and tuple(out[7, 7]) == (255, 255, 255)


def test_partial_transparency_is_blended_onto_white():
    rgba = np.zeros((300, 10, 4), np.uint8)                  # taller than one compositing band
    rgba[:] = (0, 0, 0, 128)
    out = vc.decode_image(cv2.imencode(".png", rgba)[1].tobytes())
    assert out.shape == (300, 10, 3) and abs(int(out[299, 9, 0]) - 127) <= 1


def test_memory_is_bounded_from_the_header():
    # 8000×10000 (a 334 KB PNG) is refused before decoding; a 2x export is decoded already reduced.
    bomb = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 8000, 10000) + b"\x08\x06\x00\x00\x00"
    with pytest.raises(vc.CompareError) as exc:
        vc.decode_image(bomb)
    assert exc.value.code == "too_large"
    assert vc.MAX_IMAGE_PIXELS <= 25_000_000
    assert vc._reduction(2880, 16000, 1440, vc.MAX_IMAGE_PIXELS) == 2       # read at half size, never in full
    assert vc._reduction(5800, 4000, 1440, vc.MAX_IMAGE_PIXELS) == 4
    assert vc._reduction(1440, 16000, 1440, vc.MAX_IMAGE_PIXELS) == 1
    wide = np.full((40, 2880, 4), 255, np.uint8)
    wide[:, :, :3] = (10, 120, 200)
    out = vc.decode_image(cv2.imencode(".png", wide)[1].tobytes(), target_width=1440)
    assert out.shape == (20, 1440, 3) and tuple(out[10, 700]) == (10, 120, 200)


def test_tiles_are_bounded_in_total_and_stitched_at_the_comparison_width():
    narrow = cv2.imencode(".png", np.full((3000, 360, 3), 200, np.uint8))[1].tobytes()   # 12000 tall at 1440
    with pytest.raises(vc.CompareError) as exc:
        vc.check_reference([narrow] * 3, 1440)
    assert exc.value.code == "too_large"
    top = np.full((100, 2880, 3), 10, np.uint8)
    bottom = np.full((50, 1440, 3), 240, np.uint8)
    out = vc.decode_reference([cv2.imencode(".png", top)[1].tobytes(), cv2.imencode(".png", bottom)[1].tobytes()], 1440)
    assert out.shape == (100, 1440, 3) and out[:50].mean() < 20 and out[50:].mean() > 230
    assert vc.image_info(cv2.imencode(".png", np.zeros((2, 2, 4), np.uint8))[1].tobytes())["alpha"] is True
    assert vc.image_info(cv2.imencode(".jpg", np.zeros((2, 2, 3), np.uint8))[1].tobytes())["alpha"] is False


def test_bad_design_boxes_are_skipped_not_raised():
    boxes = ["x", {"top": "nan", "height": 10}, {"top": "inf", "height": 10}, {"top": 0, "height": "1e999"},
             {"top": True, "height": 10}, {"top": 0, "height": 64, "name": "ok"}]
    assert [b["name"] for b in vc._scaled_sections(boxes, 1.0, 1000)] == ["ok"]
    assert vc.finite_number("12.5") == 12.5 and vc.finite_number("nan") is None and vc.finite_number(None) is None


def test_dominant_colour_is_the_band_background():
    band = _band(DARK, 200, "Heading", 9, ("Go",))
    col = vc.dominant_color(band)
    assert col["hex"] == "#1a1208" and col["share"] > 0.6


def test_ssim_is_one_for_identical_crops_and_lower_for_different_ones():
    a = _band(CREAM, 300, "One", 1)
    assert vc.crop_ssim(a, a.copy()) == pytest.approx(1.0)
    assert vc.crop_ssim(a, _band(CREAM, 300, "Other", 7)) < 0.95


def test_bands_are_cut_where_the_background_changes():
    page, sections = _page(DESIGN_BANDS)
    page[700:702] = (0, 0, 0)                            # a divider line is not a band
    bands = vc.segment_bands(page)
    assert [(b["top"], b["height"]) for b in bands] == [(s["top"], s["height"]) for s in sections]


def test_text_diff_normalises_case_punctuation_and_keeps_devanagari():
    missing, extra = vc.text_diff(["Enrol for ₹251 →", "शिक्षा", "Talk to us"],
                                  "ENROL FOR ₹251\nशिक्षा · 7\nFind your path\n24")
    assert missing == ["Talk to us"]
    assert extra == ["Find your path"]                   # "24" is a live count, never flagged


# ── the comparison ───────────────────────────────────────────────────────
def test_a_page_identical_to_its_design_pairs_every_section_and_passes():
    design, sections = _page(DESIGN_BANDS)
    out = vc.compare_page(design, design.copy(), page_sections=sections, design_sections=_design_sections(sections))
    assert out["overall"]["passes"] is True and out["overall"]["sections_missing"] == 0
    assert [s["section_id"] for s in out["sections"]] == [b[0] for b in DESIGN_BANDS]
    for s in out["sections"]:
        assert s["ssim"] == pytest.approx(1.0, abs=1e-3) and s["height_ratio"] == pytest.approx(1.0)
        assert s["color_delta"] == 0 and s["design_sections"] == [s["section_id"]] and not s["hints"]
    assert out["side_by_side_jpeg"][:2] == b"\xff\xd8"


def test_design_scale_and_frame_units_are_respected():
    """The design is exported at 2× (a 1440 frame as 2880 px); its section boxes are in frame units."""
    design, sections = _page(DESIGN_BANDS)
    big = cv2.resize(design, (W * 2, design.shape[0] * 2), interpolation=cv2.INTER_LINEAR)
    out = vc.compare_page(big, design, page_sections=sections, design_sections=_design_sections(sections),
                          design_width=W, with_image=False)
    assert out["overall"]["sections_paired"] == 5 and out["overall"]["sections_missing"] == 0
    assert all(s["ssim"] > 0.9 for s in out["sections"])


def test_a_missing_band_is_reported_with_its_design_node_and_the_rest_still_pair():
    design, sections = _page(DESIGN_BANDS)
    stretched = [(*b[:2], int(b[2] * 1.1), *b[3:]) if b[0] == "catalog" else b for b in DESIGN_BANDS
                 if b[0] != "courses-not-sure"]
    page, page_sections = _page(stretched)
    out = vc.compare_page(design, page, page_sections=page_sections, design_sections=_design_sections(sections),
                          with_image=False)
    assert out["overall"]["passes"] is False
    assert [m["design_section"] for m in out["missing_sections"]] == ["courses-not-sure"]
    missing = out["missing_sections"][0]
    assert missing["figma_node"] == "1:3" and missing["design_color"] == "#1a1208"
    assert "after 'catalog'" in missing["hints"][0]["suggestion"]
    paired = {s["section_id"]: s for s in out["sections"]}
    assert paired["footer-1"]["design_sections"] == ["footer-1"] and paired["footer-1"]["ssim"] > 0.95
    assert paired["catalog"]["height_ratio"] == pytest.approx(1.1, abs=0.02)


def test_missing_bands_are_found_without_design_boxes_too():
    design, _ = _page(DESIGN_BANDS)
    page, page_sections = _page([b for b in DESIGN_BANDS if b[0] != "courses-not-sure"])
    out = vc.compare_page(design, page, page_sections=page_sections, with_image=False)
    assert out["design_sections_from"] == "bands"
    assert [(m["design_top"], m["design_height"]) for m in out["missing_sections"]] == [(1324, 200)]


def test_a_section_the_design_does_not_have_is_extra():
    design, _ = _page(DESIGN_BANDS)
    bands = list(DESIGN_BANDS)
    bands.insert(3, ("promo", (40, 40, 200), 240, "SALE", 11, ()))
    page, page_sections = _page(bands)
    out = vc.compare_page(design, page, page_sections=page_sections, with_image=False)
    assert out["extra_sections"] == ["promo"]
    promo = next(s for s in out["sections"] if s["section_id"] == "promo")
    assert promo["extra"] is True and "remove it" in promo["hints"][0]["suggestion"]
    assert out["overall"]["sections_missing"] == 0


def test_a_removed_secondary_button_yields_that_hint():
    """The BV 'Not sure which course' band without its secondaryButton: the design's 'Talk to us' is missing."""
    comps = _bv_components()
    band = json.loads(json.dumps(comps["courses-not-sure"]))
    del band["props"]["secondaryButton"]
    design, sections = _page(DESIGN_BANDS)
    page, page_sections = _page([b if b[0] != "courses-not-sure" else (*b[:5], ("Find your path",))
                                 for b in DESIGN_BANDS])
    out = vc.compare_page(design, page, page_sections=page_sections, design_sections=_design_sections(sections),
                          components={"courses-not-sure": band}, with_image=False)
    cta = next(s for s in out["sections"] if s["section_id"] == "courses-not-sure")
    assert cta["missing_text"] == ["Talk to us"]
    assert cta["hints"][0]["prop_path"] == "props.secondaryButton" and "Talk to us" in cta["hints"][0]["suggestion"]
    # With the fixture's real secondaryButton the same gap is only reported as text, not as a missing prop.
    out = vc.compare_page(design, page, page_sections=page_sections, design_sections=_design_sections(sections),
                          components={"courses-not-sure": comps["courses-not-sure"]}, with_image=False)
    cta = next(s for s in out["sections"] if s["section_id"] == "courses-not-sure")
    assert all(h["prop_path"] != "props.secondaryButton" for h in cta["hints"])


def test_a_wrong_band_colour_names_the_colour_prop():
    comps = _bv_components()
    design, sections = _page(DESIGN_BANDS)
    page, page_sections = _page([b if b[0] != "courses-not-sure" else (b[0], (120, 60, 20), *b[2:])
                                 for b in DESIGN_BANDS])
    out = vc.compare_page(design, page, page_sections=page_sections, design_sections=_design_sections(sections),
                          components=comps, with_image=False)
    cta = next(s for s in out["sections"] if s["section_id"] == "courses-not-sure")
    assert cta["color_delta"] > 10 and cta["design_color"] == "#1a1208"
    hint = next(h for h in cta["hints"] if h["prop_path"] == "props.backgroundColor")
    assert "#1a1208" in hint["suggestion"]


def test_page_level_design_texts_are_checked_across_the_whole_page():
    design, sections = _page(DESIGN_BANDS)
    out = vc.compare_page(design, design, page_sections=sections, design_texts=["Stay connected", "Become a member"],
                          with_image=False)
    assert out["page_missing_text"] == ["Become a member"]


def test_an_unmeasured_header_or_footer_bar_is_not_a_missing_section():
    design, sections = _page(DESIGN_BANDS)
    body = [s for s in sections if s["id"] not in ("header-1", "footer-1")]
    out = vc.compare_page(design, design, page_sections=body, design_sections=_design_sections(sections),
                          with_image=False)
    assert sorted(m["design_section"] for m in out["missing_sections"]) == ["footer-1", "header-1"]
    out = vc.compare_page(design, design, page_sections=body, design_sections=_design_sections(sections),
                          chrome={"header": True, "footer": True}, with_image=False)
    assert out["missing_sections"] == [] and out["overall"]["passes"] is True
    assert [(b["design_section"], b["matched_by"]) for b in out["chrome_bands"]] == [
        ("header-1", "header"), ("footer-1", "footer")]


def test_bands_below_a_truncated_capture_are_not_called_missing():
    design, sections = _page(DESIGN_BANDS)
    cut = sections[3]["top"]                                   # the capture stops before the CTA band
    page = design[:cut]
    out = vc.compare_page(design, page, page_sections=sections[:3], design_sections=_design_sections(sections),
                          truncated=True, with_image=False)
    assert out["missing_sections"] == [] and out["overall"]["complete"] is False
    assert [b["design_section"] for b in out["beyond_capture"]] == ["courses-not-sure", "footer-1"]
    assert out["overall"]["passes"] is False


def test_compare_results_feed_the_reference_fidelity_audit():
    from app.services.page_audit import audit_reference_fidelity
    design, sections = _page(DESIGN_BANDS)
    page, page_sections = _page([b for b in DESIGN_BANDS if b[0] != "courses-not-sure"])
    report = vc.compare_page(design, page, page_sections=page_sections, design_sections=_design_sections(sections),
                             with_image=False)
    issues = audit_reference_fidelity({"components": []}, {}, {}, compare=report)
    assert [(i["code"], i["severity"]) for i in issues][:1] == [("reference-section-missing", "fix")]
    assert "courses-not-sure" in issues[0]["message"]
    assert audit_reference_fidelity({"components": []}, {}, {}) == []      # unchanged without a compare


# ── the real Brahm Varchas Figma renders (local only) ─────────────────────
BV_FIG_DIR = os.environ.get("FIGMA_BV_FIG_DIR")
# Courses frame children (Figma frame units, 1440 wide), from page1.xml.
BV_COURSES = [("1:37", "Header", 0, 65), ("1:69", "Hero + Search", 65, 361), ("1:101", "Stream tabs (sticky)", 426, 142),
              ("1:135", "Main", 568, 2663), ("1:435", "Help band", 3231, 194), ("1:444", "Footer", 3425, 783.12)]


@pytest.mark.skipif(not BV_FIG_DIR, reason="set FIGMA_BV_FIG_DIR to the Brahm Varchas frame renders (c0..c5.png)")
def test_brahm_varchas_courses_frame_against_itself_and_with_the_help_band_cut():
    tiles = [vc.decode_image((Path(BV_FIG_DIR) / f"c{i}.png").read_bytes()) for i in range(6)]
    design = vc.stitch_vertical(tiles)                       # 1600 wide: the 1440 frame at 10/9
    page = vc.resize_to_width(design, 1440)
    boxes = [{"id": i, "name": n, "top": t, "height": h} for i, n, t, h in BV_COURSES]
    dom = [{"id": "header-1", "top": 0, "height": 65}, {"id": "courses-catalog", "top": 65, "height": 3166},
           {"id": "courses-not-sure", "top": 3231, "height": 194}, {"id": "footer-1", "top": 3425, "height": 783}]
    out = vc.compare_page(design, page, page_sections=dom, design_sections=boxes, design_width=1440, with_image=False)
    assert out["overall"]["passes"] is True
    assert next(s for s in out["sections"] if s["section_id"] == "courses-catalog")["design_sections"] == [
        "Hero + Search", "Stream tabs (sticky)", "Main"]
    cut = np.vstack([page[:3231], page[3425:]])
    dom_cut = [dom[0], dom[1], {"id": "footer-1", "top": 3231, "height": 783}]
    out = vc.compare_page(design, cut, page_sections=dom_cut, design_sections=boxes, design_width=1440, with_image=False)
    assert [m["figma_node"] for m in out["missing_sections"]] == ["1:435"]
    assert all(s["ssim"] > 0.95 for s in out["sections"])
