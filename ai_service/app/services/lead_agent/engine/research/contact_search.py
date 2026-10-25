"""Looking up a qualified lead's decision maker and their own phone or email on the open web, when
its website shows only desk numbers and general inboxes.

One web search per lead, then the run's model picks people at this organisation from the results.
Nothing the model says is taken on trust: a person is kept only if their name is in the result,
the result is about this organisation, and a phone or email only if that result prints it within a
few words of the name. Directories that show masked or virtual numbers (JustDial, IndiaMART, ...)
and job portals (HR numbers) are left out, and helpline numbers are rated "avoid" as on websites.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from ..discovery.domains import registered_domain
from ..discovery.search import SearchResult
from ..schemas import ContactLookup
from ..errors import InvalidOutput
from .contacts import EMAIL_RE, _name_pattern, _phone_matches, is_person_name, phone_region, site_desk_line
from .evidence import quote_is_supported
from .lead import role_rank
from .social import names_organisation

LOOKUP_RESULTS = 8
LOOKUP_SNIPPET_CHARS = 1500
LOOKUP_MAX_TOKENS = 1_200
# How far from the name a number or email may be printed and still be theirs.
NEAR_CHARS = 120

# Masked / virtual numbers (calls go through the directory's IVR) and job portals (HR numbers).
NO_CONTACT_SITES = frozenset({
    "justdial.com", "sulekha.com", "indiamart.com", "tradeindia.com", "urbanpro.com", "yellowpages.in",
    "asklaila.com", "grotal.com", "quikr.com", "olx.in", "yet5.com", "superprof.co.in", "exportersindia.com",
    "clickindia.com", "naukri.com", "indeed.com", "apna.co", "workindia.in", "shine.com", "foundit.in",
    "timesjobs.com", "monsterindia.com", "glassdoor.com", "glassdoor.co.in", "internshala.com", "jobhai.com",
    "naukrigulf.com", "kitjob.in", "collegedunia.com", "shiksha.com", "collegedekho.com", "careers360.com",
    "getmyuni.com",
})
def lookup_query(organisation: str, place: str | None, person: str | None) -> str:
    if person:
        return " ".join(f"{person} {organisation} {place or ''} mobile number email".split())
    return " ".join(f"who is the founder or director of {organisation} {place or ''} contact number".split())


def _usable(result: SearchResult) -> bool:
    domain = registered_domain(result.url) or ""
    return not any(domain == d or domain.endswith("." + d) for d in NO_CONTACT_SITES)


def about_organisation(text: str, url: str, organisation: str, site_domain: str | None) -> bool:
    """True if the result is on the organisation's website, or names it the way social.names_organisation
    checks (one shared word is not enough: "Takshila Traders" is not "Takshila Institute")."""
    if site_domain and registered_domain(url) == site_domain:
        return True
    return names_organisation(text, organisation)


def build_lookup_prompt(organisation: str, place: str | None, site_domain: str | None,
                        known_people: list[dict[str, Any]], results: list[SearchResult]) -> tuple[str, str]:
    system = (
        "You read web search results to find who runs one organisation and how to reach them directly. "
        "Rules:\n"
        "- List every person the results name as an owner, founder, co-founder, director, principal, CEO, head "
        "or manager of this organisation, even when no phone or email is shown for them. Ignore people at "
        "other organisations with a similar name, and ignore students and teaching faculty.\n"
        "- phone / email: only when the same result prints it right next to that person's name; otherwise null. "
        "Never guess, complete or reformat a number; copy it as written.\n"
        "- Never give helpline, toll-free or customer-care numbers, or general inboxes (info@, admissions@).\n"
        "- quote: exact words copied from the result, containing the name (and the phone or email if given).\n"
        "- If no result names such a person, return an empty list."
    )
    known = "; ".join(f"{p['name']} ({p.get('role', '')})" for p in known_people[:4]) or "none"
    lines = [
        f"Organisation: {organisation}",
        f"Website: {site_domain or 'unknown'}",
        f"Place: {place or 'unknown'}",
        f"People already named on its website: {known}",
        "",
        "Search results:",
    ]
    for index, r in enumerate(results, start=1):
        lines.append(f"[R{index}] {r.title}\nURL: {r.url}\n{r.snippet}\n")
    return system, "\n".join(lines)


def _near(name_spans: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start - name_end <= NEAR_CHARS and name_start - end <= NEAR_CHARS // 2
               for name_start, name_end in name_spans)


def _quote(text: str, name_spans: list[tuple[int, int]], start: int, end: int) -> str:
    """The words from the person's name to their number or email (whichever comes first), so the
    quote itself shows both."""
    name_start, name_end = min(name_spans, key=lambda s: min(abs(start - s[1]), abs(s[0] - end)))
    left, right = min(name_start, start), max(name_end, end)
    return " ".join(text[max(0, left - 15):right + 15].split())[:220]


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def verify_lookup(found: ContactLookup, results: list[SearchResult], *, organisation: str,
                  site_domain: str | None, country: str | None) -> dict[str, list[dict[str, Any]]]:
    """The people and contacts that the results really show. Returns {"people": [...], "contacts": [...]}
    in the lead's own formats (people with quote and url; contacts tied to their person)."""
    region = phone_region(site_domain, country)
    people: list[dict[str, Any]] = []
    contacts: list[dict[str, Any]] = []
    seen_people: set[str] = set()
    for item in found.people:
        if not 1 <= item.result <= len(results):
            continue
        result = results[item.result - 1]
        text = f"{result.title} {result.snippet}"
        pattern = _name_pattern(item.name)
        if not pattern or not item.role.strip() or not is_person_name(item.name, organisation):
            continue
        if role_rank(item.role) >= 999:
            continue  # students, faculty, deputies and other staff are not the decision maker
        spans = [(m.start(), m.end()) for m in pattern.finditer(text)]
        if not spans or not about_organisation(text, result.url, organisation, site_domain):
            continue
        if not quote_is_supported(item.quote, text):
            continue
        source = registered_domain(result.url) or result.url
        person = {"name": item.name.strip(), "role": item.role.strip()}
        key = _name_key(item.name)
        if key not in seen_people:
            seen_people.add(key)
            people.append({"value": f"{person['name']} ({person['role']})", "quote": item.quote, "url": result.url,
                           **person, "source": f"web search ({source})"})
        wanted = _digits(item.phone)[-8:]
        if len(wanted) >= 8:
            for number, phone_type, start, end in _phone_matches(text, region):
                if _digits(number).endswith(wanted) and _near(spans, start, end):
                    snippet = _quote(text, spans, start, end)
                    contacts.append({
                        "kind": "institute_phone", "value": number, "url": result.url, "note": phone_type,
                        "context": snippet, "seen_on": 0, "person": person, "person_quote": snippet,
                        "found_by": f"web search ({source})",
                    })
                    break
        email = (item.email or "").strip().lower()
        if email:
            for match in EMAIL_RE.finditer(text):
                if match.group(0).strip(".").lower() == email and _near(spans, match.start(), match.end()):
                    snippet = _quote(text, spans, match.start(), match.end())
                    contacts.append({
                        "kind": "published_email", "value": email, "url": result.url, "note": "named inbox",
                        "context": snippet, "seen_on": 0, "person": person, "person_quote": snippet,
                        "found_by": f"web search ({source})",
                    })
                    break
    return {"people": people, "contacts": contacts}


def lookup_contacts(lead: dict[str, Any], *, place: str | None, country: str | None,
                    search: Callable[[str], list[SearchResult]],
                    ask: Callable[[str, str, type[ContactLookup]], ContactLookup]) -> dict[str, list[dict[str, Any]]]:
    """One search and one model reply for one lead.

    search(query) -> results (at most LOOKUP_RESULTS are read).
    ask(system, user, ContactLookup) -> ContactLookup (send LOOKUP_MAX_TOKENS as the output limit).
    An unusable reply (errors.InvalidOutput) finds nobody; the lead keeps its website
    contacts."""
    organisation = lead["organisation"]["name"]
    site_domain = lead["organisation"].get("domain")
    person = (lead.get("decision_maker") or {}).get("name")
    results = [r for r in list(search(lookup_query(organisation, lead["organisation"].get("city") or place, person)))
               [:LOOKUP_RESULTS] if _usable(r)]
    results = [r for r in results if about_organisation(f"{r.title} {r.snippet}", r.url, organisation, site_domain)]
    if not results:
        return {"people": [], "contacts": []}
    system, user = build_lookup_prompt(organisation, lead["organisation"].get("city") or place, site_domain,
                                       lead["people"], results)
    try:
        reply = ask(system, user, ContactLookup)
    except InvalidOutput:
        return {"people": [], "contacts": []}
    if not isinstance(reply, ContactLookup):
        reply = ContactLookup.model_validate(reply)
    return verify_lookup(reply, results, organisation=organisation, site_domain=site_domain, country=country)


def _name_key(name: str) -> str:
    """'Nitin Viijay (NV Sir)' and 'Mr. Nitin Viijay' are the same person."""
    bare = re.sub(r"\([^)]*\)", " ", name.lower())
    return " ".join(w for w in re.findall(r"[a-z]+", bare) if w not in ("mr", "mrs", "ms", "dr", "er", "prof"))


def merge_lookup(lead: dict[str, Any], found: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Adds the people and contacts found by the lookup to the lead (with evidence). A number the
    website already shows becomes tied to the person the search result names next to it, unless
    the website itself labels it as a desk or enquiry line (or shows it on most pages, or it is a
    general inbox): then the person is only who to ask for on it (``ask_for``) and the line stays
    "likely" at best (contacts.site_desk_line; the WiNNERS Institute case of 2026-10-25). A number
    found only in a search result next to the name is added with its person and can be "direct"."""
    lead = dict(lead)
    people = list(lead["people"])
    known = {_name_key(p["name"]) for p in people}
    evidence = list(lead["evidence"])
    for p in found["people"]:
        if _name_key(p["name"]) not in known:
            people.append(p)
            known.add(_name_key(p["name"]))
            evidence.append({"field": f"Person ({p['source']})", "value": p["value"], "quote": p["quote"],
                             "url": p["url"]})
    contacts = [dict(c) for c in lead["contacts"]]
    by_value = {c["value"].lower(): c for c in contacts}
    pages_read = len([p for p in lead.get("pages") or [] if p.get("type") != "job_post"]) or None
    for c in found["contacts"]:
        existing = by_value.get(c["value"].lower())
        if existing is not None:
            if not existing.get("person") and not existing.get("ask_for"):
                desk = site_desk_line(existing, pages_read)
                if desk:
                    existing.update(ask_for=c["person"], ask_for_quote=c["person_quote"], desk_line=desk,
                                    confirmed_by=c["url"], linked_by=c["found_by"])
                    evidence.append({"field": f"Who to ask for ({c['found_by']})", "value": c["value"],
                                     "quote": c["person_quote"], "url": c["url"]})
                else:
                    existing.update(person=c["person"], person_quote=c["person_quote"], confirmed_by=c["url"],
                                    linked_by=c["found_by"])
                    evidence.append({"field": f"Contact owner ({c['found_by']})", "value": c["value"],
                                     "quote": c["person_quote"], "url": c["url"]})
            continue
        contacts.append(c)
        by_value[c["value"].lower()] = c
        evidence.append({"field": f"Contact ({c['found_by']})", "value": c["value"], "quote": c["person_quote"],
                         "url": c["url"]})
    lead.update(people=people, contacts=contacts, evidence=evidence, contact_lookup={
        "people_found": len(found["people"]), "contacts_found": len(found["contacts"]),
    })
    return lead
