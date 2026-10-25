"""Fetch tasks -> page ingest -> READY, on real Postgres with the real
engine.pagefetch (parse_page / choose_pages); the network is faked."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
from sqlalchemy import text

from conftest import INSTITUTE, make_candidate, make_world
from app.services.lead_agent import fetcher, store

HOME_HTML = """<html><head><title>Winners Institute</title></head><body>
<h1>Winners Institute Indore</h1><p>JEE and NEET coaching since 2004. Admissions open for 2027 batches.</p>
<a href="/contact-us">Contact us</a> <a href="/about">About us</a> <a href="/careers">Careers</a>
<form><input name="phone"></form><p>Call 98765 12345</p></body></html>"""
PAGE_HTML = "<html><body><h1>Contact</h1><p>Admissions desk: +91 98765 12345, info@winners.example.in</p></body></html>"


def _get(factory, sql, **p):
    with factory() as db:
        return db.execute(text(sql), p).fetchall()


def _scheduled(la_db, mode="AUTO"):
    agent = make_world(la_db, mode=mode)
    cand = make_candidate(la_db, agent)
    with la_db() as db:
        status = fetcher.schedule_candidate(db, store.get_candidate(db, cand["id"]), agent)
        db.commit()
    return agent, cand, status


def _claim(la_db, owner="server-test"):
    with la_db() as db:
        rows = db.execute(text(f"""
            UPDATE lead_fetch_task t SET status = 'CLAIMED', lease_owner = :o, attempts = attempts + 1,
                   lease_until = now() + interval '2 minutes'
             WHERE status = 'PENDING' RETURNING {store.TASK_COLS}"""), {"o": owner}).mappings().all()
        db.commit()
    return [dict(r) for r in rows]


def test_new_candidate_gets_a_home_task_in_the_agent_mode(la_db):
    agent, cand, status = _scheduled(la_db, mode="LOCAL")
    assert status == "FETCHING"
    rows = _get(la_db, "SELECT url, page_type, mode, status FROM lead_fetch_task")
    assert rows == [("https://winners.example.in/", "home", "LOCAL", "PENDING")]
    assert _get(la_db, "SELECT fetch_deadline > now() FROM lead_candidate")[0][0] is True


def test_recent_pages_are_reused_without_fetching(la_db):
    agent = make_world(la_db)
    cand = make_candidate(la_db, agent)
    with la_db() as db:
        store.upsert_page(db, org_id=cand["org_id"], url="https://winners.example.in/", page_type="home",
                          record={"access": "ok", "text": "hello", "links": []}, fetched_by="SERVER",
                          institute_id=INSTITUTE)
        assert fetcher.schedule_candidate(db, store.get_candidate(db, cand["id"]), agent) == "READY"
        db.commit()
    assert _get(la_db, "SELECT count(*) FROM lead_fetch_task")[0][0] == 0


def test_home_page_enqueues_more_pages_then_ready(la_db):
    agent, cand, _ = _scheduled(la_db)
    [home] = _claim(la_db)
    out = fetcher.ingest_page_result(home, HOME_HTML, 200, "https://winners.example.in/", "text/html", "EXTENSION")
    assert out["page"]["access"] == "ok" and out["enqueued"] >= 1 and out["ready"] is False
    tasks = _get(la_db, "SELECT page_type, mode, status FROM lead_fetch_task WHERE page_type <> 'home'")
    assert {t[0] for t in tasks} >= {"contact"} and all(t[1] == "AUTO" and t[2] == "PENDING" for t in tasks)
    page = _get(la_db, "SELECT fetched_by, has_form, length(text) > 20, expires_at > now() + interval '29 days' "
                       "FROM lead_org_page WHERE page_type = 'home'")[0]
    assert page == ("EXTENSION", True, True, True)
    for t in _claim(la_db):
        fetcher.ingest_page_result(t, PAGE_HTML, 200, t["url"], "text/html; charset=utf-8", "SERVER")
    assert _get(la_db, "SELECT status FROM lead_candidate")[0][0] == "READY"
    day = _get(la_db, "SELECT pages FROM lead_agent_day")[0][0]
    assert day == 1 + len(tasks)


def test_a_stale_result_after_rearm_is_ignored(la_db):
    agent, cand, _ = _scheduled(la_db)
    [home] = _claim(la_db, owner="w-old")
    with la_db() as db:
        db.execute(text("UPDATE lead_fetch_task SET lease_owner = 'w-new'"))
        db.commit()
    out = fetcher.ingest_page_result(home, HOME_HTML, 200, None, "text/html", "EXTENSION")
    assert out.get("stale") is True
    assert _get(la_db, "SELECT count(*) FROM lead_org_page")[0][0] == 0


def test_non_html_and_failed_fetches_still_move_the_candidate_on(la_db):
    agent, cand, _ = _scheduled(la_db)
    [home] = _claim(la_db)
    for attempt in range(store.TASK_MAX_ATTEMPTS):
        status = fetcher.fail_attempt(home, "timeout", fetched_by="SERVER", delay_s=0)
        if status == "FAILED":
            break
        [home] = _claim(la_db)
    assert status == "FAILED"
    assert _get(la_db, "SELECT access FROM lead_org_page")[0][0] == "error"
    assert _get(la_db, "SELECT status FROM lead_candidate")[0][0] == "READY"


def test_pdf_is_not_html(la_db):
    agent, cand, _ = _scheduled(la_db)
    [home] = _claim(la_db)
    fetcher.ingest_page_result(home, "%PDF-1.4 ...", 200, None, "application/pdf", "SERVER")
    assert _get(la_db, "SELECT access FROM lead_org_page")[0][0] == "not_html"


def test_deadline_rules(la_db):
    agent, cand, _ = _scheduled(la_db, mode="LOCAL")
    with la_db() as db:  # no extension ever took the home page: keep waiting, spend nothing
        db.execute(text("UPDATE lead_candidate SET fetch_deadline = now() - interval '1 minute'"))
        assert fetcher.finalize_fetching(db) == 0
        db.commit()
    assert _get(la_db, "SELECT status, fetch_deadline > now() FROM lead_candidate")[0] == ("FETCHING", True)
    [home] = _claim(la_db)
    fetcher.ingest_page_result(home, HOME_HTML, 200, None, "text/html", "EXTENSION")
    with la_db() as db:  # home in, sub-pages lagging past the deadline: READY, the rest dropped
        db.execute(text("UPDATE lead_candidate SET fetch_deadline = now() - interval '1 minute'"))
        assert fetcher.finalize_fetching(db) == 1
        db.commit()
    assert _get(la_db, "SELECT status FROM lead_candidate")[0][0] == "READY"
    assert _get(la_db, "SELECT count(*) FROM lead_fetch_task WHERE status = 'PENDING'")[0][0] == 0


def _fake_fetch(pages):
    async def fake(url, **kwargs):
        if url not in pages:
            from app.services.safe_http import SafeFetchError
            raise SafeFetchError("fetch_failed", "nope")
        status, body, ctype = pages[url]
        return SimpleNamespace(url=url, status_code=status, headers=httpx.Headers({"content-type": ctype}),
                               content=body.encode())
    return fake


def test_server_fetch_honours_robots_txt(la_db, monkeypatch):
    import app.services.safe_http as safe_http

    agent, cand, _ = _scheduled(la_db, mode="REMOTE")
    monkeypatch.setattr(safe_http, "safe_fetch", _fake_fetch({
        "https://winners.example.in/robots.txt": (200, "User-agent: *\nDisallow: /\n", "text/plain"),
    }))
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "robots_disallowed"
    assert _get(la_db, "SELECT access FROM lead_org_page")[0][0] == "robots_disallowed"
    robots = _get(la_db, "SELECT robots_json->>'lines' FROM lead_org")[0][0]
    assert "Disallow" in robots


def test_server_fetch_reads_the_page(la_db, monkeypatch):
    import app.services.safe_http as safe_http

    agent, cand, _ = _scheduled(la_db, mode="REMOTE")
    monkeypatch.setattr(safe_http, "safe_fetch", _fake_fetch({
        "https://winners.example.in/robots.txt": (404, "", "text/plain"),
        "https://winners.example.in/": (200, HOME_HTML, "text/html; charset=utf-8"),
    }))
    n = asyncio.run(fetcher.run_server_batch(4, None))
    assert n == 1
    assert _get(la_db, "SELECT access, fetched_by FROM lead_org_page")[0] == ("ok", "SERVER")
    assert _get(la_db, "SELECT count(*) FROM lead_fetch_task WHERE status = 'PENDING'")[0][0] >= 1


def test_unsafe_url_is_recorded_not_retried(la_db, monkeypatch):
    import app.services.safe_http as safe_http
    from app.services.safe_http import SafeFetchError

    agent, cand, _ = _scheduled(la_db, mode="REMOTE")

    async def blocked(url, **kwargs):
        if url.endswith("robots.txt"):
            raise SafeFetchError("blocked_address", "private")
        raise SafeFetchError("blocked_address", "private")
    monkeypatch.setattr(safe_http, "safe_fetch", blocked)
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "unsafe_url"
    assert _get(la_db, "SELECT status FROM lead_fetch_task")[0][0] == "DONE"


SHELL_HTML = ('<html><head><script src="/_next/static/a.js"></script><script src="/b.js"></script></head>'
              '<body><div id="__next"></div><a href="/contact-us">Contact</a></body></html>')


def test_course_portal_page_is_fetched_on_top_of_the_three_slot_pages(la_db):
    # WiNNERS: Appx markers live only on the course portal sub-domain; a second cut to three
    # pages used to drop it, so the competitor platform was never seen.
    agent, cand, _ = _scheduled(la_db)
    [home] = _claim(la_db)
    portal_home = HOME_HTML.replace(
        '<a href="/careers">Careers</a>',
        '<a href="/careers">Careers</a> <a href="https://live.winners.example.in/courses">Start Learning</a>')
    out = fetcher.ingest_page_result(home, portal_home, 200, "https://winners.example.in/", "text/html", "SERVER")
    kinds = {r[0] for r in _get(la_db, "SELECT page_type FROM lead_fetch_task WHERE page_type <> 'home'")}
    assert {"contact", "about", "careers", "platform"} <= kinds, kinds
    assert out["enqueued"] == 4


def _online_extension(la_db):
    with la_db() as db:
        worker = store.insert_worker(db, institute_id=INSTITUTE, user_id="u-1", label="laptop", token_hash="h" * 64)
        store.touch_worker(db, worker["id"])
        db.commit()


def test_server_js_shell_is_handed_to_an_online_extension(la_db, monkeypatch):
    import app.services.safe_http as safe_http

    agent, cand, _ = _scheduled(la_db, mode="AUTO")
    _online_extension(la_db)
    monkeypatch.setattr(safe_http, "safe_fetch", _fake_fetch({
        "https://winners.example.in/robots.txt": (404, "", "text/plain"),
        "https://winners.example.in/": (200, SHELL_HTML, "text/html"),
    }))
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)).startswith("js_shell")
    assert _get(la_db, "SELECT mode, status, last_error LIKE 'thin_page%' FROM lead_fetch_task")[0] == (
        "LOCAL", "PENDING", True)
    assert _get(la_db, "SELECT count(*) FROM lead_org_page")[0][0] == 0


def test_server_js_shell_without_an_extension_is_stored_as_unreadable(la_db, monkeypatch):
    import app.services.safe_http as safe_http

    agent, cand, _ = _scheduled(la_db, mode="REMOTE")
    _online_extension(la_db)  # REMOTE agents never use the extension
    monkeypatch.setattr(safe_http, "safe_fetch", _fake_fetch({
        "https://winners.example.in/robots.txt": (404, "", "text/plain"),
        "https://winners.example.in/": (200, SHELL_HTML, "text/html"),
    }))
    [home] = _claim(la_db)
    asyncio.run(fetcher.fetch_task(home))
    assert _get(la_db, "SELECT access FROM lead_org_page")[0][0] == "js_shell"
    # its links still lead to the (often server-rendered) contact page
    assert _get(la_db, "SELECT count(*) FROM lead_fetch_task WHERE page_type = 'contact'")[0][0] == 1
