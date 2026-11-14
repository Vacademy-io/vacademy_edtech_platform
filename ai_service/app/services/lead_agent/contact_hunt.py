"""Finding a reachable contact for a lead beyond its own website: the phone on its Google Maps
listing (the Maps lane's, or one looked up by name) and the contact hunt's searches for the
organisation's own number or email.

Outreach after delivery is fully automated, so a lead nobody can reach is worth nothing; but a good
organisation must not be rejected while a contact can still be found. What research may spend on
that follows the agent's validation effort (effort.py):

  BASIC     the Maps lane's listing only, nothing searched;
  STANDARD  one Maps search by name ("<name> <city>", Serper maps, 3 credits) for a lead that did not
            come from the Maps lane, then, while no reachable contact is known, one hunt search
            ("<name> <city> contact number", 1 credit);
  DEEP      the same Maps search, then up to three hunt searches ("... email", and the organisation's
            Facebook / Instagram / LinkedIn page in one search; result snippets only, never opened).

Searches run only for a lead that reaches the agent's review bar once it has a reachable contact
(worth_searching); they are counted into the agent's day (SearchCounter) and cached 7 days like every
other search, and a failed one is skipped (the lead stands on what it has). What they find is judged
by the same free rules as a website's contacts: a looked-up Maps phone is merged exactly like the
Maps lane's (found_by "google_maps", maps_confirmed), a hunted number or email is rated like one on a
website (found_by "contact_hunt").
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

from . import engine_api
from .search import SearchFailed

logger = logging.getLogger(__name__)

MAPS_FOUND_BY = "google_maps"
# The rating reads the words around a number (helpline, careers, office...). The listing's name is
# kept out of them: "Career Craft Patna" would read as a careers line (2026-10-29).
MAPS_CONTEXT = "Phone number on the organisation's Google Maps listing"
# A lead is searched for when it would reach the review bar with the contact being looked for, at least
# a desk mobile ("likely"): a lead with no contact scores no reach points, so its own score would almost
# never let a search run for it. None: only a lead whose score already reaches the bar is searched for.
SEARCH_ASSUMES_CONTACT: Optional[str] = "likely"
_LEVEL_ORDER = {"none": 0, "general": 1, "likely": 2, "direct": 3}

Rescore = Callable[[Dict[str, Any]], Tuple[Dict[str, Any], Dict[str, Any]]]


def last10(value: Optional[str]) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else ""


def filter_suppressed(contacts: List[Any], supp: Dict[str, set]) -> List[Any]:
    """Contacts (engine Contacts or dicts) without the institute's suppressed emails and phones."""
    phones, emails = supp.get("PHONE", set()), supp.get("EMAIL", set())
    out = []
    for c in contacts:
        kind = getattr(c, "kind", None) or (c.get("kind") if isinstance(c, dict) else None)
        value = getattr(c, "value", None) or (c.get("value") if isinstance(c, dict) else "") or ""
        if kind == "published_email" and value.strip().lower() in emails:
            continue
        if kind in ("institute_phone", "whatsapp") and last10(value) and last10(value) in phones:
            continue
        out.append(c)
    return out


def maps_url(maps: Dict[str, Any], name: str) -> str:
    if maps.get("cid"):
        return f"https://maps.google.com/?cid={maps['cid']}"
    return "https://www.google.com/maps/search/?api=1&query=" + quote_plus(f"{name} {maps.get('address') or ''}".strip())


def maps_phone(discovery: Dict[str, Any], name: str, site_domain: Optional[str], country: Optional[str],
               supp: Dict[str, set]) -> Optional[Dict[str, Any]]:
    """The phone on the candidate's Google Maps listing (discovery_json.maps.phone) as a contact,
    or None: no listing phone, not a valid number, or suppressed.

    The number is read by the same engine code as a website number (extract_contacts on a one-line
    page), so it is formatted and typed (mobile / landline / toll-free) the same way and rated the
    same: a mobile is "likely", a landline "general". found_by marks where it came from."""
    maps = discovery.get("maps") if isinstance(discovery.get("maps"), dict) else {}
    raw = str(maps.get("phone") or "").strip()
    if not last10(raw):
        return None
    url = maps_url(maps, name)
    read = engine_api.extract_contacts([{"url": url, "text": raw, "links": [], "has_form": False,
                                         "page_type": "maps"}], site_domain, country)
    phone = next((c for c in read if getattr(c, "kind", None) == "institute_phone"), None)
    if phone is None:
        return None
    contact = {"kind": "institute_phone", "value": phone.value, "url": url, "note": phone.note,
               "context": MAPS_CONTEXT, "seen_on": 0, "found_by": MAPS_FOUND_BY}
    return contact if filter_suppressed([contact], supp) else None


def with_maps_phone(lead: Dict[str, Any], phone: Dict[str, Any]) -> Dict[str, Any]:
    """The Maps listing's phone on a built lead. A website number with the same last 10 digits is
    marked maps_confirmed (Google's listing shows it too: 420 of 532 live leads with a Maps phone on
    "Leads for Vacademy", 2026-10-29); otherwise the Maps number is added as one more contact, so a
    site showing only helplines, support inboxes or a form still has a number to call (CMC Indore,
    Career Craft Patna were rejected for "no contact" while their listing showed one).

    A confirmed number is the business line whatever the website prints around it: rating keeps it
    usable when only those words (feedback, careers, a web agency's credit) would avoid it, never when
    it is a helpline, toll-free, fax or template number (contacts.rate_contact; 2026-10-29 replay:
    vibrantacademy.com's only number, the one Google lists, was avoided for "share feedback").

    Done on the built lead's dicts because the engine's Contact keeps only its own fields
    (found_by / maps_confirmed would not survive build_lead); the caller re-runs apply_rules so the
    contacts are rated with them."""
    digits = last10(phone["value"])
    contacts, confirmed = [], False
    for c in lead.get("contacts") or []:
        if c.get("kind") in ("institute_phone", "whatsapp") and last10(c.get("value")) == digits:
            c = {**c, "maps_confirmed": True}
            confirmed = True
        contacts.append(c)
    lead = {**lead, "contacts": contacts}
    if not confirmed:
        lead["contacts"] = contacts + [dict(phone)]
        lead["evidence"] = [*(lead.get("evidence") or []), {"field": "Contact (Google Maps listing)",
                                                             "value": phone["value"], "quote": None,
                                                             "url": phone["url"]}]
    return lead


def reachable(lead: Dict[str, Any]) -> bool:
    """The lead has a contact outreach can use (engine contacts.reachable): a usable phone, or a usable
    email the organisation owns or a leader's own mailbox."""
    return any(engine_api.reachable(c) for c in lead.get("contacts") or [])


def worth_searching(lead: Dict[str, Any], scored: Dict[str, Any], gate_cfg: Dict[str, Any],
                    score: Callable[[Dict[str, Any]], Dict[str, Any]]) -> bool:
    """Whether more searching may be spent on this lead: the gate would not reject it once it has the
    contact being looked for (a lead below SEARCH_ASSUMES_CONTACT is scored as if it had one). The
    gate reads the review bar as it will at the end (an agent taking competitors' users judges them
    without that penalty), and a hard reject (another segment, a competitor, an excluded kind) is
    never searched for."""
    quality = lead.get("contact_quality") or {}
    level = quality.get("level") or "none"
    assumed = SEARCH_ASSUMES_CONTACT
    if assumed and _LEVEL_ORDER.get(level, 0) < _LEVEL_ORDER[assumed]:
        lead = {**lead, "contact_quality": {**quality, "level": assumed}}
        scored = score(lead)
    decision, _reasons = engine_api.gate(scored, lead, gate_cfg)
    return decision != "REJECT"


def worth_a_lookup(lead: Dict[str, Any], scored: Dict[str, Any], gate_cfg: Dict[str, Any],
                   score: Callable[[Dict[str, Any]], Dict[str, Any]]) -> bool:
    """The decision-maker lookup's guard (one search + one AI reply): the gate would not reject the lead
    with the contact the lookup looks for, a direct one. So a hard reject (another segment, a competitor,
    an excluded kind) is never looked up; before 2026-10-30 every lead at the review bar was. The lead's
    own score, as it is, must reach the gate's bar, as before: the lookup finds the person to ask for at a
    lead that already qualifies; lifting a weak or contact-less one is the Maps lookup's and the contact
    hunt's job, at the effort the agent pays for (a BASIC agent searches nothing for it). The missing
    contact does not count against it: no "no usable contact" flag, the contact level taken as direct, so
    a list that takes only direct contacts still gets the one search that can find one (worth_searching,
    which assumes a "likely" contact, would rule those out)."""
    flags = [f for f in scored.get("flags") or [] if str(f).split(":", 1)[0] != "no_contact"]
    quality = lead.get("contact_quality") or {}
    decision, _reasons = engine_api.gate({**scored, "flags": flags},
                                         {**lead, "contact_quality": {**quality, "level": "direct"}}, gate_cfg)
    return decision != "REJECT"


def maps_lookup(lead: Dict[str, Any], *, maps: Callable[[str], List[Dict[str, Any]]], city: Optional[str],
                country: Optional[str], supp: Dict[str, set],
                rescore: Rescore) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], Dict[str, Any]]:
    """One Maps search for "<organisation name> <city>" (maps(query) -> Serper places). The first
    listing that is this organisation's (engine maps_listing.listing_is_theirs: its website on the
    organisation's domain, or no website and the same name in the same city) has its phone merged
    like the Maps lane's (with_maps_phone), and the lead is re-rated and re-scored (rescore).
    Returns (lead, the new score or None when nothing changed, what was done). SearchFailed is the
    caller's to catch."""
    org = lead.get("organisation") or {}
    name = org.get("name") or org.get("listed_name") or ""
    domain = org.get("domain")
    query = engine_api.maps_query(name, city)
    listing = engine_api.pick_listing(list(maps(query) or []), organisation=name, domain=domain, city=city)
    info: Dict[str, Any] = {"query": query, "found": listing is not None, "phone": None}
    if listing is None:
        return {**lead, "maps_lookup": info}, None, info
    kept = {k: listing.get(k) for k in ("title", "type", "rating", "reviews", "address", "website", "cid")
            if listing.get(k) is not None}
    lead = {**lead, "maps_listing": {**kept, "source": "maps lookup"}}
    phone = maps_phone({"maps": listing}, name, domain, country, supp)
    if phone is None:
        return {**lead, "maps_lookup": info}, None, info
    info["phone"] = phone["value"]
    lead, scored = rescore(with_maps_phone(lead, phone))
    return {**lead, "maps_lookup": info}, scored, info


def _contact_key(c: Dict[str, Any]) -> str:
    value = c.get("value") or ""
    return value.lower() if c.get("kind") == "published_email" else (last10(value) or value)


def hunt(lead: Dict[str, Any], *, web: Callable[[str], list], rounds: int, social: bool, city: Optional[str],
         country: Optional[str], supp: Dict[str, set], mx=None,
         rescore: Rescore) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], Dict[str, Any]]:
    """Up to `rounds` searches for the organisation's own phone or email (engine
    contact_search.hunt_queries; web(query) -> search results), stopping at the first reachable
    contact. Each round's new contacts (engine contact_search.hunt_contacts: printed next to the
    organisation's name in a result about it; suppressed ones dropped) are added with evidence, their
    mail domains checked, and the lead re-rated and re-scored. A failed search ends the hunt with what
    it found. Returns (lead, the last new score or None, {"searches", "queries", "found"})."""
    org = lead.get("organisation") or {}
    name = org.get("name") or org.get("listed_name") or ""
    domain = org.get("domain")
    info: Dict[str, Any] = {"searches": 0, "queries": [], "found": 0}
    scored = None
    for query in engine_api.hunt_queries(name, city, social)[:max(0, int(rounds))]:
        try:
            results = list(web(query) or [])
        except SearchFailed as exc:
            logger.info("lead agent: contact hunt search skipped (%s)", exc)
            break
        info["searches"] += 1
        info["queries"].append(query)
        found = engine_api.hunt_contacts(results, organisation=name, site_domain=domain, city=city, country=country)
        known = {_contact_key(c) for c in lead.get("contacts") or []}
        new = [c for c in filter_suppressed(found, supp) if _contact_key(c) not in known]
        if not new:
            continue
        info["found"] += len(new)
        evidence = [{"field": f"Contact (contact search, {engine_api.registered_domain(c['url']) or c['url']})",
                     "value": c["value"], "quote": c["context"], "url": c["url"]} for c in new]
        lead = {**lead, "contacts": engine_api.check_mail_domains([*(lead.get("contacts") or []), *new], mx),
                "evidence": [*(lead.get("evidence") or []), *evidence]}
        lead, scored = rescore(lead)
        if reachable(lead):
            break
    return {**lead, "contact_hunt": info}, scored, info


def no_contact_reason(*, maps_checked: bool, decision_maker: bool, hunt_searches: int) -> Optional[str]:
    """The reject reason of a lead still without a usable contact, saying what was tried ("No reachable
    contact after the website, Google Maps and 1 contact search"); None when nothing but the website
    was (the gate's own words stay)."""
    tried = []
    if maps_checked:
        tried.append("Google Maps")
    if decision_maker:
        tried.append("a decision-maker search")
    if hunt_searches:
        tried.append(f"{hunt_searches} contact search" + ("es" if hunt_searches != 1 else ""))
    if not tried:
        return None
    items = ["the website", *tried]
    return "No reachable contact after " + ", ".join(items[:-1]) + " and " + items[-1]


__all__ = ["MAPS_FOUND_BY", "MAPS_CONTEXT", "SEARCH_ASSUMES_CONTACT", "last10", "filter_suppressed", "maps_url",
           "maps_phone", "with_maps_phone", "reachable", "worth_searching", "worth_a_lookup", "maps_lookup", "hunt",
           "no_contact_reason"]
