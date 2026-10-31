"""MX lookup for published emails (injected into engine.research.contacts), over
DNS-over-HTTPS like the engine did: an email whose domain has no mail server
would bounce. True / False when known, None when the lookup failed. Cached per
process for a day,
at most CACHE_MAX domains (LRU). Synchronous: it runs on the research worker thread."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Optional, Tuple

import httpx

DOH = ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")
TTL_S = 24 * 3600
TIMEOUT_S = 5.0
CACHE_MAX = 5000   # domains kept (least recently used dropped first)

_cache: "OrderedDict[str, Tuple[float, Optional[bool]]]" = OrderedDict()
_lock = threading.Lock()


def mx_lookup(domain: str) -> Optional[bool]:
    domain = (domain or "").lower().strip(".")
    if not domain or "." not in domain:
        return False
    now = time.monotonic()
    with _lock:
        hit = _cache.get(domain)
        if hit and now - hit[0] < TTL_S:
            _cache.move_to_end(domain)
            return hit[1]
    result: Optional[bool] = None
    for url in DOH:
        try:
            resp = httpx.get(url, params={"name": domain, "type": "MX"},
                             headers={"accept": "application/dns-json"}, timeout=TIMEOUT_S)
            if resp.status_code != 200:
                continue
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            continue
        status = data.get("Status")
        if status == 3:       # NXDOMAIN: the domain does not exist
            result = False
        elif status == 0:
            result = any(int(a.get("type") or 0) == 15 for a in data.get("Answer") or [])
        if result is not None:
            break
    with _lock:
        _cache[domain] = (now, result)
        _cache.move_to_end(domain)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
    return result


__all__ = ["mx_lookup"]
