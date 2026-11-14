"""Live smoke test of the Lead Agent's outside services (not a pytest test).

Runs one Serper web search, one Serper Maps search and one Parallel search for a
query + city, then the server fetcher's page read (safe_fetch + robots.txt +
engine.pagefetch.parse_page) of the top 2 organic results, and prints a compact
summary. No database, no LLM, no keys printed.

Keys come from the environment (SERPER_API_KEYS, PARALLEL_API_KEY); --env-file
loads a KEY=VALUE file into this process only.

    python scripts/lead_agent_smoke.py --query "JEE coaching institute" --city Indore \
        --country India --env-file /path/to/lead_agent.env
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def load_env(path: str) -> None:
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


async def main(args) -> int:
    from app.services.lead_agent import engine_api, fetcher
    from app.services.lead_agent import search as s
    from app.services.safe_http import SafeFetchError, safe_fetch

    # no database here: the 7-day search cache is skipped
    s._cached = lambda key: None
    s._remember = lambda *a, **k: None

    gl = s.country_code(args.country)
    query = f"{args.query} {args.city}".strip()
    serper, parallel = s.SerperClient(), s.ParallelClient()
    print(f"query: {query!r}  gl={gl}  serper keys={'yes' if serper.available else 'NO'}  "
          f"parallel key={'yes' if parallel.available else 'NO'}")

    t = time.monotonic()
    web = await serper.search(query, gl=gl, num=10)
    print(f"\n[serper web] {len(web)} results in {time.monotonic() - t:.1f}s")
    for r in web[:6]:
        print(f"  {r.rank:>2}. {r.title[:70]}  <{engine_api.registered_domain(r.url)}>")

    t = time.monotonic()
    places = await serper.maps(query, gl=gl)
    print(f"\n[serper maps] {len(places)} places in {time.monotonic() - t:.1f}s")
    for p in places[:5]:
        print(f"  - {str(p.get('title'))[:50]}  site={'yes' if p.get('website') else 'no'}  "
              f"phone={'yes' if p.get('phone') else 'no'}  rating={p.get('rating')} ({p.get('reviews')} reviews)")

    signal_q = f"hiring telecaller {args.query} {args.city}"
    t = time.monotonic()
    try:
        par = await parallel.search(signal_q, country=gl)
        print(f"\n[parallel fast] {signal_q!r}: {len(par)} results in {time.monotonic() - t:.1f}s")
        for r in par[:5]:
            print(f"  {r.rank:>2}. {r.title[:60]}  <{engine_api.registered_domain(r.url)}>  "
                  f"snippet {len(r.snippet)} chars")
    except s.SearchFailed as exc:
        print(f"\n[parallel] failed: {exc}")

    print("\n[server fetch] top 2 organic results")
    for r in web[:2]:
        t = time.monotonic()
        try:
            res = await safe_fetch(r.url, max_bytes=fetcher.MAX_PAGE_BYTES, timeout=fetcher.PAGE_TIMEOUT_S,
                                   total_timeout=fetcher.PAGE_TIMEOUT_S + 10, allow_http=True, max_redirects=5,
                                   headers={"User-Agent": fetcher.USER_AGENT})
        except SafeFetchError as exc:
            print(f"  {r.url[:70]}: refused/failed ({exc.code})")
            continue
        html = fetcher._decode(res.content, res.headers.get("content-type", ""))
        rec = engine_api.parse_page(r.url, res.url, html, res.status_code)
        picks = engine_api.choose_pages(rec, 3) if rec.get("access") == "ok" else []
        print(f"  {r.url[:70]}: HTTP {res.status_code}, {len(res.content) // 1024} KB, access={rec.get('access')}, "
              f"text {len(rec.get('text') or '')} chars, {len(rec.get('links') or [])} links, "
              f"form={rec.get('has_form')}, hints={len(rec.get('platform_hints') or [])}, "
              f"next pages={[pt for _u, pt in picks]} ({time.monotonic() - t:.1f}s)")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True)
    ap.add_argument("--city", default="")
    ap.add_argument("--country", default="India")
    ap.add_argument("--env-file")
    a = ap.parse_args()
    if a.env_file:
        load_env(a.env_file)
    logging.basicConfig(level=logging.ERROR)
    sys.exit(asyncio.run(main(a)))
