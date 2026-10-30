"""The Lead Agent's background loops (one set per ai_service replica).

Started from the app lifespan like the course-knowledge worker (lazy import,
idempotent start, stopped on shutdown). Every loop idles, touching nothing but
the platform-settings cache, while `lead_agent.enabled` is off or the institute
allowlist is empty.

  * agent tick, every 60 s: re-arm stale fetch tasks and RESEARCHING
    candidates, move finished FETCHING candidates to READY, then lease the due
    ACTIVE agents of allow-listed institutes ONE AT A TIME (tick_owner /
    tick_until, SKIP LOCKED, renewed between steps, released at the end; no
    second worker or run-now ticks an agent while its lease lives) and for each:
    plan (cached weekly); judge the leads waiting in REVIEW again with the
    agent's current gate (no AI; agents that need no approval); discover while
    the pool of leads ready to send plus those on their way is short of
    POOL_DAYS days of the quota, and the wallet / monthly cap allows; deliver
    inside the window, best score first. Once a day:
    retention (expired lead_org_page rows, search cache older than 7 days).
  * research pool: up to lead_agent.max_concurrency candidates researched at
    once (READY claimed with SKIP LOCKED, 15-minute lease, 3 attempts -> FAILED).
  * server fetcher: REMOTE tasks and AUTO tasks unclaimed for 5 minutes, one
    per site at a time.
"""
from __future__ import annotations

import asyncio
import logging
import socket
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from . import billing, delivery, discovery, engine_api, fetcher, flags, llm, pacing, planner, research, store
from . import db as ladb

logger = logging.getLogger(__name__)

TICK_S = 60
DISABLED_SLEEP_S = 60
RESEARCH_IDLE_S = 15
FETCH_IDLE_S = 10
FETCH_BUSY_S = 2
FETCH_BATCH = 6
RETENTION_EVERY_S = 24 * 3600
# Rank and fill (2026-10-30): discovery keeps this many days of the daily quota ready to send (or on its
# way), so each day's delivery picks the best of a pool instead of whatever cleared a fixed bar.
POOL_DAYS = 2
# REVIEW leads judged again per tick (rejudge_waiting): no AI, a few hundred rows a minute at most.
REJUDGE_BATCH = 200

_TASKS: List[asyncio.Task] = []
_running_research: Set[str] = set()
_last_retention = 0.0


def _institutes() -> Optional[List[str]]:
    """None = every institute; [] = nobody (do nothing)."""
    allowed = flags.allowed_institutes()
    if allowed == flags.ALL_INSTITUTES:
        return None
    return sorted(allowed)


def active() -> bool:
    if not flags.platform_enabled():
        return False
    ids = _institutes()
    return ids is None or bool(ids)


# ----------------------------------------------------------------------
# agent tick
# ----------------------------------------------------------------------
def _maintenance() -> None:
    with ladb.session() as db:
        stale = store.rearm_stale_tasks(db)
        cands = store.rearm_stale_candidates(db)
        moved = fetcher.finalize_fetching(db)
    if stale or cands or moved:
        logger.info("lead agent: re-armed %d task(s), %d candidate(s); %d candidate(s) READY",
                    len(stale), len(cands), moved)


def _retention() -> None:
    with ladb.session() as db:
        pages = store.delete_expired_pages(db)
        cache = store.delete_old_search_cache(db)
    logger.info("lead agent retention: deleted %d expired page(s), %d old search(es)", pages, cache)


TICK_OWNER = f"tick:{socket.gethostname()[:40]}:{uuid.uuid4().hex[:8]}"
MAX_AGENTS_PER_TICK = 50


def _claim_next(ids: Optional[List[str]], only_agent: Optional[str]) -> Optional[dict]:
    with ladb.session() as db:
        return store.claim_next_agent(db, institutes=ids, owner=TICK_OWNER, min_interval_s=TICK_S - 5,
                                      only_agent=only_agent)


def _renew_tick(agent_id: str) -> bool:
    with ladb.session() as db:
        return store.renew_tick(db, agent_id, TICK_OWNER)


def _release_tick(agent_id: str) -> None:
    with ladb.session() as db:
        store.release_tick(db, agent_id, TICK_OWNER)


class LeaseLost(Exception):
    """Another worker took the agent over (our tick lease ran out): stop this tick."""


async def _keep_lease(agent_id: str) -> None:
    if not await asyncio.to_thread(_renew_tick, agent_id):
        raise LeaseLost(agent_id)


def needs_approval(agent: dict) -> bool:
    """The agent sends no lead a person has not approved (gate_json.require_approval)."""
    return bool((agent.get("gate_json") or {}).get("require_approval"))


def _pool_state(agent: dict) -> Dict[str, int]:
    with ladb.session() as db:
        return store.pool_counts(db, agent["id"])


def pool_need(agent: dict, counts: Dict[str, int]) -> Dict[str, int]:
    """How many candidates discovery should look for (rank and fill, 2026-10-30):

      pool      = APPROVED leads not delivered yet (+ REVIEW when the agent needs approval: a person
                  turns them into sendable leads)
      in_flight = DISCOVERED / FETCHING / READY / RESEARCHING
      target    = POOL_DAYS x daily_quota
      need      = target - pool - in_flight (never below 0)

    Today's deliveries do not enter it: once today's quota is sent, the pool still feeds the next days.
    The old rule (discover while the backlog was under 3 x the rest of today's quota, and stop once
    today's REVIEW count reached that rest) kept searching while leads piled up in a REVIEW queue nobody
    worked on (2026-10-30: about 820 researched leads waiting; Voomsales 14 delivered, 214 in REVIEW)."""
    quota = max(0, int(agent.get("daily_quota") or 0))
    pool = int(counts.get("approved") or 0) + (int(counts.get("review") or 0) if needs_approval(agent) else 0)
    in_flight = int(counts.get("in_flight") or 0)
    target = POOL_DAYS * quota
    return {"pool": pool, "in_flight": in_flight, "target": target, "need": max(0, target - pool - in_flight)}


def _judgeable(scored: Any, lead: Any) -> bool:
    return isinstance(scored, dict) and isinstance(lead, dict) and all(k in scored for k in store.GATE_INPUTS)


def rejudge_waiting(db, agent: dict, limit: int = REJUDGE_BATCH) -> Dict[str, int]:
    """The agent's leads waiting in REVIEW, judged again from what research stored (score_json,
    lead_json) with the agent's current gate: no AI, no search. AUTO -> APPROVED (delivered with the
    next ones, best score first), REJECT -> REJECTED with the gate's reasons; a lead the gate still
    sends to a person stays in REVIEW. Clears the queue the old two-bar gate left (2026-10-30: about
    820 researched leads in REVIEW, which nobody works on: the funnel after delivery is automated).
    A Maps-only lead or a possible duplicate below the send bar is REJECTED too; at or above it, it
    stays for a person (and is not read again).

    Only for an agent that needs no approval. Never a lead a person decided, nor a row missing what the
    gate reads (store.review_to_rejudge picks the rows), at most `limit` per call. Each move expects
    REVIEW, so a person deciding at the same moment wins, and a second run finds nothing more to do.
    Returns {"approved", "rejected"}.

    lead_agent_day counters are not rewritten: they record what research decided on that day (a lead
    that went to REVIEW on Monday stays in Monday's review count), not where the lead is now."""
    out = {"approved": 0, "rejected": 0}
    gate_cfg = agent.get("gate_json") or {}
    if needs_approval(agent):
        return out
    when = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = store.review_to_rejudge(db, agent["id"], limit=limit, held_flags=engine_api.always_review_flags(),
                                   send_score=engine_api.send_bar(gate_cfg))
    for cand in rows:
        scored, lead = cand.get("score_json"), cand.get("lead_json")
        if not _judgeable(scored, lead):
            continue
        try:
            decision, reasons = engine_api.gate(scored, lead, gate_cfg)
        except Exception:  # noqa: BLE001 - a row the gate cannot read stays in REVIEW for a person
            logger.warning("lead agent: could not judge REVIEW lead %s again", cand["id"], exc_info=True)
            continue
        score_json = {**scored, "gate_reasons": list(reasons), "rejudged_at": when}
        if decision == "AUTO":
            moved = store.set_candidate(db, cand["id"], expect=["REVIEW"], status="APPROVED", decision="AUTO",
                                        score_json=score_json, not_before="now()")
        elif decision == "REJECT":
            moved = store.set_candidate(db, cand["id"], expect=["REVIEW"], status="REJECTED", decision="REJECT",
                                        score_json=score_json, reject_reason="; ".join(reasons)[:300])
        else:
            continue
        if moved is not None:
            out["approved" if decision == "AUTO" else "rejected"] += 1
    return out


def _rejudge(agent: dict) -> Dict[str, int]:
    with ladb.session() as db:
        return rejudge_waiting(db, agent)


def _set_error(agent_id: str, error: Optional[str]) -> None:
    with ladb.session() as db:
        store.set_agent_error(db, agent_id, error)


async def tick_agent(agent: dict) -> dict:
    """Plan, re-judge the REVIEW queue, discover and deliver for one agent. Returns a summary."""
    summary: dict = {"agent_id": agent["id"]}
    day = pacing.agent_day(agent.get("window_json"))
    ctx = llm.CallContext(institute_id=agent["institute_id"], agent_id=agent["id"], day=day)
    try:
        plan = await planner.ensure_plan(agent, ctx=ctx)
    except (llm.LLMUnavailable, llm.InvalidOutput) as exc:
        await asyncio.to_thread(_set_error, agent["id"], f"Planning failed: {exc}")
        plan = None
    await asyncio.to_thread(discovery.schedule_discovered, agent)
    await _keep_lease(agent["id"])
    if not needs_approval(agent):
        # Before pacing and delivery: what the gate passes now counts toward the pool and goes out today.
        try:
            summary["rejudged"] = await asyncio.to_thread(_rejudge, agent)
        except Exception as exc:  # noqa: BLE001 - never in the way of discovery and delivery
            logger.exception("lead agent: re-judging the REVIEW queue of %s failed", agent["id"])
            summary["rejudged"] = {"error": f"{type(exc).__name__}: {str(exc)[:200]}"}
    if plan:
        pace = pool_need(agent, await asyncio.to_thread(_pool_state, agent))
        summary.update(pace)
        if pace["need"] <= 0:
            summary["discovery"] = {"skipped": "pool full"}
        else:
            want = min(pace["need"], discovery.MAX_CANDIDATES_PER_ROUND)
            # The wallet must pay for the leads this round looks for (each may be delivered and charged),
            # but never for more than one day's quota: a wallet that pays for today is enough to search.
            leads = min(want, max(1, int(agent.get("daily_quota") or 0)))
            ok, why = await asyncio.to_thread(billing.affordable, agent, leads)
            if ok:
                try:  # run_round keeps the daily round limit (discovery.round_limit)
                    summary["discovery"] = await discovery.run_round(agent, plan, want)
                except (llm.LLMUnavailable,) as exc:
                    await asyncio.to_thread(_set_error, agent["id"], f"Discovery paused: {exc}")
            else:
                summary["discovery"] = {"skipped": why}
                await asyncio.to_thread(_set_error, agent["id"], why)
    await _keep_lease(agent["id"])
    summary["delivery"] = await delivery.deliver(agent)
    return summary


async def tick_once(only_agent: Optional[str] = None) -> List[dict]:
    global _last_retention
    if not active():
        return []
    ids = _institutes()
    await asyncio.to_thread(_maintenance)
    now = time.monotonic()
    if not _last_retention or now - _last_retention >= RETENTION_EVERY_S:
        _last_retention = now
        try:
            await asyncio.to_thread(_retention)
        except Exception:  # noqa: BLE001
            logger.exception("lead agent: retention failed")
    out = []
    # One agent at a time, each under its own tick lease (tick_owner / tick_until): an agent
    # whose tick runs long is never picked up by another worker or a run-now meanwhile.
    for _ in range(MAX_AGENTS_PER_TICK):
        agent = await asyncio.to_thread(_claim_next, ids, only_agent)
        if agent is None:
            break
        try:
            out.append(await tick_agent(agent))
        except asyncio.CancelledError:
            raise
        except LeaseLost:
            logger.warning("lead agent: lost the tick lease of agent %s; stopped", agent["id"])
            continue
        except Exception as exc:  # noqa: BLE001 - one agent's failure never stops the others
            logger.exception("lead agent: tick failed for agent %s", agent["id"])
            try:
                await asyncio.to_thread(_set_error, agent["id"], f"{type(exc).__name__}: {str(exc)[:500]}")
            except Exception:  # noqa: BLE001
                pass
        finally:
            try:
                await asyncio.to_thread(_release_tick, agent["id"])
            except Exception:  # noqa: BLE001 - the lease runs out by itself
                logger.warning("lead agent: could not release the tick of %s", agent["id"], exc_info=True)
        if only_agent:
            break
    return out


async def _tick_loop() -> None:
    logger.info("lead agent scheduler started")
    while True:
        try:
            if not active():
                await asyncio.sleep(DISABLED_SLEEP_S)
                continue
            await tick_once()
            await asyncio.sleep(TICK_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("lead agent scheduler: tick failed")
            await asyncio.sleep(TICK_S)


def run_now(agent_id: str) -> None:
    """A tick for one agent now, on this replica (run-now endpoint)."""
    try:
        asyncio.get_running_loop().create_task(tick_once(only_agent=agent_id), name=f"lead-agent-run-{agent_id}")
    except RuntimeError:
        pass


# ----------------------------------------------------------------------
# research pool
# ----------------------------------------------------------------------
def _claim(n: int, ids: Optional[List[str]]) -> list:
    with ladb.session() as db:
        return store.claim_ready(db, n, ids)


async def _research_one(cid: str) -> None:
    try:
        status = await research.research_candidate(cid)
        logger.info("lead agent: researched %s -> %s", cid, status)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("lead agent: research failed for %s", cid)
        try:
            await asyncio.to_thread(_release, cid, f"{type(exc).__name__}: {str(exc)[:500]}")
        except Exception:  # noqa: BLE001 - the lease runs out and it is re-armed
            pass
    finally:
        _running_research.discard(cid)


def _release(cid: str, error: str) -> None:
    with ladb.session() as db:
        store.release_candidate(db, cid, error, 900)


async def drain_research_once() -> int:
    """Claim as many READY candidates as there are free research slots; start them."""
    free = flags.max_concurrency() - len(_running_research)
    if free <= 0:
        return 0
    claimed = await asyncio.to_thread(_claim, free, _institutes())
    for row in claimed:
        _running_research.add(row["id"])
        asyncio.get_running_loop().create_task(_research_one(row["id"]), name=f"lead-research-{row['id']}")
    return len(claimed)


async def _research_loop() -> None:
    while True:
        try:
            if not active():
                await asyncio.sleep(DISABLED_SLEEP_S)
                continue
            n = await drain_research_once()
            await asyncio.sleep(2 if n else RESEARCH_IDLE_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("lead agent research loop failed")
            await asyncio.sleep(RESEARCH_IDLE_S)


async def _fetch_loop() -> None:
    while True:
        try:
            if not active():
                await asyncio.sleep(DISABLED_SLEEP_S)
                continue
            n = await fetcher.run_server_batch(FETCH_BATCH, _institutes())
            await asyncio.sleep(FETCH_BUSY_S if n else FETCH_IDLE_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("lead agent fetch loop failed")
            await asyncio.sleep(FETCH_IDLE_S)


# ----------------------------------------------------------------------
# lifecycle
# ----------------------------------------------------------------------
def start_lead_agent_workers() -> None:
    """Start the loops (idempotent). Call from the app lifespan."""
    global _TASKS
    if _TASKS and all(not t.done() for t in _TASKS):
        return
    loop = asyncio.get_running_loop()
    _TASKS = [
        loop.create_task(_tick_loop(), name="lead-agent-scheduler"),
        loop.create_task(_research_loop(), name="lead-agent-research"),
        loop.create_task(_fetch_loop(), name="lead-agent-fetcher"),
    ]


async def stop_lead_agent_workers() -> None:
    """Cancel the loops (lifespan shutdown); safe when they never started."""
    global _TASKS
    tasks, _TASKS = _TASKS, []
    for t in tasks:
        t.cancel()
    for t in tasks:
        try:
            await t
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


__all__ = ["start_lead_agent_workers", "stop_lead_agent_workers", "tick_once", "tick_agent", "run_now",
           "drain_research_once", "pool_need", "rejudge_waiting", "needs_approval"]
