"""Where buying signals are looked for. Each source is a few fixed web searches built from each
industry's search term, its signal phrases (from the product analysis) and the location; only the
search results are read.

Results must mention one of the source's keywords before they are sent to the model, which keeps
the AI request small (cost) and the run short (time).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import zip_longest
from typing import Any

from ..research.catalogue import role_from_phrase
from .search import SearchResult


@dataclass(frozen=True)
class SignalSource:
    key: str
    label: str
    keywords: tuple[str, ...]


_HIRING_WORDS = (
    "telecaller", "tele caller", "tele-caller", "telecalling", "counsellor", "counselor", "counselling", "telesales",
    "tele sales", "tele-sales", "bde", "business development", "sales executive", "admission executive",
    "admissions executive", "student enrol", "enrollment", "enrolment", "inside sales", "call centre", "calling",
    "front office", "hiring", "vacancy", "job", "recruit", "academic counsel", "admission counsel", "enquiry",
)
_SOFTWARE_WORDS = ("looking for", "need", "require", "seeking", "lms", "crm", "software", "app ", "erp", "vendor",
                   "portal", "platform")
DEFAULT_HIRING_PHRASES = ("hiring telecaller", "hiring sales executive")
DEFAULT_NEED_PHRASES = ('"looking for" CRM OR LMS OR software',)

SIGNAL_SOURCES: dict[str, SignalSource] = {
    "hiring_callers": SignalSource("hiring_callers", "Hiring posts", _HIRING_WORDS),
    "linkedin_posts": SignalSource("linkedin_posts", "LinkedIn posts and jobs", _HIRING_WORDS + _SOFTWARE_WORDS),
    "software_requests": SignalSource("software_requests", "Looking for software", _SOFTWARE_WORDS),
    "new_centres": SignalSource(
        "new_centres", "Expansion: new branches",
        ("new branch", "new centre", "new center", "new office", "opening", "opened", "launch", "inaugurat", "new campus"),
    ),
}
ORGANISATION_SEARCH = "organisation_search"
# Keyword search: the run's buyer phrases on the open web, and optionally forums, LinkedIn and Facebook
# (search results only). LinkedIn and Facebook mostly return company pages, so they are off by default.
KEYWORD_SEARCH = "keyword_search"
SIGNAL_SOURCES[KEYWORD_SEARCH] = SignalSource(KEYWORD_SEARCH, "Keyword search", ())
KEYWORD_CHANNELS = {
    "web": ("Web", ""),
    "forums": ("Quora & Reddit", "site:quora.com OR site:reddit.com"),
    "linkedin": ("LinkedIn", "site:linkedin.com"),
    "facebook": ("Facebook", "site:facebook.com"),
}
DEFAULT_KEYWORD_CHANNELS = ("web",)
ALL_SOURCES = (*SIGNAL_SOURCES, ORGANISATION_SEARCH)


def _phrases(industry: dict[str, Any], field: str, default: tuple[str, ...]) -> list[str]:
    return [p.strip() for p in (industry.get(field) or []) if p and p.strip()] or list(default)


def _turned(items: list, turn: int) -> list:
    """The list started `turn` places further on (wrapping round)."""
    if not items:
        return []
    start = turn % len(items)
    return [*items[start:], *items[:start]]


def clean_roles(roles: list[str] | tuple[str, ...] | None) -> list[str]:
    """Role names without job-post words, once each. Briefs store roles as written, and "hiring admission
    counsellor" was searched as "school hiring hiring admission counsellor India" (2026-10-29)."""
    cleaned: dict[str, str] = {}
    for role in roles or []:
        name = role_from_phrase(role) if isinstance(role, str) else ""
        if name:
            cleaned.setdefault(name.lower(), name)
    return list(cleaned.values())


def hiring_phrases(industry: dict[str, Any], roles: list[str] | tuple[str, ...] = (), offset: int = 0) -> list[str]:
    """Job-post searches for the run's hiring roles ('hiring telecaller'), starting at a different
    role for each industry so several roles get searched; without roles, the industry's own phrases."""
    roles = clean_roles(roles)
    if not roles:
        return _phrases(industry, "hiring_phrases", DEFAULT_HIRING_PHRASES)
    return [f"hiring {role}" for role in _turned(roles, offset)]


def as_places(place: str | list[str] | tuple[str, ...] | None) -> list[str]:
    """One place or several; an empty list means no place (worldwide)."""
    if place is None:
        return [""]
    places = [place] if isinstance(place, str) else [p for p in place if p is not None]
    return places or [""]


def signal_queries(sources: list[str], industries: list[dict[str, Any]], place: str | list[str],
                   per_industry: int, hiring_roles: list[str] | tuple[str, ...] = (),
                   turn: int = 0) -> list[tuple[str, str]]:
    """[(source key, query)] for the chosen signal sources: up to per_industry searches for each
    industry and place, taking one search from each source in turn. With several places, the
    industry-place pairs take turns too, so a search budget that cuts the list covers every place.
    turn (the agent's round count): each round takes the next searches from the list of every
    role and phrase, as many as before, so successive rounds run different searches. The same
    searches every round brought back the same job posts (2026-10-29)."""
    per_pair: list[list[tuple[str, str]]] = []
    for place in as_places(place):
        per_pair.extend(_industry_queries(sources, industries, place, per_industry, hiring_roles, turn))
    return [item for step in zip_longest(*per_pair) for item in step if item]


def _industry_queries(sources: list[str], industries: list[dict[str, Any]], place: str, per_industry: int,
                      hiring_roles: list[str] | tuple[str, ...], turn: int = 0) -> list[list[tuple[str, str]]]:
    queries: list[list[tuple[str, str]]] = []
    for index, industry in enumerate(industries):
        kind = industry["search_term"]
        hiring = hiring_phrases(industry, hiring_roles, index)
        need = _phrases(industry, "need_phrases", DEFAULT_NEED_PHRASES)
        # Every search each source could run, in order; a round takes as many as the first
        # round always did (two hiring searches, two LinkedIn, one of each other).
        planned = {
            "hiring_callers": [f"{kind} {phrase} {place}" for phrase in hiring],
            "linkedin_posts": [f"{kind} {place} {phrase} site:linkedin.com" for pair in
                               zip_longest(hiring, need) for phrase in pair if phrase],
            "software_requests": [f"{kind} {place} {phrase}" for phrase in need],
            "new_centres": [f"{kind} new branch opening {place}"],
        }
        per_round = {"hiring_callers": min(2, len(hiring)), "linkedin_posts": 2, "software_requests": 1, "new_centres": 1}
        # One search from each chosen source in turn, so a small per-industry limit still covers every source.
        per_source = [[(key, " ".join(q.split())) for q in planned[key]] for key in sources if key in planned]
        mine = [item for step in zip_longest(*per_source) for item in step if item]
        size = min(per_industry, sum(per_round[key] for key in sources if key in planned), len(mine))
        queries.append(_turned(mine, turn * size)[:size])
    return queries


def mentions_signal(result: SearchResult, source_key: str, extra_words: tuple[str, ...] = ()) -> bool:
    text = f" {result.title} {result.snippet} ".lower()
    return any(word in text for word in SIGNAL_SOURCES[source_key].keywords + extra_words)


# Job-board pages listing many posts: a line on one does not say which organisation is hiring, and
# the model credited one to an organisation in another city (2026-10-29: "215 admissions jobs in
# Pānīpat, October 2026 | Glassdoor", with a line "Hiring Admission Counsellor - Delhi/NCR", became
# Orane International's Bangalore branch). A single post ("The Pathfinder School hiring Admission
# Counsellor Job in India", glassdoor /job-listing/..., naukri /job-listings-...) still counts.
_JOB_LIST_TITLE = re.compile(
    r"\b\d[\d,]*\d\+?\s+(?:[^\W\d_][\w'&/.-]*\s+){0,6}(?:jobs|vacancies)\b"  # "215 admissions jobs", "410+ Remote ... Jobs"
    r"|\b(?:jobs|vacancies)\s+(?:in|near)\b"  # "Telecaller jobs in Bangalore - Quess Staffing"
    r"|\bjobs,\s+employment\b"  # Indeed: "Admission Counsellor Jobs, Employment in Delhi"
    r"|[|\-–—]\s*page\s+\d+\b",  # "... (Oct 2026) – Page 4"
    re.I)
_JOB_LIST_URL = re.compile(
    r"glassdoor\.[a-z.]+/job/[^?#]*srch_"  # /Job/panipat-admissions-jobs-SRCH_IL.0,7_IC2883094_KO8,18.htm
    r"|indeed\.[a-z.]+/(?:jobs\b|q-[^/?#]*-jobs\.html)"  # /jobs?q=telecaller&l=Delhi, /q-telecaller-l-delhi-jobs.html
    r"|[-_]jobs-in-"  # naukri, shine, apna: /admission-counsellor-jobs-in-delhi
    r"|naukri\.com/[^/?#]*-jobs(?:-\d+)?/?(?:$|[?#])"  # /telecaller-jobs, /telecaller-jobs-2
    r"|linkedin\.com/jobs/(?:search|[^/?#]*-jobs)"  # /jobs/search?keywords=..., /jobs/admission-counsellor-jobs-delhi
    r"|/job-search\b|/jobs/search\b|/srp/",  # shine, timesjobs, foundit search pages
    re.I)


def is_job_list(result: SearchResult) -> bool:
    """A job board's list or search page rather than one organisation's post (never sent to the model)."""
    return bool(_JOB_LIST_TITLE.search(result.title or "") or _JOB_LIST_URL.search(result.url or ""))


def phrase_words(industries: list[dict[str, Any]]) -> tuple[str, ...]:
    """Distinctive words from the industries' signal phrases, used by the keyword filter too."""
    words = set()
    for industry in industries:
        for phrase in (industry.get("hiring_phrases") or []) + (industry.get("need_phrases") or []):
            words.update(w for w in re.findall(r"[a-z]+", phrase.lower()) if len(w) > 4 and w not in ("hiring", "looking"))
    return tuple(sorted(words))


def keyword_queries(keywords: list[str], industries: list[dict[str, Any]], place: str | list[str], channels: list[str],
                    limit: int, turn: int = 0) -> list[tuple[str, str]]:
    """[(channel, query)]: every keyword on the web first (with the industry and place, rotating),
    then on the other channels, up to the limit, so a small limit still covers every keyword once.
    turn (the agent's round count) starts at a later keyword, so a limit below the number of
    keywords does not search the first ones every round."""
    queries: list[tuple[str, str]] = []
    places = as_places(place)
    keywords = _turned(list(keywords), turn)
    for channel in [c for c in KEYWORD_CHANNELS if c in channels]:
        site = KEYWORD_CHANNELS[channel][1]
        for index, keyword in enumerate(keywords):
            kind = industries[index % len(industries)]["search_term"] if industries else ""
            place = places[index % len(places)]
            # On the open web the industry narrows results to organisations; on LinkedIn and Facebook
            # posts rarely name their industry, so only the place is added.
            parts = [keyword, kind, place] if not site else [keyword, place, site]
            queries.append((channel, " ".join(" ".join(parts).split())))
    return queries[:limit]


def keyword_words(keywords: list[str]) -> tuple[str, ...]:
    """Distinctive words of the keywords, for the keyword filter on search results."""
    filler = {"looking", "for", "the", "and", "our", "need", "needs", "want", "best", "with", "your", "software", "system",
              "platform", "online"}
    return tuple(sorted({w for k in keywords for w in re.findall(r"[a-z]+", k.lower()) if len(w) > 2 and w not in filler}))
