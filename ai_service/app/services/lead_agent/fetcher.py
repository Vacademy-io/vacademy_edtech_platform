"""Reading organisations' websites: the fetch-task protocol (spec §1, §4.1).

A candidate's pages are fetched through lead_fetch_task rows:
  * LOCAL tasks only by the institute's Chrome extension, REMOTE only by our
    server fetcher, AUTO by whichever comes first (the server takes an AUTO task
    nobody claimed for 5 minutes);
  * the home page first; once it is in, engine.pagefetch.choose_pages picks at
    most 3 more (contact / team / careers / admissions), fetched in the same mode;
  * when no task of the candidate is PENDING / CLAIMED (or its 10-minute fetch
    deadline passed with the home page in), the candidate becomes READY.

`ingest_page_result` is shared by both fetchers, so a page read by the extension
is parsed exactly like one read by the server. The server fetcher honours
robots.txt (cached per organisation in lead_org.robots_json for 7 days), goes
through safe_http.safe_fetch (SSRF-safe, every redirect re-checked), 15 s per
page, at most 1.5 MB, one request per site at a time (claims take one task per
organisation) and a short pause between sites.
"""
from __future__ import annotations

import asyncio
import logging
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib import robotparser
from urllib.parse import urlsplit

from . import db as ladb
from . import engine_api, pacing, store

logger = logging.getLogger(__name__)

USER_AGENT = "VacademyLeadAgent/1.0 (+https://vacademy.io/lead-agent)"
ROBOTS_AGENT = "VacademyLeadAgent"
PAGE_TIMEOUT_S = 15.0
MAX_PAGE_BYTES = 1_500_000
TOO_LARGE_RETRY_BYTES = 6_000_000
ROBOTS_MAX_BYTES = 256_000
ROBOTS_TTL = timedelta(days=7)
HOST_PAUSE_S = 0.7
RETRY_DELAY_S = 120
MORE_PAGES = 3
OWNER = f"server:{socket.gethostname()[:40]}:{uuid.uuid4().hex[:8]}"


# ==========================================================================
# scheduling a candidate's pages
# ==========================================================================
def schedule_candidate(db, cand: Dict[str, Any], agent: Dict[str, Any]) -> str:
    """DISCOVERED -> READY (pages read within 14 days are reused) or FETCHING
    (a home-page task in the agent's mode). Returns the new status."""
    fresh = store.org_pages(db, cand["org_id"], institute_id=cand["institute_id"],
                            max_age_days=store.PAGE_REUSE_DAYS, ok_only=True)
    if any(p["page_type"] == "home" for p in fresh):
        store.set_candidate(db, cand["id"], expect=["DISCOVERED"], status="READY", not_before="now()")
        return "READY"
    website = cand.get("org_website") or (f"https://{cand['org_domain']}/" if cand.get("org_domain") else None)
    if not website:
        store.set_candidate(db, cand["id"], expect=["DISCOVERED"], status="REJECTED", decision="REJECT",
                            reject_reason="No website to read")
        return "REJECTED"
    store.enqueue_task(db, institute_id=cand["institute_id"], agent_id=cand["agent_id"], candidate_id=cand["id"],
                       org_id=cand["org_id"], url=website, page_type="home", mode=agent["mode"])
    store.set_candidate(db, cand["id"], expect=["DISCOVERED"], status="FETCHING",
                        fetch_deadline=pacing.now_utc() + timedelta(minutes=store.FETCH_DEADLINE_MINUTES))
    return "FETCHING"


def maybe_ready(db, candidate_id: str) -> bool:
    """FETCHING -> READY once no task of the candidate is open."""
    if store.open_task_count(db, candidate_id):
        return False
    return store.set_candidate(db, candidate_id, expect=["FETCHING"], status="READY", not_before="now()") is not None


def finalize_fetching(db) -> int:
    """Sweep: FETCHING candidates with nothing open, or past the deadline with
    the home page in (the rest of their tasks are dropped), become READY. A
    candidate whose home page was never even claimed (LOCAL, no extension
    online) keeps waiting: its deadline moves on, nothing is spent on it."""
    moved = 0
    for row in store.fetching_due(db):
        if int(row["open_tasks"] or 0) == 0:
            moved += bool(store.set_candidate(db, row["id"], expect=["FETCHING"], status="READY", not_before="now()"))
            continue
        pages = store.org_pages(db, row["org_id"], institute_id=row["institute_id"],
                                max_age_days=store.PAGE_REUSE_DAYS)
        if any(p["page_type"] == "home" for p in pages):
            store.cancel_open_tasks(db, row["id"], "fetch deadline passed")
            moved += bool(store.set_candidate(db, row["id"], expect=["FETCHING"], status="READY", not_before="now()"))
        else:
            store.set_candidate(db, row["id"], expect=["FETCHING"],
                                fetch_deadline=pacing.now_utc() + timedelta(minutes=store.FETCH_DEADLINE_MINUTES))
    return moved


# ==========================================================================
# turning a fetch result into a page
# ==========================================================================
def _record_for(task: Dict[str, Any], html: Optional[str], status_code: Optional[int], final_url: Optional[str],
                content_type: Optional[str]) -> Dict[str, Any]:
    ctype = (content_type or "").lower()
    if html is not None and ctype and "html" not in ctype and "xml" not in ctype and "text/plain" not in ctype:
        return {"url": task["url"], "final_url": final_url or task["url"], "access": "not_html", "text": None,
                "links": [], "has_form": False, "platform_hints": [], "status_code": status_code}
    record = engine_api.parse_page(task["url"], final_url or task["url"], html or "", status_code)
    record = dict(record or {})
    record.setdefault("status_code", status_code)
    record.setdefault("final_url", final_url or task["url"])
    if record.get("access") not in ("ok", "blocked", "error", "not_html", "robots_disallowed", "unsafe_url",
                                     "js_shell"):
        record["access"] = "error"
    return record


def ingest_page_result(task: Dict[str, Any], html: Optional[str], status_code: Optional[int],
                       final_url: Optional[str], content_type: Optional[str], fetched_by: str,
                       *, record: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Store one fetched page and move the queue on (blocking; one short session).

    `task` is a CLAIMED lead_fetch_task row; fetched_by 'SERVER' | 'EXTENSION'.
    `record` overrides parsing (robots_disallowed / unsafe_url pages). Returns
    {"page": row, "enqueued": n, "ready": bool}."""
    if record is None:
        record = _record_for(task, html, status_code, final_url, content_type)
    with ladb.session() as db:
        done = store.finish_task(db, task["id"], "DONE", owner=task.get("lease_owner"))
        if done is None:
            return {"page": None, "enqueued": 0, "ready": False, "stale": True}
        page = store.upsert_page(db, org_id=task["org_id"], url=task["url"], page_type=task["page_type"],
                                 record=record, fetched_by=fetched_by, institute_id=task["institute_id"])
        agent = store.get_agent(db, task["agent_id"])
        day = pacing.agent_day((agent or {}).get("window_json"))
        store.bump_day(db, task["agent_id"], day, pages=1)
        enqueued = 0
        if task["page_type"] == "home":
            store.touch_pages_fetched(db, task["org_id"])
            # A JavaScript shell still carries its links: the contact page is often server-rendered.
            if record.get("access") in ("ok", "js_shell"):
                known = store.candidate_task_urls(db, task["candidate_id"]) | {task["url"]}
                try:
                    picks = engine_api.choose_pages(record, MORE_PAGES)
                except Exception:  # noqa: BLE001 - more pages are a bonus; the home page stands
                    logger.warning("lead agent: choose_pages failed for %s", task["url"], exc_info=True)
                    picks = []
                # choose_pages caps the slot pages itself and may add one course-portal page on top
                # (where competitor markers such as Appx live), so no second cut here.
                for url, page_type in picks:
                    if url in known:
                        continue
                    if store.enqueue_task(db, institute_id=task["institute_id"], agent_id=task["agent_id"],
                                          candidate_id=task["candidate_id"], org_id=task["org_id"], url=url,
                                          page_type=page_type, mode=task["mode"]):
                        enqueued += 1
                        known.add(url)
            if enqueued:
                # The follow-up pages get their own full window: in AUTO each waits up to
                # store.AUTO_REMOTE_AFTER_S for an extension, so the home page's window (often
                # half used by that same wait) cut them off (2026-10-26: 40 of 176 pages dropped).
                store.set_candidate(db, task["candidate_id"], expect=["FETCHING"],
                                    fetch_deadline=pacing.now_utc() + timedelta(minutes=store.FETCH_DEADLINE_MINUTES))
        ready = maybe_ready(db, task["candidate_id"])
    return {"page": page, "enqueued": enqueued, "ready": ready}


def fail_attempt(task: Dict[str, Any], error: str, *, fetched_by: str, delay_s: int = RETRY_DELAY_S) -> str:
    """A fetch that did not get a page: try again later, or, at the attempts cap,
    store an 'error' page so the candidate can move on. Returns the task status."""
    with ladb.session() as db:
        status = store.retry_task(db, task["id"], error, delay_s, owner=task.get("lease_owner"))
        if status == "FAILED":
            store.upsert_page(db, org_id=task["org_id"], url=task["url"], page_type=task["page_type"],
                              record={"access": "error", "text": None, "links": [], "final_url": task["url"]},
                              fetched_by=fetched_by, institute_id=task["institute_id"])
            if task["page_type"] == "home":
                store.touch_pages_fetched(db, task["org_id"])
            maybe_ready(db, task["candidate_id"])
    return status or "STALE"


# ==========================================================================
# the server fetcher
# ==========================================================================
async def _robots(org: Dict[str, Any], url: str) -> Optional[robotparser.RobotFileParser]:
    """The site's robots.txt rules (cached on lead_org for 7 days); None = no rules."""
    from ..safe_http import SafeFetchError, safe_fetch

    cached = org.get("robots_json") or None
    lines: Optional[str] = None
    if cached and cached.get("fetched_at"):
        try:
            at = datetime.fromisoformat(cached["fetched_at"])
            if pacing.now_utc() - at < ROBOTS_TTL:
                lines = cached.get("lines") or ""
        except ValueError:
            lines = None
    if lines is None:
        parts = urlsplit(url)
        robots_url = f"{parts.scheme or 'https'}://{parts.netloc}/robots.txt"
        status = None
        try:
            res = await safe_fetch(robots_url, max_bytes=ROBOTS_MAX_BYTES, timeout=10.0, total_timeout=15.0,
                                   allow_http=True, headers={"User-Agent": USER_AGENT})
            status = res.status_code
            lines = res.content.decode("utf-8", errors="replace") if 200 <= res.status_code < 300 else ""
        except SafeFetchError:
            lines = ""
        except Exception:  # noqa: BLE001
            lines = ""
        robots = {"fetched_at": pacing.now_utc().isoformat(), "status": status, "lines": lines[:50_000]}
        await asyncio.to_thread(_save_robots, org["id"], robots)
        org["robots_json"] = robots
    if not lines.strip():
        return None
    parser = robotparser.RobotFileParser()
    parser.parse(lines.splitlines())
    return parser


def _save_robots(org_id: str, robots: dict) -> None:
    with ladb.session() as db:
        store.set_org_robots(db, org_id, robots)


def _decode(content: bytes, content_type: str) -> str:
    charset = None
    for part in (content_type or "").split(";"):
        part = part.strip().lower()
        if part.startswith("charset="):
            charset = part.split("=", 1)[1].strip().strip('"')
    for enc in (charset, "utf-8", "latin-1"):
        if not enc:
            continue
        try:
            return content.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return content.decode("utf-8", errors="replace")


async def fetch_task(task: Dict[str, Any]) -> str:
    """Fetch one claimed task on the server. Returns a short outcome."""
    from ..safe_http import SafeFetchError, safe_fetch

    org = await asyncio.to_thread(_get_org, task["org_id"]) or {"id": task["org_id"]}
    rules = await _robots(org, task["url"])
    if rules is not None and not rules.can_fetch(ROBOTS_AGENT, task["url"]):
        await asyncio.to_thread(
            ingest_page_result, task, None, None, task["url"], None, "SERVER",
            record={"access": "robots_disallowed", "text": None, "links": [], "final_url": task["url"]})
        return "robots_disallowed"
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    try:
        try:
            res = await safe_fetch(task["url"], max_bytes=MAX_PAGE_BYTES, timeout=PAGE_TIMEOUT_S,
                                   total_timeout=PAGE_TIMEOUT_S + 10, allow_http=True, max_redirects=5,
                                   headers=headers)
        except SafeFetchError as exc:
            if exc.code != "too_large":
                raise
            # Pages with inlined scripts and images run past 1.5 MB; their text is near the top.
            # Read once more with a larger cap and keep the first 1.5 MB, as the extension does.
            res = await safe_fetch(task["url"], max_bytes=TOO_LARGE_RETRY_BYTES, timeout=PAGE_TIMEOUT_S,
                                   total_timeout=PAGE_TIMEOUT_S + 20, allow_http=True, max_redirects=5,
                                   headers=headers)
            res.content = res.content[:MAX_PAGE_BYTES]
    except SafeFetchError as exc:
        if exc.code in ("bad_url", "blocked_host", "blocked_address"):
            await asyncio.to_thread(
                ingest_page_result, task, None, None, task["url"], None, "SERVER",
                record={"access": "unsafe_url", "text": None, "links": [], "final_url": task["url"]})
            return "unsafe_url"
        if exc.code == "too_large":
            await asyncio.to_thread(
                ingest_page_result, task, None, None, task["url"], None, "SERVER",
                record={"access": "error", "text": None, "links": [], "final_url": task["url"]})
            return "too_large"
        return await asyncio.to_thread(fail_attempt, task, f"{exc.code}: {exc.message}", fetched_by="SERVER")
    ctype = res.headers.get("content-type", "")
    html = _decode(res.content, ctype)
    record = await asyncio.to_thread(_record_for, task, html, res.status_code, res.url, ctype)  # parsing is CPU
    if record.get("access") == "js_shell" and await asyncio.to_thread(_hand_to_extension, task):
        return "js_shell: handed to the extension"
    await asyncio.to_thread(ingest_page_result, task, html, res.status_code, res.url, ctype, "SERVER",
                            record=record)
    return f"http {res.status_code}"


def _hand_to_extension(task: Dict[str, Any]) -> bool:
    """An empty JavaScript shell can only be read in a real browser: pass it to the institute's
    extension (tab render) when the agent may use one and one is online. Otherwise the page is
    stored as js_shell (unreadable) and the candidate moves on with its other pages."""
    with ladb.session() as db:
        agent = store.get_agent(db, task["agent_id"])
        if not agent or agent.get("mode") == "REMOTE":
            return False
        if store.workers_online(db, task["institute_id"]) <= 0:
            return False
        return store.hand_task_to_extension(db, task["id"], task.get("lease_owner") or OWNER)


def _get_org(org_id: str) -> Optional[Dict[str, Any]]:
    with ladb.session() as db:
        return store.get_org(db, org_id)


def claim_server_batch(n: int, institutes: Optional[List[str]]) -> List[Dict[str, Any]]:
    with ladb.session() as db:
        return store.claim_server_tasks(db, n, OWNER, lease_s=int(PAGE_TIMEOUT_S * 4) + 60, institutes=institutes)


async def run_server_batch(n: int, institutes: Optional[List[str]]) -> int:
    """Claim and fetch up to n tasks (one per site), staggered. Returns how many."""
    tasks = await asyncio.to_thread(claim_server_batch, n, institutes)

    async def one(i: int, task: Dict[str, Any]) -> None:
        await asyncio.sleep(i * HOST_PAUSE_S)
        try:
            outcome = await fetch_task(task)
            logger.debug("lead agent: fetched %s -> %s", task["url"], outcome)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad page must not stop the batch
            logger.warning("lead agent: fetch of %s failed: %r", task["url"], exc)
            try:
                await asyncio.to_thread(fail_attempt, task, f"{type(exc).__name__}: {str(exc)[:200]}",
                                        fetched_by="SERVER")
            except Exception:  # noqa: BLE001 - the lease runs out and the task is re-armed
                logger.exception("lead agent: could not record a fetch failure")

    await asyncio.gather(*(one(i, t) for i, t in enumerate(tasks)))
    return len(tasks)


__all__ = ["USER_AGENT", "schedule_candidate", "maybe_ready", "finalize_fetching", "ingest_page_result",
           "fail_attempt", "fetch_task", "run_server_batch"]
