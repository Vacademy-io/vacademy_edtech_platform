"""Replay a CORPUS of real calls through a build, and compare two builds.

Why (2026-10-01): the deploy gate is ~35 hand-written timing scenarios with a
scripted model. They reproduce the bugs we already know. Production keeps
combining the gates in shapes nobody wrote down — 29% of calls 27 Sep-1 Oct
ran the model twice for one moment — and each fix was proven only against
its own scenario. This replays REAL calls (the `replay corr=` record every
call logs) through the real pipeline, with each agent's own TTS engine and
speech cache, and counts sim.replay's invariants per call. Run it on main
and on the candidate; `compare` lists what the candidate made worse.

    # in the voice_bot_service of the build under test
    python -m sim.corpus run --records DIR --contexts DIR [--select FILE] \\
        [--jobs 10] [--faithful] --out main.json
    python -m sim.corpus compare main.json cand.json

Records hold callers' words: keep them OFF git and CI (local scratch only).
Contexts: one <agent-id>.json per agent (the call-context shape of
sim/fixtures/*_agent_context.json). Each call is its own `python -m
sim.replay` process — replays run in real time, so parallelism is the speed.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

# Failure message → stable kind, so two builds compare by WHAT failed, not by
# timestamps inside the message.
KINDS = [
    ("opening-replayed", r"^opening replayed"),
    ("said-twice", r"^said twice"),
    ("letterless-tts", r"^letterless"),
    ("slow-reply", r"^reply latency"),
    ("talk-over", r"^bot started talking"),
    ("backchannel-silence", r"^backchannel"),
    ("presence-after-ack", r"^asked 'are you there\?'"),
    ("two-questions", r"^two different questions"),
    ("unanswered-turn", r"^caller turn at"),
    ("two-replies-one-moment", r"^two replies for one moment"),
    ("same-reply-twice", r"^the same reply generated twice"),
    ("opening-resaid-heard", r"^opening re-said after"),
    ("cue-storm", r"steering-cue runs within"),
    ("concurrent-generations", r"^two generations at once"),
    ("lost-words", r"^caller words never reached the model"),
    ("run-error", r"^run error"),
    ("timeout", r"^timeout"),
]


def kind_of(msg: str) -> str:
    for k, rx in KINDS:
        if re.search(rx, msg or ""):
            return k
    return "other"


def _build_sha(tree: Path) -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=tree, capture_output=True,
                              text=True, timeout=10).stdout.strip()
    except Exception:  # noqa: BLE001
        return "?"


def _one(rec_path: Path, ctx_path: Path, faithful: bool, tree: Path) -> Dict[str, Any]:
    rec = json.loads(rec_path.read_text(encoding="utf-8"))
    corr = rec_path.stem.replace("replay_", "")
    out = Path(tempfile.mkstemp(prefix=f"corpus-{corr[:8]}-", suffix=".json")[1])
    cmd = [sys.executable, "-m", "sim.replay", "--file", str(rec_path), "--context", str(ctx_path),
           "--out", str(out)] + (["--faithful"] if faithful else [])
    env = dict(os.environ, PYTHONUNBUFFERED="1",
               TTS_CACHE_DIR=tempfile.mkdtemp(prefix=f"corpus-cache-{corr[:8]}-"))
    t0 = time.time()
    row: Dict[str, Any] = {"corr": corr, "agent": rec.get("agent"), "secs": rec.get("ended")}
    try:
        p = subprocess.run(cmd, cwd=tree, capture_output=True, text=True, env=env,
                           timeout=min(float(rec.get("ended") or 0) + 6, 420) + 120)
        res = json.loads(out.read_text(encoding="utf-8"))[0] if out.stat().st_size else {}
        row["fails"] = res.get("fails") if res else [f"run error: exit {p.returncode}: {p.stderr[-300:]}"]
        row["llm_runs"] = len(res.get("llm_gens") or []) if res else None
        row["engine"] = res.get("engine")
        row["unrecorded"] = res.get("unrecorded_replies")
    except subprocess.TimeoutExpired:
        row["fails"] = ["timeout: replay did not finish"]
    except Exception as e:  # noqa: BLE001
        row["fails"] = [f"run error: {type(e).__name__}: {str(e)[:200]}"]
    finally:
        try:
            out.unlink()
        except OSError:
            pass
    row["wall"] = round(time.time() - t0, 1)
    row["kinds"] = dict(collections.Counter(kind_of(m) for m in row["fails"]))
    return row


def cmd_run(a) -> int:
    tree = Path.cwd()
    recs = sorted(Path(a.records).glob("replay_*.json"))
    if a.select:
        want = {l.strip()[:8] for l in Path(a.select).read_text().splitlines() if l.strip()}
        recs = [r for r in recs if r.stem.replace("replay_", "")[:8] in want]
    ctxs = {p.stem: p for p in Path(a.contexts).glob("*.json")}
    jobs, skipped = [], []
    for r in recs:
        agent = json.loads(r.read_text(encoding="utf-8")).get("agent") or ""
        (jobs if agent in ctxs else skipped).append((r, ctxs.get(agent)))
    print(f"build {_build_sha(tree)}: {len(jobs)} calls, {a.jobs} at a time"
          + (f" ({len(skipped)} skipped: no context for their agent)" if skipped else ""), flush=True)
    rows: List[Dict[str, Any]] = []
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futs = {ex.submit(_one, r, c, a.faithful, tree): r for r, c in jobs}
        for i, fu in enumerate(cf.as_completed(futs), 1):
            row = fu.result()
            rows.append(row)
            mark = "ok  " if not row["fails"] else "FAIL"
            print(f"[{i}/{len(jobs)}] {mark} {row['corr'][:8]} {row['secs'] or 0:5.0f}s "
                  f"{' '.join(f'{k}x{n}' for k, n in sorted(row['kinds'].items()))}", flush=True)
    total = collections.Counter()
    for r in rows:
        total.update(r["kinds"])
    report = {"build": _build_sha(tree), "faithful": a.faithful, "calls": len(rows),
              "wall_min": round((time.time() - t0) / 60, 1), "totals": dict(total), "rows": rows}
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(rows)} calls in {report['wall_min']} min — failures by kind:")
    for k, n in total.most_common():
        print(f"  {n:5}  {k}  (in {sum(1 for r in rows if r['kinds'].get(k))} calls)")
    print(f"report → {a.out}")
    return 0


def cmd_compare(a) -> int:
    A = json.loads(Path(a.base).read_text(encoding="utf-8"))
    B = json.loads(Path(a.cand).read_text(encoding="utf-8"))
    ra = {r["corr"]: r for r in A["rows"]}
    rb = {r["corr"]: r for r in B["rows"]}
    both = sorted(set(ra) & set(rb))
    worse: List[tuple] = []
    better: List[tuple] = []
    kinds = sorted({k for c in both for k in list(ra[c]["kinds"]) + list(rb[c]["kinds"])})
    for c in both:
        for k in kinds:
            na, nb = ra[c]["kinds"].get(k, 0), rb[c]["kinds"].get(k, 0)
            if nb > na:
                worse.append((c, k, na, nb, [m for m in rb[c]["fails"] if kind_of(m) == k][:2]))
            elif na > nb:
                better.append((c, k, na, nb))
    print(f"base {A['build']}  vs  candidate {B['build']}  —  {len(both)} calls in both")
    print(f"{'kind':26} {'base':>6} {'cand':>6}   calls base→cand")
    for k in kinds:
        ta = sum(ra[c]["kinds"].get(k, 0) for c in both)
        tb = sum(rb[c]["kinds"].get(k, 0) for c in both)
        ca = sum(1 for c in both if ra[c]["kinds"].get(k))
        cb = sum(1 for c in both if rb[c]["kinds"].get(k))
        flag = "  ▲ WORSE" if tb > ta else ("  ▼ better" if tb < ta else "")
        print(f"{k:26} {ta:6} {tb:6}   {ca:3} → {cb:3}{flag}")
    print(f"\n{len(worse)} call×kind got worse, {len(better)} got better")
    for c, k, na, nb, msgs in worse[: a.show]:
        print(f"  ▲ {c[:8]} {k}: {na} → {nb}  {msgs[0][:110] if msgs else ''}")
    if a.worse_list:
        Path(a.worse_list).write_text("\n".join(sorted({c for c, *_ in worse})) + "\n")
    return 1 if worse and not a.report_only else 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m sim.corpus")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--records", required=True)
    r.add_argument("--contexts", required=True)
    r.add_argument("--select", help="file of corr ids (8-char prefixes are enough), one per line")
    r.add_argument("--jobs", type=int, default=8)
    r.add_argument("--faithful", action="store_true")
    r.add_argument("--out", required=True)
    c = sub.add_parser("compare")
    c.add_argument("base")
    c.add_argument("cand")
    c.add_argument("--show", type=int, default=40)
    c.add_argument("--worse-list", help="write the corr ids that got worse (re-run them to rule out flakes)")
    c.add_argument("--report-only", action="store_true")
    a = ap.parse_args()
    return cmd_run(a) if a.cmd == "run" else cmd_compare(a)


if __name__ == "__main__":
    sys.exit(main())
