"""pagefetch: raw HTML (server fetcher or Chrome extension) -> page record, and which pages to read."""

from __future__ import annotations

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.pagefetch import (
    MAX_LINKS, MAX_TEXT_CHARS, choose_pages, contact_pages, extraction_pages, parse_page, platform_page,
)

SITE = "https://www.alpha-academy.in/"


def page(html, status=200, url=SITE):
    return parse_page(url, url, html, status)


def test_text_reads_like_inner_text():
    html = """<html><head><title> Alpha  Academy </title><style>.x{color:red}</style>
    <script>var phone = "99999 99999";</script></head><body>
    <nav><a href="/">Home</a><a href="/about">About us</a></nav>
    <h1>Alpha
       Academy</h1><p>Call us<br>98450 12345</p>
    <div hidden>Old number 97000 00000</div><div style="display: none">Hidden text</div>
    <noscript>Enable JavaScript</noscript><svg><text>logo</text></svg>
    <ul><li>JEE</li><li>NEET</li></ul><table><tr><td>Fees</td><td>On request</td></tr></table>
    <p>   </p><span>Since</span> <span>2017</span></body></html>"""
    record = page(html)
    assert record["access"] == "ok" and record["title"] == "Alpha Academy"
    assert record["text"] == ("Home About us\nAlpha Academy\nCall us\n98450 12345\nJEE\nNEET\nFees\nOn request\n"
                              "Since 2017")
    assert "99999" not in record["text"] and "Hidden" not in record["text"] and "logo" not in record["text"]


def test_text_is_capped():
    record = page("<html><body>" + "<p>" + "x" * 1000 + "</p>" * 1 + "<p>word</p>" * 20_000 + "</body></html>")
    assert len(record["text"]) == MAX_TEXT_CHARS


def test_links_are_absolute_labelled_and_capped():
    html = """<html><head><base href="https://www.alpha-academy.in/site/"></head><body>
    <a href="contact">Contact</a><a href="/careers"><img alt="Careers"></a><a href="tel:+919845012345">Call</a>
    <a href="mailto:info@alpha-academy.in" aria-label="Email us"></a><a href="javascript:void(0)">Menu</a>
    <a href="#top">Top</a><a href="https://wa.me/919845012345">WhatsApp</a><a href="contact">Contact</a></body></html>"""
    links = page(html)["links"]
    assert links == [("https://www.alpha-academy.in/site/contact", "Contact"), ("https://www.alpha-academy.in/careers", "Careers"),
                     ("tel:+919845012345", "Call"), ("mailto:info@alpha-academy.in", "Email us"),
                     ("https://wa.me/919845012345", "WhatsApp")]
    many = page("<html><body>" + "".join(f'<a href="/p{i}">P{i}</a>' for i in range(600)) + "</body></html>")
    assert len(many["links"]) == MAX_LINKS


def test_enquiry_forms_need_a_field_to_type_into():
    assert page("<html><body><form><input name='n'><button>Send</button></form></body></html>")["has_form"]
    assert page("<html><body><form><textarea></textarea></form></body></html>")["has_form"]
    assert page("<html><body><form><input type='tel'></form></body></html>")["has_form"]
    assert not page("<html><body><form><input type='hidden' name='t'><input type='submit'></form></body></html>")["has_form"]
    assert not page("<html><body><input type='email'></body></html>")["has_form"]  # no form


def test_access_is_ok_blocked_error_or_not_html():
    assert page("<html></html>", 403)["access"] == "blocked"
    assert page("<html></html>", 429)["access"] == "blocked" and page("<html></html>", 405)["access"] == "blocked"
    assert page("<html></html>", 404)["access"] == "error" and page("<html></html>", 500)["error"] == "HTTP 500"
    cloudflare = "<html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Checking your browser</h1></body></html>"
    blocked = page(cloudflare)
    assert blocked["access"] == "blocked" and blocked["text"] == ""
    assert page("%PDF-1.7 binary")["access"] == "not_html"
    assert page('{"ok": true}')["access"] == "not_html"
    assert page("")["access"] == "error" and page(None)["access"] == "error"
    long_page = "<html><body><p>" + "Our captcha-free admissions process. " * 100 + "</p></body></html>"
    assert page(long_page)["access"] == "ok"  # a long page that mentions a marker is not a block page


def test_platform_hints_are_raw_markers_from_the_code():
    html = """<html><head><meta name="generator" content="WordPress 6.4.2">
    <script src="https://cdn-wl-assets.classplus.co/js/app.min.js?v=3"></script>
    <script src="/wp-content/themes/edu/main.js"></script>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script>(function(){var s=document.createElement('script');s.src='https://web-in21.mxradon.com/t/Tracker.js';})();</script>
    </head><body data-wf-site="abc"><iframe src="https://www.youtube.com/embed/x"></iframe>
    <img src="https://appx-content-v2.classx.co.in/slider/1.jpg"><form action="https://forms.zohopublic.in/x/form/Enquiry"><input></form>
    <a href="https://live.alpha-academy.in/courses">Courses</a><a href="https://other.com/">Partner</a></body></html>"""
    hints = page(html)["platform_hints"]
    assert hints[0] == "generator:WordPress 6.4.2"
    for hint in ("marker:wp-content", "marker:data-wf-site", "script:cdn-wl-assets.classplus.co/js",
                 "script:www.alpha-academy.in/wp-content/themes", "js:web-in21.mxradon.com", "iframe:www.youtube.com/embed/x",
                 "img:appx-content-v2.classx.co.in", "form:forms.zohopublic.in", "subdomain:live.alpha-academy.in",
                 "link:fonts.googleapis.com/css2"):
        assert hint in hints, hint
    assert not any("other.com" in h for h in hints)


HOME = {"url": SITE, "final_url": SITE, "links": [
    ("https://www.alpha-academy.in/courses", "Courses"),
    ("https://www.alpha-academy.in/about-us", "About"),
    ("https://www.alpha-academy.in/our-faculty", "Faculty"),
    ("https://www.alpha-academy.in/admissions", "Admissions"),
    ("https://www.alpha-academy.in/careers", "Careers"),
    ("https://www.alpha-academy.in/contact", "Contact"),
    ("https://www.alpha-academy.in/?ref=nav", "Careers"),
    ("https://www.alpha-academy.in/privacy-policy", "Privacy"),
    ("https://other-site.com/contact", "Partner"),
    ("https://www.alpha-academy.in/brochure.pdf", "Brochure"),
    ("https://blog.alpha-academy.in/", "Courses blog"),
    ("https://learn.alpha-academy.in/courses/jee-2027", "JEE 2027"),
    ("https://learn.alpha-academy.in/login", "Login"),
]}


def test_pages_follow_the_engines_rules_plus_one_platform_page():
    assert choose_pages(HOME) == [
        ("https://www.alpha-academy.in/contact", "contact"),
        ("https://www.alpha-academy.in/our-faculty", "team"),
        ("https://www.alpha-academy.in/careers", "careers"),
        ("https://learn.alpha-academy.in/", "platform"),
    ]
    assert choose_pages(HOME, max_pages=1) == [("https://www.alpha-academy.in/contact", "contact"),
                                              ("https://learn.alpha-academy.in/", "platform")]
    five = [t for _, t in choose_pages(HOME, max_pages=5)]
    assert five == ["contact", "team", "careers", "admissions", "about", "platform"]


def test_platform_pages_are_course_portals_on_a_subdomain_of_the_site():
    assert platform_page({"url": SITE, "links": [("https://blog.alpha-academy.in/", "Login")]}) is None
    assert platform_page({"url": SITE, "links": [("https://alpha.classplusapp.com/", "Our app")]}) is None  # another site
    assert platform_page({"url": SITE, "links": [("https://my2.alpha-academy.in/x", "Student Login")]}) == \
        "https://my2.alpha-academy.in/"
    assert platform_page({"url": SITE, "links": [("https://alpha-academy.in/", "Home")]}) is None


def test_records_feed_the_engines_contacts_and_extraction():
    pages = [{**page("<html><body><p>Admissions open</p><form><textarea></textarea></form></body></html>"), "page_type": "home"},
             {**page("<html></html>", 403, SITE + "contact"), "page_type": "contact"},
             {**page("<html><body><p>Support: 1800 000 000</p></body></html>", url="https://learn.alpha-academy.in/"),
              "page_type": "platform"},
             {**page("<html><body><p>Meena Iyer, Founder</p></body></html>", url=SITE + "about"), "page_type": "about"}]
    assert [p["page_type"] for p in contact_pages(pages)] == ["home", "about"]
    assert contact_pages(pages)[0]["has_form"] is True
    texts = extraction_pages(pages)
    assert [(p.id, p.page_type) for p in texts] == [(1, "home"), (2, "platform"), (3, "about")]


def test_an_empty_javascript_shell_is_reported_as_js_shell_not_ok():
    shell = ('<html><head><script src="/_next/static/a.js"></script></head>'
             '<body><div id="__next"></div><a href="/contact">Contact</a></body></html>')
    page = parse_page("https://shell.example.in/", "https://shell.example.in/", shell, 200)
    assert page["access"] == "js_shell"
    assert page["text"] == ""
    assert page["links"]  # kept: the shell's links still point at contact pages


def test_a_short_plain_page_without_scripts_stays_ok():
    page = parse_page("https://tiny.example.in/", "https://tiny.example.in/",
                      "<html><body><p>Tiny Tutorials, Indore. Call 98450 12345</p></body></html>", 200)
    assert page["access"] == "ok"
