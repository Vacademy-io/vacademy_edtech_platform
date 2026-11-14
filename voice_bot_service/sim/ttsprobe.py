"""Vendor conformance probe for the TTS: does every sentence we say come back as
speech of a sane length?

Smallest.ai has twice returned a DRONE instead of words — English text tagged
`hi` (82d0baea75, 2026-09-09) and a bare "." (cd671509c0, 2026-09-15: 9 s of
hum mid-reply). Neither was visible to any sim: the stub TTS can't misbehave.
This sends real sentences to the real vendor and flags:
  - audio longer than 2.5x what the text could take (0.45 s a spoken token),
  - audio with no word timestamps although the text has letters,
  - an error status, or no audio at all.

Sources of sentences, in preference order:
  --records <dir>   the raw LLM replies from sim.replay records (yesterday's calls)
  --texts <file>    one sentence per line
  (default)         a built-in smoke set: the shapes that broke before.

On the box (needs SMALLEST_API_KEY from .env):
  docker run --rm --env-file .env -v /tmp/probe/replays:/srv/replays:ro $IMG \
      python -m sim.ttsprobe --records replays --language hi [--ci]
Per-socket cap: the vendor closes a socket after ~100 requests, so the probe
opens a fresh one every 40 sentences. ~0.5 s per sentence.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

SMOKE = [
    "Okay.", "Perfect.", "Got it.", "Thank you.", ".", "...", "नब्बे तीन परसेंट...",
    "Ah, okay, so you've got some automation in place.",
    "ये तो अच्छी बात है सर।", "that's actually a good performance।",
    "हमारे यहाँ 50+ faculties हैं और सभी full-time payroll पर हैं — वो सिर्फ class लेते हैं।",
    "So the reason I called — we work with yoga teachers on everything around their online classes.",
    "Which number should I send the invite to?", "9 4 2 5 6 7 7 7 0 7",
]

_SENT = re.compile(r"(?<=[.!?।])\s+")
# The records hold the model's RAW reply — markers and steering cues included,
# because they are recorded before SentinelGate strips them. Sending those to
# the vendor is not what production does: the nightly of 2026-09-16 reported
# "<<END_CALL>> → 3.7 s of audio" as a vendor fault when nothing of the sort
# ever reaches the TTS (verified: 0 of 3 days' TTS renders contain a marker).
_MARKER_RE = re.compile(r"<<\s*(?:SEND:[^<>]*|END_CALL|TRANSFER)\s*>>|"
                        r"(?<!<)<\s*(?:SEND:[^<>]*|END_CALL|TRANSFER)\s*>(?!>)")
_CUE_RE = re.compile(r"\[[^\]]*\]")


def strip_like_the_sentinel(text: str) -> str:
    """What the TTS would actually be handed: markers and bracketed cues gone."""
    return " ".join(_CUE_RE.sub(" ", _MARKER_RE.sub(" ", text or "")).split())


def sentences_from_records(folder: Path) -> List[str]:
    out: List[str] = []
    for fp in sorted(folder.glob("*.json")):
        try:
            rec = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        for _, reply in rec.get("replies", []):
            for s in _SENT.split(strip_like_the_sentinel(str(reply))):
                s = s.strip()
                if s and any(ch.isalnum() for ch in s) and s not in out:
                    out.append(s)
    return out


def expected_secs(text: str) -> float:
    # Word-based: letter counts undercount Devanagari (matras are combining
    # marks) and a digit is a whole spoken word. Measured on lightning_v3.1_pro
    # /mrunal, 2026-09-15: 11-12 Hindi/English tokens take 6.9-8.0 s, i.e.
    # ~0.6 s a token. Allow 0.45 s a token and flag at 2.5x.
    tokens = [w for w in re.split(r"\s+", text.strip()) if any(ch.isalnum() for ch in w)]
    return max(0.8, 0.45 * len(tokens))


async def probe(texts: List[str], *, api_key: str, model: str, voice: str, language: str,
                sample_rate: int, per_socket: int = 40) -> List[Dict[str, Any]]:
    import websockets
    results: List[Dict[str, Any]] = []
    i = 0
    while i < len(texts):
        batch = texts[i:i + per_socket]
        i += per_socket
        async with websockets.connect("wss://api.smallest.ai/waves/v1/tts/live",
                                      additional_headers={"Authorization": "Bearer " + api_key},
                                      max_size=None) as ws:
            for t in batch:
                msg = {"text": t, "voice_id": voice, "model": model, "language": language,
                       "sample_rate": sample_rate, "word_timestamps": True, "output_format": "pcm"}
                t0 = time.time()
                await ws.send(json.dumps(msg))
                nbytes, words, first, err = 0, [], None, None
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=2.5)
                    except asyncio.TimeoutError:
                        break
                    m = json.loads(raw)
                    st = m.get("status")
                    if st == "chunk":
                        if first is None:
                            first = time.time() - t0
                        nbytes += len(base64.b64decode(m["data"]["audio"]))
                    elif st == "word_timestamp":
                        words.append(m["data"].get("word"))
                    elif st == "complete":
                        break
                    elif st == "error":
                        err = str(m.get("error", m))[:120]
                        break
                secs = nbytes / (sample_rate * 2)
                exp = expected_secs(t)
                has_letters = any(ch.isalnum() for ch in t)
                fails = []
                if err:
                    fails.append(f"error: {err}")
                if has_letters and nbytes == 0:
                    fails.append("no audio")
                if has_letters and nbytes and not words:
                    fails.append("audio without words (drone?)")
                if secs > 2.5 * exp:
                    fails.append(f"audio {secs:.1f}s for text that takes ~{exp:.1f}s")
                results.append({"text": t, "secs": round(secs, 2), "expected": round(exp, 2),
                                "ttfb": None if first is None else round(first, 3),
                                "words": len(words), "fails": fails})
    return results


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", help="folder of sim.replay records — probe their raw replies")
    ap.add_argument("--texts", help="file with one sentence per line")
    ap.add_argument("--language", default=None, help="hi | en (default: from SMALLEST_TTS_LANGUAGE / hi)")
    ap.add_argument("--model", default=None, help="override SMALLEST model (e.g. lightning_v3.1_pro)")
    ap.add_argument("--voice", default=None, help="override SMALLEST voice (e.g. mrunal)")
    ap.add_argument("--limit", type=int, default=400)
    ap.add_argument("--out", default="sim_ttsprobe.json")
    ap.add_argument("--ci", action="store_true")
    args = ap.parse_args()
    from app.config import get_settings
    s = get_settings()
    if not s.smallest_api_key:
        print("SMALLEST_API_KEY missing", file=sys.stderr)
        sys.exit(2)
    if args.records:
        texts = sentences_from_records(Path(args.records))
    elif args.texts:
        texts = [l.strip() for l in Path(args.texts).read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        texts = list(SMOKE)
    texts = texts[:args.limit]
    lang = (args.language or "hi").lower()
    model = args.model or s.smallest_model
    voice = args.voice or s.smallest_voice
    res = await probe(texts, api_key=s.smallest_api_key, model=model,
                      voice=voice, language=lang, sample_rate=s.smallest_sample_rate)
    bad = [r for r in res if r["fails"]]
    for r in res:
        if r["fails"] or args.records is None:
            mark = "FAIL" if r["fails"] else "ok  "
            print(f"{mark} {r['secs']:5.2f}s/{r['expected']:4.1f}s words {r['words']:2d}  {r['text'][:70]!r}"
                  + (f"  ✗ {'; '.join(r['fails'])}" if r["fails"] else ""))
    ttfbs = sorted(r["ttfb"] for r in res if r["ttfb"] is not None)
    p50 = ttfbs[len(ttfbs) // 2] if ttfbs else None
    print(f"summary: {len(res)} sentences, {len(bad)} failed, ttfb p50 {p50}, model {model}/{voice} lang {lang}")
    Path(args.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.ci and bad:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
