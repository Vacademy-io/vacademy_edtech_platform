"""Concurrency load test: how many simultaneous calls can ONE bot process carry cleanly?

Runs N copies of timing-simulator scenarios AT THE SAME TIME, in one process and
one event loop -- exactly how uvicorn runs the bot (single worker). Every call is
the real run_bot pipeline (gates, aggregator, Silero VAD, Smart Turn ONNX,
watchdog) on a simulated line paced in real time, so CPU contention shows up the
way it would on a live call: late audio, slow turns, scenario checks failing.

    python -m sim.load                                   # N = 1,3,5,6
    python -m sim.load --calls 1,2,4,6,8 --rounds 2 --json out.json

No credentials, no phone calls, no cost (STT/LLM/TTS are stubs).

Read the result as an UPPER bound for steady state: production also runs vendor
websockets, Plivo mu-law encode/decode and admin-core HTTP on the same loop,
which the stubs skip. The scenarios are short (20-40 s), so per-call START cost
(VAD + Smart Turn session build) is over-weighted versus a 2-minute call, which
makes the number conservative on that side.

DO NOT run this inside a pod that carries live calls -- it competes for the CPU.

Per level:
  loop lag  -- how late a 20 ms ticker wakes up. Audio frames are 20 ms: p99 past
               ~40 ms means callers hear gaps; max past ~250 ms reads as a missed turn.
  cpu       -- process CPU seconds / wall seconds (1.00 = one core fully busy).
               > 1.0 is possible: ONNX/torch worker threads run outside the GIL.
  turn p95  -- caller stops speaking -> bot audio starts, across all calls.
  fails     -- the scenarios' own behaviour checks (the ones CI gates on).
Verdict: FAIL if any check fails or lag p99 > 40 ms or max > 250 ms;
         ok if lag p99 > 20 ms or cpu > 0.7 (works, little headroom); else clean.
"""
from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import os
import statistics
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List

os.environ.setdefault("TTS_CACHE_DIR", tempfile.mkdtemp(prefix="sim-load-cache-"))

from sim import timing as T  # noqa: E402

# Conversational scenarios on the stub TTS (no fake vendor sockets): a mix of a
# barge-in, a backchannel, a fragmented answer and a cached opener.
DEFAULT_SCENARIOS = "yes_over_tail,backchannel_mid_reply,pieces_one_reply,cached_opener_then_pitch"


def _pct(xs: List[float], p: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = min(len(xs) - 1, max(0, int(round(p / 100.0 * (len(xs) - 1)))))
    return xs[k]


async def _lag_probe(samples: List[float], stop: asyncio.Event):
    period = 0.02
    nxt = time.perf_counter() + period
    while not stop.is_set():
        await asyncio.sleep(max(0.0, nxt - time.perf_counter()))
        now = time.perf_counter()
        samples.append(max(0.0, now - nxt))
        nxt = max(nxt + period, now)   # do not "catch up" a backlog of ticks


def _ctx_for(sc) -> Dict[str, Any]:
    name = sc.context or "yoga_agent_context.json"
    return json.loads((T.FIXTURE_DIR / name).read_text(encoding="utf-8"))


async def _one(sc, idx: int) -> Dict[str, Any]:
    # A unique key -> a unique corr per concurrent copy (run_scenario derives
    # corr from the key), so per-call registries never collide.
    copy = dataclasses.replace(sc, key=f"{sc.key}~{idx}")
    try:
        return await T.run_scenario(copy, _ctx_for(sc))
    except Exception as e:  # noqa: BLE001
        return {"key": copy.key, "fails": [f"run error: {type(e).__name__}: {str(e)[:160]}"],
                "turn_latency": []}


async def run_level(n: int, scenarios: List[Any], stagger: float) -> Dict[str, Any]:
    lag: List[float] = []
    stop = asyncio.Event()
    probe = asyncio.create_task(_lag_probe(lag, stop))
    t0, c0 = time.perf_counter(), time.process_time()
    threads_peak = threading.active_count()

    async def staggered(i):
        await asyncio.sleep(i * stagger)
        return await _one(scenarios[i % len(scenarios)], i)

    async def thread_watch():
        nonlocal threads_peak
        while not stop.is_set():
            threads_peak = max(threads_peak, threading.active_count())
            await asyncio.sleep(0.5)

    tw = asyncio.create_task(thread_watch())
    results = await asyncio.gather(*(staggered(i) for i in range(n)))
    wall = time.perf_counter() - t0
    cpu = time.process_time() - c0
    stop.set()
    await probe
    await tw
    lat = [x for r in results for x in r.get("turn_latency", [])]
    fails = {r["key"]: [f for f in r["fails"] if not f.startswith("SHAPE:")]
             for r in results if [f for f in r["fails"] if not f.startswith("SHAPE:")]}
    return {
        "calls": n, "wall_s": round(wall, 1), "cpu_cores": round(cpu / wall, 2),
        "lag_p50_ms": round(_pct(lag, 50) * 1000, 1),
        "lag_p99_ms": round(_pct(lag, 99) * 1000, 1),
        "lag_max_ms": round(max(lag, default=0.0) * 1000, 1),
        "turn_p50_s": round(statistics.median(lat), 2) if lat else None,
        "turn_p95_s": round(_pct(lat, 95), 2) if lat else None,
        "threads_peak": threads_peak,
        "fails": fails,
    }


def verdict(r: Dict[str, Any]) -> str:
    if r["fails"] or r["lag_p99_ms"] > 40 or r["lag_max_ms"] > 250:
        return "FAIL"
    if r["lag_p99_ms"] > 20 or r["cpu_cores"] > 0.7:
        return "ok"
    return "clean"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--calls", default="1,3,5,6", help="concurrency levels to try, in order")
    ap.add_argument("--scenarios", default=DEFAULT_SCENARIOS)
    ap.add_argument("--rounds", type=int, default=1, help="repeat each level")
    ap.add_argument("--stagger", type=float, default=0.3, help="seconds between call starts")
    ap.add_argument("--json", default="", help="write all results here")
    ap.add_argument("--label", default="")
    args = ap.parse_args()
    import logging
    logging.disable(logging.WARNING)          # app.* chatter is not what we measure
    try:
        from loguru import logger
        logger.remove()
        logger.add(sys.stderr, level=os.environ.get("SIM_LOAD_LOG", "ERROR"))
    except Exception:  # noqa: BLE001
        pass
    scs = [T.BY_KEY[k] for k in args.scenarios.split(",")]
    env = {k: os.environ.get(k) for k in ("OMP_NUM_THREADS", "ORT_NUM_THREADS", "MKL_NUM_THREADS")}
    print(f"# label={args.label} cpus={os.cpu_count()} env={env} scenarios={args.scenarios}")
    # Warm-up: the first call pays imports and model loads once per process.
    await _one(scs[0], 999)
    print(f"{'calls':>5} {'verdict':>7} {'wall':>6} {'cpu':>5} {'lag p50/p99/max ms':>22} "
          f"{'turn p50/p95 s':>15} {'thr':>4}  fails")
    out = []
    for n in [int(x) for x in args.calls.split(",")]:
        for _ in range(args.rounds):
            r = await run_level(n, scs, args.stagger)
            r["verdict"] = verdict(r)
            r["label"] = args.label
            out.append(r)
            print(f"{n:>5} {r['verdict']:>7} {r['wall_s']:>6} {r['cpu_cores']:>5} "
                  f"{r['lag_p50_ms']:>6}/{r['lag_p99_ms']:>6}/{r['lag_max_ms']:>7} "
                  f"{str(r['turn_p50_s']):>7}/{str(r['turn_p95_s']):>6} {r['threads_peak']:>4}  "
                  f"{sum(len(v) for v in r['fails'].values())} "
                  f"{'; '.join(f'{k}: {v[0][:70]}' for k, v in list(r['fails'].items())[:2])}",
                  flush=True)
            await asyncio.sleep(3.0)
    if args.json:
        Path(args.json).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
