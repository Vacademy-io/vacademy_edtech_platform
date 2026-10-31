"""Regressions for language-correct cached speech and bounded render retries."""
import ast
import asyncio
import json
import logging
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import ttscache, ttswarm
from app.callstate import CallState
from app.diagnostics import CallDiagnostics, verdict
from app.ttscache import Candidate, SpeechCache, cache_key, SAMPLE_RATE


def key(language):
    return cache_key(engine="smallest", model="lightning_v3.1_pro", voice="mrunal",
                     pace=1.05, temperature=0.5, sample_rate=SAMPLE_RATE,
                     term_map_version="", text="Perfect.", language=language)


def candidate(language="en"):
    return Candidate(key=key(language), text="Perfect.", chars=8, engine="smallest",
                     model="lightning_v3.1_pro", voice="mrunal", pace=1.05,
                     temperature=0.5, fixed=True, language=language)


@pytest.fixture
def cache(tmp_path, monkeypatch):
    settings = SimpleNamespace(speech_cache_dir=str(tmp_path), tts_cache_salt="test",
                               tts_cache_min_seen=2, tts_cache_min_blob_ms=200,
                               tts_cache_speech_enabled=True, tts_cache_llm_enabled=True,
                               tts_cache_agents=(), tts_cache_debug=False)
    monkeypatch.setattr(ttscache, "get_settings", lambda: settings)
    cache = SpeechCache()
    cache.open()
    assert cache.ready
    monkeypatch.setattr(ttswarm, "get_cache", lambda: cache)
    return cache


@pytest.mark.parametrize("language,expected", [("english", "en"), ("en-IN", "en"),
                                               ("hinglish", "hi"), ("hi-IN", "hi")])
async def test_live_and_one_shot_smallest_use_same_language(monkeypatch, language, expected):
    from app.main import _smallest_tts_wav
    from app.providers import _smallest_language
    sent = []

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def send(self, data):
            sent.append(json.loads(data))

        async def recv(self):
            return '{"status":"complete"}'

    monkeypatch.setattr("websockets.connect", lambda *args, **kwargs: Socket())
    await _smallest_tts_wav("Perfect.", "mrunal", "lightning_v3.1_pro", 1.05, language)
    assert sent[0]["language"] == _smallest_language(language).value == expected


async def test_warm_audio_is_reused_only_by_the_matching_live_language(cache, monkeypatch):
    from app.diagnostics import CallDiagnostics
    pcm = b"\x01\x02" * (SAMPLE_RATE // 2)
    requests = []

    async def synthesize(**kwargs):
        requests.append(kwargs)
        return pcm

    monkeypatch.setattr(ttswarm, "synthesize", synthesize)
    assert await ttswarm.warm(engine="smallest", model="lightning_v3.1_pro", voice="mrunal",
                              pace=1.05, temperature=0.5, texts=["Perfect."],
                              language="english") == {"warmed": 1, "skipped": 0, "failed": 0}
    assert requests[0]["language"] == "en"
    assert key("english") == key("en-IN") != key("hinglish")

    class TTS:
        _push_text_frames = True
        vendor_calls = 0

        async def run_tts(self, text, context_id=None):
            self.vendor_calls += 1
            if False:
                yield

        async def start_ttfb_metrics(self):
            pass

        async def stop_ttfb_metrics(self):
            pass

    for language, hits in [("en-IN", 1), ("hinglish", 0)]:
        tts, diag = TTS(), CallDiagnostics()
        ttscache.install_tts_cache(tts, engine="smallest", model="lightning_v3.1_pro",
                                  voice="mrunal", pace=1.05, temperature=0.5,
                                  language=language, cache_mode="FULL", cache=cache, diag=diag)
        frames = [frame async for frame in tts.run_tts("Perfect.", "context")]
        assert tts.vendor_calls == 1 - hits
        assert (diag.tts_cache_hits or 0) == hits
        assert any(type(f).__name__ == "TTSAudioRawFrame" for f in frames) == bool(hits)


@pytest.mark.parametrize("engine,expected", [
    ("smallest", "lightning_v3.1"),
    ("smallest_pro", "lightning_v3.1_pro"),
    ("smallest:lightning_v3.1_pro", "lightning_v3.1_pro"),
    ("smallest:v3.1", "lightning_v3.1"),
])
async def test_warm_on_save_resolves_the_same_model_as_live(cache, monkeypatch, engine, expected):
    from app import providers
    monkeypatch.setattr(providers, "get_settings",
                        lambda: SimpleNamespace(smallest_model="lightning_v3.1"))
    sent = []

    async def synthesize(**kwargs):
        sent.append(kwargs)
        return b"\x01\x02" * (SAMPLE_RATE // 2)

    monkeypatch.setattr(ttswarm, "synthesize", synthesize)
    result = await ttswarm.warm(engine=engine, model="", voice="mrunal", pace=1.05,
                                temperature=0.5, texts=["Perfect."], language="english")
    assert result["warmed"] == 1
    assert sent[0]["engine"] == "smallest"
    assert sent[0]["model"] == providers.smallest_model_for(engine) == expected
    assert sent[0]["language"] == "en"


async def test_preview_cache_separates_languages_and_reuses_equivalent_tags(tmp_path, monkeypatch):
    from app import main, providers
    settings = SimpleNamespace(smallest_api_key="test-only", smallest_model="lightning_v3.1",
                               tts_cache_dir=str(tmp_path))
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    monkeypatch.setattr(providers, "get_settings", lambda: settings)
    calls = []

    async def synthesize(text, voice, model, pace, language):
        calls.append((model, language))
        return b"test-wave"

    async def evict():
        pass

    monkeypatch.setattr(main, "_smallest_tts_wav", synthesize)
    monkeypatch.setattr(main, "_evict_tts_cache_async", evict)
    for language in ("en-IN", "hi-IN", "en-US"):
        response = await main.preview(text="Perfect.", voice="mrunal", lang=language,
                                      pace=1.05, temperature=0.5, model="smallest_pro")
        assert response.status_code == 200
    assert calls == [("lightning_v3.1_pro", "en"), ("lightning_v3.1_pro", "hi")]
    assert len(list(tmp_path.glob("pv-*.wav"))) == 2


def test_language_survives_ladder_and_database_reopen(cache):
    cache.ladder([candidate("en"), candidate("hi")])
    reopened = SpeechCache(root=cache.root)
    reopened.open()
    assert {c.language for c in reopened.due()} == {"en", "hi"}


def test_old_ledger_migrates_without_rendering_unknown_smallest_language(tmp_path, cache):
    root = tmp_path / "legacy"
    root.mkdir()
    with sqlite3.connect(root / "ledger.db") as db:
        db.execute("CREATE TABLE seen(key TEXT PRIMARY KEY, engine TEXT, model TEXT, voice TEXT, "
                   "pace REAL, temperature REAL, text TEXT, chars INTEGER, count INTEGER, "
                   "fixed INTEGER, first_seen REAL, last_seen REAL)")
        db.execute("INSERT INTO seen VALUES('legacy','smallest','model','voice',1,.5,'Perfect.',8,9,1,0,0)")
        db.execute("INSERT INTO seen VALUES('other','sarvam','model','voice',1,.5,'Hello.',6,9,1,0,0)")
    old = SpeechCache(root=str(root))
    old.open()
    old.open()  # migration is idempotent
    assert old.ready
    assert [c.key for c in old.due()] == ["other"]


@pytest.mark.parametrize("result", [None, b"\x01\x02" * (SAMPLE_RATE * 46)])
async def test_bad_renders_back_off_then_stop_even_across_restarts(cache, monkeypatch, result):
    now, calls = [1000.0], []
    monkeypatch.setattr(ttscache.time, "time", lambda: now[0])

    async def synthesize(**kwargs):
        calls.append(kwargs)
        return result

    monkeypatch.setattr(ttswarm, "synthesize", synthesize)
    c = candidate()
    cache.ladder([c])
    for delay in (300, 1800, 1800):
        assert [r.key for r in cache.due()] == [c.key]
        assert not await ttswarm.render_candidate(cache, c)
        assert not await ttswarm.render_candidate(cache, c)  # manual warm respects budget
        cache = SpeechCache(root=cache.root)
        cache.open()
        assert cache.due() == []
        now[0] += delay
    now[0] += 86400
    assert cache.due() == []
    assert not cache.can_render(c.key)
    assert len(calls) == 3
    cache.forget(cache_key=c.key, dry_run=False)
    assert cache.can_render(c.key)


async def test_successful_retry_clears_failed_render_state(cache, monkeypatch):
    c = candidate()
    cache.ladder([c])
    cache.render_failed(c.key, "temporary outage")
    with cache._connect() as db:
        db.execute("UPDATE render_failure SET next_retry_at = 0")

    async def synthesize(**kwargs):
        return b"\x01\x02" * (SAMPLE_RATE // 2)

    monkeypatch.setattr(ttswarm, "synthesize", synthesize)
    assert await ttswarm.render_candidate(cache, c)
    assert cache.lookup(c.key, c.text) is not None
    assert cache.due() == []
    with cache._connect() as db:
        assert db.execute("SELECT count(*) FROM render_failure").fetchone()[0] == 0


async def test_concurrent_warm_and_sweep_render_only_once(cache, monkeypatch):
    calls = []

    async def synthesize(**kwargs):
        calls.append(kwargs)
        await asyncio.sleep(0.01)
        return b"\x01\x02" * (SAMPLE_RATE // 2)

    monkeypatch.setattr(ttswarm, "synthesize", synthesize)
    assert await asyncio.gather(*(ttswarm.render_candidate(cache, candidate()) for _ in range(3))) == [True] * 3
    assert len(calls) == 1


async def test_stalled_render_times_out_and_releases_the_warmer(cache, monkeypatch):
    cancelled = asyncio.Event()

    async def synthesize(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(ttswarm, "synthesize", synthesize)
    monkeypatch.setattr(ttswarm, "_RENDER_TIMEOUT_SECS", 0.01)
    assert not await ttswarm.render_candidate(cache, candidate())
    assert cancelled.is_set()
    assert not cache._lock.locked()
    assert not cache.can_render(candidate().key)


def speech_callbacks(flags, diag, now):
    # Execute the actual run_bot callbacks without starting its network/audio
    # pipeline. The scenario controls time and speaker transitions, not their code.
    from app import bot
    tree = ast.parse(Path(bot.__file__).read_text())
    run = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "run_bot")
    callbacks = ast.Module(body=[n for n in run.body if isinstance(n, ast.FunctionDef)
                                and n.name in {"_silence_cause", "set_user_speaking", "set_bot_speaking"}],
                           type_ignores=[])
    scope = dict(flags=flags, diag=diag, time=SimpleNamespace(time=lambda: now),
                 logger=logging.getLogger(__name__), corr="test",
                 outcome=SimpleNamespace(replay={"bot": []}, connected_at=100))
    exec(compile(callbacks, bot.__file__, "exec"), scope)
    return scope


@pytest.mark.parametrize("speaker", ["user", "bot"])
def test_speaking_over_someone_is_not_dead_air(speaker):
    flags = CallState(bot_stopped_t=100, user_stopped_t=99)
    flags["bot_speaking" if speaker == "user" else "user_speaking"] = True
    diag = CallDiagnostics(user_turns=1, bot_turns=1, tts_chars=100)
    scope = speech_callbacks(flags, diag, 117)
    scope[f"set_{speaker}_speaking"](True)
    assert diag.dead_air == []
    assert diag.silences == []
    assert "DEAD_AIR" not in verdict(diag)["faults"]
    if speaker == "user":
        assert diag.barge_ins == 1


def test_real_quiet_reply_gap_is_still_reported():
    flags = CallState(bot_stopped_t=100, user_stopped_t=105)
    diag = CallDiagnostics(user_turns=1, bot_turns=1, tts_chars=100)
    speech_callbacks(flags, diag, 112)["set_bot_speaking"](True)
    assert diag.dead_air == [7]
    assert verdict(diag)["faults"]["DEAD_AIR"] == "RED"


def test_callers_thinking_time_is_not_charged_to_bot():
    flags = CallState(bot_stopped_t=105, user_stopped_t=100)
    diag = CallDiagnostics(user_turns=1, bot_turns=1, tts_chars=100)
    speech_callbacks(flags, diag, 112)["set_user_speaking"](True)
    assert diag.dead_air == []
    assert diag.silences == [{"secs": 7, "cause": "caller_thinking"}]
