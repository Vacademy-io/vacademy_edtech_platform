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


def test_follow_up_pages_get_a_full_window(la_db):
    # In AUTO the home page alone may wait 5 minutes for an extension; its follow-up pages then wait
    # again, so the candidate's window restarts when they are queued (2026-10-26: 40 of 176 dropped).
    agent, cand, _ = _scheduled(la_db)
    with la_db() as db:
        db.execute(text("UPDATE lead_candidate SET fetch_deadline = now() + interval '1 minute'"))
        db.commit()
    [home] = _claim(la_db)
    out = fetcher.ingest_page_result(home, HOME_HTML, 200, None, "text/html", "SERVER")
    assert out["enqueued"] >= 1
    left = _get(la_db, "SELECT extract(epoch FROM fetch_deadline - now()) FROM lead_candidate")[0][0]
    assert left > (store.FETCH_DEADLINE_MINUTES - 1) * 60


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


# ------------------------------------------------- a failed home page is read once more (2026-10-29)
# Probe of the 237 "No readable page" rejects of "Leads for Vacademy": refusals of non-browser
# clients, https that redirects down to http, certificates and DNS for one of www / bare only, empty
# pages whose <meta refresh> moved on, and shells no extension rendered.

class _Web:
    """safe_fetch over canned answers: {url: (status, body, ctype) | SafeFetchError | fn(headers) -> either};
    a URL not listed fails to connect. Records (url, headers) of every request."""

    def __init__(self, pages):
        self.pages, self.calls = pages, []

    async def __call__(self, url, **kwargs):
        from app.services.safe_http import SafeFetchError

        headers = kwargs.get("headers") or {}
        self.calls.append((url, headers))
        answer = self.pages.get(url, SafeFetchError("fetch_failed", "The download failed (ConnectError)."))
        if callable(answer):
            answer = answer(headers)
        if isinstance(answer, Exception):
            raise answer
        status, body, ctype = answer
        return SimpleNamespace(url=url, status_code=status, headers=httpx.Headers({"content-type": ctype}),
                               content=body.encode())

    def urls(self):
        return [u for u, _ in self.calls if not u.endswith("/robots.txt")]


def _err(code, message="x"):
    from app.services.safe_http import SafeFetchError
    return SafeFetchError(code, message)


NO_ROBOTS = (404, "", "text/plain")
HTML = "text/html; charset=utf-8"


def _site(la_db, monkeypatch, domain, pages, mode="REMOTE"):
    import app.services.safe_http as safe_http

    monkeypatch.setattr(fetcher, "HOST_PAUSE_S", 0)
    web = _Web(pages)
    monkeypatch.setattr(safe_http, "safe_fetch", web)
    agent = make_world(la_db, mode=mode)
    cand = make_candidate(la_db, agent, domain=domain)
    with la_db() as db:
        fetcher.schedule_candidate(db, store.get_candidate(db, cand["id"]), agent)
        db.commit()
    return web


def _home(la_db):
    rows = _get(la_db, "SELECT access, final_url, length(coalesce(text, '')) FROM lead_org_page WHERE page_type = 'home'")
    return rows[0] if rows else None


def test_a_refused_home_page_is_read_again_as_a_browser_asks(la_db, monkeypatch):
    """nirmauni.ac.in answered 403 to the fetcher's own headers and 200 to a browser's."""
    def browser_only(headers):
        return (200, HOME_HTML, HTML) if "Chrome/" in headers.get("User-Agent", "") else (403, "Forbidden", "text/html")
    web = _site(la_db, monkeypatch, "nirmauni.ac.in", {"https://nirmauni.ac.in/robots.txt": NO_ROBOTS,
                                                       "https://nirmauni.ac.in/": browser_only})
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "http 200"
    assert _home(la_db)[0] == "ok"
    (_, first), (_, second) = [c for c in web.calls if not c[0].endswith("robots.txt")]
    assert first["User-Agent"] == fetcher.USER_AGENT
    assert second == fetcher.BROWSER_HEADERS and "Accept-Language" in second


def test_https_that_redirects_down_to_http_is_read_over_http(la_db, monkeypatch):
    """brillianttutorsacademy.com: https:// redirects to http://, which safe_fetch refuses to follow."""
    web = _site(la_db, monkeypatch, "brillianttutors.in", {
        "https://brillianttutors.in/robots.txt": NO_ROBOTS,
        "https://brillianttutors.in/": _err("blocked_host", "Refusing a redirect from https to http."),
        "http://brillianttutors.in/": (200, HOME_HTML, HTML)})
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "http 200 (http://brillianttutors.in/)"
    assert _home(la_db)[:2] == ("ok", "http://brillianttutors.in/")
    assert web.urls() == ["https://brillianttutors.in/", "http://brillianttutors.in/"]


def test_a_name_that_is_not_public_is_still_not_read_again(la_db, monkeypatch):
    web = _site(la_db, monkeypatch, "brillianttutors.in", {
        "https://brillianttutors.in/robots.txt": NO_ROBOTS,
        "https://brillianttutors.in/": _err("blocked_host", "That address is not a public website.")})
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "unsafe_url"
    assert web.urls() == ["https://brillianttutors.in/"]


def test_a_name_without_dns_or_certificate_is_read_at_its_www_twin(la_db, monkeypatch):
    """cgu-odisha.ac.in: no DNS for www; kmit.in: a certificate for the other name only."""
    web = _site(la_db, monkeypatch, "cguodisha.ac.in", {
        "https://cguodisha.ac.in/robots.txt": _err("dns_failed"),
        "https://cguodisha.ac.in/": _err("dns_failed"),
        "https://www.cguodisha.ac.in/robots.txt": NO_ROBOTS,  # the site's robots.txt was never read: the twin's is
        "https://www.cguodisha.ac.in/": (200, HOME_HTML, HTML)})
    [home] = _claim(la_db)
    asyncio.run(fetcher.fetch_task(home))
    assert _home(la_db)[:2] == ("ok", "https://www.cguodisha.ac.in/")
    assert "https://www.cguodisha.ac.in/robots.txt" in [u for u, _ in web.calls]
    # the pages it leads to are on the name that answered
    urls = {r[0] for r in _get(la_db, "SELECT url FROM lead_fetch_task WHERE page_type <> 'home'")}
    assert urls and all(u.startswith("https://www.cguodisha.ac.in/") for u in urls)


def test_the_twins_robots_txt_is_honoured(la_db, monkeypatch):
    web = _site(la_db, monkeypatch, "cguodisha.ac.in", {
        "https://cguodisha.ac.in/robots.txt": _err("dns_failed"),
        "https://cguodisha.ac.in/": _err("dns_failed"),
        "https://www.cguodisha.ac.in/robots.txt": (200, "User-agent: *\nDisallow: /\n", "text/plain"),
        "https://www.cguodisha.ac.in/": (200, HOME_HTML, HTML)})
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "PENDING"  # the first failure stands: tried again later
    assert web.urls() == ["https://cguodisha.ac.in/"]
    assert _get(la_db, "SELECT status, last_error LIKE 'dns_failed%' FROM lead_fetch_task")[0] == ("PENDING", True)


def test_a_twins_error_page_does_not_end_the_attempts_of_a_site_that_timed_out(la_db, monkeypatch):
    web = _site(la_db, monkeypatch, "dynamictutorial.in", {
        "https://dynamictutorial.in/robots.txt": NO_ROBOTS,
        "https://dynamictutorial.in/": _err("timeout", "The download timed out."),
        "https://www.dynamictutorial.in/": (404, "Not found", "text/html")})
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)) == "PENDING"
    assert web.urls() == ["https://dynamictutorial.in/", "https://www.dynamictutorial.in/"]
    assert _home(la_db) is None


def test_an_empty_page_that_moved_is_read_where_its_meta_refresh_points(la_db, monkeypatch):
    """sxcran.org: an empty page whose <meta refresh> sends browsers to sxcran.ac.in."""
    moved = ('<html><head><meta http-equiv="refresh" content="0;url=https://sxcran.ac.in/" />'
             "<title>Welcome to St. Xavier's College, Ranchi</title></head><body></body></html>")
    web = _site(la_db, monkeypatch, "sxcran.org", {
        "https://sxcran.org/robots.txt": NO_ROBOTS, "https://sxcran.org/": (200, moved, HTML),
        "https://sxcran.ac.in/robots.txt": NO_ROBOTS, "https://sxcran.ac.in/": (200, HOME_HTML, HTML)})
    [home] = _claim(la_db)
    asyncio.run(fetcher.fetch_task(home))
    assert _home(la_db)[:2] == ("ok", "https://sxcran.ac.in/")
    assert "https://sxcran.ac.in/robots.txt" in [u for u, _ in web.calls]  # another site: its own rules


TAKSH_SHELL = ('<html><head><title>Taksh Academy Vadodara</title>'
               '<meta name="description" content="Coaching for Class 8, 9 and 10 in Manjalpur and Tarsali, Vadodara.">'
               '<script type="application/ld+json">{"@type": "EducationalOrganization", "name": "Taksh Academy", '
               '"telephone": "+91 98250 12345"}</script><script src="/static/js/main.js"></script></head>'
               '<body><div id="root"></div></body></html>')


def test_a_shell_no_browser_renders_is_kept_as_the_text_its_html_carries(la_db, monkeypatch):
    _site(la_db, monkeypatch, "takshacademy.in", {"https://takshacademy.in/robots.txt": NO_ROBOTS,
                                                  "https://takshacademy.in/": (200, TAKSH_SHELL, HTML)})
    [home] = _claim(la_db)
    asyncio.run(fetcher.fetch_task(home))
    page = _get(la_db, "SELECT access, text FROM lead_org_page WHERE page_type = 'home'")[0]
    assert page[0] == "ok" and "Telephone: +91 98250 12345" in page[1] and "Manjalpur" in page[1]


def test_a_shell_the_extension_never_took_comes_back_to_the_server(la_db, monkeypatch):
    """An AUTO agent's shell handed to an extension that then went offline waited for ever."""
    _site(la_db, monkeypatch, "takshacademy.in", {"https://takshacademy.in/robots.txt": NO_ROBOTS,
                                                  "https://takshacademy.in/": (200, TAKSH_SHELL, HTML)}, mode="AUTO")
    _online_extension(la_db)
    [home] = _claim(la_db)
    assert asyncio.run(fetcher.fetch_task(home)).startswith("js_shell")
    assert fetcher.claim_server_batch(4, None) == []  # the extension still has its 5 minutes
    with la_db() as db:
        db.execute(text("UPDATE lead_fetch_task SET updated_at = now() - interval '6 minutes'"))
        db.commit()
    [back] = fetcher.claim_server_batch(4, None)
    assert back["mode"] == "AUTO" and back["last_error"] == store.HANDED_SHELL_ERROR  # back to AUTO
    assert _get(la_db, "SELECT mode FROM lead_fetch_task")[0][0] == "AUTO"
    asyncio.run(fetcher.fetch_task(back))  # the extension is "online" but is not asked twice
    assert _get(la_db, "SELECT access FROM lead_org_page WHERE page_type = 'home'")[0][0] == "ok"
    assert _get(la_db, "SELECT status FROM lead_fetch_task WHERE page_type = 'home'")[0][0] == "DONE"


def test_a_shell_the_extension_asked_to_render_in_a_tab_is_still_handed_to_it(la_db, monkeypatch):
    # Only the server's own hand-off mark stops a second hand-off; the extension's "render in a tab" retry
    # of an AUTO task the server then claims still goes to an online extension, as before.
    _site(la_db, monkeypatch, "takshacademy.in", {"https://takshacademy.in/robots.txt": NO_ROBOTS,
                                                  "https://takshacademy.in/": (200, TAKSH_SHELL, HTML)}, mode="AUTO")
    _online_extension(la_db)
    [home] = _claim(la_db)
    home["last_error"] = "thin_page: render in a tab"
    assert asyncio.run(fetcher.fetch_task(home)).startswith("js_shell")
    assert _get(la_db, "SELECT mode, last_error FROM lead_fetch_task")[0] == ("LOCAL", store.HANDED_SHELL_ERROR)


def test_shells_handed_to_a_local_agents_extension_stay_with_it(la_db, monkeypatch):
    _site(la_db, monkeypatch, "takshacademy.in", {}, mode="AUTO")
    with la_db() as db:
        db.execute(text("UPDATE lead_fetch_task SET mode = 'LOCAL', last_error = :e, "
                        "updated_at = now() - interval '6 minutes'"), {"e": store.HANDED_SHELL_ERROR})
        db.execute(text("UPDATE lead_agent SET mode = 'LOCAL'"))
        db.commit()
    assert fetcher.claim_server_batch(4, None) == []


def test_a_job_post_is_read_under_its_boards_robots_txt(monkeypatch):
    import app.services.safe_http as safe_http

    monkeypatch.setattr(fetcher, "HOST_PAUSE_S", 0)
    post = "https://www.naukri.com/job-listings-counsellor-narayana-e-techno-school-hyderabad-1"
    web = _Web({
        "https://www.glassdoor.co.in/robots.txt": (200, "User-agent: *\nDisallow: /job-listing/\n", "text/plain"),
        "https://www.glassdoor.co.in/job-listing/x.htm": (200, "<html>post</html>", HTML),
        "https://www.naukri.com/robots.txt": NO_ROBOTS,
        post: (200, "<html><title>Counsellor</title></html>", HTML),
        "https://www.naukri.com/job-listings-gone": (404, "gone", HTML),
        "https://www.naukri.com/job-listings-pdf": (200, "%PDF", "application/pdf"),
        "https://in.indeed.com/robots.txt": NO_ROBOTS,
        "https://in.indeed.com/viewjob?jk=1": _err("timeout"),
    })
    monkeypatch.setattr(safe_http, "safe_fetch", web)
    state = {}

    def read(url):
        return asyncio.run(fetcher.read_post(url, state))

    assert read("https://www.glassdoor.co.in/job-listing/x.htm") is None  # robots.txt says no: never requested
    assert read(post) == "<html><title>Counsellor</title></html>"
    assert read("https://www.naukri.com/job-listings-gone") is None
    assert read("https://www.naukri.com/job-listings-pdf") is None
    assert read("https://in.indeed.com/viewjob?jk=1") is None
    assert web.urls() == [post, "https://www.naukri.com/job-listings-gone", "https://www.naukri.com/job-listings-pdf",
                          "https://in.indeed.com/viewjob?jk=1"]
    assert [u for u, _ in web.calls].count("https://www.naukri.com/robots.txt") == 1  # once per board a round
    assert all(h == fetcher.BROWSER_HEADERS for u, h in web.calls if not u.endswith("robots.txt"))
