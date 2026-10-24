"""TTS speech cache — replay audio we have already paid to synthesize.

WHY: V421's own migration note puts TTS at ~65% of an AI call's marginal cost.
A scripted agent says the same opening line, the same farewells, the same
handbacks and (on a tight script) much of the same pitch on every call, and we
pay Sarvam Rs 3.00/1k characters for each one of them, every time.

WHAT: hash the exact string plus the voice and the delivery params, store the
rendered audio, replay it on an exact key match. Matching is equality on a
sha256 — there is NO similarity search, NO prefix match, NO nearest neighbour.
One differing character is a different digest and therefore a vendor call. That
is deliberate: the point is to stop paying twice for identical audio, never to
approximate a sentence we do not have.

THE INVARIANT THAT MATTERS MOST: a bad entry is not a one-call bug. It is
served to every future call that matches it, forever. So the bar for writing an
entry is much higher than the bar for reading one:

  * live audio is NEVER stored. A call contributes a candidate KEY; every blob
    is rendered off-call from a complete one-shot synthesis, so "the recording
    is truncated" is impossible by construction rather than by a check. (It also
    could not be done safely: on the websocket engines pipecat delivers audio
    asynchronously with no per-sentence attribution, and a barge-in truncates
    the stream mid-sentence.)
  * six gates, G1..G6 below, stand between "the bot said something" and "we will
    play this recording to a stranger".

Read docs/crm/TTS_SPEECH_CACHE.md for the full design and the pipecat 1.4
mechanics it depends on.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import sqlite3
import time
from dataclasses import dataclass
from typing import Iterable, Optional

from loguru import logger

from .config import get_settings

# The live call leg is 8 kHz signed 16-bit mono (Plivo). Storing at the leg's own
# rate rather than the engine's native 24 kHz is 3x smaller AND removes a resample
# from the hot path — the transport's resampler becomes a no-op.
SAMPLE_RATE = 8000
SAMPLE_WIDTH = 2
CHANNELS = 1
_BYTES_PER_SEC = SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS

# Yield cached audio in 20 ms slices with a cooperative await between them. A
# synchronous dump would push the whole utterance past DuckGate into pipecat's
# output queue and Plivo's buffer before a barge-in could land — the exact
# problem AUDIO_MAX_LEAD_SECS exists to bound (live call d6e82def logged
# "dropping 0 held frame(s)" on an interrupt for precisely that reason).
CHUNK_MS = 20
_CHUNK_BYTES = int(_BYTES_PER_SEC * CHUNK_MS / 1000)
# Emit at ~2x real time — fast enough never to starve playout, slow enough that
# DuckGate always has frames left to hold when the caller starts speaking.
_EMIT_SLEEP = CHUNK_MS / 2000.0
# A cache hit returns from run_tts only this long before its own audio ends.
# Emitting at ~2x real time used to hand the NEXT sentence to the vendor while
# the cached blob still had half its playout to go: that sentence's words were
# stamped from "now", inside the cached sentence, and the played transcript —
# the model's own context — came out interleaved (call d9aed777, 2026-09-25:
# "…पहली, faculty क्या आप इससे अच्छे सहमत हों हैं? और बच्चे के concepts…").
# 0.3 s ~ the vendor's first-audio time, so the live sentence still lands right
# behind the cached one with no added gap.
_NEXT_SENTENCE_LEAD_SECS = 0.3

# A cached sentence counts as HEARD once this share of its audio has played:
# its TTSTextFrame sits at that point in its audio, and the output transport
# releases frames in order, so the text reaches the played transcript (and the
# model's context) when the caller has heard that much. The same point a LIVE
# Navana sentence's text is released at (providers._navana_seq_routing) and
# NoRepeatGate's "mostly heard is heard" (bot.mostly_played).
HEARD_SHARE = 0.6


def ends_in_question(text: str) -> bool:
    """A clip whose last sentence asks something. Its text keeps the old place —
    behind the whole blob — because 60 % of a question is not the question: the
    opening's "…क्या मैं जान सकती हूँ कि किससे बात कर रही हूँ?" starts at 66 % of
    its text, so a "हाँ" that cut it at 61-79 % found the whole opening, '?'
    included, in the played transcript and got "[That was their ANSWER … Do NOT
    ask that question again]" for a question never heard (replay corpus,
    2026-10-02: four calls in every run, the ANSWER cue 3-4 → 8 per run). A cut
    question stays unheard and is asked again, as it always was."""
    t = (text or "").rstrip().rstrip("\"'”’)」")
    return t.endswith(("?", "？"))

# Field separator for the key tuple. \x1f (ASCII unit separator) cannot occur in
# TTS text, so no field can bleed into the next and collide two distinct inputs.
_SEP = "\x1f"

# G1: what counts as the end of a sentence.
#
# Taken from PIPECAT'S OWN set rather than restated here, because pipecat is what
# decides where run_tts's input was cut: its aggregator splits on exactly these
# characters (pipecat.utils.string.SENTENCE_ENDING_PUNCTUATION), so a second,
# narrower list would silently refuse whole utterances it split legitimately —
# ";" and the Devanagari double danda "॥" were both missing from the first
# hand-written version of this line.
#
# The fallback is a superset of what our Hindi/English agents can produce, and
# exists so this module stays importable (and unit-testable) without pipecat.
try:                                            # pragma: no cover - env dependent
    from pipecat.utils.string import SENTENCE_ENDING_PUNCTUATION as _PIPECAT_TERMINAL
    _TERMINAL = "".join(sorted(_PIPECAT_TERMINAL))
except Exception:                               # pragma: no cover - env dependent
    _TERMINAL = ".!?;…।॥。？！；．۔؟"
# Closing punctuation that may trail the terminal mark without making the text
# incomplete.
_TRAILING = "\"'’”)]》」»"

# Engines whose run_tts does NOT yield audio: it enqueues text and the audio
# arrives later on a receive loop. On these, a cached utterance appended
# instantly would play AHEAD of a vendor sentence still in flight, because
# pipecat reuses one audio context (one FIFO, drained in append order) for a
# whole turn -- reuse_context_id_within_turn defaults True.
#
# rumik is listed here for now although we own its sender loop and could inject
# in-order there; vendor_inflight is correct for it too, just more conservative.
_ASYNC_ARRIVAL_ENGINES = frozenset({"sarvam", "sarvam_v4", "smallest", "rumik", "navana"})


def per_sentence_contexts(tts) -> bool:
    """True when each sentence gets its OWN pipecat audio context.

    This is what makes cached audio safe to serve mid-turn on an async-arrival
    engine. With one context per turn (pipecat's default) every sentence shares
    a single FIFO drained in APPEND order, so a cached sentence — available
    instantly — lands ahead of vendor audio still in flight for an earlier
    sentence, and the caller hears them out of order. With one context per
    sentence they sit in separate slots on the serialization queue, drained in
    CREATION order, and arrival time stops mattering.
    """
    return not getattr(tts, "_reuse_context_id_within_turn", True)


def is_async_arrival(engine: str) -> bool:
    """True when the engine delivers audio out-of-band from run_tts (§ ordering)."""
    return (engine or "").strip().lower() in _ASYNC_ARRIVAL_ENGINES


def agent_allowed(allowlist, agent_id: str, agent_name: str) -> bool:
    """Is this agent in the rollout?

    The master switches are process-wide, so without this a single env flip would
    turn the cache on for every agent taking calls on the box. Rollout wants the
    opposite shape: one agent, one end-to-end test, then widen.

    An EMPTY allowlist means no restriction, not no agents — the master switches
    already default off, so this is the second gate. Matching accepts the agent id
    or its name because whoever edits /opt/voice-bot/.env is reading a screen that
    shows the name, and making them go and find a uuid is how the wrong agent ends
    up in the list.
    """
    if not allowlist:
        return True
    wanted = {a.strip().lower() for a in allowlist if a and a.strip()}
    if not wanted:
        return True
    return ((agent_id or "").strip().lower() in wanted
            or (agent_name or "").strip().lower() in wanted)


# Per-agent tiers, set in CRM -> Calling -> AI Agents and carried on the call
# context as `speech_cache_mode` (ai_agent.speech_cache_mode, V466).
MODE_OFF, MODE_FIXED, MODE_FULL = "OFF", "FIXED", "FULL"


def mode_allows(mode: str, is_fixed_line: bool) -> bool:
    """Does this agent's tier permit serving THIS sentence from cache?

    FIXED is the safe first tier: the bot's own authored lines are standalone
    utterances with no join to a neighbouring sentence, so the render-parity
    question (TTS_SPEECH_CACHE.md §11) cannot arise. FULL adds the LLM's
    sentences, where a cached and a live sentence can sit next to each other in
    one turn — that tier is earned per engine, by listening.

    Anything unrecognised is OFF. The only safe default for "may this agent
    replay stored audio" is no.
    """
    m = (mode or "").strip().upper()
    if m == MODE_FULL:
        return True
    if m == MODE_FIXED:
        return is_fixed_line
    return False


def scope_force_complete_to_ended_contexts(tts) -> bool:
    """pipecat force-completes EVERY pending sentence slot whenever an audio
    context ends (its assumption: one context per turn, so the end of a
    context is the end of the turn). With one context per SENTENCE that flush
    fires at every sentence end — and when a cached sentence's context closes
    promptly, the sentences queued behind it have their full text emitted at
    once, and then again word by word as they actually play. Every sentence
    after a cache hit landed twice in the played transcript and the model's
    own context (call 859c20ee, 2026-09-12: "Would you be open to a short
    demo…? Would you be open to a short demo…?").

    While a force-complete runs, hide the slots whose audio context is still
    queued (registered, not the one playing) — those sentences have not been
    spoken yet and their own context end will flush them. Idempotent."""
    seq = getattr(tts, "_aggregated_frame_sequencer", None)
    if seq is None or getattr(seq, "_vacademy_scoped", False):
        return False
    orig = seq.force_complete

    def _scoped(last_word_pts):
        try:
            playing = getattr(tts, "_playing_context_id", None)
            avail = getattr(tts, "audio_context_available", None)
            slots = list(seq._slots)
            hidden = [s for s in slots if s.spoken and not s.complete
                      and s.context_id != playing
                      and avail is not None and avail(s.context_id)]
        except Exception:
            logger.exception("tts-cache: scoped force-complete fell back to pipecat's")
            return orig(last_word_pts)
        if not hidden:
            return orig(last_word_pts)
        seq._slots = [s for s in slots if s not in hidden]
        try:
            return orig(last_word_pts)
        finally:
            kept = set(map(id, seq._slots))
            seq._slots = [s for s in slots if s in hidden or id(s) in kept]

    seq.force_complete = _scoped
    seq._vacademy_scoped = True
    return True


def owns_text_frame(tts) -> bool:
    """Whether WE must emit the TTSTextFrame for a cached sentence.

    Same principle as owns_turn_brackets: emit exactly what the wrapped engine
    would have emitted, no more. But the two flags point opposite ways here.

    When `push_text_frames` is set, pipecat appends its own TTSTextFrame after
    run_tts returns (tts_service.py:1129), so ours would be a DUPLICATE — the
    sentence would land in the played transcript and the assistant context
    twice. sarvam, deepgram, google and navana all set it. (There the hit path
    places a STATEMENT's text itself — at its heard point, not behind the whole
    blob — and CachedTextHandoff drops pipecat's copy, call 34452119; a clip
    that ends in a question keeps pipecat's copy, see ends_in_question.)

    When it is CLEAR the service uses word timestamps instead, and pipecat builds
    the text frames from the vendor's word-timing messages. A cache hit never
    calls the vendor, so those messages never arrive and NOTHING emits the frame.
    smallest is built this way (push_text_frames=not word_timestamps, and
    word_timestamps defaults True), which is how a served sentence came to be
    invisible to every "has the bot said this?" check on live call f425326e.

    Defaults to False on an unknown service: a missing frame degrades the repeat
    check, a duplicated one corrupts the transcript. Prefer the recoverable one.
    """
    return not getattr(tts, "_push_text_frames", True)


def heard_chunk_count(n_chunks: int, share: float = HEARD_SHARE) -> int:
    """How many of a cached blob's chunks go out before its TTSTextFrame: the
    first chunk boundary at or past `share` of the audio. At least one (the
    text never leads its audio), at most all of them."""
    if n_chunks <= 0:
        return 0
    return max(1, min(n_chunks, math.ceil(n_chunks * share - 1e-9)))


class CachedTextHandoff:
    """A cached sentence's text at its HEARD point, exactly once.

    Call 34452119 (2026-10-02, Navana, cache FULL): a reply sentence served
    from the cache as one 13.2 s clip; the caller cut in at 63 % of it. On a
    push_text_frames engine (navana, sarvam, google, deepgram) pipecat appends
    the sentence's TTSTextFrame after run_tts returns, i.e. BEHIND the whole
    blob, so the text reached the played transcript only if the clip played to
    its END. At the cut NoRepeatGate un-recorded it as never played ("un-recording
    never-played 'shiksha nation में हमारा focus…'") and the model's next reply
    said all 13 s of it again. A LIVE Navana sentence would have counted: its
    text is released at 60 % of its audio.

    So the hit path yields the TTSTextFrame itself, HEARD_SHARE of the way into
    the blob, and this drops the copy pipecat appends after run_tts returns —
    never two copies in the played transcript or the assistant context.

    The copy is identified by its context: `arm` is called as the cached
    run_tts returns, and pipecat's append for that context is the next thing
    the TTS task does (_push_tts_frames: run_tts, then the TTSTextFrame). Every
    run_tts call `clear`s first, so an arm whose append never came (an
    interruption landed in between) cannot outlive its own sentence and swallow
    a later one's text on a shared turn context."""

    def __init__(self):
        self._pending: dict = {}           # context_id -> text placed by the hit path

    def arm(self, context_id, text: str) -> None:
        self._pending[context_id] = text

    def clear(self) -> None:
        self._pending.clear()

    def take(self, context_id, frame) -> bool:
        """True: this is pipecat's late copy of a sentence already placed — drop it."""
        if context_id not in self._pending or getattr(frame, "_vacademy_cached_text", False):
            return False
        placed = self._pending.pop(context_id)
        if " ".join((frame.text or "").split()) != " ".join((placed or "").split()):
            # Still this sentence's frame (nothing else appends a TTSTextFrame to
            # its context between run_tts and pipecat's append) — only the text
            # differs, e.g. a text transform. Say so; one copy is still right.
            logger.warning("tts-cache: late text frame {!r} differs from the placed {!r} — "
                           "dropped anyway (one copy per sentence)",
                           (frame.text or "")[:40], (placed or "")[:40])
        return True

    def install(self, tts) -> bool:
        """Route the service's appends through take(). Instance attribute, so
        pipecat's own self.append_to_audio_context(...) calls come through here;
        every other frame passes to the service's method untouched."""
        from pipecat.frames.frames import TTSTextFrame
        orig = getattr(tts, "append_to_audio_context", None)
        if orig is None:
            return False

        async def append_to_audio_context(context_id, frame):
            if isinstance(frame, TTSTextFrame) and self.take(context_id, frame):
                logger.debug("tts-cache: dropping the base class's late text frame for a "
                             "cached sentence {!r}", (frame.text or "")[:40])
                return
            await orig(context_id, frame)

        tts.append_to_audio_context = append_to_audio_context
        return True


def owns_turn_brackets(tts) -> tuple:
    """(emit_started, emit_stopped) for a cached utterance on this service.

    A cached sentence must be indistinguishable from a synthesized one
    downstream, which means emitting exactly the frames the wrapped engine would
    have emitted — no more.

    pipecat's `_push_tts_frames` appends a TTSStartedFrame BEFORE calling
    run_tts whenever `push_start_frame` is set, and — because yielding a
    TTSAudioRawFrame sets `_is_yielding_frames_synchronously` —
    `on_turn_context_completed` appends the TTSStoppedFrame and closes the audio
    context whenever `push_stop_frames` is set. sarvam and google set both; our
    own EdgeTTSService sets neither and yields its own pair.

    Emitting a duplicate pair is not cosmetic: two TTSStartedFrames re-arm the
    stop-frame bookkeeping in `_handle_audio_context`, and BotStarted/Stopped
    Speaking drive the duck, the watchdog and every dead-air measurement.
    """
    return (not getattr(tts, "_push_start_frame", False),
            not getattr(tts, "_push_stop_frames", False))


# ── G1: completeness ────────────────────────────────────────────────────────

def is_complete(text: str) -> bool:
    """Is this a whole sentence, or a fragment we must never cache?

    Fragments reach TTS routinely, not exceptionally: pipecat's default
    aggregation is by sentence, but on LLMFullResponseEndFrame it FLUSHES the
    aggregator's remainder straight into TTS (tts_service.py:705-719), which is
    a partial clause whenever the response did not end on a boundary. A barge-in
    cuts a reply mid-sentence the same way.

    Caching such a fragment would render half a sentence and then play it, whole
    and standalone, to every future caller who matched it. So a fragment is not
    hashed, not looked up, and not laddered — it goes straight to the vendor.
    Skipping a cacheable sentence costs one render; caching a fragment costs
    every call that ever matches it.
    """
    t = (text or "").rstrip()
    t = t.rstrip(_TRAILING).rstrip()
    return bool(t) and t[-1] in _TERMINAL


def _num(v) -> str:
    """Stable numeric field for the key. 1.1 and 1.10 MUST hash identically, and
    None (engine default) must not collide with an explicit 0."""
    if v is None:
        return ""
    try:
        return f"{float(v):.4f}"
    except (TypeError, ValueError):
        return str(v)


#: Ledger rows written before per-agent provenance existed have no owner and
#: cannot gain one retroactively. They are reported under these sentinels so the
#: analytics screens show them for what they are, rather than silently losing
#: them to a join — which is exactly what happened on the first rollout.
UNATTRIBUTED = "(unattributed)"
UNATTRIBUTED_NAME = "(before per-agent tracking)"


def cache_key(*, engine: str, model: str, voice: str, pace, temperature,
              sample_rate: int, term_map_version: str, text: str,
              salt: Optional[str] = None, language: str | None = None) -> str:
    """sha256 over everything that changes the rendered audio.

    `text` must already be the exact string the vendor would receive (Rumik's
    Devanagari->Latin normalisation applied, outer whitespace stripped). No
    case-folding and no whitespace collapsing: every normalisation is another
    chance to serve audio that does not match the words.

    `engine` must be the engine ACTUALLY CONSTRUCTED, not ai_agent.tts_model —
    build_tts silently falls back to Sarvam on a missing key, so the configured
    value would file Sarvam audio under a google key and serve the wrong voice.
    """
    if salt is None:
        salt = get_settings().tts_cache_salt
    parts = (salt, (engine or "").lower(), model or "", voice or "",
             _num(pace), _num(temperature), str(sample_rate),
             term_map_version or "", text)
    if (engine or "").lower() == "navana":
        # One Navana voice id speaks ten languages: the same text in Hindi and
        # in Marathi is different audio, so the language is part of identity.
        from .providers import navana_language
        parts += ("language-v1", navana_language(language))
    if (engine or "").lower() == "smallest":
        from .speech_language import smallest_language_code
        # A new namespace: pre-language blobs may contain the wrong speech.
        parts += ("language-v1", smallest_language_code(language))
    return hashlib.sha256(_SEP.join(parts).encode("utf-8")).hexdigest()


# ── the store ───────────────────────────────────────────────────────────────

def plausible_duration(text: str, duration_ms: int, chars_per_sec: float = 12.0,
                       slack: float = 5.0, floor_ms: int = 4000) -> bool:
    """Could `text` really take `duration_ms` to say?

    Call f225f71e (2026-09-10): the cache served a 187,810 ms blob for
    "Got it." — a ~200 Hz vendor drone (the Smallest language-tag bug of the
    day before) stored as speech — and the caller heard three minutes of hum
    until they hung up; "Perfect." had a 50.6 s twin. A render longer than
    FIVE times what its text could take at a slow 12 chars/s (with a 4 s floor
    so normal short lines never trip it) is not speech, whatever the vendor
    says. Checked when storing AND when serving, so an already-poisoned cache
    heals itself on the next lookup."""
    expected_ms = max(1000.0, len(text or "") / chars_per_sec * 1000.0)
    return duration_ms <= max(floor_ms, slack * expected_ms)


@dataclass
class Entry:
    """One rendered blob, as held in the RAM index."""
    key: str
    path: str
    nbytes: int
    duration_ms: int
    text: str


@dataclass
class Candidate:
    """A sentence a live call proposes for caching. Not yet trusted."""
    key: str
    text: str
    chars: int
    engine: str
    model: str
    voice: str
    pace: Optional[float]
    temperature: Optional[float]
    fixed: bool = False          # a bot-authored line: exempt from G3/G4
    # Provenance for the analytics screens. Never part of the KEY — the key is
    # global so agents share blobs; this only records who contributed.
    agent_id: str = ""
    agent_name: str = ""
    institute_id: str = ""
    language: str = ""


_DDL = """
CREATE TABLE IF NOT EXISTS seen(
  key         TEXT PRIMARY KEY,
  engine      TEXT, model TEXT, voice TEXT,
  pace        REAL, temperature REAL,
  text        TEXT, chars INTEGER,
  count       INTEGER NOT NULL DEFAULT 0,
  fixed       INTEGER NOT NULL DEFAULT 0,
  first_seen  REAL, last_seen REAL,
  language    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS render_failure(
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  next_retry_at REAL NOT NULL,
  error TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blob(
  key         TEXT PRIMARY KEY,
  nbytes      INTEGER, duration_ms INTEGER,
  text        TEXT,
  hits        INTEGER NOT NULL DEFAULT 0,
  last_served REAL, created_at REAL
);
-- Which agents contributed to, and hit, each entry.
-- The KEY stays global so agents keep sharing blobs; this is a separate
-- dimension, not a change to identity. Without it the ledger cannot answer
-- "what has this agent cached", because nothing in it names an agent.
CREATE TABLE IF NOT EXISTS seen_agent(
  key          TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  agent_name   TEXT,
  institute_id TEXT,
  sightings    INTEGER NOT NULL DEFAULT 0,
  hits         INTEGER NOT NULL DEFAULT 0,
  last_hit_at  REAL,
  PRIMARY KEY (key, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_seen_agent_agent ON seen_agent(agent_id);
CREATE INDEX IF NOT EXISTS idx_seen_ready ON seen(count);
CREATE INDEX IF NOT EXISTS idx_blob_evict ON blob(hits, last_served);
"""


class SpeechCache:
    """Content-addressed audio store: the key IS the filename.

    Three stores, three jobs:
      * blob store  {dir}/{key}.pcm + .json  — the audio. No lookup table needed.
      * RAM index   dict[key] -> Entry       — what is on disk right now. The
                    hot-path lookup is a dict get: no syscall, no disk I/O, and
                    nothing that can block the event loop.
      * ledger      ledger.db (SQLite, WAL)  — candidate keys not yet rendered,
                    plus the blob metadata the index is rebuilt from at startup.

    Blob metadata lives in SQLite rather than in the sidecars so startup is ONE
    query instead of tens of thousands of file opens. The .json sidecars remain
    as a human-readable debug artefact and a rebuild source.
    """

    def __init__(self, root: Optional[str] = None):
        s = get_settings()
        self.root = root or s.speech_cache_dir
        self.db_path = os.path.join(self.root, "ledger.db")
        self._index: dict[str, Entry] = {}
        self._lock = asyncio.Lock()
        self._ready = False

    # -- lifecycle ----------------------------------------------------------

    def open(self) -> None:
        """Create the store and load the index. Blocking; call at startup or via
        to_thread. Never raises: a cache that cannot open is a cache that is off,
        not a bot that will not boot."""
        try:
            os.makedirs(self.root, exist_ok=True)
            with self._connect() as db:
                db.executescript(_DDL)
                # SQLite has no ADD COLUMN IF NOT EXISTS, and a ledger created
                # before this column existed is already on the box.
                try:
                    db.execute("ALTER TABLE seen ADD COLUMN fixed INTEGER NOT NULL DEFAULT 0")
                except sqlite3.OperationalError:
                    pass
                columns = {r[1] for r in db.execute("PRAGMA table_info(seen)")}
                if "language" not in columns:
                    db.execute("ALTER TABLE seen ADD COLUMN language TEXT NOT NULL DEFAULT ''")
                rows = db.execute(
                    "SELECT key, nbytes, duration_ms, text FROM blob").fetchall()
            idx: dict[str, Entry] = {}
            for key, nbytes, duration_ms, text in rows:
                path = self.blob_path(key)
                # A row whose file vanished (manual cleanup, volume reset) must
                # not sit in the index producing hits that 404 into silence.
                if os.path.exists(path):
                    idx[key] = Entry(key, path, nbytes, duration_ms, text)
            self._index = idx
            self._ready = True
            logger.info("tts-cache: {} entries loaded from {}", len(idx), self.root)
        except Exception:
            logger.exception("tts-cache: open failed — cache disabled for this process")
            self._ready = False

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=10)
        # WAL: up to MAX_CONCURRENT_CALLS writers flush at call end while the
        # sweeper reads. Without it they serialise on a global write lock.
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        return db

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def size(self) -> int:
        """Rendered blobs currently in the index."""
        return len(self._index)

    def blob_path(self, key: str) -> str:
        return os.path.join(self.root, key + ".pcm")

    def meta_path(self, key: str) -> str:
        return os.path.join(self.root, key + ".json")

    # -- read path ----------------------------------------------------------

    def lookup(self, key: str, text: str) -> Optional[Entry]:
        """G6 — verify before playing.

        Returns the entry only when the stored text is byte-identical to what we
        are about to speak. A hash collision, a corrupted row or a renamed file
        then degrades to a MISS (one vendor render) instead of confidently
        speaking the wrong words. It costs one string compare.
        """
        if not self._ready:
            return None
        entry = self._index.get(key)
        if entry is None:
            return None
        if entry.text != text:
            logger.warning("tts-cache: text mismatch for key {}… — treating as miss", key[:12])
            return None
        if not plausible_duration(entry.text, entry.duration_ms):
            logger.warning("tts-cache: {}ms blob for {!r} cannot be speech — discarding, "
                           "treating as miss", entry.duration_ms, entry.text[:40])
            self._index.pop(key, None)
            try:
                asyncio.get_running_loop().run_in_executor(None, self._discard_sync, key)
            except Exception:
                logger.debug("tts-cache: discard of implausible blob failed", exc_info=True)
            return None
        return entry

    async def read(self, entry: Entry) -> Optional[bytes]:
        """Load a blob off the event loop, re-validating size (G5).

        The size check is not paranoia about our own writer — it catches a
        truncated file from a disk-full or a half-finished manual copy, either of
        which would otherwise play as a clipped sentence.
        """
        try:
            data = await asyncio.to_thread(self._read_blob, entry.path)
        except Exception:
            logger.exception("tts-cache: read failed for {}", entry.key[:12])
            return None
        if data is None:
            return None
        if len(data) != entry.nbytes or len(data) % (SAMPLE_WIDTH * CHANNELS):
            logger.warning("tts-cache: blob {}… is {} bytes, expected {} — dropping",
                           entry.key[:12], len(data), entry.nbytes)
            await self.discard(entry.key)
            return None
        return data

    @staticmethod
    def _read_blob(path: str) -> Optional[bytes]:
        try:
            with open(path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None

    def note_hit(self, key: str) -> None:
        """Bump the serve counters. Fire-and-forget: eviction ordering is a
        nicety, and a lost increment must never cost a call."""
        try:
            asyncio.get_running_loop().create_task(self._note_hit_async(key))
        except RuntimeError:
            pass

    async def _note_hit_async(self, key: str) -> None:
        try:
            await asyncio.to_thread(self._bump_hit, key)
        except Exception:
            logger.debug("tts-cache: hit bookkeeping failed", exc_info=True)

    def _bump_hit(self, key: str) -> None:
        with self._connect() as db:
            db.execute("UPDATE blob SET hits = hits + 1, last_served = ? WHERE key = ?",
                       (time.time(), key))

    async def discard(self, key: str) -> None:
        """Remove a bad entry from the index, disk and db, together."""
        self._index.pop(key, None)
        try:
            await asyncio.to_thread(self._discard_sync, key)
        except Exception:
            logger.debug("tts-cache: discard failed", exc_info=True)

    def _discard_sync(self, key: str) -> None:
        for p in (self.blob_path(key), self.meta_path(key)):
            try:
                os.remove(p)
            except OSError:
                pass
        with self._connect() as db:
            db.execute("DELETE FROM blob WHERE key = ?", (key,))

    # -- write path (off-call only) -----------------------------------------

    def store(self, cand: Candidate, pcm: bytes) -> bool:
        """G5 — accept a render only if it is sound, and write it atomically.

        Blocking; the callers (warm route, sweeper) are already off the voice
        path. Returns False when the render was rejected, so the caller can log
        one line rather than silently believing it cached something.
        """
        try:
            if not pcm or len(pcm) % (SAMPLE_WIDTH * CHANNELS):
                logger.warning("tts-cache: refusing ragged render for {!r}", cand.text[:40])
                return False
            duration_ms = int(len(pcm) * 1000 / _BYTES_PER_SEC)
            if duration_ms < get_settings().tts_cache_min_blob_ms:
                # Too short to be a spoken sentence: a silent stub or a vendor
                # error page decoded to noise. Either would be dead air on a
                # real call.
                logger.warning("tts-cache: refusing {}ms render for {!r}",
                               duration_ms, cand.text[:40])
                return False
            if not plausible_duration(cand.text, duration_ms):
                # The other direction: a render far LONGER than its text could
                # take is vendor garbage (a drone, a stuck stream), and caching
                # it replays the failure on every future call.
                logger.warning("tts-cache: refusing {}ms render for {!r} — longer than "
                               "the text could possibly take", duration_ms, cand.text[:40])
                return False

            os.makedirs(self.root, exist_ok=True)
            path = self.blob_path(cand.key)
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "wb") as f:
                f.write(pcm)
            # Atomic: a concurrent reader never sees a partial file.
            os.replace(tmp, path)

            meta = {
                "key": cand.key, "engine": cand.engine, "model": cand.model,
                "voice": cand.voice, "pace": cand.pace,
                "temperature": cand.temperature, "sampleRate": SAMPLE_RATE,
                "text": cand.text, "chars": cand.chars, "language": cand.language,
                "bytes": len(pcm), "durationMs": duration_ms,
                "createdAt": time.time(),
            }
            tmpm = f"{self.meta_path(cand.key)}.{os.getpid()}.tmp"
            with open(tmpm, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
            os.replace(tmpm, self.meta_path(cand.key))

            now = time.time()
            with self._connect() as db:
                db.execute(
                    "INSERT INTO blob(key, nbytes, duration_ms, text, hits, last_served,"
                    " created_at) VALUES(?,?,?,?,0,?,?)"
                    " ON CONFLICT(key) DO UPDATE SET nbytes=excluded.nbytes,"
                    " duration_ms=excluded.duration_ms, text=excluded.text",
                    (cand.key, len(pcm), duration_ms, cand.text, now, now))
                db.execute("DELETE FROM render_failure WHERE key = ?", (cand.key,))
            self._index[cand.key] = Entry(cand.key, path, len(pcm), duration_ms, cand.text)
            logger.info("tts-cache: stored {}ms ({} chars) {}/{} {!r}",
                        duration_ms, cand.chars, cand.engine, cand.voice, cand.text[:48])
            return True
        except Exception:
            logger.exception("tts-cache: store failed for {!r}", cand.text[:40])
            return False

    # -- ledger -------------------------------------------------------------

    def note_hit_for_agent(self, key: str, agent_id: str, agent_name: str = "",
                           institute_id: str = "") -> None:
        """Attribute a cache hit to an agent. Fire-and-forget: analytics must
        never be a reason a call goes wrong."""
        if not (key and agent_id):
            return
        try:
            asyncio.get_running_loop().create_task(asyncio.to_thread(
                self._bump_agent_hit, key, agent_id, agent_name, institute_id))
        except RuntimeError:
            pass

    def _bump_agent_hit(self, key: str, agent_id: str, agent_name: str = "",
                        institute_id: str = "") -> None:
        """UPSERT, not UPDATE.

        A cache HIT never ladders — only the miss path adds a candidate — so the
        provenance row may not exist when the first hit lands. It certainly does
        not for anything laddered before per-agent tracking existed. A bare
        UPDATE matched zero rows there and threw the hit away silently, which is
        why every one of those entries read 0 hits no matter how often it was
        served. A hit is itself proof this agent spoke the line, so it is enough
        to create the row.
        """
        try:
            with self._connect() as db:
                db.execute(
                    "INSERT INTO seen_agent(key, agent_id, agent_name,"
                    " institute_id, sightings, hits, last_hit_at)"
                    " VALUES(?,?,?,?,0,1,?)"
                    " ON CONFLICT(key, agent_id) DO UPDATE SET"
                    " hits = hits + 1, last_hit_at = excluded.last_hit_at,"
                    " agent_name = COALESCE(NULLIF(excluded.agent_name,''), agent_name),"
                    " institute_id = COALESCE(NULLIF(excluded.institute_id,''), institute_id)",
                    (key, agent_id, agent_name or "", institute_id or "", time.time()))
        except Exception:
            logger.debug("tts-cache: agent hit bookkeeping failed", exc_info=True)

    def ladder(self, cands: Iterable[Candidate]) -> int:
        """Record qualifying sightings. Blocking; called at call end.

        One transaction for the whole call: a per-sentence commit would fsync up
        to a few dozen times while MAX_CONCURRENT_CALLS other calls are doing the
        same.
        """
        rows = list(cands)
        if not rows:
            return 0
        now = time.time()
        try:
            with self._connect() as db:
                for c in rows:
                    db.execute(
                        "INSERT INTO seen(key, engine, model, voice, pace, temperature,"
                        " text, chars, language, count, fixed, first_seen, last_seen)"
                        " VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)"
                        " ON CONFLICT(key) DO UPDATE SET count = count + 1,"
                        " fixed = MAX(seen.fixed, excluded.fixed), last_seen = ?",
                        (c.key, c.engine, c.model, c.voice, c.pace, c.temperature,
                         c.text, c.chars, c.language, 1 if c.fixed else 0, now, now, now))
                    if c.agent_id:
                        db.execute(
                            "INSERT INTO seen_agent(key, agent_id, agent_name,"
                            " institute_id, sightings, hits)"
                            " VALUES(?,?,?,?,1,0)"
                            " ON CONFLICT(key, agent_id) DO UPDATE SET"
                            " sightings = sightings + 1,"
                            " agent_name = excluded.agent_name,"
                            " institute_id = COALESCE(excluded.institute_id, institute_id)",
                            (c.key, c.agent_id, c.agent_name, c.institute_id))
            return len(rows)
        except Exception:
            logger.exception("tts-cache: ladder failed")
            return 0

    def due(self, limit: int = 25) -> list[Candidate]:
        """What is worth one render, and not yet rendered.

        TTS_CACHE_MIN_SEEN exists for ONE reason: an LLM sentence might be a
        one-off — "Namaste Rohan ji" for a name that never recurs — and rendering
        it buys nothing. It now defaults to 1, because that hedge turned out to
        cost more than it saved: rendering on the first sighting makes a sentence
        free from its SECOND use instead of its third, so it wins whenever the
        line recurs at all and loses one cheap off-call render when it does not.
        Raise it if the ledger ever shows a fat never-recurring tail.

        That reasoning is simply false for a fixed line. The opening, the
        farewells, the handbacks and the fillers are authored, and every one of
        them is spoken on every call by construction; there is no "might not
        recur" to hedge against. Making them wait for a second sighting delays
        the only lines guaranteed to pay off, which is the opposite of what the
        threshold is for. So fixed lines qualify on the FIRST sighting, and
        ORDER BY puts them ahead of the speculative ones when a pass is capped.
        """
        try:
            min_seen = get_settings().tts_cache_min_seen
            with self._connect() as db:
                rows = db.execute(
                    "SELECT s.key, s.text, s.chars, s.engine, s.model, s.voice,"
                    " s.pace, s.temperature, s.language FROM seen s"
                    " LEFT JOIN blob b ON b.key = s.key"
                    " LEFT JOIN render_failure f ON f.key = s.key"
                    " WHERE b.key IS NULL AND (s.fixed = 1 OR s.count >= ?)"
                    " AND (f.key IS NULL OR (f.attempts < 3 AND f.next_retry_at <= ?))"
                    # Legacy Smallest rows have no trustworthy language or key.
                    # Live calls ladder fresh entries under the new namespace.
                    " AND (s.engine != 'smallest' OR s.language IN ('en', 'hi'))"
                    " ORDER BY s.fixed DESC, s.count DESC, s.last_seen DESC LIMIT ?",
                    (min_seen, time.time(), limit)).fetchall()
            return [Candidate(key=r[0], text=r[1], chars=r[2], engine=r[3],
                              model=r[4], voice=r[5], pace=r[6], temperature=r[7], language=r[8])
                    for r in rows]
        except Exception:
            logger.exception("tts-cache: due query failed")
            return []

    def can_render(self, key: str) -> bool:
        """Persistent retry budget, also respected by repeated warm-on-save requests."""
        try:
            with self._connect() as db:
                row = db.execute("SELECT attempts, next_retry_at FROM render_failure WHERE key = ?",
                                 (key,)).fetchone()
            return row is None or (row[0] < 3 and row[1] <= time.time())
        except Exception:
            logger.exception("tts-cache: retry state unreadable — deferring render")
            return False

    def render_failed(self, key: str, error: str) -> None:
        """Retry twice (after 5 and 30 minutes), then quarantine until forgotten.

        A voice/model/language/text change creates a new key with a fresh budget.
        No network or retry work ever runs on the live audio path.
        """
        try:
            with self._connect() as db:
                db.execute(
                    "INSERT INTO render_failure(key, attempts, next_retry_at, error) VALUES(?,1,?,?)"
                    " ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1,"
                    " next_retry_at = ?, error = excluded.error",
                    (key, time.time() + 300, error[:300], time.time() + 1800))
            logger.warning("tts-cache: render deferred for {}: {}", key[:12], error[:100])
        except Exception:
            logger.exception("tts-cache: could not persist render failure")

    def export_for_report(self, limit: int = 2000) -> list:
        """The ledger joined to its provenance, shaped for admin-core.

        LEFT JOIN on blob: a row with no blob is not missing data, it is the
        answer to "what is not cached yet" — the misses screen is exactly these
        rows. Bounded, because a report is not a reason to load an unbounded
        result set into memory on a box that is also carrying live calls.

        LEFT JOIN on seen_agent for the same reason, learned the hard way: this
        was an INNER JOIN, and seen_agent is only written for a candidate that
        carries an agent_id. Every sentence laddered before per-agent tracking
        existed therefore had no provenance row, so a ledger holding 73 real
        sentences exported ZERO and the analytics table stayed empty with no
        error anywhere. Those rows are reported under a sentinel agent instead
        of being dropped: their sightings are real (seen.count), their hits are
        not knowable per agent and so read 0. Labelling what we do not know
        beats both discarding it and inventing an owner for it.
        """
        try:
            with self._connect() as db:
                rows = db.execute(
                    "SELECT s.key,"
                    "       COALESCE(sa.agent_id, ?), COALESCE(sa.agent_name, ?),"
                    "       sa.institute_id,"
                    " s.engine, s.model, s.voice, s.text, s.chars, s.fixed,"
                    "       COALESCE(sa.sightings, s.count), COALESCE(sa.hits, 0),"
                    "       sa.last_hit_at,"
                    " s.first_seen, s.last_seen,"
                    " b.key IS NOT NULL, b.nbytes, b.duration_ms"
                    " FROM seen s"
                    " LEFT JOIN seen_agent sa ON sa.key = s.key"
                    " LEFT JOIN blob b ON b.key = s.key"
                    " ORDER BY COALESCE(sa.hits, 0) DESC, s.chars DESC LIMIT ?",
                    (UNATTRIBUTED, UNATTRIBUTED_NAME, limit)).fetchall()
            out = []
            for r in rows:
                out.append({
                    "cacheKey": r[0], "agentId": r[1], "agentName": r[2],
                    "instituteId": r[3], "engine": r[4], "model": r[5],
                    "voice": r[6], "sentence": r[7], "chars": r[8],
                    "isFixed": bool(r[9]), "sightings": r[10], "hits": r[11],
                    "lastHitAt": r[12], "firstSeenAt": r[13], "lastSeenAt": r[14],
                    "rendered": bool(r[15]), "bytes": r[16], "durationMs": r[17],
                })
            return out
        except Exception:
            logger.exception("tts-cache: export failed")
            return []

    def forget(self, *, agent_id: str = "", cache_key: str = "",
               dry_run: bool = True) -> tuple:
        """Flush one entry, or everything one agent contributed to.

        Returns (entries, bytes, note). A dry run reports what WOULD go and
        deletes nothing — the default everywhere, because the destructive
        reading of an ambiguous request is the wrong one.

        A blob is only deleted when NO OTHER AGENT still references it. The key
        is global, so agents share renders; flushing one agent must not silently
        take audio another is still serving.
        """
        try:
            with self._connect() as db:
                if cache_key:
                    keys = [cache_key]
                elif agent_id:
                    keys = [r[0] for r in db.execute(
                        "SELECT key FROM seen_agent WHERE agent_id = ?", (agent_id,))]
                else:
                    return (0, 0, "neither agent_id nor cache_key given")

                shared, removable = [], []
                for k in keys:
                    others = db.execute(
                        "SELECT count(*) FROM seen_agent WHERE key = ? AND agent_id <> ?",
                        (k, agent_id or "")).fetchone()[0]
                    (shared if others > 0 and not cache_key else removable).append(k)

                freed = 0
                for k in removable:
                    row = db.execute("SELECT nbytes FROM blob WHERE key = ?", (k,)).fetchone()
                    if row and row[0]:
                        freed += int(row[0])

                note = "%d entr%s, %d shared with another agent and kept" % (
                    len(removable), "y" if len(removable) == 1 else "ies", len(shared))
                if dry_run:
                    return (len(removable), freed, "DRY RUN — " + note)

                for k in removable:
                    self._index.pop(k, None)
                    self._discard_sync(k)
                    db.execute("DELETE FROM seen WHERE key = ?", (k,))
                    db.execute("DELETE FROM render_failure WHERE key = ?", (k,))
                if agent_id:
                    db.execute("DELETE FROM seen_agent WHERE agent_id = ?", (agent_id,))
                elif cache_key:
                    db.execute("DELETE FROM seen_agent WHERE key = ?", (cache_key,))
                return (len(removable), freed, note)
        except Exception as e:
            logger.exception("tts-cache: forget failed")
            return (0, 0, "failed: %s" % e)

    def repeat_report(self, limit: int = 40) -> list[dict]:
        """What actually repeats, per engine/voice. This is the number that says
        whether the LLM-sentence half of the cache is worth its complexity."""
        try:
            with self._connect() as db:
                rows = db.execute(
                    "SELECT engine, voice, count, chars, text FROM seen"
                    " ORDER BY count DESC, chars DESC LIMIT ?", (limit,)).fetchall()
                totals = db.execute(
                    "SELECT COUNT(*), SUM(count), SUM(CASE WHEN count > 1 THEN 1 ELSE 0 END)"
                    " FROM seen").fetchone()
            return [{"engine": r[0], "voice": r[1], "count": r[2], "chars": r[3],
                     "text": r[4], "distinct": totals[0], "sightings": totals[1],
                     "repeated": totals[2]} for r in rows]
        except Exception:
            logger.exception("tts-cache: repeat report failed")
            return []

    # -- eviction -----------------------------------------------------------

    def evict(self) -> int:
        """Bound the namespace by bytes, least-valuable first.

        Order is (hits ASC, last_served ASC) — NOT plain LRU. A line hit 500
        times is the whole point of the cache and must outlive write-once junk;
        that is the same reasoning that already protects warmed IVR prompts in
        _evict_tts_cache. Blocking; run from the sweeper.
        """
        try:
            budget = get_settings().tts_speech_cache_max_bytes
            with self._connect() as db:
                total = db.execute("SELECT COALESCE(SUM(nbytes), 0) FROM blob").fetchone()[0]
                if total <= budget:
                    return 0
                rows = db.execute(
                    "SELECT key, nbytes FROM blob ORDER BY hits ASC, last_served ASC").fetchall()
            removed = 0
            for key, nbytes in rows:
                if total <= budget:
                    break
                self._index.pop(key, None)
                self._discard_sync(key)
                total -= nbytes or 0
                removed += 1
            if removed:
                logger.warning("tts-cache: evicted {} entries (budget {} bytes)", removed, budget)
            return removed
        except Exception:
            logger.exception("tts-cache: eviction failed")
            return 0

# ── the shared instance ─────────────────────────────────────────────────────

_CACHE: Optional[SpeechCache] = None


def get_cache() -> SpeechCache:
    global _CACHE
    if _CACHE is None:
        _CACHE = SpeechCache()
    return _CACHE


# ── runtime: the pipeline pieces ────────────────────────────────────────────

class TtsTurnWatcher:
    """Sits immediately AFTER tts. Knows two things the wrapper cannot see.

    1. `vendor_inflight` — whether a websocket engine still owes us audio.

       pipecat 1.4 reuses ONE audio context for a whole LLM turn
       (reuse_context_id_within_turn defaults True), and a context is a single
       FIFO drained in APPEND order. Cached audio appends instantly; vendor audio
       appends when it arrives, typically 200-400 ms later. So a cached sentence
       appended while a vendor sentence is outstanding would be heard FIRST.
       The caller would get sentence 3 before sentence 2 — intermittently, only
       on partial-hit turns, which is the worst failure shape there is.

       The wrapper therefore refuses to serve from cache while this is set. That
       costs hit rate on partial-hit turns and costs nothing else: the first
       sentence of every turn always has it clear (and that is the sentence
       gating TTFB), as does every standalone TTSSpeakFrame.

    2. `interrupted_since(t)` — whether the caller talked over a sentence while
       it was being synthesized (G2). A sentence the caller barged over tells us
       nothing about whether it would have played correctly, so it must not
       become a cache candidate.
    """

    def __init__(self):
        self.vendor_inflight = False
        self.last_interrupt_t = 0.0

    def note_vendor_dispatch(self) -> None:
        self.vendor_inflight = True

    def interrupted_since(self, t0: float) -> bool:
        return self.last_interrupt_t >= t0

    def observe(self, frame) -> None:
        """Called from the pipeline processor. Cheap and total — a bookkeeping
        error must never touch the call."""
        try:
            name = type(frame).__name__
            if name in ("TTSStoppedFrame", "EndFrame"):
                self.vendor_inflight = False
            elif "Interruption" in name or name in ("CancelFrame", "StartInterruptionFrame"):
                self.vendor_inflight = False
                self.last_interrupt_t = time.time()
        except Exception:
            pass


class CallCandidates:
    """Per-call candidate list, and the end-of-call admission of G3 and G4.

    Nothing here is written to the cache. This only decides which sentences
    EARNED a sighting in the ledger — a sighting being the claim "this exact
    audio was delivered, in full, to a real caller, on a call that worked".
    """

    def __init__(self, cache: SpeechCache):
        self._cache = cache
        self._items: list[Candidate] = []
        self._enabled = True

    def add(self, cand: Candidate) -> None:
        """Propose a sentence. Re-checks completeness ON PURPOSE.

        The wrapper already applies G1 before a key is ever derived, so this is
        redundant today — deliberately. The counter's whole meaning is "this
        exact, WHOLE sentence was delivered N times"; if a later edit to the
        wrapper ever lets a flush remainder through, the count would silently
        start certifying half a sentence, and the resulting blob would be played
        to every future caller who matched it. A structural guarantee here costs
        one call to is_complete and cannot be refactored away by accident.
        """
        if not self._enabled:
            return
        if not is_complete(cand.text):
            logger.warning("tts-cache: refusing incomplete candidate {!r}", cand.text[:48])
            return
        # Bounded: a runaway generation must not grow this without limit.
        if len(self._items) < 400:
            self._items.append(cand)

    def flush(self, *, played_text: str, verdict_faults: Iterable[str],
              health: str) -> int:
        """Apply G4 then G3, then ladder the survivors. Blocking; call at call end.

        G4 — the call has to have been healthy enough for what this sentence
        actually claims. TWO STANDARDS, because the two kinds of candidate make
        different claims:

        A FIXED line claims only "this authored string is worth rendering". Its
        audio comes from an off-call one-shot synthesis of a string an admin
        wrote; nothing about how the conversation went bears on it. So only the
        faults that implicate AUDIO can veto it — synthesis wedged, the bot went
        silent, a reply never played, the pipeline crashed.

        An LLM SENTENCE claims "the model said this, and will plausibly say it
        again". That leans on the conversation having worked, so it keeps a
        stricter bar — but a NAMED one: STT_DEAF (we could not hear, so the reply
        may be answering nothing) and REPLY_LOOP (the model was repeating itself)
        on top of the audio faults. The RED VERDICT ITSELF DOES NOT VETO.

        Letting overall call health veto a per-sentence question was the original
        error here, and it took two rounds to get out of. Live agent shreya-v3
        showed both: with one strict rule its opening line could only be learned
        from one call in three, and once that was narrowed, FULL still cached
        nothing at all -- 62 and 46 LLM sentences discarded on two consecutive
        calls whose only fault was DEAD_AIR. Long silences say nothing about
        whether "exact fees teen cheezon par depend karti hai" is worth keeping;
        it is near-verbatim on every call. The agent is RED on essentially every
        call, so the blanket veto meant FULL could never learn anything, ever.

        G3 — an LLM sentence must appear in the PLAYED transcript, which
        PlayedTranscriptRecorder builds from TTSTextFrames released by the
        transport at playout position, i.e. text the caller actually HEARD.
        This is the same test NoRepeatGate runs to un-record never-played
        sentences (bot.py:918-922) after live call 4b1a44b9, whose lesson was
        exactly this: "'Already said' has to mean 'already HEARD'."
        """
        if not self._items:
            return 0
        try:
            faults = set(verdict_faults or ())
            audio_bad = faults & _AUDIO_BLOCKING_FAULTS
            # NAMED faults only — the RED verdict itself does not veto.
            # See the docstring: RED is a summary of how the CALL went, and a call
            # can be RED purely for long silences while every sentence in it was
            # spoken correctly and is worth caching.
            convo_bad = faults & _CACHE_BLOCKING_FAULTS

            # normalize_spoken is NoRepeatGate's own comparator: whitespace
            # collapsed and case-folded. Used for the CONFIRMATION only — the
            # cache key itself stays byte-exact — because PlayedTranscriptRecorder
            # space-joins per-word TTSTextFrames, so an exact compare would fail
            # on punctuation spacing alone.
            from .turntake import normalize_spoken
            played = normalize_spoken(played_text or "")

            heard, unheard, dropped = [], 0, 0
            for c in self._items:
                if c.fixed:
                    if audio_bad:
                        dropped += 1
                    else:
                        heard.append(c)
                elif convo_bad:
                    dropped += 1
                elif played and normalize_spoken(c.text) in played:
                    heard.append(c)
                else:
                    unheard += 1
            self._items = []
            if dropped:
                logger.info("tts-cache: dropped {} candidate(s) — health={} audio_faults={}",
                            dropped, health, sorted(audio_bad) or "none")
            if unheard:
                logger.info("tts-cache: {} candidate(s) never reached the caller — not laddered",
                            unheard)
            return self._cache.ladder(heard)
        except Exception:
            logger.exception("tts-cache: flush failed — nothing laddered")
            self._items = []
            return 0


# Faults that implicate the AUDIO itself: synthesis stalled, the bot produced
# nothing, a reply never reached the caller, the pipeline died. These are the only
# ones that can say anything about whether a rendered string is trustworthy, so
# they are the only ones that veto a FIXED line. Names match diagnostics.py.
_AUDIO_BLOCKING_FAULTS = frozenset({
    "CRASH", "BOT_SILENT", "TTS_WEDGE", "REPLY_UNPLAYED",
})

# The stricter bar, for an LLM sentence — whose claim ("the model will plausibly
# say this again") does lean on the conversation having worked. Adds the two
# faults that genuinely undermine it: we could not HEAR the caller, or the model
# was repeating ITSELF. Deliberately NOT the RED verdict — see flush().
_CACHE_BLOCKING_FAULTS = _AUDIO_BLOCKING_FAULTS | frozenset({
    "STT_DEAF", "REPLY_LOOP",
})


def make_turn_watcher_processor(watcher: TtsTurnWatcher):
    """A pass-through FrameProcessor that feeds the watcher. Goes immediately
    after `tts` in the chain, where every frame the engine produces passes."""
    from pipecat.processors.frame_processor import FrameProcessor

    class _TtsTurnWatcherProcessor(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            watcher.observe(frame)
            await self.push_frame(frame, direction)

    return _TtsTurnWatcherProcessor()


def install_tts_cache(tts, *, engine: str, model: str, voice: str, pace,
                      temperature, term_map_version: str = "", language: str | None = None,
                      fixed_lines: Optional[set] = None,
                      agent_id: str = "", agent_name: str = "",
                      institute_id: str = "", cache_mode: str = MODE_OFF,
                      normalize=None, diag=None,
                      cache: Optional[SpeechCache] = None,
                      watcher: Optional[TtsTurnWatcher] = None,
                      candidates: Optional[CallCandidates] = None):
    """Wrap a constructed TTS service so identical sentences are not paid for twice.

    ONE wrapper covers both paths — the bot's own fixed lines (which arrive as
    TTSSpeakFrame) and the LLM's sentences — because pipecat routes both through
    run_tts. An earlier design intercepted TTSSpeakFrame in a processor placed
    before `tts`; that is wrong, because TTSTextFrame subclasses TextFrame, so
    frames emitted upstream of the service are re-aggregated and SPOKEN TWICE.

    The wrapper only ever READS the cache. Writing happens off-call (§ renderer),
    so nothing a live call does can put audio in front of a future caller.
    """
    from pipecat.frames.frames import (TTSAudioRawFrame, TTSStartedFrame,
                                       TTSStoppedFrame, TTSTextFrame,
                                       AggregationType)

    from .providers import has_word_char

    s = get_settings()
    cache = cache or get_cache()
    watcher = watcher or TtsTurnWatcher()
    fixed = {t for t in (fixed_lines or set()) if t}
    engine_l = (engine or "").strip().lower()
    from .speech_language import smallest_language_code
    render_language = smallest_language_code(language) if engine_l == "smallest" else ""
    if engine_l == "navana":
        from .providers import navana_language
        render_language = navana_language(language)
    async_arrival = is_async_arrival(engine_l)
    original = tts.run_tts
    # Resolved ONCE per call, not per sentence: the allowlist cannot change
    # mid-call, and re-deciding it 40 times a call would only invite a race.
    in_rollout = agent_allowed(s.tts_cache_agents, agent_id, agent_name)

    # NOT INSTALLED AT ALL when this agent cannot use the cache. Returning None
    # here rather than installing a wrapper that would decline per sentence is
    # the difference between "my code decided to do nothing" and "my code never
    # ran" — and for a feature that is OFF for every agent by default, only the
    # second is worth asserting. It also keeps the pipeline chain and the
    # engine's own run_tts byte-identical to today, so there is no extra
    # generator layer, no normalise call, and nothing of mine on the hot path.
    can_serve_anything = ((mode_allows(cache_mode, True) and s.tts_cache_speech_enabled)
                          or (mode_allows(cache_mode, False) and s.tts_cache_llm_enabled))
    if not (can_serve_anything and in_rollout):
        logger.info("tts-cache: NOT installed engine={} agent={} mode={} rollout={} "
                    "kill_speech={} kill_llm={} — call is untouched",
                    engine_l, agent_id or agent_name or "?",
                    (cache_mode or MODE_OFF).upper(), "in" if in_rollout else "OUT",
                    s.tts_cache_speech_enabled, s.tts_cache_llm_enabled)
        return None

    # ONE CONTEXT PER SENTENCE, for enabled agents on an async-arrival engine.
    #
    # This is the fix for the ordering guard starving the cache. pipecat's
    # create_context_id() reuses one context id for a whole turn by default, so
    # every sentence of that turn shares a single FIFO drained in APPEND order.
    # Cached audio is on disk and appends instantly; vendor audio appends when
    # the websocket delivers it. Serve a cached sentence behind a vendor one and
    # the caller hears them swapped — so TtsTurnWatcher refused to serve at all
    # once anything in the turn had gone to the vendor. And because
    # TTSStoppedFrame brackets the whole TURN on these engines, ONE miss early in
    # a turn forced every later sentence to the vendor with its audio sitting
    # ready. Measured on live call a2d883c4: 14 sentences, 955 characters,
    # already rendered and already paid for, re-synthesised anyway.
    #
    # With a context per sentence they occupy separate slots on the
    # serialization queue, which is drained in CREATION order — so position is
    # fixed when run_tts is called and arrival time stops mattering.
    #
    # Set HERE, after the not-installed return, so it can only ever affect an
    # agent whose cache is on. Every other agent keeps today's exact turn
    # bracketing. The cost for the ones that opt in is that TTSStarted/Stopped —
    # and so BotStartedSpeaking/BotStoppedSpeaking — fire per sentence rather
    # than per turn; google already behaves that way in production, which is the
    # evidence the pipeline handles the shape.
    if async_arrival and getattr(tts, "_reuse_context_id_within_turn", False):
        tts._reuse_context_id_within_turn = False
        logger.info("tts-cache: per-sentence audio contexts enabled for {} — "
                    "cached audio can now be served mid-turn", engine_l)
    if per_sentence_contexts(tts):
        scope_force_complete_to_ended_contexts(tts)

    # HEARD BY AUDIO, NOT BY THE END OF THE CLIP (call 34452119). On a
    # push_text_frames engine a cached sentence's text now sits HEARD_SHARE of
    # the way into its blob and pipecat's late copy is dropped (CachedTextHandoff).
    # Word-timestamp engines (smallest) own their text frame already — their
    # words are spread over the blob — and are left exactly as they were.
    handoff = None
    if not owns_text_frame(tts):
        _h = CachedTextHandoff()
        if _h.install(tts):
            handoff = _h

    def _bump(name: str, *args) -> None:
        if diag is None:
            return
        try:
            getattr(diag, name)(*args)
        except Exception:
            pass

    async def run_tts(text: str, context_id: str = None):
        if handoff is not None:
            # The previous sentence's late copy has been appended (or never will
            # be): pipecat calls run_tts strictly after it.
            handoff.clear()
        norm = text
        try:
            if normalize is not None:
                norm = normalize(text)
            norm = (norm or "").strip()
        except Exception:
            logger.exception("tts-cache: normalise failed — bypassing cache")
            async for f in original(text, context_id):
                yield f
            return

        # Preserve the existing letterless skip EXACTLY: Sarvam rejects a
        # letterless chunk with an error pipecat only logs, leaving an
        # open-but-dead socket and 8-10s of dead air. The cache must not change
        # which inputs reach that guard.
        if not has_word_char(norm):
            async for f in original(text, context_id):
                yield f
            return

        is_fixed = norm in fixed
        # Three gates, and they answer three different questions:
        #   mode_allows   — did an ADMIN turn this on for this agent? (the product
        #                   decision, per agent, no restart, V466)
        #   env switch    — is the feature allowed on this box at all? (ops kill
        #                   switch: stop it fleet-wide in one restart without
        #                   touching anybody's configuration)
        #   in_rollout    — optional extra ops restriction (TTS_CACHE_AGENTS)
        enabled = (mode_allows(cache_mode, is_fixed)
                   and in_rollout
                   and (s.tts_cache_speech_enabled if is_fixed
                        else s.tts_cache_llm_enabled))

        # G1. A fragment is not hashed, not looked up, and not laddered.
        if not enabled or not is_complete(norm):
            async for f in original(text, context_id):
                yield f
            return

        key = ""
        try:
            key = cache_key(engine=engine_l, model=model, voice=voice, pace=pace,
                            temperature=temperature, sample_rate=SAMPLE_RATE,
                            term_map_version=term_map_version, text=norm, language=render_language)
        except Exception:
            logger.exception("tts-cache: key derivation failed — bypassing cache")

        # Ordering (§ TtsTurnWatcher): on an async-arrival engine we may only
        # serve when the vendor owes us nothing, or the cached audio would be
        # heard before audio that was requested earlier.
        # The ordering guard is only needed while a turn shares one context. With
        # a context per sentence pipecat fixes the order at creation time, so a
        # cached sentence can be served even with vendor audio still in flight.
        may_serve = key and (not async_arrival
                             or per_sentence_contexts(tts)
                             or not watcher.vendor_inflight)

        if not may_serve and s.tts_cache_debug:
            # The ordering guard, not the cache, refused this one. Worth its own
            # wording: it looks identical to a cold cache from the outside, and
            # chasing a "miss" that was really a deferral wastes a rollout.
            logger.info("tts-cache: MISS (vendor in flight, ordering) {!r}", norm[:48])

        if may_serve:
            entry = cache.lookup(key, norm)          # G6 verifies the stored text
            if entry is None and s.tts_cache_debug:
                logger.info("tts-cache: MISS (not stored) key={} {!r}", key[:12], norm[:48])
            if entry is not None:
                blob = await cache.read(entry)       # G5 re-checks the length
                if blob:
                    _bump("note_tts_cache_hit", entry.duration_ms, len(norm))
                    cache.note_hit(key)
                    cache.note_hit_for_agent(key, agent_id, agent_name,
                                             institute_id)
                    logger.info("tts-cache: HIT {}ms {!r}", entry.duration_ms, norm[:48])

                    # Emit the turn brackets ONLY if the base class is not already
                    # doing it, or the caller hears two of everything.
                    #
                    # _push_tts_frames appends a TTSStartedFrame BEFORE calling
                    # run_tts when push_start_frame is set (sarvam and google both
                    # set it; our EdgeTTSService does not and yields its own). And
                    # because yielding TTSAudioRawFrame sets
                    # _is_yielding_frames_synchronously, on_turn_context_completed
                    # then appends the TTSStoppedFrame and closes the audio context
                    # for us when push_stop_frames is set. Mirroring the wrapped
                    # engine's own contract is what keeps a cached sentence
                    # indistinguishable from a synthesized one downstream.
                    own_start, own_stop = owns_turn_brackets(tts)
                    own_text = owns_text_frame(tts)
                    # push_text_frames engines: the sentence's text goes out
                    # HEARD_SHARE of the way into the blob, built as pipecat
                    # builds its own (the text without the trailing space
                    # _prepare_text_for_tts may add; the context's
                    # append_to_context — a re-said opening is False), and
                    # pipecat's copy after run_tts is dropped.
                    placed = None
                    if handoff is not None and not ends_in_question(text):
                        placed = TTSTextFrame(
                            text[:-1] if (getattr(tts, "_append_trailing_space", False)
                                          and text.endswith(" ")) else text,
                            aggregated_by=AggregationType.SENTENCE)
                        placed.context_id = context_id
                        placed.will_be_spoken = True
                        _meta = (getattr(tts, "_tts_contexts", None) or {}).get(context_id)
                        if _meta is not None:
                            placed.append_to_context = _meta.append_to_context
                        placed._vacademy_cached_text = True
                    text_after = heard_chunk_count(
                        -(-len(blob) // _CHUNK_BYTES)) if placed is not None else 0
                    if own_start:
                        # Only start the clock when the base class did not: on
                        # sarvam/google _push_tts_frames already called
                        # start_ttfb_metrics, and restarting it would measure from
                        # here instead of from when pipecat began waiting —
                        # flattering the number by hiding our own lookup and read.
                        await tts.start_ttfb_metrics()
                        yield TTSStartedFrame(context_id=context_id)
                    await tts.stop_ttfb_metrics()
                    emit_t0 = time.monotonic()
                    for n_out, i in enumerate(range(0, len(blob), _CHUNK_BYTES), 1):
                        yield TTSAudioRawFrame(blob[i:i + _CHUNK_BYTES],
                                               SAMPLE_RATE, CHANNELS,
                                               context_id=context_id)
                        if n_out == text_after:
                            # Between the chunks: the transport writes frames in
                            # order, so this reaches the played transcript once
                            # the caller has HEARD this much of the sentence. A
                            # cut before it (DuckGate holds it, the interruption
                            # drops it) leaves the sentence unheard and re-sayable.
                            yield placed
                        # PACED, not dumped. A cached blob is available all at
                        # once, and emitting it in one burst would put the whole
                        # utterance past DuckGate and into the output queue
                        # before the caller has drawn breath — which is exactly
                        # the condition that made barge-in feel slow before
                        # AUDIO_MAX_LEAD_SECS (live call d6e82def: "dropping 0
                        # held frame(s)" on an interrupt, 1.96s of talk-over).
                        #
                        # Streaming vendor audio arrives at roughly the vendor's
                        # pace, so ducking always has frames still to hold. Half
                        # a chunk's wall time per chunk reproduces that: ~2x real
                        # time, the same rate pipecat's own websocket output
                        # uses. It costs NOTHING in playback latency — the
                        # transport paces the line regardless — and it keeps the
                        # amount of already-committed audio identical to today.
                        await asyncio.sleep(_EMIT_SLEEP)

                    # THE frame that makes a cache hit count as speech.
                    #
                    # smallest/sarvam are built with word_timestamps=True, so
                    # pipecat sets push_text_frames=False and builds TTSTextFrames
                    # from the vendor's word-timing messages. A cache hit never
                    # calls the vendor, so those messages never arrive and the
                    # sentence produced ZERO TTSTextFrames. Everything downstream
                    # reads speech from that frame, so a cached sentence was
                    # invisible: PlayedTranscriptRecorder never logged it,
                    # NoRepeatGate's "already said" test could never match it, and
                    # the model was free to say it again and again. Live call
                    # f425326e: one 8.2s line played THREE times (envelope
                    # correlation 0.996 — the same blob, not a re-synthesis),
                    # REPLY_LOOP, and 30 unsaid-reverts.
                    #
                    # AFTER the audio, not before, because that is where the base
                    # class appends its own (tts_service.py:1129, after
                    # tts_process_generator returns). The transport releases it at
                    # playout position, so a sentence the caller was interrupted
                    # over is still correctly treated as NOT heard — "'already
                    # said' has to mean 'already HEARD'".
                    # SENTENCE, because G1 only admits a complete sentence to the
                    # cache in the first place, and it is pipecat's own default
                    # aggregation mode — so the frame is indistinguishable from
                    # one the engine produced.
                    if own_text:
                        add_words = getattr(tts, "add_word_timestamps", None)
                        if add_words is not None and per_sentence_contexts(tts):
                            # Feed the words the way the vendor's word-timing
                            # messages would, spread over the blob. pipecat then
                            # builds the TTSTextFrames at playout position AND
                            # completes this sentence's sequencer slot. A bare
                            # TTSTextFrame here left the slot open: the next
                            # sentence's words matched no slot ("not recognised
                            # by any slot, emitting as passthrough") and its
                            # full text was then force-completed at the stop —
                            # every sentence after a cache hit recorded twice
                            # (call 859c20ee, 2026-09-12).
                            words = text.split()
                            per = (entry.duration_ms / 1000.0) / max(1, len(words))
                            await add_words([(w, i * per) for i, w in enumerate(words)],
                                            context_id)
                        else:
                            text_frame = TTSTextFrame(
                                text, aggregated_by=AggregationType.SENTENCE)
                            text_frame.context_id = context_id
                            text_frame.will_be_spoken = True
                            yield text_frame

                    if own_stop and engine_l == "navana" and per_sentence_contexts(tts):
                        # Navana's shape: push_text_frames on (pipecat appends
                        # the TTSTextFrame AFTER run_tts returns) and
                        # push_stop_frames off (the SDK's receive loop brackets
                        # and our seq routing closes each live sentence). A stop
                        # yielded here landed BEFORE the text frame — the
                        # sentence vanished from the played transcript — and
                        # nothing closed the context, so the next sentence
                        # waited out pipecat's 3 s idle timeout (sim
                        # navana_cached_live_cached: a 2.74 s hole). Mirror the
                        # live path instead: after the blob's playout, stop,
                        # then close — the sentence's text is already in the
                        # queue ahead of the stop (placed at HEARD_SHARE of the
                        # blob; the base class's late copy is dropped).
                        # Until the blob has PLAYED (measured from the first
                        # chunk, not from the end of the paced emission), and
                        # with keep-alives: pipecat closes a context after 3 s
                        # with no new frame, and with push_stop_frames off it
                        # then pushes no stop at all — so a long cached sentence
                        # (all queued in ~half its length) timed out, its stop
                        # never went out and its text was never committed (sim
                        # navana_cached_then_live: a 9.2 s sentence missing from
                        # the played transcript).
                        hold = max(0.0, entry.duration_ms / 1000.0
                                   - (time.monotonic() - emit_t0) - 0.05)

                        async def _finish_after_playout(cid=context_id, secs=hold):
                            refresh = getattr(tts, "_refresh_audio_context", None)
                            left = secs
                            while left > 0:
                                step = min(1.0, left)
                                await asyncio.sleep(step)
                                left -= step
                                if refresh is not None and left > 0:
                                    try:
                                        refresh(cid)
                                    except Exception:
                                        pass
                            try:
                                if tts.audio_context_available(cid):
                                    await tts.append_to_audio_context(
                                        cid, TTSStoppedFrame(context_id=cid))
                                    await tts.remove_audio_context(cid)
                            except Exception:
                                logger.exception("tts-cache: navana context close failed")
                        asyncio.get_running_loop().create_task(_finish_after_playout())
                    elif own_stop:
                        yield TTSStoppedFrame(context_id=context_id)
                    elif per_sentence_contexts(tts) and own_text:
                        # CLOSE OUR OWN CONTEXT. With one context per sentence the
                        # base class never closes a cached one: a vendor context is
                        # closed by the vendor's own "done" in the receive loop,
                        # and on_turn_context_completed only closes
                        # _turn_context_id — a fresh id created at turn start
                        # that NO sentence uses once reuse is off. A cached
                        # sentence's queue therefore sat open until
                        # _handle_audio_context's 3 s idle timeout, and the next
                        # sentence's audio waited behind it. Live call 994162b0
                        # (2026-09-12): "Thank you." (0.4 s, cached) then 3.6 s of
                        # silence before "So the reason I called…" — on EVERY
                        # reply whose first sentence was short and cached. A long
                        # cached sentence hid it (its own audio kept the queue
                        # busy), which is why the hole only surfaced with the
                        # short-first-sentence rule. Mirror the vendor path: the
                        # stop bracket, then the None sentinel. The stop frame is
                        # already in the queue when this line runs — the consumer
                        # appends each yielded frame before resuming us — so the
                        # order audio → text → stopped → None holds. ONLY when we
                        # own the text frame: on a push_text_frames engine the base
                        # class appends its TTSTextFrame after run_tts returns, i.e.
                        # after our None, and it would never be dequeued.
                        if getattr(tts, "_push_stop_frames", False):
                            yield TTSStoppedFrame(context_id=context_id)
                        remove = getattr(tts, "remove_audio_context", None)
                        if remove is not None:
                            # NOT immediately. pipecat stamps the NEXT context's
                            # word timestamps from the moment its first audio
                            # chunk is enqueued, and vendor audio outruns real
                            # time — so closing now, while this blob is still
                            # playing, put the following sentence's words up to
                            # a blob-length EARLY in the played transcript and the
                            # model's own context ("Would Great. Would tomorrow…",
                            # and the sentence recorded twice; call 859c20ee,
                            # 2026-09-12). Hold the sentinel for the blob's own
                            # playout, which is what the vendor's 'done' amounts
                            # to. An interruption in the meantime tears the
                            # context down and the late remove is a logged no-op.
                            hold = max(0.0, entry.duration_ms / 1000.0 - 0.05)

                            async def _close_after_playout(cid=context_id, secs=hold):
                                await asyncio.sleep(secs)
                                try:
                                    await remove(cid)
                                except Exception:
                                    logger.exception("tts-cache: late context close failed")
                            asyncio.get_running_loop().create_task(_close_after_playout())
                    elif per_sentence_contexts(tts) and engine_l in ("sarvam", "sarvam_v4"):
                        # Sarvam's shape: pipecat pushes the start and the stop
                        # (push_start_frame / push_stop_frames) and appends the
                        # text after run_tts returns (push_text_frames) — but
                        # nothing CLOSES a cached sentence's context: a live one
                        # is closed by Sarvam's 'final' (providers.
                        # _sarvam_sentence_routing) and on_turn_context_completed
                        # only closes _turn_context_id. So the next sentence sat
                        # behind pipecat's 3 s idle timeout (found while fixing
                        # call c6847f91, 2026-10-14: a 0.6 s cached "ठीक है।"
                        # then 3.1 s of nothing). Close it once the blob has
                        # played — after the base class's late text copy (a
                        # question keeps it), which lands as run_tts returns —
                        # with keep-alives so a long blob is not timed out first.
                        hold = max(0.0, entry.duration_ms / 1000.0
                                   - (time.monotonic() - emit_t0) - 0.05)

                        async def _close_sarvam_after_playout(cid=context_id, secs=hold):
                            refresh = getattr(tts, "_refresh_audio_context", None)
                            left = secs
                            while left > 0:
                                step = min(1.0, left)
                                await asyncio.sleep(step)
                                left -= step
                                if refresh is not None and left > 0:
                                    try:
                                        refresh(cid)
                                    except Exception:
                                        pass
                            try:
                                if tts.audio_context_available(cid):
                                    await tts.remove_audio_context(cid)
                            except Exception:
                                logger.exception("tts-cache: sarvam context close failed")
                        asyncio.get_running_loop().create_task(_close_sarvam_after_playout())
                    if async_arrival and per_sentence_contexts(tts):
                        # Hold the next sentence back until this one has all but
                        # played (see _NEXT_SENTENCE_LEAD_SECS). An interruption
                        # cancels us here like anywhere else in run_tts.
                        left = (entry.duration_ms / 1000.0 - (time.monotonic() - emit_t0)
                                - _NEXT_SENTENCE_LEAD_SECS)
                        if left > 0:
                            await asyncio.sleep(left)
                    if placed is not None:
                        # Last, so only a run that placed its text (it was not
                        # cancelled) arms the drop of pipecat's copy, which is
                        # appended the moment we return.
                        handoff.arm(context_id, placed.text)
                    return

        # Counted here rather than at entry, so the denominator is "sentences the
        # cache could possibly have served". Fragments and letterless chunks were
        # never candidates and would only dilute the hit rate.
        _bump("note_tts_cache_miss", len(norm))
        if async_arrival:
            watcher.note_vendor_dispatch()

        # G2: only a sentence that ran to completion with no interruption over it
        # is allowed to become a candidate.
        t0 = time.time()
        clean = True
        try:
            async for f in original(text, context_id):
                yield f
        except (GeneratorExit, asyncio.CancelledError):
            clean = False
            raise
        finally:
            if clean and key and candidates is not None and not watcher.interrupted_since(t0):
                candidates.add(Candidate(
                    key=key, text=norm, chars=len(norm), engine=engine_l,
                    model=model or "", voice=voice or "", pace=pace,
                    temperature=temperature, fixed=is_fixed, language=render_language,
                    agent_id=agent_id, agent_name=agent_name,
                    institute_id=institute_id))

    tts.run_tts = run_tts
    # One line per call saying exactly which gates are open. Without it, "why did
    # this call not hit the cache" is a guess between four different switches.
    logger.info("tts-cache: installed engine={} voice={} agent={} mode={} rollout={} "
                "kill_speech={} kill_llm={} async_arrival={} entries={}",
                engine_l, voice, agent_id or agent_name or "?",
                (cache_mode or MODE_OFF).upper(), "in" if in_rollout else "OUT",
                s.tts_cache_speech_enabled, s.tts_cache_llm_enabled,
                async_arrival, cache.size)
    return watcher
