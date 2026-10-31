"""The learner chatbot reads the lesson the learner has open.

The app has no text for video, SCORM, AI video, audio, deck and drawing slides,
so the tutor answered "I can't see this slide". resolve_context now fills
`content` from the course-knowledge readers (free only), scoped to the
session's institute.

What must hold:
  * additive only: without real text the context is exactly what it was;
  * a cached lesson -> its text as `content` and the real slide type;
  * a slide whose title is not the one on screen (stale id) is not used;
  * a slide from another institute -> content untouched, nothing read;
  * a miss -> one background read; a turn that waits gets the text; a video's
    own description stays above its transcript;
  * captions keep their time stamps; the title head extract() adds is dropped;
  * a drawing's fileId never goes down the PDF path;
  * DOC / PDF / quiz slides are left to their existing paths;
  * READY / EMPTY are cached, NEEDS_PAID is not, FAILED is not retried at once;
  * an audio transcript stored on the slide needs no read.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services import context_resolver_service as crs  # noqa: E402
from ai_service.app.services import lesson_text_service as lts  # noqa: E402
from ai_service.app.services.course_knowledge.extract import describe, registry  # noqa: E402
from ai_service.app.services.course_knowledge.extract.types import Extraction, Segment, SlideRef  # noqa: E402

INSTITUTE = "inst-1"
LESSON = "Weather Web. Connect your weather station to WiFi and see its readings on a web page."


def _ref(slide_id, source_type, pointer_kind, pointer_key=None, doc_type=None, text_kind="", inline=None, title="T"):
    return SlideRef(slide_id=slide_id, title=title, description="", status="PUBLISHED", source_type=source_type,
                    doc_type=doc_type, pointer_kind=pointer_kind, pointer_key=pointer_key,
                    inline_segments=list(inline or []), content_hash="h1", extras={"text_kind": text_kind})


SLIDES = {
    "scorm-1": (("SCORM", None), _ref("scorm-1", "SCORM", "scorm", "scorm/pkg", text_kind="scorm")),
    "yt-1": (("VIDEO", None), _ref("yt-1", "VIDEO", "youtube", "abc123", text_kind="captions")),
    "upload-1": (("VIDEO", None), _ref("upload-1", "VIDEO", "file", "f-1", text_kind="transcript")),
    "drawing-1": (("DOCUMENT", "PRESENTATION"),
                  _ref("drawing-1", "DOCUMENT", "file", "487fc9b7-e886-4a6a-a517-123162a99fa7",
                       doc_type="PRESENTATION", text_kind="drawing")),
    "audio-1": (("AUDIO", None), _ref("audio-1", "AUDIO", "inline", text_kind="transcript",
                                      inline=[Segment(text="Today we study clouds.", label="Transcript")])),
    "vimeo-1": (("VIDEO", None), _ref("vimeo-1", "VIDEO", "none")),
    "doc-1": (("DOCUMENT", "DOC"), None),
    "pdf-1": (("DOCUMENT", "PDF"), None),
    "quiz-1": (("QUIZ", None), None),
}


class FakeDb:
    """The lesson gate (INSTITUTE only) and the lesson_chat_text cache."""

    def __init__(self, cache=None):
        self.cache = dict(cache or {})
        self.sql = []

    def execute(self, sql, params):
        q = str(sql)
        self.sql.append(q)
        if "file_conversion" in q:
            hit = self.cache.get(params["k"])
            return SimpleNamespace(first=lambda: (hit,) if hit is not None else None)
        if "document_slide d ON" in q:
            entry = SLIDES.get(params["slide_id"])
            ok = entry is not None and params["institute_id"] == INSTITUTE
            return SimpleNamespace(first=lambda: entry[0] if ok else None)
        # The PDF ownership gate: a drawing fileId must never get here.
        raise AssertionError(f"unexpected query: {q[:80]}")


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    lts._in_flight.clear()
    lts._failed.clear()
    lts._recent.clear()
    stored = {}
    described = []

    async def no_user(*_a, **_k):
        return {}

    def fake_describe(_db, ids):
        described.extend(ids)
        return [SLIDES[i][1] for i in ids if SLIDES.get(i) and SLIDES[i][1] is not None]

    monkeypatch.setattr(crs.ContextResolverService, "_fetch_user_details", no_user)
    monkeypatch.setattr(crs.ContextResolverService, "_fetch_user_performance", no_user)
    monkeypatch.setattr(describe, "describe_slides", fake_describe)
    monkeypatch.setattr(lts, "_store", lambda key, slide_id, body: stored.__setitem__(key, body))
    yield SimpleNamespace(stored=stored, described=described)
    lts._in_flight.clear()
    lts._failed.clear()
    lts._recent.clear()


def _resolve(db, slide_id, content="", type_="DOCUMENT", institute=INSTITUTE):
    async def run():
        resolver = crs.ContextResolverService(db)
        meta = {"name": "T", "type": type_, "content": content, "slide_id": slide_id}
        ctx = await resolver.resolve_context("slide", meta, "user-1", institute)
        return resolver, ctx
    return asyncio.run(run())


def _extract_returning(monkeypatch, ext_for, calls=None):
    async def extract(ref, *, paid_permit=None):
        if calls is not None:
            calls.append((ref.slide_id, paid_permit))
        await asyncio.sleep(0.01)
        return ext_for(ref)
    monkeypatch.setattr(registry, "extract", extract)


def test_cached_scorm_fills_content():
    cached = "Lesson content:\n" + LESSON
    resolver, ctx = _resolve(FakeDb({"scorm-1:h1": cached}), "scorm-1")
    assert ctx["context_data"]["content"] == cached
    assert ctx["context_data"]["type"] == "SCORM"
    assert resolver.pending_lesson is None


def test_other_institute_is_not_read(isolated):
    resolver, ctx = _resolve(FakeDb(), "scorm-1", institute="someone-else")
    assert ctx["context_data"]["content"] == ""
    assert ctx["context_data"]["type"] == "DOCUMENT"
    assert resolver.pending_lesson is None and isolated.described == []


@pytest.mark.parametrize("slide_id", ["doc-1", "quiz-1", "vimeo-1"])
def test_types_with_their_own_path_are_left_alone(slide_id):
    resolver, ctx = _resolve(FakeDb(), slide_id, content="<p>Own text</p>")
    assert ctx["context_data"]["content"] == "Own text"
    assert resolver.pending_lesson is None


def test_youtube_miss_waits_for_captions_and_keeps_description(monkeypatch, isolated):
    calls = []
    head = registry.title_segment(SLIDES["yt-1"][1])
    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "captions", status="READY", segments=[
        head,
        Segment(text="Clouds form when air cools.", anchor="time", t_start_ms=0),
        Segment(text="Warm air rises.", anchor="time", t_start_ms=95_000),
    ]), calls)

    async def run():
        resolver = crs.ContextResolverService(FakeDb())
        meta = {"name": "T", "type": "VIDEO", "content": "Chapter intro video", "slide_id": "yt-1"}
        ctx = await resolver.resolve_context("slide", meta, "user-1", INSTITUTE)
        assert ctx["context_data"] == meta                                 # read pending: unchanged
        text = await lts.wait_for_text(resolver.pending_lesson, timeout=2)
        lts.apply(ctx["context_data"], resolver.pending_lesson, text)
        assert ctx["context_data"]["type"] == "VIDEO"
        return ctx["context_data"]["content"]

    content = asyncio.run(run())
    assert content == ("Chapter intro video\n\nVideo transcript (captions):\n"
                       "[0:00] Clouds form when air cools.\n\n[1:35] Warm air rises.")
    assert calls == [("yt-1", None)]                                       # free: no permit
    assert isolated.stored["yt-1:h1"].startswith("Video transcript")


def test_two_learners_on_one_lesson_read_it_once(monkeypatch):
    calls = []
    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "scorm", segments=[Segment(text=LESSON)]),
                       calls)

    async def run():
        meta = {"name": "T", "slide_id": "scorm-1", "content": "", "type": "DOCUMENT"}
        first = crs.ContextResolverService(FakeDb())
        ctx = await first.resolve_context("slide", meta, "u1", INSTITUTE)
        assert ctx["context_data"] == meta                                 # unchanged until there is text
        second = crs.ContextResolverService(FakeDb())
        await second.resolve_context("slide", meta, "u2", INSTITUTE)
        return await lts.wait_for_text(first.pending_lesson, timeout=2)

    assert asyncio.run(run()) == "Lesson content:\n" + LESSON
    assert len(calls) == 1


def test_drawing_file_id_skips_the_pdf_path(monkeypatch):
    # FakeDb raises on any other query, including the PDF ownership gate.
    resolver, ctx = _resolve(FakeDb({"drawing-1:h1": "Text on the drawing:\nWater cycle"}), "drawing-1",
                             content="487fc9b7-e886-4a6a-a517-123162a99fa7")
    assert ctx["context_data"]["content"] == "Text on the drawing:\nWater cycle"
    assert ctx["context_data"]["type"] == "PRESENTATION"


def test_audio_transcript_on_the_slide_needs_no_read(monkeypatch):
    async def boom(*_a, **_k):
        raise AssertionError("an inline transcript must not be read")
    monkeypatch.setattr(registry, "extract", boom)
    resolver, ctx = _resolve(FakeDb(), "audio-1")
    assert ctx["context_data"]["content"] == "Transcript:\nToday we study clouds."
    assert resolver.pending_lesson is None


def test_untranscribed_upload_is_not_cached(monkeypatch, isolated):
    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "transcript", status="NEEDS_PAID"))
    lesson = lts.Lesson(ref=SLIDES["upload-1"][1])
    assert asyncio.run(lts.wait_for_text(lesson, timeout=2)) == ""
    assert isolated.stored == {}
    data = {"content": "Video description", "type": "VIDEO"}
    lts.apply(data, lesson, "")
    assert data == {"content": "Video description", "type": "VIDEO"}   # no text: untouched


def test_empty_is_cached_and_failed_is_not_retried_at_once(monkeypatch, isolated):
    calls = []
    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "scorm", status="EMPTY"), calls)
    lesson = lts.Lesson(ref=SLIDES["scorm-1"][1])
    asyncio.run(lts.wait_for_text(lesson, timeout=2))
    assert isolated.stored == {"scorm-1:h1": ""}

    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "captions", status="FAILED"), calls)
    yt = lts.Lesson(ref=SLIDES["yt-1"][1])

    async def twice():
        await lts.wait_for_text(yt, timeout=2)
        await lts.wait_for_text(yt, timeout=2)

    asyncio.run(twice())
    assert [c[0] for c in calls] == ["scorm-1", "yt-1"]


def test_prompt_text_is_capped():
    body = lts._as_prompt_text([Segment(text="x" * (lts.MAX_PROMPT_CHARS + 500))], "scorm")
    assert body.startswith("Lesson content:\n") and body.endswith("[...the rest of this lesson is not shown]")
    assert len(body) < lts.MAX_PROMPT_CHARS + 100


def test_long_recording_is_sampled_across_its_length():
    segs = [Segment(text=f"part {i} " + "y" * 200, anchor="time", t_start_ms=i * 30_000) for i in range(300)]
    body = lts._as_prompt_text(segs, "captions")
    assert body.startswith("Video transcript (captions), excerpts spread across the whole recording:\n[0:00]")
    assert len(body) < lts.MAX_PROMPT_CHARS + 120
    # Reaches the end of the 2.5 h video, not just its first minutes.
    assert "[2:24:00]" in body


def test_reads_on_the_turns_session_run_inside_a_savepoint():
    """A failed statement must not abort the chat turn's transaction (Postgres
    would fail every later query of the turn with InFailedSqlTransaction)."""
    from contextlib import contextmanager

    class SavepointDb(FakeDb):
        def __init__(self):
            super().__init__({"scorm-1:h1": "Lesson content:\nx"})
            self.open = 0
            self.outside = []

        @contextmanager
        def begin_nested(self):
            self.open += 1
            try:
                yield
            finally:
                self.open -= 1

        def execute(self, sql, params):
            if self.open == 0:
                self.outside.append(str(sql)[:40])
            return super().execute(sql, params)

    db = SavepointDb()
    lesson = lts.find_lesson(db, "scorm-1", INSTITUTE, "T")
    assert lesson is not None
    assert lts.cached_text(db, lesson) == (True, "Lesson content:\nx")
    assert db.outside == []


def test_stale_slide_id_is_not_used(isolated):
    """The app may send the previous slide's id while navigating: a lesson whose
    title is not the slide on screen must not replace the content."""
    resolver, ctx = _resolve(FakeDb({"scorm-1:h1": "Lesson content:\nx"}), "scorm-1")
    assert ctx["context_data"]["type"] == "SCORM"                      # same title: used

    async def run():
        meta = {"name": "Some PDF slide", "type": "DOCUMENT", "content": "", "slide_id": "scorm-1"}
        r = crs.ContextResolverService(FakeDb({"scorm-1:h1": "Lesson content:\nx"}))
        return r, await r.resolve_context("slide", meta, "user-1", INSTITUTE)

    resolver, ctx = asyncio.run(run())
    assert ctx["context_data"]["content"] == "" and ctx["context_data"]["type"] == "DOCUMENT"
    assert resolver.pending_lesson is None


def test_pdf_slide_still_takes_the_pdf_path(monkeypatch):
    """A PDF slide (fileId content) is not a lesson here: the existing PDF
    resolution runs exactly as before."""
    seen = []
    monkeypatch.setattr(crs, "file_belongs_to_institute", lambda db, fid, inst: seen.append(fid) or True)
    monkeypatch.setattr(crs, "get_cached_slide_text", lambda db, fid: "PDF text")
    fid = "487fc9b7-e886-4a6a-a517-123162a99fa7"
    resolver, ctx = _resolve(FakeDb(), "pdf-1", content=fid)
    assert ctx["context_data"]["content"] == "PDF text" and seen == [fid]
    assert resolver.pending_lesson is None


def test_transient_caption_result_is_not_cached_forever(monkeypatch, isolated):
    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "captions", status="EMPTY",
                                                           detail={"caption_transient": True}))
    asyncio.run(lts.wait_for_text(lts.Lesson(ref=SLIDES["yt-1"][1]), timeout=2))
    assert isolated.stored == {}


def test_a_finished_read_is_not_repeated(monkeypatch):
    calls = []
    _extract_returning(monkeypatch, lambda ref: Extraction(ref.slide_id, "transcript", status="NEEDS_PAID"), calls)
    lesson = lts.Lesson(ref=SLIDES["upload-1"][1])

    async def run():
        await lts.wait_for_text(lesson, timeout=2)
        await lts.wait_for_text(lesson, timeout=2)          # finished: from memory, no second read
        assert lts.cached_text(FakeDb(), lesson) == (True, "")

    asyncio.run(run())
    assert len(calls) == 1


def test_a_slow_read_frees_its_slot(monkeypatch):
    monkeypatch.setattr(lts, "READ_TIMEOUT_SECONDS", 0.05)

    async def hang(ref, *, paid_permit=None):
        await asyncio.sleep(5)

    monkeypatch.setattr(registry, "extract", hang)
    lesson = lts.Lesson(ref=SLIDES["scorm-1"][1])

    async def run():
        assert await lts.wait_for_text(lesson, timeout=2) == ""
        assert not lts._in_flight and lesson.cache_key in lts._failed

    asyncio.run(run())
