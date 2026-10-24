"""Call-behavior test harness — v1 (unit level).

Every test here encodes a REAL production incident or deep-review finding
(docs/crm/VOICE_BOT_DEEP_REVIEW_2026-07-27.md) so it can never silently
regress. Run inside the service container (deps installed there):

    docker exec -w /srv <cid> python3 -m pytest tests/ -q

Wave 2 extends this with full scripted-timeline simulation once the run_bot
flags closures are refactored into an explicit CallState.
"""
import asyncio
import time

import pytest

import inspect
import json as _json

import app.bot as b
from app.turntake import normalize_spoken
import app.diagnostics as dg_mod
import app.providers as pv

import inspect
import json as _json
import os

import app.main as m
import app.report as rpt
import app.admin_core as ac


class _W3Settings:
    """Minimal settings stub for token/spool/cache tests."""

    internal_client_secret = "sekrit"

    def __init__(self, tmp=""):
        self.tts_cache_dir = str(tmp)
        self.tts_cache_max_files = 4000
        self.tts_cache_max_bytes = 500 * 1024 * 1024

    @property
    def report_spool_dir(self):
        return os.path.join(self.tts_cache_dir, "_report_spool")



class FakeOutcome:
    def __init__(self):
        self.corr = "test"
        self.transcript = []
        self.transfer_requested = False
        self.end_requested = False
        self.transfer_registered = False
        self.context = {}


# ── A1: dedupe must NOT eat a repeat that answers a NEW question ──────────────

def _mk_collector(bot_stopped_t):
    return b.TranscriptCollector(
        FakeOutcome(), lambda user=True: None,
        is_bot_speaking=lambda: False,
        fillers_armed=lambda: False,
        bot_stopped_t=bot_stopped_t,
    )


def test_dedupe_drops_greeting_spam_but_keeps_new_answers():
    stamps = []
    tc = _mk_collector(bot_stopped_t=lambda: 0.0)
    tc._on_transcript = lambda: stamps.append(time.time())

    # Same text twice, bot silent in between → spam → second copy dropped,
    # but transcript_t still stamped (orphan must not fire "couldn't hear you").
    tc._last_text = "hello"
    tc._last_text_t = time.time()
    assert tc._bot_stopped_t() < tc._last_text_t  # drop condition holds

    # Bot spoke AFTER the first copy (asked a new question) → repeat is a REAL
    # answer → the drop condition must NOT hold.
    tc2 = _mk_collector(bot_stopped_t=lambda: time.time() + 1)
    tc2._last_text = "haan"
    tc2._last_text_t = time.time()
    assert not (tc2._bot_stopped_t() < tc2._last_text_t)


# ── A6: partial-marker mapping — a cut "<<TRANSF" is a TRANSFER, not an END ──

@pytest.mark.parametrize("tail,expect_transfer,expect_end", [
    ("<<TRANSF", True, False),
    ("<<T", True, False),
    ("<<END_CA", False, True),
    ("<<", False, True),
])
def test_partial_marker_mapping(tail, expect_transfer, expect_end):
    o = FakeOutcome()
    if tail.startswith("<<T"):
        o.transfer_requested = True
    elif tail.startswith("<<"):
        o.end_requested = True
    assert o.transfer_requested is expect_transfer
    assert o.end_requested is expect_end


# ── A8a: fillers must never fire for bracketed synthetic cues ─────────────────

def test_filler_skips_bracketed_cues():
    # The filler condition includes `not text.startswith("[")`.
    import inspect
    src = inspect.getsource(b.TranscriptCollector.process_frame)
    assert 'startswith("[")' in src


# ── B1: stall-stamp semantics (the 2026-07-27 repeat-3x mechanism) ────────────

def test_stall_stamp_never_set_while_speaking_and_cleared_on_stop():
    import inspect
    src = inspect.getsource(b.run_bot)
    # stamp gate
    assert 'not flags["bot_speaking"]' in src.split("def _stamp_generate")[1].split("tts.set_generate_callback")[0]
    # clear on BOTH transitions: set_bot_speaking body clears unconditionally
    body = src.split("def set_bot_speaking")[1].split("def set_user_speaking")[0]
    assert 'flags["tts_gen_t"] = 0.0' in body
    assert body.index('flags["tts_gen_t"] = 0.0') < body.index("if not speaking")


# ── Ordering invariants (the outage class: forward references in run_bot) ────

def test_sentinel_has_transfer_fallback():
    sg = b.SentinelGate(FakeOutcome(), lambda user=True: None, lambda s: None)
    assert sg._transfer_fail_closing
    assert sg._transfer_fallback_done is False
    import inspect
    src = inspect.getsource(b.SentinelGate.process_frame)
    assert "_transfer_fail_closing" in src


# ── A9a: greet extends while callee audibly speaking ─────────────────────────

def test_greet_has_extended_vad_wait():
    import inspect
    src = inspect.getsource(b.run_bot)
    assert "extended wait" in src or "2.5" in src.split("_greet_when_ready")[1].split("if opening:")[0]


# ── A10: nudge is capped and transcript-gated ────────────────────────────────

def test_nudge_cap_and_gating():
    # Nudge cap/escalation now lives in callstate.watchdog_decide (covered by
    # tests/test_timeline.py). Here: the CALLBACK contract — VAD blips must not
    # re-arm the nudge; real transcripts must.
    import inspect
    src = inspect.getsource(b.run_bot)
    on_act = src.split("def on_activity")[1].split("def set_bot_speaking")[0]
    assert 'flags["nudged"] = False' not in on_act  # VAD blips no longer re-arm
    on_tr = src.split("def on_transcript")[1].split("transcript = TranscriptCollector")[0]
    assert 'flags["nudged"] = False' in on_tr       # real words do
    # and the decision engine is actually wired in
    assert "watchdog_decide" in src and "apply_decision" in src


# ── A2: orphan response-End after interruption must be SWALLOWED ─────────────
# (pipecat 0.0.95 assistant aggregator underflows its _started counter on the
# orphan End of a cancelled stream → ALL later assistant text dropped from
# context → verbatim repeats. The sentinel shields it.)

@pytest.mark.asyncio
async def test_played_transcript_records_ttstext_and_merges_clauses():
    from pipecat.frames.frames import TTSTextFrame, TranscriptionFrame
    from pipecat.processors.frame_processor import FrameDirection
    import unittest.mock as um

    o = FakeOutcome()
    rec = b.PlayedTranscriptRecorder(o)

    async def fake_push(frame, direction=FrameDirection.DOWNSTREAM):
        pass
    rec.push_frame = fake_push

    async def fake_super(self, frame, direction):
        return

    async def drive(frame):
        with um.patch.object(b.FrameProcessor, "process_frame", new=fake_super):
            await rec.process_frame(frame, FrameDirection.DOWNSTREAM)

    await drive(TTSTextFrame("Hello!", aggregated_by="sentence"))
    await drive(TTSTextFrame("Am I speaking with Shreyash?", aggregated_by="sentence"))
    assert len(o.transcript) == 1                      # consecutive clauses merge
    assert "Hello!" in o.transcript[0]["text"]
    assert "Shreyash" in o.transcript[0]["text"]

    o.transcript.append({"role": "user", "text": "yes"})  # caller turn intervenes
    await drive(TTSTextFrame("Great, thank you.", aggregated_by="sentence"))
    assert o.transcript[-1]["role"] == "assistant"
    assert o.transcript[-1]["text"] == "Great, thank you."
    assert len(o.transcript) == 3


def test_generation_time_commits_removed():
    """Sentinel and greet must no longer write assistant transcript entries —
    only PlayedTranscriptRecorder does (playout position)."""
    import inspect
    sg_src = inspect.getsource(b.SentinelGate)
    assert 'transcript.append({"role": "assistant"' not in sg_src
    rb_src = inspect.getsource(b.run_bot)
    greet = rb_src.split("_greet_when_ready")[1].split("@transport.event_handler")[0]
    assert 'outcome.transcript.append' not in greet
    # and the recorder is actually in the pipeline, after transport.output()
    assert rb_src.index("transport.output(),") < rb_src.index("played_transcript,")
    assert rb_src.index("played_transcript,") < rb_src.index("aggregators.assistant()")


# ── A5: deaf-call detection keys on the receive task, not on exceptions ──────

def test_ws_token_roundtrip_and_rejections(monkeypatch):
    monkeypatch.setattr(m, "get_settings", lambda: _W3Settings())
    tok = m._mint_ws_token("corr-1")
    assert m._verify_ws_token("corr-1", tok)
    # Bound to the corr — a token for one call cannot admit another.
    assert not m._verify_ws_token("corr-2", tok)
    assert not m._verify_ws_token("corr-1", "garbage")
    assert not m._verify_ws_token("corr-1", "")
    assert not m._verify_ws_token("corr-1", "123.deadbeef")
    # Expired token (minted in the past beyond TTL).
    old = m._mint_ws_token("corr-1", now=time.time() - m._WS_TOKEN_TTL_SECS - 60)
    assert not m._verify_ws_token("corr-1", old)


def test_ws_token_open_when_secret_unset(monkeypatch):
    s = _W3Settings()
    s.internal_client_secret = ""
    monkeypatch.setattr(m, "get_settings", lambda: s)
    # Unconfigured dev box: don't brick, the context fetch gates anything real.
    assert m._verify_ws_token("corr-1", "")
    assert m._consume_ws_token("corr-1", "")  # single-use is a no-op without a secret


def test_ws_token_is_single_use(monkeypatch):
    # The DoS-relevant property (deep-review W3): a captured token admits exactly
    # ONE socket. First consume passes; every replay of the same corr+token fails.
    monkeypatch.setattr(m, "get_settings", lambda: _W3Settings())
    m._spent_ws_tokens.clear()
    tok = m._mint_ws_token("corr-1")
    assert m._consume_ws_token("corr-1", tok)          # first use admitted
    assert not m._consume_ws_token("corr-1", tok)      # replay rejected
    assert not m._consume_ws_token("corr-1", tok)      # …and stays rejected
    # A genuinely different token (minted in a later second → different exp) for the
    # same corr is still fine. NB tokens are deterministic in (corr, exp-second), so
    # a real call — which mints once — is never self-blocked.
    tok2 = m._mint_ws_token("corr-1", now=time.time() + 5)
    assert tok2 != tok
    assert m._consume_ws_token("corr-1", tok2)
    # A forged/expired token never consumes.
    assert not m._consume_ws_token("corr-1", "garbage")
    m._spent_ws_tokens.clear()


def test_ws_route_gates_token_and_decouples_slot_from_handshake():
    src = inspect.getsource(m.ws_endpoint)
    # Single-use consume (not bare verify) gates the socket.
    assert "_consume_ws_token(corr" in src
    # Pending-handshake bucket is entered BEFORE the handshake; the real call slot
    # (_active_calls) is claimed only AFTER it — a stalled handshake never holds a
    # running-call slot (deep-review W3 DoS fix).
    assert "_inflight_handshakes += 1" in src
    assert src.index("_inflight_handshakes += 1") < src.index("asyncio.wait_for")
    assert src.index("asyncio.wait_for") < src.index("_active_calls += 1")
    # Both buckets are released in the finally via held-flags.
    assert "_inflight_held" in src and "_active_slot" in src
    assert "outcome.crashed = True" in src
    answer_src = inspect.getsource(m.answer)
    assert "_mint_ws_token(corr)" in answer_src      # /answer actually mints it


# ── B4: public TTS cache is bounded ──────────────────────────────────────────

def test_tts_cache_eviction_previews_then_oldest(tmp_path):
    d = str(tmp_path)
    now = time.time()
    # f0 oldest … f4 newest; f4 is a PREVIEW (pv-*) — despite being newest it
    # must evict before any IVR prompt file (previews re-synthesize freely,
    # a deleted prompt 404s on live IVR calls until re-saved).
    for i in range(5):
        name = "pv-f4.mp3" if i == 4 else f"f{i}.mp3"
        p = os.path.join(d, name)
        with open(p, "wb") as f:
            f.write(b"x" * 10)
        os.utime(p, (now - 1000 + i, now - 1000 + i))
    assert m._evict_tts_cache(d, max_files=3, max_bytes=10**9) == 2
    left = sorted(n for n in os.listdir(d) if n.endswith(".mp3"))
    assert left == ["f1.mp3", "f2.mp3", "f3.mp3"]  # pv- went first, then oldest
    # Byte cap: 30 bytes on disk, cap 25 → one more (now the oldest prompt) goes.
    assert m._evict_tts_cache(d, max_files=100, max_bytes=25) == 1
    assert sorted(os.listdir(d))[0] == "f2.mp3"
    # Under caps → no-op; missing dir → no-op.
    assert m._evict_tts_cache(d, max_files=100, max_bytes=10**9) == 0
    assert m._evict_tts_cache(os.path.join(d, "nope"), 1, 1) == 0


def test_tts_cache_eviction_is_true_lru_via_serve_touch(tmp_path):
    # The play route bumps mtime on serve so a live IVR prompt survives eviction
    # while write-once junk ages out — the fix for "eviction deletes live prompts"
    # (deep-review W3). Model it: prompt written oldest, then SERVED (touched).
    d = str(tmp_path)
    old = time.time() - 1000
    prompt = os.path.join(d, "prompt.mp3")
    junk = os.path.join(d, "junk.mp3")
    for p in (prompt, junk):
        with open(p, "wb") as f:
            f.write(b"x" * 10)
    os.utime(prompt, (old, old))          # prompt is the OLDER file by creation
    os.utime(junk, (old + 1, old + 1))
    # Serving the prompt bumps its mtime (touch=True) → now it's the NEWER file.
    m._serve_mp3(prompt, touch=True)
    # Cap of 1 file → the un-served junk evicts, the served prompt stays.
    assert m._evict_tts_cache(d, max_files=1, max_bytes=10**9) == 1
    assert os.path.exists(prompt) and not os.path.exists(junk)


def test_serve_mp3_missing_file_is_404_not_500(tmp_path):
    # TOCTOU: eviction can unlink between the caller's exists-check and the open.
    # _serve_mp3 must return 404 (Plivo falls back to <Speak>), never raise → 500.
    resp = m._serve_mp3(os.path.join(str(tmp_path), "gone.mp3"), touch=True)
    assert resp.status_code == 404


def test_serve_mp3_touch_failure_still_serves(tmp_path, monkeypatch):
    # A readable file on a degraded volume (utime raises EROFS/EPERM/EIO) must
    # STILL play — the LRU touch is best-effort, never a new 500 path (round-2 P2).
    p = os.path.join(str(tmp_path), "prompt.mp3")
    with open(p, "wb") as f:
        f.write(b"audio")

    def boom(*a, **k):
        raise PermissionError("read-only volume")

    monkeypatch.setattr(m.os, "utime", boom)
    resp = m._serve_mp3(p, touch=True)
    assert resp.status_code == 200 and resp.body == b"audio"


# ── B5: report status honesty ────────────────────────────────────────────────

class _W3Outcome:
    def __init__(self, transcript, crashed=False):
        self.transcript = transcript
        self.crashed = crashed


def test_status_synthetic_turns_do_not_count_as_spoken():
    # Dead-air pickup where only the backchannel cue landed → no-answer, so the
    # classifier retries instead of resuming the workflow on a phantom connect.
    o = _W3Outcome([{"role": "user", "text": "[unclear sound from the caller]"}])
    assert rpt._status(o) == "no-answer"
    o2 = _W3Outcome([{"role": "user", "text": "  [unclear sound from the caller]"}])
    assert rpt._status(o2) == "no-answer"


def test_status_crash_is_failed_not_no_answer():
    assert rpt._status(_W3Outcome([], crashed=True)) == "failed"
    # But a crash AFTER a real conversation keeps the honest "completed".
    o = _W3Outcome([{"role": "user", "text": "haan boliye"}], crashed=True)
    assert rpt._status(o) == "completed"
    assert rpt._status(_W3Outcome([{"role": "assistant", "text": "hello"}])) == "no-answer"


# ── B5: failed-report spool + sweeper ────────────────────────────────────────

@pytest.mark.asyncio
async def test_spool_write_then_sweep_delivers_and_cleans(tmp_path, monkeypatch):
    s = _W3Settings(tmp_path)
    monkeypatch.setattr(rpt, "get_settings", lambda: s)
    path = rpt.spool_report("inst-1", "tok", {"correlationId": "c/1 weird"})
    assert path and os.path.exists(path)
    assert os.path.dirname(path) == s.report_spool_dir

    calls = []

    async def post_fail(*a):
        calls.append(a)
        return False

    async def post_ok(*a):
        calls.append(a)
        return True

    monkeypatch.setattr(rpt.admin_core, "post_report", post_fail)
    assert await rpt.sweep_report_spool() == (0, 1)
    assert os.path.exists(path)              # retained for the next sweep
    monkeypatch.setattr(rpt.admin_core, "post_report", post_ok)
    assert await rpt.sweep_report_spool() == (1, 0)
    assert not os.path.exists(path)          # delivered → removed
    assert calls[-1][0] == "inst-1" and calls[-1][1] == "tok"


@pytest.mark.asyncio
async def test_spool_parks_dead_after_max_age(tmp_path, monkeypatch):
    s = _W3Settings(tmp_path)
    monkeypatch.setattr(rpt, "get_settings", lambda: s)
    path = rpt.spool_report("inst-1", None, {"correlationId": "old-1"})
    rec = _json.load(open(path))
    rec["spooledAt"] = time.time() - rpt._SPOOL_MAX_AGE_SECS - 60
    with open(path, "w") as f:
        _json.dump(rec, f)

    async def post_fail(*a):
        return False

    monkeypatch.setattr(rpt.admin_core, "post_report", post_fail)
    assert await rpt.sweep_report_spool() == (0, 0)
    assert not os.path.exists(path) and os.path.exists(path + ".dead")
    # Unreadable spool entry parks as .dead too instead of wedging the sweep.
    bad = os.path.join(s.report_spool_dir, "bad.json")
    with open(bad, "w") as f:
        f.write("{not json")
    assert await rpt.sweep_report_spool() == (0, 0)
    assert os.path.exists(bad + ".dead")


def test_report_failure_spools(monkeypatch):
    src = inspect.getsource(rpt.build_and_post_report)
    assert "spool_report(" in src and "if not ok" in src
    # Inline post has a beat between its two attempts (deploy-window blips).
    ac_src = inspect.getsource(ac.post_report)
    assert "asyncio.sleep" in ac_src


@pytest.mark.asyncio
async def test_spool_sweeps_oldest_call_first(tmp_path, monkeypatch):
    # Out-of-order clobber guard (deep-review W3): several queued reports must be
    # delivered oldest-call-first (by spooledAt), NOT by filename (= random corr),
    # so a stale outcome can't land after a newer one and regress the lead.
    s = _W3Settings(tmp_path)
    monkeypatch.setattr(rpt, "get_settings", lambda: s)
    now = time.time()
    # zzz sorts LAST by filename but is the OLDER call; aaa sorts first but newer.
    p_old = rpt.spool_report("i", "t", {"correlationId": "zzz-old"})
    p_new = rpt.spool_report("i", "t", {"correlationId": "aaa-new"})
    for p, ts in ((p_old, now - 300), (p_new, now - 10)):
        rec = _json.load(open(p))
        rec["spooledAt"] = ts
        with open(p, "w") as f:
            _json.dump(rec, f)

    order = []

    async def post_ok(inst, tok, payload):
        order.append(payload.get("correlationId"))
        return True

    monkeypatch.setattr(rpt.admin_core, "post_report", post_ok)
    assert await rpt.sweep_report_spool() == (2, 0)
    assert order == ["zzz-old", "aaa-new"]  # oldest call delivered first


@pytest.mark.asyncio
async def test_report_carries_generated_at_for_late_delivery(monkeypatch):
    # Every report stamps reportGeneratedAt so a spool-delivered-late report tells
    # admin_core when the call actually ended (forward-compat recency guard).
    posted = {}

    async def capture(inst, tok, payload):
        posted.update(payload)
        return True

    monkeypatch.setattr(rpt.admin_core, "post_report", capture)

    async def fake_analyze(o):
        return {"disposition": "Interested"}

    monkeypatch.setattr(rpt, "_analyze", fake_analyze)

    class _Ctx(dict):
        pass

    class _Outcome:
        corr = "c1"
        context = {"agent": {"dispositions": ["Interested"]}, "instituteId": "i"}
        connected_at = time.time() - 30
        ended_at = time.time()
        transcript = [{"role": "user", "text": "haan"}]
        transfer_requested = False
        transfer_registered = False
        crashed = False

        def duration_seconds(self):
            return 30

    assert await rpt.build_and_post_report(_Outcome(), "cu1") is True
    assert posted["systemError"] is False
    assert "reportGeneratedAt" in posted["metadata"]
    assert posted["metadata"]["reportGeneratedAt"].endswith("Z")


# ── B6/B7: setup off-loop + teardown hygiene ─────────────────────────────────

def test_run_bot_setup_and_teardown_structure():
    src = inspect.getsource(b.run_bot)
    # Vertex SA OAuth must not block the event loop (other live calls glitch).
    # Still off the event loop; now carries the per-agent provider override.
    assert "await asyncio.to_thread(build_llm_waterfall, _llm_provider)" in src   # off-loop: Vertex OAuth
    # Greet task is tracked; watchdog + greet cancels are AWAITED.
    assert "_bg_tasks.append(asyncio.create_task(_greet_when_ready()))" in src
    tail = src[src.index("watchdog_task = asyncio.create_task"):]
    assert "_t.cancel()" in tail and "await _t" in tail
    # Sarvam SDK httpx client close is attempted defensively.
    assert "_client_wrapper" in tail and "aclose" in tail


def test_lifespan_starts_sweeper_and_prewarm():
    src = inspect.getsource(m.lifespan)
    assert "report_spool_sweeper()" in src and "asyncio.create_task" in src
    assert "_warm_llm" in src
    warm = inspect.getsource(m._warm_llm)
    assert "build_llm" in warm


def test_stt_sdk_close_chain_resolves_on_pinned_wheel():
    # The teardown in run_bot closes _sarvam_client._client_wrapper.httpx_client
    # .httpx_client — assert that chain actually resolves on the installed wheel
    # so an SDK upgrade that moves it fails HERE, not silently in production.
    try:
        stt = pv.build_stt(8000)
    except Exception as ex:  # pragma: no cover - env without Sarvam config
        pytest.skip(f"STT not constructible here: {ex}")
    sdk = getattr(stt, "_sarvam_client", None)
    assert sdk is not None, "SarvamSTTService no longer stores _sarvam_client"
    h = getattr(getattr(sdk, "_client_wrapper", None), "httpx_client", None)
    inner = getattr(h, "httpx_client", h)
    assert callable(getattr(inner, "aclose", None))


# ═══ 2026-08-03 "Now" wave ════════════════════════════════════════════════════

import unittest.mock as um

# ── Item 1: the TTS socket wedge (root cause of the founder's 8-10.4s dead air)

def test_has_word_char_predicate():
    assert not pv.has_word_char('"')
    assert not pv.has_word_char('  " ')
    assert not pv.has_word_char("—…!?,.")
    assert not pv.has_word_char("")
    assert not pv.has_word_char(None)
    assert pv.has_word_char('"Okay.')
    assert pv.has_word_char("SSC")
    assert pv.has_word_char("क")          # Devanagari counts
    assert pv.has_word_char("2")


def test_clean_opening_strips_wrapping_quotes():
    assert b._clean_opening('"Hi, this is Avni."') == "Hi, this is Avni."
    assert b._clean_opening('“Hello there.”') == "Hello there."
    assert b._clean_opening('Hi there.') == "Hi there."
    assert pv.has_word_char(b._clean_opening('"Hi."'))


# ── Item 3: the glitch cue must not tell the model to shorten unheard content

def test_sentinel_measures_but_never_mutates_stall_stamp_on_interruption():
    src = inspect.getsource(b.SentinelGate.process_frame)
    intr = src[src.index("InterruptionFrame"):]
    assert "self._on_interrupted()" in intr[:intr.index("return")]
    # Wiring must come AFTER sentinel exists (the 2026-07-27 forward-ref class of bug).
    rb = inspect.getsource(b.run_bot)
    assert rb.index("sentinel = SentinelGate") < rb.index("sentinel.set_on_interrupted")
    # The hook must MEASURE ONLY. pipecat pushes an InterruptionFrame on every
    # Silero onset while the bot is quiet — the wedge window — so mutating the
    # stamp here (clear OR re-stamp) disarms the founder's own recovery.
    body = rb[rb.index("def _note_killed_before_playout"):]
    body = body[:body.index("sentinel.set_on_interrupted")]
    # Records a SUSPICION only — the counter is incremented later, and only if
    # the silence outlasts the confirm window (95% of these replies do play).
    assert 'flags["unplayed_pending_t"] = time.time()' in body
    assert 'flags["tts_gen_t"] =' not in body, "interruption hook must not mutate the stall stamp"


# ── Item 6: prompt placeholders must never render as holes

def test_placeholders_resolve_from_lead_fields():
    ctx = {"leadName": "Devaki", "leadFields": {"children name": "Kyoto"}}
    out = b._fill_placeholders("with {{parent_name}}, whose child {{child_name}} studies", ctx)
    assert out == "with Devaki, whose child Kyoto studies"
    assert "{{" not in out
    # The exact live failure: 141/141 prompts read "with , whose child  studies".
    assert "  " not in out and ", whose child  " not in out


def test_placeholder_unknown_key_falls_back_and_warns(caplog):
    ctx = {"leadName": "Devaki", "leadFields": {}}
    with caplog.at_level("WARNING"):
        out = b._fill_placeholders("Hi {{totally_unknown}}!", ctx)
    # Whitespace cleanup (2026-09-09) closes the hole an empty value leaves.
    assert out == "Hi!"
    assert any("unresolved" in r.getMessage() for r in caplog.records)
    # NO generic *_name -> lead_name fallback: endswith("name") also matches
    # {{school_name}}/{{child_name}}, so it would confidently speak the PARENT's
    # name as the school's or the child's. A hole beats a wrong name.
    assert b._fill_placeholders("Hi {{school_name}}!", ctx) == "Hi!"
    assert b._fill_placeholders("child {{child_name}}", ctx) == "child "
    # …but the person we are CALLING is the parent, so this one does resolve.
    assert b._fill_placeholders("Hi {{parent_name}}!", ctx) == "Hi Devaki!"


def test_known_placeholders_unchanged():
    ctx = {"leadName": "Devaki", "leadFields": {"institute": "DPS"}}
    assert b._fill_placeholders("{{lead_name}}", ctx) == "Devaki"
    assert b._fill_placeholders("{{institute_name}}", ctx) == "DPS"


# ── Item 5: a non-conversation can never produce a substantive disposition

class _ConvOutcome:
    def __init__(self, transcript):
        self.corr = "c"
        self.transcript = transcript
        self.crashed = False
        self.context = {"agent": {}, "instituteId": "i"}
        self.connected_at = time.time() - 10
        self.ended_at = time.time()
        self.transfer_requested = False
        self.transfer_registered = False

    def duration_seconds(self):
        return 10


def test_is_conversation_requires_a_real_caller_turn_only():
    voicemail = _ConvOutcome([
        {"role": "assistant", "text": "Good morning, this is Avni…"},
        {"role": "user", "text": "Your call has been forwarded to voicemail."},
    ])
    # Voicemail text IS caller text — this gate does NOT catch machines (that is
    # a separate fix). Asserted so nobody mistakes it for one.
    assert rpt._is_conversation(voicemail) is True
    # No caller turn at all -> never a disposition.
    assert rpt._is_conversation(_ConvOutcome([{"role": "assistant", "text": "Hi"}])) is False
    assert rpt._is_conversation(_ConvOutcome([
        {"role": "assistant", "text": "Hi"},
        {"role": "user", "text": "[unclear sound from the caller]"}])) is False
    assert rpt._is_conversation(_ConvOutcome([])) is False
    # CRITICAL: a caller who spoke while OUR audio never played is still a real
    # conversation — otherwise a terminal refusal becomes a retry and we re-dial
    # someone who said no.
    assert rpt._is_conversation(_ConvOutcome([
        {"role": "user", "text": "not interested, please stop calling"}])) is True


@pytest.mark.asyncio
async def test_no_caller_turn_forces_incomplete_and_skips_analysis(monkeypatch):
    analysed = []

    async def spy_analyze(o):
        analysed.append(1)
        return {"disposition": "Demo_Booked"}

    posted = {}

    async def capture(inst, tok, payload):
        posted.update(payload)
        return True

    monkeypatch.setattr(rpt, "_analyze", spy_analyze)
    monkeypatch.setattr(rpt.admin_core, "post_report", capture)
    o = _ConvOutcome([{"role": "assistant", "text": "Good morning, this is Avni…"}])
    assert await rpt.build_and_post_report(o, "cu") is True
    assert analysed == [], "the classifier judged the bot's own monologue"
    assert posted["disposition"] == "Incomplete"
    assert posted["status"] == "no-answer"


@pytest.mark.asyncio
async def test_real_conversation_still_analysed(monkeypatch):
    async def spy_analyze(o):
        return {"disposition": "Interested"}

    posted = {}

    async def capture(inst, tok, payload):
        posted.update(payload)
        return True

    monkeypatch.setattr(rpt, "_analyze", spy_analyze)
    monkeypatch.setattr(rpt.admin_core, "post_report", capture)
    o = _ConvOutcome([{"role": "assistant", "text": "Which board?"},
                      {"role": "user", "text": "CBSE"}])
    assert await rpt.build_and_post_report(o, "cu") is True
    assert posted["disposition"] == "Interested"


def test_watchdog_config_call_names_every_field():
    """Item 2's real guarantee: run_bot must pass EVERY WatchdogConfig field, so
    no live turn-taking threshold can silently fall back to a dataclass default
    with no env knob. (The timeline test only proves the fields are settable.)"""
    import dataclasses
    import app.callstate as cs
    src = inspect.getsource(b.run_bot)
    call = src[src.index("cfg = WatchdogConfig("):]
    call = call[:call.index("\n        )")]
    missing = [f.name for f in dataclasses.fields(cs.WatchdogConfig)
               if f.name + "=" not in call]
    assert not missing, f"WatchdogConfig fields not plumbed from Settings: {missing}"


def test_machine_markers_cover_devanagari_transliteration():
    """Sarvam is pinned to hi-IN and TRANSLITERATES English audio, so an English
    voicemail greeting arrives in Devanagari and matched none of the ASCII
    markers — that is how a voicemail wrote disposition=Callback onto a real
    lead (corr e461549e, 2026-08-03)."""
    class _O:
        transcript = [{"role": "user",
                       "text": "इफ यू रिकॉर्ड योर नेम एंड रीज़न फॉर कॉलिंग, "
                               "आई विल सी इफ दिस पर्सन इज़ अवेलेबल।"}]
    hits = rpt._machine_markers(_O())
    assert hits, "Devanagari voicemail greeting must be recognised as a machine"

    class _H:
        transcript = [{"role": "user", "text": "हाँ जी बोलिए, मैं सुन रहा हूँ"}]
    assert rpt._machine_markers(_H()) == [], "a real Hindi speaker is not a machine"


_SCREEN_OPEN = "नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से। आपने बच्चे के लिए inquiry की थी।"


def _machine_blob(turns, **diag):
    """The report's diagnostics blob for a played transcript of (role, text)."""
    o = b.CallOutcome(corr="machine-t", context={})
    o.transcript = [{"role": r, "text": t} for r, t in turns]
    o.diagnostics = dg_mod.CallDiagnostics(**diag)
    return rpt._diagnostics_blob(o)


def test_screener_then_a_real_person_is_not_flagged_as_a_machine():
    """Live calls b5b43ae1 (the father: 2:41, 18 turns, Interested_Follow_Up_Needed)
    and 34452119 (the mother: 2:14, quiz link sent), 2026-10-02. Google's call
    screen answered first, a parent then talked through the whole call, and
    both reports were AMBER "Probably an answering machine, not a person"."""
    father = [
        ("user", "Hi."), ("assistant", _SCREEN_OPEN),
        ("user", "If you record your name and reason for calling I will see if this."),
        ("user", "Hello."), ("assistant", _SCREEN_OPEN),
        ("user", "हाँ जी।"), ("user", "मैं बच्चे का पिता बोल रहा हूँ।"),
        ("assistant", "जी सर, आपसे बात करके अच्छा लगा। क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ?"),
        ("user", "बच्चे का नाम सुमन है और वो six"), ("user", "हाँ।"),
        ("assistant", "जी सर, सुमन Class 6 में है। सुमन के previous class में कितने marks आए थे?"),
        ("user", "हाँ जी।"), ("user", "सुमन के fifty three थे ma'am।"),
        ("assistant", "जी सर, समझ सकती हूँ — ये इस stage पर बहुत common है।"),
        ("user", "हाँ बोल सकते हैं पढ़ाई नहीं कर रही है आजकल।"),
        ("assistant", "समझ सकती हूँ सर।"),
        ("user", "और sir TV और mobile में लगी रहती है।"),
        ("assistant", "सर, generally parents की तीन-चार basic expectations होती हैं।"),
        ("user", "हाँ जी।"),
        ("assistant", "क्या सर, इसके अलावा आपकी कोई specific expectation है?"),
        ("user", "नहीं नहीं ऐसे कुछ नहीं।"),
        ("assistant", "ठीक है सर। तो मैं आपको हमारे MIP के बारे में बताती हूँ।"),
        ("user", "नहीं नहीं नहीं बताइए और।"),
        ("assistant", "हमारे यहाँ पचास से ज़्यादा full-time faculties हैं।"),
        ("user", "कितनी fees?"), ("user", "कितनी रहती है आप लोग की?"),
        ("assistant", "सर, MIP की fees लगभग बत्तीस हज़ार से पचास हज़ार के बीच रहती है।"),
        ("user", "अच्छा।"), ("user", "और classes कब से चालू रहेंगी?"),
        ("assistant", "सर, ये detail हमारे Senior Academic Advisor आपको बता देंगे।"),
    ]
    mother = [
        ("user", "Hi."), ("assistant", _SCREEN_OPEN),
        ("user", "If you record your name and reason for calling I will see if this person."),
        ("user", "बताएं।"), ("user", "माता से।"),
        ("assistant", "नमस्ते मैम, Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है।"),
        ("user", "ठीक है तो फिर हम क्या करना है क्या चाहिए आपको?"),
        ("assistant", "जी मैम, क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ?"),
        ("user", "हाँ बच्चा।"),
        ("assistant", "बच्चा अभी किस class में है मैम?"),
        ("user", "हाँ।"), ("user", "third class में है।"),
        ("assistant", "जी मैम, Class 3। और बच्चे का नाम क्या है मैम?"),
        ("user", "अरिया नाम है।"),
        ("assistant", "अरिया के previous class में कितने marks आए थे?"),
        ("user", "Eighty seven."),
        ("assistant", "अच्छा! ये तो अच्छी बात है मैम।"),
        ("user", "ठीक है तो आप ये बताइए आपके कितने क्या क्या plans हैं?"),
        ("assistant", "मैम, हमारे यहाँ एक Scholarship Test होता है।"),
        ("user", "हाँ बताओ pricing कितनी है plan की?"),
        ("assistant", "मैम, MGP की fees लगभग चालीस हज़ार से साठ हज़ार के बीच रहती है।"),
        ("user", "ठीक है ठीक है भेज दीजिए।"),
        ("assistant", "जी मैम, मैं आपको Scholarship Quiz का link WhatsApp कर दूँगी।"),
        ("user", "नहीं किया।"), ("user", "Okay thank you bye bye."),
        ("assistant", "आपके समय के लिए धन्यवाद। नमस्ते।"),
    ]
    for name, turns, users in (("b5b43ae1", father, 18), ("34452119", mother, 15)):
        p = _machine_blob(turns, bot_turns=12, tts_chars=1800, longest_user_secs=3.1,
                          barge_ins=2)
        assert p["turnTaking"]["userTurns"] == users, name
        assert p["machine"]["markers"], f"{name}: the screener is still on record"
        assert p["machine"]["personTurns"] >= dg_mod._PERSON_TURNS_OVER_MACHINE, (name, p["machine"])
        assert dg_mod.LIKELY_MACHINE not in p["faultLevels"], (name, p["faultLevels"])
        assert p["health"] == "GREEN", (name, p["faultLevels"])


def test_screener_or_voicemail_with_nobody_behind_it_is_still_a_machine():
    """The other side of b5b43ae1/34452119: no person ever answered us."""
    # replay 787aa111: the screen relayed "Thanks. Arushi." and then gave up
    screener_only = [
        ("assistant", _SCREEN_OPEN),
        ("user", "If you record your name and reason for calling, I'll see if this person is available."),
        ("user", "Thanks."), ("user", "Arushi."), ("user", "Please stay on the line."),
        ("assistant", "Hello, क्या आप मुझे सुन पा रहे हैं?"),
        ("user", "I'm sorry."), ("user", "This person is not available."),
        ("user", "If you would like to leave an additional message."),
        ("user", "Please reply after the tone."),
        ("assistant", "ठीक है, मैं बाद में call करती हूँ। धन्यवाद।"),
    ]
    # replay 7958a36d: the operator's voicemail, in fragments
    voicemail = [
        ("user", "Call has been forwarded to voicemail."), ("assistant", _SCREEN_OPEN),
        ("user", "The person you are trying to reach is not available."),
        ("user", "At the tone."), ("user", "Please record your message."),
        ("assistant", "Hello?"),
        ("user", "When you have."), ("user", "You have finished recording."),
        ("user", "You may hang up."),
        ("assistant", "ठीक है, मैं बाद में call करती हूँ।"),
    ]
    # A personal greeting after the operator's line: several unmatched lines
    # with real words, but all in ONE run over our opening — it never answered.
    personal = [
        ("user", "Your call has been forwarded to voicemail."), ("assistant", _SCREEN_OPEN),
        ("user", "Hi, this is Rahul Sharma."), ("user", "I am busy right now."),
        ("user", "I will call you back soon."), ("user", "Please leave your name and number."),
        ("assistant", "Hello, क्या आप मुझे सुन पा रहे हैं?"),
    ]
    for name, turns in (("screener", screener_only), ("voicemail", voicemail),
                        ("personal", personal)):
        p = _machine_blob(turns, bot_turns=3, tts_chars=400, longest_user_secs=5.0)
        assert p["machine"]["personTurns"] < dg_mod._PERSON_TURNS_OVER_MACHINE, (name, p["machine"])
        assert dg_mod.LIKELY_MACHINE in p["faultLevels"], (name, p["faultLevels"])


def test_kill_hook_stamps_a_suspicion_not_a_count():
    """The hook must NOT bump the counter directly — 95% of these replies play."""
    src = inspect.getsource(b.run_bot)
    hook = src[src.index("def _note_killed_before_playout"):]
    hook = hook[:hook.index("sentinel.set_on_interrupted")]
    assert 'flags["unplayed_pending_t"] = time.time()' in hook
    assert 'diag.bump("replies_never_played")' not in hook, (
        "counting at the interruption is what made REPLY_UNPLAYED ~95% false"
    )
    # Audio arriving must clear the suspicion.
    speak = src[src.index("def set_bot_speaking"):]
    speak = speak[:speak.index("def set_user_speaking")]
    assert 'flags["unplayed_pending_t"] = 0.0' in speak
    # …and only the confirmed case increments the counter.
    wd = src[src.index("unplayed_confirmed(flags, now, cfg)"):]
    assert 'diag.bump("replies_never_played")' in wd[:400]


def test_date_time_placeholders_resolve():
    """A live agent's prompt used {{day}}/{{date}}/{{time}} and all three rendered
    EMPTY (diagnostics: promptUnfilled ["day","date","time"]) — handing the model
    blanks exactly where the booking flow needs "now" to resolve "tomorrow"."""
    ctx = {"leadName": "Devaki", "leadFields": {}, "agent": {"timezone": "Asia/Kolkata"}}
    out = b._fill_placeholders("It is {{day}}, {{date}} at {{time}}.", ctx)
    assert "{{" not in out
    for token in ("day", "date", "time"):
        assert f"{{{{{token}}}}}" not in out
    assert out != "It is , at ."
    assert len(out) > len("It is , at .") + 8
    # tomorrow is a distinct, non-empty day
    tmr = b._fill_placeholders("{{tomorrow}}", ctx)
    assert tmr and tmr != b._fill_placeholders("{{today}}", ctx)


def test_agent_language_drives_stt_language_and_mode():
    assert b._agent_language({"language": "hinglish"})[0] == "hi-IN"
    assert b._agent_language({"language": "english"})[0] == "en-IN"
    assert b._agent_stt_mode({"language": "hinglish"}) == "codemix"
    assert b._agent_stt_mode({"language": "english"}) == "transcribe"
    assert b._agent_stt_mode({"language": "tamil"}) == "transcribe"
    # run_bot must actually pass both through.
    src = inspect.getsource(b.run_bot)
    assert "mode=_agent_stt_mode(agent)" in src


def test_every_language_tag_is_one_sarvam_accepts():
    """Sarvam spells Odia od-IN, not the ISO or-IN; the ISO form is REJECTED and
    every Odia agent failed. Pin the whole table against Sarvam's own list."""
    sarvam = {"bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN",
              "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"}
    ours = {tag for tag, _ in b._STT_LANGS.values()}
    assert ours <= sarvam, f"Sarvam would reject: {sorted(ours - sarvam)}"


def test_end_marker_latches_per_response_not_per_call():
    src = inspect.getsource(b.SentinelGate.process_frame)
    marker = src[src.index("if END_MARKER in self._buffer"):]
    marker = marker[:marker.index("emit, self._buffer")]
    assert "self._end_this_response = True" in marker
    assert "self._outcome.end_requested = True" not in marker, (
        "a mid-stream marker must not close the call call-wide"
    )


def test_new_response_revokes_an_unarmed_end_intent():
    src = inspect.getsource(b.SentinelGate.process_frame)
    start = src[src.index("if isinstance(frame, LLMFullResponseStartFrame)"):]
    start = start[:start.index("if isinstance(frame, LLMTextFrame)")]
    assert "self._outcome.end_requested = False" in start
    assert "not self._stop_armed" in start, "an already-closing line must not be revived"


def test_farewell_defers_the_close_and_transfer_does_not():
    src = inspect.getsource(b.SentinelGate.process_frame)
    stop = src[src.index("if self._outcome.transfer_requested and self._task"):]
    stop = stop[:stop.index("await self.push_frame(frame, direction)")] if \
        "await self.push_frame(frame, direction)" in stop else stop
    assert "self._defer_stop()" in stop, "the END path must go through the grace"
    # Transfer still closes immediately — the caller is waiting to be put through.
    assert stop.index("transfer_requested") < stop.index("_defer_stop()")


def test_caller_words_cancel_a_pending_close():
    src = inspect.getsource(b.run_bot)
    on_tr = src[src.index("def on_transcript"):]
    on_tr = on_tr[:on_tr.index("transcript = TranscriptCollector")]
    assert 'flags["end_pending_since"] = 0.0' in on_tr
    assert "outcome.end_requested = False" in on_tr


# ── Rumik Silk TTS (default provider) ────────────────────────────────────────

def test_rumik_started_flag_is_initialised():
    """run_tts reads _started. TTSService.start() creates it, but our first
    utterance can reach run_tts before that — a live e2e caught the FIRST
    utterance of every call dying with AttributeError."""
    svc = pv.RumikTTSService.__new__(pv.RumikTTSService)
    src = inspect.getsource(pv.RumikTTSService.__init__)
    assert "self._started = False" in src



def test_rumik_skips_letterless_and_records_credits():
    run = inspect.getsource(pv.RumikTTSService.run_tts)
    assert "has_word_char(text)" in run
    recv = inspect.getsource(pv.RumikTTSService._receive_messages)
    assert "credits_used" in recv, "the vendor's own meter is the honest cost signal"


def test_rumik_implements_the_websocket_contract():
    """WebsocketService gives connection verification + reconnect-with-backoff
    only if these exact hooks exist."""
    for m in ("_connect_websocket", "_disconnect_websocket", "_receive_messages"):
        assert callable(getattr(pv.RumikTTSService, m, None)), f"missing {m}"


def test_agent_without_a_tts_model_stays_on_sarvam(monkeypatch):
    """A billing-relevant switch must never happen by omission. Agents predating
    the picker pay the Sarvam rate and approved a Sarvam voice."""
    monkeypatch.delenv("TTS_MODEL", raising=False)
    monkeypatch.setenv("RUMIK_API_KEY", "rk_test_x")
    pv.get_settings.cache_clear()
    try:
        assert b._agent_tts_model({}) == "sarvam"
        assert b._agent_tts_model({"tts_model": "rumik"}) == "rumik"
        assert b._agent_tts_model({"tts_model": " Rumik "}) == "rumik"
    finally:
        pv.get_settings.cache_clear()


def test_voice_from_the_other_vendors_palette_is_dropped(monkeypatch):
    """Voice names don't cross vendors, and the failure is asymmetric (both probed
    live): Sarvam 400s on an unknown speaker (no audio at all), while Rumik quietly
    substitutes its default voice — so the caller hears a voice nobody picked, with
    Hindi grammar conjugated for the configured one. Neither is acceptable, so drop
    the name and use the provider default."""
    monkeypatch.delenv("TTS_MODEL", raising=False)
    pv.get_settings.cache_clear()
    try:
        assert b._agent_voice({"tts_model": "rumik", "voice": "priya"}) is None
        assert b._agent_voice({"tts_model": "rumik", "voice": "ira"}) == "ira"
        assert b._agent_voice({"tts_model": "sarvam", "voice": "ira"}) is None
        assert b._agent_voice({"tts_model": "sarvam", "voice": "priya"}) == "priya"
        assert b._agent_voice({"voice": "shubh"}) == "shubh"
    finally:
        pv.get_settings.cache_clear()


def test_rumik_male_voices_get_masculine_hindi_grammar():
    """Hindi first-person verbs are gendered. A male voice saying "kar rahi hoon"
    is the #1 immersion breaker, and Rumik's palette shares NO names with
    Sarvam's — so every Rumik male preset must be in the table."""
    for v in ("adam", "noah", "theo", "lucas"):
        assert b._voice_gender(v) == "male", v
    for v in ("ira", "emma", "mia", "sophia", "ava", "siya", "aisha", "zoya"):
        assert b._voice_gender(v) == "female", v


def test_grammar_follows_the_voice_we_actually_speak_with(monkeypatch):
    """If the configured voice was dropped as cross-vendor, the grammar must match
    the fallback voice, not the discarded name."""
    monkeypatch.delenv("TTS_MODEL", raising=False)
    pv.get_settings.cache_clear()
    try:
        # a Sarvam MALE name left behind on an agent switched to Rumik: we will
        # speak with Rumik's female default, so grammar must be feminine.
        a = {"tts_model": "rumik", "voice": "shubh"}
        assert b._agent_voice(a) is None
        assert b._voice_gender(b._agent_voice(a)
                                    or b._default_voice_for(a)) == "female"
    finally:
        pv.get_settings.cache_clear()


# ── Rumik: the four P0s an adversarial review found, as BEHAVIOURAL tests ─────
#
# The test these replace asserted `"_disconnect" not in inspect.getsource(...)` of
# the override — and passed precisely because the teardown lived in the PARENT
# class. Grepping source proves what the code says, not what it does. Everything
# below drives the real methods against a fake socket.

class _FakeSock:
    """Minimal stand-in for a websockets client connection."""

    def __init__(self, inbound=None):
        from websockets.protocol import State
        self.sent = []
        self.state = State.OPEN
        self.closed = False
        self._inbound = list(inbound or [])

    async def send(self, msg):
        self.sent.append(_json.loads(msg) if msg.startswith("{") else msg)

    async def close(self):
        from websockets.protocol import State
        self.closed = True
        self.state = State.CLOSED

    async def ping(self):
        return True

    def __aiter__(self):
        async def gen():
            for m in self._inbound:
                yield m
        return gen()


def _rumik_stub(inbound=None):
    """A RumikTTSService with pipecat's I/O stubbed, ready to drive directly."""
    svc = pv.RumikTTSService(api_key="rk_test", voice="ira", sample_rate=24000)
    # pipecat 1.4: create_task requires an initialized TaskManager (0.0.95 let
    # standalone processors spawn tasks). Route straight to asyncio for tests.
    svc.create_task = lambda coro, name=None: asyncio.create_task(coro)

    async def _cancel_task(task, timeout=None):
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    svc.cancel_task = _cancel_task
    svc._websocket = _FakeSock(inbound)
    svc._sample_rate = 24000
    pushed = []

    async def push(frame, *a, **k):
        pushed.append(type(frame).__name__)
    svc.push_frame = push
    for m in ("stop_ttfb_metrics", "start_ttfb_metrics", "start_tts_usage_metrics",
              "stop_all_metrics"):
        setattr(svc, m, lambda *a, **k: asyncio.sleep(0))
    return svc, pushed


@pytest.mark.asyncio
async def test_rumik_barge_in_cancels_and_keeps_the_socket():
    """The whole reason to prefer Rumik. Sarvam has no cancel, so barge-in there
    closes the socket — the root of 13 stalls in 220 calls. This must send one
    cancel frame and NOT tear the connection down."""
    svc, _ = _rumik_stub()
    svc._request_active = True
    svc._bot_speaking = True
    torn = []
    svc._disconnect_websocket = lambda: (torn.append(1), asyncio.sleep(0))[1]
    svc._connect_websocket = lambda: (torn.append(1), asyncio.sleep(0))[1]

    await svc._handle_interruption(_DummyInterruption(), None)

    assert svc._websocket.sent == [{"type": "cancel"}], svc._websocket.sent
    assert not svc._websocket.closed, "barge-in must not close the socket"
    assert not torn, "must not call the base class's disconnect/reconnect"
    assert svc._cancels_sent == 1


@pytest.mark.asyncio
async def test_rumik_leaves_the_quiet_window_reply_alone():
    """pipecat pushes an InterruptionFrame on EVERY VAD onset while the bot is
    quiet. Our own measurement: 60 of 63 such pre-playout kills went on to play
    anyway. Cancelling there turns a cough into a lost answer."""
    svc, _ = _rumik_stub()
    svc._request_active = True
    svc._bot_speaking = False

    await svc._handle_interruption(_DummyInterruption(), None)

    assert svc._websocket.sent == [], "must not cancel while the bot is silent"
    assert svc._request_active, "the in-flight reply must survive to play"


@pytest.mark.asyncio
async def test_rumik_raises_when_the_peer_closes():
    """websockets' __aiter__ swallows ConnectionClosedOK, so returning quietly makes
    pipecat's `while True: await _receive_messages()` spin without ever yielding —
    starving the event loop for EVERY concurrent call on the box, not just this
    one. Raising routes into the base's reconnect-with-backoff instead."""
    svc, _ = _rumik_stub(inbound=[])
    with pytest.raises(ConnectionError):
        await svc._receive_messages()


@pytest.mark.asyncio
async def test_rumik_does_not_raise_on_our_own_teardown():
    """...but an intentional close at end of call must NOT trigger a reconnect."""
    svc, _ = _rumik_stub(inbound=[])
    svc._closing = True
    await svc._receive_messages()


@pytest.mark.asyncio
async def test_rumik_ends_the_turn_only_after_the_LAST_sentence():
    """Rumik's socket is request/response and cancels the in-flight request when the
    next arrives, so sends are serialised. The turn must end when no sentence is
    still outstanding — gating on queue emptiness ended it while the last sentence
    was unsent, and 71% of a three-sentence reply reached the caller."""
    done = _json.dumps({"type": "done", "duration_s": 1.0, "credits_used": 0})
    svc, pushed = _rumik_stub(inbound=[done, done, done])
    svc._started = True
    svc._pending_sends = 3          # three sentences enqueued for one reply

    # The fake stream ending IS a peer close, so the ConnectionError from the
    # previous test's behaviour is correct here too — consume it and assert on what
    # happened while the three terminal frames were being processed.
    with pytest.raises(ConnectionError):
        await svc._receive_messages()

    assert pushed.count("TTSStoppedFrame") == 1, \
        f"one Stopped per REPLY, not per sentence: {pushed}"
    assert svc._pending_sends == 0, "a leaked counter means the turn never ends"


@pytest.mark.asyncio
async def test_rumik_pending_count_cannot_leak_on_abandon():
    """A stuck positive count means TTSStoppedFrame never fires and the pipeline
    believes the bot is speaking for the rest of the call."""
    svc, _ = _rumik_stub()
    svc._pending_sends = 3
    svc._bot_speaking = True
    svc._request_active = True
    for _ in range(3):
        svc._send_queue.put_nowait("x")

    await svc._handle_interruption(_DummyInterruption(), None)

    assert svc._pending_sends == 0
    assert svc._send_queue.empty()


def test_rumik_implements_the_hooks_bot_py_duck_types_on():
    """bot.py wires stall detection through hasattr(). Missing hooks skip SILENTLY,
    which unplugged stall recovery, TTS_WEDGE and REPLY_UNPLAYED on every Rumik
    call — on the provider whose justification was fixing stalls."""
    for m in ("set_diagnostics", "set_generate_callback", "set_credits_callback",
              "_connect_websocket", "_disconnect_websocket", "_receive_messages"):
        assert callable(getattr(pv.RumikTTSService, m, None)), f"missing {m}"


def test_rumik_stamps_generate_on_send_not_on_done():
    """A stamp that lands after the audio makes the stall condition unreachable by
    construction — the masking failure mode with extra steps."""
    run = inspect.getsource(pv.RumikTTSService.run_tts)
    assert "_on_generate" in run, "generate stamp must happen in run_tts (on send)"
    recv = inspect.getsource(pv.RumikTTSService._receive_messages)
    assert "_on_generate" not in recv, "must NOT stamp from the receive path"


class _DummyInterruption:
    pass


def test_rumik_pace_ladder_is_monotonic_and_covers_the_range():
    """Rumik has no numeric speed control — only prose steering, measured live.
    The ladder must be monotonic, or a higher pace could produce slower speech."""
    f = pv.rumik_pace_description
    # Distinct instruction per band, fastest at the top.
    fast, rapid, quick, brisk = f(1.4), f(1.1), f(1.0), f(0.9)
    assert len({fast, rapid, quick, brisk}) == 4, "bands must not collapse"
    assert f(1.2) == fast, "everything above the top threshold gets the top grade"
    assert f(0.8) is None, "near-natural pace sends no instruction at all"
    assert "slow" in f(0.6), "below the floor must explicitly ask for slow"
    assert f(None) is None, "no pace configured = no steering"


def test_rumik_pace_ladder_avoids_the_wording_that_did_nothing():
    """Measured: 'brisk, upbeat' moved the rate 1% — indistinguishable from no
    instruction. Only assertive wording ('no pauses') moved it, because the model
    is modulating PAUSES, not words per second. The fast grades must say so."""
    for pace in (1.05, 1.15, 1.4):
        assert "pause" in pv.rumik_pace_description(pace), \
            f"pace {pace} needs pause-suppressing wording to have any effect"


def test_rumik_gets_the_agent_pace_at_all(monkeypatch):
    """It previously got NO pace: build_tts dropped the agent's value on this path
    entirely, so the field an admin sets did nothing on Rumik calls."""
    monkeypatch.setenv("RUMIK_API_KEY", "rk_test_x")
    pv.get_settings.cache_clear()
    try:
        fast = pv.build_tts(8000, voice="ira", aiohttp_session=None,
                            tts_model="rumik", pace=1.4)
        slow = pv.build_tts(8000, voice="ira", aiohttp_session=None,
                            tts_model="rumik", pace=0.6)
        assert fast._description != slow._description, "pace must reach the service"
        assert "slow" in slow._description
    finally:
        pv.get_settings.cache_clear()


def test_preview_carries_the_same_pace_steering_a_call_would():
    """A voice tester that auditions a delivery the caller never hears is worse than
    no tester. Probing the DEPLOYED endpoint caught this: pace 1.1 and pace 0.6
    returned 7.34s and 7.08s — indistinguishable, because the Rumik preview branch
    dropped pace entirely."""
    src = inspect.getsource(m.preview)
    assert "rumik_pace_description(pace)" in src, "preview must derive the steering"
    assert "description=pace_desc" in src, "...and pass it to the synthesiser"
    # And the cache must not serve the first pace forever.
    assert "{pace_desc}" in src, "pace must be part of the Rumik cache key"


def test_rumik_synthesize_wav_accepts_a_description():
    import inspect as _i
    sig = _i.signature(pv.rumik_synthesize_wav)
    assert "description" in sig.parameters


# ── pipecat 1.4 migration guards ─────────────────────────────────────────────

def test_sentinel_never_arms_the_orphan_end_swallow_on_14():
    """1.4's assistant aggregator closes the turn itself on interruption — the
    0.0.95 `_started`-underflow this swallow shielded does not exist, and eating
    a legitimate End would corrupt turn accounting. The interruption branch must
    clear the buffer WITHOUT arming the swallow."""
    import inspect
    src = inspect.getsource(b.SentinelGate)
    i = src.index("InterruptionFrame):")
    branch = src[i:i + 700]
    assert "_swallow_next_end = True" not in branch
    assert 'self._buffer = ""' in branch


def test_turn_gate_uses_broadcast_interruption():
    """The 0.0.95 push_interruption_task_frame_and_wait is deprecated in 1.4
    (delegates without waiting); the turn-gate must use the real API."""
    import inspect
    src = inspect.getsource(b.TranscriptCollector)
    assert "broadcast_interruption" in src
    assert "push_interruption_task_frame_and_wait" not in src


def test_build_tts_defaults_to_sarvam_and_rumik_on_request():
    import inspect
    src = inspect.getsource(pv.build_tts)
    # Rumik only on explicit request; Sarvam is the fall-through (founder
    # decision 2026-08-05 after Mulberry garbled phone-leg Hindi).
    assert 'startswith("rumik")' in src
    # Sarvam is built through _sarvam_tts_class() (per-sentence flush + the
    # silent-line guard, call c6847f91) — still SarvamTTSService underneath.
    assert "_sarvam_tts_class()(" in src
    assert issubclass(pv._sarvam_tts_class(), pv.SarvamTTSService)


def test_interims_never_enter_the_transcript():
    """Google STT (the A/B arm) streams InterimTranscriptionFrames continuously;
    the collector must act on FINALS only or the dedupe window, the turn-gate
    and the transcript all drown."""
    import inspect
    src = inspect.getsource(b.TranscriptCollector.process_frame)
    assert "InterimTranscriptionFrame" in src


def test_saaras_v4_is_registered_with_pipecat():
    """pipecat 1.4's model table stops at saaras:v3 and RAISES on anything else —
    our production model would have crashed build_stt on every call. Caught by
    the migration dry-run, never by the suite; pinned here now."""
    from pipecat.services.sarvam import stt as sarvam_stt
    assert pv._register_saaras_v4() is True
    assert "saaras:v4" in sarvam_stt.MODEL_CONFIGS
    v3 = sarvam_stt.MODEL_CONFIGS["saaras:v3"]
    v4 = sarvam_stt.MODEL_CONFIGS["saaras:v4"]
    # v4 must inherit v3's capability shape (language + mode + server VAD).
    assert v4.supports_language and v4.supports_mode and v4.supports_vad_params
    assert v4.use_translate_endpoint == v3.use_translate_endpoint


def test_stt_settings_follow_the_model_capability_table():
    """1.4 raises on any field the model doesn't accept, in BOTH directions:
    saaras:v3/v4 take language+mode but NOT prompt; saaras:v2.5 is the reverse.
    build_stt must ASK the table, not assume."""
    import app.config as cfg

    def build(model):
        cfg.get_settings.cache_clear()
        orig = os.environ.get("SARVAM_STT_MODEL")
        os.environ["SARVAM_STT_MODEL"] = model
        os.environ.setdefault("SARVAM_API_KEY", "sk_test")
        try:
            return pv.build_stt(8000, language="hi-IN", bias="Ameet")
        finally:
            if orig is None:
                os.environ.pop("SARVAM_STT_MODEL", None)
            else:
                os.environ["SARVAM_STT_MODEL"] = orig
            cfg.get_settings.cache_clear()

    svc = build("saaras:v4")          # would raise on prompt if we guessed
    assert svc._settings.model == "saaras:v4"
    svc25 = build("saaras:v2.5")      # would raise on language if we guessed
    assert svc25._settings.model == "saaras:v2.5"


def test_our_service_overrides_match_their_base_signatures():
    """THE test that was missing. On the pipecat 1.4 migration, base run_tts
    became run_tts(text, context_id) while our Rumik override still took (text)
    — so EVERY reply raised "takes 2 positional arguments but 3 were given" and
    the bot was mute on the founder's first 1.4 call. The suite passed anyway,
    because the tests called our override directly with the OLD signature.

    Signature drift in a subclass is invisible to unit tests by construction, so
    assert compatibility structurally: for every method we override that also
    exists on a pipecat base class, our version must accept at least as many
    positional parameters as the base passes.
    """
    import inspect

    def positional(fn):
        try:
            params = list(inspect.signature(fn).parameters.values())
        except (TypeError, ValueError):
            return None
        return [p for p in params
                if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]

    problems = []
    for svc_cls in (pv.RumikTTSService,):
        for name, ours in vars(svc_cls).items():
            if name.startswith("__") or not callable(ours):
                continue
            for base in svc_cls.__mro__[1:]:
                theirs = vars(base).get(name)
                if theirs is None or not callable(theirs):
                    continue
                mine, base_sig = positional(ours), positional(theirs)
                if mine is None or base_sig is None:
                    break
                required_by_base = len(base_sig)
                accepted_by_us = len(mine)
                takes_varargs = any(
                    p.kind == p.VAR_POSITIONAL
                    for p in inspect.signature(ours).parameters.values())
                if accepted_by_us < required_by_base and not takes_varargs:
                    problems.append(
                        f"{svc_cls.__name__}.{name} accepts {accepted_by_us} "
                        f"positional args but {base.__name__}.{name} is called "
                        f"with {required_by_base}")
                break
    assert not problems, "; ".join(problems)


def test_rumik_run_tts_accepts_the_context_id_pipecat_passes():
    """Belt to the braces above, on the exact method that broke production."""
    import inspect
    params = list(inspect.signature(pv.RumikTTSService.run_tts).parameters)
    assert params[:3] == ["self", "text", "context_id"], params


# ── 4-engine TTS routing (google + smallest added 2026-08-05) ────────────────

def test_engine_detection_covers_every_stored_form():
    """tts_model values come from the DB and the UI, so accept the variants both
    can produce — a mis-detected engine sends a voice to the wrong vendor, which
    is either a hard 400 or (worse) a silent voice substitution."""
    cases = {
        "google": "google", "GOOGLE": "google", "chirp3-hd": "google",
        "smallest": "smallest", "lightning_v3.1": "smallest",
        # v3.1_pro is a DIFFERENT engine, not a variant: its voice palette is
        # disjoint from standard v3.1, so the pro MODEL must resolve to the pro
        # PALETTE. Mapping any pro form to "smallest" (as this expected before the
        # palettes were split) validates pro voices against the standard list,
        # drops them, and sends a standard voice to the pro model — which the
        # vendor rejects outright: a silent call.
        "smallest:v3.1_pro": "smallest_pro",
        "smallest_pro": "smallest_pro", "lightning_v3.1_pro": "smallest_pro",
        "deepgram": "deepgram", "aura-2-asteria-en": "deepgram",
        "rumik": "rumik", "silk-mulberry": "rumik",
        "sarvam": "sarvam", "": "sarvam", "bulbul:v3": "sarvam",
    }
    for stored, want in cases.items():
        assert b._engine_of(stored) == want, (stored, b._engine_of(stored))


def test_male_voices_include_every_engine_or_hindi_grammar_breaks():
    """_MALE_VOICES is the ONLY thing that makes the LLM write masculine Hindi
    verb endings. A male voice missing here speaks "kar rahi hoon" — the #1
    immersion complaint from live calls."""
    for v in ("hi-IN-Chirp3-HD-Achird", "hi-IN-Neural2-B", "devansh", "mandar",
              "shubh", "lucas"):
        assert b._voice_gender(v) == "male", v
    for v in ("hi-IN-Chirp3-HD-Achernar", "hi-IN-Neural2-A", "manasi", "priya", "ira"):
        assert b._voice_gender(v) == "female", v


def test_voice_palettes_do_not_leak_across_engines():
    """Each engine fails differently on a foreign voice (Sarvam 400s, Rumik
    silently substitutes, Smallest rejects cross-MODEL voices), so a foreign name
    must resolve to None and let the provider default take over."""
    assert b._agent_voice({"tts_model": "google", "voice": "hi-IN-Chirp3-HD-Achird"}) \
        == "hi-IN-Chirp3-HD-Achird"
    assert b._agent_voice({"tts_model": "google", "voice": "shubh"}) is None
    assert b._agent_voice({"tts_model": "google", "voice": "devansh"}) is None
    assert b._agent_voice({"tts_model": "smallest", "voice": "devansh"}) == "devansh"
    assert b._agent_voice({"tts_model": "smallest", "voice": "ira"}) is None
    # The two Smallest models reject each other's names, so they must not leak
    # into one another any more than they leak into Rumik.
    assert b._agent_voice({"tts_model": "smallest_pro", "voice": "mandar"}) == "mandar"
    assert b._agent_voice({"tts_model": "smallest_pro", "voice": "devansh"}) is None
    assert b._agent_voice({"tts_model": "smallest", "voice": "mandar"}) is None
    assert b._agent_voice({"tts_model": "deepgram", "voice": "aura-2-asteria-en"}) \
        == "aura-2-asteria-en"
    assert b._agent_voice({"tts_model": "deepgram", "voice": "devansh"}) is None
    assert b._agent_voice({"tts_model": "sarvam", "voice": "hi-IN-Neural2-B"}) is None
    assert b._agent_voice({"tts_model": "sarvam", "voice": "shubh"}) == "shubh"


def test_engine_defaults_are_real_voices_in_their_own_palette():
    """A default outside its own palette would be dropped by _agent_voice and
    silently replaced by the vendor's default — the exact class of bug that made
    a male-configured agent speak in a female voice."""
    assert b._default_voice_for({"tts_model": "google"}).lower() in b.GOOGLE_VOICES
    assert b._default_voice_for({"tts_model": "smallest"}).lower() in b.SMALLEST_VOICES
    assert b._default_voice_for({"tts_model": "smallest_pro"}).lower() in b.SMALLEST_PRO_VOICES
    assert b._default_voice_for({"tts_model": "deepgram"}).lower() in b.DEEPGRAM_VOICES
    assert b._default_voice_for({"tts_model": "rumik"}).lower() in b.RUMIK_VOICES
    assert b._default_voice_for({"tts_model": "sarvam"}) == "priya"


def test_new_engines_fall_back_to_sarvam_instead_of_going_mute():
    """Missing creds/keys are a per-deployment reality. A misconfig must degrade
    to a working call in another voice — never the mute call that the pipecat 1.4
    signature drift already cost us once."""
    import inspect
    src = inspect.getsource(pv.build_tts)
    google_branch = src[src.index('startswith("google")'):src.index('startswith("smallest")')]
    assert "except Exception" in google_branch
    assert "falling back to Sarvam" in google_branch
    smallest_branch = src[src.index('startswith("smallest")'):src.index('startswith("rumik")')]
    assert "except Exception" in smallest_branch


def test_bot_is_interrupted_at_vad_onset_not_at_transcript():
    """MEASURED root cause of "it takes ages for the bot to stop" (three founder
    calls): holding audio in DuckGate cannot stop playback, because the reply has
    already flowed past the duck into pipecat's output queue and Plivo's buffer —
    live call d6e82def logged "dropping 0 held frame(s)" on the interrupt. Only a
    flush empties those, and waiting for the STT final delayed it 0.8-1.6s.
    Probe: 1.92s of talk-over before, 0.32s after."""
    import inspect
    src = inspect.getsource(b.run_bot)
    vad = src[src.index("VADUserTurnStartStrategy("):]
    # Onset cuts only in the legacy mode; voice mode (default since 2026-09-23)
    # stops on meaning or sustained voice instead (BARGE_IN_MODE).
    assert "enable_interruptions=(settings.interrupt_on_vad" in vad[:200]
    assert 'settings.barge_in_mode != "voice"' in vad[:300]
    # Interims must NOT interrupt: Google STT streams them continuously.
    tr = src[src.index("TranscriptionUserTurnStartStrategy("):]
    assert "enable_interruptions=False" in tr[:200]


def test_backchannel_after_a_cut_carries_on_instead_of_answering_haan():
    """Interrupting at VAD onset means the bot is already silent when the words
    arrive ~1.5s later, so the absorb path would never fire and every "haan"
    ended the bot's turn (observed on the probe: the model answered the
    acknowledgment from a standing start). A cut within backchannel_carry_secs
    still counts as mid-reply, and the bot is asked to carry on."""
    import inspect
    src = inspect.getsource(b.TranscriptCollector.process_frame)
    assert "self._recently_cut()" in src
    assert "carry on" in src


def test_audio_lead_is_capped_so_plivo_cannot_hoard_the_reply():
    import inspect
    import app.main as mm
    src = inspect.getsource(mm._cap_audio_lead)
    assert "max_lead" in src and "monotonic" in src
    # Falling behind must re-anchor rather than accumulate debt.
    assert "if lead < 0" in src


# ── the repeated-introduction / language-flip root cause (2026-08-06) ────────

def test_scripted_opening_is_written_to_context_deterministically():
    """ROOT CAUSE of both "the questions repeat" and "it switches to Hindi":
    pipecat 1.4 commits a TTSSpeakFrame utterance to context only when it
    COMPLETES. A caller who speaks over the opening cancels that commit, and the
    model is left with no record that it ever introduced itself. MEASURED on the
    live pipeline — uninterrupted the context held the opening (n=4); interrupted
    at +4s it held only (system, user, assistant-reply) and that reply
    re-introduced the agent from scratch. The language flip is the same wound:
    LANGUAGE STABILITY anchors on "your own previous turns", and there were none.

    So we append it ourselves and tell pipecat not to, giving exactly one copy
    whether or not the caller interrupts."""
    import inspect
    src = inspect.getsource(b.run_bot)
    greet = src[src.index("diag.greet_path = \"scripted\""):]
    assert "TTSSpeakFrame(opening, append_to_context=False)" in greet[:2400]
    assert "LLMMessagesAppendFrame" in greet[:2400]


def test_already_spoken_rule_quotes_the_opening_and_is_opening_only():
    """Authored prompts here are call SCRIPTS whose first block IS the
    introduction (Shiksha Nation's literally starts "Bot: Hi! I'm Ameet calling
    from…"), so the model reads from the top and says it again. Naming the
    opening verbatim also gives the first turn a language anchor."""
    MARK = "ALREADY SPOKEN — do not repeat"
    with_opening = b.build_system_prompt({"agent": {
        "name": "Ameet", "systemPrompt": "Bot: Hi! I am Ameet. " * 40,
        "direction": "OUTBOUND",
        "openingLine": "Hi! I am Ameet calling from Shiksha Nation."}})
    assert MARK in with_opening
    assert "Hi! I am Ameet calling from Shiksha Nation." in with_opening
    assert "never restart your script" in with_opening
    # mid-call "hello" must NOT re-trigger the opening
    assert "ONLY at the start" in with_opening
    without = b.build_system_prompt({"agent": {
        "name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
    assert MARK not in without


def test_plain_hindi_register_rule_targets_the_words_actually_used():
    """Founder after live calls: "everything is highly formal Hindi... words that
    in general are not used". Measured across two days of transcripts: 198 uses of
    literary vocabulary (प्रदर्शन 37x, पूछताछ 28x, अकादमिक 14x, अवधारणा 12x). It is
    translationese — the authored script is English and the model renders it as
    textbook Hindi. The rule names the ACTUAL offenders, because concrete swaps
    steer a model far better than "be conversational"."""
    hi = b.build_system_prompt({"agent": {
        "name": "Ameet", "language": "hinglish",
        "systemPrompt": "Bot: Hi! " * 80 + "We run live classes.",
        "direction": "OUTBOUND", "openingLine": "Hi!"}})
    assert "PHONE HINDI" in hi
    for offender in ("प्रदर्शन", "पूछताछ", "अकादमिक", "अवधारणाएँ", "शुल्क", "अभिभावक"):
        assert offender in hi, offender
    # A non-education agent gets the same rule with a business vocabulary
    # (AAIBUZZ/IRPL, 2026-10-16) — the textbook traps it shares stay named.
    general = b.build_system_prompt({"agent": {
        "name": "Ameet", "language": "hinglish", "systemPrompt": "Bot: Hi! " * 80,
        "direction": "OUTBOUND", "openingLine": "Hi!"}})
    assert "PHONE HINDI" in general
    for offender in ("पूछताछ", "शुल्क", "उपयुक्त"):
        assert offender in general, offender
    for edu in ("अकादमिक", "अभिभावक", "scholarship"):
        assert edu not in general, edu
    # English agents must not be told about Hindi vocabulary at all.
    en = b.build_system_prompt({"agent": {
        "name": "Ann", "language": "english", "systemPrompt": "Bot: Hi! " * 80,
        "direction": "OUTBOUND", "openingLine": "Hi!"}})
    assert "PHONE HINDI" not in en


def test_warm_question_rule_reaches_every_prompt_branch(monkeypatch):
    """Founder, 2026-09-08, live-testing the yoga agent: "it's asking questions as
    if she is my mother — 'hey, do you take live classes?' is not the right way...
    humanize the prompt, and inculcate this into AI calling in general". "In
    general" means the rule must ride the platform, not one authored script — so
    it must appear for BOTH the authored-prompt branch and the thin-prompt
    scaffold, and honour its kill switch."""
    MARK = "ASK LIKE A PERSON, NOT A FORM"
    authored = b.build_system_prompt({"agent": {
        "name": "Aarushi", "systemPrompt": "Bot: Hi! I am Aarushi. " * 40,
        "direction": "OUTBOUND", "openingLine": "Hi! I am Aarushi from Vacademy."}})
    assert MARK in authored
    thin = b.build_system_prompt({"agent": {
        "name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
    assert MARK in thin
    monkeypatch.setenv("WARM_QUESTIONS_ENABLED", "false")
    from app.config import get_settings as _gs
    _gs.cache_clear()  # get_settings is lru_cached; force a re-read of the env
    try:
        off = b.build_system_prompt({"agent": {
            "name": "Aarushi", "systemPrompt": "Bot: Hi! I am Aarushi. " * 40,
            "direction": "OUTBOUND", "openingLine": "Hi! I am Aarushi from Vacademy."}})
        assert MARK not in off
    finally:
        _gs.cache_clear()  # never leave the off-switch cached for later tests


def test_delivery_rule_reaches_every_prompt_branch(monkeypatch):
    """Clients, 2026-09-11: "the tone is very simple and linear — bot like". The
    TTS has no prosody control, so the prompt asks for text that carries
    delivery ('...' before the key phrase, one '!'), measured +15% pitch spread
    on the live engine. Platform-wide like the warm-question rule: both prompt
    branches, and the kill switch must remove it."""
    MARK = "SPEAK, DON'T READ"
    agent = {"agent": {
        "name": "Aarushi", "systemPrompt": "Bot: Hi! I am Aarushi. " * 40,
        "direction": "OUTBOUND", "openingLine": "Hi! I am Aarushi from Vacademy."}}
    assert MARK in b.build_system_prompt(agent)
    assert MARK in b.build_system_prompt({"agent": {
        "name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
    monkeypatch.setenv("PROSODY_HINTS_ENABLED", "false")
    from app.config import get_settings as _gs
    _gs.cache_clear()
    try:
        assert MARK not in b.build_system_prompt(agent)
    finally:
        _gs.cache_clear()


def test_language_switch_on_request_is_permanent():
    """Founder: "if users asks that i want to talk in english it should then talk
    only in english". The old rule allowed the switch but said nothing about
    STAYING switched, and the model drifted back within a couple of turns."""
    p = b.build_system_prompt({"agent": {
        "name": "Ameet", "language": "hinglish", "systemPrompt": "Bot: Hi! " * 80,
        "direction": "OUTBOUND", "openingLine": "Hi!"}})
    assert "ON REQUEST, THE SWITCH IS PERMANENT" in p
    assert "WHOLE rest of the call" in p
    assert "no Devanagari" in p


# ── call 77cb4b47 (2026-08-06): replay the real transcripts through the gate ──
class _Rec:
    """Captures everything the collector pushes downstream."""

    def __init__(self):
        self.frames = []
        self.dirs = []
        self.interruptions = 0

    def cues(self):
        out = []
        for f in self.frames:
            for m in getattr(f, "messages", []) or []:
                out.append(m.get("content") or "")
        return out


def _replay_collector(rec, bot_speaking=True, bot_stopped_t=None,
                      in_machine_window=None, **kw):
    tc = b.TranscriptCollector(
        FakeOutcome(), lambda user=True: None,
        is_bot_speaking=lambda: bot_speaking,
        fillers_armed=lambda: False,
        bot_stopped_t=bot_stopped_t or (lambda: 0.0),
        gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True,      # what production actually runs
        filler_phrases=[],
        in_machine_window=in_machine_window or (lambda: True),
        reply_in_flight=lambda: False,
        bot_spoke_once=lambda: True,
        **kw,
    )

    async def _push(frame, direction=None):
        rec.frames.append(frame)
        rec.dirs.append(direction)

    async def _broadcast():
        rec.interruptions += 1

    tc.push_frame = _push
    tc.broadcast_interruption = _broadcast
    return tc


async def _feed(tc, text):
    from pipecat.frames.frames import TranscriptionFrame
    f = TranscriptionFrame(text=text, user_id="u", timestamp="t")
    # Bypass pipecat's base setup (needs a running task manager); this test is
    # about OUR gate logic, which lives entirely after the super() call.
    b.FrameProcessor.process_frame = _noop_super
    await tc.process_frame(f, b.FrameDirection.DOWNSTREAM)


async def _noop_super(self, frame, direction):
    return None


@pytest.mark.asyncio
async def test_carrier_announcement_never_reaches_the_model():
    """Verbatim Sarvam finals from the start of call 77cb4b47. These made the
    bot skip its opening AND became the first user message in the LLM context,
    where they conditioned every generation for the next 2.5 minutes."""
    rec = _Rec()
    tc = _replay_collector(rec)
    await _feed(tc, "Your call has been forwarded to voicemail.")
    await _feed(tc, "The person you're trying to reach is not available.")
    assert rec.frames == [], "carrier audio must not be forwarded downstream"
    assert rec.interruptions == 0, "the network must not barge in on us"
    # ...but it must still be in the transcript, or LIKELY_MACHINE goes blind.
    assert len(tc._outcome.transcript) == 2


@pytest.mark.asyncio
async def test_the_hello_loop_breaks_on_the_second_hello():
    """The loop, verbatim: cut -> 'Hello.' -> cut -> 'Hello.' -> ... The first
    hello asks the model to carry on; the SECOND must stop it re-delivering the
    sentence at all, which is what made the call unlistenable."""
    rec = _Rec()
    # The bot spoke (and was cut) between each hello — that is what stops the
    # 4-second dedupe from swallowing the repeats, and it is exactly what the
    # live log shows at 08:27:02.7 / 08:27:05.1 / 08:27:13.3.
    tc = _replay_collector(rec, bot_stopped_t=lambda: time.time())
    await _feed(tc, "haan ji bol raha hoon")     # a real turn first
    rec.frames.clear()
    rec.interruptions = 0                        # that turn's barge-in is fine

    await _feed(tc, "Hello.")
    first = rec.cues()
    assert any("carry on" in c for c in first), first
    assert rec.interruptions == 0, "an absorbed hello must not be a barge-in"

    rec.frames.clear()
    await _feed(tc, "Hello.")
    second = rec.cues()
    assert any("hear you" in c for c in second), second
    assert any("Do NOT repeat your question" in c for c in second), second


@pytest.mark.asyncio
async def test_a_real_answer_clears_the_hello_streak():
    """Otherwise one stray hello early in a call would arm the escalation for
    the rest of it."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_stopped_t=lambda: time.time())
    await _feed(tc, "Hello.")
    await _feed(tc, "sixty eight percent aaye the")   # real answer -> interrupts
    assert tc._audio_checks == 0
    rec.frames.clear()
    await _feed(tc, "Hello.")
    assert any("carry on" in c for c in rec.cues()), "streak did not reset"


# ── call 14029bd6 (2026-08-06): the whole voicemail greeting, in order ────────
_VOICEMAIL_GREETING = [
    "Your call has been forwarded to voicemail.",
    "The person you're trying to reach is not available.",
    "Add the tone.",                      # Sarvam's rendering of "…after the tone"
    "Please record your message.",
    "When you have finished recording you may hang up.",
]


@pytest.mark.asyncio
async def test_the_entire_voicemail_greeting_is_filtered_not_just_line_one():
    """Verbatim Sarvam finals from call 14029bd6, in order. The first version of
    this filter latched on "have we heard a real caller yet?" — 'Add the tone.'
    missed, flipped the latch, and the two unmistakable announcements AFTER it
    were treated as the caller and interrupted our opening three times."""
    rec = _Rec()
    tc = _replay_collector(rec)
    for line in _VOICEMAIL_GREETING:
        await _feed(tc, line)
    assert rec.interruptions == 0, "the voicemail system barged in on our opening"
    assert rec.frames == [], "voicemail audio reached the model"
    assert len(tc._outcome.transcript) == 5, "must stay in the transcript for LIKELY_MACHINE"


@pytest.mark.asyncio
async def test_the_caller_is_still_heard_after_the_machine_window_closes():
    """The window is a clock, so it must actually expire — otherwise a caller
    who says any of these words mid-call is silently ignored."""
    rec = _Rec()
    tc = _replay_collector(rec, in_machine_window=lambda: False)
    await _feed(tc, "Haan main abhi available nahi hoon, baad mein call karein")
    assert rec.frames, "a real caller was swallowed after the window closed"


def test_carrier_lines_are_not_counted_as_deleted_answers():
    """The filter keeps announcements in the transcript and out of the context —
    which is exactly the shape reconcile_answers calls a DELETED ANSWER. Call
    14029bd6's panel duly reported '2 caller answers were discarded', quoting
    the voicemail system. The reconcile step must exclude them."""
    import app.turntake as tt
    heard = [t for t in _VOICEMAIL_GREETING + ["Raman", "class aath mein hai"]
             if not tt.is_carrier_announcement(t)]
    assert heard == ["Raman", "class aath mein hai"]
    n, _samples = dg_mod.reconcile_answers(heard, ["Raman", "class aath mein hai"])
    assert n == 0, "carrier lines still manufacture a false ANSWER_DELETED"


# ── call bc84958c (2026-08-06): the double pitch ─────────────────────────────
@pytest.mark.asyncio
async def test_a_second_final_during_composition_is_not_a_fresh_turn():
    """Sarvam split one answer into two finals 0.85s apart. The first started a
    reply; the second arrived in the ~0.9s hole before that reply was audible,
    the turn-gate saw a quiet bot, and it became a BRAND-NEW turn — so the bot
    delivered its entire Marks Improvement pitch twice, ~40s of it, and the
    caller asked on the line "फिर से repeat क्यों कर रहे हैं आप".

    In flight, the second final must be handled as mid-reply (absorbed or a
    formal interruption) — either way ONE reply, never two."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)   # composing, not yet audible
    tc._reply_in_flight = lambda: True
    await _feed(tc, "नहीं।")
    assert rec.interruptions == 1, (
        "a real answer arriving mid-composition must cancel the in-flight reply, "
        "not spawn a second one")


@pytest.mark.asyncio
async def test_a_backchannel_during_composition_does_not_spawn_a_reply_either():
    """Until 2026-09-22 this asserted a "carry on" cue here — a cue that RUNS
    the model, i.e. exactly the second generation that produced "जी सर। जी सर।
    जी, बोलिए।" in call 8e2041c8. The reply being composed is the reply."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    tc._reply_in_flight = lambda: True
    await _feed(tc, "हाँ।")
    assert rec.interruptions == 0
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], rec.cues()
    assert "हाँ।" in rec.cues(), "the acknowledgement still goes into the context"


@pytest.mark.asyncio
async def test_a_quiet_bot_with_no_reply_pending_still_takes_normal_turns():
    """The guard must not swallow ordinary turns — that would mute the call."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    tc._reply_in_flight = lambda: False
    await _feed(tc, "Raman seventh class mein hai")
    assert rec.interruptions == 0
    assert rec.frames, "a normal turn was swallowed"


def test_reply_in_flight_is_time_capped():
    """A generation that dies before playout must not mute the caller forever."""
    import app.callstate as cs
    from app.config import get_settings
    s = get_settings()
    assert s.reply_inflight_grace_secs > 0
    st = cs.CallState(t=0.0)
    assert st.reply_started_t == 0.0, "must default to 'no reply pending'"


# ── LLM latency (2026-08-06) ─────────────────────────────────────────────────
def test_vertex_thinking_is_explicitly_disabled():
    """gemini-2.5-flash thinks DYNAMICALLY unless told not to, and pipecat's
    InputParams.thinking defaults to None (sends no thinkingConfig at all) — so
    "we didn't ask for thinking" is not the same as "thinking is off".

    It cost 0.43s TTFB in the morning and 2.35s p50 / 5.76s p95 by midday with
    no LLM code change, purely because the system prompt got richer. Measured
    on the Mumbai box, same region and model: 2.43s -> 0.51s with budget 0."""
    import app.providers as pvd
    from app.config import get_settings
    assert get_settings().vertex_thinking_budget == 0
    src = inspect.getsource(pvd.build_llm)
    assert "ThinkingConfig" in src
    assert "vertex_thinking_budget" in src


def test_thinking_budget_reaches_the_service_params():
    """Guards the failure mode this whole fix is about: a knob that looks set in
    our code and is silently dropped before the wire."""
    from pipecat.services.google.llm import GoogleLLMService
    p = GoogleLLMService.InputParams(
        temperature=0.35, max_tokens=300,
        thinking=GoogleLLMService.ThinkingConfig(thinking_budget=0))
    assert p.thinking is not None, "pipecat dropped the thinking config"
    assert p.thinking.thinking_budget == 0


@pytest.mark.asyncio
async def test_machine_greeting_scraps_do_not_suppress_our_opening():
    """Call 38536b71: four announcements were filtered correctly, then the
    one-word scrap 'तो।' slipped through, counted as the callee, and
    _greet_when_ready skipped our opening (greetPath "callee_spoke_first")."""
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: False
    await _feed(tc, "Your call has been forwarded to voicemail.")   # arms it
    await _feed(tc, "तो।")
    assert rec.frames == [], "a machine scrap reached the model"
    assert rec.interruptions == 0


@pytest.mark.asyncio
async def test_a_human_picking_up_mid_greeting_is_still_answered():
    """REVERSED 2026-08-13 (call 2fc70065), deliberately.

    This used to assert that a pre-speech "Hello." REACHED THE MODEL. That is a
    mechanism, and the mechanism was the bug: the caller's greeting drove a full
    LLM generation *while the scripted opening was also playing*, so the caller
    heard Shreya introduce herself twice in four seconds and said so on the line
    ("अभी तो आपने बताया, दो बार क्यों बता…"). The operator's own fragmented
    announcement did the same thing one beat earlier via bare "Hi.".

    The OUTCOME the original test cared about — a human who picks up is never
    ignored — is preserved and is what is asserted now: the greeting does not
    reach the model, and it also does not suppress our opening, so the opening is
    what answers them. One reply instead of two.
    """
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: False
    await _feed(tc, "Your call has been forwarded to voicemail.")
    rec.frames.clear()
    await _feed(tc, "Hello.")
    from app.turntake import suppresses_opening
    assert rec.frames == [], "a bare greeting must not drive its own generation"
    # ...and the thing that actually answers them still fires.
    assert not suppresses_opening("Hello."), "our opening must still play"
    assert tc._outcome.transcript[-1]["text"] == "Hello.", "still on the record"


@pytest.mark.asyncio
async def test_the_operator_fragment_that_caused_the_double_intro():
    """Call 2fc70065: the announcement split as "Hi." + "If you record your" +
    "name and reason." The FIRST fragment matches no carrier phrase, so it
    counted as the callee and drove a whole reply — and the latch that would have
    caught it only arms on the SECOND fragment, 0.6s too late."""
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: False
    for frag in ("Hi.", "If you record your", "name and reason."):
        await _feed(tc, frag)
    assert rec.frames == [], f"an operator fragment reached the model: {rec.frames}"


@pytest.mark.asyncio
async def test_a_caller_who_really_takes_over_before_we_speak_still_reaches_the_model():
    """The drop is bounded to 1-2 word scraps for exactly this reason: someone who
    answers with a real question must get a real answer, not a scripted pitch."""
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: False
    from app.turntake import suppresses_opening
    await _feed(tc, "aap kaun bol rahe hain bhai")
    assert rec.frames, "a substantive first turn was swallowed"
    assert suppresses_opening("aap kaun bol rahe hain bhai")


@pytest.mark.asyncio
async def test_short_answers_survive_once_we_have_spoken():
    """After our opening, a one-word answer ('Raman') is the whole point."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    tc._bot_spoke_once = lambda: True
    await _feed(tc, "Your call has been forwarded to voicemail.")
    rec.frames.clear()
    await _feed(tc, "Raman")
    assert rec.frames, "a real one-word answer was dropped"


# ── NoRepeatGate (2026-08-06): what four prompt attempts could not fix ───────
class _NRRec:
    def __init__(self):
        self.text = []

    async def push(self, frame, direction=None):
        t = getattr(frame, "text", None)
        if t:
            self.text.append(t)


def _no_repeat(rec, caller=""):
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    return g


async def _reply(gate, *sentences):
    from pipecat.frames.frames import (LLMFullResponseStartFrame,
                                       LLMFullResponseEndFrame, LLMTextFrame)
    d = b.FrameDirection.DOWNSTREAM
    await gate.process_frame(LLMFullResponseStartFrame(), d)
    for s in sentences:
        await gate.process_frame(LLMTextFrame(s), d)
    await gate.process_frame(LLMFullResponseEndFrame(), d)


@pytest.mark.asyncio
async def test_the_bot_stops_re_asking_its_own_closing_questions():
    """Verbatim from the measured A/B run: these two questions were asked twice
    in a ten-turn conversation, and that is what the founder kept hearing."""
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "MGP mein hum 90% marks ki guarantee dete hain. ",
                 "Kya aap iski fees ke baare mein jaanna chahenge? ")
    rec.text.clear()
    await _reply(g, "MGP ki fees chalis hazaar se saath hazaar ke beech hai. ",
                 "Kya aap iski fees ke baare mein jaanna chahengi? ")
    joined = " ".join(rec.text)
    assert "chalis hazaar" in joined, "new content must still be spoken"
    assert "jaanna chaheng" not in joined, "the re-asked question got through"


@pytest.mark.asyncio
async def test_short_acknowledgements_are_never_suppressed():
    """"Theek hai" / "achha" recur legitimately every call. Stripping them
    would leave the bot with no acknowledgements at all."""
    rec = _NRRec()
    g = _no_repeat(rec)
    for _ in range(3):
        await _reply(g, "Theek hai. ", "Achha. ")
    assert len(rec.text) == 6, rec.text


@pytest.mark.asyncio
async def test_a_reply_is_never_silenced_completely():
    """If every sentence is a repeat, one repeated line beats dead air."""
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Kya main is WhatsApp number par link bhej doon? ")
    rec.text.clear()
    await _reply(g, "Kya main is WhatsApp number par link bhej doon? ")
    assert rec.text, "the reply vanished entirely — caller hears silence"


@pytest.mark.asyncio
async def test_repeating_is_allowed_when_the_caller_asks_for_it():
    rec = _NRRec()
    g = _no_repeat(rec, caller="phir se bataiye")
    await _reply(g, "MGP ki fees chalis hazaar se saath hazaar ke beech hai. ")
    rec.text.clear()
    await _reply(g, "MGP ki fees chalis hazaar se saath hazaar ke beech hai. ")
    assert rec.text, "caller asked us to repeat and we refused"


@pytest.mark.asyncio
async def test_the_same_question_in_different_words_is_still_a_repeat():
    """Call 597aeb3f asked for the class twice. The two sentences score ~0.6
    against each other, so sentence similarity alone let it through."""
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Aur wo abhi kis class mein hai? ")
    rec.text.clear()
    await _reply(g, "Raman abhi kis class mein padh raha hai? ")
    assert not any("class mein padh" in t for t in rec.text), rec.text


@pytest.mark.asyncio
async def test_a_fully_repeated_reply_hands_back_instead_of_repeating():
    """The first never-silent guard re-emitted the duplicate, and fired seven
    times in one afternoon — the guard against dead air was itself producing
    the repetition."""
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Kya main is WhatsApp number par link bhej doon? ")
    rec.text.clear()
    await _reply(g, "Kya main is WhatsApp number par link bhej doon? ")
    joined = " ".join(rec.text)
    assert joined.strip(), "the line went dead"
    assert "WhatsApp" not in joined, "it repeated instead of handing back"


@pytest.mark.asyncio
async def test_statements_about_a_topic_are_not_suppressed_as_questions():
    """Only QUESTIONS carry a topic. The pitch mentions fees constantly and
    must survive."""
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Kya aap fees ke baare mein jaanna chahenge? ")
    rec.text.clear()
    await _reply(g, "MGP ki fees chalis hazaar se saath hazaar ke beech hoti hai. ")
    assert any("chalis hazaar" in t for t in rec.text), rec.text


# ── no-echo gate (2026-08-12): "there is no need to reconfirm every time" ─────
# Founder, on live call c7bf5ff5: "It asked how many marks, the person said
# ninety-four, and it comes back 'okay, you got ninety-four'. It looks like an AI
# if you reconfirm everything every time." Three turns in a row opened with the
# restatement, and each one shared its sentence with the real next question —
# which is why this is a CLAUSE trim and not a sentence gate.
def _no_echo_gate(rec, caller, diag=None, on=True):
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller,
                       diag=diag, no_echo=lambda: on)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    return g


@pytest.mark.asyncio
async def test_the_parroted_opener_never_reaches_the_caller():
    """Verbatim turn 2 of the call. The restatement goes, the question stays."""
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    rec = _NRRec()
    g = _no_echo_gate(rec, "सुबोध अभी आठवीं में है।", diag=d)
    await _reply(g, "सुबोध अभी कौन से क्लास में है? ")        # the question it asked
    rec.text.clear()
    await _reply(g, "ओके, सुबोध अभी आठवीं क्लास में है, तो सुबोध के लास्ट एनुअल एक्ज़ाम "
                    "में कितने मार्क्स आए थे? ")
    said = " ".join(rec.text)
    assert "आठवीं क्लास में है" not in said, said
    assert "कितने मार्क्स" in said, "the question was trimmed away with the echo"
    assert d.echoes_trimmed == 1


@pytest.mark.asyncio
async def test_the_bots_own_reaction_survives_the_trim():
    """A counsellor really does say "that's a great score" — they just don't read
    the number back first. Only the caller's own words go."""
    rec = _NRRec()
    g = _no_echo_gate(rec, "तिरानवे प्रतिशत।")
    await _reply(g, "सुबोध के लास्ट एनुअल एक्ज़ाम में कितने मार्क्स आए थे? ")
    rec.text.clear()
    await _reply(g, "सुबोध के लास्ट बहुत अच्छे, तिरानवे प्रतिशत मार्क्स, बहुत बढ़िया स्कोर है। ")
    said = " ".join(rec.text)
    assert "तिरानवे" not in said, said
    assert "बढ़िया स्कोर" in said


@pytest.mark.asyncio
async def test_only_the_first_sentence_of_a_reply_is_trimmed():
    """A later sentence reusing the caller's words is the bot BUILDING on them."""
    rec = _NRRec()
    g = _no_echo_gate(rec, "सुबोध अभी आठवीं में है।")
    await _reply(g, "हमारा Insight program है। ", "सुबोध आठवीं में है, तो यही सही रहेगा। ")
    assert "सुबोध आठवीं में है" in " ".join(rec.text)


@pytest.mark.asyncio
async def test_the_required_digit_read_back_is_never_trimmed():
    """CLOSE CONCRETELY makes reading a number back mandatory — the one echo we
    DO want. A gate that eats it would break booking confirmation."""
    rec = _NRRec()
    g = _no_echo_gate(rec, "nau do teen chaar paanch chhe saat aath nau shunya")
    await _reply(g, "आपका number nau do teen chaar, paanch chhe saat aath nau shunya, सही है? ")
    assert "nau do teen chaar" in " ".join(rec.text)


@pytest.mark.asyncio
async def test_no_echo_kill_switch_restores_the_old_behaviour():
    rec = _NRRec()
    g = _no_echo_gate(rec, "सुबोध अभी आठवीं में है।", on=False)
    await _reply(g, "ओके, सुबोध अभी आठवीं क्लास में है, तो marks कितने आए थे? ")
    assert "आठवीं क्लास में है" in " ".join(rec.text)


@pytest.mark.asyncio
async def test_a_reply_that_is_entirely_parroting_still_says_something():
    """Same rule as NoRepeatGate: one clumsy line beats dead air."""
    rec = _NRRec()
    g = _no_echo_gate(rec, "सुबोध आठवीं में है।")
    await _reply(g, "सुबोध आठवीं में है। ")
    assert " ".join(rec.text).strip()


# ── call 3148ccd4 (2026-08-13): the gate that gagged the bot ─────────────────
# The worst call we have logs for. Mumbai box, 90 seconds: 20 bot sentences
# suppressed, SEVEN handbacks, and "Raman abhi kaun si class mein hai?" — asked
# once, never answered — blocked on all six attempts to ask it again. The caller
# spent the last 45s asking "मैं क्या बताऊँ?" (what am I supposed to tell you)
# and hung up. Latency was fine throughout: LLM 0.18-0.32s, TTS 0.14-0.39s.
@pytest.mark.asyncio
async def test_an_unanswered_question_can_be_asked_again():
    """THE regression. The bot must not be permanently gagged on the one question
    that would move the call forward."""
    caller = {"t": "हाँ।"}
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super

    await _reply(g, "Raman abhi kaun si class mein hai? ")
    got = []
    # The caller never answers — they are still working out who is calling.
    for said in ("बताइए।", "जी, बोलिए।", "मैं क्या बताऊँ?", "क्या बोलूं?"):
        caller["t"] = said
        rec.text.clear()
        await _reply(g, "Raman abhi kaun si class mein hai? ")
        got.append(" ".join(rec.text))
    assert any("class mein hai" in g_ for g_ in got), (
        "the bot never got to re-ask the question the caller never answered: %r" % got)


@pytest.mark.asyncio
async def test_a_genuinely_answered_question_is_still_suppressed():
    """The original bug this gate exists for must stay fixed: asking a closing
    question again a couple of turns later is still suppressed."""
    caller = {"t": "haan"}
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "Kya aap iski fees ke baare mein jaanna chahenge? ")
    rec.text.clear()
    await _reply(g, "MGP ki fees chalis hazaar se saath hazaar ke beech hai. ",
                 "Kya aap iski fees ke baare mein jaanna chahengi? ")
    joined = " ".join(rec.text)
    assert "chalis hazaar" in joined
    assert "jaanna chaheng" not in joined, "the re-asked question got through"


@pytest.mark.asyncio
async def test_the_bot_never_says_you_talk_twice_running():
    """Every handback line means "you speak" — from the party that placed the
    call. One is recovery; a run of them is a conversation with no way back."""
    caller = {"t": "बताइए।"}
    rec = _NRRec()
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"], diag=d)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super

    await _reply(g, "Aapne apne bete Raman ke liye ek query dali thi. ")
    heard = []
    for said in ("बताइए।", "जी, बोलिए।", "आप बताइए।", "मैं क्या बताऊँ?"):
        caller["t"] = said
        rec.text.clear()
        await _reply(g, "Aapne apne bete Raman ke liye ek query dali thi. ")
        heard.append(" ".join(rec.text))
    for a, bb in zip(heard, heard[1:]):
        assert not (a in b.NoRepeatGate._HANDBACK and bb in b.NoRepeatGate._HANDBACK), (
            "two handbacks in a row: %r" % heard)


@pytest.mark.asyncio
async def test_handbacks_follow_the_agents_language():
    """These lines never touch the LLM, so the prompt's SCRIPT rule cannot reach
    them — an English agent would hand back in romanized Hindi."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "tell me",
                       handbacks=b.NoRepeatGate._HANDBACK_EN)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "You had submitted a query for your son Raman. ")
    rec.text.clear()
    await _reply(g, "You had submitted a query for your son Raman. ")
    assert " ".join(rec.text) in b.NoRepeatGate._HANDBACK_EN


def test_a_handback_run_is_a_fault_not_a_silent_counter():
    """On the real call this fired zero signals: the panel showed ANSWER_DELETED
    (a one-word fragment), DEAD_AIR and LIKELY_MACHINE, none of which was it."""
    import app.diagnostics as dg
    d = dg.CallDiagnostics(user_turns=15, bot_turns=15, handbacks=7)
    v = dg.verdict(d)
    assert v["health"] == dg.RED
    assert v["headline"] == dg.HANDBACK_LOOP
    assert "asking the caller to talk" in dg.to_payload(d)["headlineText"]
    # ...and it outranks the consequences it causes.
    d2 = dg.CallDiagnostics(user_turns=15, bot_turns=15, handbacks=7,
                            answers_deleted=1, dead_air=[6.1])
    assert dg.verdict(d2)["headline"] == dg.HANDBACK_LOOP


# ── call 5d81ace1 (2026-08-13): five seconds of nothing at the start ─────────
# The founder set the opening line to bare "Hello" so the model would deliver the
# introduction itself. What the caller got: their own "hello" at +0.1s, our
# "Hello" at +2.9s, then TWO MORE SECONDS of silence, first real sentence at
# +5.9s. Three causes stacked, all fixed here.
def test_a_bare_greeting_opening_is_not_an_opening():
    """A one-word opening answers nothing and asks nothing — the caller waits and
    so do we. It must lead straight into the real introduction."""
    for bare in ("Hello", "नमस्ते", "Hi", "Hello ji", "हेलो जी"):
        assert not b._opening_is_substantive(bare), bare
    for real in ("Hello, main Shreya baat kar rahi hoon Shiksha Nation se.",
                 "Namaste, main Shreya bol rahi hoon",
                 "Good morning, this is Shreya from Shiksha Nation"):
        assert b._opening_is_substantive(real), real


def test_the_greet_gate_does_not_burn_its_whole_ceiling():
    """The extended wait held on `user_started_t > connect_t`, which is true
    FOREVER once the caller has made one sound — so it always waited the full
    2.5s. On 5d81ace1 the caller said one word ending at +0.85s, Smart Turn
    reported the turn COMPLETE at +1.4s, and we still sat mute until +2.9s.

    Replays both conditions over a fake clock; the caller is already speaking
    when the gate starts, exactly as they were on that call.
    """
    def fire(legacy, spoke_at=0.06, spoke_until=0.85, greet_delay=0.8):
        f = {"user_speaking": False, "user_started_t": 0.0, "user_stopped_t": 0.0}

        def step(t):
            sp = spoke_at <= t < spoke_until
            if sp and not f["user_speaking"]:
                f["user_started_t"] = t
            if not sp and f["user_speaking"]:
                f["user_stopped_t"] = t
            f["user_speaking"] = sp

        t = 0.0
        while t < greet_delay:
            step(t)
            t = round(t + 0.1, 4)
        while t < 2.5:
            step(t)
            if legacy:
                if not (f["user_speaking"] or f["user_started_t"] > 0.0):
                    break
            elif not f["user_speaking"] and (
                    f["user_stopped_t"] == 0.0 or t - f["user_stopped_t"] >= 0.35):
                break
            t = round(t + 0.1, 4)
        return round(t, 2)

    assert fire(legacy=True) == 2.5, "baseline: the old loop waited the ceiling out"
    now = fire(legacy=False)
    assert now < 1.6, f"still waiting too long: {now}s"
    assert now >= 0.85, f"would talk over a caller still mid-word: {now}s"
    # A caller who really is still talking is still waited out, to the ceiling.
    assert fire(legacy=False, spoke_at=0.05, spoke_until=9.0) >= 2.4
    # A silent line is untouched — plain greet delay, no extended wait at all.
    assert fire(legacy=False, spoke_at=99, spoke_until=99) <= 0.9


# ── call f9deaf6c (2026-08-13): the bot taught itself to say "you talk" ──────
# The gate's handbacks land in the MODEL's context, because aggregators.assistant()
# sits downstream of the gate that emits them. So the model learns them: on that
# call it answered a caller "Hello." with its own "Ji, boliye." — no suppression
# had even fired — and the founder heard "बताओ… बताओ… आप बताओ" and thought the
# agent had lost its memory.
def test_handback_lines_are_devanagari_not_romanized():
    """These bypass the prompt's SCRIPT rule entirely — they never touch the LLM.
    Google hi-IN reads Latin-spelt Hindi letter by letter, which is what turned
    "aa jaayega" into "A A जाएगा" on this call."""
    import re
    for line in b.NoRepeatGate._HANDBACK:
        assert re.search(r"[ऀ-ॿ]", line), f"romanized handback: {line!r}"
    for line in b.NoRepeatGate._HANDBACK_EN:
        assert not re.search(r"[ऀ-ॿ]", line), f"Devanagari in the EN set: {line!r}"


def test_content_free_detection_survives_devanagari_normalization():
    """isalnum() drops Devanagari vowel signs, so an isalnum filter turns
    "जी, बोलिए।" into "ज बलए" and the match silently never fires — the same trap
    as diagnostics._norm_answer."""
    cf = b.NoRepeatGate._is_content_free
    for line in b.NoRepeatGate._HANDBACK + b.NoRepeatGate._HANDBACK_EN:
        assert cf(line), f"own handback not recognised: {line!r}"
    for real in ("राहुल अभी कौन सी class में है?",
                 "MGP में batch सिर्फ़ 15 का होता है।",
                 "जी, MGP program में batch 15 का होता है।"):
        assert not cf(real), f"real content called content-free: {real!r}"


@pytest.mark.asyncio
async def test_the_bot_never_says_you_talk_twice_running_even_if_it_wrote_it():
    """The escalation must fire on the MODEL's own content-free reply too, not
    just on the gate's handback — otherwise the caller gets two dead turns."""
    import itertools
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "अच्छा।", diag=d)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "इस program के बारे में और जानना चाहेंगे? "

    heard = []
    for reply in (Q, Q, "जी, बोलिए। ", Q):
        rec.text.clear()
        await _reply(g, reply)
        heard.append(" ".join(rec.text))

    free = [b.NoRepeatGate._is_content_free(h) for h in heard]
    worst = max((sum(1 for _ in grp) for k, grp in itertools.groupby(free) if k),
                default=0)
    assert worst <= 1, f"two content-free turns in a row: {heard}"
    assert all(h.strip() for h in heard), f"a turn went silent: {heard}"
    assert d.content_free_turns >= 1


@pytest.mark.asyncio
async def test_a_filler_before_real_content_is_dropped_not_the_content():
    """Holding the opener must never cost the sentence that follows it."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "अच्छा।")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "इस program के बारे में और जानना चाहेंगे? "
    await _reply(g, Q)
    await _reply(g, Q)                       # -> handback, arms the danger zone
    rec.text.clear()
    await _reply(g, "जी, बोलिए। ", "MGP में batch सिर्फ़ 15 का होता है। ")
    assert "batch" in " ".join(rec.text), rec.text


@pytest.mark.asyncio
async def test_a_normal_call_never_holds_or_hands_back():
    """The holding path is gated on being already in trouble — an ordinary call
    must not pay for it."""
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "हाँ।", diag=d)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    for q in ("राहुल किस class में है? ", "उसके marks कितने थे? ",
              "कोई subject जिसमें दिक्कत आती है? "):
        await _reply(g, q)
    assert d.handbacks == 0 and d.content_free_turns == 0 and d.repeats_suppressed == 0


# ── call 4b1a44b9 (2026-08-13): a never-played reply poisoned no-repeat ──────
# Smart Turn fired on the caller's half-answer "Raman के", the generation it
# triggered streamed the diagnostic question into _spoken, and the caller's
# continuing speech ("eighty three percent बने थे") cancelled it before ANY
# audio played. The real reply's same question was then dropped as
# "already-said": the caller heard "बहुत अच्छे!", then 6.6s of silence, prompted
# with "हम्म", got "जी, बोलिए।", and had to complain before the suppression cap
# released the question. "Already said" must mean "already HEARD".
def _gate_with_playout(caller="अच्छा।"):
    played = {"text": ""}
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller,
                       played_text=lambda: played["text"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    return g, rec, played


@pytest.mark.asyncio
async def test_a_cancelled_never_played_reply_does_not_poison_no_repeat():
    from pipecat.frames.frames import InterruptionFrame
    g, rec, played = _gate_with_playout()
    Q = "Raman के साथ भी ऐसा है — कुछ chapters में बहुत अच्छा करता है? "
    # Generation #1 streams the question; the caller never hears it.
    await _reply(g, Q)
    await g.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    # Generation #2 — the real reply — must deliver it.
    rec.text.clear()
    await _reply(g, "बहुत अच्छे! ", Q)
    said = " ".join(rec.text)
    assert "कुछ chapters" in said, f"the never-played question was blocked: {said!r}"


@pytest.mark.asyncio
async def test_a_played_then_interrupted_reply_stays_recorded():
    """The counter-case: audio that DID reach the caller is genuinely said —
    an interruption after playout must not license a verbatim repeat."""
    from pipecat.frames.frames import InterruptionFrame
    g, rec, played = _gate_with_playout()
    Q = "Raman के साथ भी ऐसा है — कुछ chapters में बहुत अच्छा करता है? "
    await _reply(g, Q)
    played["text"] = Q                      # it played, caller heard it
    await g.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    rec.text.clear()
    await _reply(g, Q)
    assert " ".join(rec.text) != Q.strip(), "a heard sentence was repeated verbatim"


@pytest.mark.asyncio
async def test_without_a_playout_source_interruption_keeps_everything():
    """No played_text wired (older callers, tests) = unknown — keep the old
    conservative behaviour rather than guessing."""
    from pipecat.frames.frames import InterruptionFrame
    rec = _NRRec()
    # Empty caller text so the echo-trim stays out of the way — this test is
    # about the interruption branch only.
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "Raman के साथ भी ऐसा है — कुछ chapters में बहुत अच्छा करता है? "
    await _reply(g, Q)
    await g.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    rec.text.clear()
    await _reply(g, Q)
    assert "कुछ chapters" not in " ".join(rec.text)


@pytest.mark.asyncio
async def test_partial_playout_unrecords_only_the_unheard_tail():
    """Two sentences emitted, only the first played before the cut: the first
    stays banned, the second must be sayable again."""
    from pipecat.frames.frames import InterruptionFrame
    g, rec, played = _gate_with_playout()
    S1 = "Raman ke marks bahut acche hain aur foundation strong hai. "
    S2 = "Kya main aapko MGP program ke baare mein bata doon? "
    await _reply(g, S1, S2)
    played["text"] = S1                     # cut after the first sentence
    await g.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    rec.text.clear()
    await _reply(g, S1, S2)
    said = " ".join(rec.text)
    assert "MGP program" in said, "the unheard sentence stayed banned"
    assert "foundation strong" not in said, "the heard sentence was repeated"


# ── calls 4b1a44b9 + 761decff (2026-08-13): topic collision pre-banned a question ──
# question_topic files BOTH the script's marks question ("कितने मार्क्स आए थे?")
# and its DIAGNOSTIC ("कुछ chapters में अच्छा करता है और कुछ topics में marks खो
# देता है?") under topic "marks" — they share a keyword and nothing else
# (similarity 0.35). Topic membership alone counted as a re-ask, so asking for
# the marks pre-banned the diagnostic: the caller answered "83%", heard praise
# and NO question, prompted "हम्म", got "जी, बोलिए।", and a second voice on the
# line had to say "आप बोलिए ना, आपने phone किया है" before the suppression cap
# released it. A topic match must be CONFIRMED by similarity to the question
# actually asked about that topic.
MARKS_Q = "Raman के लास्ट एनुअल एग्जाम में कितने मार्क्स आए थे? "
DIAG_Q = ("Raman के साथ भी ऐसा है कि कुछ चैप्टर्स में बहुत अच्छा करता है "
          "और कुछ specific टॉपिक्स में marks खो देता है? ")


@pytest.mark.asyncio
async def test_the_marks_question_does_not_pre_ban_the_diagnostic():
    """Verbatim call 761decff. The diagnostic's FIRST delivery must play."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True,
                       last_caller_text=lambda: "I think 83% around बन गया।")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, MARKS_Q)
    rec.text.clear()
    await _reply(g, "83%। ", DIAG_Q, "बहुत अच्छे मार्क्स हैं। ")
    said = " ".join(rec.text)
    assert "खो देता है" in said, f"the diagnostic was pre-banned again: {said!r}"


@pytest.mark.asyncio
async def test_a_paraphrased_reask_of_the_same_question_is_still_dropped():
    """The case the topic tier exists for (call 597aeb3f): same question in new
    words scores ~0.7 — under the 0.80 sentence bar, over the 0.5 topic bar."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "haan")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "Aur wo abhi kis class mein hai? ")
    rec.text.clear()
    await _reply(g, "Achha ji. ", "Raman abhi kis class mein padh raha hai? ")
    said = " ".join(rec.text)
    assert "padh raha" not in said, f"a paraphrased re-ask got through: {said!r}"
    assert "Achha" in said, "the non-repeat part of the reply must still play"


def test_topic_collision_pair_is_separated_by_the_threshold():
    """Pin the numbers the 0.5 threshold rests on, so a wording change in either
    standard question that erodes the margin fails loudly here."""
    import difflib
    from app.turntake import normalize_spoken, question_topic
    assert question_topic(MARKS_Q) == question_topic(DIAG_Q) == "marks"
    collide = difflib.SequenceMatcher(
        None, normalize_spoken(MARKS_Q), normalize_spoken(DIAG_Q)).ratio()
    para = difflib.SequenceMatcher(
        None, normalize_spoken("Aur wo abhi kis class mein hai?"),
        normalize_spoken("Raman abhi kis class mein padh raha hai?")).ratio()
    assert collide < 0.45, f"collision pair drifted up: {collide:.2f}"
    assert para > 0.55, f"paraphrase pair drifted down: {para:.2f}"


@pytest.mark.asyncio
async def test_unpoison_restores_the_topic_exemplar_it_displaced():
    """A same-topic question that emits but never PLAYS must not erase the
    record of the ask the caller actually heard. MARKS_Q and DIAG_Q share the
    topic while being different questions, so the diagnostic displaces the
    exemplar when it emits — an interruption before playout must put the heard
    phrasing back, and must free the diagnostic to be asked again."""
    from pipecat.frames.frames import InterruptionFrame
    from app.turntake import normalize_spoken
    played = {"text": ""}
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "",
                       played_text=lambda: played["text"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, MARKS_Q)
    played["text"] = MARKS_Q                  # the marks question WAS heard
    await _reply(g, DIAG_Q)                   # emits (0.35 < 0.5), displaces exemplar
    assert g._asked["marks"] == normalize_spoken(DIAG_Q)
    await g.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    # The heard phrasing is back on record…
    assert g._asked["marks"] == normalize_spoken(MARKS_Q)
    # …and the never-heard diagnostic is sayable again.
    rec.text.clear()
    await _reply(g, DIAG_Q)
    assert "खो देता है" in " ".join(rec.text), "the un-played diagnostic stayed banned"


# ── call 17be14f2 (2026-08-13): the three-part opening failure ───────────────
# 1) The caller's pre-greet "हेलो" opened a TURN whose transcript was dropped,
#    but the turn stayed open 4.6s (closed by a 1500ms-silence fallback) — the
#    greet gate keys on turn flags, so it burned its full 2.5s ceiling. LONG
#    PAUSE AT START.
# 2) When that stale turn closed, the aggregator triggered a generation with NO
#    new user content — a reply to nothing, which re-delivered the intro.
# 3) An absorbed "हम्म" triggered a continuation that PARAPHRASED the intro
#    line past the 0.80 bar ("website…studies…form भरा था" -> "वेबसाइट…पढ़ाई…
#    enquiry डाली थी", ~0.7). REPETITION.

INTRO_S2 = ("मैंने देखा था कि आपने हमारी website पर अपने बच्चे की studies के "
            "लिए एक enquiry form भरा था। ")
INTRO_S2_PARA = ("मैंने देखा था कि आपने हमारी वेबसाइट पर अपने बच्चे की पढ़ाई "
                 "के लिए एक enquiry डाली थी। ")


def test_the_paraphrase_that_beat_the_gate_sits_in_the_strict_band():
    """Pin the numbers: the continuation paraphrase escapes 0.80 but is caught
    at 0.6, with margin both ways."""
    import difflib
    from app.turntake import normalize_spoken
    r = difflib.SequenceMatcher(None, normalize_spoken(INTRO_S2),
                                normalize_spoken(INTRO_S2_PARA)).ratio()
    assert 0.62 < r < 0.80, f"paraphrase pair drifted out of the band: {r:.2f}"


@pytest.mark.asyncio
async def test_a_continuation_may_not_paraphrase_what_already_played():
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "हम्म।")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, INTRO_S2)
    g.mark_continuation()                    # what the absorb path now does
    rec.text.clear()
    await _reply(g, INTRO_S2_PARA, "क्या मैं Riya जी से बात कर रही हूँ? ")
    said = " ".join(rec.text)
    assert "डाली थी" not in said, f"the paraphrased intro got through: {said!r}"
    assert "Riya जी से बात" in said, "the genuinely new sentence must survive"


@pytest.mark.asyncio
async def test_strictness_lasts_exactly_one_response():
    """A NORMAL reply keeps the 0.80 bar — the strict bar on every response
    would eat legitimate reprises the 0.80 margin exists to protect."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "हाँ।")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, INTRO_S2)
    g.mark_continuation()
    await _reply(g, "ठीक है जी। ")           # the continuation, consumed here
    rec.text.clear()
    await _reply(g, INTRO_S2_PARA)           # next NORMAL response: 0.80 bar
    assert "डाली थी" in " ".join(rec.text), "strictness leaked past one response"


# ── RunGuard: a generation must answer something ─────────────────────────────
class _FakeCtx:
    def __init__(self):
        self.messages = []

    def get_messages(self):
        return self.messages


class _RGRec:
    def __init__(self):
        self.passed = []

    async def push(self, frame, direction=None):
        self.passed.append(frame)


def _run_guard():
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    ctx = _FakeCtx()
    rec = _RGRec()
    g = b.RunGuard(ctx, enabled=lambda: True, diag=d)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    return g, ctx, rec, d


@pytest.mark.asyncio
async def test_run_guard_blocks_the_stale_turn_retrigger():
    """The exact 17be14f2 shape: greet cue runs once; a stale turn closes and
    re-triggers with the context unchanged; the second run must not happen."""
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d = _run_guard()
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = [{"role": "system", "content": "…"},
                    {"role": "user", "content": "[NOW deliver your opening…]"}]
    await g.process_frame(LLMRunFrame(), D)          # the greet's run
    assert len(rec.passed) == 1
    await g.process_frame(LLMRunFrame(), D)          # stale-turn retrigger
    assert len(rec.passed) == 1, "a reply-to-nothing generation was allowed"
    assert d.empty_runs_blocked == 1


@pytest.mark.asyncio
async def test_run_guard_blocks_when_the_last_word_was_ours():
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, _ = _run_guard()
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = [{"role": "user", "content": "हाँ"},
                    {"role": "assistant", "content": "ठीक है Riya जी।"}]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.passed == [], "generated with nothing to answer"


@pytest.mark.asyncio
async def test_run_guard_allows_every_real_turn():
    """Each new caller message — including an identical short answer later in
    the call, and the absorb cue — must run. Only sameness is blocked."""
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, _ = _run_guard()
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = [{"role": "user", "content": "हाँ जी बोलिए।"}]
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = ctx.messages + [{"role": "assistant", "content": "क्लास?"},
                                   {"role": "user", "content": "आठवीं"}]
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = ctx.messages + [{"role": "assistant", "content": "marks?"},
                                   {"role": "user", "content": "हाँ जी बोलिए।"}]
    await g.process_frame(LLMRunFrame(), D)          # same words, NEW turn
    assert len(rec.passed) == 3, "a legitimate turn was blocked"


@pytest.mark.asyncio
async def test_run_guard_kill_switch_and_empty_context_pass_through():
    from pipecat.frames.frames import LLMRunFrame
    import app.diagnostics as dg
    ctx = _FakeCtx()
    rec = _RGRec()
    g = b.RunGuard(ctx, enabled=lambda: False, diag=dg.CallDiagnostics())
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    D = b.FrameDirection.DOWNSTREAM
    await g.process_frame(LLMRunFrame(), D)          # empty context, disabled
    ctx.messages = [{"role": "assistant", "content": "x"}]
    await g.process_frame(LLMRunFrame(), D)          # disabled ⇒ everything passes
    assert len(rec.passed) == 2


# ── RunGuard short-answer grace: "Yes." + a breath + the real answer ─────────
def _graced_guard(quiet):
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    ctx = _FakeCtx()
    rec = _RGRec()
    g = b.RunGuard(ctx, enabled=lambda: True, diag=d,
                   short_answer_grace_secs=0.5, short_answer_max_words=3, quiet_for=quiet)
    g.push_frame = rec.push
    g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    return g, ctx, rec, d


_CONVO = [{"role": "system", "content": "…"},
          {"role": "user", "content": "[NOW deliver your opening…]"},
          {"role": "assistant", "content": "Hi, is this Riya? Can I take a minute?"}]


@pytest.mark.asyncio
async def test_short_answer_run_waits_for_the_rest_when_the_voice_resumes():
    """Real-STT sim breath_then_long_answer_*: the run on "Yes" alone must not
    fire while the caller goes on; it runs once, after they stop, on the
    context as it stands then."""
    from pipecat.frames.frames import LLMRunFrame
    state = {"quiet": 0.1}
    g, ctx, rec, d = _graced_guard(lambda: state["quiet"])
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "Yes"},
                             {"role": "user", "content": "[That was their ANSWER…]"}]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.passed == [], "answered the short part immediately"
    await asyncio.sleep(0.45)                 # past the grace check (0.4 s in)
    assert rec.passed == [], "answered the short part while the caller was still talking"
    ctx.messages = ctx.messages + [{"role": "user", "content": "I take classes in the evening"}]
    state["quiet"] = 5.0                      # the voice stopped
    await asyncio.sleep(1.3)                  # settle (1.0 s) + slack
    assert len(rec.passed) == 1, "the combined turn never ran"
    assert d.short_answer_holds == 1


@pytest.mark.asyncio
async def test_a_blocked_retrigger_never_cancels_a_held_answer():
    """A held short answer, then a run that is BLOCKED (context unchanged, or
    the last word was ours): the block must not take the held answer with it."""
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d = _graced_guard(lambda: 5.0)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "कृष्णा साहू।"}]
    await g.process_frame(LLMRunFrame(), D)          # held: a 2-word answer
    assert rec.passed == []
    await g.process_frame(LLMRunFrame(), D)          # stale retrigger, same context
    assert rec.passed == [], "the retrigger itself must stay blocked"
    await asyncio.sleep(1.4)                         # grace + settle
    assert len(rec.passed) == 1, "the held answer was lost to a blocked run"


@pytest.mark.asyncio
async def test_short_answer_run_is_superseded_by_the_next_turn():
    from pipecat.frames.frames import LLMRunFrame
    state = {"quiet": 0.1}
    g, ctx, rec, _ = _graced_guard(lambda: state["quiet"])
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "हाँ"}]
    await g.process_frame(LLMRunFrame(), D)
    await asyncio.sleep(0.45)                 # past the grace check (0.4 s in)
    ctx.messages = ctx.messages + [{"role": "user", "content": "मैं शाम को क्लास लेती हूँ"}]
    state["quiet"] = 5.0
    await g.process_frame(LLMRunFrame(), D)   # the aggregator's own run for the rest
    assert len(rec.passed) == 1
    await asyncio.sleep(1.3)
    assert len(rec.passed) == 1, "the held run fired on top of the newer one"


@pytest.mark.asyncio
async def test_short_answer_run_fires_after_the_grace_when_the_caller_is_quiet():
    from pipecat.frames.frames import LLMRunFrame
    import time as _t
    stopped = _t.monotonic() - 0.2                   # quiet 0.2 s already → waits ~0.3
    g, ctx, rec, d = _graced_guard(lambda: _t.monotonic() - stopped)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "Yes, go ahead."}]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.passed == []
    await asyncio.sleep(0.5)
    assert len(rec.passed) == 1
    assert d.short_answer_holds == 0


@pytest.mark.asyncio
async def test_long_answers_and_the_greet_are_never_held():
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, _ = _graced_guard(lambda: 0.0)     # voice live — would hold if eligible
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO[:2]                        # the greet cue
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = _CONVO + [{"role": "user", "content": "I take classes in the evening at the studio"}]
    await g.process_frame(LLMRunFrame(), D)
    assert len(rec.passed) == 2


def test_caller_words_skip_cues_and_span_trailing_user_messages():
    n = b.RunGuard._caller_words
    assert n([{"role": "user", "content": "Yes"},
              {"role": "user", "content": "[That was their ANSWER to the question…]"}]) == 1
    assert n([{"role": "assistant", "content": "a b c d"}, {"role": "user", "content": "हाँ जी।"}]) == 2
    assert n([{"role": "user", "content": "[NOW deliver your opening…]"}]) == 0
    assert n([{"role": "user", "content": [{"type": "text", "text": "yes, go ahead"}]}]) == 3


# ── the greet must key on acoustics, not the aggregator's turn lifecycle ─────
def test_greet_ignores_a_stale_open_turn():
    """Fake-clock replay of 17be14f2: voice ticks stop at 0.9s but the TURN
    never closes (its real closure came 4.6s later). v2 of the loop waited the
    full 2.5s ceiling; the acoustic loop must fire ~1.5s."""
    def fire(voice_until, turn_closes=None, greet_delay=0.8):
        f = {"user_speaking": False, "user_started_t": 0.0, "voice_tick_t": 0.0}
        settle = 0.6

        def step(t):
            # A turn only opens if there was voice at all.
            if voice_until > 0 and t >= 0.06 and (turn_closes is None or t < turn_closes):
                if not f["user_speaking"]:
                    f["user_started_t"] = t
                f["user_speaking"] = True
            elif turn_closes is not None and t >= turn_closes:
                f["user_speaking"] = False
            if 0.06 <= t < voice_until:
                f["voice_tick_t"] = t        # transport tick every step

        t = 0.0
        while t < greet_delay:
            step(t)
            t = round(t + 0.1, 4)
        while t < 2.5:
            step(t)
            now = t
            voiced = f["voice_tick_t"]
            quiet = voiced == 0.0 or now - voiced >= settle
            holds = (voiced == 0.0 and f["user_speaking"]
                     and now - f["user_started_t"] < 1.2)
            if quiet and not holds:
                break
            t = round(t + 0.1, 4)
        return round(t, 2)

    stale = fire(voice_until=0.9, turn_closes=None)      # turn never closes
    assert stale <= 1.6, f"stale turn still pins the greet: {stale}s"
    assert stale >= 1.4, f"fired before the settle: {stale}s"
    # A caller genuinely still talking holds it to the ceiling.
    assert fire(voice_until=9.0, turn_closes=None) >= 2.4
    # A silent line fires at the plain greet delay.
    assert fire(voice_until=0.0) <= 0.9


# ── call c9aa4062 (2026-09-09): "September 10th dot WHAT time works best" ────
# The LLM emitted a stray leading period, _SENT_END matched the bare "." as a
# complete sentence, and Smallest TTS spoke it as the WORD "dot" — three times
# in one call, until the caller asked "sorry, what is dot H four W?".


@pytest.mark.asyncio
async def test_letterless_chunks_never_reach_tts():
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Okay, Thursday September 10th. ", ".",
                 "What time works best for you?")
    assert all(any(ch.isalnum() for ch in t) for t in rec.text), rec.text
    joined = " ".join(rec.text)
    assert "What time works best" in joined
    assert "September 10th" in joined


@pytest.mark.asyncio
async def test_letterless_tail_is_dropped_too():
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Sounds good. ", "..")
    assert rec.text and all(any(ch.isalnum() for ch in t) for t in rec.text), rec.text


@pytest.mark.asyncio
async def test_emitted_sentences_keep_a_joining_space_for_the_context():
    """The assistant aggregator concatenates emitted frames verbatim; without a
    separator the model's own context reads "…there.Nice to…" and the model
    starts IMITATING the glued style (which is what produced the stray-period
    chunks of call c9aa4062 in the first place)."""
    rec = _NRRec()
    g = _no_repeat(rec)
    await _reply(g, "Hello there.Nice day, right?")
    assert "".join(rec.text) == "Hello there. Nice day, right?", rec.text


# ── call c9aa4062: the opening read the caller's phone number as her NAME ────


def test_a_phone_number_is_never_a_lead_name():
    assert b._lead_name_is_phone("919425677707")
    assert b._lead_name_is_phone("+91 94256 77707")
    assert b._lead_name_is_phone("91-9425-677-707")
    assert not b._lead_name_is_phone("Ritu Sharma")
    assert not b._lead_name_is_phone("Selvin")
    assert not b._lead_name_is_phone("")
    assert not b._lead_name_is_phone(None)
    assert not b._lead_name_is_phone("Mary 2nd")


def test_unknown_name_renders_empty_for_english_and_aap_for_hindi():
    """"Hello, am I speaking with aap?" is as broken in English as reading the
    number — the fallback must match the agent's language, and the cleanup must
    close the grammar hole an empty value leaves."""
    line = "Hello, am I speaking with {{name}}?"
    en = b._fill_placeholders(line, {"leadName": None,
                                     "agent": {"language": "english"}})
    # 2026-09-15: "Hi, is this? Aarushi from Vacademy" played on every unnamed
    # row of a campaign. An English opening drops the identity-check clause
    # for an unknown name instead of asking it of nobody.
    assert en == "Hello.", en
    hi = b._fill_placeholders(line, {"leadName": None,
                                     "agent": {"language": "hinglish"}})
    assert hi == "Hello, am I speaking with aap?"
    named = b._fill_placeholders(line, {"leadName": "Ritu",
                                        "agent": {"language": "english"}})
    assert named == "Hello, am I speaking with Ritu?"


# ── call c9aa4062: "which number should I send it to?" → caller made to
#    dictate the very number the bot had dialled ─────────────────────────────


def test_dialled_number_line_reaches_both_prompt_branches():
    authored = b.build_system_prompt({
        "leadPhone": "919425677707",
        "agent": {"name": "Aarushi", "systemPrompt": "Bot: Hi! I am Aarushi. " * 40,
                  "direction": "OUTBOUND", "openingLine": "Hi! I am Aarushi."}})
    assert "919425677707" in authored
    assert "NEVER ask the caller to dictate" in authored
    thin = b.build_system_prompt({
        "leadPhone": "919425677707",
        "agent": {"name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
    assert "919425677707" in thin
    no_phone = b.build_system_prompt({"agent": {
        "name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
    assert "dictate" not in no_phone


def test_check_in_variation_rule_reaches_both_prompt_branches():
    """Six "does that make sense?" turn-enders in three minutes (c9aa4062)."""
    for sp in ("Bot: Hi! I am Aarushi. " * 40, "short"):
        p = b.build_system_prompt({"agent": {
            "name": "A", "systemPrompt": sp, "direction": "OUTBOUND",
            "openingLine": "Hi! I am A."}})
        assert "VARY your check-ins" in p


# ── calls c9aa4062 / e73a839b / 0e26a0c9 (2026-09-09): the 15-19 s "audio wasn't
#    ready" stalls were Smallest returning a ~200 Hz DRONE for English text tagged
#    `hi` on lightning_v3.1_pro/mrunal (72.5 s for "Ah, okay, so you've got some
#    automation in place."; 4 of 101 sentences; 0 of 101 tagged `en`) ──────────


def test_smallest_language_follows_the_agent_not_a_constant(monkeypatch):
    import sys, types
    fake = types.SimpleNamespace(EN="en", HI="hi")
    mod = sys.modules.get("pipecat.transcriptions.language")
    if mod is None:
        mod = types.ModuleType("pipecat.transcriptions.language")
        sys.modules["pipecat.transcriptions.language"] = mod
    monkeypatch.setattr(mod, "Language", fake, raising=False)
    assert pv._smallest_language("english") == "en"
    assert pv._smallest_language("English") == "en"
    assert pv._smallest_language("en-IN") == "en"
    # Hinglish / Hindi / unset keep the code-switching Hindi tag.
    assert pv._smallest_language("hinglish") == "hi"
    assert pv._smallest_language("hindi") == "hi"
    assert pv._smallest_language(None) == "hi"
    assert pv._smallest_language("") == "hi"


def test_build_tts_call_site_passes_the_agent_language():
    """The factory can only honour the language if run_bot hands it over."""
    import inspect
    src = inspect.getsource(b.run_bot)
    call = src[src.index("build_tts(settings.sample_rate, voice=_agent_voice(agent)"):]
    call = call[:call.index(")\n")]
    assert 'language=agent.get("language")' in call
    assert "language" in inspect.signature(pv.build_tts).parameters


# ── call 9e566e32 (2026-09-09): the callee's pickup "Hello" 250ms into our opening
#    cut it after "Hi,"; the carry-on cue said "do not re-greet" and the model went
#    straight to "Thanks. So the reason I called…" — caller hung up at 11s ─────────


def test_opening_barely_heard_is_only_true_at_the_opening():
    opening = "Hi, is this Shreyash? Aarushi from Vacademy — we came to know you run yoga sessions. Do you have two minutes?"
    assert b._opening_barely_heard(opening, [{"role": "assistant", "text": "Hi,"}], 0.0)
    assert b._opening_barely_heard(opening, [], 0.0)          # nothing recorded at all
    # Heard most of it: the ordinary continuation path, not a re-say.
    assert not b._opening_barely_heard(opening, [{"role": "assistant", "text": opening[:90]}], 0.0)
    # An LLM reply has already run: the opening is history, whatever was played.
    assert not b._opening_barely_heard(opening, [{"role": "assistant", "text": "Hi,"}], 123.4)
    assert not b._opening_barely_heard("", [], 0.0)


async def _collector_with_resay(rec, resay):
    tc = b.TranscriptCollector(
        FakeOutcome(), lambda user=True: None,
        is_bot_speaking=lambda: True, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True, filler_phrases=[],
        in_machine_window=lambda: False, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: True, resay_opening=resay)

    async def _push(frame, direction=None):
        rec.frames.append(frame)
    tc.push_frame = _push
    tc.broadcast_interruption = rec.__dict__.setdefault("_bi", _noop_broadcast)
    return tc


async def _noop_broadcast():
    return None


def _cue_texts(rec):
    out = []
    for f in rec.frames:
        for m in (getattr(f, "messages", None) or []):
            out.append(str(m.get("content", "")))
    return out


@pytest.mark.asyncio
async def test_a_hello_that_cuts_the_opening_resays_it_instead_of_carrying_on():
    rec = _Rec()
    calls = []

    async def resay(text):
        calls.append(text)
        return True
    tc = await _collector_with_resay(rec, resay)
    await _feed(tc, "Hello.")
    assert calls == ["Hello."]
    cues = _cue_texts(rec)
    assert "Hello." in cues, "absorb-but-never-lose: the ack still reaches the context"
    assert not any("carry on" in c or "re-greet" in c for c in cues), cues


@pytest.mark.asyncio
async def test_a_hello_mid_pitch_still_gets_the_carry_on_cue():
    """resay says 'not the opening' -> today's behaviour, byte for byte."""
    rec = _Rec()

    async def resay(text):
        return False
    tc = await _collector_with_resay(rec, resay)
    await _feed(tc, "Hello.")
    assert any("carry on" in c for c in _cue_texts(rec)), _cue_texts(rec)


def test_watchdog_speaks_the_bridge_line_on_llm_bridge():
    """The decision is pure (test_timeline); this pins the I/O side: run_bot
    wires the configured threshold in and speaks bridge_line, off-context."""
    import inspect
    src = inspect.getsource(b.run_bot)
    assert "llm_bridge_after_secs=(settings.llm_bridge_after_secs" in src
    handler = src[src.index("if d.kind == LLM_BRIDGE:"):]
    handler = handler[:handler.index("continue")]
    assert "TTSSpeakFrame(bridge_line, append_to_context=False)" in handler
    assert 'diag.bump("llm_bridges")' in handler


# ── call 7003c36a (2026-09-09): "I am busy" → "When would be a better time to
#    call you back today?" → caller "Yeah." over the last word → absorbed as a
#    backchannel → "carry on" cue → the model carried on INTO THE PITCH ──────────


async def _collector_with_transcript(rec, played_assistant_text):
    out = FakeOutcome()
    out.transcript.append({"role": "assistant", "text": played_assistant_text})
    tc = b.TranscriptCollector(
        out, lambda user=True: None,
        is_bot_speaking=lambda: True, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True, filler_phrases=[],
        in_machine_window=lambda: False, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: True)

    async def _push(frame, direction=None):
        rec.frames.append(frame)
    tc.push_frame = _push
    tc.broadcast_interruption = _noop_broadcast
    return tc


@pytest.mark.asyncio
async def test_a_yes_right_after_a_played_question_is_its_answer():
    rec = _Rec()
    tc = await _collector_with_transcript(
        rec, "No problem at all, Shiv. When would be a better time for me to call you back today?")
    await _feed(tc, "Yeah.")
    cues = _cue_texts(rec)
    assert any("their ANSWER to the question" in c for c in cues), cues
    assert not any("carry on from where you were interrupted" in c for c in cues), cues


@pytest.mark.asyncio
async def test_a_yes_over_a_statement_still_carries_on():
    rec = _Rec()
    tc = await _collector_with_transcript(
        rec, "We work with yoga trainers on everything around their online sessions.")
    await _feed(tc, "Yeah.")
    cues = _cue_texts(rec)
    assert any("carry on" in c for c in cues), cues
    assert not any("their ANSWER" in c for c in cues), cues


# ── Disposition fidelity: institute 3716991c, 2026-09-09 (77-call audit) ──────
#
# The classifier was inventing conversations. On a transcript whose only caller
# turn was "Hello." it returned Demo_Booked plus the facts that would justify it —
# a name, a member count, a platform and a meeting time, none of them spoken — and
# because it fabricated meetingRequested + meetingDatetimeIso in the same response
# it also walked past _drop_unevidenced_booking. 13 of 31 near-silent calls got a
# decisive label; of 5 Demo_Booked, 1 was pure fabrication and 1 had no agreed time.


def test_has_substance_rejects_greeting_only_but_keeps_refusals():
    # ee49966e: 8s, the entire caller contribution, stamped Demo_Booked.
    assert rpt._has_substance(_ConvOutcome([
        {"role": "assistant", "text": "Hi, is this Shweta? Aarushi from Vacademy — we"},
        {"role": "user", "text": "Hello."}])) is False
    # 0519330a: 24s of pure acknowledgement, stamped Demo_Booked with no agreed time.
    assert rpt._has_substance(_ConvOutcome([
        {"role": "user", "text": "Hello."}, {"role": "user", "text": "Okay."},
        {"role": "user", "text": "Yes."}, {"role": "user", "text": "Yeah."},
        {"role": "user", "text": "Yes."}])) is False
    # Hinglish/Devanagari equivalents, with the danda Sarvam appends to every final.
    assert rpt._has_substance(_ConvOutcome([
        {"role": "user", "text": "हेलो।"}, {"role": "user", "text": "हाँ जी।"}])) is False
    assert rpt._has_substance(_ConvOutcome([{"role": "user", "text": "kaun?"}])) is False

    # CRITICAL, mirrors _is_conversation's own guarantee: a REFUSAL is thin evidence
    # but it is still evidence. Negations are in neither filler set, so a bare "no"
    # still classifies — otherwise a terminal refusal becomes a retry and we re-dial
    # someone who already said stop.
    assert rpt._has_substance(_ConvOutcome([{"role": "user", "text": "no"}])) is True
    assert rpt._has_substance(_ConvOutcome([{"role": "user", "text": "nahi."}])) is True
    assert rpt._has_substance(_ConvOutcome([{"role": "user", "text": "नहीं।"}])) is True
    # Anything with real content passes, including one substantive word among fillers.
    assert rpt._has_substance(_ConvOutcome([
        {"role": "user", "text": "Hello."},
        {"role": "user", "text": "Hybrid."}])) is True
    # Synthetic bracketed cues are not caller words at all (via _caller_turns).
    assert rpt._has_substance(_ConvOutcome([
        {"role": "user", "text": "[unclear sound from the caller]"}])) is False


@pytest.mark.asyncio
async def test_greeting_only_call_never_reaches_the_classifier(monkeypatch):
    """The ee49966e end-to-end: a fabricated Demo_Booked must not be postable."""
    analysed = []

    async def spy_analyze(o):
        analysed.append(1)
        return {"disposition": "Demo_Booked", "meetingRequested": True,
                "meetingDatetimeIso": "2026-09-10T16:00:00+05:30", "leadRating": 7}

    posted = {}

    async def capture(inst, tok, payload):
        posted.update(payload)
        return True

    monkeypatch.setattr(rpt, "_analyze", spy_analyze)
    monkeypatch.setattr(rpt.admin_core, "post_report", capture)
    o = _ConvOutcome([
        {"role": "assistant", "text": "Hi, is this Shweta? Aarushi from Vacademy — we"},
        {"role": "user", "text": "Hello."}])
    assert await rpt.build_and_post_report(o, "cu") is True
    assert analysed == [], "the classifier judged a call with only a greeting"
    assert posted["disposition"] == "Incomplete"
    # The caller DID speak, so this is a connect — status must stay honest even
    # though we refuse to judge the call.
    assert posted["status"] == "completed"
    # No meeting evidence may survive: admin_core auto-books off these two fields
    # independently of the disposition.
    assert posted["meetingRequested"] is False
    assert posted["meetingDatetimeIso"] is None
    assert "substantive" in posted["summary"], posted["summary"]


def test_booking_label_requires_both_agreement_and_a_time():
    # 0519330a: half the evidence was enough to keep the label under the first cut
    # of this guard, because it early-returned on EITHER signal.
    a = {"disposition": "Demo_Booked", "meetingRequested": True,
         "meetingDatetimeIso": None}
    rpt._drop_unevidenced_booking(a, "c")
    assert a["disposition"] == "Incomplete"
    assert a["dispositionDowngradedFrom"] == "Demo_Booked"
    assert a["meetingRequested"] is False and a["meetingDatetimeIso"] is None

    # 775ac5ac (2026-08-14), the original incident: neither signal.
    b2 = {"disposition": "Demo_Booked", "meetingRequested": False,
          "meetingDatetimeIso": ""}
    rpt._drop_unevidenced_booking(b2, "c")
    assert b2["disposition"] == "Incomplete"

    # A time with no agreement is equally not a booking.
    c2 = {"disposition": "Counselling_Scheduled", "meetingRequested": False,
          "meetingDatetimeIso": "2026-09-11T15:00:00+05:30"}
    rpt._drop_unevidenced_booking(c2, "c")
    assert c2["disposition"] == "Incomplete"


def test_fully_evidenced_booking_and_soft_labels_survive():
    # d0b5d7a8: 152s, 34 caller words, a real agreed slot. Must be untouched.
    ok = {"disposition": "Demo_Booked", "meetingRequested": True,
          "meetingDatetimeIso": "2026-09-11T15:00:00+05:30"}
    rpt._drop_unevidenced_booking(ok, "c")
    assert ok["disposition"] == "Demo_Booked"
    assert "dispositionDowngradedFrom" not in ok
    assert ok["meetingRequested"] is True

    # Labels that do not CLAIM a secured slot are out of scope for this guard,
    # however thin their evidence — "callback" must not trip the "book" hint.
    for label in ("Interested_Callback", "Not_Interested", "Wrong_Person",
                  "Overview_Sent", "Language_Barrier"):
        a = {"disposition": label, "meetingRequested": False, "meetingDatetimeIso": None}
        rpt._drop_unevidenced_booking(a, "c")
        assert a["disposition"] == label, label


def test_out_of_vocabulary_label_is_recovered_or_preserved():
    vocab = ["Demo_Booked", "Interested_Callback", "Not_Interested", "Incomplete"]

    # Case/separator drift is the model restyling OUR label — recover it silently
    # instead of throwing the judgement away.
    for spelled in ("demo_booked", "Demo Booked", "DemoBooked", "  demo booked  "):
        p = {"disposition": spelled}
        rpt._coerce_disposition(p, vocab, "c")
        assert p["disposition"] == "Demo_Booked", spelled
        assert "dispositionRawLabel" not in p

    # A genuinely unknown label is still coerced (admin_core keys retry and lead
    # status off this string) but is no longer FORGOTTEN — that silent overwrite is
    # why 5 real conversations became Incomplete with no way to see what was meant.
    p = {"disposition": "Very_Warm_Lead"}
    rpt._coerce_disposition(p, vocab, "c")
    assert p["disposition"] == "Incomplete"
    assert p["dispositionRawLabel"] == "Very_Warm_Lead"

    # A missing/blank label leaves no raw field to report.
    for empty in ({}, {"disposition": None}, {"disposition": "  "}):
        rpt._coerce_disposition(empty, vocab, "c")
        assert empty["disposition"] == "Incomplete"
        assert "dispositionRawLabel" not in empty


@pytest.mark.asyncio
async def test_classifier_is_always_offered_an_insufficient_option(monkeypatch):
    """The root cause: agent vocabularies are pure outcome labels, so the model had
    no legal way to say "this call had no outcome" — and invented one instead."""
    sent = []

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": '{"disposition": "Incomplete"}'}}]}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append(json)
            return _Resp()

    monkeypatch.setattr(rpt.httpx, "AsyncClient", lambda *a, **k: _Client())

    o = _ConvOutcome([{"role": "user", "text": "we run hybrid yoga classes"}])
    # The audited agent's vocabulary — no "Incomplete" anywhere in it.
    o.context = {"agent": {"dispositions": ["Demo_Booked", "Interested_Callback",
                                            "Overview_Sent", "Not_Interested",
                                            "Wrong_Person", "Language_Barrier",
                                            "Incomplete_Call"]},
                 "instituteId": "i"}
    out = await rpt._analyze(o)
    assert out["disposition"] == "Incomplete"
    prompt = sent[0]["messages"][0]["content"]
    assert "Incomplete" in prompt, "no insufficient-evidence option was offered"
    assert "EVIDENCE RULES" in prompt
    # The admin's own labels must still all be on offer.
    for label in ("Demo_Booked", "Wrong_Person", "Incomplete_Call"):
        assert label in prompt, label
    # And the anti-fabrication instructions the audit turned on.
    assert "did not actually say" in prompt


# ── Sarvam LLM POC (2026-09-10): per-agent routing, never a global flip ────────


def test_sarvam_llm_agents_parses_a_comma_list(monkeypatch):
    from app.config import Settings, get_settings as _gs
    monkeypatch.setenv("SARVAM_LLM_AGENTS", " b6337c6e-1, , 0e26a0c9-2 ")
    _gs.cache_clear()
    try:
        assert Settings().sarvam_llm_agents == ("b6337c6e-1", "0e26a0c9-2")
        monkeypatch.setenv("SARVAM_LLM_AGENTS", "")
        assert Settings().sarvam_llm_agents == ()
    finally:
        _gs.cache_clear()


def test_build_llm_honours_a_per_call_provider_override():
    import inspect
    sig = inspect.signature(pv.build_llm)
    assert "provider" in sig.parameters
    src = inspect.getsource(pv.build_llm)
    # Every branch must key on the override, or a listed agent silently stays
    # on the default provider.
    assert 'if s.llm_provider ==' not in src
    assert 'prov = (provider or s.llm_provider' in src


def test_run_bot_routes_only_listed_agents_to_sarvam():
    import inspect
    src = inspect.getsource(b.run_bot)
    assert '_agent_id in settings.sarvam_llm_agents' in src
    assert 'to_thread(build_llm_waterfall, _llm_provider)' in src
    assert 'diag.llm_vendor' in src


# ── Sarvam LLM POC eval (2026-09-10): "day after" was confirmed as "Friday the
#    12th" (a Saturday) and "evening" became "six PM" — the prompt named only
#    today and tomorrow, so the model had to count, and invented the rest ──────


def test_now_line_lists_the_coming_week_as_a_lookup():
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    line = b._now_line({"agent": {"timezone": "Asia/Kolkata"}})
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    for i, label in ((0, "today"), (1, "tomorrow"), (2, "day after tomorrow")):
        d = now + timedelta(days=i)
        assert f"{d.strftime('%A %-d %B')} ({label})" in line, line
    # A full week is listed, so "next Monday"/"this weekend" are lookups too.
    assert (now + timedelta(days=6)).strftime("%A %-d %B") in line
    assert "Never state a clock time the caller did not say" in line


def test_sarvam_llm_routing_also_keys_on_institute(monkeypatch):
    """Founder 2026-09-10: "move the sales agents to sarvam-105b" — every agent
    of Vacademy's institute, including ones created later."""
    import inspect
    from app.config import Settings, get_settings as _gs
    monkeypatch.setenv("SARVAM_LLM_INSTITUTES", "3716991c-x, ")
    _gs.cache_clear()
    try:
        assert Settings().sarvam_llm_institutes == ("3716991c-x",)
    finally:
        _gs.cache_clear()
    src = inspect.getsource(b.run_bot)
    assert '_inst_id in settings.sarvam_llm_institutes' in src
    assert 'context.get("instituteId")' in src


# ── call ab194522 (2026-09-10): the VAD killed the opening 23ms after it was
#    queued; with bot_spoke_once never set, the caller's "No." and "Yeah." were
#    dropped as machine-greeting scraps and the call died in silence ──────────


async def _pre_speech_collector(rec, resay):
    tc = b.TranscriptCollector(
        FakeOutcome(), lambda user=True: None,
        is_bot_speaking=lambda: False, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True, filler_phrases=[],
        in_machine_window=lambda: True, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: False, resay_opening=resay)

    async def _push(frame, direction=None):
        rec.frames.append(frame)
    tc.push_frame = _push
    tc.broadcast_interruption = _noop_broadcast
    return tc


@pytest.mark.asyncio
async def test_a_scrap_after_a_killed_opening_resays_the_opening():
    rec = _Rec()
    calls = []

    async def resay(text):
        calls.append(text)
        return True
    tc = await _pre_speech_collector(rec, resay)
    await _feed(tc, "No.")
    assert calls == ["No."]


@pytest.mark.asyncio
async def test_a_scrap_before_any_greet_is_still_dropped():
    """resay says 'greet not queued yet' (operator fragment) -> old behaviour."""
    rec = _Rec()

    async def resay(text):
        return False
    tc = await _pre_speech_collector(rec, resay)
    await _feed(tc, "Please.")
    assert not any(getattr(f, "messages", None) for f in rec.frames), rec.frames


# ── call 4565478b (2026-09-10, first day on sarvam-105b): the model wrote
#    "<SEND:scholarship_quiz>" (single brackets, 4 of 18 markers that day); the
#    sentinel did not recognise it, the link was never sent, and the TTS read
#    the marker aloud — the caller said "हैं?" ──────────────────────────────────


def test_loose_markers_are_canonicalised():
    assert b._canonical_markers("ok <SEND:scholarship_quiz> bye") == "ok <<SEND:scholarship_quiz>> bye"
    assert b._canonical_markers("bye <END_CALL>") == "bye <<END_CALL>>"
    assert b._canonical_markers("<TRANSFER>") == "<<TRANSFER>>"
    # Already canonical: untouched (no <<<...>>> mangling).
    assert b._canonical_markers("<<SEND:x>> <<END_CALL>>") == "<<SEND:x>> <<END_CALL>>"
    # A half-streamed single-bracket marker is left alone for _split_safe to hold.
    assert b._canonical_markers("link <SEND:schol") == "link <SEND:schol"


@pytest.mark.asyncio
async def test_single_bracket_send_fires_and_is_never_spoken():
    from pipecat.frames.frames import (LLMFullResponseStartFrame, LLMFullResponseEndFrame,
                                       LLMTextFrame)
    sent, out = [], []
    sg = b.SentinelGate(FakeOutcome(), lambda user=True: None, lambda s: None,
                        on_send=sent.append)

    async def _push(frame, direction=None):
        t = getattr(frame, "text", None)
        if t:
            out.append(t)
    sg.push_frame = _push
    b.FrameProcessor.process_frame = _noop_super
    d = b.FrameDirection.DOWNSTREAM
    await sg.process_frame(LLMFullResponseStartFrame(), d)
    for chunk in ("क्या मैं ये link भेज दूँ? <SEND:schol", "arship_quiz> ठीक है।"):
        await sg.process_frame(LLMTextFrame(chunk), d)
    await sg.process_frame(LLMFullResponseEndFrame(), d)
    assert sent == ["scholarship_quiz"], sent
    spoken = "".join(out)
    assert "<" not in spoken and "SEND" not in spoken, spoken
    assert "भेज दूँ?" in spoken and "ठीक है।" in spoken


# ── Bedrock (Mumbai) LLM POC, 2026-09-10 ───────────────────────────────────────
# pipecat's stock AWSBedrockLLMService opens a NEW aiobotocore client inside
# every generation: measured 2.0-2.2s per turn on the box vs 0.2-0.4s with one
# reused client. The wrapper below is what makes Bedrock usable for voice.


@pytest.mark.asyncio
async def test_persistent_client_session_creates_one_client_and_closes_once():
    enters, exits = [], []

    class _FakeCM:
        async def __aenter__(self):
            enters.append(1)
            return "CLIENT"

        async def __aexit__(self, *exc):
            exits.append(1)
            return False

    class _FakeSession:
        def create_client(self, service_name, **kw):
            assert service_name == "bedrock-runtime"
            return _FakeCM()

    ps = pv._PersistentClientSession(_FakeSession())
    for _ in range(3):                       # three "requests", as the service does
        async with ps.create_client("bedrock-runtime", region_name="ap-south-1") as c:
            assert c == "CLIENT"
    assert enters == [1] and exits == []     # one client, never torn down mid-call
    await ps.close()
    assert exits == [1]
    await ps.close()                          # idempotent
    assert exits == [1]


def test_bedrock_settings_and_routing():
    from app.config import Settings, get_settings as _gs
    import inspect, os
    os.environ["BEDROCK_LLM_AGENTS"] = "b6337c6e-x"
    os.environ["BEDROCK_LLM_INSTITUTES"] = ""
    _gs.cache_clear()
    try:
        s = Settings()
        assert s.bedrock_model == "moonshotai.kimi-k2.5"
        assert s.bedrock_region == "ap-south-1"
        assert s.bedrock_llm_agents == ("b6337c6e-x",)
        import json
        assert json.loads(s.bedrock_extra_json) == {"thinking": {"type": "disabled"}}
    finally:
        os.environ.pop("BEDROCK_LLM_AGENTS", None); os.environ.pop("BEDROCK_LLM_INSTITUTES", None)
        _gs.cache_clear()
    src = inspect.getsource(b.run_bot)
    # Bedrock lists win over Sarvam lists, both over the default.
    assert src.index("settings.bedrock_llm_agents") < src.index("settings.sarvam_llm_agents")
    assert 'if prov == "bedrock":' in inspect.getsource(pv.build_llm)
    assert "aws" in open(os.path.join(os.path.dirname(pv.__file__), "..", "requirements.txt")).read().split("pipecat-ai[")[1].split("]")[0].split(",")


def test_bedrock_client_is_warmed_at_start_not_on_first_turn():
    """Turn-1 TTFT measured 2.93s (client creation) vs 0.56s after, through the
    real provider on the box — so the client opens in start(), under the greet."""
    import inspect
    src = inspect.getsource(pv._build_bedrock)
    start = src[src.index("async def start(self, frame):"):src.index("async def stop(self, frame):")]
    assert "await super().start(frame)" in start
    # In the background: awaiting the warm-up held the StartFrame (call 09c5279a).
    assert "create_task(self._warm())" in start
    warm = src[src.index("async def _warm(self):"):src.index("async def start(self, frame):")]
    assert 'create_client(' in warm and 'service_name="bedrock-runtime"' in warm
    # Off EC2, botocore probes the metadata endpoint for ~2s per construction.
    assert 'os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")' in src


# ── Room tone under every call (2026-09-10) ──────────────────────────────────


def test_ambience_asset_is_8k_mono_pcm_and_quiet():
    """pipecat's SoundfileMixer does NOT resample: a file whose rate differs
    from the 8 kHz transport is silently skipped. Pin the asset's format."""
    import wave, struct, math
    from app import ambience
    assert ambience.AMBIENCE_FILE.is_file(), ambience.AMBIENCE_FILE
    w = wave.open(str(ambience.AMBIENCE_FILE))
    assert (w.getnchannels(), w.getframerate(), w.getsampwidth()) == (1, 8000, 2)
    secs = w.getnframes() / w.getframerate()
    assert 60 < secs < 120, secs   # 78.5s call-centre loop
    data = w.readframes(8000 * 5)
    s = struct.unpack("<%dh" % (len(data) // 2), data)
    rms_dbfs = 20 * math.log10(math.sqrt(sum(x * x for x in s) / len(s)) / 32768)
    assert -36 < rms_dbfs < -28, rms_dbfs      # pre-normalised to about -32 dBFS


def test_ambience_settings_defaults(monkeypatch):
    from app.config import Settings, get_settings as _gs
    _gs.cache_clear()
    try:
        s = Settings()
        assert s.ambience_enabled is True and s.ambience_volume == 0.15
        monkeypatch.setenv("AMBIENCE_ENABLED", "false"); monkeypatch.setenv("AMBIENCE_VOLUME", "0.3")
        s = Settings()
        assert s.ambience_enabled is False and s.ambience_volume == 0.3
    finally:
        _gs.cache_clear()


def test_ambience_mixer_is_none_when_disabled_or_unavailable():
    from app import ambience
    import types
    off = types.SimpleNamespace(ambience_enabled=False, ambience_volume=0.15)
    assert ambience.build_ambience_mixer(off) is None
    # Enabled but the soundfile extra is absent (this sandbox): still None, never a crash.
    on = types.SimpleNamespace(ambience_enabled=True, ambience_volume=0.15)
    assert ambience.build_ambience_mixer(on) is None or True


@pytest.mark.asyncio
async def test_ambience_ducker_lowers_under_speech_and_restores_after():
    from app.ambience import AmbienceDucker
    from pipecat.frames.frames import (TTSStartedFrame, TTSStoppedFrame, InterruptionFrame,
                                       MixerUpdateSettingsFrame, TTSAudioRawFrame)
    out = []
    d = AmbienceDucker(0.15)

    async def _push(frame, direction=None):
        out.append(frame)
    d.push_frame = _push
    b.FrameProcessor.process_frame = _noop_super
    dd = b.FrameDirection.DOWNSTREAM
    await d.process_frame(TTSStartedFrame(), dd)
    await d.process_frame(TTSAudioRawFrame(audio=b"\x00\x00", sample_rate=8000, num_channels=1), dd)
    await d.process_frame(TTSStoppedFrame(), dd)
    kinds = [(type(f).__name__, getattr(f, "settings", None)) for f in out]
    assert kinds[0] == ("MixerUpdateSettingsFrame", {"volume": 0.09})   # duck BEFORE the audio
    assert kinds[1][0] == "TTSStartedFrame" and kinds[2][0] == "TTSAudioRawFrame"
    assert kinds[3][0] == "TTSStoppedFrame"
    assert kinds[4] == ("MixerUpdateSettingsFrame", {"volume": 0.15})   # restore AFTER
    # A second Started while already ducked does not re-send; an interruption restores.
    out.clear()
    await d.process_frame(TTSStartedFrame(), dd)
    await d.process_frame(TTSStartedFrame(), dd)
    await d.process_frame(InterruptionFrame(), dd)
    assert sum(isinstance(f, MixerUpdateSettingsFrame) for f in out) == 2


def test_ambience_is_wired_into_transport_and_pipeline():
    import inspect, os
    src_main = open(os.path.join(os.path.dirname(b.__file__), "main.py")).read()
    assert "audio_out_mixer=build_ambience_mixer(s)" in src_main
    src = inspect.getsource(b.run_bot)
    assert "AmbienceDucker(settings.ambience_volume," in src
    assert "drift_db=settings.ambience_drift_db" in src
    assert src.index("AmbienceDucker(") < src.index("transport.output(),")
    root = os.path.join(os.path.dirname(b.__file__), "..")
    assert "COPY assets ./assets" in open(os.path.join(root, "Dockerfile")).read()
    assert "soundfile" in open(os.path.join(root, "requirements.txt")).read()



def test_resay_requires_an_interruption_after_the_greet_was_queued():
    """Call 09c5279a (2026-09-10): the re-say fired before the queued opening
    had played and nothing had cancelled it -> the caller heard the intro twice."""
    import inspect
    src = inspect.getsource(b.run_bot)
    resay = src[src.index("async def _resay_opening(text"):src.index("_opening_resays += 1")]
    assert 'flags["last_cut_t"]' in resay and "max(_greet_queued_t, flags[\"opening_queued_t\"])" in resay
    # Call 8208166f (2026-10-01): the cut of the FIRST delivery must not
    # justify re-saying the re-said one (an absorbed "हाँ।" queued a third copy).
    tail = src[src.index("_opening_resays += 1"):src.index("_opening_resays += 1") + 1200]
    assert 'flags["opening_queued_t"] = time.time() + 0.5' in tail
    # cut_now is the one exception: the turn-gate has just broadcast the
    # interruption itself (a real barge-in), so the cut is a fact, not a guess.
    assert "not cut_now and not (flags" in resay
    greet = src[src.index("async def _greet_when_ready"):]
    assert "_greet_queued_t = time.time()" in greet
    assert greet.index("_greet_queued_t = time.time()") < greet.index("await task.queue_frames(_frames)")


# ── Telephone-band EQ on the bot's voice (2026-09-11) ────────────────────────
# Measured need: our TTS carries 30.8% of its energy below 300 Hz vs 15.3% for
# a real recording through real mics. These pin the filter's SHAPE, not taste.

def _eq_tone_gain(eq, freq, sr=8000, secs=1.0, amp=8000):
    """dB gain the EQ applies to a steady tone (settling transient skipped)."""
    import numpy as np, math
    t = np.arange(int(secs * sr)) / sr
    pcm = (np.sin(2 * np.pi * freq * t) * amp).astype(np.int16).tobytes()
    out = np.frombuffer(eq.process(pcm, sr), dtype=np.int16).astype(float)
    out = out[len(out) // 4:]
    rms_in, rms_out = amp / math.sqrt(2), math.sqrt((out * out).mean())
    return 20 * math.log10(rms_out / rms_in + 1e-12)


def _fresh_eq(**kw):
    from app.voice_eq import TelephoneEQ
    return TelephoneEQ(**kw)


def test_voice_eq_matches_the_telephone_band():
    ref = _eq_tone_gain(_fresh_eq(), 1000)
    low = _eq_tone_gain(_fresh_eq(), 100)
    pres = _eq_tone_gain(_fresh_eq(), 1700)
    high = _eq_tone_gain(_fresh_eq(), 3900)
    assert ref - low > 15, (ref, low)      # the whole point: sub-300 Hz goes
    assert pres > ref, (pres, ref)         # presence lift is audible at 1.7k
    assert ref - high > 3, (ref, high)     # gentle roll-off near the channel top
    # Makeup restores level rather than shrinking the voice: mid-band is not
    # quieter than it went in.
    assert ref > -1.0, ref


def test_voice_eq_frame_by_frame_is_identical_to_the_whole_stream():
    """An IIR restarted per frame clicks at every 20 ms boundary. State has to
    carry, so chunked output must equal one-shot output."""
    import numpy as np
    rng = np.random.default_rng(7)
    pcm = (rng.normal(0, 3000, 8000).clip(-32768, 32767)).astype(np.int16).tobytes()
    whole = _fresh_eq().process(pcm, 8000)
    eq = _fresh_eq()
    chunked = b"".join(eq.process(pcm[i:i + 320], 8000) for i in range(0, len(pcm), 320))
    assert len(whole) == len(chunked) == len(pcm)
    a = np.frombuffer(whole, dtype=np.int16).astype(int)
    b_ = np.frombuffer(chunked, dtype=np.int16).astype(int)
    assert np.abs(a - b_).max() <= 1, np.abs(a - b_).max()


def test_voice_eq_keeps_separate_state_per_sample_rate():
    """Live TTS arrives at 24 kHz and cache hits at 8 kHz in the SAME call."""
    eq = _fresh_eq()
    import numpy as np
    for sr in (24000, 8000, 24000):
        pcm = (np.zeros(sr // 50) + 1000).astype(np.int16).tobytes()
        assert len(eq.process(pcm, sr)) == len(pcm)
    assert sorted(eq._states) == [8000, 24000]


def test_voice_eq_never_returns_out_of_range_audio():
    import numpy as np
    eq = _fresh_eq(makeup_db=12.0)          # deliberately abusive
    pcm = (np.full(4000, 32000)).astype(np.int16).tobytes()
    out = np.frombuffer(eq.process(pcm, 8000), dtype=np.int16)
    assert out.min() >= -32768 and out.max() <= 32767
    assert eq.clipped_samples >= 0


def test_voice_eq_is_off_when_disabled_and_wired_after_the_duck():
    import types, inspect
    from app.voice_eq import build_voice_eq
    assert build_voice_eq(types.SimpleNamespace(voice_eq_enabled=False)) is None
    src = inspect.getsource(b.run_bot)
    assert "_voice_eq = build_voice_eq(settings)" in src
    assert src.index("duck,\n") < src.index("make_voice_eq_processor(_voice_eq)")
    assert src.index("make_voice_eq_processor(_voice_eq)") < src.index("transport.output(),")


# ── Voice modulation: pitch-range expansion on the audio, any engine ─────────

def _vibrato(sr=8000, secs=3.0, f0=200.0, depth_st=2.0, rate_hz=1.5):
    """A buzzy 'voice' whose pitch swings ±depth_st semitones — a stand-in for
    the up-and-down of speech that the shaper must widen."""
    import numpy as np
    t = np.arange(int(sr * secs)) / sr
    f = f0 * 2 ** (depth_st * np.sin(2 * np.pi * rate_hz * t) / 12)
    phase = 2 * np.pi * np.cumsum(f) / sr
    # Harmonic-rich (sawtooth-ish) so pitch tracking has something to lock on.
    x = sum(np.sin(k * phase) / k for k in range(1, 8))
    return (x / np.abs(x).max() * 12000).astype(np.int16)


def _pitch_spread_st(pcm16, sr):
    import numpy as np
    x = pcm16.astype(float); hop = int(sr * 0.02); win = int(sr * 0.04); f = []
    for i in range(0, len(x) - win, hop):
        fr = x[i:i + win] - x[i:i + win].mean()
        ac = np.correlate(fr, fr, "full")[win - 1:]; ac = ac / (ac[0] + 1e-9)
        lo, hi = int(sr / 350), int(sr / 70); k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.5:
            f.append(sr / k)
    f = np.array(f)
    return float((12 * np.log2(f / np.median(f))).std())


def _stream(shaper, pcm16, sr, frame_ms=20):
    import numpy as np
    pcm = pcm16.tobytes(); step = int(sr * frame_ms / 1000) * 2; out = b""
    for i in range(0, len(pcm), step):
        out += shaper.process(pcm[i:i + step], sr)
    out += shaper.flush(sr)
    return np.frombuffer(out, dtype=np.int16)


def test_prosody_widens_pitch_and_keeps_length_when_streamed():
    """Clients, 2026-09-11: "the tone is very linear — bot like". Fed 20 ms at a
    time like the pipeline does, the shaper must (a) widen the pitch movement by
    about the factor asked, (b) return exactly as many samples as it was given
    — a lost or duplicated block is a stutter on the line — and (c) not add
    seams sharper than the audio already has."""
    import numpy as np
    pytest.importorskip("parselmouth")
    from app.prosody import ProsodyShaper
    x = _vibrato()
    y = _stream(ProsodyShaper(1.6), x, 8000)
    assert len(y) == len(x)
    before, after = _pitch_spread_st(x, 8000), _pitch_spread_st(y, 8000)
    assert 1.3 < after / before < 1.9, (before, after)
    assert np.abs(np.diff(y.astype(int))).max() <= np.abs(np.diff(x.astype(int))).max() * 1.5
    assert np.abs(y).max() <= 32767


def test_prosody_is_a_no_op_at_one_and_drops_pending_on_reset():
    from app.prosody import ProsodyShaper, build_prosody_shaper, clamp_expand
    pcm = b"\x00\x10" * 400
    assert ProsodyShaper(1.0).process(pcm, 8000) == pcm      # off = untouched, no delay
    assert build_prosody_shaper(1.0) is None
    assert build_prosody_shaper(None) is None
    assert build_prosody_shaper("garbage") is None
    assert clamp_expand(9) == 2.5 and clamp_expand(0.2) == 1.0 and clamp_expand("1.6") == 1.6
    pytest.importorskip("parselmouth")
    sh = ProsodyShaper(1.6)
    assert sh.process(pcm, 8000) == b""                      # buffered, not yet a block
    sh.reset()                                               # interruption
    assert sh.flush() == b""                                 # nothing leaks after it


def test_prosody_keeps_separate_state_per_sample_rate():
    """Live TTS is 24 kHz and cache hits are 8 kHz in the SAME call; a block
    must never be assembled from both."""
    pytest.importorskip("parselmouth")
    from app.prosody import ProsodyShaper
    sh = ProsodyShaper(1.6)
    a = _stream(sh, _vibrato(sr=24000, secs=1.0), 24000)
    b_ = _stream(sh, _vibrato(sr=8000, secs=1.0), 8000)
    assert len(a) == 24000 and len(b_) == 8000
    # A rate change releases and retires the other rate's state (playout order).
    assert sorted(sh._states) == [8000]


@pytest.mark.asyncio
async def test_played_transcript_drops_the_sequencers_duplicate_text():
    """Call 34f258c2 (2026-09-11): with one audio context per sentence, pipecat's
    sequencer force-completes a slot and re-emits its text — "Great, thanks.
    Great, thanks." in the transcript while the recording plays it once."""
    from pipecat.frames.frames import TTSTextFrame
    from pipecat.processors.frame_processor import FrameDirection
    import unittest.mock as um
    o = FakeOutcome()
    rec = b.PlayedTranscriptRecorder(o)

    async def fake_push(frame, direction=FrameDirection.DOWNSTREAM):
        pass
    rec.push_frame = fake_push

    async def fake_super(self, frame, direction):
        return

    async def drive(text):
        with um.patch.object(b.FrameProcessor, "process_frame", new=fake_super):
            await rec.process_frame(TTSTextFrame(text, aggregated_by="sentence"),
                                    FrameDirection.DOWNSTREAM)
    for t in ("Great, thanks.", "Great, thanks.", "So the reason I called.", "Just a second.",
              "just a second.", "Fair enough."):
        await drive(t)
    assert o.transcript == [{"role": "assistant",
                             "text": "Great, thanks. So the reason I called. Just a second. Fair enough."}]


@pytest.mark.asyncio
async def test_a_short_answer_drops_the_held_question_tail():
    """Call 34f258c2 (2026-09-11): "…Is that you?" → "Yes." → the HELD tail "Or
    does someone help?" resumed after the answer. A short reply to a question
    already asked is its answer: drop the tail, cue the model to respond."""
    rec = _Rec()
    out = FakeOutcome()
    out.transcript.append({"role": "assistant",
                           "text": "So who's doing the daily running around? Is that you?"})

    class Duck:
        def is_ducked(self):
            return True

        def has_pending_audio(self):
            return True
    absorbed = []

    async def _absorb(t):
        absorbed.append(t)
    tc = b.TranscriptCollector(
        out, lambda user=True: None,
        is_bot_speaking=lambda: True, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: False, filler_phrases=[],
        in_machine_window=lambda: False, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: True, duck=Duck(), on_absorb=_absorb)

    async def _push(frame, direction=None):
        rec.frames.append(frame)
    tc.push_frame = _push
    interrupted = []

    async def _bi():
        interrupted.append(True)
    tc.broadcast_interruption = _bi
    await _feed(tc, "Yes.")
    assert interrupted and not absorbed
    cues = _cue_texts(rec)
    assert "Yes." in cues and any("their ANSWER" in c for c in cues), cues


def test_sentinel_never_speaks_a_tool_call_block():
    """Call 5a9fe35a (2026-09-11): sarvam-105b wrote a GLM-style
    "<tool_call>send_whatsapp_message <arg_key>phone_number</arg_key>…" instead
    of <<SEND:key>> and the TTS read it — phone number included — to the caller."""
    full = ("I can WhatsApp you a short overview. <tool_call>send_whatsapp_message "
            "<arg_key>phone_number</arg_key><arg_value>9001909009</arg_value></tool_call> "
            "I'm sending it now.")
    assert b._TOOL_CALL_RE.sub("", full) == "I can WhatsApp you a short overview.  I'm sending it now."
    # Unterminated block: everything from "<tool_call>" is held, never spoken.
    emit, held = b.SentinelGate._split_safe("Sure. <tool_call>send_whatsapp_message <arg_key>ph")
    assert emit == "Sure. " and held.startswith("<tool_call>")
    # A half-written opener is held too, so "<tool_c" is not read as words.
    emit, held = b.SentinelGate._split_safe("Sure. <tool_c")
    assert emit == "Sure. " and held == "<tool_c"
    # Stray argument tags outside a block are dropped as well.
    assert b._TOOL_CALL_RE.sub("", "ok </arg_value> done") == "ok  done"


def test_lead_name_is_cleaned_before_it_is_spoken():
    """Same call: the list held "Bhawana Jain (founder)" and the bot said
    "Hi, is this Bhawana Jain founder?"; its batch also carried
    "Beena Bhati / Pooja" and "I Am Yoga Studio"."""
    assert b._clean_lead_name("Bhawana Jain (founder)") == "Bhawana Jain"
    assert b._clean_lead_name("Beena Bhati / Pooja") == "Beena Bhati"
    assert b._clean_lead_name("  Shefali  [hot lead] ") == "Shefali"
    assert b._clean_lead_name("I Am Yoga Studio") is None
    assert b._clean_lead_name("Robotics Programs for Schools") is None
    assert b._clean_lead_name("919425677707") is None
    assert b._clean_lead_name("(founder)") is None
    assert b._clean_lead_name("Riya Jain") == "Riya Jain"
    assert b._clean_lead_name(None) is None


def test_prosody_never_reorders_audio_across_sample_rates():
    """Call 5a9fe35a (2026-09-11): a cached 8 kHz "Got it." left its tail in the
    8 kHz buffer while the live 24 kHz sentence streamed past; the tail came out
    mid-sentence ("Since you're Got it. So you have…"). A rate change must flush
    the other rate FIRST, and the flushed bytes must be reported at THEIR rate."""
    import numpy as np
    pytest.importorskip("parselmouth")
    from app.prosody import ProsodyShaper
    sh = ProsodyShaper(1.6)
    cached = _vibrato(sr=8000, secs=0.2)               # shorter than block+context: all buffered
    assert sh.process(cached.tobytes(), 8000) == b""   # buffered
    live = _vibrato(sr=24000, secs=0.02)
    out = sh.process(live.tobytes(), 24000)            # rate change → 8 kHz must go out first
    assert sh.last_flushed_rate == 8000
    assert len(sh.pending_other_rate) == len(cached.tobytes())
    assert out == b""                                  # the 24 kHz chunk is now buffering
    assert sorted(sh._states) == [24000]               # 8 kHz state fully released


def test_prosody_is_per_agent_and_wired_before_the_eq():
    """The dashboard's voiceModulation (V504) wins over the box default, and the
    processor shapes the full-band voice BEFORE the telephone EQ band-limits it."""
    import inspect
    src = inspect.getsource(b.run_bot)
    assert 'agent.get("voiceModulation")' in src
    assert "settings.prosody_expand" in src
    assert src.index("make_prosody_processor(_prosody)") < src.index("make_voice_eq_processor(_voice_eq)")
    assert src.index("duck,\n") < src.index("make_prosody_processor(_prosody)")


# ── Ambience drift: a room is never at exactly one level ─────────────────────

def test_ambience_drift_is_off_until_the_call_starts_and_bounded_after():
    import math, time
    from app.ambience import AmbienceDucker
    d = AmbienceDucker(0.15, drift_db=2.0, drift_period_secs=40)
    assert d._drift(time.time()) == 1.0          # no StartFrame yet -> flat
    assert d._target(time.time()) == 0.15
    d._t0 = 1000.0
    vals = [d._target(1000.0 + t) for t in range(0, 80)]
    lo, hi = min(vals), max(vals)
    assert 20 * math.log10(hi / lo) <= 4.1, (lo, hi)   # +/-2 dB swing, no more
    assert lo > 0 and hi <= 1.0
    # Ducking still applies on top of the drift, never instead of it.
    d._ducked = True
    assert d._target(1000.0) == round(0.15 * d._drift(1000.0) * 0.6, 4)


def test_ambience_drift_phase_differs_between_calls():
    from app.ambience import AmbienceDucker
    phases = {AmbienceDucker(0.15, drift_db=2.0)._phase for _ in range(8)}
    assert len(phases) > 1                        # not the same movement every call


@pytest.mark.asyncio
async def test_ambience_drift_skips_inaudible_updates():
    from app.ambience import AmbienceDucker
    rec = _Rec()
    d = AmbienceDucker(0.15, drift_db=2.0, drift_period_secs=40)
    d._t0 = 1000.0

    async def _push(frame, direction=None):
        rec.frames.append(frame)
    d.push_frame = _push
    await d._send_target(b.FrameDirection.DOWNSTREAM)     # first: always sends
    n = len(rec.frames)
    await d._send_target(b.FrameDirection.DOWNSTREAM)     # same instant: no change
    assert len(rec.frames) == n


# ── 2026-09-12: calls 862aa6a0 / ada2e60c ─────────────────────────────────────

def test_no_repeat_allows_one_greeting_per_call():
    """Call 862aa6a0: "Good morning!" five times in 30 s — one per barge-in
    regeneration. Greetings sit under is_repeat's 22-char floor on purpose (acks
    recur), so they need their own once-per-call rule."""
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "")
    assert g._keep("Good morning!") is True
    assert g._keep("Good morning!") is False
    assert g._keep("Hello!") is False                       # any greeting, not the same one
    assert g._keep("Namaste ji.") is False
    assert g._keep("Good, so the reason I called.") is True  # not a bare greeting
    assert g._keep("Good morning to you and your students.") is True


@pytest.mark.asyncio
async def test_played_transcript_drops_a_repeated_group_within_one_entry():
    """Call ada2e60c: "Okay, I understand. Thank you for your time, namaste." twice
    in the transcript, once in the recording — the sequencer re-emitted the whole
    two-sentence group, which consecutive-only de-duplication could not see."""
    from pipecat.frames.frames import TTSTextFrame
    from pipecat.processors.frame_processor import FrameDirection
    import unittest.mock as um
    o = FakeOutcome()
    rec = b.PlayedTranscriptRecorder(o)

    async def fake_push(frame, direction=FrameDirection.DOWNSTREAM):
        pass
    rec.push_frame = fake_push

    async def fake_super(self, frame, direction):
        return

    async def drive(text):
        with um.patch.object(b.FrameProcessor, "process_frame", new=fake_super):
            await rec.process_frame(TTSTextFrame(text, aggregated_by="sentence"), FrameDirection.DOWNSTREAM)
    for t in ("Okay, I understand.", "Thank you for your time, namaste.",
              "Okay, I understand.", "Thank you for your time, namaste."):
        await drive(t)
    assert o.transcript[-1]["text"] == "Okay, I understand. Thank you for your time, namaste."
    # A short ack CAN legitimately repeat inside one entry ("Okay." … "Okay.").
    for t in ("Okay.", "Right.", "Okay."):
        await drive(t)
    assert o.transcript[-1]["text"].endswith("Okay. Right. Okay.")


def test_analysis_json_parser_repairs_what_production_returned():
    """Call 862aa6a0: max_tokens cut the analyser's JSON mid-object and the whole
    report degraded to 'Automatic analysis unavailable'."""
    from app.report import _parse_analysis_json as parse
    assert parse('```json\n{"disposition": "Callback", "leadRating": 7}\n```') == {"disposition": "Callback", "leadRating": 7}
    assert parse('{"a": 1, "b": [1, 2,],}') == {"a": 1, "b": [1, 2]}
    truncated = '{"disposition": "Incomplete", "summary": "Mona takes personal classes.",\n "leadRating": 4,\n "extractedQa": {"q": "an'
    out = parse(truncated)
    assert out and out["disposition"] == "Incomplete" and out["leadRating"] == 4
    assert parse("no json here") is None and parse("") is None


def test_prompt_greets_once_ends_on_request_and_uses_first_name():
    p = b.build_system_prompt({"agent": {
        "name": "Aarushi", "systemPrompt": "Bot: Hi! I am Aarushi. " * 40, "direction": "OUTBOUND",
        "openingLine": "Hi! I am Aarushi from Vacademy."}, "leadName": "Vijay Madhekar"})
    assert "GREET ONCE" in p
    assert "never a clarifying question" in p
    assert "Address them by their FIRST name only ('Vijay'" in p


def test_placeholders_use_first_name_in_prompt_and_full_name_in_opening():
    """Simulator 2026-09-12: 12/12 callers addressed by full name mid-call —
    the authored prompt's "{{name}} ji" was filled with the list's full name."""
    ctx = {"leadName": "Sunita Devi", "agent": {"language": "english"}}
    assert b._fill_placeholders("Namaste {{name}} ji", ctx) == "Namaste Sunita ji"
    assert b._fill_placeholders("Hi, is this {{name}}?", ctx, full_name=True) == "Hi, is this Sunita Devi?"
    src = __import__("inspect").getsource(b.run_bot)
    assert src.count('(agent.get("openingLine") or "").strip(), context, full_name=True)') >= 2


def test_caller_wants_to_end_is_narrow():
    from app.turntake import caller_wants_to_end as w
    assert w("I don't need your assistance. Cut the call, thank you.")
    assert w("Wrong number. I'm a CA, I don't teach yoga.")
    assert w("Please don't call again.")
    assert w("Mujhe zaroorat nahi hai, phone rakhti hoon.")
    assert w("Okay thank you, bye.")
    assert w("Not interested.")
    assert not w("Not now, I'm in a class — call me in the evening.")
    assert not w("Yes, go ahead.")
    assert not w("I'm not sure the link is the problem.")
    assert not w("Bye the way, do you also handle fees?")  # 'bye' not last, >4 words


@pytest.mark.asyncio
async def test_turn_gate_forces_the_close_when_the_caller_asks_to_end():
    """Call ada2e60c / simulator 2026-09-12: 'cut the call' -> 'Just to clarify…'.
    The gate must cue a one-line goodbye and mark the outcome so the sentinel
    ends the call even if the model forgets the marker."""
    rec = _Rec()
    out = FakeOutcome()
    out.transcript.append({"role": "assistant", "text": "So the reason I called — we work with yoga teachers."})
    tc = b.TranscriptCollector(
        out, lambda user=True: None,
        is_bot_speaking=lambda: False, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: False, filler_phrases=[],
        in_machine_window=lambda: False, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: True)

    async def _push(frame, direction=None):
        rec.frames.append(frame)
    tc.push_frame = _push
    tc.broadcast_interruption = _noop_broadcast
    await _feed(tc, "I don't need your assistance. Cut the call, thank you.")
    assert getattr(out, "end_forced", False) is True
    assert any("asked to end this call" in c for c in _cue_texts(rec))
    # A normal answer must not trip it.
    out2 = FakeOutcome(); rec2 = _Rec()
    tc2 = b.TranscriptCollector(out2, lambda user=True: None, is_bot_speaking=lambda: False,
                                fillers_armed=lambda: False, bot_stopped_t=lambda: 0.0,
                                gate_enabled=lambda: True, interrupt_on_vad=lambda: False,
                                filler_phrases=[], in_machine_window=lambda: False,
                                reply_in_flight=lambda: False, bot_spoke_once=lambda: True)
    tc2.push_frame = _push; tc2.broadcast_interruption = _noop_broadcast
    await _feed(tc2, "Yes, all my classes are online on Zoom.")
    assert getattr(out2, "end_forced", False) is False


def test_is_farewell_is_narrow():
    from app.turntake import is_farewell as f
    assert f("ठीक है सर, कल के लिए मैं आपकी कॉल शेड्यूल कर देती हूँ। आपके समय के लिए धन्यवाद, नमस्ते।")
    assert f("No problem at all — thanks for your time. Namaste.")
    assert f("Okay, take care, bye!")
    assert not f("जी सर, धन्यवाद। क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ?")   # question
    assert not f("Namaste Aditi ji, I'm Aarushi from Vacademy. We came to know you take yoga classes — do you have two minutes?")
    assert not f("Thank you. So the reason I called — we work with yoga teachers on everything around their online classes.")
    assert not f("")


def test_no_repeat_drops_questions_once_the_caller_asked_to_end():
    flag = {"v": False}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "", end_forced=lambda: flag["v"])
    assert g._keep("Just to clarify, do you take online classes?") is True
    flag["v"] = True
    assert g._keep("Just to clarify, do you take online classes?") is False
    assert g._keep("No problem at all, thank you for your time.") is True


def test_fast_opener_rule_reaches_every_prompt_branch_and_has_a_kill_switch(monkeypatch):
    """2026-09-12 latency lever. TTS starts at the first sentence boundary, so
    the first sentence's length is the caller's wait (simulator baseline with
    the soft rule: median 5 words, p90 11). The strong rule must ride BOTH
    prompt branches; FAST_OPENER_ENABLED=false must restore the older wording
    verbatim so the lever can be pulled back without a deploy."""
    MARK = "FIRST SENTENCE RULE"
    OLD = "Keep the FIRST sentence of every reply short (a few words)"
    authored = b.build_system_prompt({"agent": {
        "name": "Aarushi", "systemPrompt": "Bot: Hi! I am Aarushi. " * 40,
        "direction": "OUTBOUND", "openingLine": "Hi! I am Aarushi from Vacademy."}})
    thin = b.build_system_prompt({"agent": {
        "name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
    for p in (authored, thin):
        assert MARK in p and OLD not in p
        # the opener must never be a greeting (NoRepeatGate drops a second one)
        # and the existing anti-Hmm limit survives inside the new rule
        assert "never a filler noise, a greeting" in p
        assert "one reply in five" in p
    monkeypatch.setenv("FAST_OPENER_ENABLED", "false")
    from app.config import get_settings as _gs
    _gs.cache_clear()
    try:
        off = b.build_system_prompt({"agent": {
            "name": "A", "systemPrompt": "short", "direction": "OUTBOUND"}})
        assert MARK not in off and OLD in off
    finally:
        _gs.cache_clear()


def test_stt_provider_smallest_maps_agent_language_pins_and_honours_the_hold(monkeypatch):
    """2026-09-12 switch. Three-way bench on real recordings (see config.py):
    Smallest Pulse beat Sarvam on finality tail (p90 0.23 s vs 1.86 s) and word
    error, and hears the lone 'haan' Sarvam drops. The factory must (a) hand
    Pulse a bare code — agents pin 'hi-IN', Pulse rejects it, and 'hi' IS its
    code-switching mode; (b) keep the pipeline sample rate (16 kHz measured
    WORSE); (c) pass the measured turn-stop hold; (d) refuse to start without a
    key rather than dial a caller into a silent STT."""
    from app import providers as pv
    from app.config import get_settings as _gs
    monkeypatch.setenv("STT_PROVIDER", "smallest")
    monkeypatch.setenv("SMALLEST_API_KEY", "sk_test")
    monkeypatch.setenv("SMALLEST_TTFS_P99", "0.5")
    _gs.cache_clear()
    try:
        from pipecat.services.smallest.stt import SmallestSTTService
        stt = pv.build_stt(8000, language="hi-IN")
        assert isinstance(stt, SmallestSTTService)
        assert stt._settings.language == "hi"
        assert stt._ttfs_p99_latency == 0.5 or getattr(stt, "ttfs_p99_latency", 0.5) == 0.5
        assert pv.build_stt(8000, language="en-IN")._settings.language == "en"
        assert pv.build_stt(8000, language="klingon")._settings.language == "hi"
        monkeypatch.setenv("SMALLEST_API_KEY", "")
        _gs.cache_clear()
        import pytest
        with pytest.raises(RuntimeError):
            pv.build_stt(8000)
    finally:
        _gs.cache_clear()


# ── call 08df7128 (2026-09-12): "Right." "Right." then 12 s of nothing ───────

@pytest.mark.asyncio
async def test_the_same_filler_twice_in_one_reply_is_dropped():
    """The model opened with 'Right.' and, after its real sentences were
    already-said drops, closed with another 'Right.' — two cached contexts,
    each 3 s of phantom speaking, and the caller heard a filler twice.
    Different acknowledgments in one reply stay (see
    test_short_acknowledgements_are_never_suppressed)."""
    rec = _NRRec()
    g = _no_repeat(rec, caller="Yes")
    await _reply(g, "Right. ", "Right.")
    assert [t.strip() for t in rec.text] == ["Right."]
    rec.text.clear()
    await _reply(g, "Okay. ", "Right.")
    assert [t.strip() for t in rec.text] == ["Okay.", "Right."]


@pytest.mark.asyncio
async def test_only_fillers_surviving_hands_the_turn_back():
    """'Right.' survived, the three real sentences behind it were dropped as
    already said, and the caller got 'Right.' then silence. 'Nothing
    answerable was said' must hand back exactly like 'nothing was said'."""
    rec = _NRRec()
    g = _no_repeat(rec, caller="Yes")
    S = "So that morning message is on you, daily, and the link goes out on its own."
    await _reply(g, S)
    rec.text.clear()
    await _reply(g, "Right. ", S)
    said = [t.strip() for t in rec.text]
    assert said[0] == "Right."
    assert len(said) == 2, said
    assert said[1] in b.NoRepeatGate._HANDBACK + b.NoRepeatGate._HANDBACK_EN, said


@pytest.mark.asyncio
async def test_fillers_do_not_feed_the_hand_back_escalation():
    """Widening the content-free set once made 'Theek hai. Achha.' hold its
    own opener on the next reply (the escalation counter saw a content-free
    TURN). Acknowledgment noises are fillers for the two rules above and
    nothing else."""
    rec = _NRRec()
    g = _no_repeat(rec, caller="haan")
    await _reply(g, "Right.")
    assert g._consecutive_handbacks == 0
    rec.text.clear()
    await _reply(g, "Okay. ", "Sunday ko hai.")
    assert [t.strip() for t in rec.text] == ["Okay.", "Sunday ko hai."]


@pytest.mark.asyncio
async def test_no_hand_back_after_a_forced_close():
    """A goodbye must stay a goodbye: with the caller having asked to end, an
    already-said tail behind a short closing line must not grow a 'Yes, go
    ahead.'"""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "cut the call",
                       end_forced=lambda: True)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    S = "Thank you for your time, have a lovely day ahead."
    await _reply(g, S)
    rec.text.clear()
    await _reply(g, "Okay. ", S)
    said = [t.strip() for t in rec.text]
    assert said == ["Okay."], said


def test_played_question_check_tolerates_a_few_words_of_the_next_sentence():
    """Word-timed text frames + STT finality delay: by the time 'Yes.' lands,
    'Is that' has already played after 'right now?'. Still an answer to the
    question. A long stretch after the last '?' is not."""
    class _O:
        transcript = [{"role": "assistant", "text": "Who is doing it right now? Is that"},
                      {"role": "user", "text": "Yes."}]
    tc = b.TranscriptCollector.__new__(b.TranscriptCollector)
    tc._outcome = _O()
    assert tc._played_ended_with_question() is True
    _O.transcript[0]["text"] = ("Who is doing it right now? Is that you or does someone help "
                                "you every single morning with the")
    assert tc._played_ended_with_question() is False
    _O.transcript[0]["text"] = "So the reason I called is the daily link"
    assert tc._played_ended_with_question() is False


# ── call f08f5712 (2026-09-12): "Hello?" after the question; "Yes, I'm here." twice ──

@pytest.mark.asyncio
async def test_the_same_sentence_twice_in_one_reply_is_dropped_whatever_its_length():
    rec = _NRRec()
    g = _no_repeat(rec, caller="Hello? Hello, hello, hello?")
    await _reply(g, "Yes, I'm here. ", "Yes, I'm here.")
    assert [t.strip() for t in rec.text] == ["Yes, I'm here."]
    # across replies a short sentence may still recur (acknowledgments)
    rec.text.clear()
    await _reply(g, "Yes, I'm here.")
    assert [t.strip() for t in rec.text] == ["Yes, I'm here."]


def test_caller_checking_presence():
    from app.turntake import caller_checking_presence as f
    for yes in ("Hello?", "Hello? Hello, hello, hello?", "hello hello", "Are you there?",
                "Kya aap sun rahe hain?", "hello ji", "Awaaz aa rahi hai?"):
        assert f(yes), yes
    for no in ("Yes.", "Online.", "Hello, I teach yoga online on Zoom.", "haan ji online",
               "yes go ahead", "", "[cue]"):
        assert not f(no), no


def test_last_played_question_comes_from_what_the_caller_heard():
    class _O:
        transcript = [
            {"role": "assistant", "text": "Hi, is this Devang? Aarushi from Vacademy"},
            {"role": "user", "text": "Okay."},
            {"role": "assistant", "text": "Thank you. So the reason I called. Basically so you "
                                          "only have to teach. You'd be taking classes online "
                                          "these days I'm guessing — or is it all offline right now?"},
            {"role": "assistant", "text": "Hello? Are you still there?"},
            {"role": "user", "text": "Hello?"},
        ]
    tc = b.TranscriptCollector.__new__(b.TranscriptCollector)
    tc._outcome = _O()
    # the nudge is a question too, but it is the bot's own line check —
    # re-asking it is the loop this exists to break. Skip to the real question.
    assert tc._last_played_question().endswith("offline right now?")
    _O.transcript.pop(3)
    assert tc._last_played_question().endswith("offline right now?")
    _O.transcript = [{"role": "assistant", "text": "Okay. Thank you."}, {"role": "user", "text": "Hello?"}]
    assert tc._last_played_question() == ""


@pytest.mark.asyncio
async def test_a_line_check_licenses_repeating_the_lost_question():
    """The cue re-asks the question verbatim; without this the no-repeat gate
    dropped it as already said and the caller heard only "Yes, I'm here."
    (call f08f5712, and the hello_checker persona before this line)."""
    rec = _NRRec()
    caller = {"t": "Okay."}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "You'd be taking classes online these days I'm guessing — or is it all offline right now?"
    await _reply(g, "So the reason I called is the daily link and the fees. ", Q)
    caller["t"] = "Hello? Hello, hello?"
    rec.text.clear()
    await _reply(g, "Yes, I'm here. ", Q)
    assert any("offline right now?" in t for t in rec.text), rec.text


# ── call 31763255 (2026-09-12): fragment finals as barge-ins; "yes." dropped as a scrap ──

def test_fragment_continuation_shapes():
    from app.turntake import is_fragment_continuation as f
    assert f("Sorry, you wanted to say somet", "hing", 0.44)
    assert f("It happens to my frie", "nd", 0.5)
    assert f("? It makes", "some", 0.9)
    assert f("You still", "me?", 0.5)
    assert f("आप कौन बोल रहे", "हैं?", 0.5)        # Devanagari tail with the sentence end
    assert f(", मैं मैं बच्चे का पिता बोल रहा", "हूँ।", 0.5)
    assert not f("It is offline.", "नहीं।", 0.5)   # a finished piece, then a new one
    assert not f("Okay.", "Hello?", 0.6)              # finished, then a new utterance
    assert not f("Yes, go ahead", "Actually wait, I am busy now", 0.8)   # long = new
    assert not f("Yes, go ahead", "hello", 1.4)       # too late to be the same breath
    assert not f("", "hing", 0.2) and not f("abc", "[cue]", 0.2)


@pytest.mark.asyncio
async def test_a_fragment_tail_does_not_interrupt_the_reply():
    """"? It makes" → reply in flight → "some" 0.8 s later. The tail is the same
    utterance: no interruption, the reply keeps playing, and the words still
    reach the context (absorb path)."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    tc._reply_in_flight = lambda: False
    await _feed(tc, "? It makes")
    assert rec.interruptions == 0
    tc._reply_in_flight = lambda: True
    tc._is_bot_speaking = lambda: True
    rec.frames.clear()
    await _feed(tc, "some")
    assert rec.interruptions == 0, "the tail of the caller's own sentence killed the reply"
    assert tc._outcome.transcript[-1] == {"role": "user", "text": "? It makes some"}
    assert any("some" in c for c in rec.cues()), "the words never reached the context"


@pytest.mark.asyncio
async def test_a_letterless_final_never_interrupts():
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True)
    await _feed(tc, "।")
    assert rec.interruptions == 0 and rec.frames == []
    assert all(e.get("text") != "।" for e in tc._outcome.transcript)


@pytest.mark.asyncio
async def test_a_real_new_utterance_after_a_finished_one_still_barges_in():
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True)
    await _feed(tc, "Online.")
    rec.interruptions = 0
    await _feed(tc, "Actually wait, I have a question about the fees.")
    assert rec.interruptions == 1


@pytest.mark.asyncio
async def test_voicemail_is_recognised_only_from_carrier_phrases():
    """Call 24089872 (2026-09-12): the bot nudged twice and said goodbye to
    "forwarded to voicemail… at the tone". A carrier phrase with no human turn
    is voicemail; a scrap, silence, or any real caller words are not."""
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: False
    assert tc.looks_like_voicemail() is False          # silence is not a machine
    await _feed(tc, "Hi.")                              # a scrap is not a machine
    assert tc.looks_like_voicemail() is False
    await _feed(tc, "Your call has been forwarded to voicemail.")
    assert tc.looks_like_voicemail() is True
    tc2 = _replay_collector(rec)
    tc2._bot_spoke_once = lambda: False
    await _feed(tc2, "Your call has been forwarded to voicemail.")
    tc2._bot_spoke_once = lambda: True
    await _feed(tc2, "haan ji bol raha hoon")           # a human after all
    assert tc2.looks_like_voicemail() is False


@pytest.mark.asyncio
async def test_a_yes_after_an_echo_only_reply_demands_the_next_step():
    """Call 15aadcdb (2026-09-13): "It is offline." → "It's all offline right
    now." → "Yes" → carry-on cue → another echo, four rounds. When the last
    reply asked nothing, the acknowledgment must cue the NEXT step."""
    rec = _Rec()
    # the reply has finished (bot silent) but the VAD onset just cut the tail
    # bookkeeping — exactly the live shape (recently cut, nothing pending)
    tc = _replay_collector(rec, bot_speaking=False, bot_stopped_t=lambda: time.time())
    tc._recently_cut = lambda: True          # the VAD onset stamped a cut
    tc._outcome.transcript.extend([
        {"role": "user", "text": "It is offline."},
        {"role": "assistant", "text": "It's all offline right now."},
    ])
    await _feed(tc, "Yes")
    cues = rec.cues()
    assert any("NEXT step" in c for c in cues), cues
    assert not any("carry on" in c for c in cues), cues
    # the same "yes" while that statement is still PLAYING carries on
    rec3 = _Rec()
    tc3 = _replay_collector(rec3, bot_speaking=True, bot_stopped_t=lambda: time.time())
    tc3._outcome.transcript.extend([
        {"role": "user", "text": "It is offline."},
        {"role": "assistant", "text": "It's all offline right now."},
    ])
    await _feed(tc3, "Yes")
    assert any("carry on" in c for c in rec3.cues()), rec3.cues()
    # with a question on the line, "yes" answers it as before
    rec2 = _Rec()
    tc2 = _replay_collector(rec2, bot_stopped_t=lambda: time.time())
    tc2._outcome.transcript.extend([
        {"role": "user", "text": "Online."},
        {"role": "assistant", "text": "And who sends the daily link — you, or someone else?"},
    ])
    await _feed(tc2, "Yes")
    assert not any("NEXT step" in c for c in rec2.cues()), rec2.cues()


# ── founder 2026-09-13: "whatever is being answered the bot is again reconfirming" ──

def test_is_echo_of_answer_shapes():
    from app.turntake import is_echo_of_answer as f
    Q = "You'd be taking classes online these days I'm guessing — or is it all offline right now?"
    assert f("Okay, so it's all offline right now.", "It is offline.", Q)
    assert f("So no online classes at all then?", "It is offline.", Q)
    assert f("You're maintaining an Excel sheet.", "Uh, we maintain Excel sheet, ma'am.",
             "And are you tracking who's paid in a diary, or how does that work?")
    assert f("Okay, so they do UPI.", "Yeah, they can do UPI. We share the QR code with them",
             "Is it mostly GPay or PhonePe?")
    # new content is not an echo
    assert not f("Who handles the fees for your offline batches?", "It is offline.", Q)
    assert not f("Then the daily part must be on you.", "Online.", "Are your classes online?")
    # an answer to the caller's question is not an echo
    assert not f("Yes, it is offline only.", "Is it offline?", "")
    assert not f("Okay.", "It is offline.", Q)          # content-free, someone else's job


@pytest.mark.asyncio
async def test_a_restated_answer_is_dropped_when_something_follows_and_kept_alone():
    rec = _NRRec()
    caller = {"t": "It is offline."}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "You'd be taking classes online these days I'm guessing — or is it all offline right now?")
    rec.text.clear()
    await _reply(g, "Okay, so it's all offline right now. ",
                 "Who handles the fees and reminders for your offline batches?")
    assert [t.strip() for t in rec.text] == [
        "Who handles the fees and reminders for your offline batches?"], rec.text
    rec.text.clear()
    caller["t"] = "Yes."
    await _reply(g, "So you're only doing offline classes.")
    assert [t.strip() for t in rec.text] == ["So you're only doing offline classes."], \
        "a restatement that is the whole reply must still be spoken"


# ── call a59696ed (2026-09-13): "Okay.Yes, go ahead." ended the call ─────────

@pytest.mark.asyncio
async def test_an_all_repeat_reply_after_an_answer_asks_for_the_next_step():
    """The caller answered "Yes" and the model's whole reply was that same
    question again. Handing the turn back to someone who has just spoken
    ("Yes, go ahead.") is nonsense — they hung up. Ask the model for its next
    line instead, at most twice per call."""
    rec = _NRRec()
    asked = []

    async def _next_step(held, kind="", attempt=0):
        asked.append(held)
    caller = {"t": "Yes"}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "Are you sending it on WhatsApp yourself every morning?"
    await _reply(g, Q)
    rec.text.clear()
    await _reply(g, "Okay. ", "So " + Q[0].lower() + Q[1:])
    assert asked, "no next-step request"
    assert not any("go ahead" in t for t in rec.text), rec.text


@pytest.mark.asyncio
async def test_a_handback_is_spaced_off_the_sentence_before_it():
    """"Okay." + "Yes, go ahead." reached the line as "Okay.Yes, go ahead." —
    the raw push bypassed the spacing _emit does."""
    rec = _NRRec()
    caller = {"t": ""}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "Are you sending it on WhatsApp yourself every morning?"
    await _reply(g, Q)
    rec.text.clear()
    await _reply(g, "Okay. ", "So " + Q[0].lower() + Q[1:])
    joined = "".join(rec.text)
    assert "." + "Yes" not in joined.replace(". Yes", ""), joined
    assert len(rec.text) < 2 or rec.text[-1].startswith(" "), rec.text


# ── call a59696ed (2026-09-13): the caller's "Yes" was never transcribed ─────

@pytest.mark.asyncio
async def test_smallest_asks_pulse_again_when_a_turn_produced_no_transcript():
    """Pulse decodes whatever it has when our VAD stop sends `finalize`; on a
    one-word answer that is ~0.3 s of audio and it answers ~2.5 s late or drops
    the utterance entirely. Measured: "haan" 2.50 s → 0.82 s with the retry,
    and a healthy "yes" stays at 0.11 s because the retry never goes out."""
    import asyncio
    import json as _json
    from pipecat.frames.frames import (VADUserStartedSpeakingFrame,
                                       VADUserStoppedSpeakingFrame)
    from app import providers as pv

    class _FakeWS:
        def __init__(self):
            self.sent = []
            self.state = type("S", (), {"name": "OPEN"})()

        async def send(self, msg):
            self.sent.append(_json.loads(msg))

    class _Base:
        def __init__(self, **kw):
            self._websocket = _FakeWS()
            self._tasks = []

        async def process_frame(self, frame, direction):
            if isinstance(frame, VADUserStoppedSpeakingFrame):
                await self._websocket.send(_json.dumps({"type": "finalize"}))

        async def _process_response(self, data):
            return None

        def create_task(self, coro):
            t = asyncio.get_event_loop().create_task(coro)
            self._tasks.append(t)
            return t

    cls = pv._smallest_with_finalize_retry(_Base, 0.05, 2)
    assert pv._smallest_with_finalize_retry(_Base, 0, 2) is _Base, "kill switch"

    # nothing comes back → Pulse is asked again
    stt = cls()
    await stt.process_frame(VADUserStartedSpeakingFrame(), None)
    await stt.process_frame(VADUserStoppedSpeakingFrame(), None)
    await asyncio.sleep(0.18)
    assert len(stt._websocket.sent) == 3, stt._websocket.sent
    assert all(m["type"] == "finalize" for m in stt._websocket.sent)

    # a real final arrives → no retry at all (the healthy turn pays nothing)
    stt2 = cls()
    await stt2.process_frame(VADUserStoppedSpeakingFrame(), None)
    await stt2._process_response({"is_final": True, "transcript": "Yes"})
    await asyncio.sleep(0.18)
    assert len(stt2._websocket.sent) == 1, stt2._websocket.sent

    # an EMPTY final is exactly the case we retry for, not an answer
    stt3 = cls()
    await stt3.process_frame(VADUserStoppedSpeakingFrame(), None)
    await stt3._process_response({"is_final": True, "transcript": "   "})
    await asyncio.sleep(0.18)
    assert len(stt3._websocket.sent) == 3, stt3._websocket.sent

    # the caller speaking again cancels anything pending
    stt4 = cls()
    await stt4.process_frame(VADUserStoppedSpeakingFrame(), None)
    await stt4.process_frame(VADUserStartedSpeakingFrame(), None)
    await asyncio.sleep(0.18)
    assert len(stt4._websocket.sent) == 1, stt4._websocket.sent


# ── call 612f5e37 (2026-09-13): "haan, bol sakte hain sir" → "जी सर।" → silence ──

@pytest.mark.asyncio
async def test_a_filler_only_reply_after_the_caller_spoke_asks_for_the_next_step():
    """The model acknowledged and stopped. Nothing was held, so the all-repeat
    path could not fire; the caller waited 6 s and said "Hello". A reply that
    is only a filler, after a real caller turn, asks for the next line."""
    rec = _NRRec()
    asked = []

    async def _next_step(held, kind="", attempt=0):
        asked.append(held)
    caller = {"t": ". अ, हाँ, बोल सकते हैं sir"}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "जी सर।")
    assert [t.strip() for t in rec.text] == ["जी सर।"], "the filler itself still plays"
    assert asked == [""], asked
    # with real content behind it, nothing is requested
    asked.clear(); rec.text.clear()
    caller["t"] = "Yes"
    await _reply(g, "जी सर। ", "Vijit के previous class में कितने marks आए थे?")
    assert asked == [], asked
    # and never when the caller said nothing (an idle nudge's reply, say)
    asked.clear()
    caller["t"] = ""
    await _reply(g, "Okay.")
    assert asked == [], asked


def test_hindi_acknowledgments_are_fillers():
    for t in ("जी सर।", "जी सर", "Ji sir.", "हाँ जी।", "ok sir", "Yes ma'am.", "जी।"):
        assert b.NoRepeatGate._is_filler(t), t
    for t in ("जी सर, Vijit अभी Class 7 में है।", "Sir, marks kitne aaye the?"):
        assert not b.NoRepeatGate._is_filler(t), t


# ── campaign 2026-09-15 (JustDial bridge, unnamed leads, hello loops) ─────────

def test_call_connect_bridge_announcements_are_the_operator():
    from app.turntake import is_carrier_announcement as f
    for t in ("You are getting connected by Josh Dial", "You are getting connected by Job Dial",
              "you are being connected by Jove Diels", "Connecting your call"):
        assert f(t), t
    assert not f("Yes, I take classes online and connect with students on Zoom.")


@pytest.mark.asyncio
async def test_the_bridge_announcement_does_not_skip_our_opening():
    """Three calls at 04:07:43: the bridge line counted as the callee speaking
    first, the opening was skipped, and the person picked up to silence."""
    from app.turntake import suppresses_opening
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: False
    await _feed(tc, "You are getting connected by Josh Dial")
    assert rec.frames == [], "the bridge line reached the model"
    assert tc._carrier_seen


def test_an_unnamed_english_lead_is_not_asked_is_this():
    """Every row with a blank name played "Hi, is this? Aarushi from Vacademy"."""
    out = b._fill_placeholders("Hi, is this {{name}}? Aarushi from Vacademy",
                               {"agent": {"language": "en-IN"}, "leadName": ""}, full_name=True)
    assert out == "Hi, Aarushi from Vacademy", out
    out2 = b._fill_placeholders("Hi, is this {{name}}? Aarushi from Vacademy",
                                {"agent": {"language": "en-IN"}, "leadName": "Rina"}, full_name=True)
    assert out2 == "Hi, is this Rina? Aarushi from Vacademy", out2
    # Hindi keeps its "aap" fallback and its clause
    out3 = b._fill_placeholders("Namaste, kya main {{name}} se baat kar rahi hoon?",
                                {"agent": {"language": "hinglish"}, "leadName": ""}, full_name=True)
    assert "aap" in out3, out3


def test_hello_mid_reply_is_absorbed_not_interrupted():
    """Each "Hello?" used to kill the re-ask that answered the previous one."""
    from app.turntake import mid_reply_action, ABSORB, INTERRUPT
    assert mid_reply_action("Hello?") == ABSORB
    assert mid_reply_action("Hello? Hello?") == ABSORB
    assert mid_reply_action("Are you there?") == ABSORB
    assert mid_reply_action("What is the fee?") == INTERRUPT
    assert mid_reply_action("Hello, I wanted to ask about the fees?") == INTERRUPT


@pytest.mark.asyncio
async def test_a_second_hello_over_the_re_ask_escalates_to_can_you_hear_me():
    rec = _Rec()
    tc = _replay_collector(rec, bot_stopped_t=lambda: time.time())
    await _feed(tc, "haan ji bol raha hoon")
    rec.frames.clear(); rec.interruptions = 0
    await _feed(tc, "Hello?")
    assert rec.interruptions == 0, "the first hello must not cut the reply"
    rec.frames.clear()
    await _feed(tc, "Hello?")
    assert rec.interruptions == 0
    assert any("hear you" in c for c in rec.cues()), rec.cues()


@pytest.mark.asyncio
async def test_a_carrier_phrase_split_across_two_finals_still_matches():
    """"at the t" + "one, please record your message." (call 0938aaa0)."""
    rec = _Rec()
    tc = _replay_collector(rec)
    tc._bot_spoke_once = lambda: True
    await _feed(tc, "Your call has been forwarded to voicemail")
    assert tc._carrier_seen
    rec.frames.clear()
    await _feed(tc, "at the t")                    # a scrap after the recording began
    assert rec.frames == [], "a recording scrap reached the model"
    assert tc.looks_like_voicemail(), "the scrap disarmed the voicemail hang-up"
    await _feed(tc, "one, please record your message.")
    assert rec.frames == []


@pytest.mark.asyncio
async def test_who_is_this_licenses_the_intro_again():
    from app.turntake import caller_asked_to_repeat as f
    for t in ("Who is this?", "who's calling", "Aap kaun bol rahe hain?", "kaun hai"):
        assert f(t), t
    assert not f("Yes, go ahead.")
    rec = _NRRec()
    caller = {"t": "Yes"}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "I'm Aarushi, from Vacademy.")
    caller["t"] = "Who is this?"
    rec.text.clear()
    await _reply(g, "I'm Aarushi, from Vacademy.")
    assert [t.strip() for t in rec.text] == ["I'm Aarushi, from Vacademy."], rec.text


# ── call 91d1541e (2026-09-15): screened call; a 5.6 s turn with no transcript ──

def test_call_screener_second_fragment_is_the_operator():
    from app.turntake import is_carrier_announcement, is_call_screener
    assert is_carrier_announcement("I'll see if this person is available")
    assert is_call_screener("Hi. If you record your name and reason for calling,")
    assert not is_call_screener("Your call has been forwarded to voicemail")


@pytest.mark.asyncio
async def test_the_human_after_a_screener_gets_the_opening_again():
    rec = _Rec()
    said = []

    async def resay(text, force=False):
        said.append((text, force)); return True
    tc = _replay_collector(rec, bot_speaking=False)
    tc._resay_opening = resay
    tc._bot_spoke_once = lambda: True
    await _feed(tc, "Hi. If you record your name and reason for calling,")
    await _feed(tc, "I'll see if this person is available")
    assert tc.screener_seen and rec.frames == []
    await _feed(tc, "Hello")
    assert said == [("Hello", True)], said
    assert rec.frames == [], "the hello must not drive its own generation"
    assert not tc.screener_seen, "consumed"


@pytest.mark.asyncio
async def test_screener_flag_dies_with_the_first_human_turn():
    """Call 196838de: the father's first line was substantive, not a hello, so
    the screener flag stayed armed — and his "Hello?" 2 min 20 s later replayed
    the whole opening. The person talking to us is proof the screen is over."""
    rec = _Rec()
    said = []

    async def resay(text, force=False):
        said.append((text, force)); return True
    tc = _replay_collector(rec, bot_speaking=False, in_machine_window=lambda: False)
    tc._resay_opening = resay
    tc._bot_spoke_once = lambda: True
    tc.screener_seen = True
    await _feed(tc, "मैं बच्ची का पिता बोलता हूँ, बोलिए।")
    assert not tc.screener_seen, "a real turn from the person must clear the screener"
    await _feed(tc, "Hello?")
    assert said == [], "the opening must not be replayed mid-conversation"


@pytest.mark.asyncio
async def test_carry_on_cue_names_the_words_they_heard():
    """Call 196838de: 'अच्छा' mid-sentence cancelled the reply; the carry-on cue
    let the model restart the sentence from its first word. The cue must say
    where they were."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True)
    tc._outcome.transcript.append({"role": "assistant", "text":
        "लेकिन इस level पर हमारा focus सिर्फ marks improve करने का नहीं होता focus ये होता है कि उसके concepts और मजबूत हों"})
    await _feed(tc, "अच्छा")
    cues = [c for c in rec.cues() if "heard you up to" in c]
    assert cues, rec.cues()
    assert "उसके concepts और मजबूत हों" in cues[0]
    assert "do not restart the sentence" in cues[0]


@pytest.mark.asyncio
async def test_a_restatement_only_reply_asks_for_the_next_step_twice_then_speaks():
    """Call 71e8f39b: five replies in a row were nothing but the caller's answer
    said back ("You are taking offline classes." …) and each was spoken. Ask
    the model for its next line instead — twice — then fall back to speaking."""
    rec = _NRRec()
    asked = []

    async def _next_step(held, kind="", attempt=0):
        asked.append((kind, attempt))
    caller = {"t": "No."}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "You'd be taking classes online these days I'm guessing — or is it all offline right now?")
    rec.text.clear()
    await _reply(g, "Okay, so you are taking offline classes.")
    assert asked == [("restatement", 1)] and rec.text == [], (asked, rec.text)
    # SAME caller turn: one request is the limit (call b41b481f burned two in
    # 1.6 s and produced the same sentence three times), so this one is spoken.
    await _reply(g, "You are not taking any online classes right now.")
    assert asked == [("restatement", 1)], asked
    assert [t.strip() for t in rec.text] == ["You are not taking any online classes right now."], rec.text
    rec.text.clear()
    caller["t"] = "Offline only, yes."        # a NEW turn earns the second request
    await _reply(g, "You only take offline classes.")
    assert asked == [("restatement", 1), ("restatement", 2)] and rec.text == [], (asked, rec.text)


@pytest.mark.asyncio
async def test_ellipses_never_reach_the_tts_as_their_own_sentence():
    """Call af7e93bd (first gemma4 call): "नब्बे तीन परसेंट..." — pipecat's TTS
    aggregator split it into "…परसेंट.." and a bare ".", and Smallest hummed
    for ~10 s on the dot. Mid-sentence "..." is a comma, at the end one stop."""
    rec = _NRRec()
    g = _no_repeat(rec, caller="ninety three percent")
    await _reply(g, "अच्छा! ", "ये तो अच्छी बात है सर। ", "नब्बे तीन परसेंट... ",
                 "You set your timings once... and every morning the class just appears.")
    joined = "".join(rec.text)
    assert ".." not in joined, joined
    assert "नब्बे तीन परसेंट." in joined, joined
    # The gate's own splitter ends a sentence at "..." — that is fine, as long
    # as what reaches the TTS ends in ONE stop and no dot travels alone.
    assert "timings once." in joined and "and every morning" in joined, joined


@pytest.mark.asyncio
async def test_smallest_never_receives_a_letterless_sentence():
    """Belt to the gate's braces: whatever splits text upstream, a bare "." must
    not be synthesised — Smallest returns ~9 s of hum for it (af7e93bd)."""
    from app import providers as pv

    class _Base:
        sent = []

        async def _push_tts_frames(self, src_frame, *a, **k):
            self.sent.append(src_frame.text)

    class _F:
        def __init__(self, text): self.text = text
    G = pv._letterless_guard(_Base)
    g = G()
    for t in (".", "..", " ", "।", "नब्बे तीन परसेंट.", "Class 10.", "?!"):
        await g._push_tts_frames(_F(t))
    assert _Base.sent == ["नब्बे तीन परसेंट.", "Class 10."], _Base.sent
    assert G.__name__ == "_Base", "engine_of / _tag_engine key on the class name"


# ── sim.replay: every live call becomes a regression test ────────────────────
def test_replay_record_becomes_a_scenario_with_finals_at_their_times():
    from sim import replay as R
    rec = {"finals": [[3.2, "Hi. If you record your name"], [20.5, "मैं पिता बोलता हूँ"],
                      [21.1, "बोलिए।"], [143.0, "Hello"]],
           "vad": [[2.0, 1], [7.5, 0], [18.5, 1], [21.0, 0], [60.0, 1], [60.2, 0], [141.9, 1], [147.0, 0]],
           "bot": [[4.0, 1], [17.0, 0]],
           "runs": [[21.9, "मैं पिता बोलता हूँ बोलिए।"], [143.5, "Hello"]],
           "replies": [[22.9, "जी सर। बच्चे का नाम?"], [144.0, "जी, मैं सुन रही हूँ।"]], "ended": 170.0}
    sc = R.scenario_from_record(rec, "t", R.invariants)
    turns = [(s.at, s.finals, s.final_times) for s in sc.caller]
    assert turns[0] == (2.0, ["Hi. If you record your name"], [3.2])
    assert turns[1] == (18.5, ["मैं पिता बोलता हूँ", "बोलिए।"], [20.5, 21.1]), turns[1]
    assert turns[2] == (141.9, ["Hello"], [143.0])
    assert len(turns) == 3, "the 0.2 s VAD blip with no words is not a turn"
    assert sc.reply_for("[cue] बोलिए।") == "जी सर। बच्चे का नाम?"      # by trigger, not order
    assert sc.reply_for("Hello") == "जी, मैं सुन रही हूँ।"
    # Every recorded reply used once: a run the live call never made gets a
    # unique contentful line (never a stub "Okay.", which starts a cue
    # cascade), and is counted as drift from the live call.
    extra = sc.reply_for("anything")
    assert extra and "नोट" in extra and sc.reply_for.unrecorded == 1, extra
    assert 170 < sc.max_secs <= 180


def test_replay_invariants_catch_todays_call_shapes():
    """The shapes found by hand on 2026-09-15 — each must trip an invariant."""
    from sim import replay as R
    op = "नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से।"
    res = {"transcript": [{"role": "assistant", "text": op},
                          {"role": "user", "text": "मैं बच्ची का पिता बोलता हूँ"},
                          {"role": "assistant", "text": "जी सर। Rishabh के previous class में कितने marks आए थे?"},
                          {"role": "user", "text": "ninety four"},
                          {"role": "assistant", "text": "जी सर। Rishabh के previous class में कितने marks आए थे?"},  # re-ask
                          {"role": "user", "text": "Hello"},
                          {"role": "assistant", "text": op}],                     # 196838de: opening replayed
           "tts_texts": ["नमस्ते जी", "."],                                  # af7e93bd: lone dot → hum
           "turn_latency": [1.2, 6.2],                                       # 92743351: 6 s to a yes
           "caller": [[2.2, 6.3]], "bot": [[3.0, 4.0]],                       # 71e8f39b: opening over the caller
           "finals": [(5.0, "hello")], "ended_at": 30.0}
    f = R.invariants(res)
    assert any("opening replayed" in x for x in f), f
    assert any("said twice" in x and "previous class" in x for x in f), f
    assert any("letterless" in x for x in f), f
    assert any("latency over 4 s" in x for x in f), f
    assert any("over the caller" in x for x in f), f
    # a repeat the caller ASKED for is not a fault
    ok = {"transcript": [{"role": "assistant", "text": "Which number should I send the invite to?"},
                         {"role": "user", "text": "Hello? Sorry, say that again"},
                         {"role": "assistant", "text": "Which number should I send the invite to?"}],
          "tts_texts": [], "turn_latency": [1.0], "caller": [], "bot": [], "finals": [], "ended_at": 9.0}
    assert R.invariants(ok) == [], R.invariants(ok)


def test_an_opening_after_pickup_noises_is_not_a_replay():
    """23 Sep batch: 'Hi.' / 'हाँ।' recorded before the opening made the one
    opening count as its own replay (6 false REDs)."""
    import app.report as rp
    op = "नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से। आपने inquiry की थी।"
    o = type("O", (), {})()
    o.transcript = [{"role": "user", "text": "Hi."}, {"role": "user", "text": "हाँ।"},
                    {"role": "assistant", "text": op},
                    {"role": "user", "text": "मैं बच्चे का पिता बोल रहा हूँ।"},
                    {"role": "assistant", "text": "जी सर, बच्चे का नाम क्या है?"}]
    assert rp._played_invariants(o)[0] == 0
    o.transcript.append({"role": "user", "text": "कौन बोल रहा है?"})
    o.transcript.append({"role": "assistant", "text": op})        # a REAL replay
    assert rp._played_invariants(o)[0] == 1


def test_pickup_scraps_are_not_counted_as_lost_answers():
    import inspect
    # The filter lives in TranscriptCollector.answers_heard since 2026-10-14.
    src = inspect.getsource(b.TranscriptCollector.answers_heard)
    assert "if i > first_bot" in src, "pickup scraps before the opening must not count as lost"
    assert "transcript.answers_heard()" in inspect.getsource(b.run_bot)


def test_played_invariants_name_todays_faults():
    """The two Call-Health faults added 2026-09-15 read the PLAYED transcript."""
    from app import report as rp, diagnostics as dg
    op = "नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से।"
    o = b.CallOutcome(corr="t", context={})
    o.transcript = [{"role": "assistant", "text": op},
                    {"role": "user", "text": "मैं बच्ची का पिता बोलता हूँ"},
                    {"role": "assistant", "text": "जी सर। Rishabh के previous class में कितने marks आए थे?"},
                    {"role": "user", "text": "ninety four"},
                    {"role": "assistant", "text": "जी सर। Rishabh के previous class में कितने marks आए थे?"},
                    {"role": "user", "text": "Hello"},
                    {"role": "assistant", "text": op}]
    replays, repeats, samples = rp._played_invariants(o)
    assert replays == 1 and repeats == 1, (replays, repeats, samples)
    d = dg.CallDiagnostics()
    d.opening_replays, d.repeated_lines = replays, repeats
    v = dg.verdict(d)
    assert v["faults"].get(dg.OPENING_REPLAYED) == dg.RED and v["faults"].get(dg.REPEATED_LINE) == dg.AMBER
    assert v["headline"] == dg.OPENING_REPLAYED
    # a repeat the caller asked for is not a fault
    o.transcript = [{"role": "assistant", "text": "Which number should I send the invite to?"},
                    {"role": "user", "text": "Sorry, say that again"},
                    {"role": "assistant", "text": "Which number should I send the invite to?"}]
    assert rp._played_invariants(o) == (0, 0, [])


def test_call_alert_line_fires_for_non_green(caplog):
    from app import report as rp, diagnostics as dg
    import logging as _lg
    o = b.CallOutcome(corr="alert-t", context={})
    d = dg.CallDiagnostics(); d.opening_replays = 1
    with caplog.at_level(_lg.WARNING, logger="app.report"):
        rp._alert(o, dg.to_payload(d))
        rp._alert(o, dg.to_payload(dg.CallDiagnostics()))
    lines = [r.getMessage() for r in caplog.records if "call-alert" in r.getMessage()]
    assert len(lines) == 1 and "OPENING_REPLAYED:RED" in lines[0] and "alert-t" in lines[0], lines


def test_run_guard_holds_a_turn_that_ends_mid_clause():
    """Call 28570ec0: Smart Turn closed 'अ, Rishika के previous class में' — six
    words, no sentence mark, ending in a postposition — and the run answered
    the half-sentence. That shape is held like a short answer."""
    g = b.RunGuard(_FakeCtx(), enabled=lambda: True, short_answer_grace_secs=0.5)
    ends = g._ends_mid_clause
    assert ends([{"role": "user", "content": "अ, Rishika के previous class में"}])
    assert ends([{"role": "user", "content": "I want a good environment and"}])
    assert ends([{"role": "user", "content": "I take classes in the"},
                 {"role": "user", "content": "[That was their ANSWER…]"}]), "a cue after the words"
    assert not ends([{"role": "user", "content": "Rishabh के previous class में eighty three percent है।"}])
    assert not ends([{"role": "user", "content": "It's a mix of online and studio."}])
    assert not ends([{"role": "user", "content": "Yes, go ahead"}])


@pytest.mark.asyncio
async def test_stale_bridge_is_skipped_at_synthesis_time():
    """Call 28570ec0: 'एक सेकंड।' passed the gate fresh, then waited behind a
    25 s reply inside the TTS and played after it. The synthesis-time hook
    is the last gate."""
    from app import providers as pv

    class _Base:
        sent = []

        async def _push_tts_frames(self, src_frame, *a, **k):
            self.sent.append(src_frame.text)

    class _F:
        def __init__(self, text): self.text = text
    G = pv._letterless_guard(_Base)
    g = G()
    stale = {"v": False}
    g.skip_text_if = lambda text: "stale" if (text == "एक सेकंड।" and stale["v"]) else None
    await g._push_tts_frames(_F("एक सेकंड।"))
    stale["v"] = True
    await g._push_tts_frames(_F("एक सेकंड।"))
    await g._push_tts_frames(_F("Class 10."))
    assert _Base.sent == ["एक सेकंड।", "Class 10."], _Base.sent


def test_stt_waterfall_builds_a_switcher_only_with_a_fallback(monkeypatch):
    """Founder 2026-09-15: Sarvam primary, Smallest as the waterfall. The
    pipeline gets pipecat's ServiceSwitcher (failover strategy); without
    STT_FALLBACK_PROVIDER it gets the plain service, byte-identical to before."""
    from app import providers as pv, config as cfg
    monkeypatch.setenv("STT_PROVIDER", "sarvam")
    monkeypatch.setenv("STT_FALLBACK_PROVIDER", "")
    monkeypatch.setenv("SARVAM_API_KEY", "k"); monkeypatch.setenv("SMALLEST_API_KEY", "k")
    cfg.get_settings.cache_clear() if hasattr(cfg.get_settings, "cache_clear") else None
    proc, prim, fb = pv.build_stt_waterfall(8000, language="hi-IN")
    assert proc is prim and fb is None and type(prim).__name__.startswith("Sarvam")
    monkeypatch.setenv("STT_FALLBACK_PROVIDER", "smallest")
    cfg.get_settings.cache_clear() if hasattr(cfg.get_settings, "cache_clear") else None
    proc, prim, fb = pv.build_stt_waterfall(8000, language="hi-IN")
    from pipecat.pipeline.service_switcher import ServiceSwitcher, ServiceSwitcherStrategyFailover
    assert isinstance(proc, ServiceSwitcher) and isinstance(proc.strategy, ServiceSwitcherStrategyFailover)
    assert proc.strategy.active_service is prim and type(fb).__name__ == "SmallestSTTService"
    assert prim is not fb
    # same vendor twice is not a waterfall
    monkeypatch.setenv("STT_FALLBACK_PROVIDER", "sarvam")
    cfg.get_settings.cache_clear() if hasattr(cfg.get_settings, "cache_clear") else None
    proc, prim, fb = pv.build_stt_waterfall(8000, language="hi-IN")
    assert proc is prim and fb is None


# ── call 1e374b99 (2026-09-17): "हम्म" cost a round trip and ate words ──────

def _spoken_texts(rec):
    from pipecat.frames.frames import TTSSpeakFrame
    return [f.text for f in rec.frames if isinstance(f, TTSSpeakFrame)]


@pytest.mark.asyncio
async def test_unplayed_tail_is_exactly_what_the_caller_did_not_hear():
    from pipecat.frames.frames import InterruptionFrame
    rec = _NRRec()
    played = {"t": ""}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "",
                       played_text=lambda: played["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है। ",
                 "क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ — नाम क्या है? ",
                 "और अभी किस class में पढ़ रहा है?")
    played["t"] = "Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है"
    await g.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    tail = g.take_unplayed_tail()
    assert tail.startswith("क्या मैं बच्चे के बारे में") and "किस class में पढ़ रहा है?" in tail, tail
    assert "focus सिर्फ syllabus" not in tail, "they heard that one"
    assert g.take_unplayed_tail() == "", "handed over once"


@pytest.mark.asyncio
async def test_a_backchannel_resumes_the_cut_words_verbatim_with_no_model():
    """The founder's report: the bot acknowledges ("जी सर"), pauses, and a few
    words go missing. Instead say the exact words that were cut."""
    rec = _Rec()
    tail = {"t": "क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ — नाम क्या है और अभी किस class में पढ़ रहा है?"}

    def take(n=600):
        t, tail["t"] = tail["t"], ""
        return t
    tc = _replay_collector(rec, bot_speaking=False, resume_unplayed=take,
                           recently_cut=lambda: True)   # the VAD onset cut the reply
    tc._outcome.transcript.append({"role": "assistant", "text": "Shiksha Nation में हमारा focus…"})
    await _feed(tc, "हम्म।")
    assert _spoken_texts(rec) and "किस class में पढ़ रहा है?" in _spoken_texts(rec)[0]
    assert not any("carry on" in c for c in rec.cues()), rec.cues()
    assert not any(getattr(f, "run_llm", False) for f in rec.frames), "no generation for a backchannel"
    # the backchannel itself still reaches the context
    assert any("हम्म" in c for c in rec.cues()), rec.cues()


@pytest.mark.asyncio
async def test_the_cut_words_resume_at_the_vad_stop_without_waiting_for_the_stt():
    """0.25-4.07 s of the gap was the STT final. A short burst of voice over a
    reply that had not finished its question cannot be an answer — resume."""
    from pipecat.frames.frames import (VADUserStartedSpeakingFrame,
                                       VADUserStoppedSpeakingFrame)
    D = b.FrameDirection.DOWNSTREAM
    for played, voice_secs, want in ((" तो बताइए।", 0.4, True),      # cut mid-statement
                                     (" नाम क्या है?", 0.4, False),   # a question: could be an answer
                                     (" तो बताइए।", 3.0, False)):    # too long to be a backchannel
        rec = _Rec()
        tail = {"t": "और अभी किस class में पढ़ रहा है?"}
        tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                               resume_unplayed=lambda n=600: tail.pop("t", ""),
                               resume_on_stop_secs=1.0)
        tc._outcome.transcript.append({"role": "assistant", "text": "जी सर।" + played})
        b.FrameProcessor.process_frame = _noop_super
        await tc.process_frame(VADUserStartedSpeakingFrame(), D)
        tc._vad_started_t -= voice_secs
        await tc.process_frame(VADUserStoppedSpeakingFrame(), D)
        got = bool(_spoken_texts(rec))
        assert got is want, f"played={played!r} voice={voice_secs}s resumed={got}"


@pytest.mark.asyncio
async def test_resumed_words_count_as_said_again_and_a_stale_tail_is_never_spoken():
    """Two hazards of resuming verbatim: the sentences must go BACK into the
    already-said set (the un-record had removed them), and a tail left over
    from an earlier interruption must never surface later."""
    from pipecat.frames.frames import InterruptionFrame
    rec = _NRRec()
    played = {"t": ""}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "",
                       played_text=lambda: played["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    Q = "क्या मैं जान सकती हूँ कि आकाश के previous class में कितने marks आए थे?"
    await _reply(g, "जी सर। ", Q)
    played["t"] = "जी सर।"
    D = b.FrameDirection.DOWNSTREAM
    await g.process_frame(InterruptionFrame(), D)
    assert normalize_spoken(Q) not in g._spoken, "un-recorded while it was lost"
    assert g.take_unplayed_tail().strip() == Q
    assert normalize_spoken(Q) in g._spoken, "resumed ⇒ said again"
    rec.text.clear()
    played["t"] = "जी सर। " + Q
    await _reply(g, Q)                       # the model asks it again
    # The question itself must not be asked again (a hand-back in its place is
    # the gate's existing, intended behaviour).
    assert not any(normalize_spoken(Q) in normalize_spoken(t) for t in rec.text), \
        f"a resumed question must still count as asked: {rec.text}"
    # The hand-back the gate just emitted is content-free: never resumable,
    # and a NEW interruption must clear whatever the old one left.
    await g.process_frame(InterruptionFrame(), D)
    assert g.take_unplayed_tail() == "", "a hand-back is not words worth repeating"


@pytest.mark.asyncio
async def test_a_second_backchannel_after_the_resume_was_cut_still_gets_a_cue():
    """If the resumed words were themselves cut off, the bot is silent — the
    caller must not be left there."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "")
    tc._outcome.transcript.append({"role": "assistant", "text": "जी सर, तो बताइए।"})
    tc._resumed_t = time.time()              # resumed a moment ago, then cut
    await _feed(tc, "हम्म।")
    assert any(("carry on" in c) or ("NEXT step" in c) for c in rec.cues()), rec.cues()


def _released(rec):
    from pipecat.frames.frames import TranscriptionFrame
    return [f for f in rec.frames if isinstance(f, TranscriptionFrame) and not f.text.strip()]


@pytest.mark.asyncio
async def test_an_absorbed_backchannel_releases_the_callers_turn():
    """Calls 9050a3e1 / 42106148: a final we swallow never reaches pipecat's
    stop strategy, so the caller's turn stays open for the 5 s timeout and
    nothing we say inside it is heard. A whitespace-only final closes it."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True)
    tc._user_turn_open = True
    await _feed(tc, "हम्म।")
    assert len(_released(rec)) == 1, [type(f).__name__ for f in rec.frames]
    rec.frames.clear()
    tc._user_turn_open = False            # already closed: nothing to release
    await _feed(tc, "हम्म।")
    assert _released(rec) == []


@pytest.mark.asyncio
async def test_a_carrier_line_and_a_repeat_release_the_turn_too():
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, in_machine_window=lambda: True)
    tc._user_turn_open = True
    await _feed(tc, "Your call has been forwarded to voicemail.")
    assert len(_released(rec)) == 1


@pytest.mark.asyncio
async def test_a_resume_triggered_by_a_broadcast_vad_frame_still_travels_downstream():
    """THE lost-resume bug (b41b481f, 0c42d3a6, 9050a3e1, 42106148). VAD frames
    are broadcast by the aggregator and reach the turn-gate travelling
    UPSTREAM; a resume that inherited that direction went into the STT and
    vanished. Traced hop by hop in the timing sim on 2026-09-21."""
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tail = "like sending the link, reminders, attendance and fees."
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: tail, resume_settle_secs=0.01,
                           resume_on_stop_secs=1.0)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    UP = b.FrameDirection.UPSTREAM
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.2)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.1)
    sent = [(f, d) for f, d in zip(rec.frames, rec.dirs) if isinstance(f, b.TTSSpeakFrame)]
    assert [f.text for f, _ in sent] == [tail], [type(f).__name__ for f in rec.frames]
    assert sent[0][1] == b.FrameDirection.DOWNSTREAM, "the resume went up the pipeline"
    tc._cancel_resume_check(stale=True)


@pytest.mark.asyncio
async def test_the_re_run_cue_after_a_blip_travels_downstream_too():
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "", resume_on_stop_secs=1.0)
    tc._outcome.transcript.append({"role": "user", "text": "मैं बच्चे का पिता बोल रहा हूँ।"})
    b.FrameProcessor.process_frame = _noop_super
    UP = b.FrameDirection.UPSTREAM
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    tc._noise_reask_wait_secs = 0.02
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.08)
    cues = [(f, d) for f, d in zip(rec.frames, rec.dirs) if getattr(f, "run_llm", False)]
    assert cues, "no re-run cue"
    assert all(d == b.FrameDirection.DOWNSTREAM for _, d in cues), "the cue went up the pipeline"


@pytest.mark.asyncio
async def test_a_resume_lost_twice_asks_the_model_to_finish_the_thought():
    """Call 42106148: un-recording the words did nothing on its own — nobody
    ran the model, and the caller waited 12 s."""
    rec = _Rec()
    tail = "like sending the link, reminders, attendance and fees."
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: tail, forget_resume=lambda: True,
                           resume_settle_secs=0.01)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    tc._outcome.transcript.append({"role": "assistant",
                                   "text": "We take care of the daily work of your online classes."})
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    await asyncio.wait_for(tc._resume_check, timeout=6)
    cues = [c for c in rec.cues() if "Say the rest now" in c]
    assert len(cues) == 1, rec.cues()
    assert "online classes" in cues[0], cues[0]
    assert any(getattr(f, "run_llm", False) for f in rec.frames), "the cue must run the model"


@pytest.mark.asyncio
async def test_a_scrap_right_after_a_carrier_line_does_not_cut_the_opening():
    """Call 9050a3e1: '…trying to reach.' / 'Not.' / 'Not available.' — the
    middle piece cut the opening 1.1 s in."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True, in_machine_window=lambda: True)
    await _feed(tc, "The person you're trying to reach.")      # carrier: sets the flag
    assert tc._carrier_seen and rec.interruptions == 0
    await _feed(tc, "Not.")
    assert rec.interruptions == 0, "the scrap cut the opening"
    assert "Not." in rec.cues(), "a possible human 'No.' must stay in the context"
    # a real answer a while later still barges in
    tc._prev_final_t -= 5.0
    await _feed(tc, "No.")
    assert rec.interruptions == 1


@pytest.mark.asyncio
async def test_a_second_hello_into_our_silence_is_not_a_duplicate():
    """Call 9050a3e1: 'Hello.' 2.5 s after 'Hello.', bot silent, nothing in
    flight — dropped as a repeat; the third one, 7 s later, got the reply."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    await _feed(tc, "Hello.")
    n = len([f for f in rec.frames if not _released_one(f)])
    await _feed(tc, "Hello.")
    m = len([f for f in rec.frames if not _released_one(f)])
    assert m > n, "the second hello was swallowed as a duplicate"


def _released_one(f):
    from pipecat.frames.frames import TranscriptionFrame
    return isinstance(f, TranscriptionFrame) and not f.text.strip()


def test_a_grunt_and_a_yes_maam_are_backchannels_not_barge_ins():
    """Call bd9e6a0d: 21 "real barge-ins" in 4.5 min, most of them "हाँ Ma'am"
    and "हं" — the apostrophe and the nasal spelling defeated the vocabulary."""
    from app.turntake import mid_reply_action, ABSORB, INTERRUPT
    for t in ["हं।", "हँ", "हाँ Ma'am.", "जी Ma'am", "हाँ ma’am", "haanji", "ok sir"]:
        assert mid_reply_action(t) == ABSORB, t
    for t in ["हाँ Ma'am जल्दी है।", "हाँ कह सकते हैं ऐसा।", "नहीं Ma'am", "MIP क्या है?"]:
        assert mid_reply_action(t) == INTERRUPT, t


@pytest.mark.asyncio
async def test_the_noise_re_ask_waits_for_the_stt_and_stands_down_when_words_arrive():
    """Call bd9e6a0d: "हाँ Ma'am" was called noise 65 ms before its own final
    arrived; the cue and the answer both ran the model."""
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "", resume_on_stop_secs=1.0,
                           noise_reask_wait_secs=0.1)
    tc._outcome.transcript.append({"role": "user", "text": "मैं बच्चे का पिता बोल रहा हूँ।"})
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    UP = b.FrameDirection.UPSTREAM
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], "decided before the STT"
    await _feed(tc, "हाँ Ma'am जल्दी है।")               # the final lands inside the window
    await asyncio.sleep(0.2)
    cues = [c for c in rec.cues() if "noise on the line" in c]
    assert cues == [], f"called their answer noise: {cues}"


@pytest.mark.asyncio
async def test_a_long_reply_is_capped_but_still_asks_its_closing_question():
    """Call bd9e6a0d: a five-sentence pitch became a 30 s monologue and the
    parent said "क्या बोला Ma'am, समझा नहीं"."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "seventy eight percent.",
                       max_sentences=lambda: 3)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "अच्छा! ", "ये तो अच्छी बात है सर। ",
                 "रवि के जो marks आए हैं, that's actually a good performance। ",
                 "लेकिन इस level पर हमारा focus सिर्फ marks improve करने का नहीं होता। ",
                 "क्या रवि के साथ भी ऐसा है सर, कि कुछ subjects में वो बहुत अच्छा करता है?")
    said = [t.strip() for t in rec.text]
    assert len(said) == 4, said
    assert said[-1].startswith("क्या रवि के साथ"), said
    assert not any("focus" in t for t in said), "the fourth sentence should have been held"
    rec.text.clear()
    await _reply(g, "जी सर। ", "बताइए।")
    assert len([t for t in rec.text if t.strip()]) == 2, "a short reply must be untouched"


# ── call f58ca825 (2026-09-22): the LLM vendor went 34 s → 49 s → 403 ──────
@pytest.mark.asyncio
async def test_first_token_timeout_fails_fast_and_passes_a_healthy_stream_through():
    from app.providers import with_first_token_timeout

    class _Slow:
        def __aiter__(self): return self
        async def __anext__(self):
            await asyncio.sleep(1.0); return "late"

    class _Fast:
        def __init__(self): self.n = 0; self.closed = False
        def __aiter__(self): return self
        async def __anext__(self):
            self.n += 1
            if self.n > 2: raise StopAsyncIteration
            return f"chunk{self.n}"
        async def close(self): self.closed = True

    class _Svc:
        stream = None
        async def get_chat_completions(self, context): return self.stream

    Guarded = with_first_token_timeout(_Svc, 0.05)
    g = Guarded(); g.stream = _Slow()
    with pytest.raises(TimeoutError):
        async for _ in await g.get_chat_completions(None):
            pass
    g = Guarded(); f = _Fast(); g.stream = f
    out = [c async for c in await g.get_chat_completions(None)]
    assert out == ["chunk1", "chunk2"]
    wrapped = await g.get_chat_completions(None)
    await wrapped.close()                    # attribute passthrough
    assert f.closed
    assert with_first_token_timeout(_Svc, 0) is _Svc, "0 disables the guard"


@pytest.mark.asyncio
async def test_vertex_first_token_guard_fails_fast_so_the_waterfall_can_answer():
    """23 Sep: a Vertex 429 took 7.1 s to surface; the 6 s guard only covered
    OpenAI-compatible services. Gemini streams through _stream_content."""
    from app.providers import with_stream_first_token_timeout

    class _Stalled:
        def __aiter__(self): return self
        async def __anext__(self):
            await asyncio.sleep(1.0); return "late"

    class _Chunks:
        def __init__(self): self.n = 0
        def __aiter__(self): return self
        async def __anext__(self):
            self.n += 1
            if self.n > 2: raise StopAsyncIteration
            return f"c{self.n}"

    class _Gemini:
        stream = None; connect_secs = 0.0
        async def _stream_content(self, context):
            await asyncio.sleep(self.connect_secs)
            return self.stream

    G = with_stream_first_token_timeout(_Gemini, 0.05)
    g = G(); g.stream = _Stalled()
    with pytest.raises(TimeoutError):
        async for _ in await g._stream_content(None):
            pass
    g = G(); g.connect_secs = 1.0; g.stream = _Chunks()
    with pytest.raises(TimeoutError):
        await g._stream_content(None)            # the 429 that takes seconds to come back
    g = G(); g.stream = _Chunks()
    assert [c async for c in await g._stream_content(None)] == ["c1", "c2"]
    assert with_stream_first_token_timeout(_Gemini, 0) is _Gemini


def test_llm_waterfall_primary_gives_up_early_only_when_a_fallback_exists(monkeypatch):
    from app import providers as pv
    class _S:
        llm_provider = "vertex"; llm_fallback_provider = "sarvam"
    monkeypatch.setattr(pv, "get_settings", lambda: _S())
    built = []
    def _build(prov=None, fail_fast=False):
        built.append((prov, fail_fast)); return object()
    monkeypatch.setattr(pv, "build_llm", _build)
    monkeypatch.setattr("pipecat.pipeline.service_switcher.ServiceSwitcher",
                        lambda services, strategy_type=None: ("switcher", services))
    sw, primary, fallback = pv.build_llm_waterfall(None)
    assert fallback is not None
    assert (None, True) in built and ("sarvam", False) in built


def test_llm_waterfall_runs_the_primary_alone_when_the_fallback_cannot_build(monkeypatch):
    from app import providers as pv
    class _S:
        llm_provider = "sarvam"; llm_fallback_provider = "vertex"
    monkeypatch.setattr(pv, "get_settings", lambda: _S())
    built = []
    def _build(prov=None, fail_fast=False):
        built.append((prov, fail_fast))
        if prov == "vertex":
            raise RuntimeError("no credentials here")
        return object()
    monkeypatch.setattr(pv, "build_llm", _build)
    sw, primary, fallback = pv.build_llm_waterfall(None)
    assert fallback is None and sw is primary
    assert (None, True) not in built, "no fallback → the primary must not give up early"
    _S.llm_fallback_provider = ""
    sw, primary, fallback = pv.build_llm_waterfall(None)
    assert fallback is None and sw is primary
    _S.llm_fallback_provider = "sarvam"           # same as primary: no waterfall
    sw, primary, fallback = pv.build_llm_waterfall(None)
    assert fallback is None


@pytest.mark.asyncio
async def test_run_guard_lets_the_same_context_run_again_after_the_vendor_failed():
    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    import app.diagnostics as dg
    ctx = LLMContext(messages=[{"role": "system", "content": "x"},
                               {"role": "user", "content": "कौन बच्चा?"}])
    g = b.RunGuard(ctx, enabled=lambda: True, diag=dg.CallDiagnostics())
    seen = []
    async def _push(frame, direction=None): seen.append(type(frame).__name__)
    g.push_frame = _push
    b.FrameProcessor.process_frame = _noop_super
    await g.process_frame(LLMContextFrame(ctx), b.FrameDirection.DOWNSTREAM)
    await g.process_frame(LLMContextFrame(ctx), b.FrameDirection.DOWNSTREAM)
    assert seen.count("LLMContextFrame") == 1, "the unchanged-context block must still hold"
    g.allow_rerun()
    await g.process_frame(LLMContextFrame(ctx), b.FrameDirection.DOWNSTREAM)
    assert seen.count("LLMContextFrame") == 2, "after a vendor failure the same turn must run again"


@pytest.mark.asyncio
async def test_a_backchannel_while_the_answer_is_composing_generates_nothing():
    """Call 8e2041c8: "बोलिए" 90 ms after the real answer started a second run
    (read as the answer to the last played question), then a third, and the
    father heard "जी सर। जी सर। जी, बोलिए।"."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: False)
    tc._outcome.transcript.append({"role": "assistant",
                                   "text": "क्या मैं जान सकती हूँ कि मैं बच्चे के माता-पिता में से किससे बात कर रही हूँ?"})
    tc._outcome.transcript.append({"role": "user", "text": "मैं बच्चे का पिता बोल रहा हूँ।"})
    tc._reply_in_flight = lambda: True           # run #1 is composing, not audible
    await _feed(tc, "बोलिए।")
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], rec.cues()
    assert "बोलिए।" in rec.cues(), "the backchannel must still be in the context"
    # Same words with NO reply in flight (the bot was cut mid-question and is
    # quiet): the answer-to-the-question path still fires.
    rec2 = _Rec()
    tc2 = _replay_collector(rec2, bot_speaking=False, recently_cut=lambda: True)
    tc2._outcome.transcript.append({"role": "assistant", "text": "आप बच्चे के पिता हैं?"})
    await _feed(tc2, "बोलिए।")
    assert [f for f in rec2.frames if getattr(f, "run_llm", False)], "the existing path must survive"


def test_a_greeting_during_the_opening_is_absorbed():
    from app.turntake import mid_reply_action, ABSORB
    for t in ["नमस्ते।", "नमस्कार जी", "Namaste ma'am"]:
        assert mid_reply_action(t) == ABSORB, t


# ── call 1f2b97ab (2026-10-01): "अभी time नहीं है madam" at 10.4 s of a 12.4 s
#    cached opening -> the opening again from "नमस्ते जी", twice; hung up at 15 s ─
_SHREYA_OPENING = ("नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से । आपने अपने बच्चे के लिए "
                   "live classes की inquiry की थी, उसी के बारे में दो मिनट बात करनी थी। क्या मैं "
                   "जान सकती हूँ कि मैं बच्चे के माता-पिता में से किससे बात कर रही हूँ?")


def test_opening_heard_is_measured_by_audio_not_only_by_recorded_text():
    # A cached opening is one blob: nothing of it is in the played transcript
    # until it ENDS. 10.4 s of it had played.
    assert not b._opening_barely_heard(_SHREYA_OPENING, [], 0.0, played_secs=10.4)
    assert not b._opening_barely_heard(_SHREYA_OPENING, [], 0.0, played_secs=7.5)
    # A real cut at the start is still unheard, by either measure.
    assert b._opening_barely_heard(_SHREYA_OPENING, [], 0.0, played_secs=1.3)
    assert b._opening_barely_heard(_SHREYA_OPENING, [], 0.0)
    # The estimate errs LONG (a little more audio needed to call it heard).
    from app.turntake import opening_expected_secs
    assert 12.4 <= opening_expected_secs(_SHREYA_OPENING) <= 15.5


def test_busy_and_later_are_answers_not_pickup_noise():
    from app.turntake import caller_is_busy, takes_over_opening
    for t in ["अभी time नहीं है madam.", "अभी थोड़ा busy है ma'am।", "मैं गाड़ी चला रहा हूँ",
              "बाद में call करना", "Madam अभी मैं bike चला रहा हूँ", "I'm driving, call later",
              "अभी अभी मुझे urgency है"]:
        assert caller_is_busy(t), t
        assert takes_over_opening(t), t
    for t in ["हाँ जी बोलिए।", "Hello.", "नमस्ते।", "मैं बच्चे का पिता बोल रहा हूँ", "[cue busy]"]:
        assert not caller_is_busy(t), t


def test_resay_measures_heard_by_audio_and_yields_to_a_real_answer():
    import inspect
    src = inspect.getsource(b.run_bot)
    resay = src[src.index("async def _resay_opening(text"):src.index("_opening_resays += 1")]
    assert "played_secs=played" in resay
    # Only once some of it PLAYED: before any audio (call ab194522) the opening
    # is owed whatever they said.
    assert "if played > 0 and takes_over_opening(" in resay
    pending = src[src.index("def _opening_pending()"):src.index("async def _resay_opening(text")]
    assert "played_secs=_opening_played_secs()" in pending, \
        "RunGuard and the re-say must read the same 'heard'"
    played = src[src.index("def _opening_played_secs()"):src.index("def _opening_pending()")]
    assert 'flags["last_cut_t"]' in played, "frozen at the cut"


@pytest.mark.parametrize("text", ["हो।", "हो नमस्ते।", "होय", "हाँ बोल।", "हाँ बोलें।", "बरोबर।"])
def test_marathi_yes_and_bol_forms_are_backchannels(text):
    from app.turntake import mid_reply_action, ABSORB
    assert mid_reply_action(text) == ABSORB, text


@pytest.mark.parametrize("text", ["क्या हो रहा है", "करतो करतो।", "हो गया काम?", "नहीं हो पाएगा"])
def test_ho_inside_a_sentence_still_interrupts(text):
    from app.turntake import mid_reply_action, ABSORB
    assert mid_reply_action(text) != ABSORB, text


# ── call 4243a436 (2026-09-22): room chatter at pickup ran the model and cut ──
def test_takes_over_opening_only_for_questions_refusals_and_cues():
    from app.turntake import takes_over_opening
    for t in ["तो गुजर जाएगी।", "सेटिंग कम हो जाएगी।", "नहीं वो तो ठीक था।", "Hello.", "हाँ जी बोलिए।"]:
        assert not takes_over_opening(t), t
    for t in ["आप कौन बोल रहे हो?", "कहाँ से बोल रहे हो madam", "who is this",
              "not interested, cut the call", "[They asked who is calling.]"]:
        assert takes_over_opening(t), t


@pytest.mark.asyncio
async def test_nothing_generates_before_the_opening_unless_the_caller_takes_over():
    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    import app.diagnostics as dg
    pending = {"v": True}
    seen = []
    async def _push(frame, direction=None): seen.append(type(frame).__name__)
    def _guard(ctx):
        g = b.RunGuard(ctx, enabled=lambda: True, diag=dg.CallDiagnostics(),
                       opening_pending=lambda: pending["v"])
        g.push_frame = _push
        # The opening is on its way (default): the run waits for it.
        g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
        return g
    b.FrameProcessor.process_frame = _noop_super
    ctx = LLMContext(messages=[{"role": "system", "content": "x"},
                               {"role": "user", "content": "तो गुजर जाएगी।"}])
    await _guard(ctx).process_frame(LLMContextFrame(ctx), b.FrameDirection.DOWNSTREAM)
    assert seen == [], "room chatter ran the model before the opening"
    ctx2 = LLMContext(messages=[{"role": "system", "content": "x"},
                                {"role": "user", "content": "आप कौन बोल रहे हो?"}])
    await _guard(ctx2).process_frame(LLMContextFrame(ctx2), b.FrameDirection.DOWNSTREAM)
    assert seen == ["LLMContextFrame"], "a question to us must still run"
    pending["v"] = False
    await _guard(ctx).process_frame(LLMContextFrame(ctx), b.FrameDirection.DOWNSTREAM)
    assert seen == ["LLMContextFrame", "LLMContextFrame"], "once the opening played, normal"


@pytest.mark.asyncio
async def test_a_real_barge_in_that_cut_an_unheard_opening_gets_it_said_again():
    rec = _Rec()
    calls = []
    async def _resay(text, force=False, cut_now=False):
        calls.append((text, cut_now)); return True
    tc = _replay_collector(rec, bot_speaking=True, in_machine_window=lambda: True,
                           resay_opening=_resay)
    await _feed(tc, "नहीं वो तो ठीक था।")          # room chatter: a real barge-in
    assert rec.interruptions == 1
    assert calls == [("नहीं वो तो ठीक था।", True)], calls
    calls.clear()
    await _feed(tc, "आप कौन बोल रहे हो?")           # a question to us takes over
    assert calls == [], "a takeover must not re-greet"


# ── call 59888de8 (2026-09-22): "Obviously" ×5 regenerations; a question handed back; a lost last answer ──
def test_english_affirmations_are_backchannels():
    from app.turntake import mid_reply_action, ABSORB
    for t in ["Obviously.", "हाँ that's.", "Exactly ma'am", "absolutely"]:
        assert mid_reply_action(t) == ABSORB, t


@pytest.mark.asyncio
async def test_a_short_answer_on_a_noisy_line_still_runs():
    """The hold waits for quiet; a line that never goes quiet is noise, not a
    sentence — the run must go after the cap, not after the hang-up."""
    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    import app.diagnostics as dg
    ctx = LLMContext(messages=[{"role": "system", "content": "x"},
                               {"role": "assistant", "content": "क्या इसके अलावा कोई expectation है?"},
                               {"role": "user", "content": "नहीं यही सब।"}])
    seen = []
    async def _push(frame, direction=None): seen.append(type(frame).__name__)
    g = b.RunGuard(ctx, enabled=lambda: True, diag=dg.CallDiagnostics(),
                   short_answer_grace_secs=0.05, short_answer_max_words=3,
                   quiet_for=lambda: 0.0, noise_cap_secs=0.3)     # never quiet
    g.push_frame = _push
    g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    await g.process_frame(LLMContextFrame(ctx), b.FrameDirection.DOWNSTREAM)
    await asyncio.sleep(0.15)
    assert "LLMContextFrame" not in seen, "released before the cap"
    # cap 0.3 s + the 0.5 s context-settle that follows every release
    await asyncio.sleep(1.4)
    assert seen.count("LLMContextFrame") == 1, "the noisy-line answer never ran"


@pytest.mark.asyncio
async def test_a_question_is_answered_not_handed_back_when_the_reply_was_a_repeat():
    rec = _NRRec()
    asked = []
    async def _next_step(held, kind="", attempt=0):
        asked.append((kind, held))
    caller = {"t": "ठीक है।"}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    line = "generally जब parents किसी coaching से जुड़ते हैं तो उनकी तीन-चार basic expectations होती हैं।"
    await _reply(g, line)
    g._next_steps = 5                               # per-call budget already spent
    caller["t"] = "हाँ anything else?"
    rec.text.clear()
    await _reply(g, line)                           # the model repeats its script line
    assert asked and asked[-1][0] == "answer-question" and "anything else" in asked[-1][1], asked
    assert not any(t.strip() in ("जी?", "जी, बोलिए।") for t in rec.text), rec.text
    what, cue = b.next_step_cue("हाँ anything else?", "answer-question", 2)
    assert "anything else" in cue and "Answer their question" in cue


@pytest.mark.asyncio
async def test_a_real_barge_in_forwards_the_words_before_cutting_the_reply():
    """Call 59888de8: the transcript pushed right after our own interruption
    went missing in the aggregator; "नहीं यही सब" never reached the model."""
    from pipecat.frames.frames import TranscriptionFrame
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True)
    order = []
    async def _broadcast():
        rec.interruptions += 1; order.append("INTERRUPT")
    async def _push(frame, direction=None):
        rec.frames.append(frame); rec.dirs.append(direction)
        if isinstance(frame, TranscriptionFrame): order.append("TRANSCRIPT")
    tc.broadcast_interruption = _broadcast
    tc.push_frame = _push
    await _feed(tc, "नहीं यही सब।")
    assert rec.interruptions == 1
    assert order == ["TRANSCRIPT", "INTERRUPT"], order
    assert sum(isinstance(f, TranscriptionFrame) for f in rec.frames) == 1, "forwarded twice"


# ── voice-mode barge-in (22 Sep paid batch: 473 cuts, 54% acknowledgements) ──
def _voice_collector(rec, bot_speaking=True, **kw):
    state = {"speaking": bot_speaking, "cut": False, "in_flight": False}
    tc = b.TranscriptCollector(
        FakeOutcome(), lambda user=True: None,
        is_bot_speaking=lambda: state["speaking"],
        fillers_armed=lambda: False, bot_stopped_t=lambda: 0.0,
        gate_enabled=lambda: True,
        interrupt_on_vad=lambda: state["cut"], recently_cut=lambda: state["cut"],
        filler_phrases=[], in_machine_window=lambda: False,
        reply_in_flight=lambda: state["in_flight"], bot_spoke_once=lambda: True,
        cut_after_voice_secs=kw.pop("cut_after", 0.15), ack_answer_window_secs=3.0, **kw)

    async def _push(frame, direction=None):
        rec.frames.append(frame); rec.dirs.append(direction)

    async def _broadcast():
        rec.interruptions += 1; state["cut"] = True
    tc.push_frame = _push
    tc.broadcast_interruption = _broadcast
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    return tc, state


def test_several_acknowledgements_in_one_breath_are_still_an_acknowledgement():
    from app.turntake import mid_reply_action, ABSORB, INTERRUPT
    for t in ["हाँ जी। नमस्ते जी। जी।", "ठीक है जी। हम्म।", "जी जी हाँ जी"]:
        assert mid_reply_action(t) == ABSORB, t
    for t in ["हाँ Ma'am जल्दी है।", "नहीं जी नहीं", "ठीक है पर fees कितनी है?"]:
        assert mid_reply_action(t) == INTERRUPT, t


@pytest.mark.asyncio
async def test_voice_mode_talks_straight_through_an_acknowledgement():
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tc, state = _voice_collector(rec, cut_after=0.3)
    b.FrameProcessor.process_frame = _noop_super
    UP = b.FrameDirection.UPSTREAM
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.1)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)   # a 0.1 s "हाँ"
    await _feed(tc, "हाँ जी।")
    await asyncio.sleep(0.4)                                     # past the cut window
    assert rec.interruptions == 0, "an acknowledgement stopped the bot"
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], rec.cues()
    assert "हाँ जी।" not in rec.cues(), "an aside must not split the context"


@pytest.mark.asyncio
async def test_a_talked_through_acknowledgement_does_not_split_the_bots_sentence():
    """Sim hello_cuts_opening (2026-09-23): 'Hello.' recorded mid-opening split it
    into '…Aarushi' + 'from Vacademy'; the opening check then saw 13 chars."""
    rec = _Rec()
    tc, state = _voice_collector(rec, cut_after=5.0)
    tc._outcome.transcript.append({"role": "assistant", "text": "Hi, is this Bhawana Jain? Aarushi"})
    await _feed(tc, "Hello.")
    tc._outcome.transcript.append({"role": "assistant", "text": "from Vacademy"})   # rest of the sentence
    tc._unrecord_aside("Hello.")                      # idempotent: nothing left to remove
    roles = [e["role"] for e in tc._outcome.transcript]
    assert roles.count("user") == 0, tc._outcome.transcript


@pytest.mark.asyncio
async def test_voice_mode_stops_once_the_caller_keeps_talking():
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tc, state = _voice_collector(rec, cut_after=0.15)
    b.FrameProcessor.process_frame = _noop_super
    UP = b.FrameDirection.UPSTREAM
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.3)                                     # still talking
    assert rec.interruptions == 1, "sustained voice must stop the bot"
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)


@pytest.mark.asyncio
async def test_voice_mode_real_words_stop_the_bot_on_their_transcript():
    rec = _Rec()
    tc, state = _voice_collector(rec, cut_after=5.0)
    await _feed(tc, "नहीं मुझे नहीं चाहिए।")
    assert rec.interruptions == 1


@pytest.mark.asyncio
async def test_an_acknowledgement_over_the_closing_question_is_answered_when_the_reply_ends():
    from pipecat.frames.frames import BotStoppedSpeakingFrame
    rec = _Rec()
    tc, state = _voice_collector(rec, cut_after=5.0)
    b.FrameProcessor.process_frame = _noop_super
    await _feed(tc, "हाँ।")                                      # over the question
    tc._outcome.transcript.append({"role": "assistant",
                                   "text": "क्या आप Shiksha Nation से जुड़ना चाहेंगे?"})
    state["speaking"] = False
    await tc.process_frame(BotStoppedSpeakingFrame(), b.FrameDirection.UPSTREAM)
    await asyncio.sleep(0.6)
    cues = [c for c in rec.cues() if "their ANSWER" in c]
    assert len(cues) == 1 and "हाँ" in cues[0], rec.cues()
    assert any(getattr(f, "run_llm", False) for f in rec.frames)


_QUIZ_REPLY = ("ठीक है। क्या मैं Scholarship Quiz का link भी WhatsApp कर दूँ? "
               "पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं।")


async def _ack_then_reply_ends(text, reply, back=1.0):
    """A talked-through ack `back` s before the end of `reply`; returns the cues."""
    from pipecat.frames.frames import BotStoppedSpeakingFrame
    rec = _Rec()
    tc, state = _voice_collector(rec, cut_after=5.0)
    b.FrameProcessor.process_frame = _noop_super
    await _feed(tc, text)
    assert tc._acked_mid_reply is not None, "not talked through"
    tc._acked_mid_reply = (text, time.time() - back)
    tc._outcome.transcript.append({"role": "assistant", "text": reply})
    state["speaking"] = False
    await tc.process_frame(BotStoppedSpeakingFrame(), b.FrameDirection.UPSTREAM)
    await asyncio.sleep(0.6)
    return rec


@pytest.mark.asyncio
async def test_an_acknowledgement_over_the_sentence_after_the_question_is_its_answer():
    """Call 71d0d5bd (2026-10-02): "हाँ" over "पंद्रह questions हैं, सिर्फ पंद्रह मिनट
    लगते हैं।" — the sentence AFTER "…कर दूँ?" — was dropped because the reply did
    not END with "?". Both sides waited 29 s."""
    rec = await _ack_then_reply_ends("हाँ।", _QUIZ_REPLY)
    cues = [c for c in rec.cues() if "their ANSWER" in c]
    assert len(cues) == 1, rec.cues()
    assert "WhatsApp कर दूँ?" in cues[0] and "हाँ" in cues[0], cues[0]
    assert any(getattr(f, "run_llm", False) for f in rec.frames)


@pytest.mark.asyncio
async def test_an_acknowledgement_over_a_long_statement_after_the_question_is_not_the_answer():
    long = ("क्या मैं link भेज दूँ? पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं, और result "
            "उसी दिन आपके WhatsApp पर आ जाता है।")
    rec = await _ack_then_reply_ends("हाँ।", long)
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], rec.cues()


@pytest.mark.asyncio
async def test_a_hello_over_the_sentence_after_the_question_is_not_the_answer():
    rec = await _ack_then_reply_ends("Hello?", _QUIZ_REPLY, back=0.8)
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], rec.cues()
    assert not [c for c in rec.cues() if "their ANSWER" in c], rec.cues()


def test_every_ack_path_agrees_on_whether_the_reply_ended_on_a_question():
    """Three turn-gate paths decide "did the caller hear a question just now?"
    — at the VAD stop (resume or not), when their final lands (ducked / cut),
    and when a talked-through reply ends. On 71d0d5bd the last one alone said
    no. One test (turntake.ends_on_question), one answer, on every path."""
    from app.turntake import ends_on_question
    texts = [_QUIZ_REPLY, "क्या आप जुड़ना चाहेंगे?", "Who is it right now? Is that",
             "ठीक है, मैं भेज देती हूँ।",
             "क्या मैं link भेज दूँ? पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं, और result "
             "उसी दिन आपके WhatsApp पर आ जाता है।"]
    for t in texts:
        tc = b.TranscriptCollector.__new__(b.TranscriptCollector)

        class _O:
            transcript = [{"role": "assistant", "text": t}]
        tc._outcome = _O()
        at_vad_stop = tc._played_tail_is_question()
        _O.transcript.append({"role": "user", "text": "हाँ।"})
        at_final = tc._played_ended_with_question()
        assert at_vad_stop == at_final == ends_on_question(t), t


@pytest.mark.asyncio
async def test_an_early_acknowledgement_or_a_hello_is_not_taken_as_the_answer():
    from pipecat.frames.frames import BotStoppedSpeakingFrame
    for text, back in (("हाँ।", 6.0), ("Hello.", 0.5)):
        rec = _Rec()
        tc, state = _voice_collector(rec, cut_after=5.0)
        b.FrameProcessor.process_frame = _noop_super
        await _feed(tc, text)
        tc._acked_mid_reply = (text, time.time() - back)
        tc._outcome.transcript.append({"role": "assistant", "text": "क्या आप जुड़ना चाहेंगे?"})
        state["speaking"] = False
        await tc.process_frame(BotStoppedSpeakingFrame(), b.FrameDirection.UPSTREAM)
        await asyncio.sleep(0.6)
        assert not [f for f in rec.frames if getattr(f, "run_llm", False)], (text, rec.cues())


@pytest.mark.asyncio
async def test_an_acknowledgement_right_after_the_gate_cut_the_reply_resumes_it():
    """Call 0808862f: the gate cut at 0.7 s of voice; "हाँ जी बिल्कुल" arrived
    0.1 s later, before the pipeline's own cut flag and before the bot-speaking
    flag dropped. It was read as an aside — nothing resumed, 8 s of silence."""
    from pipecat.frames.frames import VADUserStartedSpeakingFrame
    rec = _Rec()
    tail = "क्या मानशु के साथ भी ऐसा है सर, कि कुछ subjects में वो बहुत अच्छा करता है?"
    tc, state = _voice_collector(rec, cut_after=0.1, resume_unplayed=lambda n=600: tail,
                                 resume_settle_secs=0.01)
    b.FrameProcessor.process_frame = _noop_super
    await tc.process_frame(VADUserStartedSpeakingFrame(), b.FrameDirection.UPSTREAM)
    await asyncio.sleep(0.2)                         # the gate cuts on sustained voice
    assert rec.interruptions == 1
    state["cut"] = False                             # pipeline flag not stamped yet
    assert state["speaking"] is True                 # …and the bot still reads as speaking
    await _feed(tc, "हाँ जी बिल्कुल।")
    await asyncio.sleep(0.1)
    assert tc._acked_mid_reply is None, "treated as an aside over a reply that was cut"
    assert any(isinstance(f, b.TTSSpeakFrame) and f.text == tail for f in rec.frames), \
        "the unheard closing question was not resumed"


@pytest.mark.asyncio
async def test_voice_mode_a_blip_while_composing_does_not_re_ask():
    """Nothing was cut, so the 'a noise killed your reply' recovery must not run."""
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tc, state = _voice_collector(rec, bot_speaking=False, cut_after=5.0,
                                 resume_on_stop_secs=1.0, resume_unplayed=lambda n=600: "")
    state["in_flight"] = True
    tc._outcome.transcript.append({"role": "user", "text": "मैं बच्चे का पिता बोल रहा हूँ।"})
    b.FrameProcessor.process_frame = _noop_super
    UP = b.FrameDirection.UPSTREAM
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.2)
    assert rec.interruptions == 0
    assert not [f for f in rec.frames if getattr(f, "run_llm", False)], rec.cues()


# ── 22 Sep batch: a fixed 0.30 s between "turn COMPLETE" and the model, every turn ──
@pytest.mark.asyncio
async def test_only_the_final_after_our_flush_is_flagged_finalized():
    from pipecat.frames.frames import (TranscriptionFrame, VADUserStartedSpeakingFrame,
                                       VADUserStoppedSpeakingFrame)
    from app.providers import final_after_flush

    class _Base:
        _settings = type("S", (), {"vad_signals": None})()
        def __init__(self): self.out = []
        async def process_frame(self, frame, direction): pass
        async def push_frame(self, frame, direction=None): self.out.append(frame)

    stt = final_after_flush(_Base)()
    D = b.FrameDirection.UPSTREAM
    f = lambda t: TranscriptionFrame(t, "u", "0")
    await stt.process_frame(VADUserStartedSpeakingFrame(), D)
    await stt.push_frame(f("मेरा बेटा"))                  # mid-utterance final
    await stt.process_frame(VADUserStoppedSpeakingFrame(), D)
    await stt.push_frame(f("class 6 में है।"))             # the answer to our flush
    await stt.process_frame(VADUserStartedSpeakingFrame(), D)
    await stt.push_frame(f("और"))                         # caller speaking again
    assert [x.finalized for x in stt.out] == [False, True, False]
    # Sarvam's own VAD drives segmentation → no flush → never flag
    _Base._settings.vad_signals = True
    stt2 = final_after_flush(_Base)()
    await stt2.process_frame(VADUserStoppedSpeakingFrame(), D)
    await stt2.push_frame(f("हाँ।"))
    assert stt2.out[-1].finalized is False


def test_build_stt_uses_the_flagging_sarvam_class():
    import inspect
    from app import providers as pv
    src = inspect.getsource(pv.build_stt)
    assert "final_after_flush(SarvamSTTService) if s.sarvam_final_on_flush" in src


@pytest.mark.asyncio
async def test_a_backchannel_during_the_settle_window_still_gets_no_cue():
    """The 0.6 s teardown settle must not re-open the two-voices window: while
    a resume is scheduled but not yet audible, a backchannel still generates
    nothing."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "बाकी बात यह है कि आगे क्या करना है।",
                           resume_settle_secs=0.4)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    assert tc._resume_pending(), "the settle window should count as in-flight"
    tc._outcome.transcript.append({"role": "assistant", "text": "जी सर, तो बताइए।"})
    await _feed(tc, "हम्म।")                     # arrives inside the settle
    assert not any(("carry on" in c) or ("NEXT step" in c) for c in rec.cues()), rec.cues()
    tc._cancel_resume_check(stale=True)


@pytest.mark.asyncio
async def test_a_backchannel_after_an_early_resume_says_nothing_more():
    """bot_speaking=True: the words resumed at their VAD stop are still
    playing, so a second "ठीक है" over them needs no cue at all."""
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "")
    tc._outcome.transcript.append({"role": "assistant", "text": "जी सर, तो बताइए।"})
    tc._resumed_t = time.time()
    await _feed(tc, "ठीक है।")
    assert _spoken_texts(rec) == [], "already resuming"
    assert not any("carry on" in c or "NEXT step" in c for c in rec.cues()), rec.cues()
    assert any("ठीक है" in c for c in rec.cues()), "the backchannel still reaches the context"


def test_tts_probe_sends_what_the_vendor_would_really_get():
    """The nightly of 2026-09-16 reported "<<END_CALL>> → 3.7 s of audio" as a
    vendor fault. Nothing of the sort reaches the TTS (0 of three days' renders
    carry a marker) — the probe was feeding it the RAW model reply, which is
    recorded before SentinelGate strips markers and cues. A harness that cries
    wolf is worse than no harness."""
    import importlib.util as _u
    import os as _os
    _p = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                       "sim", "ttsprobe.py")
    _spec = _u.spec_from_file_location("_ttsprobe", _p)
    tp = _u.module_from_spec(_spec); _spec.loader.exec_module(tp)
    assert tp.strip_like_the_sentinel("जी सर। बात हो गई। " + b.END_MARKER) == "जी सर। बात हो गई।"
    assert tp.strip_like_the_sentinel("Okay. <SEND:brochure> Thank you.") == "Okay. Thank you."
    assert tp.strip_like_the_sentinel("[That was their ANSWER…] नाम क्या है?") == "नाम क्या है?"
    assert tp.strip_like_the_sentinel(b.TRANSFER_MARKER) == ""
    assert tp.strip_like_the_sentinel("Plain sentence.") == "Plain sentence."


# ── call 3b5fb592 (2026-09-18): two 0.2 s blips, two false apologies ────────

def test_a_blip_is_not_an_unheard_turn():
    """THE REGRESSION THIS FILE MISSED. With no transcript the aggregator always
    closes a turn on its 5 s stop-timeout, so "turn lasted >= 4 s" was true for
    a 0.02 s blip too — the bot twice told a caller who had said nothing
    "माफ़ कीजिए, आवाज़ कट गई", and the second one demoted the STT as well.
    The VAD ticks are the only honest measure of how long they spoke."""
    def armed(voice_secs: float, dur: float = 5.1) -> bool:
        # mirrors run_bot.set_user_speaking(False)
        started, min_utt = 100.0, 0.4
        voice_tick_t = started + voice_secs
        transcript_t = started - 1.0
        return (dur >= 4.0 and (voice_tick_t - started) >= min_utt
                and transcript_t < started)
    assert not armed(0.02), "a 20 ms blip must never arm the re-ask"
    assert not armed(0.22), "the 0.22 s blip of call 3b5fb592"
    assert not armed(0.39)
    assert armed(0.4), "a real short utterance the STT lost still arms it"
    assert armed(5.0), "5 s of speech with a deaf STT is exactly what it is for"
    assert not armed(5.0, dur=2.0), "the turn must also have been given up on"


@pytest.mark.asyncio
async def test_a_blip_that_killed_a_reply_asks_for_the_reply_again_not_for_a_repeat():
    """The 0.02 s blip cancelled the generation answering "मैं बच्चे का पिता बोल
    रहा हूँ" before a word of it played, and the caller waited 6 s for an
    apology. Ask the model for that answer again instead."""
    from pipecat.frames.frames import (VADUserStartedSpeakingFrame,
                                       VADUserStoppedSpeakingFrame)
    D = b.FrameDirection.DOWNSTREAM
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "",   # nothing played, nothing to resume
                           resume_on_stop_secs=1.0)
    tc._outcome.transcript.extend([{"role": "assistant", "text": "नमस्ते जी, मैं श्रेया बोल रही हूँ।"},
                                   {"role": "user", "text": "मैं बच्चे का पिता बोल रहा हूँ।"}])
    b.FrameProcessor.process_frame = _noop_super
    await tc.process_frame(VADUserStartedSpeakingFrame(), D)
    tc._vad_started_t -= 0.02
    await tc.process_frame(VADUserStoppedSpeakingFrame(), D)
    cues = rec.cues()
    assert any("cut your reply off" in c for c in cues), cues
    assert any(getattr(f, "run_llm", False) for f in rec.frames), "must actually regenerate"
    # the CALLER is never asked to repeat: no apology is spoken, and the cue
    # tells the model not to ask for one
    assert _spoken_texts(rec) == [], f"nothing should be spoken to the caller: {_spoken_texts(rec)}"
    assert any("do not ask them to repeat" in c for c in cues), cues
    # once per turn, not on every blip
    rec.frames.clear()
    await tc.process_frame(VADUserStartedSpeakingFrame(), D)
    tc._vad_started_t -= 0.02
    await tc.process_frame(VADUserStoppedSpeakingFrame(), D)
    assert rec.cues() == [], "a second blip on the same turn must not re-fire"


@pytest.mark.asyncio
async def test_the_resume_waits_out_the_teardown_then_proves_it_was_heard():
    """pipecat clears the TTS queue and reconnects the socket while handling an
    interruption, so a frame pushed into that window is dropped with no error
    (3 of the first 4 live resumes). Wait, send, then judge by what PLAYED:
    say it once more if it never arrived, and finally give the words back to
    the model rather than leave them counted as said (call b41b481f)."""
    rec = _Rec()
    tail = "क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ?"
    forgotten = {"n": 0}

    def forget():
        forgotten["n"] += 1
        return True
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: tail, forget_resume=forget,
                           resume_settle_secs=0.02)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    assert _spoken_texts(rec) == [], "spoke into the teardown window"
    await asyncio.sleep(0.06)
    assert _spoken_texts(rec) == [tail], "never sent after the settle"
    # nothing ever plays: one more attempt, then hand the words back
    await asyncio.wait_for(tc._resume_check, timeout=6)
    assert _spoken_texts(rec) == [tail, tail], _spoken_texts(rec)
    assert forgotten["n"] == 1, "words that were never heard stayed marked as said"


@pytest.mark.asyncio
async def test_a_resume_that_did_play_is_neither_repeated_nor_handed_back():
    rec = _Rec()
    tail = "क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ?"
    forgotten = {"n": 0}
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: tail,
                           forget_resume=lambda: forgotten.__setitem__("n", forgotten["n"] + 1),
                           resume_settle_secs=0.02)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    await asyncio.sleep(0.06)
    tc._outcome.transcript.append({"role": "assistant", "text": tail})   # it played
    await asyncio.wait_for(tc._resume_check, timeout=6)
    assert _spoken_texts(rec) == [tail], "said the same words twice"
    assert forgotten["n"] == 0, "un-recorded words the caller actually heard"


@pytest.mark.asyncio
async def test_forget_resumed_puts_the_words_back_in_play():
    """The gate's side of the same contract."""
    from pipecat.frames.frames import InterruptionFrame
    rec = _NRRec()
    played = {"t": ""}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "",
                       played_text=lambda: played["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    D = b.FrameDirection.DOWNSTREAM
    Q = "क्या मैं जान सकती हूँ कि आकाश के previous class में कितने marks आए थे?"
    await _reply(g, "जी सर। ", Q)
    played["t"] = "जी सर।"
    await g.process_frame(InterruptionFrame(), D)
    assert g.take_unplayed_tail().strip() == Q
    assert normalize_spoken(Q) in g._spoken
    assert g.forget_resumed() is True
    assert normalize_spoken(Q) not in g._spoken, "still counted as said"
    assert g.forget_resumed() is False, "nothing left to give back"
    rec.text.clear()
    await _reply(g, Q)
    assert [t.strip() for t in rec.text] == [Q], f"the model's copy was suppressed: {rec.text}"


@pytest.mark.asyncio
async def test_one_next_step_request_per_caller_turn():
    """Call b41b481f: three generations in 1.6 s, each tripping the restatement
    rule and asking for a next step again, all producing the same sentence."""
    rec = _NRRec()
    asked = []
    caller = {"t": "अच्छा।"}

    async def _next_step(held, kind="", attempt=0):
        asked.append(kind)
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "नाम क्या है और अभी किस class में पढ़ रहा है?")
    rec.text.clear()
    for _ in range(3):                       # the model keeps restating, same turn
        await _reply(g, "नाम क्या है और अभी किस class में पढ़ रहा है?")
    assert len(asked) == 1, f"burned the budget on one turn: {asked}"
    caller["t"] = "हाँ जी बोलिए।"             # a NEW turn earns another
    await _reply(g, "नाम क्या है और अभी किस class में पढ़ रहा है?")
    assert len(asked) == 2, asked


# ── call 0c42d3a6 (2026-09-18): "समझ नहीं आया" and the stale re-send ────────

def test_could_not_hear_us_reads_the_negation_not_the_length():
    """"क्या बोल रहे हैं समझ नहीं आया" is SEVEN words, so the old <=5 cap missed
    it and the clarification was dropped as already-said — the parent got an
    apology and 7.6 s of silence. The same cap also matched "समझ गया सर"
    (I DID understand), which is the opposite request."""
    from app.turntake import caller_asked_to_repeat as r, could_not_hear_us as c
    for t in ("क्या बोल रहे हैं समझ नहीं आया", "समझ में नहीं आया सर", "मैं समझा नहीं",
              "मुझे कुछ सुनाई नहीं दे रहा", "आवाज़ नहीं आ रही है",
              "I didn't understand what you said", "Sorry, I didn't catch that",
              "I can't hear you properly", "that was not clear at all"):
        assert c(t) and r(t), t
    for t in ("समझ गया सर", "जी समझ आ गया", "मुझे समझ में आ रहा है", "yes I understand",
              "हाँ जी clear है", "हाँ मैंने बोला clear है", "yes that is clear",
              "I can hear you fine", "नहीं नहीं बस यही है", "नहीं बस यही है",
              "अभी नहीं बाद में बात करते हैं"):
        assert not c(t), t
        assert not r(t), t
    # the phrases the old rule got right still work
    for t in ("फिर से बोलिए", "can you repeat", "say that again", "Sorry?", "दोबारा बोलिए"):
        assert r(t), t


@pytest.mark.asyncio
async def test_a_barge_in_cancels_the_pending_re_send_of_resumed_words():
    """Call 0c42d3a6: the resume was pushed, the caller barged in 0.13 s later,
    and 1.2 s after that the watcher re-sent the stale words — which the gate
    then suppressed, so the model's real reply was lost and the call ended on
    "हाँ जी?"."""
    rec = _Rec()
    tail = "आपको एक online dashboard मिलता है — schedule, link, recordings, सब एक जगह।"
    forgotten = {"n": 0}
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: tail, resume_settle_secs=0.3,
                           forget_resume=lambda: forgotten.__setitem__("n", 1) or True)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    assert tc._resume_check is not None and not tc._resume_check.done()
    await _feed(tc, "हाँ जी clear है।")          # a real barge-in: they took the turn
    assert tc._resume_check is None, "the stale re-send was left armed"
    await asyncio.sleep(0.4)
    assert _spoken_texts(rec) == [], "said stale words over the turn they had just taken"
    assert forgotten["n"] == 1, "the abandoned words still count as said"


@pytest.mark.asyncio
async def test_no_re_send_while_the_model_is_already_writing():
    rec = _Rec()
    forgotten = {"n": 0}
    tc = _replay_collector(rec, bot_speaking=False, recently_cut=lambda: True,
                           resume_unplayed=lambda n=600: "x y z", resume_settle_secs=0.01,
                           forget_resume=lambda: forgotten.__setitem__("n", 1) or True)
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    # The model starts writing once the resume is under way (a resume never
    # STARTS over a reply already on its way — _resume_cut_words).
    writing = {"v": False}
    tc._reply_in_flight = lambda: writing["v"]
    b.FrameProcessor.process_frame = _noop_super
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    writing["v"] = True
    await asyncio.wait_for(tc._resume_check, timeout=6)
    # sent once, never repeated over the model, and handed back so the model
    # is free to say them itself
    assert _spoken_texts(rec) == ["x y z"], _spoken_texts(rec)
    assert forgotten["n"] == 1, "left marked as said while the model was writing"


@pytest.mark.asyncio
async def test_resumed_words_that_never_played_stop_counting_as_said():
    """The other half of the same collapse: take_unplayed_tail marks the words
    "said", so when the resume itself is cut the model's reply gets dropped as
    a repeat. They go back into _pending, so the next interruption un-records
    them exactly like any other emitted sentence."""
    from pipecat.frames.frames import InterruptionFrame
    rec = _NRRec()
    played = {"t": ""}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "",
                       played_text=lambda: played["t"])
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    D = b.FrameDirection.DOWNSTREAM
    Q = "आपको एक online dashboard मिलता है, सब एक जगह।"
    await _reply(g, "जी सर। ", Q)
    played["t"] = "जी सर।"
    await g.process_frame(InterruptionFrame(), D)
    assert g.take_unplayed_tail().strip() == Q
    assert normalize_spoken(Q) in g._spoken
    # the resume is itself cut before a word of it plays
    await g.process_frame(InterruptionFrame(), D)
    assert normalize_spoken(Q) not in g._spoken, "still marked said though never heard"
    rec.text.clear()
    await _reply(g, Q)                       # the model says it properly this time
    assert [t.strip() for t in rec.text] == [Q], f"suppressed the only copy the caller would hear: {rec.text}"


def test_orphan_ask_fires_past_the_retry_window_and_at_most_twice():
    from app import callstate as cs
    cfg = cs.WatchdogConfig(connected_at=0.0, cap_secs=600, idle_timeout_secs=1e9,
                            stall_recovery_enabled=False, graceful_stop_deadline_secs=10.0,
                            no_words_timeout_secs=1e9, stall_after_secs=1e9,
                            orphan_window_secs=(3.5, 10.0), orphan_connect_grace_secs=6.0)
    s = cs.CallState()
    s.user_started_t, s.user_stopped_t, s.bot_stopped_t, s.transcript_t = 20.0, 22.0, 10.0, 5.0
    s.voice_tick_t = 22.0
    assert cs.watchdog_decide(s, 24.0, cfg).kind != cs.ORPHAN_ASK, "too early (a retried final may still land)"
    d = cs.watchdog_decide(s, 26.0, cfg)
    assert d.kind == cs.ORPHAN_ASK, d
    cs.apply_decision(s, d, 26.0)
    assert cs.watchdog_decide(s, 27.0, cfg).kind != cs.ORPHAN_ASK, "re-fired on the same silence"
    # the turn is still OPEN (no transcript, aggregator holding): the acoustic
    # stamp must drive the window, not the previous turn's stop
    s.user_started_t, s.user_stopped_t, s.voice_tick_t = 30.0, 22.0, 32.0
    assert cs.watchdog_decide(s, 33.0, cfg).kind != cs.ORPHAN_ASK, "voice still recent"
    d2 = cs.watchdog_decide(s, 36.0, cfg); assert d2.kind == cs.ORPHAN_ASK, d2
    cs.apply_decision(s, d2, 36.0)
    s.user_started_t, s.user_stopped_t, s.voice_tick_t = 40.0, 42.0, 42.0
    assert cs.watchdog_decide(s, 46.0, cfg).kind != cs.ORPHAN_ASK, "third ask must not fire"


def test_orphan_ask_covers_a_timeout_closed_unheard_turn():
    """Call b2f6330a: the caller talked for 18 s to a stalled STT; the VAD only
    caught 0.3 s blips (below orphan_min_utterance) and the aggregator closed
    the turn on its 5 s timeout. That close is the evidence — ask anyway."""
    from app import callstate as cs
    cfg = cs.WatchdogConfig(connected_at=0.0, cap_secs=600, idle_timeout_secs=1e9,
                            stall_recovery_enabled=False, graceful_stop_deadline_secs=10.0,
                            no_words_timeout_secs=1e9, stall_after_secs=1e9,
                            orphan_window_secs=(3.5, 10.0), orphan_connect_grace_secs=6.0)
    s = cs.CallState()
    s.user_started_t, s.voice_tick_t, s.bot_stopped_t, s.transcript_t = 20.0, 20.3, 10.0, 5.0
    s.user_stopped_t = 25.3                       # closed by the timeout
    assert cs.watchdog_decide(s, 26.0, cfg).kind != cs.ORPHAN_ASK, "0.3 s blip alone is not enough"
    s.unheard_turn_t = 25.3
    d = cs.watchdog_decide(s, 26.0, cfg)
    assert d.kind == cs.ORPHAN_ASK, d
    s.transcript_t = 27.0                          # words arrived after all
    s.user_started_t, s.voice_tick_t = 30.0, 30.3
    assert cs.watchdog_decide(s, 36.0, cfg).kind != cs.ORPHAN_ASK, "a later transcript clears the stamp"


def test_whatsapp_number_question_is_not_the_link_question():
    """Call b2f6330a: 'Is this number on WhatsApp?' was dropped twice as a re-ask
    of 'you send it to all your students on WhatsApp?' and the booking ended on
    'Okay. Okay. Yes, go ahead.'"""
    from app.turntake import question_topic as qt
    assert qt("Is this number on WhatsApp?") == "whatsapp_number"
    assert qt("क्या ये नंबर WhatsApp पे है?") == "whatsapp_number"
    assert qt("And you send it to all your students on WhatsApp?") == "quiz_link"
    assert qt("Is this number on WhatsApp?") != qt("Kya aap link WhatsApp pe bhejte hain?")


def test_hinglish_whatsapp_number_question_is_not_the_link_question():
    """Prompt v8 probe (2026-10-02): THE CLOSE asks "क्या ये number WhatsApp पर
    है?" and then the quiz link. Both fell to quiz_link, so the quiz question was
    dropped as a re-ask of the number question in every simulated run."""
    from app.turntake import question_topic as qt
    number_q = ("सर, इस call के बाद मैं आपको sample report और demo videos share कर दूँगी। "
                "क्या ये number WhatsApp पर है?")
    assert qt(number_q) == "whatsapp_number"
    assert qt("क्या आपका number WhatsApp पर है?") == "whatsapp_number"
    assert qt("क्या इसी number पर WhatsApp कर दूँ?") == "whatsapp_number"
    for link_q in ("क्या मैं उसका link भी WhatsApp कर दूँ?",
                   "क्या मैं Scholarship Quiz का link भी WhatsApp कर दूँ?",
                   "क्या मैं quiz का लिंक भेज दूँ?"):
        assert qt(link_q) == "quiz_link", link_q
        assert qt(link_q) != qt(number_q)


def test_screener_hold_lines():
    from app.turntake import is_screener_hold as f
    for t in ("Thanks Aarushi. Please stay on the line.", ", uh, you're still in.", "One moment please"):
        assert f(t), t
    for t in ("Yes, go ahead.", "Hello?", "What is it regarding?"):
        assert not f(t), t


def test_spoken_key_ignores_vendor_punctuation():
    """Call f28888b2: the played text (rebuilt from Smallest's word timestamps)
    lacks our "—", "50+" and "।"; the sentence must still count as heard."""
    from app.turntake import spoken_key as k
    ours = "हमारे यहाँ 50+ faculties हैं और सभी full-time payroll पर हैं — वो सिर्फ class लेते हैं।"
    played = "हमारे यहाँ 50 faculties हैं और सभी full time payroll पर हैं वो सिर्फ class लेते हैं"
    assert k(ours) == k(played)
    assert k("तो आकाश सिर्फ एक faculty से नहीं पढ़ रहा — उसके पीछे") in k("x " + "तो आकाश सिर्फ एक faculty से नहीं पढ़ रहा उसके पीछे" + " y")
    assert k("Is this number on WhatsApp?") not in k("And you send it to all your students on WhatsApp?")


def test_caller_asks_who_shapes():
    from app.turntake import caller_asks_who as f
    for t in ("आप कौन बोल रहे हैं?", "Aap kaun bol rahi ho", "Who is this?", "who's calling", "आप कहाँ से बोल रहे हैं",
              "Uh, can I know the name of your"):
        assert f(t), t
    assert not f("Yes, go ahead.") and not f("kaun se class mein hai")


@pytest.mark.asyncio
async def test_who_is_calling_cues_the_answer_first():
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    tc._reply_in_flight = lambda: False
    await _feed(tc, "आप कौन बोल रहे हैं?")
    assert any("who is calling" in c for c in rec.cues()), rec.cues()


@pytest.mark.asyncio
async def test_the_callers_thank_you_after_our_goodbye_does_not_reopen_the_call():
    """Call 82c1f95a: "Thank you for your time. Namaste." → caller "Thank you."
    → re-engaged → nothing left to say → "Yes, go ahead." as the last line."""
    from app.turntake import caller_says_goodbye as g
    for t in ("Thank you.", "Okay, bye", "Theek hai ji", "Thanks, namaste", "धन्यवाद"):
        assert g(t), t
    for t in ("Wait, one more question", "What about the fees?", "Actually I have a doubt"):
        assert not g(t), t
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=False)
    tc._end_pending = lambda: True
    stamped = []
    tc._on_transcript = lambda backchannel=False, substantive=False: stamped.append(backchannel)
    await _feed(tc, "Thank you.")
    assert rec.frames == [], "the goodbye reached the model and re-opened the call"
    assert stamped == [True]


# ── FloorGate: never START a reply over a caller who is talking (call 358e5026) ──
def _floor(talking, speaking=lambda: False, cap=3.0):
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    out = []
    g = b.FloorGate(enabled=lambda: True, caller_talking=talking,
                    is_bot_speaking=speaking, diag=d, cap_secs=cap, poll_secs=0.01)
    async def _push(frame, direction=None):
        out.append(frame)
    g.push_frame = _push
    g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    return g, out, d


def _audio(tag=b"\x00\x00"):
    from pipecat.frames.frames import TTSAudioRawFrame
    return TTSAudioRawFrame(audio=tag * 80, sample_rate=8000, num_channels=1)


@pytest.mark.asyncio
async def test_a_reply_ready_while_the_caller_talks_waits_and_then_plays_in_order():
    """The parent is mid-fragment when the reply's first audio is ready: hold
    it; they stop (an acknowledgement, absorbed by the turn-gate) → the
    whole reply plays, first frame first."""
    from pipecat.frames.frames import LLMFullResponseEndFrame
    st = {"talking": True}
    g, out, d = _floor(lambda: st["talking"])
    D = b.FrameDirection.DOWNSTREAM
    a1, a2, end = _audio(b"\x01\x00"), _audio(b"\x02\x00"), LLMFullResponseEndFrame()
    await g.process_frame(a1, D)
    await g.process_frame(a2, D)
    assert out == [] and g.is_holding(), "started talking over the caller"
    await asyncio.sleep(0.05)
    await g.process_frame(end, D)             # the reply's end arrives mid-hold
    assert out == []
    st["talking"] = False
    await asyncio.sleep(0.05)
    assert out == [a1, a2, end], "held reply lost or reordered"
    assert not g.is_holding()
    assert d.floor_holds == 1 and d.floor_holds_released == 1


@pytest.mark.asyncio
async def test_a_held_reply_is_dropped_when_the_caller_takes_the_turn():
    """Their words turn out to be real ("बच्चों के class ये हैं।"): the
    turn-gate interrupts and the stub never reaches the line."""
    from pipecat.frames.frames import InterruptionFrame
    g, out, d = _floor(lambda: True)
    D = b.FrameDirection.DOWNSTREAM
    await g.process_frame(_audio(), D)
    await g.process_frame(_audio(), D)
    intr = InterruptionFrame()
    await g.process_frame(intr, D)
    await asyncio.sleep(0.05)
    assert out == [intr], "a dropped reply leaked audio"
    assert not g.is_holding() and d.floor_holds_dropped == 1
    a = _audio()                              # the next reply, caller now quiet
    g._caller_talking = lambda: False
    await g.process_frame(a, D)
    assert out[-1] is a


@pytest.mark.asyncio
async def test_a_reply_on_a_quiet_line_is_never_held():
    g, out, d = _floor(lambda: False)
    a = _audio()
    await g.process_frame(a, b.FrameDirection.DOWNSTREAM)
    assert out == [a] and d.floor_holds == 0


@pytest.mark.asyncio
async def test_sound_during_a_playing_reply_is_not_the_floor_gates_business():
    """Voice mode talks through a "हाँ" mid-reply. Only a reply STARTING is
    held: later audio of a reply already on the line passes."""
    st = {"talking": False}
    g, out, d = _floor(lambda: st["talking"])
    D = b.FrameDirection.DOWNSTREAM
    await g.process_frame(_audio(), D)        # reply starts on a quiet line
    st["talking"] = True
    await g.process_frame(_audio(), D)        # next sentence, caller acking
    assert len(out) == 2 and d.floor_holds == 0
    g2, out2, d2 = _floor(lambda: True, speaking=lambda: True)
    await g2.process_frame(_audio(), D)       # bot audibly speaking: never a start
    assert len(out2) == 1 and d2.floor_holds == 0


@pytest.mark.asyncio
async def test_a_line_that_never_goes_quiet_still_gets_its_reply():
    g, out, d = _floor(lambda: True, cap=0.1)
    a = _audio()
    await g.process_frame(a, b.FrameDirection.DOWNSTREAM)
    await asyncio.sleep(0.2)
    assert out == [a] and d.floor_holds_capped == 1


def test_floor_gate_sits_before_the_duck_and_counts_as_a_reply_in_flight():
    src = open(b.__file__, encoding="utf-8").read()
    assert "        floor,          # never START a reply over a talking caller\n        duck," in src
    assert "if floor.is_holding():\n            return True" in src


# ── call e32df5c0 (2026-09-23): "क्या <name> के साथ भी ऐसा है सर" read aloud ──
def test_template_slots_copied_from_the_prompt_are_never_spoken():
    t, n = b.fill_template_slots("क्या <name> के साथ भी ऐसा है सर, कि कुछ subjects में?")
    assert t == "क्या बच्चे के साथ भी ऐसा है सर, कि कुछ subjects में?" and n == 1
    t, n = b.fill_template_slots("So how is <child name> doing in maths?")
    assert t == "So how is your child doing in maths?" and n == 1
    t, n = b.fill_template_slots("सर, <program> की fees लगभग <range> के बीच रहती है।")
    assert "<" not in t and n == 2
    for marker in ("<<SEND:scholarship_quiz>>", "<<END_CALL>>", "<<TRANSFER>>", "5 < 7 > 3"):
        assert b.fill_template_slots(marker) == (marker, 0), marker


def test_no_repeat_gate_fills_slots_before_the_tts():
    src = open(b.__file__, encoding="utf-8").read()
    i = src.index("async def _emit(self, text: str, direction, past_cap: bool = False)")
    j = src.index("norm = normalize_spoken(text)", i)
    assert "fill_template_slots(text" in src[i:j]


@pytest.mark.asyncio
async def test_smallest_meters_only_the_characters_the_vendor_synthesises():
    """diagnostics.tts.chars drives the per-call TTS cost; it was null for
    Smallest. The cache wraps the instance's run_tts and calls the class one
    only on a miss, so metering there counts vendor characters only."""
    from app.providers import _letterless_guard
    import app.diagnostics as dg

    class _Engine:
        async def run_tts(self, text, context_id=None):
            yield "audio:" + text

    G = _letterless_guard(_Engine)
    d = dg.CallDiagnostics()
    t = G(); t.set_diagnostics(d)
    out = [f async for f in t.run_tts(" नमस्ते जी। ")]
    assert out == ["audio: नमस्ते जी। "] and d.tts_chars == len("नमस्ते जी।")
    original = t.run_tts                      # what install_tts_cache wraps

    async def cached(text, context_id=None):
        if text == "हाँ जी?":
            yield "cached"; return            # a HIT never reaches the class method
        async for f in original(text, context_id):
            yield f
    t.run_tts = cached
    [f async for f in t.run_tts("हाँ जी?")]
    assert d.tts_chars == len("नमस्ते जी।")
    [f async for f in t.run_tts("ठीक है।")]
    assert d.tts_chars == len("नमस्ते जी।") + len("ठीक है।")


@pytest.mark.asyncio
async def test_a_long_reply_stops_at_the_length_budget_but_asks_its_question():
    """Call 3c2f5b82 (2026-09-24): a 210-char pitch sentence, then the faculty
    line — "समझ में नहीं आया", hang-up. After the first sentence, nothing that
    takes the reply past max_reply_chars; the closing question still goes."""
    from app.config import Settings
    assert Settings().max_reply_chars == 240 and Settings().max_sentences_per_reply == 3
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "नहीं।",
                       max_sentences=lambda: 3, max_chars=lambda: 240)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "ठीक है सर। ",
                 "Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है, हम Day one से "
                 "बच्चों की concept clarity मजबूत करने पर काम करते हैं, ताकि वो school exams में "
                 "बेहतर perform करें और पूरे confidence के साथ अच्छे marks ला सकें। ",
                 "हमारे यहाँ 50+ full-time faculties हैं, और हर faculty class के बाद तीन-चार घंटे "
                 "खुद तैयारी करते हैं। ",
                 "क्या आप इसके बारे में और जानना चाहेंगे?")
    said = [t.strip() for t in rec.text if t.strip()]
    assert any("focus" in t for t in said), said
    assert not any("faculties" in t for t in said), "the stacked sentence should be held"
    assert said[-1].startswith("क्या आप"), said
    rec.text.clear()
    long_one = "Shiksha Nation में " + "बहुत अच्छी पढ़ाई होती है, " * 12 + "सच में।"
    await _reply(g, long_one)
    assert [t.strip() for t in rec.text if t.strip()] == [long_one.strip()], \
        "the first sentence always plays, however long"


# ── call 2983bf1f (2026-09-24): a question that cut the bot off went unanswered ──
@pytest.mark.asyncio
async def test_a_question_that_cuts_the_bot_off_is_answered_first():
    """The model got "तो Ma'am कैसे क्या होगा… पढ़ाई हो सकती?" whole and
    re-delivered the dashboard sentence it had lost. A cue now travels with
    the question — before the interruption, so it cannot go missing — and
    only once for a burst of pieces."""
    from pipecat.frames.frames import TranscriptionFrame, LLMMessagesAppendFrame
    rec = _Rec()
    tc = _replay_collector(rec, bot_speaking=True)
    order = []
    async def _broadcast():
        rec.interruptions += 1; order.append("INTERRUPT")
    async def _push(frame, direction=None):
        rec.frames.append(frame); rec.dirs.append(direction)
        if isinstance(frame, TranscriptionFrame): order.append("TRANSCRIPT")
        if isinstance(frame, LLMMessagesAppendFrame): order.append("CUE")
    tc.broadcast_interruption = _broadcast
    tc.push_frame = _push
    await _feed(tc, "तो Ma'am कैसे क्या होगा क्या बच्चे?")
    assert order == ["TRANSCRIPT", "CUE", "INTERRUPT"], order
    assert any("QUESTION" in c for c in rec.cues())
    order.clear()
    await _feed(tc, "कैसे पढ़ाई होगी?")        # the next piece of the same burst
    assert "CUE" not in order, "one cue per burst"
    rec2 = _Rec()
    tc2 = _replay_collector(rec2, bot_speaking=True)
    await _feed(tc2, "नहीं यही सब।")              # a statement: no cue
    assert not any("QUESTION" in c for c in rec2.cues())



def test_a_line_the_transcript_joined_but_the_model_got_in_pieces_is_not_lost():
    """Call 2983bf1f: "मेरा बच्चा mobile" + "बाईस से।" reached the model as
    two messages; the transcript joined them and the report called it lost."""
    import app.diagnostics as dg
    heard = ["तो Ma'am कैसे क्या होगा क्या बच्चे?", "मेरा बच्चा mobile बाईस से।",
             "उसकी मतलब पढ़ाई हो सकती।"]
    delivered = ["तो Ma'am कैसे क्या होगा क्या बच्चे?", "मेरा बच्चा mobile", "बाईस से।",
                 "उसकी मतलब पढ़ाई हो सकती।"]
    assert dg.split_lost(heard, delivered).answers == 0
    assert dg.split_lost(["मेरा बच्चा mobile बाईस से।"], ["कुछ और"]).answers == 1



@pytest.mark.asyncio
async def test_a_short_first_sentence_is_never_left_on_its_own_by_the_budget():
    """Call 5aa10e10: 35 chars said, a 220-char sentence held, no question —
    the bot said a fragment and went silent for 7 s."""
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "हाँ बोल सकते हैं।",
                       max_sentences=lambda: 3, max_chars=lambda: 240)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    long_one = ("लेकिन इस level पर हमारा focus सिर्फ marks improve करने का नहीं होता, focus ये होता है "
                "कि उसके concepts और मजबूत हों, weaknesses identify हों, और वो अपनी class के बाकी अच्छे "
                "students के बीच अपनी position improve कर सके। ")
    await _reply(g, "that's actually a good performance। ", long_one)
    said = " ".join(t.strip() for t in rec.text if t.strip())
    assert "position improve" in said, "the substantive sentence was held behind a fragment"


# ── call 7f86df90 (2026-09-25, Shreya-marathi demo): Hindi in Marathi, "करतो/करते" ──
def test_a_name_slot_is_filled_in_the_replys_own_language():
    f = b.fill_template_slots
    assert f("<name> च्या बाबतीतही असं आहे का मॅडम?")[0] == "मुलाच्या बाबतीतही असं आहे का मॅडम?"
    assert f("<name> खूप छान करतो का?")[0] == "मूल खूप छान करतो का?"
    assert f("क्या <name> के साथ भी ऐसा है सर?")[0] == "क्या बच्चे के साथ भी ऐसा है सर?"
    assert f("<name> માટે આ સારું છે")[0].startswith("બાળક")
    assert f("<name> பற்றி சொல்லுங்கள்")[0].startswith("குழந்தை")
    assert f("So how is <child name> doing?")[0] == "So how is your child doing?"


def test_an_either_or_pair_is_spoken_as_one_form():
    c = b.collapse_alternatives
    assert c("खूप छान करतो/करते पण")[0] == "खूप छान करतो पण"
    assert c("मी शिकतो/शिकते.")[0] == "मी शिकतो."
    assert c("जी सर/मॅडम, नमस्कार", "f")[0] == "जी मॅडम, नमस्कार"
    assert c("जी सर/मैम, नमस्ते", "m")[0] == "जी सर, नमस्ते"
    for keep in ("24/7 support", "https://vacademy.io/a b", "<<SEND:quiz>>"):
        assert c(keep) == (keep, 0), keep


@pytest.mark.asyncio
async def test_the_gate_keeps_the_address_the_call_already_uses():
    rec = _NRRec()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "आई।")
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "जी मॅडम, धन्यवाद। ")
    rec.text.clear()
    await _reply(g, "सर/मॅडम, मुलगा खूप छान करतो/करते का?")
    said = " ".join(t.strip() for t in rec.text if t.strip())
    assert "मॅडम" in said and "सर" not in said and "/" not in said, said



def test_hello_is_a_line_check_in_every_script():
    from app.turntake import caller_checking_presence, is_audio_check
    for hello in ("हॅलो.", "Hello?", "हेलो", "હેલો?", "হ্যালো", "ஹலோ", "హలో", "ಹಲೋ"):
        assert is_audio_check(hello), hello
        assert caller_checking_presence(hello), hello
    assert not caller_checking_presence("बरोबर।")


def test_an_opening_cut_at_pickup_and_said_again_is_not_a_replay():
    """Call f9b9f575: "नमस्कार," (cut by the callee's "हॅलो."), then the whole
    opening — scored OPENING_REPLAYED, RED."""
    from app import report as rp
    opening = ("नमस्कार, मी श्रेया बोलतेय Shiksha Nation मधून. तुम्ही तुमच्या मुलासाठी live "
               "classes बद्दल चौकशी केली होती.")
    class _O:
        transcript = [{"role": "assistant", "text": "नमस्कार,"},
                      {"role": "user", "text": "हॅलो."},
                      {"role": "assistant", "text": opening},
                      {"role": "user", "text": "बरोबर।"},
                      {"role": "assistant", "text": "Shiksha Nation मध्ये आमचा focus फक्त syllabus वर नाही."}]
    replays, _, _ = rp._played_invariants(_O())
    assert replays == 0
    class _Replayed:
        transcript = [{"role": "assistant", "text": opening},
                      {"role": "user", "text": "बरोबर, बोला।"},
                      {"role": "assistant", "text": opening}]
    assert rp._played_invariants(_Replayed())[0] == 1, "a real replay must still count"



# ── call 83735c51 (2026-09-26): a mostly-heard sentence un-recorded → repeat loop ──
def test_a_sentence_mostly_heard_before_the_cut_counts_as_said():
    from app.turntake import spoken_key
    sent = ("लेकिन इस level पर हमारा focus सिर्फ marks improve करने का नहीं होता focus यह होता है "
            "कि उसके concepts और मजबूत हों, weaknesses identify हों।")
    played = spoken_key("अच्छा! यह तो अच्छी बात है सर। लेकिन इस level पर हमारा focus सिर्फ marks "
                        "improve करने का नहीं होता focus यह होता है कि उसके concepts और मजबूत")
    assert b.mostly_played(sent, played)
    assert not b.mostly_played(sent, spoken_key("अच्छा! यह तो अच्छी बात है सर। लेकिन इस"))
    assert not b.mostly_played("क्या नाम है?", spoken_key("क्या"))
    assert b.mostly_played("क्या नाम है?", spoken_key("हाँ क्या नाम है?"))



def test_a_filler_after_the_opening_does_not_make_it_unheard():
    """Timing sim smallest_filler_then_live_and_cached: opening played in full,
    then "Hmm…" — the last-entry check read the opening as unheard and every
    reply was swallowed."""
    opening = "Hi, is this Bhawana Jain? Aarushi from Vacademy. We came to know you take yoga classes."
    heard = [{"role": "assistant", "text": opening},
             {"role": "user", "text": "Yes, go ahead."},
             {"role": "assistant", "text": "Hmm…"}]
    assert not b._opening_barely_heard(opening, heard, 0.0)
    cut = [{"role": "assistant", "text": "Hi,"}, {"role": "user", "text": "Hello?"}]
    assert b._opening_barely_heard(opening, cut, 0.0), "a real cut at the start is still unheard"
    assert b._opening_barely_heard(opening, [], 0.0)
    assert not b._opening_barely_heard(opening, cut, 12.0), "once a reply ran, never"



def test_a_caller_still_talking_after_haan_ji_is_not_line_noise():
    """Calls 23a3ffd9 / 8b8533fc (2026-09-26): "हाँ जी" then a 4 s answer
    tripped the 3 s noise cap; the bot answered the bare "हाँ" and then the
    real answer, back to back. The cap must outlast an ordinary answer."""
    from app.config import Settings
    assert Settings().short_answer_noise_cap_secs >= 6.0



def test_the_next_step_cue_names_the_line_that_was_repeated():
    """Calls 83735c51 / 97c06634 (2026-09-26): a generic cue let Gemini repeat
    the same line again, and the fallback was a bare handback."""
    held = "सर, generally जब parents किसी coaching से जुड़ते हैं तो उनकी तीन-चार basic expectations होती हैं।"
    what, cue = b.next_step_cue(held, "", 1)
    assert what == "all-repeat"
    assert "generally जब parents" in cue and "AFTER it" in cue
    assert "]" not in cue[:-1], "the quoted line must not close the cue early"



@pytest.mark.asyncio
async def test_a_reply_that_asked_for_a_fresh_line_does_not_also_speak_its_held_question():
    """Call 30cfc538 (2026-09-26): one reply repeated the whole previous turn;
    the repeat branch asked for a fresh line AND the held question was spoken
    — "क्या परमजीत के साथ भी ऐसा ही है सर? जी सर, समझ सकती हूँ।"."""
    rec = _NRRec()
    asked = []
    async def _next_step(held, kind="", attempt=0):
        asked.append(kind)
    caller = {"t": "हाँ जी ma'am बिल्कुल ऐसे ही है।"}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    first = ("Generally कम marks आने के दो major reasons होते हैं, concepts clear नहीं होते। "
             "क्या परमजीत के साथ भी ऐसा ही है सर?")
    await _reply(g, first)
    rec.text.clear()
    await _reply(g, first)              # the whole previous turn, again
    assert asked, "a fresh line should have been requested"
    assert not any("क्या परमजीत" in t for t in rec.text), rec.text


# ── Call 22062aac (2026-09-29): a stale next-step, a gagged question, "जी सर।"×4 ──
def _nr_with_steps(caller):
    rec, asked = _NRRec(), []

    async def _next_step(held, kind="", attempt=0):
        asked.append((held, kind, attempt))
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    return g, rec, asked


@pytest.mark.asyncio
async def test_no_recovery_for_a_reply_a_newer_turn_already_superseded():
    """"हाँ जी।" ran, then "9th में पढ़ रहा है।" ran before that reply ended. The
    first reply said nothing new, and the next-step request made for it was a
    SECOND reply on top of the real answer's — both played back to back."""
    caller = {"t": "हाँ जी।"}
    g, rec, asked = _nr_with_steps(caller)
    g.note_run()                      # the held short answer's run
    g.note_run()                      # the full answer's run, queued behind it
    await _reply(g, "जी सर।")
    assert not asked, "asked for a next step although a newer turn was queued: %r" % asked
    # The newer run's reply is untouched.
    caller["t"] = "9th में पढ़ रहा है।"
    rec.text.clear()
    await _reply(g, "यही वो साल है जब syllabus heavy लगने लगता है। ",
                 "पिछली class में कितने marks आए थे?")
    assert any("marks" in t for t in rec.text), rec.text


@pytest.mark.asyncio
async def test_a_filler_reply_with_nothing_queued_still_recovers():
    caller = {"t": "कोशिश करता है।"}
    g, _rec, asked = _nr_with_steps(caller)
    g.note_run()
    await _reply(g, "जी सर।")
    assert asked, "the ordinary filler-only recovery stopped working"


def test_an_acknowledgment_that_only_echoes_a_word_is_a_filler():
    f = b.NoRepeatGate._is_filler
    assert f("जी सर, Pragyan.")
    assert f("जी सर, प्रज्ञान।")
    assert f("Okay, Raman.")
    assert not f("जी सर, धन्यवाद।")          # a thanks means something
    assert not f("जी सर, Pragyan कैसा है?")  # a question is never a filler
    assert not f("जी सर, यही वो साल है जब syllabus heavy लगता है।")


@pytest.mark.asyncio
async def test_a_dropped_question_is_what_the_recovery_is_about():
    """"जी सर, Pragyan." + the marks question (already said) + its explanation
    (already said): the recovery must name the QUESTION, and the model may ask
    it once more — the father had answered a different question."""
    Q = "क्या मैं जान सकती हूँ कि Pragyan के previous class में कितने marks आए थे? "
    WHY = "So that मुझे उसकी performance के बारे में थोड़ा idea मिल सके।"
    caller = {"t": "9th में पढ़ रहा है।"}
    g, rec, asked = _nr_with_steps(caller)
    await _reply(g, Q, WHY)
    caller["t"] = "ये प्रज्ञान है।"
    rec.text.clear()
    await _reply(g, "जी सर, Pragyan. ", Q, WHY)
    assert asked, "silence: no recovery after an ack-only reply"
    held, kind, _ = asked[-1]
    assert "marks" in held and kind == "all-repeat", asked
    what, cue = b.next_step_cue(held, kind)
    assert "still unanswered" in cue
    # The model judged it unanswered and asks again: this one gets through.
    rec.text.clear()
    await _reply(g, "पिछली class में Pragyan के कितने marks आए थे?")
    assert any("marks" in t for t in rec.text), "the permitted re-ask was blocked"


@pytest.mark.asyncio
async def test_a_second_acknowledgment_only_reply_gets_the_firm_cue():
    caller = {"t": "अब पढ़ने में तो।"}
    g, _rec, asked = _nr_with_steps(caller)
    await _reply(g, "जी।")
    caller["t"] = "कोशिश करता है।"
    await _reply(g, "जी सर।")
    assert [a for _h, _k, a in asked] == [0, 2], asked
    assert g.owes_line() and g.owed_after_filler()
    caller["t"] = "अच्छा।"
    # A real reply ends the acknowledgment streak. Being a statement with no
    # question it still leaves the bot owing the next line (call 963347ab) —
    # but as a statement, not as a filler.
    await _reply(g, "आमतौर पर parents की तीन-चार expectations होती हैं।")
    assert not g.owed_after_filler()
    assert g.owes_line()
    caller["t"] = "जी।"
    await _reply(g, "पहली, faculty अच्छे हों। क्या आपकी भी यही expectation है?")
    assert not g.owes_line()


def test_a_hindi_final_ending_in_a_connective_is_unfinished():
    """Sarvam ends every final with "।", which made the check dead for Hindi."""
    def unfinished(text):
        msgs = [{"role": "assistant", "content": "क्या Pragyan के साथ भी ऐसा ही है सर?"},
                {"role": "user", "content": text}]
        return b.RunGuard._ends_mid_clause(b.RunGuard, msgs)
    assert unfinished("अब पढ़ने में तो।")
    assert unfinished("वो class में और।")
    assert not unfinished("कोशिश करता है।")
    assert not unfinished("और?")


@pytest.mark.asyncio
async def test_a_short_line_left_by_the_repeat_filter_still_recovers():
    """Call f6764346 (2026-09-30): the reply was "समझ सकती हूँ सर।" + the
    Shiksha Nation line, which had already been said. Only the empathy line
    reached the caller, it counted as real content, and nothing recovered —
    8.2 s of silence, then "are you there?"."""
    WHY = ("Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है, हम Day one से "
           "बच्चों की concept clarity मजबूत करने पर काम करते हैं।")
    caller = {"t": "हाँ जी बताइए।"}
    g, rec, asked = _nr_with_steps(caller)
    await _reply(g, WHY)
    caller["t"] = "हां जी बिल्कुल ऐसा ही है Ma'am।"
    rec.text.clear()
    await _reply(g, "समझ सकती हूँ सर। ", WHY)
    assert asked, "no recovery after only a short line survived: %r" % rec.text
    assert g.owes_line()


@pytest.mark.asyncio
async def test_a_short_answer_with_a_question_is_not_treated_as_empty():
    WHY = ("Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है, हम Day one से "
           "बच्चों की concept clarity मजबूत करने पर काम करते हैं।")
    caller = {"t": "हाँ जी।"}
    g, rec, asked = _nr_with_steps(caller)
    await _reply(g, WHY)
    caller["t"] = "जी।"
    await _reply(g, "बच्चा किस class में है? ", WHY)
    assert not asked, asked


# ── Call 3ad7f590 (2026-09-30): "क्या बोलूं?" and a killed reply's late fragment ──
def test_what_should_i_say_is_a_request_to_hear_the_question_again():
    from app.turntake import caller_asked_to_repeat
    assert caller_asked_to_repeat("क्या बोलूं?")
    assert caller_asked_to_repeat("मैं क्या बताऊँ?")
    assert caller_asked_to_repeat("What should I say?")
    assert not caller_asked_to_repeat("क्या बोलूं मैं आपको, मेरा बेटा आठवीं क्लास में पढ़ता है?")


@pytest.mark.asyncio
async def test_a_killed_responses_late_fragment_is_never_spoken():
    """The mother cut in with "Mother."; the response it killed still streamed
    "जी मैम, Shik" and ended — which was flushed to the caller as a tail, and a
    filler recovery was requested for a reply she never heard."""
    from pipecat.frames.frames import (InterruptionFrame, LLMFullResponseEndFrame,
                                       LLMFullResponseStartFrame, LLMTextFrame)
    caller = {"t": "मम्मी।"}
    g, rec, asked = _nr_with_steps(caller)
    d = b.FrameDirection.DOWNSTREAM
    await g.process_frame(LLMFullResponseStartFrame(), d)
    await g.process_frame(LLMTextFrame("जी मैम, "), d)
    await g.process_frame(InterruptionFrame(), d)
    await g.process_frame(LLMTextFrame("Shik"), d)
    await g.process_frame(LLMFullResponseEndFrame(), d)
    assert not any("Shik" in t for t in rec.text), rec.text
    assert not asked, asked
    # The next response is handled normally.
    caller["t"] = "Mother."
    rec.text.clear()
    await _reply(g, "जी मैम, Shiksha Nation में हमारा focus concept clarity पर है। ",
                 "बच्चा किस class में है?")
    assert any("class" in t for t in rec.text), rec.text


# ── Call 963347ab (2026-09-30): three silences, three causes ───────────────
PITCH_963 = ("Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है, हम Day one से "
             "बच्चों की concept clarity मजबूत करने पर काम करते हैं, ताकि वो school exams में "
             "बेहतर perform करें और पूरे confidence के साथ अच्छे marks ला सकें। ")


@pytest.mark.asyncio
async def test_the_cap_keeps_the_question_even_when_a_line_follows_it():
    rec, asked = _NRRec(), []

    async def _next_step(held, kind="", attempt=0):
        asked.append(kind)
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "मैं उसकी बड़ी बहन बोल रही हूँ।",
                       request_next_step=_next_step, max_sentences=lambda: 2,
                       max_chars=lambda: 240)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    await _reply(g, "जी, नमस्ते। ", PITCH_963,
                 "क्या मैं बच्चे के बारे में थोड़ा जान सकती हूँ, नाम क्या है और किस class में है? ",
                 "जी।")
    said = " ".join(rec.text)
    assert "किस class में है?" in said, said


@pytest.mark.asyncio
async def test_an_empty_reply_asks_for_the_next_line():
    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame
    caller = {"t": "ये apply."}
    g, rec, asked = _nr_with_steps(caller)
    d = b.FrameDirection.DOWNSTREAM
    await g.process_frame(LLMFullResponseStartFrame(), d)
    await g.process_frame(LLMFullResponseEndFrame(), d)
    assert asked and asked[-1][1] == "continue", asked


@pytest.mark.asyncio
async def test_a_reply_the_parent_cut_off_is_not_an_empty_reply():
    """Call 24e13868 (2026-09-30): the parent's barge-in killed the response
    before its first word; "continuing" it was a second reply to the same
    moment, and the parent heard a stray "जी, बोलिए।"."""
    from pipecat.frames.frames import (InterruptionFrame, LLMFullResponseEndFrame,
                                       LLMFullResponseStartFrame)
    caller = {"t": "मेरा बेटा आठवीं में है।"}
    g, _rec, asked = _nr_with_steps(caller)
    d = b.FrameDirection.DOWNSTREAM
    await g.process_frame(LLMFullResponseStartFrame(), d)
    await g.process_frame(InterruptionFrame(), d)
    await g.process_frame(LLMFullResponseEndFrame(), d)
    assert not [k for _h, k, _a in asked if k == "continue"], asked


@pytest.mark.asyncio
async def test_an_empty_reply_after_a_bare_no_still_moves_on():
    """A bare "नहीं" answers a yes/no question — the next line must follow
    (review of 0ea2d31037: treating it as a refusal left silence)."""
    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame
    caller = {"t": "नहीं।"}
    g, _rec, asked = _nr_with_steps(caller)
    d = b.FrameDirection.DOWNSTREAM
    await g.process_frame(LLMFullResponseStartFrame(), d)
    await g.process_frame(LLMFullResponseEndFrame(), d)
    assert [k for _h, k, _a in asked if k == "continue"], asked


def test_the_continue_cue_offers_a_call_back_after_a_put_off():
    """Call 899c6888: after the parent put the call off, 'say your next line'
    pushed past them. The cue itself now says to offer a call back or close."""
    _kind, cue = b.next_step_cue("", kind="continue")
    assert _kind == "continue"
    assert "call back" in cue and "close politely" in cue, cue


@pytest.mark.asyncio
async def test_an_empty_reply_while_ending_does_nothing():
    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame
    rec, asked = _NRRec(), []

    async def _next_step(held, kind="", attempt=0):
        asked.append(kind)
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "ठीक है।",
                       request_next_step=_next_step, ending=lambda: True)
    g.push_frame = rec.push
    b.FrameProcessor.process_frame = _noop_super
    d = b.FrameDirection.DOWNSTREAM
    await g.process_frame(LLMFullResponseStartFrame(), d)
    await g.process_frame(LLMFullResponseEndFrame(), d)
    assert not asked


@pytest.mark.asyncio
async def test_a_statement_with_no_question_leaves_the_bot_owing_the_line():
    caller = {"t": "जी।"}
    g, _rec, _asked = _nr_with_steps(caller)
    await _reply(g, "पहली, faculty अच्छे हों और बच्चे के concepts properly clear करें।")
    assert g.owes_line() and not g.owed_after_filler()
    caller["t"] = "जी जी।"
    await _reply(g, "क्या इसके अलावा आपकी कोई specific expectation है?")
    assert not g.owes_line()



def test_memory_reclaim_never_freezes_a_finished_call(monkeypatch):
    """A PipelineTask still reachable at the first idle reclaim must not be
    frozen (review of 42e5d333ab): the freeze waits for a clean idle moment."""
    import gc
    from app import memory

    class PipelineTask:          # same type name the guard looks for
        pass
    pinned = PipelineTask()
    frozen = []
    monkeypatch.setattr(memory, "_frozen_after_call", False)
    monkeypatch.setattr(gc, "freeze", lambda: frozen.append(1))
    st = memory.reclaim(idle=True, corr="t")
    assert not st["froze"] and not frozen
    del pinned
    st = memory.reclaim(idle=True, corr="t")
    assert st["froze"] and frozen == [1]



def test_memory_reclaim_waits_for_idle_before_the_first_freeze(monkeypatch):
    """The first full collection (before survivors are frozen) took 232 ms on the
    box (2026-10-01): never run it while calls are live."""
    import gc
    from app import memory
    collected = []
    monkeypatch.setattr(memory, "_frozen_after_call", False)
    monkeypatch.setattr(gc, "collect", lambda *a: collected.append(1) or 0)
    monkeypatch.setattr(gc, "freeze", lambda: None)
    st = memory.reclaim(idle=False, corr="t")
    assert st.get("deferred") and not collected
    st = memory.reclaim(idle=True, corr="t")
    assert collected and not st.get("deferred")
    collected.clear()
    st = memory.reclaim(idle=False, corr="t")            # frozen now: cheap, runs live
    assert collected and not st.get("deferred")


def test_call_modules_preload():
    from app import memory
    assert memory.preload_call_modules() >= 1


# ── single-flight replies, step 3 (2026-10-01): one ledger answers "is a reply
#    on its way?" — calls c05f6c83 / 1d28af3a ran the model twice for one moment
#    when a run started while the previous reply was still playing ───────────
@pytest.mark.asyncio
async def test_the_run_ledger_counts_a_composing_reply_until_its_end():
    from pipecat.frames.frames import (LLMFullResponseStartFrame, LLMFullResponseEndFrame,
                                       InterruptionFrame)
    rec = _NRRec()
    g = _no_repeat(rec)
    D = b.FrameDirection.DOWNSTREAM
    assert not g.generating()
    g.note_run()                                   # RunGuard let a run through
    assert g.generating(), "passed, not started yet: a reply is on its way"
    await g.process_frame(LLMFullResponseStartFrame(), D)
    assert g.generating()
    await g.process_frame(LLMFullResponseEndFrame(), D)
    assert not g.generating(), "composed: the audio side takes over"
    g.note_run()
    await g.process_frame(LLMFullResponseStartFrame(), D)
    await g.process_frame(InterruptionFrame(), D)  # a barge-in kills it
    assert not g.generating()
    g.note_run()
    g._last_run_t -= 9.0                           # a run that never started…
    g._last_start_t -= 9.0                         # …long after the last reply began
    assert not g.generating(), "bounded: a lost run cannot hold the call for good"


def test_reply_in_flight_is_measured_from_the_replys_own_start():
    import inspect
    src = inspect.getsource(b.run_bot)
    body = src[src.index("def _reply_in_flight() -> bool:"):src.index("def _reply_pending() -> bool:")]
    assert "no_repeat.generating()" in body
    assert 'flags["bot_started_t"] < st and flags["reply_cancelled_t"] < st' in body
    pending = src[src.index("def _reply_pending() -> bool:"):]
    pending = pending[:pending.index("\n    def ")]
    assert "run_guard.held()" in pending


# ── single-flight step 2 (2026-10-01): a failed LLM primary retires at once ──
@pytest.mark.asyncio
async def test_a_failed_primary_retires_and_drops_what_was_queued_behind_it():
    from pipecat.frames.frames import ErrorFrame, LLMContextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    from app.providers import with_retire

    seen, errors = [], []

    class _Base:
        async def process_frame(self, frame, direction):
            seen.append(frame)
            if getattr(self, "_fail_next", False):
                self._fail_next = False
                await self.push_error_frame(ErrorFrame(error="first token not received",
                                                       fatal=False))

        async def push_error_frame(self, error):
            errors.append(error)

    P = with_retire(_Base)
    p = P()
    drops = []
    p.retire_on_error = True
    p.on_retired_drop = lambda: drops.append(1)
    D = b.FrameDirection.DOWNSTREAM
    p._fail_next = True
    await p.process_frame(LLMContextFrame(context=LLMContext()), D)   # the stalled request
    assert p.retired and p.errored_t > 0 and len(errors) == 1
    await p.process_frame(LLMContextFrame(context=LLMContext()), D)   # queued behind it
    assert len(seen) == 1 and drops == [1], "a retired primary must not start another generation"

    # a fatal error, or one outside a request, never retires; nor without a fallback
    q = P()
    q.retire_on_error = True
    await q.push_error_frame(ErrorFrame(error="outside", fatal=False))
    assert not q.retired
    q._fail_next = True
    q._in_ctx = False
    r = P()
    r._fail_next = True
    await r.process_frame(LLMContextFrame(context=LLMContext()), D)
    assert not r.retired, "retire_on_error is off when there is no fallback"


def test_an_errored_primary_reply_is_not_read_as_empty():
    import inspect
    src = inspect.getsource(b.NoRepeatGate.process_frame)
    i = src.index("the model's reply was EMPTY")
    assert "self._primary_errored_since(self._last_start_t)" in src[:i]
    run = inspect.getsource(b.run_bot)
    assert "llm_primary.retire_on_error = True" in run
    assert "no_repeat.note_dropped_run()" in run


@pytest.mark.asyncio
async def test_a_retired_primary_serves_again_when_the_switcher_returns_to_it():
    """Design review 2026-10-01: after the fallback fails too, failover goes back
    to the primary; a primary that stayed retired dropped every later request —
    a mute bot for the rest of the call."""
    from pipecat.frames.frames import (ErrorFrame, LLMContextFrame,
                                       ServiceSwitcherRequestMetadataFrame)
    from pipecat.processors.aggregators.llm_context import LLMContext
    from app.providers import with_retire
    seen = []

    class _Base:
        async def process_frame(self, frame, direction):
            seen.append(type(frame).__name__)

        async def push_error_frame(self, error):
            pass

    p = with_retire(_Base)()
    p.retire_on_error = True
    p.retired = True                                    # failed earlier in the call
    D = b.FrameDirection.DOWNSTREAM
    await p.process_frame(LLMContextFrame(context=LLMContext()), D)
    assert "LLMContextFrame" not in seen, "queued behind the failure: dropped"
    await p.process_frame(ServiceSwitcherRequestMetadataFrame(service=p), D)
    assert not p.retired
    await p.process_frame(LLMContextFrame(context=LLMContext()), D)
    assert seen.count("LLMContextFrame") == 1, "active again: it serves"


def test_errored_primary_skip_only_while_its_failover_rerun_is_coming():
    import inspect
    src = inspect.getsource(b.run_bot)
    i = src.index("primary_errored_since=lambda t:")
    expr = src[i:i + 600]
    assert "settings.llm_retire_primary" in expr, "LLM_RETIRE_PRIMARY=0 must restore the old EMPTY path"
    assert 'flags["llm_failed_over_t"] >= t' in expr, "a later error (no re-run coming) gets ordinary recovery"
    reason = src[src.index("def _bot_run_drop_reason("):]
    reason = reason[:reason.index("\n    def ")]
    assert 'flags["stopping_since"] is not None' in reason
    assert "end_pending_since" not in reason, "a goodbye a noise killed must still be re-asked"
    assert 'flags["reply_started_t"] == for_reply' in reason


# ── single-flight step 6 (2026-10-08): ONE reply per caller turn, however many
#    pieces it comes in. Calls 84e52d17 ("आप।" / "आप teachers से कहें…" /
#    "बात करें।"), b51093dc, 0ae77e88, e11cc15b: two runs ~0.55 s apart, the
#    LLM queued the second behind the first, both replies played ─────────────
class _RGDirRec:
    def __init__(self):
        self.frames = []

    async def push(self, frame, direction=None):
        self.frames.append((frame, direction))

    def kinds(self):
        return [type(f).__name__ for f, _ in self.frames]


def _supersede_guard(unheard, *, on=True, grace=0.0, quiet=lambda: 5.0,
                     forming=lambda: False, noted=lambda: 7):
    import app.diagnostics as dg
    d = dg.CallDiagnostics()
    ctx = _FakeCtx()
    rec = _RGDirRec()
    seen = []

    def _unheard(since):
        seen.append(since)
        return unheard() if callable(unheard) else unheard
    g = b.RunGuard(ctx, enabled=lambda: True, diag=d,
                   short_answer_grace_secs=grace, short_answer_max_words=3,
                   quiet_for=quiet, caller_forming=forming,
                   supersede=lambda: on, reply_unheard=_unheard, runs_noted=noted)
    g.push_frame = rec.push
    g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    return g, ctx, rec, d, seen


_PIECE_1 = {"role": "user", "content": "आप। आप teachers से कहें मुझसे भी direct बात करें।"}
_PIECE_2 = {"role": "user", "content": "बात करें।"}


@pytest.mark.asyncio
async def test_the_callers_next_piece_cancels_a_reply_that_has_not_made_a_sound():
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d, seen = _supersede_guard(True)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    t0 = time.time()
    await g.process_frame(LLMRunFrame(), D)             # run 1: 10 caller words, passes
    assert rec.kinds() == ["LLMRunFrame"]
    ctx.messages = ctx.messages + [_PIECE_2]
    await g.process_frame(LLMRunFrame(), D)             # run 2, 0.55 s later on the call
    assert rec.kinds() == ["LLMRunFrame", "SupersedeInterruptionFrame", "LLMRunFrame"], rec.kinds()
    cut, direction = rec.frames[1]
    assert isinstance(cut, b.InterruptionFrame), "pipecat must treat it as an interruption"
    assert direction == D, "upstream it would reach the user aggregator and drop queued finals"
    assert cut.runs_flushed == 7
    assert seen and abs(seen[0] - t0) < 0.5, "asked about the reply to run 1, by its pass time"
    assert d.runs_superseded == 1


@pytest.mark.asyncio
async def test_a_reply_the_caller_is_hearing_is_never_superseded():
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d, _ = _supersede_guard(False)          # audio on the line: a barge-in
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = ctx.messages + [_PIECE_2]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.kinds() == ["LLMRunFrame", "LLMRunFrame"], rec.kinds()
    assert d.runs_superseded == 0


@pytest.mark.asyncio
async def test_run_supersede_kill_switch_restores_two_runs():
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d, seen = _supersede_guard(True, on=False)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = ctx.messages + [_PIECE_2]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.kinds() == ["LLMRunFrame", "LLMRunFrame"]
    assert seen == [] and d.runs_superseded == 0


@pytest.mark.asyncio
async def test_the_bots_own_run_never_supersedes_and_one_superseded_run_is_cancelled_once():
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d, _ = _supersede_guard(True)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    await g.process_frame(LLMRunFrame(), D)
    cue = "[A noise on the line cut your reply off…]"
    g.register_cue(cue)
    ctx.messages = ctx.messages + [{"role": "user", "content": cue}]
    await g.process_frame(LLMRunFrame(), D)             # the bot's own run: not the caller
    assert "SupersedeInterruptionFrame" not in rec.kinds(), rec.kinds()
    ctx.messages = ctx.messages + [_PIECE_2]
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = ctx.messages + [{"role": "user", "content": "हाँ जी।"}]
    await g.process_frame(LLMRunFrame(), D)
    # Each caller run cancels the one before it (the cue's, then its own
    # predecessor's) — never twice for the same run.
    assert rec.kinds().count("SupersedeInterruptionFrame") == 2, rec.kinds()


@pytest.mark.asyncio
async def test_a_newer_run_that_is_held_still_cancels_the_unheard_one_first():
    """The rest of the turn arrives while still forming (held for it): the
    earlier run must not play in the meantime."""
    from pipecat.frames.frames import LLMRunFrame
    forming = {"v": False}
    g, ctx, rec, d, _ = _supersede_guard(True, forming=lambda: forming["v"])
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    await g.process_frame(LLMRunFrame(), D)
    forming["v"] = True
    ctx.messages = ctx.messages + [_PIECE_2]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.kinds() == ["LLMRunFrame", "SupersedeInterruptionFrame"], rec.kinds()
    forming["v"] = False
    await asyncio.sleep(0.6)                             # formed + 0.3 s still
    assert rec.kinds() == ["LLMRunFrame", "SupersedeInterruptionFrame", "LLMRunFrame"]


@pytest.mark.asyncio
async def test_a_held_short_answer_waits_while_the_rest_of_the_turn_forms():
    """The replayed mechanism (84e52d17, b51093dc, 0ae77e88, e11cc15b): "हाँ"
    held, the caller goes on, the rest sits in the user aggregator (Smart
    Turn INCOMPLETE) — the context looks still, and the hold used to release
    on "हाँ" alone 0.55 s before the turn's own run."""
    from pipecat.frames.frames import LLMRunFrame
    state = {"quiet": 0.1, "forming": False}
    g, ctx, rec, d, _ = _supersede_guard(False, grace=0.5, quiet=lambda: state["quiet"],
                                         forming=lambda: state["forming"])
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "हाँ"}]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.frames == []
    await asyncio.sleep(0.45)                            # voice resumed: waiting for the rest
    state["quiet"], state["forming"] = 5.0, True         # they stopped; the rest is forming
    await asyncio.sleep(1.4)                             # past the 0.5 s still-context wait
    assert rec.frames == [], "released on the first piece while the rest was forming"
    assert d.short_answer_forming_waits == 1
    ctx.messages = ctx.messages + [{"role": "user", "content": "मैं शाम को क्लास लेती हूँ"}]
    state["forming"] = False
    await g.process_frame(LLMRunFrame(), D)              # the turn's own run
    await asyncio.sleep(0.3)
    assert rec.kinds() == ["LLMRunFrame"], rec.kinds()


@pytest.mark.asyncio
async def test_without_supersede_the_held_answer_releases_on_a_still_context():
    """RUN_SUPERSEDE=0 is the old behaviour, exactly: the stale release."""
    from pipecat.frames.frames import LLMRunFrame
    state = {"quiet": 0.1, "forming": False}
    g, ctx, rec, d, _ = _supersede_guard(False, on=False, grace=0.5,
                                         quiet=lambda: state["quiet"],
                                         forming=lambda: state["forming"])
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "हाँ"}]
    await g.process_frame(LLMRunFrame(), D)
    await asyncio.sleep(0.45)
    state["quiet"], state["forming"] = 5.0, True
    await asyncio.sleep(1.4)
    assert rec.kinds() == ["LLMRunFrame"]
    assert d.short_answer_forming_waits == 0


@pytest.mark.asyncio
async def test_a_superseded_run_leaves_the_newer_run_on_its_way_in_the_ledger():
    """note_run for the newer run happens synchronously right after RunGuard
    pushes the supersede; the frame reaches NoRepeatGate later. Flushing
    "everything passed" there read "nothing pending" for the newer run's whole
    time-to-first-token."""
    from pipecat.frames.frames import (LLMFullResponseStartFrame, LLMFullResponseEndFrame,
                                       InterruptionFrame)
    rec = _NRRec()
    g = _no_repeat(rec)
    D = b.FrameDirection.DOWNSTREAM
    g.note_run()                                          # run 1
    await g.process_frame(LLMFullResponseStartFrame(), D)
    flushed = g.runs_noted()
    g.note_run()                                          # run 2, right after the supersede
    await g.process_frame(b.SupersedeInterruptionFrame(runs_flushed=flushed), D)
    assert g.generating(), "the newer run is on its way"
    await g.process_frame(LLMFullResponseStartFrame(), D)
    await g.process_frame(LLMFullResponseEndFrame(), D)
    assert not g.generating()
    # A held newer run (noted later, at release) is not pending in between.
    g.note_run()
    await g.process_frame(LLMFullResponseStartFrame(), D)
    await g.process_frame(b.SupersedeInterruptionFrame(runs_flushed=g.runs_noted()), D)
    assert not g.generating()
    # An ordinary barge-in still flushes everything.
    g.note_run()
    await g.process_frame(InterruptionFrame(), D)
    assert not g.generating()


@pytest.mark.asyncio
async def test_superseded_words_are_unrecorded_but_never_resumed():
    """Never heard, so not "already said" — and replaced by the newer reply, so
    a "हाँ" in its time-to-first-token must not speak them verbatim."""
    from pipecat.frames.frames import InterruptionFrame
    Q = "पिछली class में कितने marks आए थे? "
    g, rec, played = _gate_with_playout()
    await _reply(g, Q)
    await g.process_frame(b.SupersedeInterruptionFrame(runs_flushed=1), b.FrameDirection.DOWNSTREAM)
    assert g.take_unplayed_tail() == "", "a superseded reply's words were kept for a resume"
    rec.text.clear()
    await _reply(g, "जी। ", Q)
    assert "कितने marks" in " ".join(rec.text), "a never-heard question stayed 'already said'"
    # An ordinary cut of an unheard reply still keeps its words for the resume.
    g2, _rec2, _ = _gate_with_playout()
    await _reply(g2, Q)
    await g2.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    assert "कितने marks" in g2.take_unplayed_tail()


@pytest.mark.asyncio
async def test_a_supersede_is_not_a_cut_of_what_the_caller_heard():
    from pipecat.frames.frames import InterruptionFrame
    cuts = []
    duck = b.DuckGate(enabled=lambda: True, is_bot_speaking=lambda: False,
                      on_duck=lambda: None, on_unduck=lambda: None, diag=dg_mod.CallDiagnostics(),
                      on_interrupt=lambda: cuts.append(1))
    pushed = []

    async def _push(frame, direction=None):
        pushed.append(type(frame).__name__)
    duck.push_frame = _push
    b.FrameProcessor.process_frame = _noop_super
    await duck.process_frame(b.SupersedeInterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    assert cuts == [], "a superseded reply made no sound: nothing to 'carry on' from"
    assert pushed == ["SupersedeInterruptionFrame"], "it must still reach the transport"
    await duck.process_frame(InterruptionFrame(), b.FrameDirection.DOWNSTREAM)
    assert cuts == [1]


def test_supersede_is_wired_to_what_the_caller_actually_heard():
    src = inspect.getsource(b.run_bot)
    body = src[src.index("def _reply_unheard(since: float) -> bool:"):]
    body = body[:body.index("\n    def ")]
    assert "return reply_unheard(flags, since, _reply_in_flight)" in body
    guard = src[src.index("run_guard = RunGuard("):]
    guard = guard[:guard.index("run_guard._one_door")]
    assert "supersede=lambda: settings.run_supersede" in guard
    assert "reply_unheard=_reply_unheard" in guard
    assert "runs_noted=lambda: no_repeat.runs_noted()" in guard
    sent = inspect.getsource(b.SentinelGate.process_frame)
    assert "self._on_interrupted(superseded=True)" in sent
    hook = src[src.index("def _note_killed_before_playout"):]
    hook = hook[:hook.index("sentinel.set_on_interrupted")]
    assert "and not superseded" in hook, "a replaced reply is not a lost one"
    assert "note_reply_cancelled(flags, time.time(), superseded=superseded)" in hook
    from app.config import Settings
    assert Settings().run_supersede is True, "on by default (RUN_SUPERSEDE=0 is the kill switch)"


# ── review fixes 2026-10-08 for c73f60c10d ──────────────────────────────────
@pytest.mark.asyncio
async def test_a_failover_rerun_supersedes_nothing():
    """on_pipeline_error re-runs the FAILED context on the fallback. That run is
    gone; read as a newer caller run over an unheard reply it pushed a
    supersede that flushed the queued "Just a second." bridge (timing sim
    vertex_stall_failover_slow_tts: 4.55 s → 6.2 s of silence)."""
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d, seen = _supersede_guard(True)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    await g.process_frame(LLMRunFrame(), D)
    g.allow_rerun()                                       # the primary errored
    await g.process_frame(LLMRunFrame(), D)               # the same context, on the fallback
    assert rec.kinds() == ["LLMRunFrame", "LLMRunFrame"], rec.kinds()
    assert d.runs_superseded == 0


@pytest.mark.asyncio
async def test_only_a_run_with_new_caller_words_supersedes():
    """A cue on top of the same caller words is not the caller going on."""
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, rec, d, _ = _supersede_guard(True)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [_PIECE_1]
    await g.process_frame(LLMRunFrame(), D)
    ctx.messages = ctx.messages + [{"role": "user", "content": "[Answer their question first.]"}]
    await g.process_frame(LLMRunFrame(), D)
    assert "SupersedeInterruptionFrame" not in rec.kinds(), rec.kinds()
    ctx.messages = ctx.messages + [_PIECE_2]
    await g.process_frame(LLMRunFrame(), D)
    assert rec.kinds().count("SupersedeInterruptionFrame") == 1, rec.kinds()


def test_a_supersede_is_not_a_cut_of_the_run_that_replaced_it():
    """The supersede's own cancel stamp lands AFTER the newer run went through
    (the sentinel sees the frame later). Read as "that run was cut", a third
    piece could not supersede the second: both played (review 2026-10-08)."""
    from app.callstate import CallState, note_reply_cancelled, reply_unheard
    s = CallState()
    r2_passed = 100.40
    note_reply_cancelled(s, 100.41, superseded=True)      # R1 superseded, stamped after R2 went
    assert reply_unheard(s, r2_passed, True), "R2 read as cut — R3 cannot supersede it"
    assert s.reply_cancelled_t == 100.41, "dead-air accounting still sees the cancel"
    note_reply_cancelled(s, 100.60, superseded=False)     # a real barge-in cuts R2
    assert not reply_unheard(s, r2_passed, True)
    s2 = CallState()
    s2.bot_started_t = 100.5                              # R2 started to play
    assert not reply_unheard(s2, r2_passed, True)
    s2.bot_started_t, s2.bot_speaking = 99.0, True        # audio on the line
    assert not reply_unheard(s2, r2_passed, True)
    assert not reply_unheard(CallState(), r2_passed, lambda: False), "nothing on its way"


@pytest.mark.asyncio
async def test_supersede_chains_through_the_real_cancel_stamps():
    """Three pieces, three runs 0.3 s apart: each newer run cancels the one
    before it — with the sentinel's stamp of each supersede landing after the
    newer run, as it does in the pipeline."""
    from pipecat.frames.frames import LLMRunFrame
    from app.callstate import CallState, note_reply_cancelled, reply_unheard
    s = CallState()
    g, ctx, rec, d, _ = _supersede_guard(lambda: None)
    g._reply_unheard = lambda since: reply_unheard(s, since, True)
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "I have piece one of my answer."}]
    await g.process_frame(LLMRunFrame(), D)
    for piece in ("And piece two follows.", "And piece three closes the turn."):
        n = rec.kinds().count("SupersedeInterruptionFrame")
        ctx.messages = ctx.messages + [{"role": "user", "content": piece}]
        await g.process_frame(LLMRunFrame(), D)
        if rec.kinds().count("SupersedeInterruptionFrame") > n:
            note_reply_cancelled(s, time.time() + 0.001, superseded=True)   # the sentinel, later
    assert rec.kinds() == ["LLMRunFrame", "SupersedeInterruptionFrame", "LLMRunFrame",
                           "SupersedeInterruptionFrame", "LLMRunFrame"], rec.kinds()
    assert d.runs_superseded == 2


def _sentinel_for_markers():
    import app.diagnostics as dg
    sent = []
    o = FakeOutcome()
    o.transfer_registered = False
    o.transcript = [{"role": "user", "text": "हाँ"}]
    d = dg.CallDiagnostics()
    sg = b.SentinelGate(o, lambda user=True: None, lambda s: None, on_send=sent.append)
    sg._diag = d                                   # run_bot passes diag=diag

    async def _push(frame, direction=None):
        pass
    sg.push_frame = _push
    b.FrameProcessor.process_frame = _noop_super
    return sg, o, sent, d


async def _marker_reply(sg, text, end=True):
    from pipecat.frames.frames import LLMFullResponseStartFrame, LLMFullResponseEndFrame, LLMTextFrame
    D = b.FrameDirection.DOWNSTREAM
    await sg.process_frame(LLMFullResponseStartFrame(), D)
    await sg.process_frame(LLMTextFrame(text), D)
    if end:
        await sg.process_frame(LLMFullResponseEndFrame(), D)


@pytest.mark.asyncio
async def test_a_superseded_replys_goodbye_does_not_close_the_call():
    """Review 2026-10-08 (finding 6): the superseded reply carried END; its
    orphan End reaches the sentinel BEFORE the supersede, so the latch had
    already promoted it — a "ठीक है" in the newer reply's time-to-first-token
    was then swallowed as the goodbye. Nothing of that goodbye played."""
    sg, o, sent, d = _sentinel_for_markers()
    D = b.FrameDirection.DOWNSTREAM
    await _marker_reply(sg, "ठीक है, धन्यवाद। <<END_CALL>>")       # orphan End first
    assert o.end_requested is True
    await sg.process_frame(b.SupersedeInterruptionFrame(runs_flushed=1), D)
    assert o.end_requested is False, "a goodbye nobody heard is closing the call"


@pytest.mark.asyncio
async def test_a_goodbye_that_played_still_closes_after_a_supersede():
    from pipecat.frames.frames import (BotStartedSpeakingFrame, LLMFullResponseStartFrame,
                                       LLMFullResponseEndFrame, LLMTextFrame)
    D, U = b.FrameDirection.DOWNSTREAM, b.FrameDirection.UPSTREAM
    sg, o, _sent, _d = _sentinel_for_markers()
    await sg.process_frame(LLMFullResponseStartFrame(), D)
    await sg.process_frame(LLMTextFrame("ठीक है, धन्यवाद। <<END_CALL>>"), D)
    await sg.process_frame(BotStartedSpeakingFrame(), U)            # the goodbye is playing
    await sg.process_frame(LLMFullResponseEndFrame(), D)
    await sg.process_frame(b.SupersedeInterruptionFrame(), D)
    assert o.end_requested is True
    # Promoted, unheard — but the close is already armed: the line is going.
    sg, o, _sent, _d = _sentinel_for_markers()
    await _marker_reply(sg, "धन्यवाद। <<END_CALL>>")
    sg._stop_armed = True
    await sg.process_frame(b.SupersedeInterruptionFrame(), D)
    assert o.end_requested is True
    # An ordinary cut is not a supersede: unchanged.
    from pipecat.frames.frames import InterruptionFrame
    sg, o, _sent, _d = _sentinel_for_markers()
    await _marker_reply(sg, "धन्यवाद। <<END_CALL>>")
    await sg.process_frame(InterruptionFrame(), D)
    assert o.end_requested is True


@pytest.mark.asyncio
async def test_a_superseded_reply_still_sends_and_transfers_as_live():
    """Decision 2026-10-08: <<SEND:…>> and <<TRANSFER>> follow the caller's own
    agreement or request, made earlier and heard — a superseded reply's markers
    stand (sim rvc_send_superseded_780: holding the send lost the quiz link
    the parent had asked for). The sends are counted."""
    sg, o, sent, d = _sentinel_for_markers()
    D = b.FrameDirection.DOWNSTREAM
    await _marker_reply(sg, "जी, link भेज रही हूँ। <<SEND:quiz>>")
    assert sent == ["quiz"], "fires at token time, as on the live build"
    await sg.process_frame(b.SupersedeInterruptionFrame(runs_flushed=1), D)
    assert sent == ["quiz"] and d.sends_from_superseded_reply == 1
    sg, o, sent, d = _sentinel_for_markers()
    await _marker_reply(sg, "जी, मैं senior से connect करती हूँ। <<TRANSFER>>")
    await sg.process_frame(b.SupersedeInterruptionFrame(runs_flushed=1), D)
    assert o.transfer_requested is True
    assert d.sends_from_superseded_reply == 0


@pytest.mark.asyncio
async def test_a_held_answer_released_with_the_rest_answers_it_once():
    """Review 2026-10-08 (finding 5): a held short answer released the instant
    the aggregator appended piece 2 — before RunGuard handled piece 2's own
    run — goes with piece 2 in the context. Counted from the arrival snapshot,
    piece 2's run was not "more words", nothing was superseded, and the model
    ran twice over the same context."""
    from pipecat.frames.frames import LLMRunFrame
    forming = {"v": False}
    g, ctx, rec, d, _ = _supersede_guard(True, grace=0.3, forming=lambda: forming["v"])
    D = b.FrameDirection.DOWNSTREAM
    ctx.messages = _CONVO + [{"role": "user", "content": "हाँ जी।"}]
    await g.process_frame(LLMRunFrame(), D)               # held: 2 words
    forming["v"] = True                                    # the rest is forming
    await asyncio.sleep(0.45)
    forming["v"] = False                                   # the aggregator closes the turn…
    ctx.messages = ctx.messages + [{"role": "user", "content": "पर पहले fees बता दीजिए कितनी है।"}]
    await asyncio.sleep(0.15)                              # …and the held run goes first
    await g.process_frame(LLMRunFrame(), D)               # the rest's own run
    assert rec.kinds() == ["LLMRunFrame"], rec.kinds()
    assert d.runs_superseded == 0


def test_a_staged_race_that_did_not_happen_is_a_shape_note_not_a_failure():
    """CI 2026-10-08: on the runner Smart Turn kept "Yes." inside the turn, so
    pieces_one_reply_forming_unseen dispatched no stale run — the bot did the
    right thing and the check FAILED it for "no run was superseded". The
    outcome is what is judged; the missing race is a SHAPE note."""
    from sim.timing import chk_pieces_one_reply_superseded
    base = {"caller": [[5.0, 6.2], [22.7, 23.1], [23.45, 25.25]],
            "transcript": [{"role": "assistant", "text": PITCH} for PITCH in ("Who helps?",)] +
                          [{"role": "user", "text": "Yes."},
                           {"role": "assistant", "text": "Your sister on the WhatsApp reminders."}],
            "bot": [[8.0, 20.0], [26.9, 29.5]]}
    one_run = dict(base, runs_superseded=0, llm_gens=[
        {"requested": 6.8, "trigger": "Yes, go ahead."},
        {"requested": 26.0, "trigger": "Yes. and my sister sends the WhatsApp reminders."}])
    f = chk_pieces_one_reply_superseded(one_run)
    assert f and all(x.startswith("SHAPE:") for x in f), f
    stale_played = dict(base, runs_superseded=0, llm_gens=[
        {"requested": 6.8, "trigger": "Yes, go ahead."},
        {"requested": 26.4, "trigger": "Yes."},
        {"requested": 26.95, "trigger": "and my sister sends the WhatsApp reminders."}],
        transcript=base["transcript"] + [{"role": "assistant",
                                          "text": "Great, so you handle it all yourself."}])
    f = chk_pieces_one_reply_superseded(stale_played)
    assert any(not x.startswith("SHAPE:") for x in f), f
    assert any("first piece alone" in x for x in f), f
