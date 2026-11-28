"""providers.decoupled_stt_io: a stuck STT vendor socket never holds up the
pipeline, and fails over with the caller's queued audio.

Call 3e327e8a (2026-10-02): Sarvam closed the stream ("Credits exhausted") and
held the TCP open; the sarvamai SDK's websockets legacy client made every send
wait 10 s in ensure_open(), and pipecat sends INLINE in the STT's input task —
so the opening queued at +1.24 s played at +13.76 s. The end-to-end shape runs
in the timing sim (stt_hangs_at_pickup / stt_hangs_mid_call /
stt_healthy_quiet_caller_no_failover); these pin the mechanism.

The vendor here is a stand-in exposing exactly what the wrapper uses of a
pipecat STTService: run_stt (the send), process_frame (audio passthrough via
run_stt, the flush on the VAD stop), process_generator, push_error, tasks.
"""
import asyncio

import pytest
from pipecat.frames.frames import (ErrorFrame, InputAudioRawFrame, TTSSpeakFrame,
                                   VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame)
from pipecat.processors.frame_processor import FrameDirection

from app import providers as pv

DOWN, UP = FrameDirection.DOWNSTREAM, FrameDirection.UPSTREAM


class _Vendor:
    """A socket that is healthy while `self.ok` is set and hangs on every send
    while it is clear — what Sarvam's did for 10 s on 3e327e8a."""

    def __init__(self, sample_rate: int = 8000):
        self.sample_rate = sample_rate
        self.ok = asyncio.Event()
        self.ok.set()
        self.sent = []           # what reached the socket, in order
        self.pushed = []         # frames passed on, in order
        self.errors = []         # (message, fatal)

    async def start(self, frame):
        pass

    async def stop(self, frame):
        pass

    async def cancel(self, frame):
        pass

    def create_task(self, coro, name=None):
        return asyncio.get_running_loop().create_task(coro)

    async def cancel_task(self, task, timeout=1.0):
        task.cancel()
        try:
            await task
        except BaseException:
            pass

    async def run_stt(self, audio):
        await self.ok.wait()
        self.sent.append(audio)
        yield None

    async def process_generator(self, gen):
        async for f in gen:
            if isinstance(f, ErrorFrame):
                self.errors.append((f.error, f.fatal))

    async def push_error(self, error_msg, exception=None, fatal=False):
        self.errors.append((error_msg, fatal))

    async def process_frame(self, frame, direction):
        # pipecat's STTService: audio goes to run_stt, then passes downstream;
        # Sarvam flushes / Smallest finalizes on the VAD stop — a send.
        if isinstance(frame, InputAudioRawFrame):
            async for _ in self.run_stt(frame.audio):
                pass
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            await self.ok.wait()
            self.sent.append("flush")
        self.pushed.append(frame)


class _Diag:
    stt_stalls = 0

    def bump(self, name, by=1):
        setattr(self, name, getattr(self, name) + by)


def _audio(n: int) -> InputAudioRawFrame:
    return InputAudioRawFrame(bytes([n]) * 320, 8000, 1)      # 20 ms, distinguishable


async def _started(cls=None, stall=0.2, **kw):
    svc = pv.decoupled_stt_io(cls or _Vendor, stall, **kw)()
    await svc.start(None)
    return svc


def test_the_kill_switch_leaves_the_class_alone():
    assert pv.decoupled_stt_io(_Vendor, 0) is _Vendor
    assert pv.decoupled_stt_io(_Vendor, -1.0) is _Vendor
    wrapped = pv.decoupled_stt_io(_Vendor, 1.5)
    assert issubclass(wrapped, _Vendor) and wrapped.__name__ == "_Vendor"


@pytest.mark.asyncio
async def test_a_hung_send_never_holds_up_the_frames_behind_it():
    """3e327e8a: the audio frame waits in the send, and the opening's
    TTSSpeakFrame queued behind it waited 12.5 s. Now neither waits at all."""
    svc = await _started(stall=5.0)
    svc.ok.clear()                                        # the socket hangs
    try:
        for k in range(3):
            await asyncio.wait_for(svc.process_frame(_audio(k), DOWN), 0.05)
        await asyncio.wait_for(svc.process_frame(TTSSpeakFrame("नमस्ते जी"), DOWN), 0.05)
        await asyncio.wait_for(svc.process_frame(VADUserStoppedSpeakingFrame(), UP), 0.05)
        assert [type(f).__name__ for f in svc.pushed] == ["InputAudioRawFrame"] * 3 + ["TTSSpeakFrame"]
        assert svc.sent == []                             # nothing reached the socket
        svc.ok.set()                                      # …and once it moves, all of it, in order
        await asyncio.sleep(0.05)
        assert svc.sent == [bytes([0]) * 320, bytes([1]) * 320, bytes([2]) * 320, "flush"]
        assert isinstance(svc.pushed[-1], VADUserStoppedSpeakingFrame)
    finally:
        await svc.stop(None)


@pytest.mark.asyncio
async def test_a_healthy_socket_sends_at_once_and_a_quiet_caller_is_not_a_stall():
    diag = _Diag()
    svc = await _started(stall=0.2)
    svc.set_diagnostics(diag)
    try:
        await svc.process_frame(_audio(1), DOWN)
        await asyncio.sleep(0.01)                         # a loop turn, not a wait
        assert svc.sent == [bytes([1]) * 320]
        await asyncio.sleep(0.6)                          # 3x the threshold with nothing to send
        await svc.process_frame(VADUserStartedSpeakingFrame(), UP)
        await svc.process_frame(VADUserStoppedSpeakingFrame(), UP)
        await asyncio.sleep(0.05)
        assert svc.sent[-1] == "flush"
        assert svc.errors == [] and diag.stt_stalls == 0
    finally:
        await svc.stop(None)


@pytest.mark.asyncio
async def test_a_stuck_primary_hands_its_queue_to_the_fallback_and_fails_over():
    """Mid-call: the parent's whole answer arrived while the socket was stuck.
    It goes to the fallback in order (VAD stop included, so it finalizes),
    ahead of the live audio, and a non-fatal ErrorFrame switches the waterfall."""
    diag = _Diag()
    primary, fallback = await _started(stall=0.2), await _started(stall=0.2)
    primary.set_diagnostics(diag)
    primary.set_stall_handoff(fallback)
    primary.ok.clear()
    try:
        await primary.process_frame(_audio(1), DOWN)       # in flight: stuck in the send
        await asyncio.sleep(0.01)
        await primary.process_frame(_audio(2), DOWN)
        await primary.process_frame(VADUserStartedSpeakingFrame(), UP)
        await primary.process_frame(_audio(3), DOWN)
        await primary.process_frame(VADUserStoppedSpeakingFrame(), UP)
        assert fallback.sent == []
        await asyncio.sleep(0.5)                            # past the 0.2 s threshold
        assert fallback.sent == [bytes([2]) * 320, bytes([3]) * 320, "flush"], fallback.sent
        assert [type(f).__name__ for f in fallback.pushed[-2:]] == [
            "VADUserStartedSpeakingFrame", "VADUserStoppedSpeakingFrame"]
        assert len(primary.errors) == 1 and primary.errors[0][1] is False, primary.errors
        assert "stuck" in primary.errors[0][0]
        assert diag.stt_stalls == 1
        # Anything still reaching the primary before the switch lands goes on.
        await primary.process_frame(_audio(4), DOWN)
        await asyncio.sleep(0.02)
        assert fallback.sent[-1] == bytes([4]) * 320
        await asyncio.sleep(0.5)
        assert len(primary.errors) == 1, "one failover, not one per tick"
    finally:
        primary.ok.set()
        await primary.stop(None)
        await fallback.stop(None)


@pytest.mark.asyncio
async def test_without_a_fallback_a_stuck_socket_keeps_the_newest_audio_and_recovers():
    diag = _Diag()
    svc = await _started(stall=0.2, backlog_secs=0.1)      # 0.1 s = 1600 bytes = 5 chunks
    svc.set_diagnostics(diag)
    svc.ok.clear()
    try:
        for k in range(12):
            await svc.process_frame(_audio(k), DOWN)
            await asyncio.sleep(0)
        await asyncio.sleep(0.4)
        assert diag.stt_stalls == 1
        assert svc.errors == [], "no fallback: nothing to switch to"
        svc.ok.set()
        await asyncio.sleep(0.05)
        # chunk 0 was in flight; then only the newest 5 of the queued 11 were kept
        assert svc.sent == [bytes([k]) * 320 for k in (0, 7, 8, 9, 10, 11)], svc.sent
        svc.ok.clear()                                    # it can stall again, and is seen again
        await svc.process_frame(_audio(20), DOWN)
        await asyncio.sleep(0.4)
        assert diag.stt_stalls == 2
    finally:
        svc.ok.set()
        await svc.stop(None)


def test_production_builds_the_websocket_vendors_decoupled_and_linked(monkeypatch):
    """build_stt wraps Sarvam and Smallest (the two that send inline), and the
    waterfall points the primary's stall handoff at the fallback."""
    from app.config import get_settings as _gs
    monkeypatch.setenv("STT_PROVIDER", "sarvam")
    monkeypatch.setenv("STT_FALLBACK_PROVIDER", "smallest")
    monkeypatch.setenv("SARVAM_API_KEY", "sk_test")
    monkeypatch.setenv("SMALLEST_API_KEY", "sk_test")
    _gs.cache_clear()
    try:
        assert _gs().stt_stall_secs == 1.5
        switcher, primary, fallback = pv.build_stt_waterfall(8000, language="hi-IN")
        from pipecat.services.sarvam.stt import SarvamSTTService
        from pipecat.services.smallest.stt import SmallestSTTService
        assert isinstance(primary, SarvamSTTService) and isinstance(fallback, SmallestSTTService)
        assert primary._io_handoff is fallback
        assert hasattr(fallback, "set_stall_handoff") and fallback._io_handoff is None
        monkeypatch.setenv("STT_STALL_SECS", "0")
        _gs.cache_clear()
        _, primary, fallback = pv.build_stt_waterfall(8000, language="hi-IN")
        assert not hasattr(primary, "set_stall_handoff"), "kill switch: plain pipecat"
    finally:
        _gs.cache_clear()
