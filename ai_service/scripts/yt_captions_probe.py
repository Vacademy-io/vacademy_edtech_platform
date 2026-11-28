"""Manual live probe for the shared YouTube caption service. NOT run in CI.

Fetches public videos through each configured route (direct, proxy, Supadata)
on its own and prints which strategy succeeded, with the outcome, language,
caption kind, available tracks, snippet count, time, bytes and retries per
video and route, then MB per successful video and Supadata credits spent.

Credentials come from the environment only (YT_CAPTIONS_PROXY,
WEBSHARE_PROXY_USERNAME / WEBSHARE_PROXY_PASSWORD or
YT_CAPTIONS_PROXY_HTTP_URL / _HTTPS_URL, SUPADATA_API_KEY) and are never
printed. The database is not touched unless --write-cache (OK results then go
to course_extract_cache like the service would write them); without it the
Supadata daily cap is not checked either, so keep --ids short.

Run it from a prod pod (the datacenter IP is the realistic case), and from a
laptop for comparison:

  kubectl exec deploy/ai-service -- python -m ai_service.scripts.yt_captions_probe \\
      --routes direct,proxy,supadata --ids <id1>,<id2>,... --repeat 3

Suggested test set (>= 20 videos): Hindi auto-caption-only, English manual,
one 2-hour lecture, one age-restricted, one private, one with captions off.
Put the 3-5 that pass into platform setting youtube_captions.canary_video_ids.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from typing import Any, Dict, List, Optional


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Live probe of the YouTube caption chain (manual; not CI).")
    p.add_argument("--ids", required=True, help="comma list of YouTube video ids or URLs")
    p.add_argument("--routes", default="direct,proxy,supadata", help="comma list of direct,proxy,supadata")
    p.add_argument("--language", default=None, help="requested language (base code, e.g. hi or en)")
    p.add_argument("--repeat", type=int, default=1, help="repeat each video/route N times")
    p.add_argument("--outer-retries", type=int, default=None, help="proxy outer retries (default: setting)")
    p.add_argument("--retries-when-blocked", type=int, default=None, help="override proxy library retries")
    p.add_argument("--countries", default=None, help="override proxy countries, e.g. in,us")
    p.add_argument("--write-cache", action="store_true", help="write OK results to course_extract_cache")
    p.add_argument("--supadata-legacy", action="store_true",
                   help="use the older /v1/youtube/transcript?videoId= Supadata endpoint")
    return p.parse_args(argv)


def _config(args: argparse.Namespace):
    """Env-only config (no platform-settings DB read unless --write-cache)."""
    from dataclasses import replace
    from ai_service.app.services.youtube_captions import service, types as yt_types
    from ai_service.app.services.youtube_captions.youtube_lib import ProxySettings

    if args.write_cache:
        cfg = service.load_config()
    else:
        env = lambda k: (os.getenv(k) or "").strip() or None  # noqa: E731
        yt_types.register_secrets(env("WEBSHARE_PROXY_USERNAME"), env("WEBSHARE_PROXY_PASSWORD"),
                                  env("YT_CAPTIONS_PROXY_HTTP_URL"), env("YT_CAPTIONS_PROXY_HTTPS_URL"),
                                  env("SUPADATA_API_KEY"))
        cfg = service.Config(
            proxy=ProxySettings(
                mode=(env("YT_CAPTIONS_PROXY") or "off").lower(), username=env("WEBSHARE_PROXY_USERNAME"),
                password=env("WEBSHARE_PROXY_PASSWORD"), http_url=env("YT_CAPTIONS_PROXY_HTTP_URL"),
                https_url=env("YT_CAPTIONS_PROXY_HTTPS_URL"), countries=("in", "us"), retries_when_blocked=4,
            ),
            supadata_enabled=True, supadata_key=env("SUPADATA_API_KEY"),
            max_concurrent_interactive=1, max_per_minute=600,
        )
    proxy = cfg.proxy
    if args.retries_when_blocked is not None:
        proxy = replace(proxy, retries_when_blocked=max(0, args.retries_when_blocked))
    if args.countries is not None:
        proxy = replace(proxy, countries=tuple(c.strip().lower() for c in args.countries.split(",") if c.strip()))
    return replace(cfg, proxy=proxy)


async def _main(args: argparse.Namespace) -> int:
    from ai_service.app.services.youtube_captions import cache, service, supadata

    cfg = _config(args)
    service.load_config = lambda: cfg            # the probe runs on exactly this config
    if not args.write_cache:
        cache.supadata_credits_today = lambda: 0  # no DB: the cap is not checked here
        cache.record_supadata_usage = lambda *a, **k: False
        cache.proxy_bytes_today = lambda: 0       # nor the proxy byte budget
        cache.record_proxy_usage = lambda *a, **k: False
    if args.supadata_legacy:
        real = supadata.fetch

        async def legacy_fetch(*a: Any, **k: Any):
            k["legacy"] = True
            return await real(*a, **k)

        supadata.fetch = legacy_fetch

    ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    routes = [r.strip() for r in args.routes.split(",") if r.strip()]
    print(f"proxy mode={cfg.proxy.mode} configured={cfg.proxy.configured} countries={','.join(cfg.proxy.countries)} "
          f"retries_when_blocked={cfg.proxy.retries_when_blocked} supadata_key={'yes' if cfg.supadata_key else 'no'}")
    rows: List[Dict[str, Any]] = []
    for rep in range(max(1, args.repeat)):
        for i in range(0, len(ids), service.MAX_PROBE_IDS):
            got = await service.probe(ids[i:i + service.MAX_PROBE_IDS], routes, args.language,
                                      write_cache=args.write_cache, outer_retries=args.outer_retries)
            for r in got:
                r["rep"] = rep + 1
            rows.extend(got)

    hdr = f"{'video':<12} {'rep':>3} {'route':<9} {'outcome':<15} {'lang':<6} {'kind':<10} {'snip':>5} " \
          f"{'ms':>6} {'KB':>7} {'retry':>5} {'cr':>3}  available / detail"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        tail = ",".join(r.get("available") or []) or (r.get("detail") or r.get("note") or "")
        print(f"{str(r.get('video_id'))[:12]:<12} {r.get('rep', 1):>3} {r['route']:<9} {r.get('outcome', ''):<15} "
              f"{str(r.get('language') or '-')[:6]:<6} {str(r.get('kind') or '-'):<10} {r.get('snippets', 0):>5} "
              f"{r.get('ms', 0):>6} {round((r.get('bytes') or 0) / 1024, 1):>7} {r.get('retries', 0):>5} "
              f"{r.get('supadata_credits', 0):>3}  {tail[:80]}")

    print()
    for route in routes:
        mine = [r for r in rows if r["route"] == route]
        oks = [r for r in mine if r.get("outcome") == "OK"]
        mb = sum((r.get("bytes") or 0) for r in mine) / (1024 * 1024)
        per_ok = (mb / len(oks)) if oks else 0.0
        print(f"{route:<9} ok={len(oks)}/{len(mine)} total_MB={mb:.2f} MB_per_ok={per_ok:.3f}"
              + (f" credits={sum(r.get('supadata_credits') or 0 for r in mine)}" if route == "supadata" else ""))
    winners: Dict[str, str] = {}
    for r in rows:
        if r.get("outcome") == "OK":
            winners.setdefault(str(r["video_id"]), r["route"])
    print()
    for vid in dict.fromkeys(str(r["video_id"]) for r in rows):
        print(f"{vid}: {'succeeded via ' + winners[vid] if vid in winners else 'no route succeeded'}")
    return 0 if winners else 1


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    t0 = time.monotonic()
    code = asyncio.run(_main(args))
    print(f"\ndone in {time.monotonic() - t0:.1f}s")
    return code


if __name__ == "__main__":
    sys.exit(main())
