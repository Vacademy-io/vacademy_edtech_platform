"""Course knowledge extractor registry (CK-05).

Offline: HTTP, MathPix, OpenRouter, YouTube and the render worker are faked.
Most tests use an in-memory stand-in for course_extract_cache and the tutor
caches; the tests that read real lesson rows (describe_slides), the real
cache table and the tutor's file_conversion rows run against a scratch
Postgres (course_knowledge_pg_helpers) and are skipped unless
AI_LIMITS_PG_URL / AI_LIMITS_PGDATA is set.
"""
from __future__ import annotations

import asyncio
import json
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services import openrouter_transcription as ort  # noqa: E402
from app.services.course_knowledge.extract import (  # noqa: E402
    EXTRACTOR_VERSION, PaidPermit, Segment, SlideRef, describe_slides, extract,
)
from app.services.course_knowledge.extract import cache, deck, describe, documents, media, pdf, scorm  # noqa: E402
from app.services.course_knowledge.extract.types import PaidNeed  # noqa: E402
from app.services.kb import parsing  # noqa: E402
from app.services.tutor import source_text  # noqa: E402
from app.services.youtube_captions import service as yt_service  # noqa: E402
from app.services.youtube_captions.types import (  # noqa: E402
    NOTES, CaptionResult, CaptionSegment, CaptionsError, Outcome, note_for,
)

INST = "inst-ck05"


def run(coro):
    return asyncio.run(coro)


def _id() -> str:
    return str(uuid.uuid4())


def ref_of(**kw) -> SlideRef:
    base = dict(slide_id=_id(), title="Heat engines", description="Carnot cycle basics", status="PUBLISHED",
                source_type="DOCUMENT", doc_type="PDF", pointer_kind="file", pointer_key=_id())
    base.update(kw)
    return SlideRef(**base)


def content(ext):
    """Segments after the title-plus-description segment."""
    assert ext.segments and ext.segments[0].anchor == "none"
    return ext.segments[1:]


# ── in-memory caches ─────────────────────────────────────────────────────────

class FakeCache:
    def __init__(self):
        self.rows = {}            # (kind, key, tier) -> (segments, probe)
        self.tutor = {}           # (vendor, key) -> text
        self.stored = []          # tutor write-backs

    def get(self, kind, key):
        for tier in ("PAID", "FREE"):
            if (kind, key, tier) in self.rows:
                segs, probe = self.rows[(kind, key, tier)]
                return cache.CacheHit(tier=tier, segments=list(segs), probe=dict(probe))
        return None

    def put(self, kind, key, tier, segments, probe=None):
        self.rows[(kind, key, tier)] = (list(segments), dict(probe or {}))
        return True


@pytest.fixture
def fc(monkeypatch):
    f = FakeCache()
    monkeypatch.setattr(cache, "get", f.get)
    monkeypatch.setattr(cache, "put", f.put)
    monkeypatch.setattr(cache, "tutor_transcript", lambda k: f.tutor.get(("transcript", k)))
    monkeypatch.setattr(cache, "tutor_pdf_ocr", lambda k: f.tutor.get(("pdf_ocr", k)))
    monkeypatch.setattr(cache, "tutor_youtube_captions", lambda k: f.tutor.get(("captions", k)))
    monkeypatch.setattr(cache, "tutor_ai_video_script", lambda k: f.tutor.get(("script", k)))
    monkeypatch.setattr(cache, "store_tutor_transcript", lambda k, b: f.stored.append(("transcript", k, b)))
    monkeypatch.setattr(cache, "store_tutor_pdf_ocr", lambda k, b: f.stored.append(("pdf_ocr", k, b)))
    return f


def _pdf_bytes(pages):
    """A real PDF: True = a page with a text layer, False = a blank (scanned-looking) page."""
    import fitz
    doc = fitz.open()
    for i, has_text in enumerate(pages, start=1):
        page = doc.new_page()
        if has_text:
            body = f"Page {i}: the second law of thermodynamics limits every heat engine. " * 6
            page.insert_textbox(fitz.Rect(40, 40, 560, 800), body, fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def pdf_file(monkeypatch):
    """Serve one PDF for every download; counts downloads."""
    state = {"data": _pdf_bytes([True, False, True]), "downloads": 0}

    async def fake_download(ref):
        state["downloads"] += 1
        return state["data"], None

    monkeypatch.setattr(pdf, "_download", fake_download)
    return state


# ── PDF: free text pages, paid scanned pages ─────────────────────────────────

def test_partially_scanned_pdf_needs_paid_with_text_pages(fc, pdf_file):
    ref = ref_of()
    ext = run(extract(ref))
    assert ext.status == "NEEDS_PAID"
    assert ext.paid_need.kind == "ocr_pages" and ext.paid_need.units == 1 and not ext.paid_need.approx
    assert ext.paid_need.tool_key == "course_kb_ocr_page" and ext.paid_need.tool_params == {"num_pages": 1}
    pages = [s.page for s in content(ext)]
    assert pages == [1, 3] and all(s.anchor == "page" for s in content(ext))
    assert ext.paid_delivered is None
    assert ext.segments[0].text == "Heat engines\nCarnot cycle basics"
    _segs, probe = fc.rows[("file", ref.pointer_key, "FREE")]
    assert probe["pages"] == 3 and probe["scanned_pages"] == 1 and probe["scanned_page_numbers"] == [2]
    # A second extract is served from the FREE cache: no download.
    again = run(extract(ref))
    assert again.status == "NEEDS_PAID" and pdf_file["downloads"] == 1


def test_pdf_ocr_with_permit_merges_caches_and_reports_delivery(fc, pdf_file, monkeypatch):
    ref = ref_of()

    async def fake_parse_pdf(data, *, extract_figures=True):
        assert extract_figures is False
        ex = parsing._extract_sync(data, False)
        for p in ex.pages:
            if p.parser == "mathpix":
                p.text = "OCR text of the scanned page"
        return parsing.ParsedDocument(pages=ex.pages, parser="mixed", ocr_pages=len(ex.ocr_payloads))

    monkeypatch.setattr(parsing, "parse_pdf", fake_parse_pdf)
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=5)))
    assert ext.status == "READY"
    assert [s.page for s in content(ext)] == [1, 2, 3]
    d = ext.paid_delivered
    assert d.units == 1 and d.tool_key == "course_kb_ocr_page" and d.model == "mathpix"
    assert d.idempotency_key == f"course_kb_ocr:{INST}:{ref.pointer_key}"
    assert d.provider_cost_usd > 0 and d.tool_params == {"num_pages": 1}
    assert ("file", ref.pointer_key, "PAID") in fc.rows
    assert fc.stored and fc.stored[0][0] == "pdf_ocr" and "OCR text" in fc.stored[0][2]
    # The PAID tier now wins: no permit needed, nothing delivered again.
    again = run(extract(ref))
    assert again.status == "READY" and again.paid_delivered is None


def test_permit_limits_units(fc, pdf_file, monkeypatch):
    pdf_file["data"] = _pdf_bytes([True, False, False, False])
    called = []

    async def fake_parse_pdf(data, *, extract_figures=True):
        called.append(1)
        raise AssertionError("must not OCR past the permit")

    monkeypatch.setattr(parsing, "parse_pdf", fake_parse_pdf)
    ref = ref_of()
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=2)))
    assert ext.status == "NEEDS_PAID" and ext.paid_need.units == 3 and ext.note == pdf.OVER_APPROVED_NOTE
    assert ext.paid_delivered is None and not called
    # A per-kind ceiling for another kind permits nothing here.
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units={"transcribe_minutes": 50})))
    assert ext.status == "NEEDS_PAID" and not called
    # OCR switched off for the institute.
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, allow_ocr=False, max_units=50)))
    assert ext.status == "NEEDS_PAID" and not called


def test_word_file_is_unsupported(fc, pdf_file):
    pdf_file["data"] = b"PK\x03\x04 word/document.xml"
    ext = run(extract(ref_of(doc_type="DOCX")))
    assert ext.status == "UNSUPPORTED" and ext.note == pdf.WORD_FILE_NOTE
    assert len(ext.segments) == 1     # title + description still findable


def test_tutor_ocr_text_is_reused_at_no_cost(fc, pdf_file):
    ref = ref_of()
    fc.tutor[("pdf_ocr", ref.pointer_key)] = "Full OCR text the tutor already paid for"
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=10)))
    assert ext.status == "READY" and ext.paid_delivered is None and pdf_file["downloads"] == 0
    assert content(ext)[0].anchor == "none" and "already paid" in content(ext)[0].text


# ── PPT_ANIM decks ───────────────────────────────────────────────────────────

def _deck(monkeypatch, manifest, ocr):
    calls = {"ocr": [], "fetch": []}

    async def fake_fetch(url, *, max_bytes, timeout=10.0, allow_prefix=None):
        calls["fetch"].append(url)
        return json.dumps(manifest).encode()

    class FakeMathpix:
        async def ocr_image(self, url):
            calls["ocr"].append(url)
            return ocr(url)

    monkeypatch.setattr(deck, "fetch_https", fake_fetch)
    import app.services.mathpix_service as ms
    monkeypatch.setattr(ms, "MathpixService", FakeMathpix)
    return calls


def test_deck_ocr_last_step_per_slide_and_permit(fc, monkeypatch):
    manifest = {"slides": [["s1_1.png", "s1_2.png"], ["s2_1.png"], ["s3_1.png", "s3_2.png", "s3_3.png"]]}

    def ocr(url):
        if url.endswith("s2_1.png"):
            return {"error": "boom", "latex": "", "text": ""}
        return {"latex": "", "text": f"text of {url.rsplit('/', 1)[1]}"}

    calls = _deck(monkeypatch, manifest, ocr)
    base = "https://cdn.example.com/decks/42"
    ref = ref_of(doc_type="PPT_ANIM", pointer_kind="deck", pointer_key=base)
    ext = run(extract(ref))
    assert ext.status == "NEEDS_PAID" and ext.paid_need.kind == "deck_images" and ext.paid_need.units == 3
    assert not calls["ocr"]
    need = ext.paid_need
    # The need pointer is the cache key, so meta.paid lookups find the paid text.
    assert (need.pointer_kind, need.pointer_key) == ("deck", deck.deck_key(base + "/"))
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=2)))
    assert ext.status == "NEEDS_PAID" and not calls["ocr"]
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units={"deck_images": 3})))
    assert sorted(calls["ocr"]) == sorted([f"{base}/s1_2.png", f"{base}/s2_1.png", f"{base}/s3_3.png"])
    assert ext.status == "READY"
    assert [(s.anchor, s.step) for s in content(ext)] == [("step", 1), ("step", 3)]
    assert ext.paid_delivered.units == 2      # the failed call is not delivered
    assert ext.paid_delivered.idempotency_key == f"course_kb_imgocr:{INST}:{deck.deck_key(base + '/')}"
    assert cache.get(need.pointer_kind, need.pointer_key) is not None


def test_deck_with_manifest_text_is_free(fc, monkeypatch):
    manifest = {"slides": [["a.png"], ["b.png"]], "slide_texts": ["Intro to optics", ["Lens", "Focal length"]]}
    calls = _deck(monkeypatch, manifest, lambda url: {"text": "x"})
    ext = run(extract(ref_of(doc_type="PPT_ANIM", pointer_kind="deck", pointer_key="https://cdn.example.com/d/")))
    assert ext.status == "READY" and ext.paid_need is None and not calls["ocr"]
    assert [s.text for s in content(ext)] == ["Intro to optics", "Lens\nFocal length"]


# ── uploaded video / audio ───────────────────────────────────────────────────

@pytest.fixture
def upload_env(monkeypatch):
    monkeypatch.setattr(source_text, "transcription_provider", lambda: "openrouter")
    monkeypatch.setattr(source_text, "transcription_model", lambda: "openai/whisper-large-v3-turbo")
    monkeypatch.setattr(source_text, "_openrouter_key", lambda inst, user: "sk-test")

    async def fake_url(file_id):
        return f"https://media.example.com/{file_id}"

    monkeypatch.setattr(source_text, "_file_url", fake_url)
    import app.config as config
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(render_server_url="", render_server_key=""))


SPEECH = ("Today we study how a refrigerator moves heat from a cold body to a hot body using work, "
          "and why the coefficient of performance depends on the two temperatures involved here.")


def test_upload_needs_paid_then_transcribes_with_segments(fc, upload_env, monkeypatch):
    seen = {}

    async def fake_transcribe(url, *, api_key, model, max_seconds=None, **kw):
        seen.update(url=url, max_seconds=max_seconds, model=model)
        return ort.OpenRouterTranscript(
            text=SPEECH + " " + SPEECH, duration_seconds=130.0, cost_usd=0.0123, chunks=1,
            segments=[{"start": 0.0, "end": 50.0, "text": SPEECH}, {"start": 65.0, "end": 130.0, "text": SPEECH}])

    monkeypatch.setattr(ort, "transcribe_media", fake_transcribe)
    ref = ref_of(source_type="VIDEO", doc_type=None, length_ms=125_000)
    ext = run(extract(ref))
    assert ext.status == "NEEDS_PAID" and ext.paid_need.units == 3 and not ext.paid_need.approx
    assert ext.paid_need.tool_params == {"audio_minutes": 3}
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=3)))
    assert ext.status == "READY" and seen["max_seconds"] == 3 * 60 + 59
    assert [(s.anchor, s.t_start_ms) for s in content(ext)] == [("time", 0), ("time", 65_000)]
    d = ext.paid_delivered
    assert d.units == 3 and d.model == "openrouter:openai/whisper-large-v3-turbo" and d.provider_cost_usd == 0.0123
    assert d.idempotency_key == f"course_kb_transcribe:{INST}:{ref.pointer_key}"
    assert fc.stored[0][0] == "transcript" and ("file", ref.pointer_key, "PAID") in fc.rows


def test_duration_exceeded_requotes_without_delivery(fc, upload_env, monkeypatch):
    async def fake_transcribe(url, *, api_key, model, max_seconds=None, **kw):
        assert max_seconds == 10 * 60 + 59
        raise ort.DurationExceeded(1250.0)

    monkeypatch.setattr(ort, "transcribe_media", fake_transcribe)
    ref = ref_of(source_type="VIDEO", doc_type=None, length_ms=None)
    ext = run(extract(ref))
    assert ext.paid_need.units == 10 and ext.paid_need.approx is True
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=ext.paid_need.units)))
    assert ext.status == "NEEDS_PAID" and ext.paid_delivered is None
    assert ext.paid_need.units == 21 and ext.paid_need.approx is False
    assert not fc.stored and ("file", ref.pointer_key, "PAID") not in fc.rows


def test_transcribe_media_raises_duration_exceeded_before_any_chunk_call(monkeypatch):
    calls = []

    async def fake_download(url, dest):
        dest.write_bytes(b"\x00" * 16)
        return 16

    async def fake_chunk(*a, **kw):
        calls.append("chunk")
        return {"text": "x"}

    monkeypatch.setattr(ort.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    monkeypatch.setattr(ort, "_download", fake_download)
    monkeypatch.setattr(ort, "_probe_duration", lambda path: 1300.0)
    monkeypatch.setattr(ort, "_extract_chunks", lambda *a: calls.append("ffmpeg") or [])
    monkeypatch.setattr(ort, "_transcribe_chunk", fake_chunk)
    with pytest.raises(ort.DurationExceeded) as info:
        run(ort.transcribe_media("https://x/y.mp4", api_key="k", max_seconds=659))
    assert info.value.duration == 1300.0 and calls == []


def test_transcribe_media_segments_are_offset_per_chunk(monkeypatch, tmp_path):
    async def fake_download(url, dest):
        dest.write_bytes(b"\x00")
        return 1

    def fake_chunks(src, out_dir, chunk_seconds):
        paths = [out_dir / "chunk_000.mp3", out_dir / "chunk_001.mp3"]
        for p in paths:
            p.write_bytes(b"\x00")
        return paths

    async def fake_chunk(client, path, *, key, model, language):
        i = 0 if path.name.endswith("000.mp3") else 1
        return {"text": f"part {i}", "usage": {"seconds": 600, "cost": 0.01},
                "segments": [{"start": 1.5, "end": 4.0, "text": f"hello {i}"}]}

    monkeypatch.setattr(ort.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    monkeypatch.setattr(ort, "_download", fake_download)
    monkeypatch.setattr(ort, "_probe_duration", lambda path: 900.0)
    monkeypatch.setattr(ort, "_extract_chunks", fake_chunks)
    monkeypatch.setattr(ort, "_transcribe_chunk", fake_chunk)
    out = run(ort.transcribe_media("https://x/y.mp4", api_key="k", max_seconds=959))
    assert out.text == "part 0 part 1"
    assert out.segments == [{"start": 1.5, "end": 4.0, "text": "hello 0"},
                            {"start": 601.5, "end": 604.0, "text": "hello 1"}]


def test_no_speech_is_empty_and_never_delivered(fc, upload_env, monkeypatch):
    async def fake_transcribe(url, *, api_key, model, max_seconds=None, **kw):
        return ort.OpenRouterTranscript(text="Music. Music. Thank you.", duration_seconds=300.0, cost_usd=0.02)

    monkeypatch.setattr(ort, "transcribe_media", fake_transcribe)
    ext = run(extract(ref_of(source_type="AUDIO", doc_type=None, length_ms=300_000),
                      paid_permit=PaidPermit(institute_id=INST, max_units=5)))
    assert ext.status == "EMPTY" and ext.paid_delivered is None and ext.note == media.NO_SPEECH_NOTE


def test_tutor_transcript_reused_at_no_cost(fc, upload_env):
    ref = ref_of(source_type="VIDEO", doc_type=None, length_ms=600_000)
    fc.tutor[("transcript", ref.pointer_key)] = SPEECH
    ext = run(extract(ref))
    assert ext.status == "READY" and ext.paid_need is None and ext.paid_delivered is None
    assert content(ext)[0].text == SPEECH and content(ext)[0].anchor == "none"


def test_render_worker_job_runs_past_budget_is_pending(fc, upload_env, monkeypatch):
    import app.config as config
    import app.services.transcription_service as ts
    monkeypatch.setattr(source_text, "transcription_provider", lambda: "render")
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(render_server_url="https://render", render_server_key="k"))
    remembered = []

    class FakeService:
        def __init__(self, *a):
            pass

        def submit(self, *a):
            return "job-1"

        def check_status(self, job_id):
            return {"status": "processing", "progress": 40}

    monkeypatch.setattr(ts, "TranscriptionService", FakeService)
    monkeypatch.setattr(media, "_pending_job", lambda file_id: None)
    monkeypatch.setattr(source_text, "_remember_job", lambda f, j: remembered.append((f, j)))
    monkeypatch.setattr(media, "RENDER_WAIT_SECONDS", 0)
    ref = ref_of(source_type="VIDEO", doc_type=None, length_ms=40 * 60_000)
    ext = run(extract(ref, paid_permit=PaidPermit(institute_id=INST, max_units=40)))
    assert ext.status == "PENDING" and ext.paid_delivered is None and "40% done" in ext.note
    assert remembered == [(ref.pointer_key, "job-1")]


# ── YouTube, AI video ────────────────────────────────────────────────────────

def _fake_service(monkeypatch, result_or_fn):
    """Replace the shared caption service with a fake; records each call."""
    calls = []

    async def fake_get(video, **kw):
        calls.append((video, kw))
        return result_or_fn(video, **kw) if callable(result_or_fn) else result_or_fn

    monkeypatch.setattr(yt_service, "get_captions", fake_get)
    return calls


def _ok(vid, segs, **kw):
    return CaptionResult(video_id=vid, outcome=Outcome.OK, segments=tuple(segs), language=kw.get("language", "en"),
                         kind=kw.get("kind", "manual"), route=kw.get("route", "proxy"))


def test_youtube_time_windows(fc, monkeypatch):
    segs = [CaptionSegment(start_ms=t * 1000, end_ms=t * 1000 + 5000, text=f"line {t}") for t in range(0, 150, 10)]
    calls = _fake_service(monkeypatch, _ok("dQw4w9WgXcQ", segs))
    ref = ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="dQw4w9WgXcQ",
                 extras={"url": "https://youtu.be/dQw4w9WgXcQ"})
    ext = run(extract(ref))
    assert ext.status == "READY" and calls[0][1]["purpose"] == "course_knowledge"
    wins = content(ext)
    assert [(w.t_start_ms, w.t_end_ms) for w in wins] == [(0, 55_000), (60_000, 115_000), (120_000, 145_000)]
    assert wins[0].text.startswith("line 0 line 10") and wins[1].label == "1:00"
    assert ext.detail["caption_outcome"] == "OK" and ext.detail["caption_route"] == "proxy"
    # The service owns the caption cache now: the extractor writes no 'youtube' row.
    assert ("youtube", "dQw4w9WgXcQ", "FREE") not in fc.rows


def test_youtube_legacy_course_row_is_still_read(fc, monkeypatch):
    fc.rows[("youtube", "abcdefghijk", "FREE")] = ([Segment(text="cached", anchor="time", t_start_ms=0, t_end_ms=1)], {})
    calls = _fake_service(monkeypatch, lambda v, **k: pytest.fail("service must not be called on a legacy hit"))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "READY" and content(ext)[0].text == "cached" and calls == []


def test_youtube_definitive_no_captions_is_empty(fc, monkeypatch):
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.NO_CAPTIONS, route="proxy",
                                             note=NOTES[Outcome.NO_CAPTIONS]))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "EMPTY" and ext.note == media.NO_CAPTIONS_NOTE and len(ext.segments) == 1
    assert ext.detail == {"caption_outcome": "NO_CAPTIONS", "caption_route": "proxy"}
    assert media.NO_CAPTIONS_NOTE != media.LEGACY_NO_CAPTIONS_NOTE


def test_youtube_private_is_empty_with_its_own_note(fc, monkeypatch):
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.PRIVATE, route="proxy",
                                             note=NOTES[Outcome.PRIVATE]))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "EMPTY" and "private" in ext.note and ext.detail["caption_outcome"] == "PRIVATE"


def test_youtube_blocked_is_failed_for_retry(fc, monkeypatch):
    note = note_for(Outcome.BLOCKED, "course_knowledge")
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.BLOCKED, transient=True,
                                             route="proxy", note=note))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "FAILED" and ext.note == note and "try again automatically" in ext.note
    assert ext.detail["caption_outcome"] == "BLOCKED" and ext.detail["caption_transient"] is True


def test_youtube_blocked_without_any_fallback_is_empty_for_the_requeue(fc, monkeypatch):
    # No proxy / Supadata configured: retrying from the blocked server IP within minutes
    # does not help, so the lesson is EMPTY (as before the service), marked for the requeue.
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.BLOCKED, transient=True,
                                             route="direct", fallback_configured=False,
                                             note=note_for(Outcome.BLOCKED, "course_knowledge")))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "EMPTY" and ext.note == media.NO_FALLBACK_NOTE
    assert ext.detail["caption_transient"] is True and ext.detail["caption_outcome"] == "BLOCKED"


def test_youtube_busy_without_fallback_still_retries(fc, monkeypatch):
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.BUSY, transient=True,
                                             fallback_configured=False, note=note_for(Outcome.BUSY, "course_knowledge")))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "FAILED"


def test_youtube_unconfirmed_no_captions_is_empty_and_marked(fc, monkeypatch):
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.NO_CAPTIONS, route="direct",
                                             confirmed=False, fallback_configured=False,
                                             note=NOTES[Outcome.NO_CAPTIONS]))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "EMPTY" and ext.note == media.NO_CAPTIONS_NOTE
    assert ext.detail["caption_unconfirmed"] is True


def test_youtube_blocked_with_tutor_copy_is_ready(fc, monkeypatch):
    fc.tutor[("captions", "abcdefghijk")] = "the tutor's copy of the captions"
    _fake_service(monkeypatch, CaptionResult(video_id="abcdefghijk", outcome=Outcome.BLOCKED, transient=True))
    ext = run(extract(ref_of(source_type="VIDEO", doc_type=None, pointer_kind="youtube", pointer_key="abcdefghijk")))
    assert ext.status == "READY" and content(ext)[0].text == "the tutor's copy of the captions"
    assert ext.note == "Read from the AI tutor's copy of the captions"


def test_parse_youtube_default_output_unchanged(monkeypatch):
    segs = [CaptionSegment(0, 2000, "hello"), CaptionSegment(3500, 5500, "world")]
    seen = []

    async def fake_require(video, **kw):
        seen.append(kw)
        return _ok("dQw4w9WgXcQ", segs)

    monkeypatch.setattr(yt_service, "require_captions", fake_require)
    doc = run(parsing.parse_youtube("https://youtu.be/dQw4w9WgXcQ"))
    assert doc.pages[0].text == "hello world" and doc.caption_timing is None and doc.parser == "youtube"
    assert seen[0] == {"language": None, "purpose": "kb_ingest"}
    timed = run(parsing.parse_youtube("https://youtu.be/dQw4w9WgXcQ", keep_timing=True))
    assert timed.pages[0].text == "hello world"
    assert timed.caption_timing == [{"start": 0.0, "duration": 2.0, "text": "hello"},
                                    {"start": 3.5, "duration": 2.0, "text": "world"}]


def test_parse_youtube_raises_the_user_note(monkeypatch):
    res = CaptionResult(video_id="dQw4w9WgXcQ", outcome=Outcome.BLOCKED, transient=True,
                        note=note_for(Outcome.BLOCKED, "kb_ingest"))

    async def fake_require(video, **kw):
        raise CaptionsError(res)

    monkeypatch.setattr(yt_service, "require_captions", fake_require)
    with pytest.raises(ValueError) as err:
        run(parsing.parse_youtube("https://youtu.be/dQw4w9WgXcQ"))
    assert str(err.value) == res.note and "block" in str(err.value)
    with pytest.raises(ValueError, match="does not look like a YouTube"):
        run(parsing.parse_youtube("https://example.com/video"))


def test_ai_video_words_give_45_second_windows(fc, monkeypatch):
    words = [{"word": f"w{i}", "start": i * 5.0, "end": i * 5.0 + 1} for i in range(20)]   # 0..96 s

    async def fake_download(url, *, max_bytes, timeout=120.0):
        return json.dumps(words).encode()

    monkeypatch.setattr(media, "_words_row", lambda vid: ("https://s3/narration.words.json", None))
    monkeypatch.setattr(source_text, "_download", fake_download)
    ext = run(extract(ref_of(source_type="HTML_VIDEO", doc_type=None, pointer_kind="ai_video", pointer_key="vid-1")))
    assert ext.status == "READY" and ext.anchor_kind == "time"
    assert [w.t_start_ms for w in content(ext)] == [0, 45_000, 90_000]


# ── SCORM ────────────────────────────────────────────────────────────────────

def test_scorm_rejects_off_host_hrefs(fc, monkeypatch):
    root = "https://cdn.example.com/scorm/pkg1/"
    manifest = f"""<?xml version="1.0"?>
    <manifest xmlns:adlcp="x"><resources>
      <resource identifier="r1" adlcp:scormType="sco" href="index.html"><file href="index.html"/></resource>
      <resource identifier="r2" href="lessons/two.htm"/>
      <resource identifier="r3" href="https://evil.example.com/steal.html"/>
      <resource identifier="r4" href="//evil.example.com/proto.html"/>
      <resource identifier="r5" href="../../other-tenant/page.html"/>
      <resource identifier="r6" href="http://cdn.example.com/scorm/pkg1/plain.html"/>
      <resource identifier="r7" href="scripts/app.js"/>
      <resource identifier="r8" href="lessons/%2e%2e/%2e%2e/x.html"/>
    </resources></manifest>"""
    long_text = "<h1>Newton's laws</h1><p>" + "Force equals mass times acceleration. " * 10 + "</p>"
    fetched = []

    async def fake_fetch(url, *, max_bytes, timeout=10.0, allow_prefix=None):
        fetched.append(url)
        assert allow_prefix == root
        if url.endswith("imsmanifest.xml"):
            return manifest.encode()
        return long_text.encode()

    monkeypatch.setattr(scorm, "fetch_https", fake_fetch)
    ref = ref_of(source_type="SCORM", doc_type=None, pointer_kind="scorm", pointer_key="scorm-file-1",
                 extras={"launch_url": root + "index.html", "launch_path": "index.html"})
    ext = run(extract(ref))
    assert fetched == [root + "imsmanifest.xml", root + "index.html", root + "lessons/two.htm"]
    assert ext.status == "READY" and [(s.page, s.label) for s in content(ext)] == [(1, "index.html"), (2, "two.htm")]
    # The guard itself, as fetch_https applies it.
    assert documents.within_prefix(root + "a/b.html", root)
    assert not documents.within_prefix("https://evil.example.com/scorm/pkg1/a.html", root)
    assert not documents.within_prefix("http://cdn.example.com/scorm/pkg1/a.html", root)
    assert not documents.within_prefix("https://cdn.example.com/scorm/other/a.html", root)


def test_fetch_https_refuses_non_https_and_off_prefix():
    assert run(documents.fetch_https("http://cdn.example.com/a.html", max_bytes=10)) is None
    assert run(documents.fetch_https("https://evil.example.com/a.html", max_bytes=10,
                                     allow_prefix="https://cdn.example.com/pkg/")) is None


def test_scorm_drawn_by_scripts_is_empty(fc, monkeypatch):
    async def fake_fetch(url, *, max_bytes, timeout=10.0, allow_prefix=None):
        if url.endswith("imsmanifest.xml"):
            return b'<manifest><resource href="index.html"/></manifest>'
        return b"<html><body><div id='app'></div><script>render()</script></body></html>"

    monkeypatch.setattr(scorm, "fetch_https", fake_fetch)
    ext = run(extract(ref_of(source_type="SCORM", doc_type=None, pointer_kind="scorm", pointer_key="f2",
                             extras={"launch_url": "https://cdn.example.com/p/index.html"})))
    assert ext.status == "EMPTY" and ext.note == scorm.SCRIPTED_NOTE


# ── registry rules ───────────────────────────────────────────────────────────

def test_extract_maps_errors_to_failed_and_keeps_cancellation(fc, monkeypatch):
    async def boom(ref, permit=None):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(pdf, "extract_pdf", boom)
    ext = run(extract(ref_of()))
    assert ext.status == "FAILED" and "disk on fire" in ext.note and len(ext.segments) == 1

    async def cancelled(ref, permit=None):
        raise asyncio.CancelledError()

    monkeypatch.setattr(pdf, "extract_pdf", cancelled)
    with pytest.raises(asyncio.CancelledError):
        run(extract(ref_of()))


def test_permit_without_institute_is_refused(fc, pdf_file):
    ext = run(extract(ref_of(), paid_permit=PaidPermit(max_units=10)))
    assert ext.status == "FAILED" and pdf_file["downloads"] == 0


def test_inline_and_unsupported_refs(fc):
    inline = ref_of(doc_type="HTML", pointer_kind="inline", pointer_key=None,
                    inline_segments=[Segment(text="Body", label="Intro")], extras={"text_kind": "document"})
    ext = run(extract(inline))
    assert ext.status == "READY" and ext.text_kind == "document" and [s.text for s in content(ext)] == ["Body"]
    empty = ref_of(doc_type="HTML", pointer_kind="inline", pointer_key=None)
    assert run(extract(empty)).status == "EMPTY"
    link = ref_of(source_type="VIDEO", doc_type=None, pointer_kind="none", pointer_key=None,
                  extras={"url": "https://vimeo.com/1", "note": describe.EXTERNAL_VIDEO_NOTE})
    ext = run(extract(link))
    assert ext.status == "UNSUPPORTED" and ext.note == describe.EXTERNAL_VIDEO_NOTE and len(ext.segments) == 1
    assessment = ref_of(source_type="ASSESSMENT", doc_type=None, pointer_kind="none", pointer_key=None,
                        learner_indexable=False)
    assert run(extract(assessment)).status == "UNSUPPORTED"


def test_presentation_drawing_is_never_read_as_pdf(fc, monkeypatch):
    scene = {"elements": [
        {"type": "text", "text": "Second", "x": 50, "y": 200},
        {"type": "rectangle", "x": 0, "y": 0},
        {"type": "text", "text": "Deleted", "x": 0, "y": 0, "isDeleted": True},
        {"type": "text", "text": "First right", "x": 300, "y": 10},
        {"type": "text", "text": "First left", "x": 10, "y": 10},
    ]}

    async def fake_public(file_id, expiry_days=7):
        return f"https://public.example.com/{file_id}"

    async def fake_download(url, *, max_bytes, timeout=120.0):
        assert max_bytes == documents.MAX_DRAWING_BYTES
        return json.dumps(scene).encode()

    async def no_pdf(ref, permit=None):
        raise AssertionError("PRESENTATION must never take the PDF path")

    import app.services.media_file_client as mfc
    monkeypatch.setattr(mfc, "get_public_file_url", fake_public)
    monkeypatch.setattr(source_text, "_download", fake_download)
    monkeypatch.setattr(pdf, "extract_pdf", no_pdf)
    ext = run(extract(ref_of(doc_type="PRESENTATION")))
    assert ext.status == "READY" and ext.anchor_kind == "element"
    assert [s.text for s in content(ext)] == ["First left", "First right", "Second"]


def test_paid_permit_and_need_shapes():
    p = PaidPermit(institute_id=INST, max_units={"ocr_pages": 4})
    assert p.allows("ocr_pages") and p.limit("ocr_pages") == 4 and not p.allows("deck_images")
    assert PaidPermit(institute_id=INST, max_units=7).limit("transcribe_minutes") == 7
    assert not PaidPermit(institute_id=INST, allow_transcription=False, max_units=7).allows("transcribe_minutes")
    n = PaidNeed("transcribe_minutes", "course_kb_transcribe_minute", "audio_minutes", 3)
    assert n.tool_params == {"audio_minutes": 3}
    s = Segment(text="x", anchor="time", t_start_ms=5)
    assert Segment.from_dict(s.to_dict()) == s
    assert media.needed_minutes(None) == (10, True) and media.needed_minutes(60_001) == (2, False)


# ── real Postgres: describe_slides, the cache table, tutor vendors ───────────

EXTRA_STUBS = """
CREATE TABLE IF NOT EXISTS question_slide (
    id VARCHAR(255) PRIMARY KEY, text_id VARCHAR(50), parent_rich_text_id VARCHAR(255),
    explanation_text_id VARCHAR(50), media_id VARCHAR(999), question_response_type VARCHAR(50) DEFAULT 'OPTION',
    question_type VARCHAR(50) DEFAULT 'MCQS', access_level VARCHAR(50) DEFAULT 'INSTITUTE',
    auto_evaluation_json TEXT, evaluation_type VARCHAR(50), source_type VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "option" (
    id VARCHAR(255) PRIMARY KEY, question_id VARCHAR(255), text_id VARCHAR(255), media_id VARCHAR(255),
    explanation_text_id VARCHAR(255), created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assignment_slide (
    id VARCHAR(255) PRIMARY KEY, parent_rich_text_id VARCHAR(255), text_id VARCHAR(255),
    live_date TIMESTAMP, end_date TIMESTAMP, re_attempt_count INT, comma_separated_media_ids VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assignment_slide_question (
    id VARCHAR(255) PRIMARY KEY, assignment_slide_id VARCHAR(255), question_order INT, status VARCHAR(50),
    text_id VARCHAR, question_type VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_slide_question (
    id VARCHAR PRIMARY KEY, parent_rich_text_id VARCHAR, text_id VARCHAR, explanation_text_id VARCHAR,
    media_id VARCHAR, status VARCHAR, question_response_type VARCHAR NOT NULL DEFAULT 'OPTION',
    question_type VARCHAR NOT NULL DEFAULT 'MCQS', access_level VARCHAR NOT NULL DEFAULT 'INSTITUTE',
    auto_evaluation_json TEXT, evaluation_type VARCHAR, question_order INT, question_time_in_millis BIGINT,
    video_slide_id VARCHAR, can_skip BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS video_slide_question_options (
    id VARCHAR PRIMARY KEY, video_slide_question_id VARCHAR NOT NULL, text_id VARCHAR,
    explanation_text_id VARCHAR, media_id VARCHAR,
    created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS file_conversion (
    id VARCHAR(255) PRIMARY KEY, vendor_file_id VARCHAR(255) NOT NULL, vendor VARCHAR(64), file_id VARCHAR(255),
    status VARCHAR(32), html_text TEXT, file_type VARCHAR(64), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory
    factory = pg_session_factory()
    with factory.engine.begin() as c:
        c.exec_driver_sql(EXTRA_STUBS)
    yield factory
    factory.close()


@pytest.fixture
def pg_db(Session, monkeypatch):
    """Route the extractors' own short sessions to the scratch DB; count open ones."""
    state = {"open": 0}

    @contextmanager
    def scratch_session():
        s = Session()
        state["open"] += 1
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            state["open"] -= 1
            s.close()

    monkeypatch.setattr(cache, "db_session", scratch_session)
    monkeypatch.setattr(source_text, "db_session", scratch_session)
    monkeypatch.setattr(media, "db_session", scratch_session)
    return state


def _rt(db, content_html):
    rid = _id()
    db.execute(text("INSERT INTO rich_text_data (id, type, content) VALUES (:i, 'HTML', :c)"), {"i": rid, "c": content_html})
    return rid


def _slide(db, source_type, source_id, *, title="Lesson", description="About it", status="PUBLISHED"):
    sid = _id()
    db.execute(text("INSERT INTO slide (id, source_id, source_type, title, description, status, last_sync_date) "
                    "VALUES (:i, :s, :t, :ti, :d, :st, now())"),
               {"i": sid, "s": source_id, "t": source_type, "ti": title, "d": description, "st": status})
    return sid


def _doc(db, dtype, data, published):
    did = _id()
    db.execute(text("INSERT INTO document_slide (id, type, data, published_data) VALUES (:i, :t, :d, :p)"),
               {"i": did, "t": dtype, "d": data, "p": published})
    return did


def test_pg_presentation_is_classified_before_the_uuid_check(Session):
    with Session() as db:
        file_id = _id()
        pres = _slide(db, "DOCUMENT", _doc(db, "PRESENTATION", file_id, file_id))
        pdf_slide = _slide(db, "DOCUMENT", _doc(db, "PDF", file_id, file_id))
        word = _slide(db, "DOCUMENT", _doc(db, "DOCX", file_id, file_id))
        db.commit()
        refs = {r.slide_id: r for r in describe_slides(db, [pres, pdf_slide, word])}
    assert refs[pres].doc_type == "PRESENTATION" and refs[pres].extras["text_kind"] == "drawing"
    assert refs[pdf_slide].doc_type == "PDF" and refs[pdf_slide].extras["text_kind"] == "pdf"
    assert refs[word].pointer_kind == "file" and refs[word].doc_type == "DOCX"


def test_pg_quiz_segments_never_contain_answer_keys_or_explanations(Session):
    with Session() as db:
        quiz_id = _id()
        q1, q2 = _id(), _id()
        db.execute(text("INSERT INTO quiz_slide_question (id, text_id, explanation_text_id, auto_evaluation_json, "
                        "question_order, quiz_slide_id, status, question_type) VALUES "
                        "(:q, :t, :e, :a, 1, :z, 'ACTIVE', 'MCQS'), (:q2, :t2, :e2, :a2, 2, :z, 'ACTIVE', 'NUMERIC'), "
                        "(:q3, :t3, NULL, NULL, 3, :z, 'DELETED', 'MCQS')"),
                   {"q": q1, "t": _rt(db, "<p>Which engine is most efficient?</p>"),
                    "e": _rt(db, "<p>EXPLANATION-SECRET Carnot</p>"),
                    "a": json.dumps({"correctAnswers": ["opt-b"], "note": "ANSWER-KEY-SECRET"}),
                    "q2": q2, "t2": _rt(db, "<p>Efficiency between 300 K and 600 K?</p>"),
                    "e2": _rt(db, "<p>EXPLANATION-SECRET-2</p>"),
                    "a2": json.dumps({"validAnswers": ["0.5050505"], "data": {"answer": "NUMERIC-ANSWER-SECRET"}}),
                    "q3": _id(), "t3": _rt(db, "<p>Deleted question</p>"), "z": quiz_id})
        for text_html in ("Otto", "Carnot", "Diesel"):
            db.execute(text("INSERT INTO quiz_slide_question_options (id, quiz_slide_question_id, text_id, "
                            "explanation_text_id) VALUES (:i, :q, :t, :e)"),
                       {"i": _id(), "q": q1, "t": _rt(db, f"<p>{text_html}</p>"),
                        "e": _rt(db, "<p>OPTION-EXPLANATION-SECRET</p>")})
        quiz_slide = _slide(db, "QUIZ", quiz_id)
        # A single question slide and an in-video question with the same traps.
        qs = _id()
        db.execute(text("INSERT INTO question_slide (id, text_id, explanation_text_id, auto_evaluation_json) "
                        "VALUES (:i, :t, :e, :a)"),
                   {"i": qs, "t": _rt(db, "<p>Define entropy.</p>"), "e": _rt(db, "<p>EXPLANATION-SECRET-3</p>"),
                    "a": json.dumps({"correctAnswers": ["SINGLE-ANSWER-SECRET"]})})
        db.execute(text('INSERT INTO "option" (id, question_id, text_id, explanation_text_id) VALUES (:i, :q, :t, :e)'),
                   {"i": _id(), "q": qs, "t": _rt(db, "<p>Disorder</p>"), "e": _rt(db, "<p>OPTION-EXPLANATION-SECRET</p>")})
        question_slide = _slide(db, "QUESTION", qs)
        video_id = _id()
        db.execute(text("INSERT INTO video (id, published_url, published_video_length) VALUES (:i, :u, 300000)"),
                   {"i": video_id, "u": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
        vq = _id()
        db.execute(text("INSERT INTO video_slide_question (id, text_id, explanation_text_id, auto_evaluation_json, "
                        "question_order, question_time_in_millis, video_slide_id) VALUES (:i, :t, :e, :a, 1, 42000, :v)"),
                   {"i": vq, "t": _rt(db, "<p>What did the piston do?</p>"), "e": _rt(db, "<p>EXPLANATION-SECRET-4</p>"),
                    "a": json.dumps({"correctAnswers": ["VIDEO-ANSWER-SECRET"]}), "v": video_id})
        db.execute(text("INSERT INTO video_slide_question_options (id, video_slide_question_id, text_id, "
                        "explanation_text_id) VALUES (:i, :q, :t, :e)"),
                   {"i": _id(), "q": vq, "t": _rt(db, "<p>Moved up</p>"), "e": _rt(db, "<p>OPTION-EXPLANATION-SECRET</p>")})
        video_slide = _slide(db, "VIDEO", video_id)
        db.commit()
        refs = {r.slide_id: r for r in describe_slides(db, [quiz_slide, question_slide, video_slide])}

    quiz = refs[quiz_slide]
    assert quiz.pointer_kind == "inline" and [s.question_no for s in quiz.inline_segments] == [1, 2]
    first = quiz.inline_segments[0].text
    assert first.startswith("Question 1. Which engine is most efficient?\nOptions: (a) ")
    assert all(name in first for name in ("Otto", "Carnot", "Diesel"))
    assert refs[question_slide].inline_segments[0].text.startswith("Question 1. Define entropy.")
    video = refs[video_slide]
    assert video.pointer_kind == "youtube" and video.inline_segments[0].t_start_ms == 42000
    blob = json.dumps([[s.to_dict() for s in r.inline_segments] for r in refs.values()]) + \
        " ".join(r.content_hash for r in refs.values())
    for secret in ("SECRET", "0.5050505", "opt-b", "Deleted question"):
        assert secret not in blob


def test_pg_unsync_lessons_use_published_columns_only(Session):
    with Session() as db:
        doc_slide = _slide(db, "DOCUMENT", _doc(db, "HTML", "<h1>DRAFT-ONLY</h1>", "<h2>Published heading</h2><p>Live body</p>"),
                           status="UNSYNC")
        unpublished = _slide(db, "DOCUMENT", _doc(db, "HTML", "<p>DRAFT-ONLY</p>", None), status="UNSYNC")
        video_id = _id()
        db.execute(text("INSERT INTO video (id, url, video_length, published_url, published_video_length) "
                        "VALUES (:i, :u, 5, NULL, NULL)"), {"i": video_id, "u": _id()})
        video_slide = _slide(db, "VIDEO", video_id, status="UNSYNC")
        audio_id = _id()
        db.execute(text("INSERT INTO audio_slide (id, audio_file_id, published_audio_file_id, "
                        "published_audio_length_in_millis) VALUES (:i, :draft, :pub, 125000)"),
                   {"i": audio_id, "draft": _id(), "pub": "pub-audio-file"})
        audio_slide = _slide(db, "AUDIO", audio_id, status="UNSYNC")
        db.commit()
        refs = {r.slide_id: r for r in describe_slides(db, [doc_slide, unpublished, video_slide, audio_slide])}
    d = refs[doc_slide]
    assert d.status == "UNSYNC" and d.pointer_kind == "inline"
    assert "Live body" in d.inline_segments[0].text and d.inline_segments[0].label == "Published heading"
    assert "DRAFT-ONLY" not in json.dumps([s.to_dict() for r in refs.values() for s in r.inline_segments])
    assert refs[unpublished].pointer_kind == "none" and not refs[unpublished].inline_segments
    assert refs[video_slide].pointer_kind == "none" and refs[video_slide].pointer_key is None
    a = refs[audio_slide]
    assert a.pointer_kind == "file" and a.pointer_key == "pub-audio-file" and a.length_ms == 125000


def test_pg_content_hash_tracks_published_body_and_title_only(Session):
    with Session() as db:
        doc_id = _doc(db, "HTML", "<p>draft v1</p>", "<p>published v1</p>")
        slide_id = _slide(db, "DOCUMENT", doc_id, title="Optics")
        db.commit()

        def h():
            return describe_slides(db, [slide_id])[0].content_hash

        h0 = h()
        assert h() == h0
        db.execute(text("UPDATE document_slide SET data = '<p>draft v2</p>' WHERE id = :i"), {"i": doc_id})
        db.execute(text("UPDATE slide SET status = 'UNSYNC', last_sync_date = now(), updated_at = now() WHERE id = :i"),
                   {"i": slide_id})
        db.commit()
        assert h() == h0                                    # draft edits and status do not count
        db.execute(text("UPDATE document_slide SET published_data = '<p>published v2</p>' WHERE id = :i"), {"i": doc_id})
        db.commit()
        h1 = h()
        assert h1 != h0
        db.execute(text("UPDATE slide SET title = 'Optics II' WHERE id = :i"), {"i": slide_id})
        db.commit()
        h2 = h()
        assert h2 not in (h0, h1)
    assert h0.startswith("sha256:") and EXTRACTOR_VERSION == 1


def test_pg_describe_other_types(Session):
    with Session() as db:
        code = _slide(db, "DOCUMENT", _doc(db, "CODE", "{}", json.dumps({"language": "python", "code": "print(1)"})))
        nb = _slide(db, "DOCUMENT", _doc(db, "JUPYTER", "{}", json.dumps({"projectName": "Pendulum lab"})))
        ppt = _slide(db, "DOCUMENT", _doc(db, "PPT_ANIM", "", "https://cdn.example.com/decks/9/"))
        scorm_id = _id()
        db.execute(text("INSERT INTO scorm_slide (id, original_file_id, launch_path, launch_url) VALUES "
                        "(:i, 'orig-1', 'index.html', 'https://cdn.example.com/s/p/index.html')"), {"i": scorm_id})
        sc = _slide(db, "SCORM", scorm_id)
        hv_id = _id()
        db.execute(text("INSERT INTO html_video_slide (id, ai_gen_video_id, video_length) VALUES (:i, 'ai-1', 90000)"),
                   {"i": hv_id})
        hv = _slide(db, "HTML_VIDEO", hv_id)
        au_id = _id()
        db.execute(text("INSERT INTO audio_slide (id, transcript, published_audio_file_id) VALUES (:i, :t, 'f')"),
                   {"i": au_id, "t": "Typed transcript of the talk"})
        au = _slide(db, "AUDIO", au_id)
        vimeo_id = _id()
        db.execute(text("INSERT INTO video (id, published_url, description, embedded_type, embedded_data) "
                        "VALUES (:i, 'https://vimeo.com/123', 'Admin summary', 'CODE', :e)"),
                   {"i": vimeo_id, "e": json.dumps({"language": "js", "code": "let a = 1"})})
        vimeo = _slide(db, "VIDEO", vimeo_id)
        asg_id = _id()
        db.execute(text("INSERT INTO assignment_slide (id, text_id) VALUES (:i, :t)"),
                   {"i": asg_id, "t": _rt(db, "<p>Build a model engine.</p>")})
        db.execute(text("INSERT INTO assignment_slide_question (id, assignment_slide_id, question_order, status, text_id) "
                        "VALUES (:i, :a, 1, 'ACTIVE', :t)"),
                   {"i": _id(), "a": asg_id, "t": _rt(db, "<p>Explain the stroke cycle.</p>")})
        asg = _slide(db, "ASSIGNMENT", asg_id)
        assess = _slide(db, "ASSESSMENT", _id())
        db.commit()
        refs = {r.slide_id: r for r in describe_slides(db, [code, nb, ppt, sc, hv, au, vimeo, asg, assess, "missing"])}
    assert len(refs) == 9
    assert refs[code].inline_segments[0].text == "Code (python):\nprint(1)"
    assert refs[nb].pointer_kind == "none" and refs[nb].inline_segments[0].text == "Jupyter notebook: Pendulum lab"
    assert refs[ppt].pointer_kind == "deck"
    assert (refs[sc].pointer_kind, refs[sc].pointer_key, refs[sc].extras["launch_path"]) == ("scorm", "orig-1", "index.html")
    assert (refs[hv].pointer_kind, refs[hv].pointer_key, refs[hv].length_ms) == ("ai_video", "ai-1", 90000)
    assert refs[au].pointer_kind == "inline" and refs[au].inline_segments[0].text == "Typed transcript of the talk"
    v = refs[vimeo]
    assert v.pointer_kind == "none" and v.extras["note"] == describe.EXTERNAL_VIDEO_NOTE
    assert v.extras["video_description"] == "Admin summary" and "let a = 1" in v.inline_segments[0].text
    assert [s.text for s in refs[asg].inline_segments] == ["Build a model engine.", "Question 1. Explain the stroke cycle."]
    assert refs[assess].learner_indexable is False
    ext = run(extract(refs[nb]))
    assert ext.status == "UNSUPPORTED" and ext.note == documents.EXTERNAL_PROJECT_NOTE


def test_pg_cache_prefers_paid_and_upserts(Session, pg_db):
    key = _id()
    assert cache.get("file", key) is None
    assert cache.put("file", key, "FREE", [Segment(text="free page", anchor="page", page=1)], {"scanned_pages": 2})
    hit = cache.get("file", key)
    assert hit.tier == "FREE" and hit.probe == {"scanned_pages": 2} and hit.segments[0].page == 1
    assert cache.put("file", key, "PAID", [Segment(text="ocr page", anchor="page", page=2)])
    assert cache.get("file", key).tier == "PAID"
    assert cache.put("file", key, "PAID", [Segment(text="ocr page v2", anchor="page", page=2)])   # ON CONFLICT
    assert cache.get("file", key).segments[0].text == "ocr page v2"
    with Session() as db:
        rows = db.execute(text("SELECT tier, text_chars, extractor_version FROM course_extract_cache "
                               "WHERE pointer_key = :k ORDER BY tier"), {"k": key}).fetchall()
    assert [tuple(r) for r in rows] == [("FREE", 9, EXTRACTOR_VERSION), ("PAID", 11, EXTRACTOR_VERSION)]
    assert pg_db["open"] == 0


def test_pg_tutor_pdf_text_without_ocr_file_type_is_ignored(Session, pg_db):
    fid = _id()
    with Session() as db:
        for vendor, ftype, body in (("tutor_pdf_text", "pdf", "partial free text"),
                                    ("tutor_pdf_probe", "probe", '{"pages": 3}'),
                                    ("mathpix", "pdf", "<p>other vendor html</p>")):
            db.execute(text("INSERT INTO file_conversion (id, vendor_file_id, vendor, file_id, status, html_text, "
                            "file_type) VALUES (:i, :k, :v, :k, 'SUCCESS', :b, :t)"),
                       {"i": _id(), "k": fid, "v": vendor, "b": body, "t": ftype})
        db.commit()
    assert cache.tutor_pdf_ocr(fid) is None
    assert cache.tutor_transcript(fid) is None
    cache.store_tutor_pdf_ocr(fid, "full OCR text")
    assert cache.tutor_pdf_ocr(fid) == "full OCR text"
    cache.store_tutor_transcript(fid, "a transcript")
    assert cache.tutor_transcript(fid) == "a transcript"
    with Session() as db:
        rows = db.execute(text("SELECT vendor, file_type, file_id FROM file_conversion WHERE vendor_file_id = :k "
                               "AND vendor IN ('tutor_pdf_text', 'tutor_video_transcript') ORDER BY vendor, file_type"),
                          {"k": fid}).fetchall()
    assert [tuple(r) for r in rows] == [("tutor_pdf_text", "pdf", fid), ("tutor_pdf_text", "pdf_ocr", fid),
                                        ("tutor_video_transcript", "transcript", fid)]


def test_pg_pdf_extract_holds_no_session_during_network(Session, pg_db, monkeypatch):
    data = _pdf_bytes([True, False])
    seen = []

    async def fake_file_url(file_id):
        seen.append(("url", pg_db["open"]))
        return "https://media.example.com/f.pdf"

    async def fake_download(url, *, max_bytes, timeout=120.0):
        seen.append(("download", pg_db["open"]))
        return data

    monkeypatch.setattr(source_text, "_file_url", fake_file_url)
    monkeypatch.setattr(source_text, "_download", fake_download)
    ref = ref_of()
    ext = run(extract(ref))
    assert ext.status == "NEEDS_PAID" and ext.paid_need.units == 1
    assert seen == [("url", 0), ("download", 0)] and pg_db["open"] == 0
    assert cache.get("file", ref.pointer_key).probe["scanned_page_numbers"] == [2]


# ── SCORM fallback-page boilerplate (pilot 2026-10-21: iSpring packages render text as images) ──

def test_scorm_strip_boilerplate_drops_unsupported_browser_page():
    from app.services.course_knowledge.extract.scorm import strip_boilerplate

    page = ("LM1 - What is Rajaswala Paricharya? | राजस्वला परिचर्या क्या है? Rajaswala Paricharya-LM1 "
            "Page Not Available This browser is not supported To view this content, please use one of "
            "these browsers: Chrome, Mozilla Firefox, Microsoft Edge, Safari")
    left = strip_boilerplate(page)
    assert "browser" not in left.lower() and "Chrome" not in left
    assert "राजस्वला परिचर्या" in left and len(left) < 200


def test_scorm_strip_boilerplate_keeps_real_lesson_text():
    from app.services.course_knowledge.extract.scorm import strip_boilerplate

    text = "Menstrual care in Ayurveda rests on rest, warm food and avoiding exertion during the first three days. " * 3
    assert strip_boilerplate(text) == " ".join(text.split())


def test_scorm_lessons_hash_and_cache_carry_the_scorm_extractor_version():
    from app.services.course_knowledge.extract import describe
    from app.services.course_knowledge.extract.types import SCORM_EXTRACTOR_VERSION, SlideRef

    ref = SlideRef(slide_id="s1", source_type="SCORM", title="LM1", description=None, status="PUBLISHED",
                   doc_type=None, pointer_kind=None, pointer_key=None)
    describe._scorm(ref, ("sc1", "https://cdn.example/scorm/x/vacademy_player_v2.html", None, "file-1"))
    assert ref.extras["extractor"] == f"scorm-v{SCORM_EXTRACTOR_VERSION}"
    before = describe.content_hash(ref)
    ref.extras["extractor"] = "scorm-v1"
    assert describe.content_hash(ref) != before


# ── transcript loops (pilot 2026-10-21: a chanted shloka came back as one line x40) ──

def test_collapse_repeats_keeps_one_copy_of_a_looped_phrase():
    from app.services.course_knowledge.extract.media import collapse_repeats

    looped = "तस्य संजनयं हर्षं कुरु व्रिद्ध तितामकत " * 12 + "। He blew his conch loudly."
    assert collapse_repeats(looped) == "तस्य संजनयं हर्षं कुरु व्रिद्ध तितामकत । He blew his conch loudly."
    assert collapse_repeats("This is normal text. This is normal text. Twice stays.") == \
        "This is normal text. This is normal text. Twice stays."
    assert collapse_repeats("Ram Ram Ram Ram is chanted.") == "Ram Ram Ram Ram is chanted."


def test_time_windows_drop_consecutive_identical_pieces():
    from app.services.course_knowledge.extract.media import time_windows

    segs = time_windows([(i, i + 1, "तस्य संजनयं हर्षं") for i in range(30)] + [(31, 32, "next line")], 60)
    assert [s.text for s in segs] == ["तस्य संजनयं हर्षं next line"]
    assert segs[0].t_end_ms == 32000


def test_long_lectures_are_speech_but_loops_are_not():
    # Pilot 2026-10-21: three 54-102 min talks were rejected as "no clear speech":
    # a whole-text distinct-word share of 0.2 cannot hold for an hour of speech.
    import random
    from app.services.tutor.source_text import looks_like_speech

    rng = random.Random(1)
    vocab = [f"w{i}" for i in range(900)]
    talk = " ".join(rng.choices(vocab, weights=[1 / (i + 1) for i in range(900)], k=7000))
    assert len(set(talk.split())) / 7000 < 0.2
    assert looks_like_speech(talk, 54 * 60)
    assert not looks_like_speech(" ".join(["la la thank you"] * 400), 54 * 60)
    assert not looks_like_speech("thank you thank you", 600)
