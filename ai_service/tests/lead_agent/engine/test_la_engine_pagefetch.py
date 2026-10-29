"""pagefetch: raw HTML (server fetcher or Chrome extension) -> page record, and which pages to read."""

from __future__ import annotations

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.pagefetch import (
    MAX_LINKS, MAX_TEXT_CHARS, choose_pages, contact_pages, extraction_pages, job_post_facts, parse_page, platform_page,
    read_shell, refresh_url, shell_text,
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


# ------------------------------------------------------------- shells no browser renders (2026-10-29)
# Of the 237 "No readable page" rejects of "Leads for Vacademy", 71 home pages were JavaScript shells.

# Shaped like takshacademy.com: a React mount, the organisation's JSON-LD and a real <noscript>.
TAKSH_SHELL = """<html><head><title>Taksh Academy Vadodara \u2014 Best Coaching Classes in Manjalpur</title>
<meta name="description" content="Taksh Academy is Vadodara's coaching institute for Class 8, 9 and 10, CBSE and GSEB.">
<meta property="og:title" content="Taksh Academy Vadodara \u2014 Best Coaching Classes in Manjalpur">
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
  {"@type": "EducationalOrganization", "name": "Taksh Academy", "telephone": "+91 98250 12345",
   "email": "mailto:info@takshacademy.example",
   "address": {"@type": "PostalAddress", "streetAddress": "12 Shiv Complex", "addressLocality": "Vadodara",
               "addressRegion": "Gujarat", "postalCode": "390011"},
   "contactPoint": [{"@type": "ContactPoint", "telephone": "+91 265 123 4567", "contactType": "admissions"}]},
  {"@type": "Person", "name": "Ravi Shah", "telephone": "+91 90000 00001"}]}</script>
<script type="application/ld+json">{"broken": </script>
<script src="/static/js/main.js"></script></head>
<body><div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript>
<noscript><h1>Taksh Academy</h1><p>Coaching for Class 8-10 in Manjalpur and Tarsali, Vadodara.</p></noscript>
</body></html>"""


def test_a_shell_is_read_for_what_its_html_carries():
    record = parse_page("https://www.takshacademy.example/", "https://www.takshacademy.example/", TAKSH_SHELL, 200)
    assert record["access"] == "js_shell"
    page = read_shell(record, TAKSH_SHELL)
    assert page["access"] == "ok" and page["error"] is None
    text = page["text"]
    assert text.splitlines()[0].startswith("Taksh Academy Vadodara")
    assert "CBSE and GSEB" in text  # the description
    assert "Telephone: +91 98250 12345" in text and "Telephone: +91 265 123 4567" in text
    assert "Email: info@takshacademy.example" in text
    assert "Address: 12 Shiv Complex, Vadodara, Gujarat, 390011" in text
    assert "Coaching for Class 8-10 in Manjalpur" in text  # the real <noscript>
    assert "enable JavaScript" not in text  # the framework's notice is not the organisation's words
    assert "Ravi Shah" not in text and "90000 00001" not in text  # a person in the JSON-LD is not the organisation
    assert text.count("Taksh Academy Vadodara") == 1  # og:title repeats the title: kept once
    # its numbers reach the contacts the engine extracts from readable pages
    assert contact_pages([{**page, "page_type": "home"}])[0]["text"] == text


def test_a_page_hidden_until_its_scripts_run_is_read_from_its_html():
    """raycoaching.in, oneaim.co.in: the whole page sits in a hidden wrapper until the scripts show it."""
    html = ('<html><head><title>Ray Coaching Classes</title>' + '<script src="/a.js"></script>' * 4 + '</head><body>'
            '<div class="preloader">Loading...</div><div id="page" style="display:none">'
            '<h1>Ray Coaching Classes, Noida</h1><p>CBSE coaching for classes I to XII since 2009, Sector 62.</p>'
            '<footer>Call 98100 12345 | raycoaching@example.in</footer></div></body></html>')
    record = parse_page("https://raycoaching.example/", "https://raycoaching.example/", html, 200)
    assert record["access"] == "js_shell"
    page = read_shell(record, html)
    assert page["access"] == "ok"
    assert "CBSE coaching for classes I to XII" in page["text"] and "98100 12345" in page["text"]


def test_a_shell_that_says_nothing_stays_a_shell_unless_it_links_a_phone():
    bare = ('<html><head><title>Sigma IT Academy</title><script src="/a.js"></script></head>'
            '<body><div id="root"></div><noscript>Please enable JavaScript to continue.</noscript></body></html>')
    record = parse_page("https://sigma.example/", "https://sigma.example/", bare, 200)
    assert shell_text(bare) == "Sigma IT Academy"
    assert read_shell(record, bare) is record  # unchanged: still js_shell, still unreadable
    calls = bare.replace('<div id="root"></div>', '<div id="root"></div><a href="tel:+919812345678">Call</a>')
    record = parse_page("https://sigma.example/", "https://sigma.example/", calls, 200)
    assert record["access"] == "js_shell" and read_shell(record, calls)["access"] == "ok"
    # pages that are not shells are never touched
    ok = parse_page(SITE, SITE, "<html><body><p>Tiny Tutorials, Indore. Call 98450 12345</p></body></html>", 200)
    assert read_shell(ok, "<html></html>") is ok


def test_a_meta_refresh_says_where_an_empty_page_moved():
    moved = ('<html><head><meta http-equiv="refresh" content="0;url=https://sxcran.ac.in" />'
             "<title>Welcome to St. Xavier's College, Ranchi</title></head><body></body></html>")
    assert refresh_url(moved, "https://www.sxcran.org/") == "https://sxcran.ac.in"
    assert refresh_url("<meta http-equiv='refresh' content='0; URL=index.php'>",
                       "https://www.unicodetechnologies.example/") == "https://www.unicodetechnologies.example/index.php"
    assert refresh_url('<meta http-equiv="Refresh" content="5">', SITE) is None  # reloads itself
    assert refresh_url('<meta http-equiv="refresh" content="60;url=/news">', SITE) is None  # a slow slideshow
    assert refresh_url('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', SITE) is None
    assert refresh_url(f'<meta http-equiv="refresh" content="0;url={SITE}">', SITE) is None
    assert refresh_url("<html><body>No refresh</body></html>", SITE) is None


# ------------------------------------------------------------------------- job post pages

def _post(job: str) -> str:
    return (f'<html><head><title>Admission Counsellor job</title><script type="application/ld+json">{job}</script>'
            '</head><body><div id="app"></div></body></html>')


def test_a_job_posts_employer_and_places_come_from_its_structured_data():
    pathfinder = _post("""{"@context": "https://schema.org/", "@type": "JobPosting", "title": "Admission Counsellor",
        "hiringOrganization": {"@type": "Organization", "name": "The Pathfinder School"},
        "jobLocation": {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": "Kaladhungi",
                        "addressRegion": "Uttarakhand", "addressCountry": "IN"}}}""")
    assert job_post_facts(pathfinder) == {"organisation": "The Pathfinder School",
                                          "locations": ["Kaladhungi, Uttarakhand"], "remote": False}
    narayana = _post("""[{"@type": "BreadcrumbList"}, {"@type": ["JobPosting"], "hiringOrganization": "Narayana e-Techno School",
        "jobLocation": [{"address": {"addressLocality": "Hyderabad", "addressRegion": "Telangana"}},
                        {"address": "Kukatpally, Hyderabad"}]}]""")
    assert job_post_facts(narayana) == {"organisation": "Narayana e-Techno School",
                                        "locations": ["Hyderabad, Telangana", "Kukatpally, Hyderabad"], "remote": False}
    remote = _post("""{"@type": "JobPosting", "hiringOrganization": {"name": "Confidential"},
        "jobLocationType": "TELECOMMUTE"}""")
    assert job_post_facts(remote) == {"organisation": None, "locations": [], "remote": True}
    # A page without JobPosting data names nobody for certain, whatever its wording says.
    empty = {"organisation": None, "locations": [], "remote": False}
    assert job_post_facts("<html><title>Narayana e-Techno School hiring Counsellor</title></html>") == empty
    assert job_post_facts(_post('{"@type": "Organization", "name": "Glassdoor"}')) == empty
    assert job_post_facts("") == empty
