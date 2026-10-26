"""Finding new organisations for an agent (spec §1 "discover").

One round = a slice of the plan's searches through engine.discovery.pipeline.discover
(search results -> the LLM picks organisations' own sites; buying signals quoted
and checked), plus the Maps lane (Serper /maps: listings with a website, phone,
rating and review count). New organisations are deduplicated by registered domain
against this agent's candidates and the institute's suppressed domains, upserted
into the shared lead_org table and become lead_candidate rows whose home page is
scheduled for fetching in the agent's mode.

cursor_json makes each round search something new:
  {"day": "2026-10-25", "rounds": 2, "org_idx": 8, "org_page": 1, "maps_idx": 3, "maps_page": 1}
The plan's organisation searches are taken QUERIES_PER_ROUND at a time; when the
list wraps, the next pass asks Serper for the next results page (up to MAX_PAGE),
so day after day the agent goes deeper instead of repeating itself.

Routing: organisation searches and website lookups -> Serper (Google); buying-signal
and keyword searches -> Parallel (falls back to Serper when Parallel has no key).
The engine's pure discover() runs on a worker thread; its search / ask callables
hop back onto the event loop (search.run_sync).
"""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Set

from . import db as ladb
from . import engine_api, fetcher, llm, pacing, planner, store
from . import search as search_mod
from .search import SearchCounter, SearchFailed, SearchUnavailable

logger = logging.getLogger(__name__)

QUERIES_PER_ROUND = 4
MAX_PAGE = 5
MAX_ROUNDS_PER_DAY = 8
MAX_SIGNAL_QUERIES = 2          # per industry per round (Parallel)
MAX_KEYWORD_QUERIES = 2
MAX_CANDIDATES_PER_ROUND = 30
SELECTION_MAX_TOKENS = 6000  # reasoning counts as output; see llm.REASONING_EFFORT

ALL_BRIEF_SOURCES = ("organisation_search", "maps", "hiring", "keyword", "software_request", "new_centre")
# engine signal source label -> lead_candidate.source
_LABEL_SOURCE = {
    "Hiring posts": "hiring", "LinkedIn posts and jobs": "hiring", "Looking for software": "software_request",
    "Expansion: new branches": "new_centre", "Keyword search": "keyword",
}


def brief_sources(brief: dict) -> List[str]:
    chosen = [s for s in (brief.get("sources") or ALL_BRIEF_SOURCES) if s in ALL_BRIEF_SOURCES]
    return chosen or list(ALL_BRIEF_SOURCES)


def engine_sources(brief: dict) -> List[str]:
    """Discovery source keys of the engine for the brief's sources (maps is ours, not the engine's)."""
    return engine_api.engine_sources(brief_sources(brief))


def candidate_source(engine_candidate: Any) -> str:
    if engine_candidate.source == "signal":
        signals = (engine_candidate.detail or {}).get("signals") or []
        label = signals[0].get("source") if signals else None
        return _LABEL_SOURCE.get(label or "", "hiring")
    return "organisation_search"


def _slice(items: List[str], start: int, n: int) -> List[str]:
    if not items:
        return []
    return [items[(start + i) % len(items)] for i in range(min(n, len(items)))]


def _fresh_cursor(cursor: Optional[dict], day: str) -> Dict[str, Any]:
    c = dict(cursor or {})
    if c.get("day") != day:
        c["day"], c["rounds"] = day, 0
    c.setdefault("org_idx", 0)
    c.setdefault("org_page", 1)
    c.setdefault("maps_idx", 0)
    c.setdefault("maps_page", 1)
    return c


class _Router:
    """Sync search callables for the engine thread."""

    def __init__(self, loop, *, org_queries: Set[str], signal_queries: Set[str], gl: Optional[str],
                 location: Optional[str], page: int, counter: SearchCounter, country: Optional[str]):
        self.loop, self.org, self.signal = loop, org_queries, signal_queries
        self.gl, self.location, self.page, self.counter, self.country = gl, location, page, counter, country

    async def _one(self, query: str):
        parallel = search_mod.parallel()
        if query in self.signal and parallel.available:
            try:
                return await parallel.search(query, country=self.country, counter=self.counter)
            except SearchUnavailable:
                logger.warning("lead agent: Parallel unavailable; using Serper for a signal search")
        page = self.page if query in self.org else 1
        return await search_mod.serper().search(query, gl=self.gl, location=self.location, page=page,
                                                counter=self.counter)

    def search(self, query: str):
        return search_mod.run_sync(self.loop, self._one(query))

    def search_many(self, queries: List[str]):
        async def all_of():
            res = await asyncio.gather(*(self._one(q) for q in queries), return_exceptions=True)
            out = []
            for q, r in zip(queries, res):
                if isinstance(r, BaseException):
                    logger.warning("lead agent: search '%s' failed: %s", q[:80], r)
                    out.append([])
                else:
                    out.append(r)
            return out
        return search_mod.run_sync(self.loop, all_of(), timeout=300)


async def run_round(agent: Dict[str, Any], plan: Dict[str, Any], need: int) -> Dict[str, Any]:
    """One discovery round for `need` more candidates. Returns a summary."""
    brief = agent.get("brief_json") or {}
    window = agent.get("window_json")
    day = pacing.agent_day(window)
    cursor = _fresh_cursor(agent.get("cursor_json"), day.isoformat())
    if int(cursor.get("rounds") or 0) >= MAX_ROUNDS_PER_DAY:
        return {"skipped": "round limit for today"}
    need = max(1, min(int(need), MAX_CANDIDATES_PER_ROUND))
    markets = [m for m in (agent.get("markets_json") or []) if isinstance(m, dict)]
    first = markets[0] if markets else {}
    gl = search_mod.country_code(first.get("country"))
    location = search_mod.market_location(first) if len(markets) == 1 and first.get("city") else None
    counter = SearchCounter(agent["id"], day)
    ctx = llm.CallContext(institute_id=agent["institute_id"], agent_id=agent["id"], day=day)

    known, suppressed, known_names = await asyncio.to_thread(_known_and_suppressed, agent)
    skip = known | suppressed
    guided = planner.guided_request(agent)
    exclude = plan.get("exclude") or engine_api.leave_out(guided)
    industries = plan.get("industries_detail") or engine_api.guided_industries(guided)
    places = plan.get("places") or engine_api.search_places(guided)
    created: List[str] = []
    notes: List[str] = []

    sources = engine_sources(brief)
    org_all = list(plan.get("search_queries") or [])
    org_slice = _slice(org_all, int(cursor["org_idx"]), QUERIES_PER_ROUND) if "organisation_search" in sources else []
    wrapped = bool(org_all) and int(cursor["org_idx"]) + len(org_slice) >= len(org_all)
    signal_set = _signal_query_set(sources, industries, places, plan)

    if org_slice or any(s != "organisation_search" for s in sources):
        loop = asyncio.get_running_loop()
        router = _Router(loop, org_queries=set(org_slice), signal_queries=signal_set, gl=gl, location=location,
                         page=int(cursor["org_page"]), counter=counter, country=gl)

        def ask(system: str, user: str, output):
            return search_mod.run_sync(loop, llm.ask(system, user, output, purpose="discover", ctx=ctx,
                                                     max_tokens=SELECTION_MAX_TOKENS), timeout=240)

        def run() -> Any:
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix="lead-discover") as pool:
                return engine_api.discover(
                    plan=planner.research_plan(plan, org_slice), candidate_count=need, seeds=[], sources=sources,
                    max_queries=len(org_slice), max_signal_queries=MAX_SIGNAL_QUERIES,
                    search=router.search, search_many=router.search_many, ask=ask,
                    use_signals=any(s != "organisation_search" for s in sources),
                    background=pool.submit, industries=industries, place=places,
                    match_place=plan.get("match_places"), hiring_roles=plan.get("hiring_roles"),
                    keywords=plan.get("keywords"), max_keyword_queries=MAX_KEYWORD_QUERIES,
                    exclude=exclude, skip_domains=set(skip), offer=engine_api.resolve_offer(brief),
                )

        outcome = await asyncio.to_thread(run)
        notes.extend(getattr(outcome, "notes", []) or [])
        for c in outcome.included:
            if not c.domain or not c.website or c.domain in skip:
                continue
            key = engine_api.name_key(c.name or "")
            if key and key in known_names:
                # Same organisation under another domain: one job post resolved to three
                # "Pathfinder School" sites over three rounds (2026-10-26).
                continue
            known_names.add(key)
            detail = dict(c.detail or {})
            cid = await asyncio.to_thread(
                _create, agent, domain=c.domain, name=c.name, website=c.website, source=candidate_source(c),
                discovery={"query": detail.get("query"), "url": detail.get("url"), "title": detail.get("title"),
                           "snippet": detail.get("snippet"), "reason": detail.get("reason"),
                           "signals": detail.get("signals") or [], "website_from": detail.get("website_from")},
                market=first)
            skip.add(c.domain)
            if cid:
                created.append(cid)

    if "maps" in brief_sources(brief) and len(created) < need and industries and places:
        created += await _maps_lane(agent, cursor, industries, places, gl, counter, skip, exclude, first,
                                    need - len(created))

    # advance the cursor
    if org_slice:
        cursor["org_idx"] = (int(cursor["org_idx"]) + len(org_slice)) % max(1, len(org_all))
        if wrapped:
            cursor["org_page"] = 1 if int(cursor["org_page"]) >= MAX_PAGE else int(cursor["org_page"]) + 1
    cursor["rounds"] = int(cursor.get("rounds") or 0) + 1
    await asyncio.to_thread(_finish_round, agent, cursor, day, len(created))
    return {"created": len(created), "queries": org_slice, "notes": notes[:5]}


async def _maps_lane(agent, cursor, industries, places, gl, counter, skip, exclude, market, room) -> List[str]:
    combos = [(i.get("search_term") or i.get("name"), p) for i in industries for p in places if p]
    if not combos:
        return []
    idx = int(cursor.get("maps_idx") or 0)
    term, place = combos[idx % len(combos)]
    page = int(cursor.get("maps_page") or 1)
    cursor["maps_idx"] = (idx + 1) % len(combos)
    if cursor["maps_idx"] == 0:
        cursor["maps_page"] = 1 if page >= MAX_PAGE else page + 1
    try:
        places_found = await search_mod.serper().maps(f"{term} {place}", gl=gl, page=page, counter=counter)
    except SearchFailed as exc:
        logger.warning("lead agent: maps search failed: %s", exc)
        return []
    out: List[str] = []
    for p in places_found:
        if len(out) >= room:
            break
        website = p.get("website")
        if not website:
            continue
        domain = engine_api.registered_domain(website)
        if not domain or domain in skip or engine_api.is_excluded(domain):
            continue
        name = (p.get("title") or domain)[:300]
        if engine_api.left_out(name, exclude):
            continue
        skip.add(domain)
        cid = await asyncio.to_thread(
            _create, agent, domain=domain, name=name, website=engine_api.homepage(website) or website, source="maps",
            discovery={"query": f"{term} {place}", "url": website, "title": name,
                       "maps": {"phone": p.get("phone"), "rating": p.get("rating"), "reviews": p.get("reviews"),
                                "address": p.get("address"), "type": p.get("type")}},
            market={**(market or {}), "city": place if place != (market or {}).get("country") else None})
        if cid:
            out.append(cid)
    return out


def _signal_query_set(sources, industries, places, plan) -> Set[str]:
    """The exact buying-signal / keyword queries discover() will run, so they can be sent to Parallel."""
    out: Set[str] = set()
    try:
        sig = [s for s in sources if s not in ("organisation_search", "keyword_search")]
        if sig:
            out |= {q for _k, q in engine_api.signal_queries(sig, industries, places, MAX_SIGNAL_QUERIES,
                                                            list(plan.get("hiring_roles") or []))}
        if "keyword_search" in sources and plan.get("keywords"):
            out |= {q for _c, q in engine_api.keyword_queries(list(plan["keywords"]), industries, places,
                                                             engine_api.default_keyword_channels(),
                                                             MAX_KEYWORD_QUERIES * max(1, len(places)))}
    except Exception:  # noqa: BLE001 - routing falls back to Serper for everything
        logger.debug("lead agent: could not precompute signal queries", exc_info=True)
    return out


def _known_and_suppressed(agent) -> tuple:
    with ladb.session() as db:
        known = store.known_domains(db, agent["id"])
        names = {engine_api.name_key(n) for n in store.known_names(db, agent["id"])}
        supp = store.suppressed(db, agent["institute_id"]).get("DOMAIN", set())
    return known, set(supp), names


def _create(agent, *, domain: str, name: str, website: str, source: str, discovery: dict,
            market: Optional[dict]) -> Optional[str]:
    """Upsert the organisation, add the candidate and schedule its pages (one session)."""
    with ladb.session() as db:
        org_id = store.upsert_org(db, domain=domain, name=name, website=website,
                                  country=(market or {}).get("country"), state=(market or {}).get("state"),
                                  city=(market or {}).get("city"))
        cid = store.insert_candidate(db, agent_id=agent["id"], institute_id=agent["institute_id"], org_id=org_id,
                                     source=source, discovery=discovery)
        if cid is None:
            return None
        cand = store.get_candidate(db, cid)
        fetcher.schedule_candidate(db, cand, agent)
    return cid


def _finish_round(agent, cursor, day, created: int) -> None:
    with ladb.session() as db:
        store.set_cursor(db, agent["id"], cursor)
        store.bump_day(db, agent["id"], day, discovered=created)
    agent["cursor_json"] = cursor


def schedule_discovered(agent: Dict[str, Any]) -> int:
    """Crash recovery: DISCOVERED candidates whose pages were never scheduled."""
    n = 0
    with ladb.session() as db:
        for cand in store.discovered_candidates(db, agent["id"]):
            fetcher.schedule_candidate(db, cand, agent)
            n += 1
    return n


__all__ = ["run_round", "brief_sources", "engine_sources", "schedule_discovered", "candidate_source"]
