"""Video / PDF slides compiled from their own words (design §4.2) and the
credit estimate shown before preparing — the parts without a database."""
from app.services.tutor import compile_estimate, source_text
from app.services.tutor.compile_prompts import media_task_user_prompt
from app.services.tutor.slide_source import SlideSource, source_kind_label


def _src(**kw):
    base = dict(slide_id="s", title="T", source_type="VIDEO", source_id="v", kind="video", content_hash="h0")
    base.update(kw)
    return SlideSource(**base)


def test_source_kind_labels():
    assert source_kind_label(_src(ai_gen_video_id="vid_1", source_type="HTML_VIDEO")) == "ai_video"
    assert source_kind_label(_src(media_file_id="0a4b6f2e-1111-2222-3333-444455556666")) == "video_upload"
    assert source_kind_label(_src(media_url="https://youtu.be/abc123def45")) == "youtube"
    assert source_kind_label(_src(media_url="https://vimeo.com/1")) == "video_link"
    assert source_kind_label(_src(kind="pdf", source_type="DOCUMENT", media_file_id="f")) == "pdf"
    assert source_kind_label(_src(kind="quiz", source_type="QUIZ")) == "quiz"


def test_expected_text_kind_and_hash_change_with_text():
    up = _src(media_file_id="f1")
    assert source_text.expected_text_kind(up) == "transcript"
    assert source_text.expected_text_kind(_src(media_url="https://vimeo.com/1")) is None
    h_desc = source_text.hash_for(up, None)
    h_tr = source_text.hash_for(up, "transcript")
    assert h_desc == "h0" and h_tr != h_desc and h_tr == source_text.hash_for(up, "transcript")
    assert source_text.hash_for(_src(kind="document", source_type="DOCUMENT"), "pdf") == "h0"


def test_transcription_minutes_rounds_up_and_prefers_measured_duration():
    assert source_text.transcription_minutes(4672000) == 78
    assert source_text.transcription_minutes(None) == 0
    assert source_text.transcription_minutes(4672000, duration_seconds=61) == 2


def test_media_prompt_uses_the_material_words_when_present():
    with_text = media_task_user_prompt(slide_title="S", chapter_title=None, course_title=None, kind="video",
                                       description="teacher note", lang="en", transcript="hello world " * 5, text_kind="transcript")
    assert "TRANSCRIPT (speech recognition" in with_text and "teacher note" in with_text and "1 to 3 topics" in with_text
    assert "3 to 8 teaching concepts" in with_text
    without = media_task_user_prompt(slide_title="S", chapter_title=None, course_title=None, kind="pdf",
                                     description="teacher note", lang="hi")
    assert "Build ONE topic" in without and "read the document" in without


class _Plan:
    def __init__(self, status, content_hash, language="en", source_description=None):
        self.status, self.content_hash, self.language, self.source_description = status, content_hash, language, source_description


class _Est:
    def __init__(self, db):
        pass

    def estimate(self, key, params):
        if key == "tutor_compile_slide":
            return {"estimated_credits": 2}
        if key == "tutor_media_image":
            return {"estimated_credits": 1}
        if key == "transcription":
            return {"estimated_credits": max(2.0, 0.5 * float(params.get("audio_minutes") or 0))}
        if key == "html_document_pdf":
            return {"estimated_credits": 0.5 * float(params.get("num_pages") or 0)}
        raise ValueError(key)

    def estimate_with_balance(self, key, params, institute_id):
        return {"current_balance": 10}


def test_estimate_compile_per_kind(monkeypatch):
    sources = {
        "doc": _src(slide_id="doc", kind="document", source_type="DOCUMENT", content_hash="hd"),
        "doc_ok": _src(slide_id="doc_ok", kind="document", source_type="DOCUMENT", content_hash="hd2"),
        "up": _src(slide_id="up", media_file_id="f1", video_length_ms=4672000),
        "up_desc_only": _src(slide_id="up_desc_only", media_file_id="f2", video_description="what it teaches"),
        "yt": _src(slide_id="yt", media_url="https://youtu.be/abc123def45"),
        "link": _src(slide_id="link", media_url="https://vimeo.com/1"),
        "quiz": _src(slide_id="quiz", kind="quiz", source_type="QUIZ"),
    }
    monkeypatch.setattr(compile_estimate, "load_slide_source", lambda db, sid: sources.get(sid))
    monkeypatch.setattr(compile_estimate.plan_store, "latest_plans_for_slides", lambda db, ids: {"doc_ok": _Plan("READY", "hd2")})
    monkeypatch.setattr(compile_estimate, "ToolCostEstimator", _Est)
    monkeypatch.setattr(compile_estimate.source_text, "transcription_available", lambda: True)
    monkeypatch.setattr(compile_estimate.source_text, "transcript_cached", lambda db, fid: False)
    monkeypatch.setattr(compile_estimate.source_text, "pending_transcription_job", lambda db, fid: None)

    out = compile_estimate.estimate_compile(None, institute_id="i", slide_ids=list(sources) + ["missing"], language="en",
                                            generate_images=True, transcribe_videos=True, force=False)
    by = {r["slide_id"]: r for r in out["slides"]}
    assert by["doc"]["action"] == "compile" and by["doc"]["images_max"] == 4 and by["doc"]["total"] == 2
    assert by["doc_ok"]["action"] == "up_to_date" and by["doc_ok"]["total"] == 0
    assert by["up"]["action"] == "compile" and by["up"]["minutes"] == 78 and by["up"]["transcription"] == 39.0 and by["up"]["total"] == 41.0
    assert by["yt"]["text"] == "captions" and by["yt"]["total"] == 2
    assert by["link"]["action"] == "needs_details" and by["link"]["total"] == 0
    assert by["quiz"]["action"] == "skip"
    assert by["missing"]["action"] == "unpublished"
    t = out["totals"]
    assert t["to_compile"] == 4 and t["required"] == 2 + 41 + (2 + 5) + 2 and t["images_max"] == 4 and t["worst_case"] == t["required"] + 4
    assert out["balance"] == 10 and out["sufficient"] is False

    # Transcription off: the uploaded video with a slide-editor description compiles from it; the other parks.
    out2 = compile_estimate.estimate_compile(None, institute_id="i", slide_ids=["up", "up_desc_only"], language="en",
                                             generate_images=False, transcribe_videos=False, force=False)
    by2 = {r["slide_id"]: r for r in out2["slides"]}
    assert by2["up"]["action"] == "needs_details" and by2["up_desc_only"]["action"] == "compile" and by2["up_desc_only"]["transcription"] == 0


def test_estimate_prices_ocr_for_scanned_pdfs(monkeypatch):
    sources = {
        "scan": _src(slide_id="scan", kind="pdf", source_type="DOCUMENT", media_file_id="pf1", content_hash="hp"),
        "digital": _src(slide_id="digital", kind="pdf", source_type="DOCUMENT", media_file_id="pf2", content_hash="hp2"),
        "unknown": _src(slide_id="unknown", kind="pdf", source_type="DOCUMENT", media_file_id="pf3", content_hash="hp3"),
    }
    probes = {"pf1": {"pages": 7, "text_chars": 0, "scanned_pages": 7}, "pf2": {"pages": 3, "text_chars": 900, "scanned_pages": 0}}
    monkeypatch.setattr(compile_estimate, "load_slide_source", lambda db, sid: sources.get(sid))
    monkeypatch.setattr(compile_estimate.plan_store, "latest_plans_for_slides", lambda db, ids: {})
    monkeypatch.setattr(compile_estimate, "ToolCostEstimator", _Est)
    monkeypatch.setattr(compile_estimate.source_text, "transcription_available", lambda: True)
    monkeypatch.setattr(compile_estimate.source_text, "ocr_available", lambda: True)
    monkeypatch.setattr(compile_estimate.source_text, "pdf_probe", lambda db, fid: probes.get(fid))
    out = compile_estimate.estimate_compile(None, institute_id="i", slide_ids=list(sources), language="en",
                                            generate_images=False, transcribe_videos=True, ocr_pdfs=True, force=False)
    by = {r["slide_id"]: r for r in out["slides"]}
    assert by["scan"]["pages"] == 7 and by["scan"]["ocr"] == 3.5 and by["scan"]["total"] == 5.5
    assert by["digital"]["ocr"] == 0 and by["digital"]["total"] == 2 and "free" in by["digital"]["note"]
    assert by["unknown"]["ocr"] == 0 and "OCR" in by["unknown"]["note"]
    assert out["totals"]["ocr_pages"] == 7 and out["totals"]["ocr_credits"] == 3.5 and out["prices"]["ocr_per_page"] == 0.5
    off = compile_estimate.estimate_compile(None, institute_id="i", slide_ids=["scan"], language="en",
                                            generate_images=False, transcribe_videos=True, ocr_pdfs=False, force=False)
    assert off["slides"][0]["action"] == "needs_details"


def test_ai_video_url_is_not_a_media_url():
    from app.services.tutor.slide_source import _video

    class _DB:
        def execute(self, *_a, **_k):
            class R:
                def first(self):
                    return ("video-C1-CH2-SL2-16837f89", "video-C1-CH2-SL2-16837f89", 0)
            return R()

    src = _src(source_type="HTML_VIDEO", kind="other")
    _video(_DB(), src, "x", html_video=True)
    assert src.media_url is None and src.media_file_id is None and src.ai_gen_video_id == "video-C1-CH2-SL2-16837f89"
    assert source_kind_label(src) == "ai_video"


def test_long_recordings_are_prepared_in_two_steps():
    from app.services.tutor.source_text import (TranscriptionPending, expected_transcription_seconds,
                                                transcription_wait_budget, TRANSCRIBE_MAX_WAIT_SECONDS)
    assert expected_transcription_seconds(None) is None and transcription_wait_budget(None) == TRANSCRIBE_MAX_WAIT_SECONDS
    assert expected_transcription_seconds(10 * 60 * 1000) == 840          # 10 min of video ≈ 14 min of Whisper
    assert transcription_wait_budget(10 * 60 * 1000) == 840 + 600         # expected + 10 min slack
    assert transcription_wait_budget(4938958) == 0                        # the 82-min lecture: submit and park
    p = TranscriptionPending("job", 48.5, 57)
    assert "48% done" in str(p) and "57 min" in str(p) and p.job_id == "job"


def test_openrouter_transcription_helpers(monkeypatch):
    from app.services import openrouter_transcription as ot
    from app.services.tutor import source_text
    assert ot.chunk_plan(0) == 1 and ot.chunk_plan(600) == 1 and ot.chunk_plan(601) == 2 and ot.chunk_plan(4938.958) == 9
    assert ot.join_chunk_texts([" one ", "", "two", None]) == "one two"
    # provider / model come from platform settings with safe defaults
    monkeypatch.setattr("app.services.platform_settings_service.get_platform_setting", lambda key, default=None, **k: {"tutor.transcription.provider": "bogus"}.get(key, default))
    assert source_text.transcription_provider() == "openrouter" and source_text.transcription_model() == "openai/whisper-large-v3-turbo"
    monkeypatch.setattr("app.services.platform_settings_service.get_platform_setting", lambda key, default=None, **k: {"tutor.transcription.provider": "render"}.get(key, default))
    assert source_text.transcription_provider() == "render"


def test_whisper_filler_is_not_speech():
    from app.services.tutor.source_text import looks_like_speech
    assert not looks_like_speech("Music.  Thank you.  Thank you.  Thank you.  Thank you.  Thank you.  Thank you.  Music.  Thank you.  Thank you.", 500.7)
    assert not looks_like_speech("", 100) and not looks_like_speech("Hello there.", 10)
    real = ("You have built a winning product. Now the world beckons, but expanding globally is a high stakes game. "
            "How do you conquer new markets without losing your shirt or your control? Let's start on the safest squares.")
    assert looks_like_speech(real, 20)
    assert not looks_like_speech(real, 60 * 30)     # 40 words in half an hour is not a lecture
