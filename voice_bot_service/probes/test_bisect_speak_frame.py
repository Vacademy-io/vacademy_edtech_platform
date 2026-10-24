"""Bisection: which processor swallows a TTSSpeakFrame while the user turn is
open?  Call 9050a3e1 (2026-09-21): two resume sends 0.9 s and 2.1 s after an
interruption never reached the TTS at all while the caller's turn stayed open."""
import asyncio, time
import pytest
from pipecat.frames.frames import (TTSSpeakFrame, TranscriptionFrame, InterruptionFrame,
                                   UserStartedSpeakingFrame, EndFrame, Frame, StartFrame)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair, LLMUserAggregatorParams)
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.turns.user_start import TranscriptionUserTurnStartStrategy
from pipecat.services.tts_service import TTSService
import app.bot as b
import app.diagnostics as dg


class Probe(TTSService):
    def __init__(self):
        super().__init__(sample_rate=8000)
        self.seen, self.pushed = [], []
    async def process_frame(self, frame, direction):
        if isinstance(frame, TTSSpeakFrame):
            self.seen.append(frame.text)
        await super().process_frame(frame, direction)
    async def _push_tts_frames(self, src_frame, *a, **k):
        self.pushed.append(src_frame.text)
    async def run_tts(self, text, context_id=None):
        if False:
            yield


class Tap(FrameProcessor):
    def __init__(self, name):
        super().__init__(name=name)
        self.seen = []
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSSpeakFrame):
            self.seen.append(frame.text)
        await self.push_frame(frame, direction)


def _sentinel():
    class O:
        corr = "t"; end_requested = False; end_forced = False; transcript = []
        transfer_requested = False; sent = set()
    return b.SentinelGate(O(), lambda user=True: None, lambda s: None)


def _no_repeat():
    return b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "")


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["agg", "agg+guard", "agg+guard+sentinel", "agg+guard+sentinel+norepeat"])
@pytest.mark.parametrize("interrupt", [False, True])
async def test_bisect_speak_frame_with_open_user_turn(stage, interrupt):
    ctx = LLMContext(messages=[{"role": "system", "content": "x"}])
    aggs = LLMContextAggregatorPair(ctx, user_params=LLMUserAggregatorParams(
        user_turn_strategies=UserTurnStrategies(
            start=[TranscriptionUserTurnStartStrategy(use_interim=True, enable_interruptions=interrupt)],
            stop=[])))
    probe = Probe()
    chain = [aggs.user()]
    if "guard" in stage:
        chain.append(b.RunGuard(ctx, enabled=lambda: True, diag=dg.CallDiagnostics()))
    if "sentinel" in stage:
        chain.append(_sentinel())
    if "norepeat" in stage:
        chain.append(_no_repeat())
    taps = [Tap(f"tap{i}") for i in range(len(chain))]
    seq = []
    for p, t in zip(chain, taps):
        seq += [p, t]
    seq.append(probe)
    task = PipelineTask(Pipeline(seq), params=PipelineParams(allow_interruptions=True))
    runner = PipelineRunner(handle_sigint=False)
    run = asyncio.get_event_loop().create_task(runner.run(task))
    await asyncio.sleep(0.3)
    await task.queue_frame(TranscriptionFrame("Hello.", "u", "0", "en-IN"))   # opens the turn, never closes
    await asyncio.sleep(0.4)
    await task.queue_frame(TTSSpeakFrame("Sorry for disturbing you.", append_to_context=True))
    await asyncio.sleep(1.0)
    got = {t.name: t.seen for t in taps}
    got["probe.process_frame"] = probe.seen
    got["probe._push_tts_frames"] = probe.pushed
    await task.queue_frame(EndFrame())
    try:
        await asyncio.wait_for(run, timeout=5)
    except Exception:
        run.cancel()
    print(f"\nSTAGE={stage} interrupt={interrupt} -> {got}")
    assert probe.pushed == ["Sorry for disturbing you."], got
