"""Search APIs for the Lead Agent (spec §3.4 of the plan): Serper and Parallel.

Which provider for what:
  * Serper (Google web + Maps): organisation discovery, website lookups, Maps lane.
  * Parallel Search API (api.parallel.ai/v1/search, mode "fast"): buying-signal and
    keyword searches and the decision-maker lookup; its excerpts carry a name and a
    number together, which is what the lookup needs.

Both return the engine's SearchResult(query, rank, title, url, snippet) (Parallel's
excerpts are joined into the snippet, at most 1,500 characters). Results are cached
in lead_search_cache for 7 days (key = sha256(provider|kind|query|location|page));
a real call is counted into lead_agent_day.searches / cost_usd when the caller
passes a SearchCounter. Keys come from the environment (SERPER_API_KEYS, comma
separated, rotated; PARALLEL_API_KEY) and are never logged.
"""
from __future__ import annotations

import asyncio
import hashlib
import itertools
import logging
import os
import threading
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

import httpx

from . import db as ladb
from . import store

try:  # the engine's result type, so discovery and the lookup can use results as they are
    from .engine.discovery.search import SearchFailed, SearchResult
except Exception:  # noqa: BLE001 - engine not importable (yet): same shape
    @dataclass(frozen=True)
    class SearchResult:  # type: ignore[no-redef]
        query: str
        rank: int
        title: str
        url: str
        snippet: str

    class SearchFailed(Exception):  # type: ignore[no-redef]
        pass

logger = logging.getLogger(__name__)

SERPER_SEARCH_URL = "https://google.serper.dev/search"
SERPER_MAPS_URL = "https://google.serper.dev/maps"
PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search"

SNIPPET_MAX = 1500
TIMEOUT_S = 20.0
# What one call costs us (USD), for lead_agent_day.cost_usd: Serper bills credits
# (web search 1, maps 3; about $0.001 each at our tier), Parallel "fast" $1 per 1,000.
SERPER_USD_PER_CREDIT = 0.001
PARALLEL_USD_PER_SEARCH = 0.001

COUNTRY_CODES = {
    "india": "in", "in": "in", "united arab emirates": "ae", "uae": "ae", "ae": "ae", "saudi arabia": "sa",
    "sa": "sa", "qatar": "qa", "oman": "om", "kuwait": "kw", "bahrain": "bh", "united kingdom": "gb", "uk": "gb",
    "gb": "gb", "england": "gb", "australia": "au", "au": "au", "united states": "us", "usa": "us", "us": "us",
    "canada": "ca", "singapore": "sg", "nepal": "np", "bangladesh": "bd", "sri lanka": "lk", "new zealand": "nz",
    "south africa": "za", "nigeria": "ng", "kenya": "ke", "malaysia": "my", "philippines": "ph", "indonesia": "id",
}


class SearchUnavailable(SearchFailed):
    """No key configured, or every key was refused."""


def country_code(country: Optional[str]) -> Optional[str]:
    return COUNTRY_CODES.get(str(country or "").strip().lower())


def market_location(market: Optional[dict]) -> Optional[str]:
    """'Indore, Madhya Pradesh, India' (Serper's `location`), or None."""
    m = market or {}
    parts = [str(m.get(k)).strip() for k in ("city", "state", "country") if m.get(k) and str(m.get(k)).strip()]
    return ", ".join(parts) or None


def cache_key(provider: str, kind: str, query: str, location: Optional[str], page: int) -> str:
    raw = f"{provider}|{kind}|{' '.join(query.lower().split())}|{(location or '').lower()}|{int(page)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class SearchCounter:
    """Where a real (uncached) search is counted: lead_agent_day of this agent."""
    agent_id: str
    day: date

    def count(self, usd: float) -> None:
        try:
            with ladb.session() as db:
                store.bump_day(db, self.agent_id, self.day, searches=1, cost_usd=round(usd, 6))
        except Exception:  # noqa: BLE001 - a counter must never fail a search
            logger.warning("lead agent: could not count a search for agent %s", self.agent_id, exc_info=True)


def _cached(key: str) -> Optional[Any]:
    try:
        with ladb.session() as db:
            return store.cached_search(db, key)
    except Exception:  # noqa: BLE001 - no cache = a real search
        logger.warning("lead agent: search cache read failed", exc_info=True)
        return None


def _remember(key: str, provider: str, kind: str, query: str, results: Any) -> None:
    try:
        with ladb.session() as db:
            store.put_search(db, key=key, provider=provider, kind=kind, query=query, results=results)
    except Exception:  # noqa: BLE001
        logger.warning("lead agent: search cache write failed", exc_info=True)


def _as_results(query: str, items: Sequence[dict]) -> List[SearchResult]:
    out = []
    for i, it in enumerate(items or [], start=1):
        url = str(it.get("url") or "")
        if not url.startswith(("http://", "https://")):
            continue
        out.append(SearchResult(query=query, rank=int(it.get("rank") or i), title=str(it.get("title") or "")[:300],
                                url=url[:1000], snippet=str(it.get("snippet") or "")[:SNIPPET_MAX]))
    return out


class SerperClient:
    """Google web + Maps through Serper (POST, X-API-KEY, rotated keys)."""

    def __init__(self, api_keys_csv: Optional[str] = None, *, timeout: float = TIMEOUT_S,
                 transport: Optional[httpx.AsyncBaseTransport] = None):
        if api_keys_csv is None:
            api_keys_csv = os.getenv("SERPER_API_KEYS") or ""
            if not api_keys_csv:
                try:
                    from ...config import get_settings
                    api_keys_csv = get_settings().serper_api_keys or ""
                except Exception:  # noqa: BLE001
                    api_keys_csv = ""
        self._keys = [k.strip() for k in api_keys_csv.split(",") if k.strip()]
        self._cycle = itertools.cycle(range(len(self._keys))) if self._keys else None
        self._lock = threading.Lock()
        self._timeout = timeout
        self._transport = transport

    @property
    def available(self) -> bool:
        return bool(self._keys)

    def _next_keys(self) -> List[str]:
        with self._lock:
            start = next(self._cycle) if self._cycle else 0
        return self._keys[start:] + self._keys[:start]

    async def _post(self, url: str, body: dict) -> dict:
        if not self._keys:
            raise SearchUnavailable("SERPER_API_KEYS is not set")
        last = "no key"
        async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
            for key in self._next_keys():
                try:
                    resp = await client.post(url, json=body, headers={"X-API-KEY": key,
                                                                      "Content-Type": "application/json"})
                except httpx.HTTPError as exc:
                    raise SearchFailed(f"serper: {type(exc).__name__}") from None
                if resp.status_code in (401, 403, 429):
                    last = f"HTTP {resp.status_code}"
                    logger.warning("lead agent: a Serper key was refused (%s); trying the next", last)
                    continue
                if resp.status_code == 400 and body.get("location"):
                    # An unknown location name: Google's canonical names differ; retry country-wide.
                    body = {k: v for k, v in body.items() if k != "location"}
                    resp = await client.post(url, json=body, headers={"X-API-KEY": key,
                                                                      "Content-Type": "application/json"})
                if resp.status_code >= 400:
                    raise SearchFailed(f"serper: HTTP {resp.status_code}")
                try:
                    return resp.json()
                except ValueError:
                    raise SearchFailed("serper: not JSON") from None
        raise SearchUnavailable(f"serper: every key refused ({last})")

    async def search(self, query: str, *, gl: Optional[str] = None, location: Optional[str] = None,
                     num: int = 10, page: int = 1, counter: Optional[SearchCounter] = None) -> List[SearchResult]:
        key = cache_key("serper", "web", query, f"{gl or ''}|{location or ''}", page)
        hit = await asyncio.to_thread(_cached, key)
        if hit is not None:
            return _as_results(query, hit)
        body: Dict[str, Any] = {"q": query, "num": max(1, min(int(num), 10)), "hl": "en"}
        if gl:
            body["gl"] = gl
        if location:
            body["location"] = location
        if page > 1:
            body["page"] = int(page)
        data = await self._post(SERPER_SEARCH_URL, body)
        items = []
        for i, o in enumerate(data.get("organic") or [], start=1):
            snippet = str(o.get("snippet") or "")
            if o.get("date"):
                snippet = f"{o['date']} - {snippet}"
            items.append({"rank": int(o.get("position") or i), "title": o.get("title"), "url": o.get("link"),
                          "snippet": snippet[:SNIPPET_MAX]})
        await asyncio.to_thread(_remember, key, "serper", "web", query, items)
        if counter:
            await asyncio.to_thread(counter.count, float(data.get("credits") or 1) * SERPER_USD_PER_CREDIT)
        return _as_results(query, items)

    async def maps(self, query: str, *, gl: Optional[str] = None, location: Optional[str] = None,
                   page: int = 1, counter: Optional[SearchCounter] = None) -> List[Dict[str, Any]]:
        """Google Maps places: [{title, website, phone, rating, reviews, address, type, cid}]."""
        key = cache_key("serper", "maps", query, f"{gl or ''}|{location or ''}", page)
        hit = await asyncio.to_thread(_cached, key)
        if hit is not None:
            return list(hit)
        body: Dict[str, Any] = {"q": query, "hl": "en"}
        if gl:
            body["gl"] = gl
        if location:
            body["location"] = location
        if page > 1:
            body["page"] = int(page)
        data = await self._post(SERPER_MAPS_URL, body)
        places = [{
            "title": p.get("title"), "website": p.get("website"), "phone": p.get("phoneNumber"),
            "rating": p.get("rating"), "reviews": p.get("ratingCount"), "address": p.get("address"),
            "type": p.get("type"), "cid": p.get("cid"),
        } for p in (data.get("places") or [])]
        await asyncio.to_thread(_remember, key, "serper", "maps", query, places)
        if counter:
            await asyncio.to_thread(counter.count, float(data.get("credits") or 3) * SERPER_USD_PER_CREDIT)
        return places


class ParallelClient:
    """Parallel's Search API, called directly (not through OpenRouter).

    POST https://api.parallel.ai/v1/search, header x-api-key, body
    {objective?, search_queries: [..], mode: "fast", max_chars_total?,
     advanced_settings: {max_results, location: <ISO country>, excerpt_settings: {max_chars_per_result}}}
    -> {search_id, results: [{url, title, publish_date, excerpts: [markdown]}], warnings, usage, session_id}.
    """

    def __init__(self, api_key: Optional[str] = None, *, mode: str = "fast", timeout: float = TIMEOUT_S,
                 transport: Optional[httpx.AsyncBaseTransport] = None):
        if api_key is None:
            api_key = os.getenv("PARALLEL_API_KEY") or ""
            if not api_key:
                try:
                    from ...config import get_settings
                    api_key = getattr(get_settings(), "parallel_api_key", "") or ""
                except Exception:  # noqa: BLE001
                    api_key = ""
        self._key = api_key.strip()
        self._mode = mode
        self._timeout = timeout
        self._transport = transport

    @property
    def available(self) -> bool:
        return bool(self._key)

    async def search(self, query: str, *, objective: Optional[str] = None, country: Optional[str] = None,
                     max_results: int = 8, counter: Optional[SearchCounter] = None) -> List[SearchResult]:
        key = cache_key("parallel", "web", f"{query}|{objective or ''}", country, max_results)
        hit = await asyncio.to_thread(_cached, key)
        if hit is not None:
            return _as_results(query, hit)
        if not self._key:
            raise SearchUnavailable("PARALLEL_API_KEY is not set")
        settings: Dict[str, Any] = {"max_results": max(1, min(int(max_results), 20)),
                                    "excerpt_settings": {"max_chars_per_result": SNIPPET_MAX}}
        if country:
            settings["location"] = country
        body: Dict[str, Any] = {"search_queries": [query], "mode": self._mode, "advanced_settings": settings}
        if objective:
            body["objective"] = objective[:500]
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                resp = await client.post(PARALLEL_SEARCH_URL, json=body,
                                         headers={"x-api-key": self._key, "Content-Type": "application/json"})
        except httpx.HTTPError as exc:
            raise SearchFailed(f"parallel: {type(exc).__name__}") from None
        if resp.status_code in (401, 402, 403):
            raise SearchUnavailable(f"parallel: HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise SearchFailed(f"parallel: HTTP {resp.status_code}")
        try:
            data = resp.json()
        except ValueError:
            raise SearchFailed("parallel: not JSON") from None
        items = []
        for i, r in enumerate(data.get("results") or [], start=1):
            excerpts = [" ".join(str(e).split()) for e in (r.get("excerpts") or []) if e]
            snippet = " … ".join(excerpts)
            if r.get("publish_date"):
                snippet = f"{r['publish_date']} - {snippet}"
            items.append({"rank": i, "title": r.get("title") or "", "url": r.get("url"),
                          "snippet": snippet[:SNIPPET_MAX]})
        await asyncio.to_thread(_remember, key, "parallel", "web", query, items)
        if counter:
            await asyncio.to_thread(counter.count, PARALLEL_USD_PER_SEARCH)
        return _as_results(query, items)


_serper: Optional[SerperClient] = None
_parallel: Optional[ParallelClient] = None


def serper() -> SerperClient:
    global _serper
    if _serper is None:
        _serper = SerperClient()
    return _serper


def parallel() -> ParallelClient:
    global _parallel
    if _parallel is None:
        _parallel = ParallelClient()
    return _parallel


def set_clients(serper_client: Optional[SerperClient] = None, parallel_client: Optional[ParallelClient] = None) -> None:
    """Tests: replace the shared clients."""
    global _serper, _parallel
    _serper, _parallel = serper_client, parallel_client


def run_sync(loop: asyncio.AbstractEventLoop, coro, timeout: float = 120.0):
    """Run `coro` on `loop` from a worker thread (the engine's pure functions
    call search / ask synchronously from a thread)."""
    return asyncio.run_coroutine_threadsafe(coro, loop).result(timeout=timeout)


__all__ = [
    "SearchResult", "SearchFailed", "SearchUnavailable", "SearchCounter", "SerperClient", "ParallelClient",
    "serper", "parallel", "set_clients", "country_code", "market_location", "cache_key", "run_sync",
]
