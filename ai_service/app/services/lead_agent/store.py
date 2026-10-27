"""All Lead Agent SQL (tables owned by admin_core V612; spec §2).

House rules (see course_knowledge/queue.py):
  * decide from RETURNING, never rowcount (psycopg 3 reports -1 for
    INSERT .. ON CONFLICT);
  * CAST(:x AS type), never ``:x::type`` after a bind;
  * every function takes the caller's Session and never commits; async
    callers wrap a short `db.session()` block in asyncio.to_thread;
  * queue claims use FOR UPDATE SKIP LOCKED with a lease and an attempts cap;
  * JSON goes in as json.dumps(...) strings cast to jsonb.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy import text
from sqlalchemy.orm import Session

# --------------------------------------------------------------------------
# limits shared by the queue code
# --------------------------------------------------------------------------
RESEARCH_LEASE_MINUTES = 15      # RESEARCHING with claimed_at older than this = the worker died
RESEARCH_MAX_ATTEMPTS = 3        # claims before a candidate becomes FAILED
TASK_MAX_ATTEMPTS = 3            # fetch attempts before a task becomes FAILED
AUTO_REMOTE_AFTER_S = 300        # an AUTO task unclaimed for 5 min may be fetched by the server
FETCH_DEADLINE_MINUTES = 10      # all page tasks of a candidate should be done by then
PAGE_REUSE_DAYS = 14             # pages fetched within this many days are reused, not re-read
SEARCH_CACHE_DAYS = 7
WORKER_DAILY_PAGES = 300
ONLINE_SECONDS = 90

AGENT_STATUSES = ("ACTIVE", "PAUSED", "ARCHIVED")
# The V612 column defaults (bound as parameters: a ':' inside SQL text would read as a bind).
DEFAULT_GATE_JSON = {"auto_score": 70, "review_score": 45, "min_contact": "likely", "require_intent": False,
                     "auto_competitor_users": False}
DEFAULT_WINDOW_JSON = {"tz": "Asia/Kolkata", "start": "09:30", "end": "19:00", "days": [1, 2, 3, 4, 5, 6]}
MODES = ("LOCAL", "REMOTE", "AUTO")
OPEN_STATUSES = ("DISCOVERED", "FETCHING", "READY", "RESEARCHING", "APPROVED")


def _j(value: Any) -> str:
    return json.dumps(value if value is not None else None, default=str)


def _row(r: Any) -> Optional[Dict[str, Any]]:
    return dict(r) if r is not None else None


def _rows(res: Any) -> List[Dict[str, Any]]:
    return [dict(r) for r in res]


# ==========================================================================
# lead_agent
# ==========================================================================
AGENT_COLS = (
    "id, institute_id, audience_id, name, status, brief_json, markets_json, daily_quota, "
    "monthly_credit_cap, mode, gate_json, window_json, plan_json, plan_built_at, brief_hash, "
    "cursor_json, last_tick_at, tick_owner, tick_until, last_error, created_by, created_at, updated_at"
)
_AGENT_JSON = ("brief_json", "markets_json", "gate_json", "window_json", "plan_json", "cursor_json")
_AGENT_UPDATABLE = {
    "name", "status", "brief_json", "markets_json", "daily_quota", "monthly_credit_cap", "mode",
    "gate_json", "window_json", "audience_id",
}


def insert_agent(db: Session, *, institute_id: str, audience_id: str, name: str, brief: dict,
                 markets: list, daily_quota: int, monthly_credit_cap: Optional[Decimal], mode: str,
                 gate: Optional[dict], window: Optional[dict], created_by: Optional[str]) -> Dict[str, Any]:
    row = db.execute(text(f"""
        INSERT INTO lead_agent (institute_id, audience_id, name, status, brief_json, markets_json, daily_quota,
                                monthly_credit_cap, mode, gate_json, window_json, created_by)
        VALUES (:institute_id, :audience_id, :name, 'PAUSED', CAST(:brief AS jsonb), CAST(:markets AS jsonb),
                :quota, :cap, :mode,
                CAST(:gate AS jsonb), CAST(:window AS jsonb),
                :created_by)
        RETURNING {AGENT_COLS}
    """), {
        "institute_id": institute_id, "audience_id": audience_id, "name": name, "brief": _j(brief),
        "markets": _j(markets), "quota": int(daily_quota), "cap": monthly_credit_cap, "mode": mode,
        "gate": _j(gate if gate is not None else DEFAULT_GATE_JSON),
        "window": _j(window if window is not None else DEFAULT_WINDOW_JSON),
        "created_by": created_by,
    }).mappings().first()
    return dict(row)


def get_agent(db: Session, agent_id: str, institute_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    sql = f"SELECT {AGENT_COLS} FROM lead_agent WHERE id = :id"
    params: Dict[str, Any] = {"id": agent_id}
    if institute_id is not None:
        sql += " AND institute_id = :inst"
        params["inst"] = institute_id
    return _row(db.execute(text(sql), params).mappings().first())


def list_agents(db: Session, institute_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:
    sql = f"SELECT {AGENT_COLS} FROM lead_agent WHERE institute_id = :inst"
    if not include_archived:
        sql += " AND status <> 'ARCHIVED'"
    return _rows(db.execute(text(sql + " ORDER BY created_at DESC"), {"inst": institute_id}).mappings())


def update_agent(db: Session, agent_id: str, institute_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sets, params = [], {"id": agent_id, "inst": institute_id}
    for col, value in fields.items():
        if col not in _AGENT_UPDATABLE:
            raise ValueError(f"not an updatable column: {col}")
        if col in _AGENT_JSON:
            sets.append(f"{col} = CAST(:{col} AS jsonb)")
            params[col] = _j(value)
        else:
            sets.append(f"{col} = :{col}")
            params[col] = value
    if not sets:
        return get_agent(db, agent_id, institute_id)
    row = db.execute(text(
        f"UPDATE lead_agent SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = :id AND institute_id = :inst RETURNING {AGENT_COLS}"
    ), params).mappings().first()
    return _row(row)


def audience_name(db: Session, audience_id: str, institute_id: str) -> Optional[str]:
    """campaign_name of an audience (lead list) of this institute; None if it is not theirs."""
    row = db.execute(text(
        "SELECT campaign_name FROM audience WHERE id = :id AND institute_id = :inst"
    ), {"id": audience_id, "inst": institute_id}).first()
    return None if row is None else (row[0] or "")


def audience_names(db: Session, audience_ids: Iterable[str]) -> Dict[str, str]:
    ids = sorted({a for a in audience_ids if a})
    if not ids:
        return {}
    rows = db.execute(text(
        "SELECT id, campaign_name FROM audience WHERE id = ANY(CAST(:ids AS VARCHAR[]))"
    ), {"ids": ids}).fetchall()
    return {r[0]: r[1] or "" for r in rows}


def institute_name(db: Session, institute_id: str) -> Optional[str]:
    row = db.execute(text("SELECT name FROM institutes WHERE id = :id"), {"id": institute_id}).first()
    return row[0] if row else None


TICK_LEASE_S = 20 * 60   # an agent tick (plan + discovery + delivery) is renewed well inside this


def claim_next_agent(db: Session, *, institutes: Optional[Sequence[str]], owner: str, min_interval_s: int,
                     lease_s: int = TICK_LEASE_S, only_agent: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Lease ONE due ACTIVE agent to `owner` (tick_owner / tick_until, SKIP LOCKED):
    its last tick is older than min_interval_s and nobody holds a live lease on it.
    institutes None = every institute. None when nothing is due. While the lease
    lives no other worker (or a run-now) ticks the agent, however long the tick
    takes; release_tick clears it."""
    params: Dict[str, Any] = {"gap": int(min_interval_s), "owner": owner[:64], "lease": int(lease_s)}
    where = ["status = 'ACTIVE'", "(tick_until IS NULL OR tick_until < now())",
             "(last_tick_at IS NULL OR last_tick_at < now() - (CAST(:gap AS integer) * interval '1 second'))"]
    if institutes is not None:
        where.append("institute_id = ANY(CAST(:ids AS VARCHAR[]))")
        params["ids"] = list(institutes)
    if only_agent:
        where.append("id = :only")
        params["only"] = only_agent
    row = db.execute(text(f"""
        WITH due AS (
            SELECT id FROM lead_agent WHERE {' AND '.join(where)}
             ORDER BY last_tick_at NULLS FIRST
             LIMIT 1
             FOR UPDATE SKIP LOCKED
        )
        UPDATE lead_agent a SET last_tick_at = now(), tick_owner = CAST(:owner AS VARCHAR),
               tick_until = now() + (CAST(:lease AS integer) * interval '1 second')
          FROM due WHERE a.id = due.id
        RETURNING {', '.join('a.' + c.strip() for c in AGENT_COLS.split(','))}
    """), params).mappings().first()
    return _row(row)


def renew_tick(db: Session, agent_id: str, owner: str, lease_s: int = TICK_LEASE_S) -> bool:
    """Extend this owner's lease; False when the lease was lost (stop the tick)."""
    row = db.execute(text("""
        UPDATE lead_agent SET tick_until = now() + (CAST(:lease AS integer) * interval '1 second')
         WHERE id = :id AND tick_owner = :owner AND tick_until > now() RETURNING id
    """), {"id": agent_id, "owner": owner[:64], "lease": int(lease_s)}).first()
    return row is not None


def release_tick(db: Session, agent_id: str, owner: str) -> None:
    db.execute(text("""
        UPDATE lead_agent SET tick_owner = NULL, tick_until = NULL, last_tick_at = now()
         WHERE id = :id AND tick_owner = :owner
    """), {"id": agent_id, "owner": owner[:64]})


def force_tick(db: Session, agent_id: str, institute_id: str) -> bool:
    row = db.execute(text(
        "UPDATE lead_agent SET last_tick_at = NULL WHERE id = :id AND institute_id = :inst RETURNING id"
    ), {"id": agent_id, "inst": institute_id}).first()
    return row is not None


def set_plan(db: Session, agent_id: str, plan: dict, brief_hash: str) -> None:
    db.execute(text(
        "UPDATE lead_agent SET plan_json = CAST(:p AS jsonb), plan_built_at = now(), brief_hash = :h, "
        "updated_at = now() WHERE id = :id"
    ), {"p": _j(plan), "h": brief_hash, "id": agent_id})


def set_cursor(db: Session, agent_id: str, cursor: dict) -> None:
    db.execute(text("UPDATE lead_agent SET cursor_json = CAST(:c AS jsonb) WHERE id = :id"),
               {"c": _j(cursor), "id": agent_id})


def set_agent_error(db: Session, agent_id: str, error: Optional[str]) -> None:
    db.execute(text("UPDATE lead_agent SET last_error = :e WHERE id = :id"),
               {"e": (error or None) and str(error)[:2000], "id": agent_id})


# ==========================================================================
# lead_agent_day
# ==========================================================================
DAY_COUNTERS = ("discovered", "researched", "delivered", "review", "rejected", "searches", "pages",
                "cost_usd", "credits")


def bump_day(db: Session, agent_id: str, day: date, **deltas: Any) -> None:
    cols = [c for c in DAY_COUNTERS if deltas.get(c)]
    if not cols:
        return
    params: Dict[str, Any] = {"a": agent_id, "d": day}
    for c in cols:
        params[c] = deltas[c]
    db.execute(text(f"""
        INSERT INTO lead_agent_day (agent_id, day, {', '.join(cols)})
        VALUES (:a, :d, {', '.join(':' + c for c in cols)})
        ON CONFLICT (agent_id, day) DO UPDATE SET
            {', '.join(f'{c} = lead_agent_day.{c} + EXCLUDED.{c}' for c in cols)}
    """), params)


def get_day(db: Session, agent_id: str, day: date) -> Dict[str, Any]:
    row = db.execute(text(f"SELECT {', '.join(DAY_COUNTERS)} FROM lead_agent_day WHERE agent_id = :a AND day = :d"),
                     {"a": agent_id, "d": day}).mappings().first()
    if row is None:
        return {c: 0 for c in DAY_COUNTERS}
    return dict(row)


def day_stats(db: Session, agent_id: str, since: date) -> List[Dict[str, Any]]:
    return _rows(db.execute(text(f"""
        SELECT day, {', '.join(DAY_COUNTERS)} FROM lead_agent_day
         WHERE agent_id = :a AND day >= :d ORDER BY day
    """), {"a": agent_id, "d": since}).mappings())


def month_credits(db: Session, agent_id: str, since: datetime) -> Decimal:
    v = db.execute(text(
        "SELECT COALESCE(SUM(credits_charged), 0) FROM lead_candidate "
        "WHERE agent_id = :a AND status = 'DELIVERED' AND delivered_at >= :s"
    ), {"a": agent_id, "s": since}).scalar()
    return Decimal(str(v or 0))


def reserve_deliveries(db: Session, agent_id: str, day: date, n: int, quota: int) -> int:
    """Take up to n of today's delivery slots atomically (lead_agent_day.delivered
    counts delivered AND in-flight leads, never above the quota). Returns how many
    were granted; give unused ones back with release_deliveries."""
    if n <= 0:
        return 0
    db.execute(text("INSERT INTO lead_agent_day (agent_id, day) VALUES (:a, :d) ON CONFLICT (agent_id, day) DO NOTHING"),
               {"a": agent_id, "d": day})
    row = db.execute(text("""
        WITH old AS (
            SELECT delivered FROM lead_agent_day WHERE agent_id = :a AND day = :d FOR UPDATE
        )
        UPDATE lead_agent_day t SET delivered = LEAST(CAST(:q AS integer), old.delivered + CAST(:n AS integer))
          FROM old
         WHERE t.agent_id = :a AND t.day = :d AND old.delivered < CAST(:q AS integer)
        RETURNING t.delivered - old.delivered
    """), {"a": agent_id, "d": day, "n": int(n), "q": int(quota)}).first()
    return int(row[0]) if row else 0


def release_deliveries(db: Session, agent_id: str, day: date, n: int) -> None:
    if n <= 0:
        return
    db.execute(text("""
        UPDATE lead_agent_day SET delivered = GREATEST(0, delivered - CAST(:n AS integer))
         WHERE agent_id = :a AND day = :d
    """), {"a": agent_id, "d": day, "n": int(n)})


# ==========================================================================
# lead_org / lead_org_page
# ==========================================================================
ORG_COLS = ("id, domain, name, website, country, state, city, platforms_json, size_json, social_json, "
            "robots_json, pages_fetched_at, created_at, updated_at")


def upsert_org(db: Session, *, domain: str, name: Optional[str], website: Optional[str],
               country: Optional[str] = None, state: Optional[str] = None, city: Optional[str] = None) -> str:
    """The lead_org id for a registered domain (created on first sight; known
    facts are kept, missing ones filled in)."""
    row = db.execute(text("""
        INSERT INTO lead_org (domain, name, website, country, state, city)
        VALUES (:domain, :name, :website, :country, :state, :city)
        ON CONFLICT (domain) DO UPDATE SET
            name = COALESCE(lead_org.name, EXCLUDED.name),
            website = COALESCE(lead_org.website, EXCLUDED.website),
            country = COALESCE(lead_org.country, EXCLUDED.country),
            state = COALESCE(lead_org.state, EXCLUDED.state),
            city = COALESCE(lead_org.city, EXCLUDED.city),
            updated_at = now()
        RETURNING id
    """), {"domain": domain.lower()[:255], "name": (name or None) and name[:300],
           "website": (website or None) and website[:1000], "country": (country or None) and country[:80],
           "state": (state or None) and state[:120], "city": (city or None) and city[:120]}).first()
    return row[0]


def get_org(db: Session, org_id: str) -> Optional[Dict[str, Any]]:
    return _row(db.execute(text(f"SELECT {ORG_COLS} FROM lead_org WHERE id = :id"), {"id": org_id}).mappings().first())


def update_org_facts(db: Session, org_id: str, *, platforms: Optional[list] = None, size: Optional[dict] = None,
                     social: Optional[dict] = None, name: Optional[str] = None, city: Optional[str] = None) -> None:
    db.execute(text("""
        UPDATE lead_org SET
            platforms_json = COALESCE(CAST(:p AS jsonb), platforms_json),
            size_json = COALESCE(CAST(:s AS jsonb), size_json),
            social_json = COALESCE(CAST(:so AS jsonb), social_json),
            name = COALESCE(:name, name),
            city = COALESCE(city, :city),
            updated_at = now()
        WHERE id = :id
    """), {"id": org_id, "p": _j(platforms) if platforms is not None else None,
           "s": _j(size) if size is not None else None, "so": _j(social) if social is not None else None,
           "name": (name or None) and name[:300], "city": (city or None) and city[:120]})


def set_org_robots(db: Session, org_id: str, robots: dict) -> None:
    db.execute(text("UPDATE lead_org SET robots_json = CAST(:r AS jsonb), updated_at = now() WHERE id = :id"),
               {"r": _j(robots), "id": org_id})


def touch_pages_fetched(db: Session, org_id: str) -> None:
    db.execute(text("UPDATE lead_org SET pages_fetched_at = now(), updated_at = now() WHERE id = :id"),
               {"id": org_id})


PAGE_COLS = ("id, org_id, url, page_type, access, status_code, final_url, text, links_json, has_form, "
             "platform_hints_json, fetched_by, fetched_institute_id, fetched_at, expires_at")


def page_scope(fetched_by: str, institute_id: Optional[str]) -> str:
    """'' for a page our server read (public: shared by every institute); the
    institute id for one its Chrome extension read (that browser may be signed
    in, and its HTML is whatever the token holder sent): never shown to others."""
    if fetched_by == "SERVER":
        return ""
    if not institute_id:
        raise ValueError("an extension page needs the institute it was read for")
    return str(institute_id)


def upsert_page(db: Session, *, org_id: str, url: str, page_type: str, record: Dict[str, Any],
                fetched_by: str, institute_id: Optional[str]) -> Dict[str, Any]:
    """Store one page record (from engine.pagefetch.parse_page) for 30 days, in
    the scope page_scope() gives it."""
    links = [list(l)[:2] if isinstance(l, (list, tuple)) else l for l in (record.get("links") or [])][:400]
    row = db.execute(text(f"""
        INSERT INTO lead_org_page (org_id, url, page_type, access, status_code, final_url, text, links_json,
                                   has_form, platform_hints_json, fetched_by, fetched_institute_id, fetched_at,
                                   expires_at)
        VALUES (:org, :url, :pt, :access, :sc, :final, :text, CAST(:links AS jsonb), :form, CAST(:hints AS jsonb),
                :by, :scope, now(), now() + interval '30 days')
        ON CONFLICT (org_id, url, fetched_institute_id) DO UPDATE SET
            page_type = EXCLUDED.page_type, access = EXCLUDED.access, status_code = EXCLUDED.status_code,
            final_url = EXCLUDED.final_url, text = EXCLUDED.text, links_json = EXCLUDED.links_json,
            has_form = EXCLUDED.has_form, platform_hints_json = EXCLUDED.platform_hints_json,
            fetched_by = EXCLUDED.fetched_by, fetched_at = now(), expires_at = now() + interval '30 days'
        RETURNING {PAGE_COLS}
    """), {
        "org": org_id, "url": url[:1000], "pt": (page_type or "other")[:30], "access": record.get("access") or "error",
        "sc": record.get("status_code"), "final": (record.get("final_url") or None) and str(record["final_url"])[:1000],
        "text": record.get("text"), "links": _j(links), "form": bool(record.get("has_form")),
        "hints": _j(record.get("platform_hints") or []), "by": fetched_by,
        "scope": page_scope(fetched_by, institute_id),
    }).mappings().first()
    return dict(row)


def org_pages(db: Session, org_id: str, *, institute_id: str, max_age_days: Optional[int] = None,
              ok_only: bool = False) -> List[Dict[str, Any]]:
    """The organisation's live pages this institute may use: every server-read
    page, plus the pages ITS extension read. One row per URL (a readable copy
    first, then the institute's own rendered copy, then the newest), oldest first."""
    where = ["org_id = :org", "expires_at > now()", "fetched_institute_id IN ('', CAST(:inst AS VARCHAR))"]
    params: Dict[str, Any] = {"org": org_id, "inst": institute_id}
    if max_age_days is not None:
        where.append("fetched_at > now() - (CAST(:days AS integer) * interval '1 day')")
        params["days"] = int(max_age_days)
    if ok_only:
        where.append("access = 'ok'")
    sql = f"""
        SELECT * FROM (
            SELECT DISTINCT ON (url) {PAGE_COLS} FROM lead_org_page
             WHERE {' AND '.join(where)}
             ORDER BY url, (access = 'ok') DESC, (fetched_institute_id <> '') DESC, fetched_at DESC
        ) p ORDER BY fetched_at"""
    return _rows(db.execute(text(sql), params).mappings())


def delete_expired_pages(db: Session) -> int:
    return len(db.execute(text("DELETE FROM lead_org_page WHERE expires_at < now() RETURNING id")).fetchall())


# ==========================================================================
# lead_candidate
# ==========================================================================
CAND_COLS = (
    "c.id, c.agent_id, c.institute_id, c.org_id, c.source, c.discovery_json, c.status, c.decision, c.score, "
    "c.score_json, c.lead_json, c.stage, c.reject_reason, c.reviewed_by, c.reviewed_at, c.delivered_response_id, "
    "c.delivered_at, c.delivery_note, c.credits_charged, c.charged_at, c.intake_attempted_at, c.delivery_attempts, "
    "c.cost_usd, c.attempts, c.last_error, c.fetch_deadline, "
    "c.claimed_at, c.not_before, c.created_at, c.updated_at"
)
_ORG_JOIN = ("o.domain AS org_domain, o.name AS org_name, o.website AS org_website, o.city AS org_city, "
             "o.country AS org_country")


def insert_candidate(db: Session, *, agent_id: str, institute_id: str, org_id: str, source: str,
                     discovery: dict) -> Optional[str]:
    """New candidate id, or None when this agent already has the organisation."""
    row = db.execute(text("""
        INSERT INTO lead_candidate (agent_id, institute_id, org_id, source, discovery_json)
        VALUES (:a, :i, :o, :s, CAST(:d AS jsonb))
        ON CONFLICT (agent_id, org_id) DO NOTHING
        RETURNING id
    """), {"a": agent_id, "i": institute_id, "o": org_id, "s": source[:40], "d": _j(discovery)}).first()
    return row[0] if row else None


def review_counts(db: Session, agent_ids: Sequence[str]) -> Dict[str, int]:
    ids = list(agent_ids)
    if not ids:
        return {}
    rows = db.execute(text(
        "SELECT agent_id, COUNT(*) FROM lead_candidate WHERE status = 'REVIEW' "
        "AND agent_id = ANY(CAST(:ids AS VARCHAR[])) GROUP BY agent_id"), {"ids": ids}).fetchall()
    return {r[0]: int(r[1]) for r in rows}


def known_domains(db: Session, agent_id: str) -> Set[str]:
    rows = db.execute(text(
        "SELECT o.domain FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id WHERE c.agent_id = :a"
    ), {"a": agent_id}).fetchall()
    return {r[0] for r in rows}


def known_names(db: Session, agent_id: str) -> List[str]:
    """Names of the organisations already on the agent (any status), for name-level dedupe."""
    rows = db.execute(text(
        "SELECT DISTINCT o.name FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id "
        "WHERE c.agent_id = :a AND o.name IS NOT NULL"
    ), {"a": agent_id}).fetchall()
    return [r[0] for r in rows]


def backlog(db: Session, agent_id: str) -> int:
    return int(db.execute(text(
        "SELECT COUNT(*) FROM lead_candidate WHERE agent_id = :a AND status = ANY(CAST(:s AS VARCHAR[]))"
    ), {"a": agent_id, "s": list(OPEN_STATUSES)}).scalar() or 0)


def review_waiting(db: Session, agent_id: str) -> int:
    """Researched leads waiting for a person to pass or reject them."""
    return int(db.execute(text(
        "SELECT COUNT(*) FROM lead_candidate WHERE agent_id = :a AND status = 'REVIEW'"
    ), {"a": agent_id}).scalar() or 0)


def get_candidate(db: Session, candidate_id: str, institute_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    sql = f"SELECT {CAND_COLS}, {_ORG_JOIN} FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id WHERE c.id = :id"
    params: Dict[str, Any] = {"id": candidate_id}
    if institute_id is not None:
        sql += " AND c.institute_id = :inst"
        params["inst"] = institute_id
    return _row(db.execute(text(sql), params).mappings().first())


def list_candidates(db: Session, agent_id: str, *, status: Optional[str], page: int,
                    size: int) -> tuple[List[Dict[str, Any]], int]:
    where, params = "c.agent_id = :a", {"a": agent_id, "lim": size, "off": page * size}
    if status:
        where += " AND c.status = ANY(CAST(:st AS VARCHAR[]))"
        params["st"] = [s.strip().upper() for s in status.split(",") if s.strip()]
    total = int(db.execute(text(f"SELECT COUNT(*) FROM lead_candidate c WHERE {where}"), params).scalar() or 0)
    rows = _rows(db.execute(text(f"""
        SELECT {CAND_COLS}, {_ORG_JOIN} FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id
         WHERE {where}
         ORDER BY c.score DESC NULLS LAST, c.created_at DESC
         LIMIT :lim OFFSET :off
    """), params).mappings())
    return rows, total


def discovered_candidates(db: Session, agent_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    return _rows(db.execute(text(f"""
        SELECT {CAND_COLS}, {_ORG_JOIN} FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id
         WHERE c.agent_id = :a AND c.status = 'DISCOVERED' ORDER BY c.created_at LIMIT :n
    """), {"a": agent_id, "n": limit}).mappings())


def set_candidate(db: Session, candidate_id: str, *, expect: Optional[Sequence[str]] = None,
                  **fields: Any) -> Optional[Dict[str, Any]]:
    """Update a candidate (JSON fields as python objects); with `expect`, only
    when its current status is one of them. Returns the new row or None."""
    json_cols = {"discovery_json", "score_json", "lead_json"}
    allowed = {"status", "decision", "score", "score_json", "lead_json", "stage", "reject_reason", "reviewed_by",
               "reviewed_at", "delivered_response_id", "delivered_at", "delivery_note", "credits_charged",
               "last_error", "fetch_deadline", "claimed_at", "not_before", "attempts", "discovery_json",
               "charged_at", "intake_attempted_at", "delivery_attempts"}
    sets, params = [], {"id": candidate_id}
    for col, value in fields.items():
        if col not in allowed:
            raise ValueError(f"not an updatable candidate column: {col}")
        if col in json_cols:
            sets.append(f"{col} = CAST(:{col} AS jsonb)")
            params[col] = _j(value)
        elif value == "now()":
            sets.append(f"{col} = now()")
        else:
            sets.append(f"{col} = :{col}")
            params[col] = value
    sql = f"UPDATE lead_candidate c SET {', '.join(sets)}, updated_at = now() WHERE c.id = :id"
    if expect:
        sql += " AND c.status = ANY(CAST(:expect AS VARCHAR[]))"
        params["expect"] = list(expect)
    row = db.execute(text(sql + f" RETURNING {CAND_COLS}"), params).mappings().first()
    return _row(row)


def set_credits(db: Session, candidate_id: str, credits: Decimal) -> bool:
    """Settle the delivery charge once: credits_charged + charged_at (True the
    first time). charged_at, not a non-zero amount, marks it settled, so a free
    or plan-covered lead is never charged again."""
    row = db.execute(text(
        "UPDATE lead_candidate SET credits_charged = :c, charged_at = now() "
        "WHERE id = :id AND charged_at IS NULL RETURNING id"
    ), {"c": credits, "id": candidate_id}).first()
    return row is not None


def uncharged_delivered(db: Session, agent_id: str, limit: int = 50) -> List[str]:
    return [r[0] for r in db.execute(text(
        "SELECT id FROM lead_candidate WHERE agent_id = :a AND status = 'DELIVERED' AND charged_at IS NULL "
        "AND delivered_at > now() - interval '3 days' ORDER BY delivered_at LIMIT :n"
    ), {"a": agent_id, "n": limit}).fetchall()]


def renew_research(db: Session, candidate_id: str) -> bool:
    """Keep a RESEARCHING claim alive between slow steps (claimed_at is its lease)."""
    row = db.execute(text(
        "UPDATE lead_candidate SET claimed_at = now() WHERE id = :id AND status = 'RESEARCHING' RETURNING id"
    ), {"id": candidate_id}).first()
    return row is not None


def candidate_extension_pages(db: Session, candidate_id: str) -> int:
    """Pages of THIS candidate that the institute's extension read (its finished
    tasks owned by a worker id; the server's owner ids start with 'server:')."""
    return int(db.execute(text(
        "SELECT COUNT(*) FROM lead_fetch_task WHERE candidate_id = :c AND status = 'DONE' "
        "AND lease_owner IS NOT NULL AND lease_owner NOT LIKE 'server:%'"
    ), {"c": candidate_id}).scalar() or 0)


def add_cost(db: Session, candidate_id: str, usd: float) -> None:
    if not usd:
        return
    db.execute(text("UPDATE lead_candidate SET cost_usd = cost_usd + :u WHERE id = :id"),
               {"u": Decimal(str(round(float(usd), 6))), "id": candidate_id})


_REARM_CAND_SQL = text("""
    WITH stale AS (
        SELECT id FROM lead_candidate
         WHERE status = 'RESEARCHING'
           AND COALESCE(claimed_at, updated_at) < now() - (CAST(:lease AS integer) * interval '1 minute')
         FOR UPDATE SKIP LOCKED
    )
    UPDATE lead_candidate c
       SET status = CASE WHEN c.attempts >= :cap THEN 'FAILED' ELSE 'READY' END,
           last_error = CASE WHEN c.attempts >= :cap THEN 'Research stopped too many times' ELSE c.last_error END,
           claimed_at = NULL, not_before = now(), updated_at = now()
      FROM stale WHERE c.id = stale.id
    RETURNING c.id, c.status
""")

_CLAIM_READY_SQL = text("""
    WITH c AS (
        SELECT lc.id FROM lead_candidate lc JOIN lead_agent a ON a.id = lc.agent_id
         WHERE lc.status = 'READY' AND lc.not_before <= now() AND a.status = 'ACTIVE'
           AND (CAST(:ids AS VARCHAR[]) IS NULL OR lc.institute_id = ANY(CAST(:ids AS VARCHAR[])))
         ORDER BY lc.not_before
         LIMIT :n
         FOR UPDATE OF lc SKIP LOCKED
    )
    UPDATE lead_candidate lc
       SET status = 'RESEARCHING', attempts = lc.attempts + 1, claimed_at = now(), updated_at = now()
      FROM c WHERE lc.id = c.id
    RETURNING lc.id, lc.attempts
""")


def rearm_stale_candidates(db: Session) -> List[Dict[str, Any]]:
    return [{"id": r[0], "status": r[1]} for r in db.execute(
        _REARM_CAND_SQL, {"lease": RESEARCH_LEASE_MINUTES, "cap": RESEARCH_MAX_ATTEMPTS}).fetchall()]


def claim_ready(db: Session, n: int, institutes: Optional[Sequence[str]] = None) -> List[Dict[str, Any]]:
    """Claim up to n READY candidates of ACTIVE agents (SKIP LOCKED; attempts+1).
    institutes None = any institute."""
    rows = db.execute(_CLAIM_READY_SQL, {"n": max(1, int(n)),
                                         "ids": list(institutes) if institutes is not None else None}).fetchall()
    return [{"id": r[0], "attempts": int(r[1])} for r in rows]


def release_candidate(db: Session, candidate_id: str, error: str, delay_s: int) -> Optional[str]:
    """A research attempt failed for a passing reason: back to READY after
    delay_s, or FAILED once the attempts cap is used up. Returns the status."""
    row = db.execute(text("""
        UPDATE lead_candidate SET
            status = CASE WHEN attempts >= :cap THEN 'FAILED' ELSE 'READY' END,
            last_error = :e, claimed_at = NULL,
            not_before = now() + (CAST(:d AS integer) * interval '1 second'), updated_at = now()
        WHERE id = :id AND status = 'RESEARCHING'
        RETURNING status
    """), {"cap": RESEARCH_MAX_ATTEMPTS, "e": error[:2000], "d": int(delay_s), "id": candidate_id}).first()
    return row[0] if row else None


def claim_approved(db: Session, agent_id: str, n: int, hold_minutes: int = 10) -> List[Dict[str, Any]]:
    """Up to n APPROVED candidates, best score first, held for hold_minutes
    (not_before pushed forward) so no other replica delivers them meanwhile."""
    rows = db.execute(text(f"""
        WITH pick AS (
            SELECT id FROM lead_candidate
             WHERE agent_id = :a AND status = 'APPROVED' AND not_before <= now()
             ORDER BY score DESC NULLS LAST, created_at
             LIMIT :n
             FOR UPDATE SKIP LOCKED
        )
        UPDATE lead_candidate c SET not_before = now() + (CAST(:h AS integer) * interval '1 minute'),
                                    updated_at = now()
          FROM pick WHERE c.id = pick.id
        RETURNING {CAND_COLS}
    """), {"a": agent_id, "n": max(1, int(n)), "h": int(hold_minutes)}).mappings()
    out = _rows(rows)
    out.sort(key=lambda r: (-(r["score"] or 0), r["created_at"]))
    return out


def decide(db: Session, *, ids: Sequence[str], institute_id: str, action: str, reason: Optional[str],
           user_id: Optional[str]) -> List[Dict[str, Any]]:
    """A reviewer's decision. APPROVE: REVIEW/REJECTED -> APPROVED. REJECT:
    REVIEW/APPROVED -> REJECTED, except an APPROVED lead a delivery holds or has
    sent. Others are left alone. Returns the changed rows."""
    if action == "APPROVE":
        frm, to = ["REVIEW", "REJECTED"], "APPROVED"
    else:
        frm, to = ["REVIEW", "APPROVED"], "REJECTED"
    rows = db.execute(text(f"""
        UPDATE lead_candidate c SET status = CAST(:to AS VARCHAR), reviewed_by = :u, reviewed_at = now(),
               reject_reason = CASE WHEN CAST(:to AS VARCHAR) = 'REJECTED' THEN COALESCE(CAST(:r AS VARCHAR), 'Rejected by reviewer') ELSE c.reject_reason END,
               not_before = now(), updated_at = now()
         WHERE c.id = ANY(CAST(:ids AS VARCHAR[])) AND c.institute_id = :inst
           AND c.status = ANY(CAST(:frm AS VARCHAR[]))
           -- never under a delivery in flight: an APPROVED row held by delivery, or one already sent
           AND NOT (c.status = 'APPROVED' AND (c.not_before > now() OR c.intake_attempted_at IS NOT NULL))
        RETURNING {CAND_COLS}
    """), {"to": to, "u": user_id, "r": (reason or None) and reason[:300], "ids": list(ids), "inst": institute_id,
           "frm": frm}).mappings()
    return _rows(rows)


# ==========================================================================
# lead_fetch_task
# ==========================================================================
TASK_COLS = ("t.id, t.institute_id, t.agent_id, t.candidate_id, t.org_id, t.url, t.page_type, t.mode, t.status, "
             "t.lease_owner, t.lease_until, t.attempts, t.last_error, t.not_before, t.created_at, t.updated_at")


def enqueue_task(db: Session, *, institute_id: str, agent_id: str, candidate_id: str, org_id: str, url: str,
                 page_type: str, mode: str) -> Optional[str]:
    """A PENDING fetch task, unless this candidate already has one for the URL."""
    row = db.execute(text("""
        INSERT INTO lead_fetch_task (institute_id, agent_id, candidate_id, org_id, url, page_type, mode)
        SELECT CAST(:i AS VARCHAR), CAST(:a AS VARCHAR), CAST(:c AS VARCHAR), CAST(:o AS VARCHAR),
               CAST(:u AS VARCHAR), CAST(:pt AS VARCHAR), CAST(:m AS VARCHAR)
         WHERE NOT EXISTS (SELECT 1 FROM lead_fetch_task
                            WHERE candidate_id = CAST(:c AS VARCHAR) AND url = CAST(:u AS VARCHAR))
        RETURNING id
    """), {"i": institute_id, "a": agent_id, "c": candidate_id, "o": org_id, "u": url[:1000],
           "pt": (page_type or "other")[:30], "m": mode}).first()
    return row[0] if row else None


def get_task(db: Session, task_id: str) -> Optional[Dict[str, Any]]:
    return _row(db.execute(text(f"SELECT {TASK_COLS} FROM lead_fetch_task t WHERE t.id = :id"),
                           {"id": task_id}).mappings().first())


def candidate_task_urls(db: Session, candidate_id: str) -> Set[str]:
    return {r[0] for r in db.execute(text("SELECT url FROM lead_fetch_task WHERE candidate_id = :c"),
                                     {"c": candidate_id}).fetchall()}


def _claim_tasks(db: Session, *, mode_sql: str, params: Dict[str, Any], n: int, owner: str,
                 lease_s: int) -> List[Dict[str, Any]]:
    """One task per organisation (host), skipping organisations that already
    have a task out, so no site gets two requests at once."""
    params = {**params, "n": max(1, int(n)), "owner": owner[:64], "lease": int(lease_s)}
    rows = db.execute(text(f"""
        WITH c AS (
            SELECT t.id, t.org_id, t.page_type, t.created_at
              FROM lead_fetch_task t JOIN lead_agent a ON a.id = t.agent_id
             WHERE t.status = 'PENDING' AND t.not_before <= now() AND a.status = 'ACTIVE' AND ({mode_sql})
               AND NOT EXISTS (SELECT 1 FROM lead_fetch_task x
                                WHERE x.org_id = t.org_id AND x.status = 'CLAIMED' AND x.lease_until > now())
             ORDER BY t.created_at
             LIMIT :n * 10
             FOR UPDATE OF t SKIP LOCKED
        ), one_per_org AS (
            SELECT DISTINCT ON (org_id) id, created_at FROM c ORDER BY org_id, (page_type <> 'home'), created_at
        ), pick AS (SELECT id FROM one_per_org ORDER BY created_at LIMIT :n)
        UPDATE lead_fetch_task t
           SET status = 'CLAIMED', lease_owner = :owner, attempts = t.attempts + 1,
               lease_until = now() + (CAST(:lease AS integer) * interval '1 second'), updated_at = now()
          FROM pick WHERE t.id = pick.id
        RETURNING {TASK_COLS}
    """), params).mappings()
    return _rows(rows)


def claim_server_tasks(db: Session, n: int, owner: str, lease_s: int = 120,
                       institutes: Optional[Sequence[str]] = None) -> List[Dict[str, Any]]:
    """REMOTE tasks, and AUTO tasks no extension took within 5 minutes."""
    mode_sql = ("(t.mode = 'REMOTE' OR (t.mode = 'AUTO' AND t.created_at < now() - "
                "(CAST(:auto_after AS integer) * interval '1 second')))")
    params: Dict[str, Any] = {"auto_after": AUTO_REMOTE_AFTER_S}
    if institutes is not None:
        mode_sql += " AND t.institute_id = ANY(CAST(:ids AS VARCHAR[]))"
        params["ids"] = list(institutes)
    return _claim_tasks(db, mode_sql=mode_sql, params=params, n=n, owner=owner, lease_s=lease_s)


def claim_extension_tasks(db: Session, *, institute_id: str, n: int, worker_id: str,
                          lease_s: int = 120) -> List[Dict[str, Any]]:
    """LOCAL and AUTO tasks of the worker's own institute."""
    return _claim_tasks(db, mode_sql="t.mode IN ('LOCAL', 'AUTO') AND t.institute_id = :inst",
                        params={"inst": institute_id}, n=n, owner=worker_id, lease_s=lease_s)


def finish_task(db: Session, task_id: str, status: str, error: Optional[str] = None,
                owner: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """CLAIMED -> DONE / FAILED (only the lease owner, when given)."""
    sql = (f"UPDATE lead_fetch_task t SET status = :s, last_error = :e, lease_until = NULL, updated_at = now() "
           f"WHERE t.id = :id AND t.status = 'CLAIMED'")
    params: Dict[str, Any] = {"s": status, "e": (error or None) and error[:2000], "id": task_id}
    if owner is not None:
        sql += " AND t.lease_owner = :o"
        params["o"] = owner
    return _row(db.execute(text(sql + f" RETURNING {TASK_COLS}"), params).mappings().first())


def retry_task(db: Session, task_id: str, error: str, delay_s: int, owner: Optional[str] = None) -> Optional[str]:
    """A failed attempt: PENDING again after delay_s, or FAILED at the cap."""
    sql = """
        UPDATE lead_fetch_task t SET
            status = CASE WHEN t.attempts >= :cap THEN 'FAILED' ELSE 'PENDING' END,
            last_error = :e, lease_owner = NULL, lease_until = NULL,
            not_before = now() + (CAST(:d AS integer) * interval '1 second'), updated_at = now()
        WHERE t.id = :id AND t.status = 'CLAIMED'"""
    params: Dict[str, Any] = {"cap": TASK_MAX_ATTEMPTS, "e": error[:2000], "d": int(delay_s), "id": task_id}
    if owner is not None:
        sql += " AND t.lease_owner = :o"
        params["o"] = owner
    row = db.execute(text(sql + " RETURNING t.status"), params).first()
    return row[0] if row else None


def hand_task_to_extension(db: Session, task_id: str, owner: str) -> bool:
    """A page the server got as an empty JavaScript shell: give it to the institute's extension,
    which renders it in a tab (claim sends render "tab" for a thin_page error). Does not count as
    a failed attempt."""
    row = db.execute(text("""
        UPDATE lead_fetch_task SET mode = 'LOCAL', status = 'PENDING', last_error = 'thin_page: server got a JavaScript shell',
               lease_owner = NULL, lease_until = NULL, not_before = now(), updated_at = now()
         WHERE id = :id AND status = 'CLAIMED' AND lease_owner = :o
        RETURNING id"""), {"id": task_id, "o": owner}).first()
    return row is not None


def rearm_stale_tasks(db: Session) -> List[Dict[str, Any]]:
    """CLAIMED tasks whose lease ran out: PENDING again (FAILED at the cap)."""
    rows = db.execute(text("""
        WITH stale AS (
            SELECT id FROM lead_fetch_task WHERE status = 'CLAIMED' AND lease_until < now()
             FOR UPDATE SKIP LOCKED
        )
        UPDATE lead_fetch_task t SET
            status = CASE WHEN t.attempts >= :cap THEN 'FAILED' ELSE 'PENDING' END,
            last_error = COALESCE(t.last_error, 'lease expired'), lease_owner = NULL, lease_until = NULL,
            not_before = now(), updated_at = now()
          FROM stale WHERE t.id = stale.id
        RETURNING t.id, t.candidate_id, t.status
    """), {"cap": TASK_MAX_ATTEMPTS}).fetchall()
    return [{"id": r[0], "candidate_id": r[1], "status": r[2]} for r in rows]


def open_task_count(db: Session, candidate_id: str) -> int:
    return int(db.execute(text(
        "SELECT COUNT(*) FROM lead_fetch_task WHERE candidate_id = :c AND status IN ('PENDING', 'CLAIMED')"
    ), {"c": candidate_id}).scalar() or 0)


def fetching_due(db: Session, limit: int = 200) -> List[Dict[str, Any]]:
    """FETCHING candidates that may be READY: no open task left, or past the
    fetch deadline."""
    return _rows(db.execute(text("""
        SELECT c.id, c.org_id, c.institute_id, c.fetch_deadline,
               (SELECT COUNT(*) FROM lead_fetch_task t
                 WHERE t.candidate_id = c.id AND t.status IN ('PENDING', 'CLAIMED')) AS open_tasks
          FROM lead_candidate c
         WHERE c.status = 'FETCHING'
           AND (c.fetch_deadline < now()
                OR NOT EXISTS (SELECT 1 FROM lead_fetch_task t
                                WHERE t.candidate_id = c.id AND t.status IN ('PENDING', 'CLAIMED')))
         LIMIT :n
    """), {"n": limit}).mappings())


def cancel_open_tasks(db: Session, candidate_id: str, reason: str) -> None:
    db.execute(text("""
        UPDATE lead_fetch_task SET status = 'FAILED', last_error = :r, lease_until = NULL, updated_at = now()
         WHERE candidate_id = :c AND status = 'PENDING'
    """), {"c": candidate_id, "r": reason[:2000]})


# ==========================================================================
# lead_agent_worker (Chrome extensions)
# ==========================================================================
WORKER_COLS = ("id, institute_id, user_id, kind, label, version, last_seen_at, revoked_at, pages_today, pages_day, "
               "created_at, updated_at")


def insert_worker(db: Session, *, institute_id: str, user_id: str, label: Optional[str], token_hash: str) -> Dict[str, Any]:
    row = db.execute(text(f"""
        INSERT INTO lead_agent_worker (institute_id, user_id, kind, label, token_hash)
        VALUES (:i, :u, 'EXTENSION', :l, :h) RETURNING {WORKER_COLS}
    """), {"i": institute_id, "u": user_id, "l": (label or None) and label[:120], "h": token_hash}).mappings().first()
    return dict(row)


def worker_by_token_hash(db: Session, token_hash: str) -> Optional[Dict[str, Any]]:
    return _row(db.execute(text(f"SELECT {WORKER_COLS} FROM lead_agent_worker WHERE token_hash = :h"),
                           {"h": token_hash}).mappings().first())


def list_workers(db: Session, institute_id: str) -> List[Dict[str, Any]]:
    return _rows(db.execute(text(f"""
        SELECT {WORKER_COLS}, (last_seen_at IS NOT NULL AND last_seen_at > now() - interval '{ONLINE_SECONDS} seconds')
               AS online
          FROM lead_agent_worker WHERE institute_id = :i AND revoked_at IS NULL ORDER BY created_at DESC
    """), {"i": institute_id}).mappings())


def workers_online(db: Session, institute_id: str) -> int:
    return int(db.execute(text(f"""
        SELECT COUNT(*) FROM lead_agent_worker
         WHERE institute_id = :i AND revoked_at IS NULL AND last_seen_at > now() - interval '{ONLINE_SECONDS} seconds'
    """), {"i": institute_id}).scalar() or 0)


def revoke_worker(db: Session, worker_id: str, institute_id: str) -> bool:
    row = db.execute(text("""
        UPDATE lead_agent_worker SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
         WHERE id = :id AND institute_id = :i RETURNING id
    """), {"id": worker_id, "i": institute_id}).first()
    return row is not None


def touch_worker(db: Session, worker_id: str, *, version: Optional[str] = None, label: Optional[str] = None) -> None:
    db.execute(text("""
        UPDATE lead_agent_worker SET last_seen_at = now(), version = COALESCE(:v, version),
               label = COALESCE(:l, label), updated_at = now() WHERE id = :id
    """), {"id": worker_id, "v": (version or None) and version[:30], "l": (label or None) and label[:120]})


def worker_pages_left(db: Session, worker_id: str, today: date) -> int:
    row = db.execute(text("SELECT pages_today, pages_day FROM lead_agent_worker WHERE id = :id"),
                     {"id": worker_id}).first()
    if row is None:
        return 0
    used = int(row[0] or 0) if row[1] == today else 0
    return max(0, WORKER_DAILY_PAGES - used)


def count_worker_page(db: Session, worker_id: str, today: date) -> None:
    db.execute(text("""
        UPDATE lead_agent_worker SET
            pages_today = CASE WHEN pages_day = :d THEN pages_today + 1 ELSE 1 END,
            pages_day = :d, last_seen_at = now(), updated_at = now()
         WHERE id = :id
    """), {"id": worker_id, "d": today})


# ==========================================================================
# lead_suppression
# ==========================================================================
SUPP_COLS = "id, institute_id, kind, value, reason, note, created_by, created_at"


def list_suppressions(db: Session, institute_id: str) -> List[Dict[str, Any]]:
    return _rows(db.execute(text(f"SELECT {SUPP_COLS} FROM lead_suppression WHERE institute_id = :i "
                                 f"ORDER BY created_at DESC"), {"i": institute_id}).mappings())


def insert_suppression(db: Session, *, institute_id: str, kind: str, value: str, reason: str,
                       note: Optional[str], created_by: Optional[str]) -> Dict[str, Any]:
    row = db.execute(text(f"""
        INSERT INTO lead_suppression (institute_id, kind, value, reason, note, created_by)
        VALUES (:i, :k, :v, :r, :n, :u)
        ON CONFLICT (institute_id, kind, value) DO NOTHING
        RETURNING {SUPP_COLS}
    """), {"i": institute_id, "k": kind, "v": value[:320], "r": reason, "n": (note or None) and note[:300],
           "u": created_by}).mappings().first()
    if row is not None:
        return dict(row)
    return dict(db.execute(text(f"SELECT {SUPP_COLS} FROM lead_suppression WHERE institute_id = :i AND kind = :k "
                                f"AND value = :v"), {"i": institute_id, "k": kind, "v": value[:320]}).mappings().first())


def delete_suppression(db: Session, supp_id: str, institute_id: str) -> bool:
    row = db.execute(text("DELETE FROM lead_suppression WHERE id = :id AND institute_id = :i RETURNING id"),
                     {"id": supp_id, "i": institute_id}).first()
    return row is not None


def suppressed(db: Session, institute_id: str) -> Dict[str, Set[str]]:
    out: Dict[str, Set[str]] = {"DOMAIN": set(), "PHONE": set(), "EMAIL": set()}
    for kind, value in db.execute(text("SELECT kind, value FROM lead_suppression WHERE institute_id = :i"),
                                  {"i": institute_id}).fetchall():
        out.setdefault(kind, set()).add(value)
    return out


# ==========================================================================
# lead_search_cache
# ==========================================================================
def cached_search(db: Session, key: str, max_age_days: int = SEARCH_CACHE_DAYS) -> Optional[Any]:
    row = db.execute(text("""
        SELECT results_json FROM lead_search_cache
         WHERE key = :k AND created_at > now() - (CAST(:d AS integer) * interval '1 day')
    """), {"k": key, "d": int(max_age_days)}).first()
    return row[0] if row else None


def put_search(db: Session, *, key: str, provider: str, kind: str, query: str, results: Any) -> None:
    db.execute(text("""
        INSERT INTO lead_search_cache (key, provider, kind, query, results_json, created_at)
        VALUES (:k, :p, :kind, :q, CAST(:r AS jsonb), now())
        ON CONFLICT (key) DO UPDATE SET results_json = EXCLUDED.results_json, created_at = now()
    """), {"k": key, "p": provider[:12], "kind": kind[:12], "q": query, "r": _j(results)})


def delete_old_search_cache(db: Session, max_age_days: int = SEARCH_CACHE_DAYS) -> int:
    return len(db.execute(text(
        "DELETE FROM lead_search_cache WHERE created_at < now() - (CAST(:d AS integer) * interval '1 day') RETURNING key"
    ), {"d": int(max_age_days)}).fetchall())
