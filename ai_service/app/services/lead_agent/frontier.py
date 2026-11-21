"""The search frontier: where an agent keeps finding organisations once its plan's first lists run thin.

Why (prod 2026-11-17): every agent searched a fixed list (the brief's ~6 business kinds in India's 50 major
cities, ~20 web searches) and after three weeks had searched it to the last results page. Telleo, Voomsales
and "Leads for Vacademy" used their day's rounds by noon finding a few new organisations, so a bigger daily
quota brought no more leads. A person refilling the lists every few weeks is not a fix.

A cell is one Maps search: a business kind (term) in a place. The frontier:
  * opens cells in rings: the brief's kinds in the next FRONTIER_RING cities beyond the major ones
    (places.MORE_CITIES), whenever fewer than READY_FLOOR cells are ready;
  * adds new business kinds once a day when the rings run out (or supply is short): one AI call proposes
    sub-kinds and close neighbours INSIDE the brief's industries ("NEET coaching", "diagnostic centre"),
    searched in every city opened so far. A kind outside them would be skipped anyway by the Maps kind
    check (engine discovery/kinds.py), so the frontier widens where and which sub-kinds, never the market;
  * searches a cell page by page; a page that brings nothing new (or the last page) rests the cell for
    REST_DAYS, then it opens again at page 1 (new listings appear);
  * chooses cells by how their leads did: every Maps lead of the agent (first lists and frontier alike) counts
    for its kind and its place: delivered = 1, a call of a minute or more = 1 + TALK_WEIGHT. A cell's score is
    its kind's rate times its place's rate over the agent's overall rate, lower for deeper pages; a kind
    whose leads stay far below the rest after RETIRE_MIN_FOUND organisations is retired for RETIRE_DAYS;
  * checks supply once a day: when the last two working days delivered under SUPPLY_SHORT of the quota it
    opens a ring and asks for new kinds at once, and says so on the agent's card when nothing is left;
  * revisits, once a day, a few organisations rejected 45+ days ago only because their site could not be read
    or showed no contact (sites change): back to DISCOVERED, at most REVISIT_MAX times each.

It starts once the plan's Maps lane has searched past its first page (or supply is short): a new agent first
works through its own lists. The plan's lanes (discovery.py) run as before; the frontier's searches fill what
a round still needs after them (discovery.run_round), FRONTIER_PER_ROUND Maps searches at most.
Agents without the Maps source have no frontier.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
from datetime import timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from pydantic import BaseModel, Field
from sqlalchemy import text

from . import db as ladb
from . import engine_api, llm, pacing, places as places_mod, planner, store

logger = logging.getLogger(__name__)

READY_FLOOR = 12              # ready cells below this: open the next ring (then new kinds)
FRONTIER_PER_ROUND = 3        # Maps searches a round may spend on the frontier
MAX_PAGE = 3                  # a cell's deepest results page before it rests
FULL_PAGE = 10                # fewer listings than this: the last page there is
REST_DAYS = 30
RETIRE_DAYS = 60
RETIRE_MIN_FOUND = 30         # organisations a kind must have brought before it can be retired
RETIRE_BELOW = 0.3            # retired when its rate is under this share of the agent's rate
TALK_WEIGHT = 4               # a call of a minute or more counts this much on top of the delivery
TALK_SECONDS = 60
PAGE_DECAY = 0.6              # each deeper page is worth this much of the one before
NEW_KINDS_PER_CALL = 6
MAX_NEW_KINDS = 36
KIND_MAX_TOKENS = 3000        # reasoning counts as output (llm.REASONING_EFFORT)
STATS_EVERY = timedelta(minutes=30)
STATS_DAYS = 90
SUPPLY_SHORT = 0.6
SUPPLY_DAYS = 2
REVISIT_AFTER_DAYS = 45
REVISIT_MAX = 2
REVISIT_REASONS = ("No readable page", "No usable contact", "No contact published", "No reachable contact")
FINAL = ("DELIVERED", "REJECTED", "SKIPPED")
_KIND_RE = re.compile(r"^[A-Za-z][A-Za-z &'/-]{1,38}[A-Za-z]$")


class FrontierKinds(BaseModel):
    kinds: List[str] = Field(default_factory=list, description="New Google Maps search terms, 1-4 words each")


# ---------------------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------------------
def _key(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def plan_terms(industries: Iterable[dict]) -> List[str]:
    """The Maps search terms of the plan's industries (discovery.maps_combos uses the same)."""
    out = [t for t in ((i.get("search_term") or i.get("name")) for i in industries or [] if isinstance(i, dict)) if t]
    return list(dict.fromkeys(out))


def uses_maps(agent: Dict[str, Any]) -> bool:
    from . import discovery  # discovery imports this module

    return "maps" in discovery.brief_sources(agent.get("brief_json") or {})


def _needs_approval(agent: Dict[str, Any]) -> bool:
    return bool((agent.get("gate_json") or {}).get("require_approval"))


def _fingerprint(items: Iterable[str]) -> str:
    return hashlib.sha256("\n".join(items).encode("utf-8")).hexdigest()[:12]


def split_query(query: str, terms: List[str]) -> Tuple[Optional[str], Optional[str]]:
    """(term, place) of a Maps query "term place" by the longest known term it starts with."""
    q = _key(query)
    for term in sorted({_key(t) for t in terms if t}, key=len, reverse=True):
        if q.startswith(term + " ") and len(q) > len(term) + 1:
            return term, q[len(term) + 1:]
    return None, None


def rate(found: float, value: float, prior: float, weight: float = 2.0) -> float:
    """value per organisation, pulled towards `prior` while little is known."""
    return (value + weight * prior) / (found + weight)


def overall(stats: Dict[str, Any]) -> float:
    f, v = (stats.get("g") or [0, 0])
    return (float(v) + 1.0) / (float(f) + 4.0)


def cell_score(cell: Dict[str, Any], stats: Dict[str, Any]) -> float:
    qg = overall(stats)
    tf, tv = (stats.get("t") or {}).get(_key(cell["term"]), [0, 0])
    pf, pv = (stats.get("p") or {}).get(_key(cell["place"]), [0, 0])
    qt, qp = rate(tf, tv, qg), rate(pf, pv, qg)
    return qt * qp / qg * (PAGE_DECAY ** (max(1, int(cell.get("next_page") or 1)) - 1))


# ---------------------------------------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------------------------------------
def load_state(agent_id: str) -> Dict[str, Any]:
    with ladb.session() as db:
        row = db.execute(text("SELECT state_json FROM lead_search_frontier WHERE agent_id = :a"),
                         {"a": agent_id}).first()
    return dict(row[0] or {}) if row else {}


def save_state(agent_id: str, state: Dict[str, Any]) -> None:
    with ladb.session() as db:
        db.execute(text("""
            INSERT INTO lead_search_frontier (agent_id, state_json) VALUES (:a, CAST(:s AS jsonb))
            ON CONFLICT (agent_id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = now()
        """), {"a": agent_id, "s": store._j(state)})


# ---------------------------------------------------------------------------------------------------------
# cells
# ---------------------------------------------------------------------------------------------------------
def add_cells(agent_id: str, terms: List[str], places: List[str], *, origin: str, rank0: int) -> int:
    """Cells for every term in every place (existing ones kept as they are). Returns how many are new."""
    rows = [{"a": agent_id, "t": t[:200], "p": p[:120], "o": origin, "r": rank0 + i}
            for i, p in enumerate(places) if p for t in terms if t]
    if not rows:
        return 0
    added = 0
    with ladb.session() as db:
        for r in rows:
            hit = db.execute(text("""
                INSERT INTO lead_search_cell (agent_id, term, place, origin, place_rank)
                VALUES (:a, :t, :p, :o, :r) ON CONFLICT (agent_id, term, place) DO NOTHING RETURNING id
            """), r).first()
            added += hit is not None
    return added


def ready_count(agent_id: str) -> int:
    with ladb.session() as db:
        return int(db.execute(text("""
            SELECT count(*) FROM lead_search_cell
             WHERE agent_id = :a AND (status = 'OPEN' OR rest_until <= now())
        """), {"a": agent_id}).scalar() or 0)


def ready_cells(agent_id: str, limit: int = 3000) -> List[Dict[str, Any]]:
    with ladb.session() as db:
        return [dict(r) for r in db.execute(text("""
            SELECT id, term, place, next_page, searches, found, status, place_rank FROM lead_search_cell
             WHERE agent_id = :a AND (status = 'OPEN' OR rest_until <= now())
             ORDER BY place_rank, term LIMIT :n
        """), {"a": agent_id, "n": limit}).mappings()]


def pick(agent_id: str, n: int, stats: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The n ready cells with the best score (bigger places first on a tie). A resting cell whose rest is over
    starts again at page 1."""
    cells = ready_cells(agent_id)
    for c in cells:
        if c["status"] != "OPEN":
            c["next_page"] = 1
    cells.sort(key=lambda c: (-cell_score(c, stats), int(c["place_rank"] or 0), c["term"]))
    return cells[:max(0, n)]


def record_search(cell: Dict[str, Any], *, listings: int, new: int, filled: bool) -> None:
    """After a cell's search: one more search, `new` more organisations; the next page, or a rest when this page
    brought nothing new (and the round still had room), was short, or was the deepest one."""
    page = int(cell.get("next_page") or 1)
    rest = (new == 0 and not filled) or listings < FULL_PAGE or page >= MAX_PAGE
    with ladb.session() as db:
        db.execute(text("""
            UPDATE lead_search_cell
               SET searches = searches + 1, found = found + :new, last_searched_at = now(), updated_at = now(),
                   next_page = CASE WHEN :rest THEN 1 ELSE :page + 1 END,
                   status = CASE WHEN :rest THEN 'RESTING' ELSE 'OPEN' END,
                   rest_until = CASE WHEN :rest THEN now() + make_interval(days => :days) ELSE NULL END
             WHERE id = :id
        """), {"id": cell["id"], "new": int(new), "rest": bool(rest), "page": page, "days": REST_DAYS})


# ---------------------------------------------------------------------------------------------------------
# outcomes
# ---------------------------------------------------------------------------------------------------------
def _talked_numbers(institute_id: str) -> Set[str]:
    """Last 10 digits of the numbers an AI call of TALK_SECONDS or more reached (STATS_DAYS + a month)."""
    try:
        with ladb.session() as db:
            rows = db.execute(text("""
                SELECT DISTINCT right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) FROM ai_call_result
                 WHERE institute_id = :i AND duration_seconds >= :s
                   AND created_at > now() - make_interval(days => :d)
            """), {"i": institute_id, "s": TALK_SECONDS, "d": STATS_DAYS + 30}).fetchall()
    except Exception:  # noqa: BLE001 - without call results the stats still count deliveries
        logger.warning("lead agent frontier: call results unreadable", exc_info=True)
        return set()
    return {r[0] for r in rows if r[0] and len(r[0]) == 10}


def compute_stats(agent: Dict[str, Any], terms: List[str]) -> Dict[str, Any]:
    """{"g": [found, value], "t": {term: [found, value]}, "p": {place: [found, value]}} over the agent's Maps
    organisations of the last STATS_DAYS that reached an end (delivered, rejected, skipped)."""
    with ladb.session() as db:
        rows = db.execute(text("""
            SELECT c.discovery_json->>'query' AS q, c.discovery_json->>'term' AS t, c.discovery_json->>'place' AS p,
                   c.status, c.delivered_response_id AS rid
              FROM lead_candidate c
             WHERE c.agent_id = :a AND c.source = 'maps' AND c.status = ANY(CAST(:final AS VARCHAR[]))
               AND c.created_at > now() - make_interval(days => :d)
        """), {"a": agent["id"], "final": list(FINAL), "d": STATS_DAYS}).mappings().all()
        rids = [r["rid"] for r in rows if r["rid"]]
        phones: Dict[str, str] = {}
        if rids:
            try:
                for rid, mobile in db.execute(text(
                        "SELECT id, parent_mobile FROM audience_response WHERE id = ANY(CAST(:ids AS VARCHAR[]))"),
                        {"ids": rids}).fetchall():
                    digits = re.sub(r"\D", "", mobile or "")[-10:]
                    if len(digits) == 10:
                        phones[rid] = digits
            except Exception:  # noqa: BLE001
                logger.warning("lead agent frontier: delivered leads' phones unreadable", exc_info=True)
    talked = _talked_numbers(agent["institute_id"]) if phones else set()
    g = [0, 0.0]
    by_t: Dict[str, List[float]] = {}
    by_p: Dict[str, List[float]] = {}
    for r in rows:
        term, place = (_key(r["t"]), _key(r["p"])) if r["t"] and r["p"] else split_query(r["q"] or "", terms)
        value = 0.0
        if r["status"] == "DELIVERED":
            value = 1.0 + (TALK_WEIGHT if phones.get(r["rid"]) in talked else 0.0)
        g[0] += 1
        g[1] += value
        for key, bucket in ((term, by_t), (place, by_p)):
            if key:
                b = bucket.setdefault(key, [0, 0.0])
                b[0] += 1
                b[1] += value
    return {"g": g, "t": by_t, "p": by_p}


def retire_weak(agent_id: str, stats: Dict[str, Any]) -> List[str]:
    """Kinds whose leads stay far below the agent's (after RETIRE_MIN_FOUND organisations): their cells rest
    RETIRE_DAYS. Returns the kinds retired now."""
    qg = overall(stats)
    weak = [t for t, (f, v) in (stats.get("t") or {}).items()
            if f >= RETIRE_MIN_FOUND and rate(f, v, qg) < RETIRE_BELOW * qg]
    if not weak:
        return []
    with ladb.session() as db:
        hit = db.execute(text("""
            UPDATE lead_search_cell SET status = 'RETIRED', rest_until = now() + make_interval(days => :d),
                   updated_at = now()
             WHERE agent_id = :a AND lower(term) = ANY(CAST(:t AS VARCHAR[])) AND status <> 'RETIRED'
            RETURNING lower(term)
        """), {"a": agent_id, "t": weak, "d": RETIRE_DAYS}).fetchall()
    return sorted({r[0] for r in hit})


# ---------------------------------------------------------------------------------------------------------
# supply check and revisits
# ---------------------------------------------------------------------------------------------------------
def supply_short(agent: Dict[str, Any]) -> Optional[Dict[str, int]]:
    """{"got", "want"} when the last SUPPLY_DAYS working days (the window's days, before today) brought under
    SUPPLY_SHORT of the quota (leads waiting for review count when a person approves them), else None."""
    quota = int(agent.get("daily_quota") or 0)
    if quota <= 0:
        return None
    window = agent.get("window_json") or {}
    days = {int(d) for d in (window.get("days") or pacing.DEFAULT_WINDOW["days"]) if str(d).isdigit()}
    today = pacing.agent_day(window)
    with ladb.session() as db:
        stats = {r["day"]: r for r in store.day_stats(db, agent["id"], today - timedelta(days=10))}
        created = db.execute(text("SELECT created_at FROM lead_agent WHERE id = :a"), {"a": agent["id"]}).scalar()
    worked = []
    d = today - timedelta(days=1)
    while len(worked) < SUPPLY_DAYS and d > today - timedelta(days=10):
        if d.isoweekday() in days:
            worked.append(d)
        d -= timedelta(days=1)
    if len(worked) < SUPPLY_DAYS or (created is not None and created.date() > worked[-1]):
        return None  # too new to judge
    got = 0
    for day in worked:
        row = stats.get(day) or {}
        got += int(row.get("delivered") or 0) + (int(row.get("review") or 0) if _needs_approval(agent) else 0)
    want = quota * SUPPLY_DAYS
    return {"got": got, "want": want} if got < SUPPLY_SHORT * want else None


def revisit(agent: Dict[str, Any], limit: int) -> int:
    """Organisations rejected REVISIT_AFTER_DAYS+ ago only because their site could not be read or showed no
    contact: back to DISCOVERED (their old fetch tasks dropped, so the home page is read again), at most
    REVISIT_MAX times each. discovery.schedule_discovered schedules them in the same tick."""
    if limit <= 0:
        return 0
    like = " OR ".join(f"reject_reason LIKE :r{i}" for i in range(len(REVISIT_REASONS)))
    params: Dict[str, Any] = {f"r{i}": f"{r}%" for i, r in enumerate(REVISIT_REASONS)}
    params.update(a=agent["id"], d=REVISIT_AFTER_DAYS, m=REVISIT_MAX, n=limit)
    with ladb.session() as db:
        ids = [r[0] for r in db.execute(text(f"""
            SELECT id FROM lead_candidate
             WHERE agent_id = :a AND status = 'REJECTED' AND updated_at < now() - make_interval(days => :d)
               AND COALESCE((discovery_json->>'revisits')::int, 0) < :m AND ({like})
             ORDER BY updated_at LIMIT :n FOR UPDATE SKIP LOCKED
        """), params).fetchall()]
        if not ids:
            return 0
        db.execute(text("DELETE FROM lead_fetch_task WHERE candidate_id = ANY(CAST(:ids AS VARCHAR[])) "
                        "AND status IN ('DONE', 'FAILED')"), {"ids": ids})
        db.execute(text("""
            UPDATE lead_candidate
               SET status = 'DISCOVERED', decision = NULL, score = NULL, score_json = NULL, lead_json = NULL,
                   stage = NULL, reject_reason = NULL, last_error = NULL, attempts = 0, fetch_deadline = NULL,
                   claimed_at = NULL, not_before = now(), updated_at = now(),
                   discovery_json = jsonb_set(discovery_json, '{revisits}',
                                              to_jsonb(COALESCE((discovery_json->>'revisits')::int, 0) + 1))
             WHERE id = ANY(CAST(:ids AS VARCHAR[])) AND status = 'REJECTED'
        """), {"ids": ids})
    return len(ids)


# ---------------------------------------------------------------------------------------------------------
# new kinds (one AI call)
# ---------------------------------------------------------------------------------------------------------
_KIND_SYSTEM = (
    "You widen a B2B lead search on Google Maps. The search has used up the business kinds below in every "
    "city it covers. Suggest NEW Google Maps search terms: sub-kinds and close neighbours of the brief's "
    "industries that the same offer clearly serves, each a short category people type into Google Maps "
    "(1 to 4 words, no city or country, no brand names). Stay INSIDE the brief's industries: never a different "
    "market. Prefer neighbours of the kinds that worked; avoid anything like the kinds that did not work and "
    "anything the brief leaves out. Reply with JSON only.")


def valid_kind(term: str, used: Set[str], exclude: Optional[List[str]],
               industries: Optional[List[dict]] = None) -> Optional[str]:
    """The term cleaned, or None: not a short Maps category, already searched, left out by the brief, or clearly
    a kind of organisation none of the brief's industries is (the Maps kind check would skip its listings, and
    the frontier must never widen the market itself)."""
    t = re.sub(r"\s+", " ", str(term or "")).strip()
    if not _KIND_RE.match(t) or len(t.split()) > 4 or _key(t) in used:
        return None
    if engine_api.left_out(t, exclude):
        return None
    if industries and engine_api.maps_other_kind(t, t, industries):
        return None
    return t


async def new_kinds(agent: Dict[str, Any], plan: Dict[str, Any], state: Dict[str, Any], stats: Dict[str, Any],
                    terms: List[str], exclude: Optional[List[str]], ctx: Optional[llm.CallContext]) -> List[str]:
    """Up to NEW_KINDS_PER_CALL new kinds (validated), [] when the AI is unavailable or adds nothing."""
    qg = overall(stats)
    scored = sorted(((rate(f, v, qg), t, f) for t, (f, v) in (stats.get("t") or {}).items() if f >= 5), reverse=True)
    worked = [t for _q, t, _f in scored[:6]]
    weak = list(dict.fromkeys([*(state.get("retired") or []), *[t for _q, t, _f in scored[-4:] if t not in worked]]))
    industries = [i.get("name") or i.get("search_term") for i in (plan.get("industries_detail") or [])
                  if isinstance(i, dict)]
    user = "\n".join([
        "BRIEF:", planner.request_text(agent),
        "", "INDUSTRIES (stay inside these): " + "; ".join(x for x in industries if x),
        "KINDS ALREADY SEARCHED: " + "; ".join(terms),
        "KINDS THAT WORKED BEST: " + ("; ".join(worked) or "not known yet"),
        "KINDS THAT DID NOT WORK: " + ("; ".join(weak) or "none"),
        "THE BRIEF LEAVES OUT: " + ("; ".join(exclude or []) or "nothing"),
        "", f'Return {{"kinds": [...]}} with up to {NEW_KINDS_PER_CALL} new search terms.',
    ])
    try:
        out = await llm.ask(_KIND_SYSTEM, user, FrontierKinds, purpose="frontier", ctx=ctx, max_tokens=KIND_MAX_TOKENS)
    except (llm.LLMUnavailable, llm.InvalidOutput) as exc:
        logger.warning("lead agent frontier: no new kinds for %s: %s", agent["id"], exc)
        return []
    used = {_key(t) for t in terms}
    kept: List[str] = []
    for k in out.kinds:
        v = valid_kind(k, used, exclude, [i for i in (plan.get("industries_detail") or []) if isinstance(i, dict)])
        if v:
            kept.append(v)
            used.add(_key(v))
        if len(kept) >= NEW_KINDS_PER_CALL:
            break
    return kept


# ---------------------------------------------------------------------------------------------------------
# the tick's step
# ---------------------------------------------------------------------------------------------------------
def base_thin(agent: Dict[str, Any]) -> bool:
    """The plan's Maps lane has searched past its first results page (or is used up today)."""
    cursor = agent.get("cursor_json") or {}
    return int(cursor.get("maps_page") or 1) > 1 or "maps" in (cursor.get("lane_done") or {})


async def maintain(agent: Dict[str, Any], plan: Dict[str, Any],
                   ctx: Optional[llm.CallContext] = None) -> Dict[str, Any]:
    """The tick's frontier step (scheduler.tick_agent, before discovery): the day's supply check and revisits,
    fresh outcome stats, weak kinds retired, the next ring or new kinds when too few cells are ready.
    Returns a summary; "warning" when supply is short and nothing is left to open."""
    if not plan or not uses_maps(agent):
        return {}
    guided = planner.guided_request(agent)
    industries = plan.get("industries_detail") or engine_api.guided_industries(guided)
    places = plan.get("places") or engine_api.search_places(guided)
    markets = [m for m in (agent.get("markets_json") or []) if isinstance(m, dict)]
    base_terms = plan_terms(industries)
    if not base_terms or not places:
        return {}
    exclude = plan.get("exclude") or engine_api.leave_out(guided)
    agent_id = agent["id"]
    state = await asyncio.to_thread(load_state, agent_id)
    out: Dict[str, Any] = {}
    today = pacing.agent_day(agent.get("window_json")).isoformat()

    short = None
    if state.get("check_day") != today:
        short = await asyncio.to_thread(supply_short, agent)
        state.update(check_day=today, warning=None)
        if short:
            out["short"] = short
        n = await asyncio.to_thread(revisit, agent, max(2, int(agent.get("daily_quota") or 0) // 10))
        if n:
            out["revisited"] = n
    if not state.get("active"):
        if not (base_thin(agent) or short):
            await asyncio.to_thread(save_state, agent_id, state)
            return out
        state["active"] = True

    first = places_mod.maps_places(markets, places)
    key = _fingerprint([*map(_key, base_terms), "|", *map(_key, first)])
    if state.get("key") != key:  # another plan: its rings start again (existing cells are kept)
        state.update(key=key, rings=0)
    kinds = [k for k in (state.get("kinds") or []) if k]
    terms = list(dict.fromkeys([*base_terms, *kinds]))

    stale = pacing.now_utc().isoformat() >= str(state.get("stats_next") or "")
    if stale or "stats" not in state:
        state["stats"] = await asyncio.to_thread(compute_stats, agent, terms)
        state["stats_next"] = (pacing.now_utc() + STATS_EVERY).isoformat()
        retired = await asyncio.to_thread(retire_weak, agent_id, state["stats"])
        if retired:
            state["retired"] = sorted({*(state.get("retired") or []), *retired})
            out["retired"] = retired
    retired_now = {_key(t) for t in state.get("retired") or []}
    live = [t for t in terms if _key(t) not in retired_now]

    ready = await asyncio.to_thread(ready_count, agent_id)
    added = 0
    if ready < READY_FLOOR or short:
        ring = int(state.get("rings") or 0) + 1
        cities = places_mod.frontier_places(markets, places, ring)
        if cities:
            added += await asyncio.to_thread(add_cells, agent_id, live, cities, origin="city", rank0=ring * 1000)
            state["rings"] = ring
            out["ring"] = ring
    kinds_added: List[str] = []
    if (ready + added < READY_FLOOR or short) and state.get("kinds_day") != today and len(kinds) < MAX_NEW_KINDS:
        state["kinds_day"] = today
        kinds_added = await new_kinds(agent, plan, state, state.get("stats") or {}, terms, exclude, ctx)
        if kinds_added:
            opened = [*first]
            for r in range(1, int(state.get("rings") or 0) + 1):
                opened += places_mod.frontier_places(markets, places, r)
            added += await asyncio.to_thread(add_cells, agent_id, kinds_added, list(dict.fromkeys(opened)),
                                             origin="kind", rank0=0)
            state["kinds"] = [*kinds, *kinds_added]
            out["new_kinds"] = kinds_added
    if added:
        out["cells_added"] = added
    if short and not added and ready < READY_FLOOR:
        state["warning"] = (f"Few new organisations left to search: {short['got']} leads in the last "
                            f"{SUPPLY_DAYS} working days for a quota of {short['want']}. Every city and business "
                            "kind this brief allows has been searched recently; widen its markets or industries.")
    if state.get("warning"):
        out["warning"] = state["warning"]
    await asyncio.to_thread(save_state, agent_id, state)
    return out


async def run(agent: Dict[str, Any], *, room: int, gl: Optional[str], counter, skip: Set[str],
              exclude, industries, market, known_orgs) -> Tuple[List[str], int]:
    """Up to FRONTIER_PER_ROUND Maps searches on the best ready cells for at most `room` new candidates.
    Returns (their ids, searches made). A failed search ends the frontier's part of the round (the cell is
    untouched and is chosen again)."""
    from . import discovery  # discovery imports this module
    from . import search as search_mod
    from .search import SearchFailed

    if room <= 0:
        return [], 0
    state = await asyncio.to_thread(load_state, agent["id"])
    if not state.get("active"):
        return [], 0
    cells = await asyncio.to_thread(pick, agent["id"], FRONTIER_PER_ROUND, state.get("stats") or {})
    out: List[str] = []
    searched = 0
    kinds = [{"name": k, "search_term": k} for k in state.get("kinds") or []]
    for cell in cells:
        if len(out) >= room:
            break
        page = int(cell.get("next_page") or 1)
        query = f"{cell['term']} {cell['place']}"
        try:
            listings = await search_mod.serper().maps(query, gl=gl, page=page, counter=counter)
        except SearchFailed as exc:
            logger.warning("lead agent frontier: maps search failed: %s", exc)
            break
        searched += 1
        left = room - len(out)
        ids, _other = await discovery.take_listings(
            agent, listings, query=query, place=cell["place"], skip=skip, exclude=exclude,
            industries=[*(industries or []), *kinds], market=market, room=left, known_orgs=known_orgs,
            extra={"cell_id": cell["id"], "term": cell["term"], "place": cell["place"], "frontier": True})
        out += ids
        await asyncio.to_thread(record_search, cell, listings=len(listings), new=len(ids), filled=len(ids) >= left)
    return out, searched


def has_ready(agent_id: str) -> bool:
    """The frontier is on for this agent and has a cell to search. False on any error (a missing table while a
    deploy is half done): the plan's lanes never wait on the frontier."""
    try:
        state = load_state(agent_id)
        return bool(state.get("active")) and ready_count(agent_id) > 0
    except Exception:  # noqa: BLE001
        logger.warning("lead agent frontier: unavailable for %s", agent_id, exc_info=True)
        return False


__all__ = ["maintain", "run", "has_ready", "pick", "cell_score", "compute_stats", "supply_short", "revisit",
           "plan_terms", "split_query", "uses_maps", "FRONTIER_PER_ROUND", "READY_FLOOR"]
