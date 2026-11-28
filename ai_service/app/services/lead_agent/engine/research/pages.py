"""Choosing which of an organisation's pages to read.

Only a handful of pages are read, picked from the homepage's links by what they are about.
With the default of 4 pages: home, contact (published phone and email), team or about
(owners and heads), then careers or admissions (hiring and admissions signals).
"""

from __future__ import annotations

from urllib.parse import urldefrag, urlparse

from ..discovery.domains import registered_domain

PAGE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "contact": ("contact", "reach-us", "reach us", "get-in-touch", "get in touch", "enquiry", "enquire", "inquiry"),
    "team": ("team", "faculty", "faculties", "management", "leadership", "founder", "director", "our-people",
             "mentors", "teachers", "board"),
    "about": ("about", "who-we-are", "who we are", "our-story", "our story", "overview", "why-us", "why us"),
    "careers": ("career", "jobs", "hiring", "join-us", "join us", "join-our-team", "vacanc", "recruit", "work-with-us"),
    "admissions": ("admission", "enrol", "enroll", "apply", "registration", "register", "fee", "scholarship"),
    "courses": ("course", "program", "programme", "batch", "classroom", "test-series", "test series"),
    "branches": ("branch", "centres", "centers", "centre", "center", "locations", "campus"),
    "news": ("news", "blog", "event", "announcement", "result", "topper", "achievement"),
}
# Slots filled in order; each takes the first page type in its group that the site has.
SLOTS: tuple[tuple[str, ...], ...] = (
    ("contact",),
    ("team", "about"),
    ("careers", "admissions"),
    ("admissions", "courses"),
    ("about", "team"),
    ("courses", "branches"),
    ("branches", "news"),
    ("news",),
)
_SKIP_WORDS = ("login", "signin", "sign-in", "cart", "checkout", "privacy", "terms", "policy", "cookie", "disclaimer",
               "wp-admin", "feed", "sitemap", "download")
_SKIP_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".zip", ".doc", ".docx", ".xls",
                    ".xlsx", ".ppt", ".pptx", ".mp4", ".mp3")


def classify(url: str, text: str) -> str | None:
    """The page type a link points to, judged from its URL path and link text."""
    path = urlparse(url).path.lower()
    label = text.lower()
    for page_type, words in PAGE_KEYWORDS.items():
        if any(word in path for word in words) or any(word in label for word in words if " " in word or len(word) > 4):
            return page_type
    return None


def candidate_links(links: list[tuple[str, str]], site_domain: str | None) -> dict[str, list[str]]:
    """Same-site links grouped by page type, in page order, without duplicates."""
    grouped: dict[str, list[str]] = {}
    seen: set[str] = set()
    for href, text in links:
        url = urldefrag(href)[0]
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or url in seen:
            continue
        lowered = url.lower()
        if lowered.endswith(_SKIP_EXTENSIONS) or any(word in lowered for word in _SKIP_WORDS):
            continue
        if site_domain and registered_domain(url) != site_domain:
            continue
        page_type = classify(url, text)
        if page_type:
            seen.add(url)
            grouped.setdefault(page_type, []).append(url)
    for urls in grouped.values():
        urls.sort(key=lambda u: len(urlparse(u).path))  # prefer the section page over deep pages
    return grouped


def choose_pages(homepage_url: str, links: list[tuple[str, str]], site_domain: str | None,
                 max_pages: int) -> list[tuple[str, str]]:
    """[(page_type, url)] to read after the homepage, at most max_pages - 1 of them."""
    grouped = candidate_links(links, site_domain)
    home = urldefrag(homepage_url)[0].rstrip("/")
    chosen: list[tuple[str, str]] = []
    used: set[str] = {home}
    for slot in SLOTS:
        if len(chosen) >= max_pages - 1:
            break
        for page_type in slot:
            url = next((u for u in grouped.get(page_type, []) if u.rstrip("/") not in used), None)
            if url:
                chosen.append((page_type, url))
                used.add(url.rstrip("/"))
                break
    return chosen
