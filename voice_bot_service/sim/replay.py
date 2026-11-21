"""Replay a LIVE call through the real pipeline and check invariants.

Every call logs one line at its end — `replay corr=<id> {json}` — with the
STT finals, VAD on/off, bot audio on/off and the model's raw replies. This
turns that record into a timing-sim scenario (the real pipeline, stub STT
emitting the recorded finals at the recorded times, stub LLM answering with
the recorded replies in order) and runs a fixed set of invariants over what
the pipeline did with it. Production produces conversation shapes nobody
writes down by hand; this makes every call a regression test.

On the box:
    C=<corr>; journalctl CONTAINER_NAME=voice-bot-voice-bot-1 -o cat --since "1 day ago" \
      | grep -a "app.bot replay corr=$C" | sed -E 's/.*corr=[^ ]* //' > /tmp/probe/replay_$C.json
    docker run --rm --env-file .env -v /tmp/probe/replay_$C.json:/srv/rec.json:ro $IMG \
      python -m sim.replay --file rec.json --corr $C [--verbose]
`--corr` fetches the agent context from admin-core (the record is not enough
to rebuild the prompt); without network, `--context <json>` takes a fixture.
`--dir <folder>` replays every *.json in it and prints one line per call.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from sim import timing as T
from sim.timing import Say, Scenario

# ── record → scenario ──────────────────────────────────────────────────────

def _hold_lines(finals) -> set:
    """Times of the finals that are the network's hold recording, by the same
    rules as the live gate: a hold line starts it; while on hold,
    turntake.hold_absorbs decides piece by piece; anything else is the person
    coming back."""
    from app.turntake import is_hold_announcement, hold_absorbs
    out, holding, last = set(), False, -99.0
    for t, x in finals:
        x = (x or "").strip()
        if not x:
            continue
        if holding:
            if hold_absorbs(x, t - last):
                out.add(t)
                last = t
                continue
            holding = False
            continue
        if is_hold_announcement(x):
            holding, last = True, t
            out.add(t)
    return out


def _segments(vad: List[List[float]]) -> List[List[float]]:
    """[t, 1/0] events → [[start, stop], …]. An unclosed start ends 0.5 s later."""
    out, start = [], None
    for t, on in vad:
        if on and start is None:
            start = t
        elif not on and start is not None:
            if t - start >= 0.15:
                out.append([start, t])
            start = None
    if start is not None:
        out.append([start, start + 0.5])
    return out


def scenario_from_record(rec: Dict[str, Any], key: str, checks) -> Scenario:
    """Caller turns from the (acoustic) VAD segments; each takes the finals that
    landed between its onset and 3 s after its stop, and those finals are
    re-emitted at their RECORDED times (Say.final_times), mid-speech or after.
    A segment with no final is an UNHEARD turn (finals=[""]).

    Replies: every LLM run the guard let through was recorded with its trigger
    (the last user text) and the model's raw reply, paired by order. The stub
    LLM answers each run with the recorded reply whose trigger best matches
    the run's own last user text — so a pipeline that now runs FEWER times
    (a held short answer, a swallowed re-ask) still gets the right lines, and
    a run that no longer happens simply leaves its reply unused."""
    finals = [(float(t), str(x)) for t, x in rec.get("finals", [])]
    used = set()
    says: List[Say] = []
    for start, stop in _segments(rec.get("vad", [])):
        mine = [(i, t, x) for i, (t, x) in enumerate(finals)
                if i not in used and start - 0.3 <= t <= stop + 3.0]
        for i, _, _ in mine:
            used.add(i)
        texts = [x for _, _, x in mine]
        if not texts and stop - start < 0.4:
            continue                                  # a VAD blip, nothing said
        secs = max(0.4, stop - start)
        if texts:
            says.append(Say(" ".join(texts), secs, at=round(start, 2), finals=texts,
                            final_times=[round(max(t, start + 0.1), 2) for _, t, _ in mine]))
        else:
            says.append(Say("(unheard)", secs, at=round(start, 2), finals=[""], stt_latency=0.4))
    # Finals never attributed to a VAD segment (VAD missed the voice): a short
    # turn at their own time.
    for i, (t, x) in enumerate(finals):
        if i not in used:
            says.append(Say(x, 0.8, at=max(0.0, round(t - 1.0, 2)), finals=[x], final_times=[round(t, 2)]))
    says.sort(key=lambda s: s.at)
    replies = [str(r) for _, r in rec.get("replies", [])]
    runs = [str(r) for _, r in rec.get("runs", [])]
    pairs = list(zip(runs, replies)) if runs else []
    ended = float(rec.get("ended") or 0.0)
    import re as _re
    texts = [x for _, x in finals] + replies
    hindi = sum(1 for x in texts if _re.search(r"[\u0900-\u097F]", x)) * 2 >= max(1, len(texts))
    return Scenario(key, caller=says, replies=replies, checks=checks,
                    max_secs=max(20.0, min(ended + 6.0, 420.0)),
                    reply_for=_reply_matcher(pairs, hindi),
                    note=f"replay of live call; {len(says)} caller turns, {len(replies)} replies")


def _reply_matcher(pairs, hindi: bool = True):
    """Closure: best unconsumed recorded reply for a run's last user text.

    A run the live call never made (the build under test runs the model more
    often) has no recorded reply. It gets a UNIQUE, contentful statement —
    never "Okay.": the gates read a bare acknowledgment as "the bot said
    nothing new" and ask for the next line, so a stub "Okay." manufactured
    cue cascades the live call never had (replay of 1f2b97ab, 2026-10-01).
    `pick.unrecorded` counts them: a high count means the replay has drifted
    from the call it came from."""
    import difflib
    from app.turntake import normalize_spoken
    left = [(normalize_spoken(trig), reply) for trig, reply in pairs]

    def pick(last_user: str):
        if not left:
            pick.unrecorded += 1
            n = pick.unrecorded
            return (f"जी, ये बात नोट कर ली है, पॉइंट नंबर {n}।" if hindi
                    else f"Understood, I have noted that as point number {n}.")
        q = normalize_spoken(last_user or "")
        best, score = 0, -1.0
        for i, (trig, _) in enumerate(left):
            r = difflib.SequenceMatcher(None, trig[-200:], q[-200:]).ratio()
            if r > score:
                best, score = i, r
        if score < 0.45:
            best = 0                                  # nothing close: take the next in order
        return left.pop(best)[1]
    pick.unrecorded = 0
    return pick


# ── invariants ─────────────────────────────────────────────────────────────

def _key(s: str) -> str:
    from app.turntake import spoken_key
    return spoken_key(s)


def _sentences(text: str) -> List[str]:
    import re
    return [p.strip() for p in re.split(r"(?<=[.!?।])\s+", text or "") if p.strip()]


def _is_presence_check(text: str) -> bool:
    t = (text or "").casefold()
    return any(k in t for k in ("सुन पा रहे", "sun paa rahe", "are you still there",
                                "can you hear me"))


def invariants(res: Dict[str, Any]) -> List[str]:
    """What must hold for ANY call, whatever its shape."""
    from app.turntake import caller_checking_presence, caller_asked_to_repeat
    f: List[str] = []
    tr = res.get("transcript", [])
    bot_texts = [t["text"] for t in tr if t["role"] == "assistant"]
    finals = res.get("finals", [])
    # 1. the opening is said once. After the person has spoken, its first
    #    words must not come back (screener flag, re-greet).
    # The OPENING TEXT when the replay knows it: a cut cached opening never
    # reaches the played transcript, and the first entry is then a reply.
    first = res.get("opening_text") or (bot_texts[0] if bot_texts else "")
    if bot_texts and first:
        opening = " ".join(first.split()[:6])
        seen_user = False
        for t in tr[1:]:
            if (t["role"] == "user" and not caller_checking_presence(t["text"])
                    and not caller_asked_to_repeat(t["text"])):
                seen_user = True                      # a substantive turn: the person is here
            elif t["role"] == "assistant" and seen_user and opening and _key(opening) in _key(t["text"]):
                f.append(f"opening replayed mid-call: {opening!r}")
                break
    # 2. no sentence of 5+ words is played twice, unless the caller asked for
    #    it (hello? / say again) in between.
    said: Dict[str, int] = {}
    for idx, t in enumerate(tr):
        if t["role"] != "assistant":
            continue
        for s in _sentences(t["text"]):
            if len(s.split()) < 5:
                continue
            k = _key(s)
            if k in said:
                between = [u["text"] for u in tr[said[k] + 1:idx] if u["role"] == "user"]
                if not any(caller_checking_presence(u) or caller_asked_to_repeat(u) for u in between):
                    f.append(f"said twice: {s[:60]!r}")
            said[k] = idx
    # 3. nothing letterless reaches the TTS
    for s in res.get("tts_texts", []):
        if not any(ch.isalnum() for ch in s):
            f.append(f"letterless text sent to TTS: {s!r}")
    # 4. reply latency (caller stop → bot audio). A turn that was only the hold
    #    recording owes no reply: the person is away.
    on_hold = _hold_lines(finals)

    def _held_after(ce: float) -> bool:
        # The person put us on hold right after this turn: its reply was cut by
        # the hold, and the answer comes when they are back.
        return any(ce - 0.5 <= t <= ce + 6.0 for t in on_hold)

    lat = res.get("turn_latency", [])
    if on_hold:
        # Recompute without the hold: a turn that was only the recording, or one
        # the hold cut off, owes no reply until the person is back.
        lat = []
        for cs, ce in res.get("caller", []):
            mine = [t for t, x in finals if cs <= t <= ce + 3.0 and (x or "").strip()]
            if (mine and all(t in on_hold for t in mine)) or _held_after(ce):
                continue
            nxt = [b for b, _ in res.get("bot", []) if b >= ce]
            if nxt and any(ce <= t <= nxt[0] for t in on_hold):
                continue  # the hold came before the reply could play
            if nxt:
                lat.append(round(nxt[0] - ce, 2))
    slow = [x for x in lat if x > 4.0]
    if slow:
        f.append(f"reply latency over 4 s: {slow}")
    # 5. talk-over: bot audio that STARTS inside a caller turn longer than 1 s
    for cs, ce in res.get("caller", []):
        if ce - cs <= 1.0:
            continue
        for bs, _ in res.get("bot", []):
            if cs + 0.4 < bs < ce - 0.3:
                f.append(f"bot started talking at {bs:.1f}s over the caller ({cs:.1f}–{ce:.1f}s)")
                break
    ended = res.get("ended_at")
    finals = res.get("finals", [])
    # 6. a backchannel must not cost a silence. Call 1e374b99 (2026-09-17):
    #    fifteen "हम्म" / "ठीक है" / "Okay"s each cut the reply and cost
    #    1.7-5.9 s of nothing while the model re-generated what was already
    #    written — and the re-generated sentence came back short.
    for cs, ce in res.get("caller", []):
        words = [x for t, x in finals if cs - 0.3 <= t <= ce + 3.0 and x.strip()]
        if not words or len(" ".join(words).split()) > 3:
            continue                                   # not a backchannel
        if ended is not None and ce > ended - 1.5:
            continue
        spoke_before = any(bs < cs < be + 0.5 for bs, be in res.get("bot", []))
        if not spoke_before:
            continue                                   # they were not talking over us
        if any(bs <= ce <= be for bs, be in res.get("bot", [])):
            continue                                   # the bot talked on through it: no silence
        nxt = [bs for bs, _ in res.get("bot", []) if bs >= ce - 0.2]
        gap = (nxt[0] - ce) if nxt else 99.0
        if gap > 2.0:
            f.append(f"backchannel {' '.join(words)[:20]!r} at {cs:.1f}s cost "
                     f"{gap:.1f}s of silence before the bot spoke again")
    # 8. "Are you there?" right after the bot's OWN acknowledgment-only reply:
    #    the silence was the bot's — it owed the next line (call 22062aac,
    #    2026-09-29: "जी सर।" x4, then 12 s, then the presence check; twice).
    from app.bot import NoRepeatGate
    prev_bot = None
    for t in tr:
        if t["role"] != "assistant":
            continue
        txt = t["text"] or ""
        if (prev_bot is not None and _is_presence_check(txt)
                and _sentences(prev_bot)
                and all(NoRepeatGate._is_filler(x) for x in _sentences(prev_bot))):
            f.append(f"asked 'are you there?' after its own bare {prev_bot.strip()[:24]!r} — "
                     f"the bot owed the next line")
        prev_bot = txt
    # 9. two DIFFERENT questions in one bot turn: the caller can answer one,
    #    and the other is then "already said" (call 22062aac: the marks
    #    question and the name question played back to back).
    from app.turntake import question_topic
    for t in tr:
        if t["role"] != "assistant":
            continue
        topics = {question_topic(x) or _key(x)[:24] for x in _sentences(t["text"] or "")
                  if "?" in x or "？" in x}
        if len(topics) >= 2:
            f.append(f"two different questions in one turn: {(t['text'] or '')[:80]!r}")
    # 10-13 read the stub model's generation log (sim.timing SimLLM.gens),
    #   which queues requests as pipecat's real LLM services do.
    gens = res.get("llm_gens") or []
    fin_t = [t for t, _ in finals]
    # 10. ONE reply per moment. Two requests < 1.2 s apart with no new caller
    #     words between them and the first not interrupted = two replies for
    #     one moment, played back to back. 29% of live calls 27 Sep-1 Oct
    #     (calls 1d28af3a, c05f6c83: a steering cue and the caller's own
    #     still-forming turn each ran the model).
    ran = [g for g in gens if g.get("dropped") is None]   # a retired primary's drop never ran
    for g1, g2 in zip(ran, ran[1:]):
        if g1.get("cancelled") is not None or g1.get("errored") is not None:
            continue
        gap = g2["requested"] - g1["requested"]
        if gap >= 1.2 or any(g1["requested"] < t <= g2["requested"] for t in fin_t):
            continue
        f.append(f"two replies for one moment: runs {gap:.2f}s apart at {g1['requested']:.1f}s "
                 f"({g1.get('trigger', '')[:28]!r} / {g2.get('trigger', '')[:28]!r})")
    # 11. the same reply generated twice in a row (neither interrupted).
    for g1, g2 in zip(gens, gens[1:]):
        if g1.get("cancelled") is not None or g2.get("cancelled") is not None:
            continue
        r1, r2 = g1.get("reply") or "", g2.get("reply") or ""
        if (len(r1.split()) >= 4 and _key(r1)[:80] == _key(r2)[:80]
                and g2["requested"] - g1["requested"] < 6.0):
            f.append(f"the same reply generated twice {g2['requested'] - g1['requested']:.1f}s apart: "
                     f"{r1[:48]!r}")
    # 12. the opening started again after the caller had heard most of it
    #     (call 1f2b97ab: 10.4 s of a 12.4 s cached opening, then "नमस्ते जी…"
    #     from the top). Needs res["opening_text"] (replay_one sets it).
    if res.get("opening_resaid") and res.get("bot") and res.get("opening_text"):
        from app.turntake import opening_expected_secs
        first = res["bot"][0]
        # Heard = first audio up to the first CUT. A cut and the re-said opening
        # can be back to back, and the sim then records ONE bot stretch (replay
        # of 953d5366: cut at ~1 s, re-said, "14.2 s heard").
        cuts = [t for t in res.get("interruption_times") or [] if t > first[0]]
        end = min([first[1]] + cuts[:1])
        heard, exp = end - first[0], opening_expected_secs(res["opening_text"])
        if exp and heard >= 0.5 * exp:
            f.append(f"opening re-said after {heard:.1f}s of ~{exp:.1f}s had played")
    # 13. steering-cue storms: the bot correcting itself run after run
    #     (c05f6c83: five next-step cues in a minute, each another reply).
    cues = [g["requested"] for g in gens if (g.get("trigger") or "").startswith("[")]
    for i in range(len(cues)):
        n = sum(1 for t in cues[i:] if t - cues[i] <= 30.0)
        if n >= 4:
            f.append(f"{n} steering-cue runs within 30 s from {cues[i]:.1f}s")
            break
    # The network's hold recording is not the caller: its pieces need no reply
    # and must not reach the model (see TranscriptCollector's hold branch).
    # 7. every heard caller turn gets a reply (audio within 5 s), unless the call ended
    for cs, ce in res.get("caller", []):
        heard = any(cs <= t <= ce + 3.0 and x.strip() and t not in on_hold for t, x in finals)
        if not heard:
            continue
        if ended is not None and ce > ended - 1.0:
            continue
        if _held_after(ce):
            continue
        # Bot audio PLAYING at or after the end of their turn counts — a reply
        # that talks on through an absorbed "हाँ" answered it. Only a new
        # utterance START counted before, so every absorbed backchannel was
        # "unanswered" (~600 per 172-call corpus).
        if not any(be > ce - 0.3 and bs <= ce + 5.0 for bs, be in res.get("bot", [])):
            f.append(f"caller turn at {cs:.1f}s got no reply within 5 s")
    # 14. two generations at once (a failover: the stalled primary's queued
    #     request and the fallback's rerun) — never two replies composing.
    live = [g for g in gens if g.get("started") is not None]
    for i, g1 in enumerate(live):
        e1 = g1.get("ended") or g1.get("cancelled") or g1.get("errored") or g1["started"]
        for g2 in live[i + 1:]:
            if g2["started"] < e1 - 0.05:
                f.append(f"two generations at once: {g1['started']:.1f}-{e1:.1f}s and "
                         f"{g2['started']:.1f}s ({g1.get('trigger', '')[:24]!r} / {g2.get('trigger', '')[:24]!r})")
                break
    # 15. the caller's words never reached the model. A substantive final
    #     (not a bare backchannel, not the network) must be in some generation's
    #     context within 8 s — a run dropped or superseded must not drop words.
    from app.turntake import (mid_reply_action, ABSORB, is_carrier_announcement,
                              is_call_screener)
    ctxs = res.get("contexts") or []
    seen = [(g["requested"], _key(" ".join(c for r, c in (ctxs[i] if i < len(ctxs) else [])
                                          if r == "user")))
            for i, g in enumerate(gens)]
    for t, x in finals:
        x = (x or "").strip()
        if (not x or mid_reply_action(x) == ABSORB or is_carrier_announcement(x)
                or is_call_screener(x) or t in on_hold):
            continue
        if ended is not None and t > ended - 8.0:
            continue
        k = _key(x)[:20]
        if k and not any(t - 0.5 <= rt <= t + 8.0 and k in uk for rt, uk in seen):
            f.append(f"caller words never reached the model: {x[:40]!r} at {t:.1f}s")
    return f


# ── run ────────────────────────────────────────────────────────────────────

async def _context_for(corr: str | None, agent: str | None, ctx_file: str | None) -> Dict[str, Any]:
    if ctx_file:
        return json.loads(Path(ctx_file).read_text(encoding="utf-8"))
    if corr:
        try:
            from app.admin_core import get_call_context
            return await get_call_context(corr, agent or None)
        except Exception as e:  # noqa: BLE001
            print(f"context fetch failed ({type(e).__name__}: {str(e)[:80]}) — using the yoga fixture",
                  file=sys.stderr)
    return json.loads((T.FIXTURE_DIR / "yoga_agent_context.json").read_text(encoding="utf-8"))


def production_audio(ctx: Dict[str, Any]):
    """(engine, cache_warm, opening) as the agent runs in production: Navana /
    Smallest through their protocol fakes, and a FULL/FIXED speech cache with
    the opening already cached — ONE blob, whose text reaches the played
    transcript only when it ends (call 1f2b97ab). The plain SimTTS with the
    cache OFF could never reproduce that."""
    from app.bot import _clean_opening, _fill_placeholders
    a = ctx.get("agent") or {}
    model = (a.get("tts_model") or "").lower()
    engine = ("navana" if model.startswith("navana")
              else "smallest" if model.startswith("smallest") else "sim")
    try:
        opening = _clean_opening(_fill_placeholders((a.get("openingLine") or "").strip(), ctx,
                                                    full_name=True))
    except Exception:  # noqa: BLE001
        opening = ""
    cached = (a.get("speech_cache_mode") or "").upper() in ("FULL", "FIXED")
    return engine, ([opening] if opening and cached and engine != "sim" else []), opening


async def replay_one(rec: Dict[str, Any], corr: str, ctx: Dict[str, Any], verbose: bool,
                     faithful: bool = False) -> Dict[str, Any]:
    sc = scenario_from_record(rec, f"replay-{corr[:8]}", invariants)
    engine, warm, opening = production_audio(ctx)
    if faithful:
        sc.engine, sc.cache_warm = engine, warm
    sc.checks = lambda r, _o=opening: invariants({**r, "opening_text": _o})
    res = await T.run_scenario(sc, ctx, verbose)
    res["opening_text"] = opening
    res["engine"] = sc.engine
    res["unrecorded_replies"] = getattr(sc.reply_for, "unrecorded", 0)
    res["caller_turns"] = len(sc.caller)
    res["replies"] = len(sc.replies)
    return res


async def main():
    import os, tempfile
    os.environ.setdefault("TTS_CACHE_DIR", tempfile.mkdtemp(prefix="sim-replay-cache-"))
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="one replay record (json)")
    ap.add_argument("--dir", help="folder of replay records (*.json), one run each")
    ap.add_argument("--corr", default="", help="call corr id — fetches the agent context from admin-core")
    ap.add_argument("--context", help="agent context json (offline alternative to --corr)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--out", default="sim_replay.json")
    ap.add_argument("--ci", action="store_true")
    ap.add_argument("--faithful", action="store_true",
                    help="the agent's own TTS engine (Navana/Smallest fakes) and speech cache, "
                         "opening pre-cached — as production runs it")
    ap.add_argument("--app-log", action="store_true",
                    help="show app.* INFO lines (the gates' decisions) alongside events")
    args = ap.parse_args()
    if args.app_log:
        import logging
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("        app: %(message)s"))
        logging.getLogger("app").addHandler(h)
        logging.getLogger("app").setLevel(logging.INFO)
    files = [Path(args.file)] if args.file else sorted(Path(args.dir).glob("*.json"))
    results = []
    for fp in files:
        rec = json.loads(fp.read_text(encoding="utf-8"))
        corr = args.corr or fp.stem.replace("replay_", "")
        # A committed fixture names its own offline context (no admin-core in CI).
        ctx_file = args.context or (str(T.FIXTURE_DIR / rec["_context"]) if rec.get("_context") else None)
        ctx = await _context_for(corr if not ctx_file else None, rec.get("agent"), ctx_file)
        try:
            res = await replay_one(rec, corr, ctx, args.verbose, faithful=args.faithful)
        except Exception as e:  # noqa: BLE001
            res = {"key": corr, "fails": [f"run error: {type(e).__name__}: {str(e)[:160]}"]}
        res["corr"] = corr
        results.append(res)
        st = "FAIL" if res["fails"] else "ok  "
        print(f"{st} {corr[:8]} turns {res.get('caller_turns', '?')} replies {res.get('replies', '?')} "
              f"latency {res.get('turn_latency')} ended {res.get('ended_at')}")
        for x in res["fails"]:
            print(f"       ✗ {x}")
    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"report → {args.out}")
    if args.ci and any(r["fails"] for r in results):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
