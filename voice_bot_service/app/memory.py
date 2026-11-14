"""Give a finished call's memory back at once — not at the interpreter's next
full collection.

WHY (2026-09-30). A call's pipeline is a web of reference cycles (every
processor links to its neighbours both ways; services point at their task
manager, closures at the transport). Reference counting can never free it; only
the cyclic collector's FULL (generation-2) pass can — and CPython runs that pass
rarely on a big heap (it waits until the objects promoted since the last one
exceed 25 % of all long-lived objects). Meanwhile each finished call keeps its
Silero VAD and Smart Turn ONNX sessions (~35 MB) and two executor threads. On
the Mumbai box, after the un-awaited drift-task leak was fixed (9b674bae7a), idle
memory still climbed 206 MB → 1.12 GB over ~60 calls, with threads creeping
16 → 41, before a full pass knocked it back. probes/leak_probe.py --never-gc
reproduces it: 1, 2, 3 … 6 finished pipelines still in memory after 10 calls.

WHAT. ~3 s after every call (past pipecat's 2.5 s TurnTrackingObserver turn-end
timer, which holds the pipeline until it fires): one full collection, which
frees that call. Cheap
because the long-lived heap (modules, pipecat, google-auth — ~220 k objects) is
FROZEN into the permanent generation, which collections skip: measured 25-32 ms
per collection unfrozen vs 1.4-2.3 ms frozen (Mac; the 1-vCPU box is slower, so
the unfrozen cost would be an audible stall on the other live calls). The heap
is frozen once after the LLM warm-up and once more at the first idle moment
after a call, when the lazily imported call modules (STT/TTS SDKs, onnxruntime)
are in — and ONLY when no call is live, so no live call is ever frozen. When the
box is idle, glibc is also asked to hand freed arenas back (malloc_trim), so RSS
— what the OOM killer and the safety valve read — reflects it.
"""
from __future__ import annotations

import ctypes
import gc
import logging
import time

logger = logging.getLogger("app.memory")

_frozen_after_call = False


def _rss_mb() -> int:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
    return -1


def _malloc_trim() -> bool:
    try:
        return bool(ctypes.CDLL("libc.so.6").malloc_trim(0))
    except Exception:          # not glibc (macOS dev boxes): nothing to trim
        return False


# Modules the first call imports lazily (providers.build_* import them inside
# the functions). Imported before the startup freeze so their module objects are
# frozen too — otherwise the first full collection after a call traverses them
# all: 232 ms on the box on 2026-10-01 (call 62af8895, the first of the day).
_CALL_MODULES = (
    "pipecat.services.sarvam.stt", "pipecat.services.smallest.stt",
    "pipecat.services.smallest.tts", "pipecat.services.google.llm",
    "pipecat.services.google.vertex.llm", "pipecat.services.google.tts",
    "pipecat.services.deepgram.tts", "bodhi.integrations.pipecat_tts",
)


def preload_call_modules() -> int:
    import importlib
    n = 0
    for name in _CALL_MODULES:
        try:
            importlib.import_module(name)
            n += 1
        except Exception:          # an optional SDK that is not installed
            pass
    return n


def freeze_startup() -> None:
    """Freeze everything alive after startup (no call can be live yet)."""
    loaded = preload_call_modules()
    gc.collect()
    gc.freeze()
    logger.info("memory: froze %d startup objects (%d call modules preloaded)",
                gc.get_freeze_count(), loaded)


def reclaim(idle: bool, corr: str = "") -> dict:
    """Free what a finished call left for the cyclic collector. `idle` = no call
    is live: then (once) freeze the survivors and return freed arenas to the OS."""
    global _frozen_after_call
    if not idle and not _frozen_after_call:
        # Until the first idle freeze, a full collection walks everything the
        # first call created (232 ms on the box) — a stall for the live calls.
        # Each finished call's ONNX models and threads are already released by
        # run_bot at hang-up, so its leftover Python objects can wait for the
        # first idle moment.
        logger.info("memory: after call %s — collection deferred to the first idle "
                    "moment (calls are live)", corr[:8])
        return {"freed": 0, "gc_ms": 0.0, "rss_before": -1, "rss_after": -1,
                "froze": False, "trimmed": False, "deferred": True}
    before = _rss_mb()
    t0 = time.perf_counter()
    freed = gc.collect()
    gc_ms = (time.perf_counter() - t0) * 1000.0
    froze = trimmed = False
    if idle:
        # Freeze the survivors once — but never with a finished call among them:
        # something transient (a speech-cache task finishing, a pipecat timer)
        # can still hold one for a moment, and a frozen call is never freed.
        if not _frozen_after_call and not any(
                type(o).__name__ == "PipelineTask" for o in gc.get_objects()):
            gc.freeze()
            _frozen_after_call = froze = True
        trimmed = _malloc_trim()
    after = _rss_mb()
    logger.info("memory: after call %s — freed %d objects in %.1f ms%s%s; rss %d -> %d MB",
                corr[:8], freed, gc_ms, "; froze survivors" if froze else "",
                "; trimmed" if trimmed else "", before, after)
    return {"freed": freed, "gc_ms": round(gc_ms, 1), "rss_before": before,
            "rss_after": after, "froze": froze, "trimmed": trimmed}
