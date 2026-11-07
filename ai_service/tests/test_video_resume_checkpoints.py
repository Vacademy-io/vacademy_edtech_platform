"""AI-video generation survives deploys — the PIPELINE side (Phase 1).

A kill mid-HTML used to lose every finished shot, the per-shot narration and
the lesson teacher's paid Spatius job. The pipeline now hands each finished
artifact to the service's checkpoint uploader (`checkpoint_callback(kind,
paths)`), writes shot caches atomically, reuses restored per-shot TTS on an
auto resume, and re-polls a submitted teacher job (see test_lesson_teacher).

Also pinned here: an empty shot HTML is retried once on the different-vendor
fallback model before the fallback card ships, and the lesson fact-check is
told which proper nouns are correct.
"""
from __future__ import annotations

import inspect
import json
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List

import pytest

AI_SERVICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AI_SERVICE / "app/ai-video-gen-main"))
sys.path.insert(0, str(AI_SERVICE))

import automation_pipeline as ap  # noqa: E402

VGP = ap.VideoGenerationPipeline


def _bare(**attrs: Any) -> "ap.VideoGenerationPipeline":
    """An instance without __init__ (no clients / DB) for unit-level checks."""
    p = VGP.__new__(VGP)
    p._checkpoint_cb = None
    p._resume_mode = None
    for k, v in attrs.items():
        setattr(p, k, v)
    return p


def _recorder():
    calls: List[tuple] = []

    def cb(kind, paths):
        calls.append((kind, [Path(x).name for x in paths]))

    return calls, cb


# ── _checkpoint is best-effort ───────────────────────────────────────────────

def test_checkpoint_swallows_callback_errors_and_drops_missing_files(tmp_path):
    f = tmp_path / "a.json"
    f.write_text("{}")

    def boom(kind, paths):
        raise RuntimeError("uploader down")

    _bare(_checkpoint_cb=boom)._checkpoint("shot", [f])            # must not raise
    _bare()._checkpoint("shot", [f])                                # no callback → no-op

    calls, cb = _recorder()
    p = _bare(_checkpoint_cb=cb)
    p._checkpoint("tts", [f, tmp_path / "missing.mp3", None])
    p._checkpoint("tts", [tmp_path / "missing.mp3"])                # nothing left → not called
    p._checkpoint("shot", str(f))                                   # a single path is accepted
    assert calls == [("tts", ["a.json"]), ("shot", ["a.json"])]


def test_shot_cache_is_written_atomically_and_checkpointed(tmp_path, monkeypatch):
    calls, cb = _recorder()
    p = _bare(_checkpoint_cb=cb)
    cache = tmp_path / "shot_007_sub1.json"
    p._write_shot_cache(cache, {"entries": [{"id": "shot-7-sub1"}], "usage": {"total_tokens": 3}})
    assert json.loads(cache.read_text())["entries"][0]["id"] == "shot-7-sub1"
    assert calls == [("shot", ["shot_007_sub1.json"])]
    assert [x.name for x in tmp_path.iterdir()] == ["shot_007_sub1.json"]   # no temp left behind

    # A failing replace keeps the previous file whole, raises nothing and
    # does not checkpoint a half-written body.
    def bad_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(ap.os, "replace", bad_replace)
    p._write_shot_cache(cache, {"entries": [{"id": "NEW"}], "usage": {}})
    assert json.loads(cache.read_text())["entries"][0]["id"] == "shot-7-sub1"
    assert len(calls) == 1
    assert [x.name for x in tmp_path.iterdir()] == ["shot_007_sub1.json"]


def test_parallel_shot_writers_never_collide(tmp_path):
    calls, cb = _recorder()
    p = _bare(_checkpoint_cb=cb)
    cache = tmp_path / "shot_000.json"

    def w(i):
        p._write_shot_cache(cache, {"entries": [{"id": i, "pad": "x" * 20000}], "usage": {}})

    ts = [threading.Thread(target=w, args=(i,)) for i in range(16)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert json.loads(cache.read_text())["entries"][0]["id"] in range(16)
    assert len(calls) == 16 and [x.name for x in tmp_path.iterdir()] == ["shot_000.json"]


def test_every_shot_cache_write_site_goes_through_the_atomic_helper():
    src = inspect.getsource(VGP._generate_html_per_shot)
    assert "_cache_path.write_text(" not in src
    # DIALOGUE_SCENE, AI_VIDEO_HERO, template and the main per-shot write
    # (sub-shots share the main write with their _subK path).
    assert src.count("self._write_shot_cache(_cache_path,") == 4


def test_tts_checkpoint_collects_the_narration_set(tmp_path):
    (tmp_path / "tts").mkdir()
    for n in ("shot_000.mp3", "shot_000_raw.json", "shot_000_script.txt", ".shot_001.mp3.abc.tmp"):
        (tmp_path / "tts" / n).write_bytes(b"x")
    for n in ("narration.mp3", "narration_raw.json", "narration.words.json", "narration.words.csv"):
        (tmp_path / n).write_bytes(b"x")
    calls, cb = _recorder()
    _bare(_checkpoint_cb=cb)._checkpoint_tts(tmp_path)
    assert calls == [("tts", [
        "shot_000.mp3", "shot_000_raw.json", "shot_000_script.txt",
        "narration.mp3", "narration_raw.json", "narration.words.json", "narration.words.csv",
    ])]


def test_preamble_checkpoint_writes_the_final_reference_context(tmp_path):
    for n in ("routing_plan.json", "video_type.json", "host_plan.json"):
        (tmp_path / n).write_text("{}")
    calls, cb = _recorder()
    ref = {"text_context": "notes", "embeddable_images": [{"s3_url": "https://s3/a.png"}]}
    _bare(_checkpoint_cb=cb, _reference_context=ref)._checkpoint_preamble(tmp_path)
    assert json.loads((tmp_path / "reference_context.json").read_text()) == ref
    assert calls == [("preamble", [
        "routing_plan.json", "video_type.json", "host_plan.json", "reference_context.json",
    ])]
    # No reference material → no file, the plans still go.
    calls.clear()
    (tmp_path / "reference_context.json").unlink()
    _bare(_checkpoint_cb=cb, _reference_context=None)._checkpoint_preamble(tmp_path)
    assert calls == [("preamble", ["routing_plan.json", "video_type.json", "host_plan.json"])]


def test_run_signature_and_call_ordering():
    sig = inspect.signature(VGP.run)
    assert sig.parameters["checkpoint_callback"].default is None
    assert sig.parameters["resume_mode"].default is None
    src = inspect.getsource(VGP.run)
    # Narration is checkpointed before the lesson teacher job is submitted.
    tts_ck = src.index(
        "self._checkpoint_tts(run_dir)\n\n                    # Per-shot HTML generation using Director plan"
    )
    assert tts_ck < src.index("self._lesson_teacher_start(")
    # director_done → checkpoint before per-shot TTS; preamble at SCRIPT end.
    assert src.index('"director",') < src.index("self._run_per_shot_tts_v2(")
    assert src.index("self._checkpoint_preamble(run_dir)") < src.index('NO_AUDIO_TYPES = {"SLIDES"}')
    # Resumed-past-TTS legs no longer re-bill the narration.
    assert 'accumulate_usage({"tts_character_count": _resumed_tts_chars})' not in src
    assert 'total_usage["tts_character_count_resumed"]' in src
    # A resumed leg restores the reference context from run_dir.
    assert '"reference_context.json"' in src
    # The teacher thread checkpoints its job.
    assert 'self._checkpoint("teacher", paths)' in inspect.getsource(VGP._lesson_teacher_start)


# ── auto resume reuses the restored per-shot TTS ─────────────────────────────

def _tts_pipeline(tmp_path, mode):
    synth: List[str] = []
    p = _bare(_resume_mode=mode)

    def fake_synth(script_path, run_dir, **kw):
        synth.append(Path(script_path).read_text())
        Path(kw["output_audio_path"]).write_bytes(b"NEWMP3")
        Path(kw["output_response_json"]).write_text("{}")
        return {"audio_path": kw["output_audio_path"], "response_json": kw["output_response_json"],
                "tts_character_count": len(Path(script_path).read_text())}

    p._synthesize_voice = fake_synth
    return p, synth


def _restore_tts(tmp_path, idx, text):
    d = tmp_path / "tts"
    d.mkdir(exist_ok=True)
    (d / f"shot_{idx:03d}_script.txt").write_text(text)
    (d / f"shot_{idx:03d}.mp3").write_bytes(b"OLDMP3")
    (d / f"shot_{idx:03d}_raw.json").write_text('{"word_entries": []}')


def test_auto_resume_reuses_restored_shot_audio_for_the_same_text(tmp_path):
    _restore_tts(tmp_path, 3, "Light makes sugar.")
    p, synth = _tts_pipeline(tmp_path, "auto")
    r = p._synthesize_voice_for_shot(shot_idx=3, narration_text="  Light makes sugar. ", run_dir=tmp_path)
    assert synth == [] and r["cache_hit"] is True and r["char_count"] == len("Light makes sugar.")
    assert (tmp_path / "tts" / "shot_003.mp3").read_bytes() == b"OLDMP3"


@pytest.mark.parametrize("mode,text,corrupt", [
    (None, "Light makes sugar.", False),        # legacy legs always re-synthesise
    ("auto", "Light makes glucose.", False),    # text changed
    ("auto", "Light makes sugar.", True),       # corrupt raw json
])
def test_tts_is_re_synthesised_outside_a_clean_auto_cache_hit(tmp_path, mode, text, corrupt):
    _restore_tts(tmp_path, 3, "Light makes sugar.")
    if corrupt:
        (tmp_path / "tts" / "shot_003_raw.json").write_text("{trunc")
    p, synth = _tts_pipeline(tmp_path, mode)
    r = p._synthesize_voice_for_shot(shot_idx=3, narration_text=text, run_dir=tmp_path)
    assert synth == [text] and not r.get("cache_hit")


def test_per_shot_tts_reports_reused_characters_separately(tmp_path):
    _restore_tts(tmp_path, 0, "First shot words.")
    p, synth = _tts_pipeline(tmp_path, "auto")
    p._dialogue_scenes_enabled = False
    p._prepare_dialogue_scenes = lambda *a, **k: None
    p._concat_master_narration = lambda outs, run_dir: {
        "audio_path": run_dir / "narration.mp3", "raw_json_path": run_dir / "narration_raw.json",
        "total_duration_s": 9.0, "shot_offsets": []}
    p._reconcile_shot_timings_after_tts = lambda shots, offsets: None
    p._attach_per_shot_audio_urls = lambda **k: None
    events: List[Dict[str, Any]] = []
    p._emit_progress = events.append
    shots = [{"shot_index": 0, "narration_text": "First shot words.", "start_time": 0, "end_time": 4},
             {"shot_index": 1, "narration_text": "Second one.", "start_time": 4, "end_time": 9}]
    tts_outputs: Dict[str, Any] = {"deferred_to_html": True}
    p._run_per_shot_tts_v2(shots, tmp_path, tts_outputs)
    assert synth == ["Second one."]
    assert tts_outputs["tts_character_count"] == len("First shot words.") + len("Second one.")
    assert tts_outputs["tts_character_count_cached"] == len("First shot words.")
    done = [e for e in events if e.get("sub_stage") == "tts_done"][0]
    assert done["tts_character_count_cached"] == len("First shot words.")


# ── empty shot HTML: one retry on the non-GLM fallback, then the card ────────

def _single_shot_pipeline(chat):
    import single_shot_generator as ssg
    p = ssg._construct_pipeline("sk-test", quality_tier="free", html_model=None)
    ssg._attach_minimal_state(p, video_width=1920, video_height=1080)
    p.html_client.chat = chat
    p.script_client.chat = chat
    plan = ssg._build_one_shot_director_plan(
        gap_start=0, gap_end=6, speech_text="Plants make food from light.", user_hint=None,
        shot_type="TEXT_DIAGRAM", words_in_range=[],
    )
    return p, plan, ssg._default_style_guide()


GOOD_SHOT = json.dumps({"html": (
    "<div id='shot-root'><h1 id='t'>Photosynthesis</h1><script>(function(){"
    "if(typeof gsap==='undefined')return;gsap.to('#t',{opacity:1});})();</script></div>")})


@pytest.mark.parametrize("fallback_ok", [True, False])
def test_empty_shot_html_retries_once_on_the_fallback_model(tmp_path, fallback_ok):
    models: List[Any] = []

    def chat(messages, model=None, temperature=0.6, max_tokens=2000, response_format=None):
        models.append(model)
        if model == ap.NON_GLM_FALLBACK and fallback_ok:
            return GOOD_SHOT, {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12}
        return json.dumps({"html": ""}), {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}

    p, plan, sg = _single_shot_pipeline(chat)
    calls, cb = _recorder()
    p._checkpoint_cb = cb
    entries, _usage = p._generate_html_per_shot(
        director_plan=plan, style_guide=sg, words=[], run_dir=tmp_path, language="English",
    )
    assert models.count(ap.NON_GLM_FALLBACK) == 1 and models[0] != ap.NON_GLM_FALLBACK
    assert len(entries) == 1
    if fallback_ok:
        assert "Photosynthesis" in entries[0]["html"] and entries[0]["_shot_type"] != "FALLBACK"
        # the finished shot was cached atomically and checkpointed
        assert calls == [("shot", ["shot_000.json"])]
        assert json.loads((tmp_path / "shot_cache" / "shot_000.json").read_text())["entries"]
    else:
        assert entries[0]["_shot_type"] == "FALLBACK"           # the card, as before
        assert calls == []                                       # a card is not cached


def test_fallback_retry_helper_counts_tokens_and_never_raises():
    usage: Dict[str, Any] = {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}

    class Boom:
        def chat(self, **kw):
            raise RuntimeError("vendor down")

    p = _bare(html_client=Boom())
    assert p._retry_empty_shot_html(system_prompt="s", user_prompt="u", temperature=0.7, max_tokens=100,
                                    primary_model="z-ai/glm", usage=usage, log_label="Shot 1") is None

    class Ok:
        def chat(self, **kw):
            assert kw["model"] == ap.NON_GLM_FALLBACK and kw["messages"][1]["content"] == "u"
            return GOOD_SHOT, {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}

    p = _bare(html_client=Ok())
    data = p._retry_empty_shot_html(system_prompt="s", user_prompt="u", temperature=0.7, max_tokens=100,
                                    primary_model="z-ai/glm", usage=usage, log_label="Shot 1")
    assert "Photosynthesis" in data["html"] and usage["total_tokens"] == 32


# ── lesson fact-check gets the run's proper nouns ────────────────────────────

def test_lesson_fact_check_never_corrects_the_institute_name():
    import lesson_mode as lm
    seen: List[str] = []

    class Script:
        def chat(self, messages, **kw):
            seen.append(messages[1]["content"])
            return json.dumps({"errors": [
                {"board": "ITRC", "problem": "garbled heading, should be CHAPTER", "fix": "CHAPTER"}]}), {}

    class Html:
        def chat(self, **kw):  # a corrective regen must not be requested
            raise AssertionError("regen requested for a proper noun")

    plan = lm.normalize_lesson_plan({"teacher": {"avatar_id": "av", "name": "Riya"}, "subject": "Physics"})
    p = _bare(
        _lesson_plan=plan, script_client=Script(), html_client=Html(),
        _user_prompt_raw="Explain Newton's laws for ITRC batch 3",
        _current_branding={"watermark": {"enabled": True, "html": "<div>ITRC</div>"}},
        _current_brand_system_prompt=None,
    )
    p._resolve_stage_model = lambda stage: None
    rec = p._lesson_check_shot(
        html="<h1>ITRC</h1><p>F = ma</p>", shot={"narration_text": "Welcome to ITRC. Force equals mass times acceleration."},
        shot_idx=0, start_time=0.0, end_time=5.0, system_prompt="s", user_prompt="u",
        last_raw_response="{}", usage={},
    )
    assert rec["issues"] == [] and rec["shipped"] == "original"
    assert "KNOWN PROPER NOUNS" in seen[0] and "ITRC" in seen[0] and "Riya" in seen[0]
