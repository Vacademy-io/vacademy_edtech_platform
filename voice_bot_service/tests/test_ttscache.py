"""TTS speech cache — the pure parts, which is nearly all of the risk.

The dangerous failures here are not "the cache missed". They are:
  * serving audio that does not match the words (a key that is too loose),
  * caching half a sentence (a fragment that got laddered),
  * learning from a call the caller never actually heard,
  * playing sentence 3 before sentence 2.

Every one of those is decidable from state alone, so it is tested here rather
than discovered on a live call.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import ttscache                                            # noqa: E402
from app.ttscache import (SAMPLE_RATE, SAMPLE_WIDTH, Candidate, CallCandidates,
                          SpeechCache, TtsTurnWatcher, cache_key, is_async_arrival,
                          is_complete, owns_turn_brackets,
                          agent_allowed, mode_allows, MODE_OFF, MODE_FIXED,
                          MODE_FULL)                              # noqa: E402


def _key(text, **over):
    args = dict(engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
                temperature=0.5, sample_rate=SAMPLE_RATE, term_map_version="",
                text=text, salt="test")
    args.update(over)
    return cache_key(**args)


# ── the core product requirement ────────────────────────────────────────────

def test_one_character_difference_is_a_different_key():
    """THE requirement: anything but a byte-exact match goes to the vendor.

    If this ever passes by accident — a normalisation creeping into cache_key,
    a case-fold, a whitespace collapse — the cache starts speaking words that
    are not the words it was asked for.
    """
    a = _key("Aapka din shubh ho.")
    b = _key("Aapka din shubh ho!")
    c = _key("aapka din shubh ho.")
    d = _key("Aapka din  shubh ho.")     # two spaces
    assert len({a, b, c, d}) == 4


def test_gender_variants_are_distinct_entries():
    """sir/ma'am and the gendered Hindi verb forms are different strings, so they
    must land on different keys with no special handling."""
    assert _key("Main aapko bata rahi hoon.") != _key("Main aapko bata raha hoon.")
    assert _key("Aap kaise hain?") != _key("Aap kaisi hain?")
    assert _key("Ji sir, samajh gayi.") != _key("Ji ma'am, samajh gayi.")


def test_lead_name_produces_its_own_key():
    """Name-bearing sentences are cached, not excluded — they simply key
    separately and only earn a render once the name recurs."""
    assert _key("Namaste Rohan ji.") != _key("Namaste Aarav ji.")


@pytest.mark.parametrize("field,value", [
    ("engine", "google"), ("model", "bulbul:v2"), ("voice", "anushka"),
    ("pace", 1.2), ("temperature", 0.9), ("sample_rate", 24000),
    ("term_map_version", "abc123"), ("salt", "v2"),
])
def test_every_render_affecting_field_changes_the_key(field, value):
    """A field that changes the audio but not the key would serve the wrong
    voice. Includes the salt, which is the poisoned-entry escape hatch."""
    assert _key("Theek hai.") != _key("Theek hai.", **{field: value})


def test_pace_formatting_is_stable():
    """1.1 and 1.10 are the same pace and must not split the cache in two."""
    assert _key("Theek hai.", pace=1.1) == _key("Theek hai.", pace=1.10)


def test_field_boundaries_cannot_be_forged():
    """Concatenating fields without a separator would let voice+text collide with
    a different voice+text split at another point."""
    assert _key("ok.", voice="ab") != _key("ok.", voice="a")


# ── G1: completeness ────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "Aapka din shubh ho.", "Kya aap sun paa rahe hain?", "Bahut badhiya!",
    "आप किस class में हैं?", "यह ठीक है।", "Hmm…",
    'He said "theek hai."', "(Yes, that is right.)",
    # pipecat's aggregator splits on these too, so refusing them would skip
    # utterances it legitimately cut as whole sentences.
    "Pehla point yeh hai;", "यह पूरा वाक्य है॥",
])
def test_complete_sentences_are_accepted(text):
    assert is_complete(text)


@pytest.mark.parametrize("text", [
    "Aur wo abhi", "तो लास्ट exam में", "main aapko", "", "   ", "94",
])
def test_fragments_are_refused(text):
    """pipecat FLUSHES the aggregator remainder into TTS on
    LLMFullResponseEndFrame (tts_service.py:705-719), so partial clauses reach
    run_tts routinely. Caching one would play half a sentence, standalone, to
    every future caller who matched it."""
    assert not is_complete(text)


# ── ordering ────────────────────────────────────────────────────────────────

def test_async_arrival_engines_are_classified():
    for e in ("sarvam", "smallest", "rumik", "SARVAM"):
        assert is_async_arrival(e)
    for e in ("google", "edge", "deepgram", ""):
        assert not is_async_arrival(e)


def test_watcher_blocks_serving_while_the_vendor_owes_us_audio():
    """The one bug that would garble a live call.

    pipecat reuses ONE audio context per turn, drained in APPEND order. Cached
    audio appends instantly, vendor audio ~300ms later — so serving from cache
    while a vendor sentence is outstanding puts sentence 3 ahead of sentence 2.
    """
    w = TtsTurnWatcher()
    assert not w.vendor_inflight                      # start of turn: safe

    w.note_vendor_dispatch()
    assert w.vendor_inflight                          # mid-turn: must NOT serve

    w.observe(_FakeFrame("TTSStoppedFrame"))
    assert not w.vendor_inflight                      # turn drained: safe again


def test_watcher_clears_inflight_on_interruption():
    """A barge-in cancels the vendor's in-flight request, so the flag must clear
    or the cache would stay locked out for the rest of the call."""
    w = TtsTurnWatcher()
    w.note_vendor_dispatch()
    w.observe(_FakeFrame("StartInterruptionFrame"))
    assert not w.vendor_inflight


def test_watcher_records_interruption_time_for_g2():
    w = TtsTurnWatcher()
    t0 = ttscache.time.time()
    assert not w.interrupted_since(t0)
    w.observe(_FakeFrame("InterruptionFrame"))
    assert w.interrupted_since(t0)


def _FakeFrame(name):
    """The watcher dispatches on type(frame).__name__, so a bare class with the
    right name is a faithful stand-in and keeps pipecat out of the unit tests."""
    return type(name, (object,), {})()


def test_cached_utterance_mirrors_the_engines_own_frame_contract():
    """A cached sentence must emit exactly what the engine would have emitted.

    sarvam and google declare push_start_frame/push_stop_frames, so the BASE
    class brackets the utterance — emitting our own pair there gives the caller
    two of everything and re-arms the stop-frame bookkeeping. Our EdgeTTSService
    declares neither and yields its own pair, so there we must.
    """
    class _Managed:                       # sarvam / google
        _push_start_frame = True
        _push_stop_frames = True

    class _SelfBracketing:                # our EdgeTTSService
        pass

    assert owns_turn_brackets(_Managed()) == (False, False)
    assert owns_turn_brackets(_SelfBracketing()) == (True, True)


def test_an_unconfigured_agent_is_untouched_by_the_feature():
    """THE ship-safety invariant: nothing changes for anyone until an admin turns
    the cache on for one specific agent.

    Every existing ai_agent row is stamped OFF by V466, the call context always
    emits the key (never conditionally), and the bot's fallback for a missing key
    is OFF. So every path an unconfigured agent can take must refuse to serve —
    including when the ops kill switches are both ON, which is their default.
    """
    for mode in (MODE_OFF, "", None):
        for is_fixed in (True, False):
            assert not mode_allows(mode, is_fixed), (mode, is_fixed)


def test_mode_off_is_the_default_for_anything_unrecognised():
    """The only safe default for "may this agent replay stored audio" is no. A
    dropped key, a typo, or an agent saved by a client predating the field must
    all land on OFF rather than silently enabling playback."""
    for mode in (MODE_OFF, "", None, "off", "true", "ENABLED", "full "):
        expected = mode is not None and mode.strip().upper() == MODE_FULL
        assert mode_allows(mode, is_fixed_line=True) is expected
        assert mode_allows(mode, is_fixed_line=False) is expected


def test_fixed_tier_serves_only_the_bots_own_lines():
    """FIXED is the safe first tier: authored standalone utterances, no join to a
    neighbouring sentence, so render parity cannot bite."""
    assert mode_allows(MODE_FIXED, is_fixed_line=True)
    assert not mode_allows(MODE_FIXED, is_fixed_line=False)


def test_full_tier_serves_both():
    assert mode_allows(MODE_FULL, is_fixed_line=True)
    assert mode_allows(MODE_FULL, is_fixed_line=False)
    assert mode_allows("full", is_fixed_line=False)      # case-insensitive


def test_empty_allowlist_means_no_restriction():
    """The master switches already default off, so the allowlist is the SECOND
    gate. Empty has to mean "every agent", or setting the master switch alone
    would silently do nothing and look like a broken cache."""
    assert agent_allowed((), "agent-1", "Aarushi")


def test_allowlist_scopes_the_rollout_to_named_agents():
    """The whole point: one agent gets the first live test, nobody else's calls
    are touched by the same env flip."""
    allow = ("agent-1",)
    assert agent_allowed(allow, "agent-1", "Aarushi")
    assert not agent_allowed(allow, "agent-2", "Priya")


def test_allowlist_matches_id_or_name_case_insensitively():
    """Whoever edits /opt/voice-bot/.env is reading a screen showing the agent's
    NAME; making them hunt for a uuid is how the wrong agent gets listed."""
    assert agent_allowed(("aarushi",), "agent-1", "Aarushi")     # name, lower entry
    assert agent_allowed(("AGENT-1",), "agent-1", "Aarushi")     # upper entry
    assert agent_allowed(("agent-1",), "AGENT-1", "")            # upper id
    assert agent_allowed((" aarushi ",), "agent-1", "Aarushi")   # stray whitespace
    assert not agent_allowed(("aarushi",), "agent-2", "Priya")


# ── the store ───────────────────────────────────────────────────────────────

@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(ttscache, "get_settings", lambda: _Settings(str(tmp_path)))
    c = SpeechCache(root=str(tmp_path / "speech"))
    c.open()
    assert c.ready
    return c


class _Settings:
    def __init__(self, root, speech=True, llm=True, agents=()):
        self.speech_cache_dir = os.path.join(root, "speech")
        self.tts_cache_salt = "test"
        self.tts_cache_min_seen = 2
        self.tts_speech_cache_max_bytes = 10_000_000
        self.tts_cache_min_blob_ms = 200
        self.tts_cache_speech_enabled = speech
        self.tts_cache_llm_enabled = llm
        self.tts_cache_agents = agents
        self.tts_cache_debug = False


def _pcm(ms):
    return b"\x01\x02" * int(SAMPLE_RATE * ms / 1000)


def _cand(text, key=None, **over):
    args = dict(key=key or _key(text), text=text, chars=len(text), engine="sarvam",
                model="bulbul:v3", voice="priya", pace=1.1, temperature=0.5)
    args.update(over)
    return Candidate(**args)


def test_store_then_lookup_roundtrip(cache):
    c = _cand("Aapka din shubh ho.")
    assert cache.store(c, _pcm(800))
    entry = cache.lookup(c.key, c.text)
    assert entry is not None
    assert entry.duration_ms == 800
    assert cache.size == 1
    # The sidecar is the rebuild source and the human-readable record.
    with open(cache.meta_path(c.key), encoding="utf-8") as f:
        assert json.load(f)["text"] == c.text


def test_g5_refuses_a_render_too_short_to_be_speech(cache):
    """A sub-200ms blob is a silent stub or a decoded error page — dead air."""
    c = _cand("Theek hai.")
    assert not cache.store(c, _pcm(50))
    assert cache.lookup(c.key, c.text) is None


def test_g5_refuses_a_ragged_buffer(cache):
    """A byte count that is not a whole number of samples means a truncated
    write, and would play as a click or a clipped tail."""
    c = _cand("Theek hai.")
    assert not cache.store(c, _pcm(800) + b"\x00")
    assert cache.lookup(c.key, c.text) is None


def test_g6_text_mismatch_is_a_miss_not_a_wrong_play(cache):
    """Last line of defence. A hash collision, a corrupted row or a renamed file
    must cost one vendor render — never confidently speak the wrong words."""
    c = _cand("Aapka din shubh ho.")
    assert cache.store(c, _pcm(800))
    assert cache.lookup(c.key, "Something else entirely.") is None


def test_index_survives_reopen(cache):
    """Startup rebuilds from ONE query, not from tens of thousands of sidecars."""
    c = _cand("Aapka din shubh ho.")
    cache.store(c, _pcm(800))
    fresh = SpeechCache(root=cache.root)
    fresh.open()
    assert fresh.lookup(c.key, c.text) is not None


def test_a_row_whose_file_vanished_is_not_indexed(cache):
    """A hit that 404s into silence is worse than a miss."""
    c = _cand("Aapka din shubh ho.")
    cache.store(c, _pcm(800))
    os.remove(cache.blob_path(c.key))
    fresh = SpeechCache(root=cache.root)
    fresh.open()
    assert fresh.lookup(c.key, c.text) is None


# ── the ledger ──────────────────────────────────────────────────────────────

def test_render_is_due_only_after_min_seen_sightings(cache):
    """The knob still works when raised — _Settings pins it to 2, while the
    shipped default is 1. This is the way back if the ledger ever shows a fat
    never-recurring tail, so it has to keep being exercised."""
    c = _cand("Yeh humara flagship programme hai.")
    cache.ladder([c])
    assert cache.due() == []                    # once seen is not evidence
    cache.ladder([c])
    due = cache.due()
    assert [d.key for d in due] == [c.key]      # twice is


def test_a_fixed_line_is_due_after_ONE_sighting(cache):
    """MIN_SEEN exists because an LLM sentence might be a one-off — a name that
    never recurs — so a second sighting is how we learn it was worth rendering.

    A fixed line has no such doubt: it is authored, and it is spoken on every
    call by construction. Making it wait would delay the only lines guaranteed to
    pay off, which is the opposite of what the threshold is for.
    """
    fixed = _cand("Namaste ji, main Shreya bol rahi hoon.", fixed=True)
    cache.ladder([fixed])
    assert [d.key for d in cache.due()] == [fixed.key]


def test_an_llm_sentence_still_waits_for_the_second(cache):
    """The other half — dropping the threshold for everything would spend a
    render on every one-off personalised sentence."""
    llm = _cand("Rohan abhi kaun si class mein hai?")
    cache.ladder([llm])
    assert cache.due() == []
    cache.ladder([llm])
    assert [d.key for d in cache.due()] == [llm.key]


def test_fixed_lines_are_rendered_before_speculative_ones(cache):
    """A capped pass must spend its budget on the certain wins first."""
    fixed = _cand("Theek hai, dhanyavaad.", fixed=True)
    llm = _cand("Aur uski fees kya hai?")
    cache.ladder([llm]); cache.ladder([llm])
    cache.ladder([fixed])
    assert cache.due(limit=1)[0].key == fixed.key


def test_an_already_rendered_key_is_not_due_again(cache):
    c = _cand("Yeh humara flagship programme hai.")
    cache.ladder([c])
    cache.ladder([c])
    cache.store(c, _pcm(900))
    assert cache.due() == []


# ── G3 / G4: what a call is allowed to teach the cache ──────────────────────

def test_g3_a_sentence_the_caller_never_heard_is_not_laddered(cache):
    """PlayedTranscriptRecorder sits after transport.output(), so its transcript
    is text the caller actually HEARD. NoRepeatGate learned this the hard way on
    call 4b1a44b9: "'Already said' has to mean 'already HEARD'."
    """
    cc = CallCandidates(cache)
    heard = _cand("Yeh humara flagship programme hai.")
    never = _cand("Aur uski fees kya hai?")
    cc.add(heard)
    cc.add(never)
    n = cc.flush(played_text="Namaste. Yeh humara flagship programme hai.",
                 verdict_faults=[], health="GREEN")
    assert n == 1
    cache.ladder([heard])
    assert [d.key for d in cache.due()] == [heard.key]


@pytest.mark.parametrize("fault", ["TTS_WEDGE", "BOT_SILENT", "CRASH",
                                   "REPLY_UNPLAYED", "STT_DEAF"])
def test_g4_an_unhealthy_call_teaches_the_cache_nothing(cache, fault):
    """A call where synthesis wedged or a reply never played is not evidence
    about anything, so the whole batch is dropped rather than picked over."""
    cc = CallCandidates(cache)
    c = _cand("Yeh humara flagship programme hai.")
    cc.add(c)
    assert cc.flush(played_text=c.text, verdict_faults=[fault], health="AMBER") == 0


def test_the_counter_only_ever_counts_whole_sentences(cache):
    """The count means "this WHOLE sentence was delivered N times". A fragment
    reaching it would certify half a sentence, and the blob rendered from that
    count gets played to every future caller who matches it."""
    cc = CallCandidates(cache)
    whole = _cand("Yeh humara flagship programme hai.")
    frag = _cand("Aur uski fees")            # a flush remainder, no terminal mark
    cc.add(whole)
    cc.add(frag)
    n = cc.flush(played_text="Yeh humara flagship programme hai. Aur uski fees",
                 verdict_faults=[], health="GREEN")
    assert n == 1                             # the fragment never even got proposed

    cc2 = CallCandidates(cache)
    cc2.add(frag)
    assert cc2.flush(played_text="Aur uski fees", verdict_faults=[], health="GREEN") == 0
    assert cache.due() == []


def test_a_fixed_line_survives_a_red_call(cache):
    """The change live agent shreya-v3 forced: 15 of its 22 calls are RED, so one
    strict bar meant its opening line could only be learned from one call in
    three. And the faults doing the blocking — DEAD_AIR, SLOW_LLM,
    ANSWER_DELETED, REPLY_LOOP — say nothing about whether that opening was
    rendered correctly. It demonstrably was; it is the first line of the
    transcript."""
    cc = CallCandidates(cache)
    fixed = _cand("Namaste ji, main Shreya bol rahi hoon.", fixed=True)
    cc.add(fixed)
    n = cc.flush(played_text="",
                 verdict_faults=["ANSWER_DELETED", "DEAD_AIR", "REPLY_LOOP", "SLOW_LLM"],
                 health="RED")
    assert n == 1
    assert [d.key for d in cache.due()] == [fixed.key]


@pytest.mark.parametrize("fault", ["CRASH", "BOT_SILENT", "TTS_WEDGE", "REPLY_UNPLAYED"])
def test_a_fixed_line_is_still_dropped_when_the_AUDIO_is_suspect(cache, fault):
    """The narrowing is not a free pass. These four implicate the audio itself,
    and they must still veto a fixed line."""
    cc = CallCandidates(cache)
    cc.add(_cand("Theek hai, dhanyavaad.", fixed=True))
    assert cc.flush(played_text="", verdict_faults=[fault], health="AMBER") == 0


@pytest.mark.parametrize("fault", ["STT_DEAF", "REPLY_LOOP", "CRASH", "BOT_SILENT",
                                   "TTS_WEDGE", "REPLY_UNPLAYED"])
def test_an_llm_sentence_is_blocked_by_NAMED_faults(cache, fault):
    """The stricter bar for LLM sentences is a NAMED list, not a verdict.

    STT_DEAF means the reply may be answering nothing; REPLY_LOOP means the model
    was repeating itself. Both genuinely undermine "it will say this again". The
    four audio faults undermine the render. These still block.
    """
    cc = CallCandidates(cache)
    llm = _cand("Aur uski fees kya hai?")
    cc.add(llm)
    assert cc.flush(played_text=llm.text, verdict_faults=[fault], health="AMBER") == 0


def test_a_red_verdict_alone_no_longer_blocks_an_llm_sentence(cache):
    """Regression for the live case that made FULL useless.

    shreya-v3 is RED on essentially every call, and on two consecutive FULL calls
    62 and 46 LLM sentences were discarded whose only fault was DEAD_AIR. Long
    silences say nothing about whether a near-verbatim pitch line is worth
    keeping, so the blanket RED veto meant FULL could never learn anything.
    """
    cc = CallCandidates(cache)
    llm = _cand("exact fees teen cheezon par depend karti hai.")
    cc.add(llm)
    assert cc.flush(played_text=llm.text,
                    verdict_faults=["ANSWER_DELETED", "DEAD_AIR", "HANDBACK_LOOP"],
                    health="RED") == 1


def test_the_two_kinds_are_still_judged_separately(cache):
    """Both arrive from one call and answer to different bars. On STT_DEAF the
    fixed line survives (its audio is fine) and the LLM one does not (the reply
    may be answering something we never heard)."""
    cc = CallCandidates(cache)
    fixed = _cand("Theek hai, dhanyavaad.", fixed=True)
    llm = _cand("Aur uski fees kya hai?")
    cc.add(fixed); cc.add(llm)
    assert cc.flush(played_text=llm.text + " " + fixed.text,
                    verdict_faults=["STT_DEAF"], health="RED") == 1
    assert [d.key for d in cache.due()] == [fixed.key]


def test_a_red_call_with_no_named_fault_teaches_everything(cache):
    """RED is a summary of how the CALL went. A call can be RED purely for long
    silences while every sentence in it was spoken correctly."""
    cc = CallCandidates(cache)
    fixed = _cand("Theek hai, dhanyavaad.", fixed=True)
    llm = _cand("Aur uski fees kya hai?")
    cc.add(fixed); cc.add(llm)
    assert cc.flush(played_text=llm.text + " " + fixed.text,
                    verdict_faults=["DEAD_AIR"], health="RED") == 2


def test_a_healthy_amber_call_still_teaches(cache):
    """AMBER is not RED. Refusing to learn from every imperfect call would mean
    learning from almost none of them."""
    cc = CallCandidates(cache)
    c = _cand("Yeh humara flagship programme hai.")
    cc.add(c)
    assert cc.flush(played_text=c.text, verdict_faults=["DEAD_AIR"], health="AMBER") == 1


def test_fixed_lines_bypass_the_heard_gate(cache):
    """An admin-authored line is not learned FROM a call, so there is no call to
    have heard it on."""
    cc = CallCandidates(cache)
    cc.add(_cand("Theek hai, dhanyavaad.", fixed=True))
    assert cc.flush(played_text="", verdict_faults=[], health="GREEN") == 1


def test_played_match_tolerates_whitespace_but_the_key_does_not(cache):
    """PlayedTranscriptRecorder space-joins per-word TTSTextFrames, so the
    CONFIRMATION must be whitespace-tolerant. The key stays byte-exact — the two
    comparisons answer different questions."""
    cc = CallCandidates(cache)
    c = _cand("Yeh humara flagship programme hai.")
    cc.add(c)
    assert cc.flush(played_text="Yeh   humara\nflagship  programme hai.",
                    verdict_faults=[], health="GREEN") == 1
    assert _key("Yeh humara flagship programme hai.") != _key("Yeh  humara flagship programme hai.")


# ── eviction ────────────────────────────────────────────────────────────────

def test_eviction_drops_the_unused_before_the_frequently_hit(cache, monkeypatch):
    """Plain LRU would evict the very lines the cache exists for. Order is
    (hits ASC, last_served ASC) — the same reasoning that already protects
    warmed IVR prompts in _evict_tts_cache."""
    hot = _cand("Namaste, main Aarushi bol rahi hoon.")
    cold = _cand("Ek minute rukiye.")
    cache.store(hot, _pcm(1000))
    cache.store(cold, _pcm(1000))
    for _ in range(5):
        cache._bump_hit(hot.key)

    settings = _Settings(os.path.dirname(cache.root))
    settings.tts_speech_cache_max_bytes = len(_pcm(1000)) + 10
    monkeypatch.setattr(ttscache, "get_settings", lambda: settings)

    assert cache.evict() == 1
    assert cache.lookup(hot.key, hot.text) is not None
    assert cache.lookup(cold.key, cold.text) is None


# ── the ship-safety invariant, end to end ───────────────────────────────────

async def _sentinel_run_tts(text, context_id=None):
    """Stand-in for a real engine's run_tts. Identity is what the test asserts."""
    yield None


class _FakeTTS:
    _push_start_frame = True
    _push_stop_frames = True
    # Mirrors smallest: word_timestamps=True, so pipecat sets this False and
    # builds text frames from vendor word timings that a cache hit never gets.
    _push_text_frames = False

    def __init__(self):
        self.run_tts = _sentinel_run_tts

    # The serve path reports TTFB through the wrapped engine; stop_ttfb_metrics is
    # called on every hit (the clock is only STARTED when the base class did not).
    async def start_ttfb_metrics(self):
        pass

    async def stop_ttfb_metrics(self):
        pass


def _install_on(monkeypatch, tmp_path, tts, *, mode):
    """install_tts_cache against a caller-supplied service object."""
    pytest.importorskip("pipecat.frames.frames")
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    return ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines=set(), cache_mode=mode,
        cache=SpeechCache(root=str(tmp_path / "speech")))


def _install(monkeypatch, tmp_path, *, mode, speech=True, llm=True, agents=()):
    pytest.importorskip("pipecat.frames.frames")
    monkeypatch.setattr(
        ttscache, "get_settings",
        lambda: _Settings(str(tmp_path), speech=speech, llm=llm, agents=agents))
    tts = _FakeTTS()
    watcher = ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={"Theek hai."}, cache_mode=mode,
        cache=SpeechCache(root=str(tmp_path / "speech")))
    return tts, watcher


def test_a_disabled_agent_gets_no_wrapper_at_all(monkeypatch, tmp_path):
    """THE ship-safety invariant.

    For an agent nobody has enabled, run_tts must be the ENGINE'S OWN function —
    untouched, not a wrapper of ours that decides to decline. "My code never ran"
    is a far stronger claim than "my code chose to do nothing", and with every
    agent defaulting to OFF it is the claim that actually matters.

    install_tts_cache returning None is also what keeps the TtsTurnWatcher
    processor out of the pipeline, so the whole frame chain stays byte-identical.
    """
    for mode in (ttscache.MODE_OFF, "", None, "nonsense"):
        tts, watcher = _install(monkeypatch, tmp_path, mode=mode)
        assert tts.run_tts is _sentinel_run_tts, mode
        assert watcher is None, mode


def test_the_kill_switches_also_prevent_installation(monkeypatch, tmp_path):
    """Both ops kill switches off is the same as OFF: nothing installed."""
    tts, watcher = _install(monkeypatch, tmp_path, mode=ttscache.MODE_FULL,
                            speech=False, llm=False)
    assert tts.run_tts is _sentinel_run_tts
    assert watcher is None


def test_an_agent_outside_the_ops_allowlist_gets_no_wrapper(monkeypatch, tmp_path):
    tts, watcher = _install(monkeypatch, tmp_path, mode=ttscache.MODE_FULL,
                            agents=("some-other-agent",))
    assert tts.run_tts is _sentinel_run_tts
    assert watcher is None


def test_an_enabled_agent_does_get_the_wrapper(monkeypatch, tmp_path):
    """The other half: if this ever stopped installing, the feature would be
    silently dead and every test above would still pass."""
    for mode in (ttscache.MODE_FIXED, ttscache.MODE_FULL):
        tts, watcher = _install(monkeypatch, tmp_path, mode=mode)
        assert tts.run_tts is not _sentinel_run_tts, mode
        assert watcher is not None, mode


def test_warm_and_live_must_derive_the_same_key():
    """The warm path and the live path must agree on the model, or a pre-warmed
    blob is filed under a key no call can produce.

    This shipped broken: admin_core sent model="" and left resolution to the bot,
    but warm() passed that empty string straight into cache_key while the live
    path used engine_of(tts)[1] — the resolved "bulbul:v3" / "lightning_v3.1".
    Same sentence, same voice, two different digests, cache never hits and
    nothing looks wrong anywhere.
    """
    live = _key("Namaste ji.", engine="smallest", model="lightning_v3.1")
    warm_broken = _key("Namaste ji.", engine="smallest", model="")
    assert live != warm_broken, "the bug this test exists for"

    providers = pytest.importorskip("app.providers")
    resolved = providers.default_engine_model("smallest")
    assert resolved, "smallest must resolve to a concrete model, never blank"
    assert _key("Namaste ji.", engine="smallest", model=resolved) ==            _key("Namaste ji.", engine="smallest", model=resolved)


@pytest.mark.parametrize("engine", ["sarvam", "smallest", "google", "edge", "rumik"])
def test_every_live_engine_resolves_to_a_concrete_model(engine):
    """A blank here silently recreates the mismatch above for that engine."""
    providers = pytest.importorskip("app.providers")
    assert providers.default_engine_model(engine).strip(), engine


# ── the wording-consistency prompt rule (bot.build_system_prompt) ────────────

def _prompt_for(mode, language="hinglish"):
    pytest.importorskip("pipecat.frames.frames")
    # build_system_prompt fills date placeholders with glibc-only strftime
    # directives (%-d). They work on the Linux container and raise on Windows,
    # which is the same reason several existing tests here cannot run locally.
    import datetime as _dt
    try:
        _dt.datetime.now().strftime("%-d")
    except ValueError:
        pytest.skip("%-d strftime is glibc-only; this asserts in CI")
    from app import bot
    agent = {"id": "a1", "name": "T", "language": language, "voice": "mrunal",
             # An education script: the consistency rule's examples (रमन, क्लास)
             # are education words, and a non-education agent gets neutral ones
             # (app/agent_domain; tests/test_agent_grounding.py).
             "tts_model": "smallest_pro", "systemPrompt": "SCRIPT BODY about live classes",
             "openingLine": "नमस्ते जी।", "speech_cache_mode": mode}
    return bot.build_system_prompt({"agent": agent, "instituteName": "X",
                                    "direction": "OUTBOUND", "leadName": "P"})


def test_consistency_rule_is_absent_for_an_agent_with_the_cache_off():
    """It tightens delivery for a reason that only exists when the cache is on.
    26 agents are OFF and this feature has no business changing how they speak."""
    for mode in ("OFF", "", None):
        assert "SAY A RECURRING LINE THE SAME WAY" not in _prompt_for(mode), mode


def test_consistency_rule_is_present_once_the_cache_is_on():
    """The three drifts measured on shreya-v3, now told to every cached agent
    instead of being fixed one prompt at a time."""
    for mode in ("FIXED", "FULL"):
        p = _prompt_for(mode)
        assert "SAY A RECURRING LINE THE SAME WAY" in p, mode
        assert "never Raman" in p, mode
        assert "never 'क्लास'" in p, mode
        assert "सर/मैम goes exactly where the script puts it" in p, mode


def test_consistency_rule_never_forces_devanagari_on_an_english_agent():
    """An en-IN agent is told to write Latin only; a Devanagari name rule there
    would contradict its own SCRIPT rule.

    Both spellings a real agent is configured with. NOT bare "en": that is not a
    key in _STT_LANGS and has no hyphen, so _agent_language returns tag=None and
    the agent silently takes the HINDI branch — which is what this test asserted
    against before, passing an English expectation through a Hindi prompt.
    """
    for language in ("english", "en-IN"):
        p = _prompt_for("FULL", language=language)
        # Prove we actually reached the English branch, so the assertion below
        # cannot pass for the wrong reason a second time.
        assert "Write every reply in English (Latin letters) only" in p, language
        assert "never Raman" not in p, language
        assert "SAY A RECURRING LINE THE SAME WAY" not in p, language


# ── provenance + flush (the analytics dimension) ────────────────────────────

def _acand(text, agent, **over):
    return _cand(text, agent_id=agent, agent_name=agent.upper(),
                 institute_id="inst-1", **over)


def test_provenance_records_which_agents_contributed(cache):
    """The cache key is global so agents share blobs — nothing in the ledger
    names an agent. seen_agent is the separate dimension that makes
    "what has THIS agent cached" answerable at all."""
    line = "Theek hai, dhanyavaad."
    cache.ladder([_acand(line, "agent-a", fixed=True)])
    cache.ladder([_acand(line, "agent-b", fixed=True)])
    rows = cache.export_for_report()
    agents = sorted(r["agentId"] for r in rows)
    assert agents == ["agent-a", "agent-b"]
    assert all(r["cacheKey"] == rows[0]["cacheKey"] for r in rows), "one shared key"


def test_export_marks_unrendered_rows(cache):
    """The misses screen IS the rows with no blob — not missing data."""
    c = _acand("Aur uski fees kya hai?", "agent-a")
    cache.ladder([c])
    assert cache.export_for_report()[0]["rendered"] is False
    cache.store(c, _pcm(600))
    assert cache.export_for_report()[0]["rendered"] is True


def test_flush_defaults_to_a_dry_run_that_deletes_nothing(cache):
    """The destructive reading of an ambiguous request is the wrong one."""
    c = _acand("Theek hai, dhanyavaad.", "agent-a", fixed=True)
    cache.ladder([c]); cache.store(c, _pcm(800))
    entries, freed, note = cache.forget(agent_id="agent-a")
    assert entries == 1 and freed > 0 and note.startswith("DRY RUN")
    assert cache.lookup(c.key, c.text) is not None, "dry run must not delete"


def test_flushing_one_agent_keeps_audio_another_still_uses(cache):
    """THE hazard of a global key: two agents share one blob, so flushing one
    must not take the audio the other is still serving."""
    line = "Theek hai, dhanyavaad."
    a = _acand(line, "agent-a", fixed=True)
    cache.ladder([a]); cache.ladder([_acand(line, "agent-b", fixed=True)])
    cache.store(a, _pcm(800))

    entries, freed, note = cache.forget(agent_id="agent-a", dry_run=False)
    assert entries == 0, "nothing removable — agent-b still references it"
    assert "1 shared with another agent and kept" in note
    assert cache.lookup(a.key, a.text) is not None, "audio must survive"


def test_flushing_the_last_agent_does_remove_the_audio(cache):
    c = _acand("Theek hai, dhanyavaad.", "agent-a", fixed=True)
    cache.ladder([c]); cache.store(c, _pcm(800))
    entries, freed, note = cache.forget(agent_id="agent-a", dry_run=False)
    assert entries == 1 and freed > 0
    assert cache.lookup(c.key, c.text) is None
    assert cache.export_for_report() == []


# ── the internal routes (export / report-now / flush) ───────────────────────
#
# These exist because the ledger lives on ONE box's local disk. Reading or
# clearing it used to need a shell on that box, which made an empty analytics
# table impossible to diagnose remotely. Handlers are called directly with a
# stub Request so the suite needs no HTTP client.

class _Req:
    def __init__(self, token="s3cret", query=None, body=None):
        self.headers = {"x-voice-bot-token": token} if token else {}
        self.query_params = query or {}
        self._body = body

    async def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


@pytest.fixture
def routes(cache, monkeypatch):
    """app.main wired to the test cache and a known internal secret."""
    pytest.importorskip("fastapi")
    import dataclasses
    from app import main as m
    from app import ttscache as tc
    monkeypatch.setattr(tc, "get_cache", lambda: cache)
    # Settings is a frozen dataclass, so swap the accessor rather than the field.
    stub = dataclasses.replace(m.get_settings(), internal_client_secret="s3cret")
    monkeypatch.setattr(m, "get_settings", lambda: stub)
    return m


async def test_export_and_flush_refuse_a_bad_token(routes):
    for call in (routes.tts_cache_export(_Req(token="")),
                 routes.tts_cache_flush(_Req(token="wrong", body={"agentId": "a"})),
                 routes.tts_cache_report_now(_Req(token=None))):
        assert (await call).status_code == 401


async def test_export_returns_the_ledger_and_says_whether_it_is_ready(routes, cache):
    c = _acand("Namaste ji.", "agent-a", fixed=True)
    cache.ladder([c]); cache.store(c, _pcm(800))
    out = await routes.tts_cache_export(_Req())
    assert out["count"] == 1 and out["truncated"] is False
    assert out["entries"][0]["sentence"] == "Namaste ji."
    # ready/blobs travel separately from the rows: a cache still opening returns
    # zero entries, which is NOT the same answer as an open, empty one.
    assert "ready" in out and out["blobs"] == 1


async def test_export_filters_by_agent(routes, cache):
    a = _acand("Namaste ji.", "agent-a", fixed=True)
    cache.ladder([a]); cache.ladder([_acand("Theek hai.", "agent-b", fixed=True)])
    out = await routes.tts_cache_export(_Req(query={"agentId": "agent-b"}))
    assert out["count"] == 1
    assert out["entries"][0]["agentId"] == "agent-b"


async def test_flush_defaults_to_a_dry_run(routes, cache):
    """The destructive reading of an ambiguous request is the wrong one."""
    c = _acand("Namaste ji.", "agent-a", fixed=True)
    cache.ladder([c]); cache.store(c, _pcm(800))
    out = await routes.tts_cache_flush(_Req(body={"agentId": "agent-a"}))
    assert out["dryRun"] is True
    assert "DRY RUN" in out["result"]
    assert cache.lookup(c.key, c.text) is not None, "a dry run must delete nothing"


async def test_flush_refuses_to_wipe_everything(routes):
    """No agentId and no cacheKey is not 'flush the whole cache'."""
    r = await routes.tts_cache_flush(_Req(body={"dryRun": False}))
    assert r.status_code == 400


async def test_report_now_is_explicit_about_an_empty_ledger(routes, monkeypatch):
    """The reporter's own `if entries:` guard makes this silent; the route must
    not return the same 200 for 'pushed nothing' and 'pushed successfully'."""
    out = await routes.tts_cache_report_now(_Req())
    assert out["pushed"] == 0 and out["ok"] is None
    assert "empty" in out["note"]


async def test_report_now_pushes_what_the_reporter_would(routes, cache, monkeypatch):
    from app import admin_core
    sent = {}

    async def _fake(entries):
        sent["n"] = len(entries)
        return True

    monkeypatch.setattr(admin_core, "post_tts_cache_report", _fake)
    c = _acand("Namaste ji.", "agent-a", fixed=True)
    cache.ladder([c]); cache.store(c, _pcm(800))
    out = await routes.tts_cache_report_now(_Req())
    assert out["pushed"] == 1 and out["ok"] is True and sent["n"] == 1


def test_export_reports_rows_that_predate_per_agent_tracking(cache):
    """THE bug that made the first rollout look like a dead reporter.

    seen_agent is only written for a candidate carrying an agent_id, so every
    sentence laddered by the pre-analytics build had no provenance row. With an
    INNER JOIN a ledger holding real sentences exported ZERO, the push was a
    silent no-op, and the analytics table stayed empty with no error anywhere.
    """
    c = _cand("Namaste ji.", fixed=True)          # no agent_id at all
    cache.ladder([c]); cache.store(c, _pcm(800))

    out = cache.export_for_report()
    assert len(out) == 1, "an unowned row must still be reported, not dropped"
    e = out[0]
    assert e["agentId"] == ttscache.UNATTRIBUTED
    assert e["agentName"] == ttscache.UNATTRIBUTED_NAME
    assert e["sentence"] == "Namaste ji."
    assert e["rendered"] is True
    # Sightings are real; per-agent hits were never recorded, so they must read
    # 0 rather than be invented from the call-level counters.
    assert e["sightings"] == 1 and e["hits"] == 0


def test_export_still_prefers_real_provenance_when_it_exists(cache):
    c = _acand("Theek hai.", "agent-a", fixed=True)
    cache.ladder([c])
    e = cache.export_for_report()[0]
    assert e["agentId"] == "agent-a" and e["agentName"] == "AGENT-A"


async def test_report_now_pushes_unattributed_history(routes, cache, monkeypatch):
    """The backfill case end to end: an old ledger with no provenance must
    still reach admin-core."""
    from app import admin_core
    sent = {}

    async def _fake(entries):
        sent["ids"] = [x["agentId"] for x in entries]
        return True

    monkeypatch.setattr(admin_core, "post_tts_cache_report", _fake)
    c = _cand("Namaste ji.", fixed=True)
    cache.ladder([c]); cache.store(c, _pcm(800))
    out = await routes.tts_cache_report_now(_Req())
    assert out["pushed"] == 1 and out["ok"] is True
    assert sent["ids"] == [ttscache.UNATTRIBUTED]


def test_min_seen_defaults_to_one(monkeypatch):
    """A sentence renders on its FIRST sighting, not its second.

    Counting vendor payments for a line spoken N times: no cache costs N; at a
    threshold of 2 it costs 3 (two live plus the render) and is free from the
    third use; at 1 it costs 2 and is free from the SECOND. So 1 wins whenever
    the line recurs at all and loses one cheap off-call render when it does not.

    Pinned because the value is a silent economic trade — nothing fails if it
    drifts back to 2, the cache just quietly stops earning on everything with a
    short tail. Measured on shreya-v3's first day, 54 of 73 sentences sat at one
    sighting, so a threshold of 2 was holding back the whole backlog.
    """
    monkeypatch.delenv("TTS_CACHE_MIN_SEEN", raising=False)
    from app.config import Settings
    assert Settings().tts_cache_min_seen == 1


# ── a cache hit must count as speech ────────────────────────────────────────

async def test_a_cache_hit_emits_a_TTSTextFrame(monkeypatch, tmp_path):
    """THE frame that makes a served sentence visible downstream.

    smallest and sarvam are built with word_timestamps=True, so pipecat sets
    push_text_frames=False and builds TTSTextFrames from the vendor's word-timing
    messages. A cache hit never calls the vendor, so those never arrive — and the
    served sentence emitted ZERO TTSTextFrames.

    Everything that decides "has the bot said this?" reads that frame.
    PlayedTranscriptRecorder logs only TTSTextFrame; NoRepeatGate tests
    containment in what it logged. With none emitted, a cached sentence was
    permanently "never said" and the model could repeat it without limit. Live
    call f425326e: one 8.2s line played THREE times at envelope correlation
    0.996 — the same blob replayed, not a re-synthesis — with REPLY_LOOP and 30
    unsaid-reverts.
    """
    from pipecat.frames.frames import TTSTextFrame
    pytest.importorskip("pipecat.frames.frames")
    line = "Theek hai, dhanyavaad."
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(600))

    tts = _FakeTTS()
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)

    frames = [f async for f in tts.run_tts(line, "ctx-1") if f is not None]
    kinds = [type(f).__name__ for f in frames]
    assert "TTSAudioRawFrame" in kinds, "expected a cache hit; got %r" % (kinds,)

    texts = [f for f in frames if isinstance(f, TTSTextFrame)]
    assert len(texts) == 1, "exactly one TTSTextFrame, got %d" % len(texts)
    assert texts[0].text == line, "must carry the ORIGINAL text the caller heard"

    # AFTER the audio, matching where pipecat's own base class appends its tail
    # frame. Before it, the sentence would count as heard the moment playout
    # STARTED, and a caller who talked over it would be told they had heard it —
    # the exact bug NoRepeatGate's never-played revert exists to prevent.
    assert kinds.index("TTSTextFrame") > kinds.index("TTSAudioRawFrame")


async def test_a_cache_MISS_does_not_add_a_text_frame(monkeypatch, tmp_path):
    """The vendor path is untouched: pipecat still owns the text frame there, and
    emitting our own would duplicate it into the transcript."""
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    tts = _FakeTTS()
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines=set(), cache_mode="FULL", cache=c)
    frames = [f async for f in tts.run_tts("Kuch aur poochhna hai?", "ctx-2")
              if f is not None]
    assert [type(f).__name__ for f in frames] == [],         "a miss must yield exactly what the engine yielded, and nothing more"


async def test_no_text_frame_when_pipecat_already_emits_one(monkeypatch, tmp_path):
    """sarvam, deepgram and google set push_text_frames=True, so pipecat appends
    its OWN TTSTextFrame after run_tts returns. Emitting ours too would put the
    sentence in the played transcript and the assistant context twice — the model
    would see itself say the line twice and the repeat check would compare
    doubled text. Only the word-timestamp services (smallest) need ours.

    (A real pipecat service places the text at its heard point and drops
    pipecat's copy — the tests below. This stand-in has no
    append_to_audio_context to drop it through, so it must get none of ours.)
    """
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Theek hai, dhanyavaad."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(600))

    tts = _FakeTTS()
    tts._push_text_frames = True          # behave like sarvam
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)
    kinds = [type(f).__name__ async for f in tts.run_tts(line, "ctx-3")
             if f is not None]
    assert "TTSAudioRawFrame" in kinds, "still expected a cache hit"
    assert "TTSTextFrame" not in kinds,         "pipecat appends its own here — ours would duplicate the sentence"


def test_owns_text_frame_defaults_to_not_emitting():
    """Unknown service: a missing frame degrades the repeat check, a duplicated
    one corrupts the transcript. Prefer the recoverable failure."""
    class _Unknown: pass
    assert ttscache.owns_text_frame(_Unknown()) is False


# ── a cached sentence is HEARD by its audio, like a live one (call 34452119) ─

def test_heard_chunk_count_is_the_first_boundary_at_or_past_the_share():
    assert ttscache.heard_chunk_count(0) == 0
    assert ttscache.heard_chunk_count(1) == 1, "the text never leads its audio"
    assert ttscache.heard_chunk_count(3) == 2
    assert ttscache.heard_chunk_count(10) == 6
    assert ttscache.heard_chunk_count(660) == 396        # a 13.2 s blob in 20 ms chunks
    assert ttscache.heard_chunk_count(10, share=1.0) == 10
    assert ttscache.heard_chunk_count(10, share=2.0) == 10, "never past the last chunk"


class _QueueTTS(_FakeTTS):
    """A push_text_frames engine (navana / sarvam) with pipecat's audio-context
    append: what the hit path's frames and pipecat's own late TTSTextFrame are
    queued through. Records the queue in order."""
    _push_start_frame = True
    _push_stop_frames = False
    _push_text_frames = True

    def __init__(self):
        super().__init__()
        self.queue = []
        self._tts_contexts = {}

    async def append_to_audio_context(self, context_id, frame):
        self.queue.append((context_id, frame))


async def _speak(tts, text, cid, *, append_to_context=True, stop_after=None):
    """pipecat's _push_tts_frames for one sentence: register the context, run
    run_tts appending every frame it yields, then append the base class's own
    TTSTextFrame. stop_after=N: the run is interrupted after N yielded frames
    (the generator is closed and pipecat appends nothing more)."""
    from types import SimpleNamespace
    from pipecat.frames.frames import AggregationType, TTSTextFrame
    tts._tts_contexts[cid] = SimpleNamespace(append_to_context=append_to_context)
    gen = tts.run_tts(text, cid)
    n = 0
    async for f in gen:
        if f is not None:
            await tts.append_to_audio_context(cid, f)
        n += 1
        if stop_after is not None and n >= stop_after:
            await gen.aclose()
            return
    late = TTSTextFrame(text, aggregated_by=AggregationType.SENTENCE)
    late.context_id = cid
    late.append_to_context = append_to_context
    await tts.append_to_audio_context(cid, late)


def _install_queue_tts(monkeypatch, tmp_path, lines):
    monkeypatch.setattr(ttscache, "get_settings", lambda: _Settings(str(tmp_path)))
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    for line, ms in lines:
        cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                     pace=1.1, temperature=0.5, fixed=True)
        c.ladder([cand]); c.store(cand, _pcm(ms))
    tts = _QueueTTS()
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line for line, _ in lines}, cache_mode="FULL", cache=c)
    return tts


def _kinds(queue, cid=None):
    return [type(f).__name__ for c, f in queue if cid is None or c == cid]


async def test_a_cached_sentence_is_heard_at_60_percent_of_its_audio_and_said_once(
        monkeypatch, tmp_path):
    """Call 34452119 (2026-10-02): a 13.2 s cached reply sentence, cut at 63 %.
    pipecat appended its text BEHIND the whole blob, so the cut left it out of
    the played transcript; NoRepeatGate un-recorded it and the model said all of
    it again. The text must sit 60 % of the way into the audio — where a live
    Navana sentence's is released — and pipecat's late copy must be dropped:
    one TTSTextFrame per sentence, carrying the context's append_to_context."""
    from pipecat.frames.frames import TTSTextFrame
    line = "Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है।"
    tts = _install_queue_tts(monkeypatch, tmp_path, [(line, 1000)])
    await _speak(tts, line, "ctx-cached", append_to_context=False)
    kinds = _kinds(tts.queue)
    texts = [f for _, f in tts.queue if isinstance(f, TTSTextFrame)]
    assert len(texts) == 1, f"one text frame per sentence, got {len(texts)}: {kinds}"
    assert texts[0].text == line
    assert getattr(texts[0], "_vacademy_cached_text", False), "pipecat's late copy got through"
    assert texts[0].append_to_context is False, "a re-said opening must not re-enter the context"
    n_audio = kinds.count("TTSAudioRawFrame")
    before = kinds[:kinds.index("TTSTextFrame")].count("TTSAudioRawFrame")
    assert n_audio == 50                                  # 1 s in 20 ms chunks
    assert before == 30, f"text after {before} of {n_audio} chunks — want 60 % (30)"


async def test_a_cached_question_keeps_its_text_behind_the_whole_clip(monkeypatch, tmp_path):
    """Replay corpus, 2026-10-02: placing the cached OPENING's text at 60 % made a
    "हाँ" that cut it at 61-79 % read as the answer to its question — which starts
    at 66 % and was never heard. A clip ending in a question keeps pipecat's own
    text frame, after the last chunk, exactly as before; nothing is armed to drop."""
    from pipecat.frames.frames import TTSTextFrame
    opening = ("नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से। आपने live classes की "
               "inquiry की थी। क्या मैं जान सकती हूँ कि किससे बात कर रही हूँ?")
    tts = _install_queue_tts(monkeypatch, tmp_path, [(opening, 1000)])
    await _speak(tts, opening, "ctx-open", append_to_context=False)
    kinds = _kinds(tts.queue)
    texts = [f for _, f in tts.queue if isinstance(f, TTSTextFrame)]
    assert len(texts) == 1, kinds
    assert not getattr(texts[0], "_vacademy_cached_text", False), "the cache placed a question's text"
    assert "TTSAudioRawFrame" not in kinds[kinds.index("TTSTextFrame"):], "text before the clip ended"
    await _speak(tts, "Kuch aur poochhna hai?", "ctx-open")
    assert [f.text for c, f in tts.queue if isinstance(f, TTSTextFrame)][-1] == "Kuch aur poochhna hai?", \
        "a drop was left armed"


def test_ends_in_question():
    f = ttscache.ends_in_question
    assert f("क्या मैं जान सकती हूँ कि किससे बात कर रही हूँ?")
    assert f("Is this Raman? ")
    assert f('He asked "really?"')
    assert f("कौन-सा time ठीक रहेगा？")
    assert not f("Hello, is this Raman? I am Aarushi from Vacademy.")
    assert not f("Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है।")
    assert not f("")


async def test_a_live_sentence_keeps_pipecats_text_frame(monkeypatch, tmp_path):
    """The drop is armed only by a cache HIT: a miss (and every live sentence
    after a hit) keeps the base class's TTSTextFrame — the live path is the
    engine's own, untouched."""
    from pipecat.frames.frames import TTSTextFrame
    cached = "Thank you."
    tts = _install_queue_tts(monkeypatch, tmp_path, [(cached, 400)])
    await _speak(tts, cached, "ctx-1")
    await _speak(tts, "Kuch aur poochhna hai?", "ctx-2")
    live = [f for c, f in tts.queue if c == "ctx-2" and isinstance(f, TTSTextFrame)]
    assert [f.text for f in live] == ["Kuch aur poochhna hai?"]
    assert not getattr(live[0], "_vacademy_cached_text", False)
    assert len([f for c, f in tts.queue if c == "ctx-1" and isinstance(f, TTSTextFrame)]) == 1


async def test_a_hit_cut_before_its_heard_point_places_no_text_and_arms_nothing(
        monkeypatch, tmp_path):
    """Interrupted at ~30 % (the 30 % cut of the timing sim): no text frame is
    queued — the sentence is not heard and may be said again — and no drop is
    left armed to swallow the next sentence's text on the same context (a
    shared turn context reuses the id)."""
    from pipecat.frames.frames import TTSTextFrame
    line = "Generally parents have three or four basic expectations."
    tts = _install_queue_tts(monkeypatch, tmp_path, [(line, 1000)])
    await _speak(tts, line, "ctx-shared", stop_after=15)       # 15 of 50 chunks
    assert not [f for _, f in tts.queue if isinstance(f, TTSTextFrame)]
    await _speak(tts, "Would you agree with that?", "ctx-shared")
    texts = [f.text for _, f in tts.queue if isinstance(f, TTSTextFrame)]
    assert texts == ["Would you agree with that?"]


def test_the_handoff_drops_only_the_armed_contexts_next_copy():
    from pipecat.frames.frames import AggregationType, TTSTextFrame
    h = ttscache.CachedTextHandoff()

    def tf(text, own=False):
        f = TTSTextFrame(text, aggregated_by=AggregationType.SENTENCE)
        if own:
            f._vacademy_cached_text = True
        return f
    assert not h.take("a", tf("x")), "nothing armed"
    h.arm("a", "Thank you.")
    assert not h.take("a", tf("Thank you.", own=True)), "our own placed frame is never dropped"
    assert not h.take("b", tf("Thank you.")), "another context's frame is not ours to drop"
    assert h.take("a", tf("Thank you. ")), "pipecat's copy (whitespace aside) is dropped"
    assert not h.take("a", tf("Thank you.")), "one-shot"
    h.arm("a", "Thank you.")
    h.clear()
    assert not h.take("a", tf("Thank you.")), "cleared by the next run_tts"


def test_a_word_timestamp_engine_keeps_its_own_append(monkeypatch, tmp_path):
    """smallest (push_text_frames off) already spreads a cached sentence's words
    over its blob: nothing of the handoff is installed on it."""
    monkeypatch.setattr(ttscache, "get_settings", lambda: _Settings(str(tmp_path)))

    class _WordTTS(_FakeTTS):
        async def append_to_audio_context(self, context_id, frame):
            pass
    tts = _WordTTS()
    assert ttscache.owns_text_frame(tts)
    ttscache.install_tts_cache(
        tts, engine="smallest", model="lightning", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines=set(), cache_mode="FULL",
        cache=SpeechCache(root=str(tmp_path / "speech")))
    assert "append_to_audio_context" not in vars(tts), "the word-timestamp engine was wrapped"


def test_a_hit_records_itself_even_with_no_prior_provenance(cache):
    """THE reason every backfilled entry read 0 hits forever.

    A cache HIT never ladders — only the miss path adds a candidate — so the
    provenance row may not exist when the first hit lands, and it certainly does
    not for anything laddered before per-agent tracking existed. This used to be
    a bare UPDATE, which matched zero rows there and dropped the hit silently.
    """
    c = _cand("Namaste ji.", fixed=True)          # laddered with NO agent_id
    cache.ladder([c]); cache.store(c, _pcm(600))
    assert [e for e in cache.export_for_report()
            if e["agentId"] == "agent-a"] == [], "no provenance row yet"

    cache._bump_agent_hit(c.key, "agent-a", "AGENT-A", "inst-1")

    rows = [e for e in cache.export_for_report() if e["agentId"] == "agent-a"]
    assert len(rows) == 1, "the hit must CREATE the attribution row"
    assert rows[0]["hits"] == 1
    assert rows[0]["agentName"] == "AGENT-A"
    assert rows[0]["sentence"] == "Namaste ji."


def test_repeated_hits_accumulate_on_the_same_row(cache):
    c = _acand("Theek hai.", "agent-a", fixed=True)
    cache.ladder([c])
    for _ in range(3):
        cache._bump_agent_hit(c.key, "agent-a", "AGENT-A", "inst-1")
    row = [e for e in cache.export_for_report() if e["agentId"] == "agent-a"][0]
    assert row["hits"] == 3
    assert row["sightings"] == 1, "a hit is not a sighting — ladder owns that"


# ── the ordering guard no longer starves the cache ──────────────────────────

def test_enabling_the_cache_switches_the_engine_to_per_sentence_contexts(
        monkeypatch, tmp_path):
    """One context per turn is what forced a cached sentence to the vendor."""
    tts = _FakeTTS()
    tts._reuse_context_id_within_turn = True
    _install_on(monkeypatch, tmp_path, tts, mode="FULL")
    assert tts._reuse_context_id_within_turn is False
    assert ttscache.per_sentence_contexts(tts) is True


def test_a_DISABLED_agent_keeps_pipecat_turn_bracketing(monkeypatch, tmp_path):
    """The ship-safety guarantee. Turn bracketing drives DuckGate, the watchdog
    and dead-air measurement, so an agent nobody enabled must not have it
    changed underneath them."""
    tts = _FakeTTS()
    tts._reuse_context_id_within_turn = True
    _install_on(monkeypatch, tmp_path, tts, mode="OFF")
    assert tts._reuse_context_id_within_turn is True, "must be left untouched"


async def test_a_cached_sentence_serves_even_with_vendor_audio_in_flight(
        monkeypatch, tmp_path):
    """THE fix. On live call a2d883c4, 14 sentences worth 955 characters were
    already rendered and were re-synthesised anyway, because one earlier miss in
    the turn had set vendor_inflight and TTSStoppedFrame only clears it at the
    END of a turn on these engines.
    """
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Theek hai, dhanyavaad."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(600))

    tts = _FakeTTS()
    tts._reuse_context_id_within_turn = True
    watcher = ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)

    watcher.note_vendor_dispatch()          # an earlier sentence went to the vendor
    assert watcher.vendor_inflight is True
    kinds = [type(f).__name__ async for f in tts.run_tts(line, "ctx-9")
             if f is not None]
    assert "TTSAudioRawFrame" in kinds,         "cached audio must serve mid-turn now that ordering is fixed by context"


async def test_the_guard_still_applies_if_contexts_are_NOT_per_sentence(
        monkeypatch, tmp_path):
    """Belt and braces: on any service we could not switch, serving mid-turn
    would still reorder audio, so the guard must keep refusing."""
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Theek hai, dhanyavaad."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(600))
    tts = _FakeTTS()
    watcher = ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)
    tts._reuse_context_id_within_turn = True     # pretend the switch did not take
    watcher.note_vendor_dispatch()
    kinds = [type(f).__name__ async for f in tts.run_tts(line, "ctx-10")
             if f is not None]
    assert "TTSAudioRawFrame" not in kinds, "ordering beats hit rate, always"


# ── call f225f71e (2026-09-10): a 187,810 ms drone cached under "Got it." ─────

def test_plausible_duration_rejects_drones_and_keeps_real_speech():
    from app.ttscache import plausible_duration
    assert not plausible_duration("Got it.", 187_810)
    assert not plausible_duration("Perfect.", 50_600)
    # Real renders from the live cache (text length -> duration) all pass.
    assert plausible_duration("Got it.", 960)
    assert plausible_duration("जी?", 1_200)
    assert plausible_duration("नमस्ते जी, ये call record की जाएगी। मैं श्रेया बोल रही हूँ शिक्षा नेशन से।", 12_200)
    assert plausible_duration("x" * 70, 18_400)          # slow, long Hindi line
    # 4 s floor: a short line may take up to 4 s (pauses, slow voice).
    assert plausible_duration("Okay.", 3_900)
    assert not plausible_duration("Okay.", 4_100 * 2)


async def test_a_cached_sentence_closes_its_own_per_sentence_context(
        monkeypatch, tmp_path):
    """Live call 994162b0 (2026-09-12): 'Thank you.' from the cache, then 3.6 s
    of silence before the next cached sentence. With per-sentence contexts the
    base class never closes a cached context (the vendor's 'done' does that for
    vendor audio, and the turn-end close targets an id no sentence uses), so the
    queue sat open until pipecat's 3 s idle timeout and the next sentence's audio
    waited behind it. The hit path must append the stop bracket and the None
    sentinel itself, in that order, after its audio and text."""
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Thank you."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(400))

    tts = _FakeTTS()
    tts._reuse_context_id_within_turn = True
    removed = []

    async def remove_audio_context(cid):
        removed.append(cid)
    tts.remove_audio_context = remove_audio_context
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)
    assert ttscache.per_sentence_contexts(tts)

    order = []
    async for f in tts.run_tts(line, "ctx-thanks"):
        if f is not None:
            order.append(type(f).__name__)
    assert "TTSAudioRawFrame" in order and "TTSTextFrame" in order
    assert order[-1] == "TTSStoppedFrame", order
    # The close waits for the blob's own playout (400 ms here): closing at once
    # stamped the next sentence's words early (call 859c20ee).
    assert removed == [], "closed before the audio could have played"
    import asyncio as _a
    await _a.sleep(0.6)
    assert removed == ["ctx-thanks"]
    # the stop bracket must come AFTER the text frame, which comes after audio
    assert order.index("TTSTextFrame") > order.index("TTSAudioRawFrame")
    assert order.index("TTSStoppedFrame") > order.index("TTSTextFrame")


async def test_a_cached_sentence_does_not_close_a_shared_turn_context(
        monkeypatch, tmp_path):
    """With one context per TURN (cache disabled for the agent, or a sync
    engine), closing after the first sentence would cut the rest of the turn
    off. The base class owns the close there; the hit path must not touch it."""
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Theek hai, dhanyavaad."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(600))
    tts = _FakeTTS()
    removed = []

    async def remove_audio_context(cid):
        removed.append(cid)
    tts.remove_audio_context = remove_audio_context
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)
    tts._reuse_context_id_within_turn = True      # shared turn context
    kinds = [type(f).__name__ async for f in tts.run_tts(line, "ctx-1") if f is not None]
    assert "TTSAudioRawFrame" in kinds
    assert "TTSStoppedFrame" not in kinds and removed == []


async def test_a_push_text_frames_engine_is_left_to_the_base_class(
        monkeypatch, tmp_path):
    """On an engine where pipecat appends the TTSTextFrame AFTER run_tts
    returns, closing inside run_tts would put the None sentinel ahead of the
    text and the sentence would vanish from the played transcript (the timing
    simulator's stub caught this). Such engines keep the base-class close."""
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Thank you."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(400))
    tts = _FakeTTS()
    tts._push_text_frames = True
    removed = []

    async def remove_audio_context(cid):
        removed.append(cid)
    tts.remove_audio_context = remove_audio_context
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)
    kinds = [type(f).__name__ async for f in tts.run_tts(line, "ctx-2") if f is not None]
    assert "TTSAudioRawFrame" in kinds and removed == []


def test_force_complete_leaves_queued_sentences_alone():
    """Call 859c20ee: every sentence after a cache hit recorded twice, because
    the hit's context end force-completed the slots of sentences still queued
    behind it. Only slots of ended/playing contexts may be flushed."""
    class _Slot:
        def __init__(self, cid, complete=False):
            self.context_id, self.spoken, self.complete, self.tracker = cid, True, complete, object()

    class _Seq:
        def __init__(self):
            self._slots = [_Slot("playing"), _Slot("queued-1"), _Slot("queued-2")]
            self.calls = []

        def force_complete(self, pts):
            self.calls.append([s.context_id for s in self._slots])
            for s in self._slots:
                s.complete = True
            return []

    class _T:
        _aggregated_frame_sequencer = _Seq()
        _playing_context_id = "playing"

        def audio_context_available(self, cid):
            return cid in ("playing", "queued-1", "queued-2")

    t = _T()
    assert ttscache.scope_force_complete_to_ended_contexts(t) is True
    assert ttscache.scope_force_complete_to_ended_contexts(t) is False, "idempotent"
    seq = t._aggregated_frame_sequencer
    seq.force_complete(0)
    assert seq.calls == [["playing"]], "queued sentences must not be flushed"
    assert [s.context_id for s in seq._slots] == ["playing", "queued-1", "queued-2"], "order restored"
    assert [s.complete for s in seq._slots] == [True, False, False]
    # once their contexts are gone (played, deleted) they are flushed normally
    t.audio_context_available = lambda cid: False
    seq.force_complete(0)
    assert seq.calls[-1] == ["playing", "queued-1", "queued-2"]



async def test_a_long_cached_sentence_holds_the_next_one_until_it_has_played(
        monkeypatch, tmp_path):
    """Call d9aed777 (2026-09-25): a 10.9 s cached sentence handed the next,
    live sentence to the vendor 6 s in (emission runs ~2x real time), its words
    were stamped inside the cached one, and the played transcript interleaved
    the two. The hit path now returns only ~0.3 s before its own audio ends."""
    import time as _t
    monkeypatch.setattr(ttscache, "get_settings",
                        lambda: _Settings(str(tmp_path)))
    line = "Generally when parents join a coaching class they have basic expectations."
    c = SpeechCache(root=str(tmp_path / "speech")); c.open()
    cand = _cand(line, engine="sarvam", model="bulbul:v3", voice="priya",
                 pace=1.1, temperature=0.5, fixed=True)
    c.ladder([cand]); c.store(cand, _pcm(2000))
    tts = _FakeTTS()
    tts._reuse_context_id_within_turn = True
    async def remove_audio_context(cid):
        pass
    tts.remove_audio_context = remove_audio_context
    ttscache.install_tts_cache(
        tts, engine="sarvam", model="bulbul:v3", voice="priya", pace=1.1,
        temperature=0.5, fixed_lines={line}, cache_mode="FULL", cache=c)
    assert ttscache.per_sentence_contexts(tts)
    t0 = _t.monotonic()
    kinds = [type(f).__name__ async for f in tts.run_tts(line, "ctx-long") if f is not None]
    took = _t.monotonic() - t0
    assert "TTSAudioRawFrame" in kinds
    assert took >= 2.0 - ttscache._NEXT_SENTENCE_LEAD_SECS - 0.1, \
        f"returned {took:.2f}s into a 2.0 s blob — the next sentence would start inside it"
    assert took < 2.0 + 0.3, f"held {took:.2f}s — longer than the blob itself"
