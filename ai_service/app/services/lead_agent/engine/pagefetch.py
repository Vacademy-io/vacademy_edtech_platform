"""Turning a page's raw HTML into the page record the engine reads, and choosing which pages of a
site to read.

The HTML comes from the server fetcher or from the Chrome extension (spec §4.1); both go through
parse_page, so a page reads the same whoever fetched it. It replaces the engine's research/fetch.py,
which read pages in a Playwright browser (innerText, links, forms, block-page detection); the rules
are kept: text like innerText, block pages and bot refusals marked "blocked", at most 60,000
characters of text.

Also: what a JavaScript shell's HTML still carries when no browser renders it (read_shell), where an
empty page's meta refresh points (refresh_url), and a job post's employer and places from its
structured data (job_post_facts).

No network here: robots.txt, SSRF checks (research/url_guard.py) and politeness are the fetcher's.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any
from urllib.parse import urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup, CData, Comment, Declaration, Doctype, NavigableString, ProcessingInstruction, Tag

from .discovery.domains import registered_domain
from .fingerprint import tokens_in
from .research.extract import PageText
from .research.pages import candidate_links

MAX_TEXT_CHARS = 60_000
MAX_LINKS = 400
MAX_HINTS = 300
# The engine's markers for a verification or refusal page shown instead of the site (research/fetch.py).
BLOCK_MARKERS = ("verify you are human", "checking your browser", "captcha", "access denied", "attention required")
BLOCK_PAGE_MAX_CHARS = 1_500
# Less visible text than this, plus a framework mount node or this many scripts = a JavaScript shell.
JS_SHELL_MAX_CHARS = 300
JS_SHELL_MIN_SCRIPTS = 3
# 405 from a page GET is how several bot-protection services refuse automated browsers.
BLOCKED_STATUS = frozenset({401, 403, 405, 429, 451})

_DROP_TAGS = ("script", "style", "noscript", "svg", "template", "iframe", "object", "canvas")
# Elements that start a new line in innerText.
_BLOCK_TAGS = ("p", "div", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th",
               "table", "section", "header", "footer", "article", "nav", "main", "aside", "form", "blockquote", "pre",
               "address", "figure", "figcaption", "fieldset", "legend", "hr")
_SPACED_TAGS = ("a", "button", "label", "input", "select", "img")
_BLOCK_SET = frozenset(_BLOCK_TAGS)
_SPACED_SET = frozenset(_SPACED_TAGS)
_SKIPPED_STRINGS = (Comment, Declaration, Doctype, ProcessingInstruction, CData)
_LINE = "\u2029"  # placeholder for a line break while the text is collected
_SPACES = re.compile("[ \\t\\r\\n\\f\\v\u00a0\u200b\u200c\u200d\u2028\ufeff]+")
_HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.I)
_TEXT_INPUTS = {"", "text", "email", "tel", "number", "search"}
_URL_IN_CODE = re.compile(r"(?:https?:)?//([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[/:\"'?#\s\\]|$)", re.I)


def _base_url(soup: BeautifulSoup, page_url: str) -> str:
    base = soup.find("base", href=True)
    return urljoin(page_url, base["href"].strip()) if isinstance(base, Tag) else page_url


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _short(url: str) -> str:
    """'https://cdn.x.com/a/b/c.js?v=1' -> 'cdn.x.com/a/b': enough to tell platforms apart, few hints."""
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p][:2]
    if parts and "." in parts[-1]:
        parts = parts[:-1]  # a file name directly under the host
    return (parsed.hostname or "").lower() + ("/" + "/".join(parts) if parts else "")


def _bare(host: str) -> str:
    return host[4:] if host.startswith("www.") else host


def _hints(soup: BeautifulSoup, base: str) -> list[str]:
    """Raw platform markers, read before scripts are dropped (see fingerprint.detect_platforms)."""
    page_host = _host(base)
    site = registered_domain(base)
    hints: list[str] = []
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or "").lower()
        content = " ".join((meta.get("content") or "").split())
        if name == "generator" and content:
            hints.append(f"generator:{content[:80]}")
        elif content.startswith(("http://", "https://", "//")):
            hints.append(f"meta:{_host(urljoin(base, content))}")

    code: list[str] = []  # attribute names and values plus inline scripts, for vendor tokens
    for tag in soup.find_all(True):
        for attr, value in tag.attrs.items():
            values = value if isinstance(value, list) else [value]
            code.append(attr)
            code.extend(str(v) for v in values)
        if tag.name == "script" and not tag.get("src"):
            inline = tag.string or tag.get_text() or ""
            code.append(inline)
            for host in _URL_IN_CODE.findall(inline[:200_000]):
                host = host.lower()
                if _bare(host) != _bare(page_host):
                    hints.append(f"js:{host}")
    hints.extend(f"marker:{token}" for token in tokens_in("\n".join(code)))

    for kind, selector, attr in (("script", "script", "src"), ("link", "link", "href"), ("iframe", "iframe", "src"),
                                 ("img", "img", "src"), ("img", "img", "data-src"), ("media", "source", "src"),
                                 ("media", "video", "src")):
        for tag in soup.find_all(selector):
            value = (tag.get(attr) or "").strip()
            if not value or value.startswith(("data:", "blob:", "javascript:")):
                continue
            url = urljoin(base, value)
            hints.append(f"{kind}:{_host(url) if kind in ('img', 'media') else _short(url)}")
    for form in soup.find_all("form"):
        action = (form.get("action") or "").strip()
        if action and not action.startswith(("#", "javascript:")):
            host = _host(urljoin(base, action))
            if host and _bare(host) != _bare(page_host):
                hints.append(f"form:{host}")
    for a in soup.find_all("a", href=True):
        url = urljoin(base, a["href"].strip())
        host = _host(url)
        if host and site and _bare(host) != _bare(page_host) and registered_domain(url) == site:
            hints.append(f"subdomain:{host}")
    ordered = list(dict.fromkeys(h for h in hints if not h.endswith(":")))
    ordered.sort(key=lambda h: 0 if h.startswith(("generator:", "marker:")) else 1)
    return ordered[:MAX_HINTS]


def platform_hints_from_html(html: str, url: str) -> list[str]:
    """The platform hints parse_page would record for this HTML."""
    soup = BeautifulSoup(html, "html.parser")
    return _hints(soup, _base_url(soup, url))


def _is_hidden(tag: Tag) -> bool:
    return tag.has_attr("hidden") or bool(_HIDDEN_STYLE.search(tag.get("style") or ""))


def _visible_text(soup: BeautifulSoup, keep_hidden: bool = False) -> str:
    """Text as a browser's innerText gives it: a new line at block elements, spaces collapsed, blank
    lines dropped, scripts, styles and hidden elements left out (hidden ones kept with keep_hidden).
    One pass over the tree, which is not modified (inserting markers into BeautifulSoup is quadratic
    on long sibling lists)."""
    root = soup.body or soup
    out: list[str] = []
    stack: list[tuple[Any, str | None]] = [(root, None)]
    while stack:
        node, closing = stack.pop()
        if closing is not None:
            out.append(closing)
            continue
        if isinstance(node, NavigableString):
            if not isinstance(node, _SKIPPED_STRINGS):
                out.append(str(node))
            continue
        if not isinstance(node, Tag) or node.name in _DROP_TAGS or (not keep_hidden and _is_hidden(node)):
            continue
        if node.name == "br":
            out.append(_LINE)
            continue
        mark = _LINE if node.name in _BLOCK_SET else " " if node.name in _SPACED_SET else None
        if mark:
            out.append(mark)
            stack.append((None, mark))
        stack.extend((child, None) for child in reversed(node.contents))
    raw = _SPACES.sub(" ", "".join(out))
    lines = (" ".join(line.split()) for line in raw.split(_LINE))
    return "\n".join(line for line in lines if line)


def _links(soup: BeautifulSoup, base: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "data:")):
            continue
        url = urljoin(base, href)
        label = " ".join(a.get_text(" ", strip=True).split())
        if not label:
            img = a.find("img", alt=True)
            label = (a.get("aria-label") or a.get("title") or (img["alt"] if isinstance(img, Tag) else "") or "").strip()
        item = (url, " ".join(label.split())[:120])
        if item not in seen:
            seen.add(item)
            links.append(item)
            if len(links) >= MAX_LINKS:
                break
    return links


def _has_form(soup: BeautifulSoup) -> bool:
    """A form someone can type an enquiry into (a text, email or phone field, or a message box)."""
    for form in soup.find_all("form"):
        if form.find("textarea"):
            return True
        if any((i.get("type") or "").lower() in _TEXT_INPUTS for i in form.find_all("input")):
            return True
    return False


def _looks_like_html(html: str) -> bool:
    head = html[:2_000].lstrip().lower()
    if head.startswith(("%pdf", "{", "[")):
        return False
    return "<" in head and bool(re.search(r"<(?:!doctype|html|head|body|div|p|a|span|meta|title|script)\b", html[:20_000], re.I))


def parse_page(url: str, final_url: str, html: str, status_code: int | None) -> dict:
    """{"url", "final_url", "status_code", "access", "title", "text", "links": [(href, text)],
    "has_form", "platform_hints": [...], "error"}.

    access: ok | blocked (a refusal status 401/403/405/429/451, or a verification page) | error
    (other status >= 400, or no content) | not_html. Text, links and hints are kept only for ok pages
    (hints also for blocked ones: a vendor's bot wall is still a marker)."""
    final = (final_url or url or "").strip()
    record: dict[str, Any] = {"url": url, "final_url": final, "status_code": status_code, "access": "ok", "title": "",
                              "text": "", "links": [], "has_form": False, "platform_hints": [], "error": None}
    if status_code is not None and status_code >= 400:
        record.update(access="blocked" if status_code in BLOCKED_STATUS else "error", error=f"HTTP {status_code}")
        return record
    if not isinstance(html, str) or not html.strip():
        record.update(access="error", error="Empty page")
        return record
    if not _looks_like_html(html):
        record.update(access="not_html", error="Not an HTML page")
        return record

    script_count = html.lower().count("<script")
    soup = BeautifulSoup(html, "html.parser")
    js_mount = bool(soup.select_one("#__next, #root, #app, #__nuxt, [ng-version], app-root"))
    base = _base_url(soup, final)
    hints = _hints(soup, base)
    title = soup.title.get_text(" ", strip=True)[:200] if soup.title else ""
    links = _links(soup, base)
    has_form = _has_form(soup)
    text = _visible_text(soup)[:MAX_TEXT_CHARS]

    record["title"] = " ".join(title.split())
    lowered = text.lower()
    if len(text) < BLOCK_PAGE_MAX_CHARS and any(marker in lowered for marker in BLOCK_MARKERS):
        record.update(access="blocked", error="The site showed a verification page", platform_hints=hints)
        return record
    if len(text.strip()) < JS_SHELL_MAX_CHARS and (js_mount or script_count >= JS_SHELL_MIN_SCRIPTS):
        # Built in the browser: the HTML is an empty shell. Callers retry it as a rendered page
        # (the extension's tab mode); links and hints are kept since the shell often carries them.
        record.update(access="js_shell", error="The page is built by JavaScript and needs a browser to read",
                      links=links, has_form=has_form, platform_hints=hints)
        return record
    record.update(text=text, links=links, has_form=has_form, platform_hints=hints)
    return record


# ----------------------------------------------------------------------- what a shell still carries

# A JavaScript shell no browser will render (no extension online in time, or the extension's tab
# gave a shell too) is still read for what its server HTML carries. Of the 237 "No readable page"
# rejects of "Leads for Vacademy", 71 home pages were shells (2026-10-29 probe): most still had a
# title and description, many an organisation's JSON-LD with a telephone, a <noscript> text, a tel:
# link, or the whole page hidden until its scripts run (raycoaching.in, oneaim.co.in).
SHELL_MIN_CHARS = 80  # text besides the title before a shell counts as readable
_LD_JSON = re.compile(r"ld\+json", re.I)
_META_TEXT = ("description", "og:title", "og:description", "og:site_name", "twitter:description")
# "You need to enable JavaScript to run this app.": a framework's notice, not the organisation's words.
_NO_JS_NOTICE = re.compile(r"\b(?:enable|turn on|allow)\s+javascript\b|\bjavascript\s+(?:is\s+)?(?:disabled|required)\b",
                           re.I)
_LD_CONTACT_KEYS = ("telephone", "email", "address", "contactPoint")
_LD_NOT_ORG = frozenset({"person", "jobposting", "contactpoint", "postaladdress", "place", "geocoordinates"})


def _ld_objects(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """Every object in the page's JSON-LD blocks, nested ones included (@graph, lists, values)."""
    found: list[dict[str, Any]] = []

    def walk(value: Any, depth: int) -> None:
        if depth > 6 or len(found) >= 300:
            return
        if isinstance(value, dict):
            found.append(value)
            for item in value.values():
                walk(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                walk(item, depth + 1)

    for tag in soup.find_all("script", type=_LD_JSON):
        raw = (tag.string or tag.get_text() or "").strip()
        raw = raw.removeprefix("<!--").removesuffix("-->").replace("<![CDATA[", "").replace("]]>", "").strip()
        try:
            walk(json.loads(raw), 0)
        except (ValueError, RecursionError):
            continue  # one broken block (trailing commas are common) does not hide the others
    return found


def _ld_types(obj: dict[str, Any]) -> set[str]:
    kinds = obj.get("@type")
    return {str(k).lower() for k in (kinds if isinstance(kinds, list) else [kinds]) if k}


def _ld_text(value: Any) -> str:
    """A JSON-LD value as plain text: a string, a {"name": ...} object, or a PostalAddress."""
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, list):
        return ", ".join(t for t in (_ld_text(v) for v in value) if t)
    if isinstance(value, dict):
        if value.get("name") and not any(k.startswith("address") for k in value):
            return _ld_text(value["name"])
        parts = (value.get(k) for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode",
                                        "addressCountry"))
        return ", ".join(t for t in (_ld_text(p) for p in parts) if t)
    return ""


def _ld_contact_lines(soup: BeautifulSoup) -> list[str]:
    """The organisation's name, telephone, email and address from its JSON-LD (Organization,
    LocalBusiness, School, ...: any object carrying contact details that is not a person or a job)."""
    lines: list[str] = []
    for obj in _ld_objects(soup):
        kinds = _ld_types(obj)
        if kinds & _LD_NOT_ORG or not any(obj.get(k) for k in _LD_CONTACT_KEYS):
            continue
        if name := _ld_text(obj.get("name")):
            lines.append(name)
        points = obj.get("contactPoint")
        for holder in [obj, *(points if isinstance(points, list) else [points])]:
            if not isinstance(holder, dict):
                continue
            for key, label in (("telephone", "Telephone"), ("email", "Email"), ("address", "Address")):
                if value := _ld_text(holder.get(key)):
                    lines.append(f"{label}: {value.removeprefix('mailto:')}")
    return lines


def shell_text(html: str) -> str:
    """What a JavaScript shell's server HTML carries for a reader without a browser, one item a line:
    its title, description and og: tags, the organisation's JSON-LD (name, telephone, email, address),
    <noscript> text other than a "please enable JavaScript" notice, and the text of the page as
    served, hidden parts included (some pages show their content only once their scripts run)."""
    if not isinstance(html, str) or not html.strip():
        return ""
    soup = BeautifulSoup(html, "html.parser")
    lines: list[str] = []
    if soup.title:
        lines.append(soup.title.get_text(" ", strip=True))
    for meta in soup.find_all("meta"):
        key = (meta.get("name") or meta.get("property") or "").lower()
        if key in _META_TEXT:
            lines.append(meta.get("content") or "")
    lines.extend(_ld_contact_lines(soup))
    for tag in soup.find_all("noscript"):
        words = " ".join(tag.get_text(" ", strip=True).split())
        if words and not (len(words) < 200 and _NO_JS_NOTICE.search(words)):
            lines.append(words)
    kept = dict.fromkeys(" ".join(line.split()) for line in lines)
    kept[_visible_text(soup, keep_hidden=True)] = None
    return "\n".join(line for line in kept if line)[:MAX_TEXT_CHARS]


def read_shell(record: dict[str, Any], html: str) -> dict[str, Any]:
    """A js_shell record no browser will render, made readable from shell_text: access "ok" with that
    text when it says more than the title (SHELL_MIN_CHARS) or the shell links to a phone or email;
    otherwise the record as it was."""
    if record.get("access") != "js_shell":
        return record
    text = shell_text(html)
    beyond_title = len(text) - len(record.get("title") or "")
    calls = any(str(href).lower().startswith(("tel:", "mailto:")) for href, _ in record.get("links") or [])
    if beyond_title < SHELL_MIN_CHARS and not calls:
        return record
    return {**record, "access": "ok", "text": text, "error": None}


_REFRESH = re.compile(r"^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?['\"]?([^'\"]*)", re.I)


def refresh_url(html: str, base_url: str) -> str | None:
    """Where an almost empty page's <meta http-equiv="refresh"> sends the browser within 10 seconds
    (sxcran.org -> sxcran.ac.in, 2026-10-29), as an absolute http(s) URL; None when it has none."""
    if not isinstance(html, str) or "refresh" not in html[:20_000].lower():
        return None
    soup = BeautifulSoup(html[:20_000], "html.parser")
    meta = soup.find("meta", attrs={"http-equiv": re.compile(r"^\s*refresh\s*$", re.I)})
    match = _REFRESH.match(str(meta.get("content") or "")) if isinstance(meta, Tag) else None
    if not match or not match.group(2).strip() or float(match.group(1) or 0) > 10:
        return None
    target = urljoin(base_url, match.group(2).strip())
    return target if urlparse(target).scheme in ("http", "https") and urldefrag(target)[0] != urldefrag(base_url)[0] else None


# ------------------------------------------------------------------------------- job post pages

_UNNAMED_EMPLOYERS = re.compile(r"^(?:confidential|company confidential|undisclosed|not disclosed|hidden|private|"
                                r"anonymous|n/?a|-)$", re.I)


def job_post_facts(html: str) -> dict[str, Any]:
    """The hiring organisation and the job's places from a job post page's JobPosting structured data
    (JSON-LD, which job boards publish for search engines): {"organisation": "Narayana e-Techno School",
    "locations": ["Kaladhungi, Uttarakhand"], "remote": False}. Nothing is guessed from the wording:
    a page without that data gives None and [] (it names nobody for certain)."""
    facts: dict[str, Any] = {"organisation": None, "locations": [], "remote": False}
    if not isinstance(html, str) or not html.strip():
        return facts
    soup = BeautifulSoup(html, "html.parser")
    post = next((o for o in _ld_objects(soup) if "jobposting" in _ld_types(o)), None)
    if post is None:
        return facts  # the first JobPosting is the page's own post; later ones are "similar jobs"
    employer = post.get("hiringOrganization")
    name = _ld_text(employer.get("name") if isinstance(employer, dict) else employer)
    if name and not _UNNAMED_EMPLOYERS.match(name):
        facts["organisation"] = name[:200]
    places = post.get("jobLocation")
    locations: list[str] = []
    for place in places if isinstance(places, list) else [places]:
        address = place.get("address") if isinstance(place, dict) else place
        if isinstance(address, dict):
            parts = [_ld_text(address.get(k)) for k in ("addressLocality", "addressRegion")]
            text = ", ".join(p for p in parts if p)
        else:
            text = _ld_text(address)
        if text:
            locations.append(text)
    facts["locations"] = list(dict.fromkeys(locations))
    facts["remote"] = "telecommute" in str(post.get("jobLocationType") or "").lower()
    return facts


# ------------------------------------------------------------------------------ choosing pages

# Page types read after the home page, in slot order (Himang's research/pages.py rules): contact
# (published phone and email), team or about (owners and heads), careers or admissions (hiring and
# admissions signals).
SLOTS: tuple[tuple[str, ...], ...] = (("contact",), ("team", "about"), ("careers", "admissions"), ("admissions",),
                                      ("about", "team"))
PAGE_TYPES = ("contact", "team", "about", "careers", "admissions")
# Sub-domain labels (or link texts) that mark a course portal or app, e.g. live.winnersinstitute.in,
# which runs on Appx: the platform's markers are on that page, not on the marketing site.
PLATFORM_LABELS = frozenset({"live", "learn", "learning", "courses", "course", "app", "apps", "portal", "online",
                             "student", "students", "lms", "elearning", "classroom", "study", "my"})
_PLATFORM_TEXT = re.compile(r"\b(?:courses?|login|log in|sign in|app|portal|lms|student\s+zone|student\s+login|"
                            r"start\s+learning|online\s+(?:classes|courses|batch(?:es)?)|live\s+classes)\b", re.I)
_NOT_PLATFORM = frozenset({"blog", "mail", "webmail", "cdn", "static", "assets", "img", "images", "media", "shop",
                           "store", "careers", "jobs", "news", "docs", "help", "support", "status", "api"})


def platform_page(home: dict[str, Any]) -> str | None:
    """The one sub-domain of the site, linked from the home page, that looks like its course portal
    or app (by its host label or the link's text), as that sub-domain's root URL."""
    base = home.get("final_url") or home.get("url") or ""
    site = registered_domain(base)
    page_host = _bare(_host(base))
    if not site:
        return None
    votes: Counter[str] = Counter()
    schemes: dict[str, str] = {}
    for href, text in home.get("links") or home.get("links_json") or []:
        parsed = urlparse(href)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in ("http", "https") or not host or _bare(host) in (page_host, site):
            continue
        if registered_domain(href) != site:
            continue
        label = host[: -len(site) - 1] if host.endswith("." + site) else host
        words = set(re.split(r"[.\-]", label))
        if words & _NOT_PLATFORM:
            continue
        if words & PLATFORM_LABELS:
            votes[host] += 3
        elif _PLATFORM_TEXT.search(text or ""):
            votes[host] += 1
        else:
            continue
        schemes.setdefault(host, parsed.scheme)
    if not votes:
        return None
    host = votes.most_common(1)[0][0]
    return f"{schemes[host]}://{host}/"


def choose_pages(home: dict, max_pages: int = 3) -> list[tuple[str, str]]:
    """[(url, page_type)] to read after the home page: up to max_pages of contact / team / about /
    careers / admissions on the same registered domain, plus at most one "platform" page (the
    course portal or app sub-domain, see platform_page)."""
    base = home.get("final_url") or home.get("url") or ""
    site = registered_domain(base)
    grouped = candidate_links(list(home.get("links") or home.get("links_json") or []), site)
    used = {urldefrag(base)[0].rstrip("/"), urldefrag(home.get("url") or "")[0].rstrip("/")}
    home_page = (_bare(_host(base)), urlparse(base).path.rstrip("/"))

    def fresh(url: str) -> bool:
        # Not the home page again, also not with only a query string added ("/?lu=lv" labelled Careers).
        return url.rstrip("/") not in used and (_bare(_host(url)), urlparse(url).path.rstrip("/")) != home_page

    chosen: list[tuple[str, str]] = []
    for slot in SLOTS:
        if len(chosen) >= max_pages:
            break
        for page_type in slot:
            url = next((u for u in grouped.get(page_type, []) if fresh(u)), None)
            if url:
                chosen.append((url, page_type))
                used.add(url.rstrip("/"))
                break
    portal = platform_page(home)
    if portal and portal.rstrip("/") not in used:
        chosen.append((portal, "platform"))
    return chosen


# --------------------------------------------------------------------------- page records -> engine

def _links_of(page: dict[str, Any]) -> list[tuple[str, str]]:
    return [(h, t) for h, t in (page.get("links") or page.get("links_json") or [])]


def contact_pages(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The readable pages in the shape research.contacts.extract_contacts takes
    ({"url", "text", "links", "has_form", "page_type"}). Platform pages are left out: a course
    portal's numbers and emails are often the vendor's support lines."""
    return [{"url": p.get("final_url") or p["url"], "text": p.get("text") or "", "links": _links_of(p),
             "has_form": bool(p.get("has_form")), "page_type": p.get("page_type") or "other"}
            for p in pages if (p.get("access") or "ok") == "ok" and p.get("page_type") != "platform"]


def extraction_pages(pages: list[dict[str, Any]]) -> list[PageText]:
    """The readable pages as numbered PageText for research.extract.build_extraction_prompt and
    research.lead.build_lead (ids 1, 2, ... in the given order; home first)."""
    readable = [p for p in pages if (p.get("access") or "ok") == "ok" and (p.get("text") or "").strip()]
    return [PageText(i, p.get("final_url") or p["url"], p.get("page_type") or "other", p.get("title") or "",
                     p.get("text") or "")
            for i, p in enumerate(readable, start=1)]


_CLOSED_MARKERS = (
    "no longer accepting applications", "job has expired", "this job has expired", "job is closed",
    "this job is no longer available", "position has been filled", "job not found", "no longer available",
    "this job has been closed", "applications closed",
)


def job_post_status(page: dict[str, Any]) -> str:
    """'live', 'removed' (gone or marked closed), 'blocked' or 'error' for a job-post page record
    (research/fetch.py's rule, on a parse_page record)."""
    access = page.get("access") or "error"
    if access in ("robots_disallowed", "blocked", "unsafe_url"):
        return "blocked"
    if page.get("status_code") in (404, 410):
        return "removed"
    if access != "ok":
        return "error"
    lowered = (page.get("text") or "").lower()
    return "removed" if any(marker in lowered for marker in _CLOSED_MARKERS) else "live"
