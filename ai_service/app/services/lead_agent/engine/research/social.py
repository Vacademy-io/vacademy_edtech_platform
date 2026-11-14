"""An organisation's own social pages, and LinkedIn pages found through web search results.

Social pages come from links on the organisation's own website, so they cost nothing. LinkedIn
itself is never opened or logged into: a person's or company's LinkedIn page is only ever taken
from a web search result whose title names them.
"""

from __future__ import annotations

import re
from typing import Any, Callable
from urllib.parse import urlparse

from ..discovery.search import SearchResult

_NETWORKS = {
    "linkedin": ("linkedin.com", re.compile(r"^/(company|school|showcase)/[^/]+")),
    "facebook": ("facebook.com", re.compile(r"^/(?!sharer|share|dialog|plugins|tr\b)[A-Za-z0-9.\-]{3,}")),
    "instagram": ("instagram.com", re.compile(r"^/(?!p/|reel/|explore/|accounts/)[A-Za-z0-9._]{2,}")),
    "youtube": ("youtube.com", re.compile(r"^/(channel/|c/|user/|@)[^/]+")),
    "x": ("x.com", re.compile(r"^/(?!intent|share|home|i/)[A-Za-z0-9_]{2,}")),
}
_ALIASES = {"twitter.com": "x.com", "m.facebook.com": "facebook.com", "in.linkedin.com": "linkedin.com"}


_CANONICAL = {"linkedin.com": "www.linkedin.com", "facebook.com": "www.facebook.com", "instagram.com": "www.instagram.com",
              "youtube.com": "www.youtube.com", "x.com": "x.com"}


def _clean(url: str) -> str:
    """One form per page: canonical host, no query string or trailing slash."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    host = _ALIASES.get(host, host)
    if host.endswith(".linkedin.com"):
        host = "linkedin.com"  # in.linkedin.com, uk.linkedin.com...
    return f"https://{_CANONICAL.get(host, host)}{parsed.path.rstrip('/')}"


def social_links(pages: list[dict[str, Any]]) -> dict[str, str]:
    """The first link to each network found on the organisation's own pages (its footer, usually)."""
    found: dict[str, str] = {}
    for page in pages:
        for href, _text in page.get("links", []):
            parsed = urlparse(href)
            host = (parsed.hostname or "").lower().removeprefix("www.")
            host = _ALIASES.get(host, host)
            for network, (domain, path) in _NETWORKS.items():
                if network not in found and host == domain and path.match(parsed.path or ""):
                    found[network] = _clean(href)
    return found


_FILLER = {"mr", "mrs", "ms", "dr", "prof", "the", "and", "of", "for", "pvt", "ltd", "private", "limited", "india"}
LEADER_ROLE = re.compile(r"\b(founder|co-?founder|director|owner|ceo|md|managing|principal|chairman|chairperson|head|"
                         r"president|partner|proprietor|dean|correspondent|academic head|centre head|center head)\b",
                         re.IGNORECASE)
# Students, alumni and teaching staff are not buyers, even when their profile names the institute.
NOT_A_BUYER = re.compile(r"\b(students?|learners?|alumn\w*|aspirants?|interns?|trainees?|studying|studied|candidates?|"
                         r"freshers?|teachers?|faculty|lecturers?|tutors?|former|retired|education at)\b|\bex-",
                         re.IGNORECASE)
# Words many organisation names share; matching on them alone would match other organisations.
_GENERIC_ORG = {
    "academy", "classes", "class", "institute", "institutes", "coaching", "school", "college", "education",
    "educational", "centre", "center", "centres", "centers", "career", "careers", "tutorials", "tutorial", "learning",
    "study", "studies", "international", "public", "global", "services", "training", "university", "foundation",
    "point", "group", "solutions", "technologies", "edtech", "online",
}


def _tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 3 and w not in _FILLER]


def names_organisation(text: str, organisation: str) -> bool:
    """True if the text names this organisation: its distinctive words (all but one when there are
    several, as titles get cut and city names vary), and one of its words like "Institute" or
    "Academy" when the name has one, so "aslam.sham architects" is not "SHAM Institute"."""
    words = list(dict.fromkeys(_tokens(organisation)))
    distinctive = [w for w in words if w not in _GENERIC_ORG]
    generic = [w for w in words if w in _GENERIC_ORG]
    found = set(_tokens(text))
    if not distinctive:
        return bool(generic) and all(w in found for w in generic)
    hits = sum(w in found for w in distinctive)
    if hits < max(1, len(distinctive) - 1):
        return False
    return not generic or any(w in found for w in generic) or (len(distinctive) >= 2 and hits == len(distinctive))


def same_person(name: str, person: str) -> bool:
    """Every part of the decision maker's name (titles like Dr. left out) is in the profile's name."""
    wanted = _tokens(person)
    return bool(wanted) and all(t in _tokens(name) for t in wanted)


def _in_place(text: str, place: str | None) -> bool:
    words = [w for w in _tokens((place or "").split(",")[0]) if w not in _GENERIC_ORG]
    return not words or any(w in _tokens(text) for w in words)


def linkedin_query(organisation: str, place: str | None, person: str | None) -> str:
    """One search finds both: the decision maker's profile (when named) and the company page."""
    who = f"{person} {organisation}" if person else f"{organisation} {place or ''} founder OR director OR owner"
    return " ".join(f"{who} site:linkedin.com".split())


def pick_linkedin(results: list[SearchResult], organisation: str, person: str | None = None,
                  place: str | None = None) -> dict[str, Any]:
    """From search results: the company page whose title names the organisation, and the profile of
    the named decision maker, or (when the website names nobody) of a founder, director or owner at
    the organisation in this place, marked as not verified. A profile must name the organisation,
    and students, alumni and teaching staff are never taken."""
    company, found = None, None
    for r in results:
        url = r.url.lower()
        if "linkedin.com/" not in url:
            continue
        if company is None and re.search(r"linkedin\.com/(company|school|showcase)/", url) \
                and names_organisation(r.title, organisation):
            company = _clean(r.url)
        elif found is None and "linkedin.com/in/" in url:
            role, text = _role(r.title), f"{r.title} {r.snippet}"
            if NOT_A_BUYER.search(role) or not names_organisation(text, organisation):
                continue
            if person:
                if same_person(_name(r.title), person):
                    found = {"name": person, "role": role, "url": _clean(r.url), "source": "decision maker"}
            elif LEADER_ROLE.search(role) and _in_place(text, place):
                found = {"name": _name(r.title), "role": role, "url": _clean(r.url), "source": "search result"}
    return {"company": company, "person": found}


def recheck_person(lead: dict[str, Any], results: list[SearchResult] | None, place: str | None) -> dict[str, Any] | None:
    """The LinkedIn person of a saved lead under the current rules: picked again from the original
    search results when they are still cached, else kept only if what was saved still passes."""
    organisation = lead["organisation"]["name"]
    dm = lead.get("decision_maker") or {}
    decision_maker = dm.get("name") if dm.get("scope") != "group" else None
    if results is not None:
        return pick_linkedin(results, organisation, decision_maker, place)["person"]
    person = (lead.get("linkedin") or {}).get("person")
    if not person:
        return None
    role = person.get("role") or ""
    if NOT_A_BUYER.search(role) or not names_organisation(f"{person.get('name', '')} {role}", organisation):
        return None
    if person.get("source") == "decision maker" and not (decision_maker and same_person(person["name"], decision_maker)):
        return None
    return person


def _parts(title: str) -> list[str]:
    title = re.sub(r"\s*\|\s*LinkedIn.*$", "", title, flags=re.IGNORECASE)
    return [p.strip() for p in re.split(r"\s+[-–—|]\s+", title) if p.strip()]


def _name(title: str) -> str:
    parts = _parts(title)
    return parts[0][:80] if parts else ""


def _role(title: str) -> str:
    parts = _parts(title)
    return " · ".join(parts[1:3])[:120] if len(parts) > 1 else ""


# LinkedIn lookups are made only for leads worth calling (from jobs/research.py).
LINKEDIN_STAGES = ("contact_ready", "qualified")
# Five results are enough to find a name or a company page.
LINKEDIN_RESULTS = 5


def find_linkedin(lead: dict[str, Any], social: dict[str, str], place: str | None,
                  search: Callable[[str], list[SearchResult]] | None) -> dict[str, Any]:
    """The company's LinkedIn page (from its website, else a search result) and the decision maker's
    profile, with one web search for leads worth calling. LinkedIn itself is never opened."""
    found: dict[str, Any] = {"company": social.get("linkedin"), "company_source": "website" if social.get("linkedin") else None,
                             "person": None}
    if search is None or lead["stage"] not in LINKEDIN_STAGES:
        return found
    org = lead["organisation"]["name"]
    decision_maker = lead.get("decision_maker") or {}
    person = decision_maker.get("name") if decision_maker.get("scope") != "group" else None  # not a chain's founder
    where = lead["organisation"].get("city") or place
    picked = pick_linkedin(list(search(linkedin_query(org, where, person)))[:LINKEDIN_RESULTS], org, person, where)
    if found["company"] is None and picked["company"]:
        found.update(company=picked["company"], company_source="search result")
    found["person"] = picked["person"]
    return found
