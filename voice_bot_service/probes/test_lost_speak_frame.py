"""Repro with the REAL Smallest service class (network stubbed): a cut LLM
reply, an interruption, then a TTSSpeakFrame 0.9 s later. Does run_tts run?"""
import asyncio, sys, traceback
import pytest
from pipecat.frames.frames import (TTSSpeakFrame, InterruptionFrame, EndFrame,
                                   LLMFullResponseStartFrame, LLMFullResponseEndFrame,
                                   LLMTextFrame, TTSStoppedFrame, BotStoppedSpeakingFrame,
                                   UserStartedSpeakingFrame)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.smallest.tts import SmallestTTSService
from pipecat.transcriptions.language import Language
from app.providers import _letterless_guard


class Tap(FrameProcessor):
    def __init__(self, name):
        super().__init__(name=name)
        self.seen = []
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        self.seen.append(type(frame).__name__)
        await self.push_frame(frame, direction)


def _make(close_contexts: bool):
    Base = _letterless_guard(SmallestTTSService)

    class Stub(Base):
        def __init__(self):
            super().__init__(api_key="x", sample_rate=8000,
                             settings=Base.Settings(model="lightning_v3.1", voice="mrunal",
                                                    language=Language.EN, speed=1.0))
            self.calls = []
        async def _connect(self): self.connects = getattr(self, "connects", 0) + 1
        async def _disconnect(self): pass
        async def _connect_websocket(self): pass
        async def _disconnect_websocket(self): pass
        async def run_tts(self, text, context_id):
            self.calls.append(text)
            if close_contexts:
                # HTTP-style: audio then done
                yield TTSStoppedFrame(context_id=context_id)
                await self.remove_audio_context(context_id)
            else:
                # websocket-style: audio "arrives later"; a cut context never closes
                yield None
    return Stub()


@pytest.mark.asyncio
@pytest.mark.parametrize("close_contexts", [False, True])
@pytest.mark.parametrize("interrupt", [True, False])
async def test_speak_frame_after_interruption(close_contexts, interrupt):
    tts = _make(close_contexts)
    up, down = Tap("up"), Tap("down")
    task = PipelineTask(Pipeline([up, tts, down]), params=PipelineParams(allow_interruptions=True))
    runner = PipelineRunner(handle_sigint=False)
    run = asyncio.get_event_loop().create_task(runner.run(task))
    await asyncio.sleep(0.3)
    await task.queue_frames([LLMFullResponseStartFrame(),
                             LLMTextFrame("Sorry for disturbing you. "),
                             LLMTextFrame("Does anyone there take yoga classes?"),
                             LLMFullResponseEndFrame()])
    await asyncio.sleep(0.5)
    first = list(tts.calls)
    if interrupt:
        await up.push_frame(InterruptionFrame(), FrameDirection.DOWNSTREAM)
        await asyncio.sleep(0.9)
    await task.queue_frame(TTSSpeakFrame("Hello, is this Amrutha?", append_to_context=True))
    await asyncio.sleep(1.2)
    calls = list(tts.calls)
    stuck = []
    for t in asyncio.all_tasks():
        if t.done() or t is asyncio.current_task() or t is run:
            continue
        fr = t.get_stack(limit=3)
        stuck.append((t.get_name(), [f"{f.f_code.co_name}:{f.f_lineno}" for f in fr]))
    await task.queue_frame(EndFrame())
    try:
        await asyncio.wait_for(run, timeout=5)
    except Exception:
        run.cancel()
    print(f"\nclose_contexts={close_contexts} interrupt={interrupt} first={first} calls={calls}")
    if "Hello, is this Amrutha?" not in calls:
        print("  STUCK TASKS:")
        for n, st in stuck:
            print("   ", n, st)
    assert "Hello, is this Amrutha?" in calls
