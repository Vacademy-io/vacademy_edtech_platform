"""Finding new organisations for an agent (spec §1 "discover").

One round = a slice of the plan's searches through engine.discovery.pipeline.discover
(search results -> the LLM picks organisations' own sites; buying signals quoted
and checked), plus the Maps lane (Serper /maps: listings with a website, phone,
rating and review count; up to MAPS_PER_ROUND searches while the round still needs
candidates, a whole-country market walked city by city, see places.py). New
organisations are deduplicated by registered domain against this agent's
candidates and the institute's suppressed domains, upserted into the shared
lead_org table and become lead_candidate rows whose home page is scheduled for
fetching in the agent's mode. An agent runs at most round_limit(daily_quota)
rounds a day.

cursor_json makes each round search something new:
  {"day": "2026-10-25", "rounds": 2, "org_key": "…", "org_idx": 8, "org_page": 1,
   "maps_key": "…", "maps_idx": 3, "maps_page": 1, "sig_turn": 17}
The plan's organisation searches are taken QUERIES_PER_ROUND at a time; when the
list wraps, the next pass asks Serper for the next results page (up to MAX_PAGE),
so day after day the agent goes deeper instead of repeating itself. org_key and
maps_key fingerprint the lists the positions belong to: a rebuilt plan (or other
industries or places) starts its searches again from the first results page.
sig_turn counts rounds without resetting at midnight: each round's buying-signal and
keyword searches are the next ones from the list of every role, phrase and keyword
(as many as before), and a whole-country market also walks its major cities, so
rounds stop bringing back the same job posts.

A job post already behind one of the agent's candidates is never read again, and a
new organisation with the name of one the agent has in the same place is skipped
(web and Maps lanes alike). At STANDARD and DEEP validation effort (effort.open_job_post)
the job posts behind hiring signals are opened once a website is found (_PostReader):
a post naming another employer or another place drops that signal, and the post is
remembered (cursor_json["ruled_out_posts"]) so later rounds skip it like a used one.

Routing: organisation searches and website lookups -> Serper (Google); buying-signal
and keyword searches -> Parallel (falls back to Serper when Parallel has no key).
The engine's pure discover() runs on a worker thread; its search / ask callables
hop back onto the event loop (search.run_sync).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Iterable, List, Optional, Set

from . import db as ladb
from . import effort, engine_api, fetcher, llm, pacing, places as places_mod, planner, store
from . import search as search_mod
from .search import SearchCounter, SearchFailed, SearchUnavailable

logger = logging.getLogger(__name__)

QUERIES_PER_ROUND = 4
MAX_PAGE = 5
MAX_ROUNDS_PER_DAY = 8          # the least; round_limit() gives a bigger daily quota more
MAX_ROUNDS_CEILING = 60
MAPS_PER_ROUND = 3
MAX_SIGNAL_QUERIES = 2          # per industry per round (Parallel)
MAX_KEYWORD_QUERIES = 2
MAX_CANDIDATES_PER_ROUND = 30
POST_READS_PER_ROUND = 12      # job posts opened for the post check; the rest keep the search result's decision
RULED_OUT_POSTS_KEPT = 300     # posts the check ruled out, remembered in cursor_json so no round reads them again
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


def round_limit(daily_quota: Any) -> int:
    """Discovery rounds an agent may run in a day: MAX_ROUNDS_PER_DAY, or one for every two leads
    of its daily quota when that is more (at most MAX_ROUNDS_CEILING). Eight rounds found about a
    dozen leads a day, so an agent asked for 100 stopped searching by midday (2026-10-27)."""
    try:
        quota = int(daily_quota or 0)
    except (TypeError, ValueError):
        quota = 0
    return max(MAX_ROUNDS_PER_DAY, min(MAX_ROUNDS_CEILING, math.ceil(quota / 2)))


def _fingerprint(items: Iterable[str]) -> str:
    return hashlib.sha256("\n".join(items).encode("utf-8")).hexdigest()[:12]


def maps_combos(industries: List[dict], places: List[str]) -> List[tuple]:
    """(search term, place) pairs place by place, so every industry is searched in the first
    city before the next city starts."""
    terms = [t for t in ((i.get("search_term") or i.get("name")) for i in industries) if t]
    return [(term, place) for place in places if place for term in terms]


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
    c.setdefault("sig_turn", 0)
    return c


def signal_places(markets: List[dict], places: List[str], turn: int) -> List[str]:
    """The places this round's buying-signal and keyword searches add: the plan's places, except that a
    whole-country market walks the country and then its major cities (places.py), one step a round, so
    no extra searches run. "school hiring admission counsellor India" brought back the same posts every
    round (2026-10-29)."""
    out = []
    for place in places:
        walk = list(dict.fromkeys([place, *places_mod.maps_places(markets, [place])]))
        out.append(walk[turn % len(walk)])
    return list(dict.fromkeys(out))


# States and union territories: two organisations in one state are not in one place. Delhi, Chandigarh
# and Puducherry are cities too, so they are not listed.
_REGIONS = frozenset({
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana",
    "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya",
    "mizoram", "nagaland", "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura",
    "uttar pradesh", "uttarakhand", "uttaranchal", "west bengal", "jammu and kashmir", "kashmir", "ladakh",
    "lakshadweep", "andaman and nicobar islands", "dadra and nagar haveli", "daman and diu", "ncr", "delhi ncr",
})


def _here(*texts: Optional[str]) -> Set[str]:
    """The cities and localities named in these texts (an org's city, a Maps address, a job's location),
    one spelling each, states left out."""
    out: Set[str] = set()
    for t in texts:
        if t:
            out |= {p for p in engine_api.place_keys(t) if p not in _REGIONS}
    return out


def _remember(known: Dict[str, List[Set[str]]], name: str, here: Set[str]) -> None:
    key = engine_api.org_key(name, here)
    if key:
        known.setdefault(key, []).append(set(here))


def _same_org_known(known: Dict[str, List[Set[str]]], name: str, here: Set[str]) -> bool:
    """The agent already has an organisation of this name that is not known to be elsewhere: the same
    name (without its tail or place words) and a place in common, or no place known for one of them."""
    return any(not here or not there or here & there for there in known.get(engine_api.org_key(name, here), []))


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


class _PostReader:
    """read_post for the engine thread (effort.open_job_post): a job post through the server fetcher
    (fetcher.read_post: SSRF-safe, robots.txt honoured, a short timeout), each URL read once a round
    and at most POST_READS_PER_ROUND of them. None = not read (a refusal, an error, over the cap):
    the decision made from the search result then stands."""

    def __init__(self, loop):
        self.loop = loop
        self.pages: Dict[str, Optional[str]] = {}
        self.state: Dict[str, Any] = {}  # robots.txt rules and pauses per host, for this round

    def __call__(self, url: str) -> Optional[str]:
        if url in self.pages:
            return self.pages[url]
        html = None
        if len(self.pages) < POST_READS_PER_ROUND:
            try:
                html = search_mod.run_sync(self.loop, fetcher.read_post(url, self.state),
                                           timeout=fetcher.POST_TIMEOUT_S + fetcher.POST_ROBOTS_TIMEOUT_S + 15)
            except Exception as exc:  # noqa: BLE001 - an unread post keeps the search result's decision
                logger.info("lead agent: job post %s not read: %r", url[:120], exc)
        self.pages[url] = html
        return html


async def run_round(agent: Dict[str, Any], plan: Dict[str, Any], need: int) -> Dict[str, Any]:
    """One discovery round for `need` more candidates. Returns a summary."""
    brief = agent.get("brief_json") or {}
    window = agent.get("window_json")
    day = pacing.agent_day(window)
    cursor = _fresh_cursor(agent.get("cursor_json"), day.isoformat())
    if int(cursor.get("rounds") or 0) >= round_limit(agent.get("daily_quota")):
        return {"skipped": "round limit for today"}
    need = max(1, min(int(need), MAX_CANDIDATES_PER_ROUND))
    markets = [m for m in (agent.get("markets_json") or []) if isinstance(m, dict)]
    first = markets[0] if markets else {}
    gl = search_mod.country_code(first.get("country"))
    location = search_mod.market_location(first) if len(markets) == 1 and first.get("city") else None
    counter = SearchCounter(agent["id"], day)
    ctx = llm.CallContext(institute_id=agent["institute_id"], agent_id=agent["id"], day=day)

    known, suppressed, known_orgs, used_posts = await asyncio.to_thread(_known_and_suppressed, agent)
    skip = known | suppressed
    guided = planner.guided_request(agent)
    exclude = plan.get("exclude") or engine_api.leave_out(guided)
    industries = plan.get("industries_detail") or engine_api.guided_industries(guided)
    places = plan.get("places") or engine_api.search_places(guided)
    created: List[str] = []
    notes: List[str] = []

    sources = engine_sources(brief)
    offer = engine_api.resolve_offer(brief)
    turn = int(cursor.get("sig_turn") or 0)
    round_places = signal_places(markets, places, turn)
    org_all = list(plan.get("search_queries") or [])
    org_key = _fingerprint(org_all)
    if cursor.get("org_key") != org_key:
        # Another plan: its searches start at the first results page. The plan rebuilt on
        # 2026-10-27 searched its new queries from page 5, where the old list had got to.
        cursor.update(org_key=org_key, org_idx=0, org_page=1)
    org_slice =_slice(org_all, int(cursor["org_idx"]), QUERIES_PER_ROUND) if "organisation_search" in sources else []
    wrapped = bool(org_all) and int(cursor["org_idx"]) + len(org_slice) >= len(org_all)
    signal_set = _signal_query_set(sources, industries, round_places, plan, offer, turn)

    if org_slice or any(s != "organisation_search" for s in sources):
        loop = asyncio.get_running_loop()
        router = _Router(loop, org_queries=set(org_slice), signal_queries=signal_set, gl=gl, location=location,
                         page=int(cursor["org_page"]), counter=counter, country=gl)

        def ask(system: str, user: str, output):
            return search_mod.run_sync(loop, llm.ask(system, user, output, purpose="discover", ctx=ctx,
                                                     max_tokens=SELECTION_MAX_TOKENS), timeout=240)

        read_post = _PostReader(loop) if effort.of(agent).open_job_post else None

        def run() -> Any:
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix="lead-discover") as pool:
                return engine_api.discover(
                    plan=planner.research_plan(plan, org_slice), candidate_count=need, seeds=[], sources=sources,
                    max_queries=len(org_slice), max_signal_queries=MAX_SIGNAL_QUERIES,
                    search=router.search, search_many=router.search_many, ask=ask,
                    use_signals=any(s != "organisation_search" for s in sources),
                    background=pool.submit, industries=industries, place=round_places,
                    match_place=plan.get("match_places"), hiring_roles=plan.get("hiring_roles"),
                    keywords=plan.get("keywords"), max_keyword_queries=MAX_KEYWORD_QUERIES,
                    exclude=exclude, skip_domains=set(skip), signal_turn=turn,
                    skip_signal_urls=used_posts | set(cursor.get("ruled_out_posts") or []),
                    offer=offer, read_post=read_post,
                )

        outcome = await asyncio.to_thread(run)
        notes.extend(getattr(outcome, "notes", []) or [])
        ruled_out = [s.get("url") for c in outcome.candidates if not c.included
                     for s in (c.detail or {}).get("signals_ruled_out") or [] if s.get("url")]
        if ruled_out:
            # Not behind any candidate, so known_signal_urls would not stop the next round reading
            # the post, looking its organisation up and ruling it out again.
            kept = [*(cursor.get("ruled_out_posts") or []), *ruled_out]
            cursor["ruled_out_posts"] = list(dict.fromkeys(kept))[-RULED_OUT_POSTS_KEPT:]
        for c in outcome.included:
            if not c.domain or not c.website or c.domain in skip:
                continue
            detail = dict(c.detail or {})
            posts = [(s or {}).get("location") for s in detail.get("signals") or []]
            here = _here(*posts) or _here(first.get("city"))  # where its posts are, else the market's city
            if _same_org_known(known_orgs, c.name or "", here):
                # The same organisation under another domain ("Pulse Academy" at pulseacademy.co.in and
                # pulseacademy-indore.in). By name alone (2026-10-26) this kept the first guess and blocked
                # the right one: The Pathfinder School's Haldwani site after a New Delhi Pathfinder. Since
                # 2026-10-29 the job's place picks the site and a post is read once, so only a same-name
                # organisation in the same place (or with no place known) counts as the same one.
                continue
            _remember(known_orgs, c.name or "", here)
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
        created += await _maps_lane(agent, cursor, industries, places_mod.maps_places(markets, places), gl,
                                    counter, skip, exclude, first, need - len(created), known_orgs)

    # advance the cursor
    if org_slice:
        cursor["org_idx"] = (int(cursor["org_idx"]) + len(org_slice)) % max(1, len(org_all))
        if wrapped:
            cursor["org_page"] = 1 if int(cursor["org_page"]) >= MAX_PAGE else int(cursor["org_page"]) + 1
    cursor["rounds"] = int(cursor.get("rounds") or 0) + 1
    cursor["sig_turn"] = turn + 1
    await asyncio.to_thread(_finish_round, agent, cursor, day, len(created))
    return {"created": len(created), "queries": org_slice, "notes": notes[:5]}


async def _maps_lane(agent, cursor, industries, places, gl, counter, skip, exclude, market, room,
                     known_orgs: Optional[Dict[str, List[Set[str]]]] = None) -> List[str]:
    known_orgs = {} if known_orgs is None else known_orgs
    combos = maps_combos(industries, places)
    if not combos:
        return []
    maps_key = _fingerprint(f"{term}|{place}" for term, place in combos)
    if cursor.get("maps_key") != maps_key:
        cursor.update(maps_key=maps_key, maps_idx=0, maps_page=1)
    out: List[str] = []
    for _ in range(MAPS_PER_ROUND):
        if len(out) >= room:
            break
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
            break
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
            here = _here(p.get("address")) or _here(place)  # a search in one city also lists its neighbours
            if _same_org_known(known_orgs, name, here):
                # One organisation, two websites, both on Maps in one city: "Centurion Defence Academy" at
                # centurionacademy.in and centuriondefenceacademy.com, "Quantum Coaching Institute" at two
                # domains, both Lucknow (2026-10-29).
                continue
            _remember(known_orgs, name, here)
            skip.add(domain)
            cid = await asyncio.to_thread(
                _create, agent, domain=domain, name=name, website=engine_api.homepage(website) or website,
                source="maps",
                discovery={"query": f"{term} {place}", "url": website, "title": name,
                           "maps": {"phone": p.get("phone"), "rating": p.get("rating"), "reviews": p.get("reviews"),
                                    "address": p.get("address"), "type": p.get("type")}},
                market={**(market or {}), "city": place if place != (market or {}).get("country") else None})
            if cid:
                out.append(cid)
    return out


def _signal_query_set(sources, industries, places, plan, offer=None, turn: int = 0) -> Set[str]:
    """The exact buying-signal / keyword queries discover() will run, so they can be sent to Parallel:
    the same places, turn and roles (the offer's own when the plan names none, as discover() does)."""
    out: Set[str] = set()
    try:
        sig = [s for s in sources if s not in ("organisation_search", "keyword_search")]
        roles = list(plan.get("hiring_roles") or [])
        if offer is not None:
            roles = offer.run_hiring_roles(roles or None)
        if sig:
            out |= {q for _k, q in engine_api.signal_queries(sig, industries, places, MAX_SIGNAL_QUERIES, roles, turn)}
        if "keyword_search" in sources and plan.get("keywords"):
            out |= {q for _c, q in engine_api.keyword_queries(list(plan["keywords"]), industries, places,
                                                             engine_api.default_keyword_channels(),
                                                             MAX_KEYWORD_QUERIES * max(1, len(places)), turn)}
    except Exception:  # noqa: BLE001 - routing falls back to Serper for everything
        logger.debug("lead agent: could not precompute signal queries", exc_info=True)
    return out


def _known_and_suppressed(agent) -> tuple:
    """(known domains, suppressed domains, known organisations {name key: [places]}, post URLs already
    behind one of the agent's signals)."""
    with ladb.session() as db:
        known = store.known_domains(db, agent["id"])
        rows = store.known_org_places(db, agent["id"])
        posts = store.known_signal_urls(db, agent["id"])
        supp = store.suppressed(db, agent["institute_id"]).get("DOMAIN", set())
    orgs: Dict[str, List[Set[str]]] = {}
    for row in rows:
        _remember(orgs, row.get("name") or "", _here(row.get("city"), row.get("address"),
                                                     *(row.get("signal_places") or [])))
    return known, set(supp), orgs, posts


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


__all__ = ["run_round", "round_limit", "maps_combos", "brief_sources", "engine_sources", "schedule_discovered",
           "candidate_source", "signal_places"]
