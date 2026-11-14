"""Sarvam STT across two accounts: SarvamKeyPool picks the key a call opens on,
and sarvam_key_failover moves a call whose key Sarvam refused (close 1003
"Rate limit exceeded" / "Credits exhausted", ~0.1 s after the socket opens) to
the other account instead of to the fallback vendor.

The vendor here is a stand-in exposing exactly what the wrapper uses of
pipecat's SarvamSTTService: run_stt, process_frame (the flush on the VAD stop),
push_error_frame, push_error, _connect, _cancel_keepalive_task, the socket and
client attributes, and task helpers.
"""
import asyncio
import sys
import types

import pytest
from pipecat.frames.frames import ErrorFrame, VADUserStoppedSpeakingFrame
from pipecat.processors.frame_processor import FrameDirection

from app import providers as pv

DOWN = FrameDirection.DOWNSTREAM
RATE = "Error sending audio to Sarvam: received 1003 (unsupported data) Rate limit exceeded. Retry after a short backoff"
CREDITS = "Error sending audio to Sarvam: received 1003 (unsupported data) Credits exhausted. Add credits in the API Dashboard"


@pytest.fixture
def keys(monkeypatch):
    def _set(k1="sk_a", k2="sk_b", strategy="failover"):
        monkeypatch.setenv("SARVAM_API_KEY", k1)
        monkeypatch.setenv("SARVAM_API_KEY_2", k2)
        monkeypatch.setenv("SARVAM_KEY_STRATEGY", strategy)
        pv.get_settings.cache_clear()
        monkeypatch.setattr(pv, "SARVAM_KEYS", pv.SarvamKeyPool())
        return pv.SARVAM_KEYS
    yield _set
    pv.get_settings.cache_clear()


# ── which keys, and what counts as a refusal ───────────────────────────────────

def test_keys_in_order_without_quotes_or_duplicates(keys):
    keys(k1="sk_a", k2=" 'sk_b' , sk_a ,sk_c")
    assert pv.sarvam_keys() == ["sk_a", "sk_b", "sk_c"]


def test_one_key_when_the_second_is_unset(keys):
    keys(k2="")
    assert pv.sarvam_keys() == ["sk_a"]


@pytest.mark.parametrize("msg,kind", [
    (RATE, "rate_limit"),
    (CREDITS, "credits"),
    ("received 1003 (unsupported data) Invalid subscription key", "refused"),
    ("Failed to connect to Sarvam: timed out", None),
    ("STT vendor socket stuck: a send has not completed in 3.5s", None),
    ("Error sending audio to Sarvam: no close frame received or sent", None),
])
def test_only_key_problems_count_as_refusals(msg, kind):
    assert pv.sarvam_refusal(msg) == kind


# ── the pool ─────────────────────────────────────────────────────────────────

def test_failover_uses_the_first_key_until_it_is_refused(keys):
    pool = keys()
    assert [pool.pick() for _ in range(3)] == [0, 0, 0]
    pool.refused(0, "rate_limit")
    assert pool.pick() == 1
    assert pool.status()[0]["restingSecs"] > 0 and pool.status()[0]["lastRefusal"] == "rate_limit"


def test_roundrobin_alternates_and_skips_a_resting_key(keys):
    pool = keys(strategy="roundrobin")
    assert [pool.pick() for _ in range(4)] == [0, 1, 0, 1]
    pool.refused(1, "credits")
    assert [pool.pick() for _ in range(3)] == [0, 0, 0]


def test_with_every_key_resting_a_call_still_opens_on_the_one_that_rests_least(keys, monkeypatch):
    monkeypatch.setenv("SARVAM_KEY_OTHER_REST_SECS", "600")
    pool = keys()
    pool.refused(1, "credits")          # 600 s
    pool.refused(0, "rate_limit")       # 60 s
    assert pool.pick() == 0
    assert pool.pick(exclude={0}, skip_resting=True) is None


def test_status_never_carries_the_key_text(keys):
    pool = keys(k1="sk_secret_one", k2="sk_secret_two")
    assert "sk_secret" not in repr(pool.status())


# ── the call-level switch ────────────────────────────────────────────────────

class _Socket:
    def __init__(self, key, refuse):
        self.key, self.refuse = key, refuse
        self.sent = []

    async def transcribe(self, audio):
        if self.refuse:
            raise RuntimeError(self.refuse)
        self.sent.append(audio)

    async def flush(self):
        self.sent.append("flush")


class _Vendor:
    """SarvamSTTService as far as the wrapper is concerned. `refusals` maps a
    key to the 1003 text Sarvam closes it with."""

    refusals: dict = {}

    def __init__(self, api_key, sample_rate=8000, **kw):
        self._api_key = api_key
        self.sample_rate = sample_rate
        self._sdk_headers = {}
        self._sarvam_client = None
        self._socket_client = None
        self._websocket_context = None
        self._receive_task = None
        self.sockets = []
        self.errors = []

    def create_task(self, coro, name=None):
        return asyncio.get_running_loop().create_task(coro)

    async def cancel_task(self, task, timeout=1.0):
        task.cancel()
        try:
            await task
        except BaseException:
            pass

    async def _cancel_keepalive_task(self):
        pass

    async def _connect(self):
        sock = _Socket(self._api_key, self.refusals.get(self._api_key))
        self.sockets.append(sock)
        self._socket_client = sock

        class _Ctx:
            async def __aexit__(self, *a):
                pass
        self._websocket_context = _Ctx()

    async def start(self, frame):
        await self._connect()

    async def stop(self, frame):
        pass

    async def cancel(self, frame):
        pass

    async def run_stt(self, audio):
        if not self._socket_client:
            yield None
            return
        try:
            await self._socket_client.transcribe(audio)
        except Exception as e:
            yield ErrorFrame(error=f"Error sending audio to Sarvam: {e}", exception=e)
        yield None

    async def process_frame(self, frame, direction):
        if isinstance(frame, VADUserStoppedSpeakingFrame) and self._socket_client:
            await self._socket_client.flush()

    async def process_generator(self, gen):
        async for f in gen:
            if isinstance(f, ErrorFrame):
                await self.push_error_frame(f)

    async def push_error_frame(self, error):
        self.errors.append(error.error)

    async def push_error(self, error_msg, exception=None, fatal=False):
        await self.push_error_frame(ErrorFrame(error=error_msg, fatal=fatal))


@pytest.fixture
def fake_sdk(monkeypatch):
    mod = types.ModuleType("sarvamai")

    class AsyncSarvamAI:
        def __init__(self, api_subscription_key, headers=None):
            self.key = api_subscription_key
    mod.AsyncSarvamAI = AsyncSarvamAI
    monkeypatch.setitem(sys.modules, "sarvamai", mod)


async def _send(stt, audio):
    await stt.process_generator(stt.run_stt(audio))


async def _settle(stt):
    for _ in range(50):
        if stt._key_task is None:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("key switch did not finish")


async def test_a_rate_limited_key_moves_the_call_to_the_other_account_with_its_audio(keys, fake_sdk):
    pool = keys()
    _Vendor.refusals = {"sk_a": "received 1003 (unsupported data) Rate limit exceeded."}
    cls = pv.sarvam_key_failover(_Vendor)
    stt = cls(api_key="sk_a", key_index=0)
    await stt.start(None)

    await _send(stt, b"a1")                 # refused: switch starts, error swallowed
    await _send(stt, b"a2")                 # held while the new socket opens
    await stt.process_frame(VADUserStoppedSpeakingFrame(), DOWN)
    await _settle(stt)
    await _send(stt, b"a3")                 # the held audio + flush go first

    assert stt.errors == []                 # the waterfall never saw it: no Smallest
    assert stt.key_index == 1 and stt._api_key == "sk_b" and stt.key_switches == 1
    assert stt.sockets[-1].key == "sk_b"
    assert stt.sockets[-1].sent == [b"a2", "flush", b"a3"]
    assert pool.resting("sk_a") and not pool.resting("sk_b")


async def test_when_both_accounts_refuse_the_error_reaches_the_waterfall(keys, fake_sdk):
    keys()
    _Vendor.refusals = {"sk_a": "received 1003 (unsupported data) Rate limit exceeded.",
                        "sk_b": "received 1003 (unsupported data) Credits exhausted."}
    stt = pv.sarvam_key_failover(_Vendor)(api_key="sk_a", key_index=0)
    await stt.start(None)
    await _send(stt, b"a1")
    await _settle(stt)
    await _send(stt, b"a2")                 # key 2 refused too: no third try
    assert len(stt.errors) == 1 and "Credits exhausted" in stt.errors[0]
    assert stt.key_switches == 1


async def test_a_resting_other_key_is_not_tried_mid_call(keys, fake_sdk):
    pool = keys()
    pool.refused(1, "credits")
    _Vendor.refusals = {"sk_a": "received 1003 (unsupported data) Rate limit exceeded."}
    stt = pv.sarvam_key_failover(_Vendor)(api_key="sk_a", key_index=0)
    await stt.start(None)
    await _send(stt, b"a1")
    assert len(stt.errors) == 1 and stt.key_switches == 0 and stt._key_task is None


async def test_a_non_key_error_passes_straight_through(keys, fake_sdk):
    keys()
    _Vendor.refusals = {"sk_a": "no close frame received or sent"}
    stt = pv.sarvam_key_failover(_Vendor)(api_key="sk_a", key_index=0)
    await stt.start(None)
    await _send(stt, b"a1")
    assert len(stt.errors) == 1 and stt.key_switches == 0
    assert not pv.SARVAM_KEYS.resting("sk_a")


async def test_held_audio_is_capped_to_the_newest_seconds(keys, fake_sdk):
    keys()
    stt = pv.sarvam_key_failover(_Vendor, buffer_secs=0.001)(api_key="sk_a", key_index=0)
    stt._key_holding = True
    for i in range(5):
        await _send(stt, bytes([i]) * 8)    # 8 bytes each; cap is 16 bytes at 8 kHz
    assert [j[1][0] for j in stt._key_held] == [3, 4]


def test_build_stt_uses_the_plain_class_with_one_key(keys, monkeypatch):
    keys(k2="")
    monkeypatch.setenv("STT_PROVIDER", "sarvam")
    pv.get_settings.cache_clear()
    stt = pv.build_stt(8000)
    assert not hasattr(stt, "key_switches") and stt._api_key == "sk_a"


def test_build_stt_opens_on_the_pools_pick_with_two_keys(keys, monkeypatch):
    pool = keys()
    monkeypatch.setenv("STT_PROVIDER", "sarvam")
    pv.get_settings.cache_clear()
    pool.refused(0, "rate_limit")
    stt = pv.build_stt(8000)
    assert stt.key_index == 1 and stt._api_key == "sk_b"
