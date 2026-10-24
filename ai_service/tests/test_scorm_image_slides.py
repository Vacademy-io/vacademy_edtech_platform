"""SCORM packages whose slides are drawn as images (iSpring Suite exports):
free text first, paid OCR per image slide for course knowledge and Tutor Mode.

Offline: the package files are generated in memory (small Pillow PNGs) and
served through a faked fetch_https; MathPix and the vision model are faked;
course_extract_cache is an in-memory stand-in.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import sys
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from app.services.course_knowledge import coverage, flags  # noqa: E402
from app.services.course_knowledge.extract import cache, ispring, scorm  # noqa: E402
from app.services.course_knowledge.extract import extract  # noqa: E402
from app.services.course_knowledge.extract.types import (  # noqa: E402
    SCORM_EXTRACTOR_VERSION, PaidPermit, SlideRef, TOOL_OCR_PAGE,
)
from app.services.course_knowledge.settings_store import CourseKnowledgeSetting  # noqa: E402
from app.services.tutor import compile_estimate, slide_source, source_text  # noqa: E402
from app.services.tutor.slide_source import SlideSource  # noqa: E402

INST = "inst-scorm"
ROOT = "https://cdn.example.com/scorm/pkg-1/"
POINTER = "scorm-file-1"


def run(coro):
    return asyncio.run(coro)


# ── generated package ────────────────────────────────────────────────────────

def png(size, color=None, gradient=False) -> bytes:
    img = Image.new("RGBA", size, color or (255, 255, 255, 0))
    if gradient:
        px = img.load()
        for x in range(size[0]):
            for y in range(size[1]):
                px[x, y] = ((x * 7) % 256, (y * 11) % 256, ((x + y) * 5) % 256, 255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def slide_js(n: int, markup: str) -> bytes:
    escaped = markup.replace("\\", "\\\\").replace("'", "\\'")
    return (f"(function(){{var loadHandler=window['sl_{{X}}'];loadHandler&&loadHandler({n - 1}, "
            f"'{escaped}', '{{\"s\":[]}}');}})();").encode()


SLIDE1 = ('<div id="spr0"><div class="kern slide"><img src="data/img0.png" width="960px" height="540px" alt="" '
          'style="left:0px;top:0px;"/></div><div class="kern slide"><div style="left:75px;top:17px;">'
          '<div style="width:0px;"><span class="relpos">RAJASW</span> <span class="relpos">ALA PARICHARYA</span></div>'
          '<div style="width:0px;"><span>Unit I: Introduction to Rajaswala Paricharya, essential diet and lifestyle'
          '</span></div></div></div></div>')
# No text of its own: a flat background and a picture with many colours (text drawn as pixels).
SLIDE2 = ('<div id="spr0"><div class="kern slide"><img src="data/img0.png" width="960px" height="540px" alt="" '
          'style="left:0px;top:0px;"/><div style="top:100px;"><img src="data/img1.png" width="400" height="120" '
          'alt="" style="left:200px;top:10px;"/></div></div></div>')
# Only a flat background (an embedded web object): nothing to read.
SLIDE3 = ('<div id="spr0"><div class="kern slide"><img src="data/img0.png" width="960px" height="540px" alt="" '
          'style="left:0px;top:0px;"/></div><div class="kern slide"><div id="wo_1_0"></div></div></div>')


def package(slides=(SLIDE1, SLIDE2, SLIDE3)) -> dict:
    files = {"res/data/img0.png": png((96, 54), (230, 120, 60, 255)),
             "res/data/img1.png": png((80, 24), gradient=True),
             "res/index.html": b"<html><head><title>LM4</title></head><body>Page Not Available. "
                               b"This browser is not supported.</body></html>"}
    for i, markup in enumerate(slides, start=1):
        files[f"res/data/slide{i}.js"] = slide_js(i, markup)
    manifest = "".join(f'<file href="{k}"/>' for k in files)
    files["imsmanifest.xml"] = (f'<manifest><resources><resource href="res/index.html">{manifest}'
                                f'</resource></resources></manifest>').encode()
    return files


class FakeCache:
    def __init__(self):
        self.rows = {}

    def get(self, kind, key):
        for tier in ("PAID", "FREE"):
            if (kind, key, tier) in self.rows:
                segs, probe = self.rows[(kind, key, tier)]
                return cache.CacheHit(tier=tier, segments=list(segs), probe=dict(probe))
        return None

    def put(self, kind, key, tier, segments, probe=None):
        self.rows[(kind, key, tier)] = (list(segments), dict(probe or {}))
        return True


class FakeMathpix:
    calls: list = []
    fail = False

    async def ocr_image_base64(self, data, mime="image/png"):
        FakeMathpix.calls.append((data, mime))
        if FakeMathpix.fail:
            return {"error": "boom", "latex": "", "text": ""}
        return {"latex": "", "text": "रजस्वला परिचर्या क्या है? What is menstrual care"}


@pytest.fixture
def world(monkeypatch):
    fc = FakeCache()
    monkeypatch.setattr(cache, "get", fc.get)
    monkeypatch.setattr(cache, "put", fc.put)
    files = package()
    fetched = []

    async def fake_fetch(url, *, max_bytes, timeout=10.0, allow_prefix=None):
        assert allow_prefix == ROOT
        fetched.append(url)
        data = files.get(url[len(ROOT):]) if url.startswith(ROOT) else None
        return data if data is not None and len(data) <= max_bytes else None

    monkeypatch.setattr(scorm, "fetch_https", fake_fetch)
    import app.services.mathpix_service as ms
    FakeMathpix.calls, FakeMathpix.fail = [], False
    monkeypatch.setattr(ms, "MathpixService", FakeMathpix)
    monkeypatch.setattr(flags, "scorm_ocr_engine", lambda: "mathpix")
    return SimpleNamespace(cache=fc, files=files, fetched=fetched)


def ref() -> SlideRef:
    return SlideRef(slide_id="slide-1", title="LM4 Exerting during menstruation", description="", status="PUBLISHED",
                    source_type="SCORM", doc_type=None, pointer_kind="scorm", pointer_key=POINTER,
                    extras={"launch_url": ROOT + "res/index.html", "launch_path": "res/index.html", "text_kind": "scorm"})


def content(ext):
    assert ext.segments and ext.segments[0].anchor == "none"
    return ext.segments[1:]


KEY = f"v{SCORM_EXTRACTOR_VERSION}:{POINTER}"


# ── iSpring parsing and composition ──────────────────────────────────────────

def test_slide_markup_unescapes_the_js_string():
    js = r"""loadHandler(3, '<span>It\'s रज done\\</span>', '{}');"""
    assert ispring.slide_markup(js) == "<span>It's रज done\\</span>"
    assert ispring.slide_markup("var x = 1;") is None


def test_parse_slide_positions_nest_and_spans_join():
    lay = ispring.parse_slide(
        '<div style="left:10px;top:20px;"><img src="data/a.png" width="30" height="40" style="left:5px;top:6px;"/>'
        '<div id="svg1" style="left:100px;top:0px;"><svg width="50" height="60"><path fill="#d3d3d3" d="M0"/></svg>'
        '</div><div style="width:0px;"><span>Dr Acharya</span> <span>,</span></div>'
        '<div style="width:0px;"><span>- </span> <span>Essential diet</span></div></div>')
    img, fill = lay.ops
    assert (img.src, img.x, img.y, img.w, img.h) == ("data/a.png", 15.0, 26.0, 30.0, 40.0)
    assert (fill.x, fill.y, fill.w, fill.h, fill.color) == (110.0, 20.0, 50.0, 60.0, (211, 211, 211))
    assert lay.text == "Dr Acharya,\n- Essential diet"


def test_compose_paints_images_at_their_boxes_in_document_order():
    red, blue = png((10, 10), (255, 0, 0, 255)), png((10, 10), (0, 0, 255, 255))
    lay = ispring.SlideLayout(ops=[
        ispring.ImageOp("r.png", 10, 20, 30, 30),
        ispring.ImageOp("b.png", 30, 40, 30, 30),          # overlaps red: drawn on top
        ispring.FillOp(500, 300, 20, 20, (0, 128, 0)),
        ispring.ImageOp("missing.png", 0, 0, 5, 5),
    ])
    data, mime, painted = ispring.compose_slide(lay, {"r.png": red, "b.png": blue}, scale=1)
    assert mime == "image/png" and painted == 2
    img = Image.open(io.BytesIO(data)).convert("RGB")
    assert img.size == ispring.CANVAS
    assert img.getpixel((15, 25)) == (255, 0, 0)
    assert img.getpixel((35, 45)) == (0, 0, 255)
    assert img.getpixel((505, 305)) == (0, 128, 0)
    assert img.getpixel((5, 5)) == (255, 255, 255)
    assert ispring.compose_slide(ispring.SlideLayout(), {})[0] is None


def test_flat_images_carry_no_text():
    assert ispring.is_flat(png((96, 54), (230, 120, 60, 255)))
    assert ispring.is_flat(png((40, 40)))                       # fully transparent
    assert not ispring.is_flat(png((80, 24), gradient=True))
    assert ispring.is_flat(b"not an image")


def test_ispring_page_sections_are_free_text():
    def chars(s):
        return [{"t": c} for c in s]
    data = {"content": {"c": {"o": ["b", "a"], "B": {
        "a": {"h": {"t": "Summary | सार", "s": " "}, "cs": {"b": {"o": ["x"], "B": {"x": {"c": chars("Rest well.")}}}}},
        "b": {"h": {"t": "", "s": ""}, "cs": {"b": {"o": ["y", "z"], "B": {
            "z": {"c": chars("आहार और विहार")}, "y": {"c": chars("Diet and routine")},
            "img": {"atl": {"c": chars("0b6585e6")}}}}}},
    }}}}
    segs = ispring.page_sections(data)
    assert [(s.label, s.text) for s in segs] == [
        ("Section 1", "Diet and routine\nआहार और विहार"), ("Summary | सार", "Summary | सार\nRest well.")]


# ── course knowledge: free pass ──────────────────────────────────────────────

def test_free_pass_reports_image_slides_as_needs_paid(world):
    ext = run(extract(ref()))
    assert ext.status == "NEEDS_PAID" and not FakeMathpix.calls
    need = ext.paid_need
    assert (need.kind, need.tool_key, need.unit_field, need.units) == ("deck_images", TOOL_OCR_PAGE, "pages", 1)
    # The need pointer is the cache key: meta.paid, coverage and the tutor find the paid text by it.
    assert (need.pointer_kind, need.pointer_key) == ("scorm", KEY)
    assert ext.note == "Slides are images: 1 slide needs reading"
    # Slide 1's own text is free and already searchable, cited as Slide 1.
    slide1 = [s for s in content(ext) if s.anchor == "step"]
    assert [(s.step, s.label) for s in slide1] == [(1, "Slide 1")]
    assert slide1[0].text.startswith("RAJASWALA PARICHARYA\nUnit I")
    # The unsupported-browser launch page is not lesson text.
    assert not any("browser" in s.text.lower() for s in content(ext))
    probe = world.cache.rows[("scorm", KEY, "FREE")][1]
    assert probe["ocr_slides"] == [2] and probe["slides"] == 3
    # Remembered: the next free pass reads nothing over the network.
    world.fetched.clear()
    again = run(extract(ref()))
    assert again.status == "NEEDS_PAID" and again.paid_need.units == 1 and not world.fetched


def test_package_with_text_in_its_slides_is_ready_for_free(world):
    world.files.update(package(slides=(SLIDE1, SLIDE3)))
    for k in ("res/data/slide3.js",):
        world.files.pop(k, None)
    world.files["res/data/slide1.js"] = slide_js(1, SLIDE1.replace("lifestyle", "lifestyle " + "and rest " * 20))
    ext = run(extract(ref()))
    assert ext.status == "READY" and ext.paid_need is None and not FakeMathpix.calls


def test_package_without_recoverable_slides_stays_empty(world):
    world.files.clear()
    world.files.update({"imsmanifest.xml": b'<manifest><resource href="index.html"/></manifest>',
                        "index.html": b"<html><body><div id='app'></div><script>x()</script></body></html>"})
    r = ref()
    r.extras = {"launch_url": ROOT + "index.html"}
    ext = run(extract(r))
    assert ext.status == "EMPTY" and ext.note == scorm.SCRIPTED_NOTE and ext.paid_need is None


# ── course knowledge: paid pass ──────────────────────────────────────────────

def test_paid_pass_reads_each_image_slide_once_and_caches_paid(world):
    ext = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units={"deck_images": 1})))
    assert ext.status == "READY" and len(FakeMathpix.calls) == 1
    data, mime = FakeMathpix.calls[0]
    picture = Image.open(io.BytesIO(base64.b64decode(data)))
    assert mime == "image/png" and picture.size == (960 * 2, 540 * 2)   # one composed picture at 2x
    steps = {s.step: s for s in content(ext) if s.anchor == "step"}
    assert sorted(steps) == [1, 2] and steps[2].label == "Slide 2"
    assert "रजस्वला परिचर्या" in steps[2].text
    d = ext.paid_delivered
    assert (d.tool_key, d.unit_field, d.units, d.model) == (TOOL_OCR_PAGE, "pages", 1, "mathpix")
    assert d.idempotency_key == f"course_kb_imgocr:{INST}:{scorm.billing_key(KEY)}" and INST in d.idempotency_key
    assert d.provider_cost_usd > 0
    assert ("scorm", KEY, "PAID") in world.cache.rows and ext.detail.get("scorm_ocr") is True


def test_permit_caps_the_slides_read(world):
    over = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units={"deck_images": 0})))
    assert over.status == "NEEDS_PAID" and not FakeMathpix.calls and over.paid_delivered is None
    world.files["res/data/slide3.js"] = slide_js(3, SLIDE2)          # now two image slides
    world.cache.rows.clear()
    capped = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))
    assert capped.status == "NEEDS_PAID" and capped.note == scorm.OVER_APPROVED_NOTE
    assert capped.paid_need.units == 2 and not FakeMathpix.calls
    no_ocr = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, allow_ocr=False, max_units=5)))
    assert no_ocr.status == "NEEDS_PAID" and not FakeMathpix.calls


def test_paid_cache_hit_costs_nothing(world):
    run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))
    FakeMathpix.calls.clear()
    world.fetched.clear()
    hit = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))
    assert hit.status == "READY" and hit.paid_delivered is None and not FakeMathpix.calls and not world.fetched
    free = run(extract(ref()))
    assert free.status == "READY" and free.paid_need is None


def test_failed_reads_are_never_delivered(world):
    FakeMathpix.fail = True
    ext = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))
    assert ext.status == "FAILED" and ext.paid_delivered is None
    assert ("scorm", KEY, "PAID") not in world.cache.rows
    # The free text survives for the index.
    assert any(s.anchor == "step" and s.step == 1 for s in ext.segments)


def test_vision_engine_reads_with_the_vision_model(world, monkeypatch):
    monkeypatch.setattr(flags, "scorm_ocr_engine", lambda: "vision")
    monkeypatch.setattr(source_text, "_openrouter_key", lambda inst, user: "sk-test")
    seen = {}

    class FakeLLM:
        def __init__(self, resolver, **kw):
            seen["keys"] = resolver.resolve_keys(institute_id=INST)

        async def chat_completion(self, messages, **kw):
            seen["model"], seen["att"] = kw.get("model"), messages[0]["attachments"][0]["url"][:22]
            return {"content": "```\nपथ्य आहार\n```"}

        async def close(self):
            seen["closed"] = True

    import app.services.chat_llm_client as clc
    monkeypatch.setattr(clc, "ChatLLMClient", FakeLLM)
    ext = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))
    assert ext.status == "READY" and not FakeMathpix.calls
    assert seen["model"] == scorm.VISION_MODEL and seen["att"] == "data:image/png;base64," and seen["closed"]
    assert ext.paid_delivered.model == f"vision:{scorm.VISION_MODEL}"
    assert any(s.step == 2 and s.text == "पथ्य आहार" for s in content(ext))


def test_extractor_version_bump_reindexes_scorm_lessons(world):
    assert SCORM_EXTRACTOR_VERSION == 3
    # An old v2 EMPTY verdict is never read: the v3 key differs, so the lesson re-extracts.
    world.cache.rows[("scorm", f"v2:{POINTER}", "FREE")] = ([], {"pages": 1})
    assert scorm.cache_key(ref()) == KEY
    assert run(extract(ref())).status == "NEEDS_PAID"


def test_coverage_quotes_image_slides_with_credits(monkeypatch):
    lesson = coverage.LessonCoverage(slide_id="s1", title="LM4", chapter_id="c", chapter_name="C", source_type="SCORM",
                                     doc_type=None, state=coverage.STATE_NEEDS_PROCESSING,
                                     reason=scorm.image_slides_note(12), units=12, kind="deck_images",
                                     tool_key=TOOL_OCR_PAGE, pointer=("scorm", KEY))
    monkeypatch.setattr(coverage, "_paid_cached", lambda db, pointers: set())

    class Est:
        def credits(self, tool, units):
            assert (tool, units) == (TOOL_OCR_PAGE, 12)
            return Decimal("6")

    quote = coverage._quote(None, [lesson], CourseKnowledgeSetting(enabled=True), Est())
    assert quote.credits == Decimal("6") and [(l.kind, l.units) for l in quote.lines] == [("deck_images", 12)]
    assert lesson.to_dict()["reason"] == "Slides are images: 12 slides need reading (≈ 6 credits)"
    assert lesson.to_dict()["state"] == "NEEDS_PROCESSING" and lesson.to_dict()["units"] == 12
    # Paid text already cached (by the tutor or another lesson): 0.
    lesson2 = coverage.LessonCoverage(slide_id="s2", title="LM4", chapter_id="c", chapter_name="C",
                                      source_type="SCORM", doc_type=None, state=coverage.STATE_NEEDS_PROCESSING,
                                      units=12, kind="deck_images", tool_key=TOOL_OCR_PAGE, pointer=("scorm", KEY))
    monkeypatch.setattr(coverage, "_paid_cached", lambda db, pointers: {("scorm", KEY)})
    assert coverage._quote(None, [lesson2], CourseKnowledgeSetting(enabled=True), Est()).credits == 0
    assert lesson2.reason == coverage.ALREADY_PROCESSED_REASON


# ── Tutor Mode ───────────────────────────────────────────────────────────────

def tutor_src(**kw) -> SlideSource:
    base = dict(slide_id="slide-1", title="LM4", source_type="SCORM", source_id="sc1", kind="scorm",
                scorm_launch_url=ROOT + "res/index.html", scorm_launch_path="res/index.html",
                scorm_pointer=POINTER, content_hash="h-scorm")
    base.update(kw)
    return SlideSource(**base)


def test_loader_reads_the_published_scorm_package():
    class Db:
        def execute(self, stmt, params):
            assert "scorm_slide" in str(stmt) and params == {"id": "sc1"}
            return SimpleNamespace(first=lambda: (ROOT + "res/index.html", "res/index.html", POINTER))

    src = SlideSource(slide_id="s", title="LM4", source_type="SCORM", source_id="sc1", kind="other")
    slide_source._scorm(Db(), src, "sc1")
    assert (src.kind, src.scorm_pointer, src.scorm_launch_path) == ("scorm", POINTER, "res/index.html")
    assert slide_source.source_kind_label(src) == "scorm"
    assert source_text.expected_text_kind(src) == "scorm"
    other = SlideSource(slide_id="s", title="LM4", source_type="SCORM", source_id="sc1", kind="other")
    slide_source._scorm(SimpleNamespace(execute=lambda s, p: SimpleNamespace(
        first=lambda: (ROOT + "res/index.html", "res/index.html", "scorm-file-2"))), other, "sc1")
    assert other.content_hash != src.content_hash              # a new package is a new hash


def test_tutor_hash_changes_with_the_text_kind():
    src = tutor_src()
    free, ocr = source_text.hash_for(src, "scorm"), source_text.hash_for(src, "scorm_ocr")
    assert free != ocr and free != src.content_hash and source_text.hash_for(src, None) == "h-scorm"
    assert source_text.hash_for(tutor_src(scorm_pointer="other"), "scorm") != free


def test_tutor_free_text_reports_image_slides(world):
    src = tutor_src()
    run(source_text.resolve_free_text(src))
    assert src.ocr_units == 1 and src.text_kind == "scorm" and "Slide 1:\nRAJASWALA PARICHARYA" in src.text
    assert "drawn as images" in (src.text_note or "") and not FakeMathpix.calls


def _billing(monkeypatch):
    calls = []
    monkeypatch.setattr(source_text, "record_tool_billing", lambda **kw: calls.append(kw))
    return calls


def test_tutor_ocr_charges_like_pdf_pages_and_shares_the_cache(world, monkeypatch):
    calls = _billing(monkeypatch)
    src = tutor_src()
    run(source_text.resolve_free_text(src))
    slides = run(source_text.ocr_scorm(src, institute_id=INST, user_id="u1", request_id="run-1"))
    assert slides == 1 and len(FakeMathpix.calls) == 1 and src.text_kind == "scorm_ocr" and src.ocr_units == 0
    assert "Slide 2:\nरजस्वला परिचर्या" in src.text
    (kw,) = calls
    assert kw["tool_key"] == source_text.OCR_TOOL and kw["tool_params"] == {"num_pages": 1}
    assert kw["idempotency_key"] == f"tutor_scorm_ocr:{INST}:{scorm.billing_key(KEY)}"
    # Course knowledge now reads the tutor's text for free: no OCR, nothing delivered to charge.
    FakeMathpix.calls.clear()
    ck = run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))
    assert ck.status == "READY" and ck.paid_delivered is None and not FakeMathpix.calls


def test_tutor_uses_the_course_knowledge_paid_cache_without_charging(world, monkeypatch):
    run(extract(ref(), paid_permit=PaidPermit(institute_id=INST, max_units=1)))   # course knowledge paid
    FakeMathpix.calls.clear()
    calls = _billing(monkeypatch)
    src = tutor_src()
    run(source_text.resolve_free_text(src))
    assert src.text_kind == "scorm_ocr" and src.ocr_units == 0 and "रजस्वला" in src.text
    assert run(source_text.ocr_scorm(src, institute_id=INST, user_id="u1", request_id="r")) == 0
    assert not calls and not FakeMathpix.calls


def test_tutor_ocr_failure_is_not_charged(world, monkeypatch):
    calls = _billing(monkeypatch)
    FakeMathpix.fail = True
    src = tutor_src()
    with pytest.raises(RuntimeError):
        run(source_text.ocr_scorm(src, institute_id=INST, user_id="u1", request_id="r"))
    assert not calls


class _Est:
    def __init__(self, db):
        pass

    def estimate(self, key, params):
        return {"tutor_compile_slide": {"estimated_credits": 2}, "tutor_media_image": {"estimated_credits": 1},
                "tutor_voice_prepare": {"estimated_credits": 0}}.get(
            key, {"estimated_credits": 0.5 * float(params.get("num_pages") or params.get("audio_minutes") or 0)})

    def estimate_with_balance(self, key, params, institute_id):
        return {"current_balance": 100}


def test_estimate_includes_scorm_ocr_slides(monkeypatch):
    sources = {k: tutor_src(slide_id=k, scorm_pointer=k) for k in ("img", "paid", "fresh", "free", "blank")}
    cached = {"img": {"paid": False, "ocr_units": 7, "has_text": True},
              "paid": {"paid": True, "ocr_units": 0, "has_text": True},
              "free": {"paid": False, "ocr_units": 0, "has_text": True},
              "blank": {"paid": False, "ocr_units": 3, "has_text": False}}
    monkeypatch.setattr(compile_estimate, "load_slide_source", lambda db, sid: sources.get(sid))
    monkeypatch.setattr(compile_estimate.plan_store, "latest_plans_for_slides", lambda db, ids: {})
    monkeypatch.setattr(compile_estimate, "ToolCostEstimator", _Est)
    monkeypatch.setattr(source_text, "scorm_cached", lambda src: cached.get(src.slide_id))
    monkeypatch.setattr(source_text, "scorm_ocr_available", lambda: True)
    monkeypatch.setattr(source_text, "ocr_available", lambda: True)
    out = compile_estimate.estimate_compile(None, institute_id=INST, slide_ids=list(sources), language="en",
                                            generate_images=False, transcribe_videos=False, ocr_pdfs=True,
                                            force=False, voice_provider="edge")
    by = {r["slide_id"]: r for r in out["slides"]}
    assert by["img"]["kind"] == "scorm" and by["img"]["pages"] == 7 and by["img"]["ocr"] == 3.5
    assert by["img"]["total"] == 5.5 and by["img"]["text"] == "scorm_ocr"
    assert by["paid"]["ocr"] == 0 and by["paid"]["text"] == "scorm_ocr" and "already" in by["paid"]["note"]
    assert by["fresh"]["ocr"] == 0 and by["fresh"]["action"] == "compile" and "OCR" in by["fresh"]["note"]
    assert by["free"]["ocr"] == 0 and by["free"]["total"] == 2
    assert by["blank"]["pages"] == 3
    assert out["totals"]["ocr_pages"] == 10 and out["totals"]["ocr_credits"] == 5.0
    off = compile_estimate.estimate_compile(None, institute_id=INST, slide_ids=["img", "blank"], language="en",
                                            generate_images=False, transcribe_videos=False, ocr_pdfs=False,
                                            force=False, voice_provider="edge")
    by_off = {r["slide_id"]: r for r in off["slides"]}
    assert by_off["img"]["ocr"] == 0 and by_off["img"]["action"] == "compile"      # its own text, image slides skipped
    assert by_off["blank"]["action"] == "needs_details"


class _Stop(Exception):
    pass


def _compiler(ocr_scorm=True):
    from app.services.tutor.plan_compiler import PlanCompiler
    c = PlanCompiler.__new__(PlanCompiler)
    c.institute_id, c.user_id, c.compile_run_id, c.metering = INST, "u1", "run-1", None
    c.ocr_scorm, c.ocr_pdfs, c.transcribe_videos = ocr_scorm, False, False
    c.kb_grounding, c.teacher_name, c.language, c.generate_images = None, "Asha", "en", False
    return c


def test_compile_reads_image_slides_once_then_teaches_the_package_text(world, monkeypatch):
    from app.services.tutor import plan_compiler
    calls = _billing(monkeypatch)
    seen = {}

    async def stop_at_model(messages, run):
        seen["user"] = messages[-1]["content"]
        raise _Stop

    src = tutor_src()
    run(source_text.resolve_free_text(src))
    compiler = _compiler()
    monkeypatch.setattr(compiler, "_chat", stop_at_model)
    r = plan_compiler._Run()
    with pytest.raises(_Stop):
        run(compiler._build_draft(src, None, r))
    assert r.ocr_pages == 1 and len(calls) == 1 and len(FakeMathpix.calls) == 1
    assert "SCORM package" in seen["user"] and "रजस्वला परिचर्या" in seen["user"] and "RAJASWALA" in seen["user"]
    # A second prepare of the same package (another lesson, a recompile) reads the shared cache: no OCR, no charge.
    src2 = tutor_src(slide_id="slide-2")
    run(source_text.resolve_free_text(src2))
    assert src2.ocr_units == 0 and src2.text_kind == "scorm_ocr"
    r2 = plan_compiler._Run()
    monkeypatch.setattr(compiler, "_chat", stop_at_model)
    with pytest.raises(_Stop):
        run(compiler._build_draft(src2, None, r2))
    assert r2.ocr_pages == 0 and len(calls) == 1 and len(FakeMathpix.calls) == 1


def test_compile_with_ocr_off_teaches_the_free_text_only(world, monkeypatch):
    from app.services.tutor import plan_compiler
    calls = _billing(monkeypatch)

    async def stop_at_model(messages, run):
        raise _Stop

    src = tutor_src()
    run(source_text.resolve_free_text(src))
    compiler = _compiler(ocr_scorm=False)
    monkeypatch.setattr(compiler, "_chat", stop_at_model)
    r = plan_compiler._Run()
    with pytest.raises(_Stop):
        run(compiler._build_draft(src, None, r))
    assert r.ocr_pages == 0 and not calls and not FakeMathpix.calls
