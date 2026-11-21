"""Does a finished call leave memory behind? (2026-09-30: the Mumbai box grew
~30 MB per call — 320 MB → 1.84 GB over ~45 calls — until the OOM killer took
uvicorn at 07:22 with calls live.)

Runs timing-sim scenarios back to back in ONE process, like the service does,
and after each call reports RSS, the pipeline objects still alive after a full
gc, and the asyncio tasks that outlived the call.

    python -m probes.leak_probe --runs 8 --scenarios farewell_without_marker,navana_live_then_cached
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import gc
import json
import os
import sys
import tempfile
import threading


def _rss_mb() -> float:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except OSError:                                  # macOS: no /proc
        import subprocess
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())],
                             capture_output=True, text=True).stdout.strip()
        return int(out or 0) / 1024
    return -1.0


def _alive_no_gc(name="PipelineTask") -> int:
    """Objects of `name` still in memory WITHOUT a collection — what production
    carries between the interpreter's own (rare) full collections."""
    return sum(1 for o in gc.get_objects() if type(o).__name__ == name)


_WATCH = ("PipelineTask", "Pipeline", "PipelineWorker", "SileroVADAnalyzer",
          "LocalSmartTurnAnalyzerV3", "InferenceSession", "CallOutcome", "NoRepeatGate",
          "RunGuard", "LLMContext", "OpenAILLMContext", "BodhiTTSService",
          "GoogleVertexLLMService", "SarvamSTTService", "Line", "SpeechCache")


def _census() -> collections.Counter:
    gc.collect()
    c = collections.Counter()
    for o in gc.get_objects():
        n = type(o).__name__
        if n in _WATCH:
            c[n] += 1
    return c


def _task_names() -> list:
    out = []
    for t in asyncio.all_tasks():
        if t is asyncio.current_task():
            continue
        out.append(t.get_name()[:90])
    return sorted(out)


def _describe(o) -> str:
    n = type(o).__name__
    if isinstance(o, dict):
        return f"dict{list(o.keys())[:4]}"
    if isinstance(o, (list, tuple, set)):
        return f"{n}[{len(o)}]"
    for attr in ("__qualname__", "__name__"):
        if hasattr(o, attr):
            return f"{n}:{getattr(o, attr)}"
    return n


def _referrer_chain(obj, depth=8) -> list:
    """Walk up referrers from one surviving PipelineTask, skipping the probe's
    own frames/lists, to name what pins it."""
    import types
    chain, cur = [], obj
    ignore = {id(obj)}
    for _ in range(depth):
        gc.collect()
        refs = [r for r in gc.get_referrers(cur)
                if id(r) not in ignore and not isinstance(r, types.FrameType)
                and not (isinstance(r, list) and len(r) > 1000)]
        if not refs:
            chain.append("<no referrers>")
            break
        # Prefer something that is not just the object's own __dict__.
        r = next((x for x in refs if not (isinstance(x, dict) and "_name" in x)), refs[0])
        chain.append(_describe(r))
        ignore.add(id(r))
        ignore.add(id(refs))
        cur = r
    return chain


async def main():
    os.environ.setdefault("TTS_CACHE_DIR", tempfile.mkdtemp(prefix="leak-cache-"))
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=8)
    ap.add_argument("--scenarios", default="farewell_without_marker")
    ap.add_argument("--reclaim", action="store_true",
                    help="call app.memory.reclaim() after each call, as app/main.py does")
    ap.add_argument("--never-gc", action="store_true",
                    help="never force a collection: count finished pipelines left in memory, as in production")
    ap.add_argument("--no-forced-gc", action="store_true",
                    help="also report memory/pipelines BEFORE the forced collection (production's view)")
    args = ap.parse_args()
    # Only this probe's lines on stdout: pipecat's DEBUG stream is ~1 MB per call.
    from loguru import logger as _lg
    _lg.remove()
    import logging
    logging.disable(logging.CRITICAL)
    from sim import timing as T
    base_ctx = json.loads((T.FIXTURE_DIR / "yoga_agent_context.json").read_text(encoding="utf-8"))
    for key in args.scenarios.split(","):
        sc = T.BY_KEY[key]
        ctx = (json.loads((T.FIXTURE_DIR / sc.context).read_text(encoding="utf-8"))
               if sc.context else base_ctx)
        print(f"=== {key}", flush=True)
        first = None
        for i in range(args.runs):
            res = await T.run_scenario(sc, ctx)
            await asyncio.sleep(1.5)          # let cancelled tasks unwind
            if args.no_forced_gc:
                pre_rss, pre_alive = _rss_mb(), _alive_no_gc()
                print(f"run {i + 1:2d} BEFORE gc: rss {pre_rss:7.1f} MB  pipelines in memory "
                      f"{pre_alive}  gc counts {gc.get_count()}", flush=True)
            if args.reclaim:
                # What app/main.py now does ~1 s after every call.
                from app import memory as _mem
                if i == 0:
                    _mem.freeze_startup()
                st = _mem.reclaim(idle=True, corr=f"probe-{i + 1}")
                print(f"run {i + 1:2d} reclaim: freed {st['freed']} objects in {st['gc_ms']} ms",
                      flush=True)
            if args.never_gc:
                # Production's view: no forced collection between calls, only the
                # interpreter's own. How many finished calls are still in memory?
                print(f"run {i + 1:2d} rss {_rss_mb():7.1f} MB  finished pipelines still in memory "
                      f"{_alive_no_gc()}  onnx sessions {_alive_no_gc('InferenceSession')}  "
                      f"threads {threading.active_count()}  gc counts {gc.get_count()}", flush=True)
                continue
            census = _census()
            rss = _rss_mb()
            first = first if first is not None else rss
            tasks = _task_names()
            print(f"run {i + 1:2d} rss {rss:7.1f} MB (+{rss - first:6.1f})  fails={len(res['fails'])}  "
                  f"tasks={len(tasks)}  alive={dict(sorted(census.items()))}", flush=True)
            if i == args.runs - 1:
                for name, n in collections.Counter(tasks).most_common(15):
                    print(f"    task x{n}: {name}")
                pts = [o for o in gc.get_objects() if type(o).__name__ == "PipelineTask"]
                if pts:
                    print(f"    PipelineTask referrer chain: {_referrer_chain(pts[0])}")
    sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
