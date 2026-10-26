"""Assembling one lead record from the pages read, the model's extraction and the rules.

Only claims whose quote is found on the cited page are kept, and signals must pass the
catalogue's checks (apply_rules). Product scores come from the catalogue rules, contacts from
pattern matching, and the lead stage from what is actually known. apply_rules can be re-run on
saved leads, e.g. after the product team changes the catalogue (rescoring).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from ..schemas import AccountExtraction
from ..offer import as_offer
from .catalogue import HIRING_SIGNALS, SIGNALS, ProductScore, hiring_label, matching_role, signal_holds
from .contacts import (
    TIERS, Contact, MxLookup, check_mail_domains, describe, email_person, is_person_name, link_people, phone_region,
    rate_contact,
)
from .evidence import quote_is_supported
from .extract import PageText
from .social import NOT_A_BUYER

# Roles that can own a purchase, best first, matched as whole words. A role must name one of them
# to be the decision maker: "Program Chair, Marketing" or "Head of Primary" is not one.
ROLE_PRIORITY = (
    r"founder|co-?founder|owner|proprietor",
    r"chairman|chairperson|managing director|md|ceo|chief \w+ officer|chief executive|president|managing partner",
    r"director\w*",
    r"principal|correspondent|dean",
    r"(?:centre|center|branch|campus) head|head of (?:the )?(?:institute|academy|centre|center|branch|campus)",
    r"admissions? (?:head|manager|director)|head of admissions?|academic head|head of academics|operations head|"
    r"head of operations",
    r"(?:general|centre|center|branch|operations|admissions?) manager",
)
# Deputies' titles ("Vice Principal", "Assistant Director", "Associate Vice President") never count, and
# teaching staff only when they also lead (a "Founder / Professor").
_JUNIOR_TITLE = re.compile(r"\b(?:vice|assistant|asst|deputy|associate|junior)\.?(?:\s+(?:vice|assistant|deputy))?\s+[\w-]+",
                           re.I)
QUALIFIED_SCORE = 40


def role_rank(role: str, buyer_roles: list[str] | tuple[str, ...] = ()) -> int:
    """0 = the most likely buyer; 999 = not a decision maker. The run's buyer roles ('Founder/Director',
    'Admissions head') order the leaders; they never make a non-leader one."""
    role_l = _JUNIOR_TITLE.sub(" ", " ".join(role.lower().split()))
    tier = next((i for i, words in enumerate(ROLE_PRIORITY) if re.search(rf"\b(?:{words})\b", role_l)), None)
    if tier is None or (NOT_A_BUYER.search(role_l) and tier > 3):
        return 999
    for index, wanted in enumerate(buyer_roles):
        for phrase in re.split(r"\s*(?:/|,|\bor\b)\s*", wanted.lower()):
            if len(phrase.strip()) >= 4 and re.search(rf"\b{re.escape(phrase.strip())}\b", role_l):
                return index
    return len(buyer_roles) + tier


_role_rank = role_rank


def _local_leader(decision_maker: dict[str, Any], organisation: dict[str, Any]) -> bool:
    """For a chain: does this leader belong to the local centre (named with its city or as a centre,
    branch or campus role), rather than the national group?"""
    text = f"{decision_maker.get('role', '')} {decision_maker.get('quote', '')}".lower()
    city = (organisation.get("city") or "").lower().strip()
    return bool(re.search(r"\b(?:centre|center|branch|campus)\b", text)) or bool(city and city in text)


def build_lead(
    *,
    name: str,
    website: str | None,
    domain: str | None,
    extraction: AccountExtraction,
    pages: list[PageText],
    contacts: list[Contact],
    products,
    buyer_roles: list[str],
    external_signals: list[dict[str, Any]] | None = None,
    signal_checks: dict[str, dict[str, str]] | None = None,
    hiring_roles: list[str] | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    """external_signals: signals found during discovery in search results (e.g. a job listing),
    already checked against the result they quote. signal_checks: whether each one's page was
    opened and found live, removed or not openable automatically. products: product keys or an
    Offer (engine/offer.py); a signal outside the offer's catalogue is dropped like an unquoted one."""
    offer = as_offer(products)
    by_id = {p.id: p for p in pages}
    dropped = 0

    def supported(cite) -> PageText | None:
        nonlocal dropped
        page = by_id.get(cite.page)
        if page and quote_is_supported(cite.quote, page.text):
            return page
        dropped += 1
        return None

    evidence: list[dict[str, Any]] = []

    def keep(field: str, value: str, cite, extra: dict | None = None) -> dict | None:
        page = supported(cite)
        if not page:
            return None
        item = {"value": value, "quote": cite.quote, "url": page.url, **(extra or {})}
        evidence.append({"field": field, **item})
        return item

    signals = []
    for s in extraction.signals:
        kind = offer.signals.get(s.signal)
        if kind is None:
            dropped += 1
            continue
        item = keep(f"Signal: {kind.label}", s.observation or kind.label, s.cite,
                    {"key": s.signal, "label": kind.label, "direct": kind.direct, "event_date": s.event_date})
        if item:
            signals.append(item)

    for s in external_signals or []:
        check = (signal_checks or {}).get(s["url"]) or {"status": "not_checked"}
        signals.append({**s, "external": True, "verification": check})
        evidence.append({"field": f"Signal: {s['label']} ({s.get('source', 'search result')})", "value": s["value"],
                         "quote": s["quote"], "url": s["url"]})

    # Items with an empty name are dropped like unquoted ones.
    people = [p for p in (keep("Person", f"{x.name} ({x.role})", x.cite, {"name": x.name, "role": x.role})
                          for x in extraction.people if x.name.strip() and x.role.strip()) if p]
    branches = [b for b in (keep("Branch", x.name, x.cite, {"city": x.city})
                            for x in extraction.branches if x.name.strip()) if b]
    software = [s for s in (keep("Current software", x.name, x.cite)
                            for x in extraction.current_software if x.name.strip()) if s]
    job_posts = [j for j in (
        keep("Job post", x.title, x.cite, {
            "title": x.title, "openings": x.openings, "experience": x.experience, "salary": x.salary,
            "location": x.location, "posted": x.posted, "requirements": x.requirements,
        })
        for x in extraction.job_posts if x.title.strip()
    ) if j]

    lead = {
        "organisation": {
            "name": extraction.organisation_name.strip() or name,
            "listed_name": name,
            "website": website,
            "domain": domain,
            "city": extraction.city,
            "what_they_do": extraction.what_they_do,
            "is_target_segment": extraction.is_target_segment,
            "sells_the_offer": extraction.sells_the_offer,
            "branches": branches,
            "identity": "Official website read" if any(p.page_type != "job_post" for p in pages) else (
                "Found from a search result; website not found" if external_signals else "Website not read"
            ),
        },
        "signals": signals,
        "people": people,
        "contacts": link_people([c.as_dict() for c in contacts], people,
                                [p.text for p in pages if p.page_type != "job_post"], phone_region(domain, country)),
        # Numbers written without a country code are read as this country's (contacts.phone_region).
        "phone_region": phone_region(domain, country),
        "current_software": software,
        "job_posts": job_posts,
        "model_unknowns": list(extraction.unknowns),
        "discovery_question": extraction.discovery_question.strip() or offer.discovery_question,
        "summary": extraction.summary,
        "pages": [{"url": p.url, "type": p.page_type, "title": p.title} for p in pages],
        "evidence": evidence + [
            {"field": f"Contact ({c.kind.replace('_', ' ')})", "value": c.value, "quote": None, "url": c.url}
            for c in contacts
        ],
        "dropped_claims": dropped,
        "researched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return apply_rules(lead, offer, buyer_roles, hiring_roles)


def run_hiring_roles(products, hiring_roles: list[str] | None) -> list[str]:
    """The run's roles, or for runs that named none, the starting suggestions for its products
    (product keys or an Offer; an offer has none: its roles come from the brief or the plan)."""
    return as_offer(products).run_hiring_roles(hiring_roles)


_COMPUTED_UNKNOWNS = ("Current software", "Budget", "Decision maker", "Local centre's decision maker")
_KIND_ORDER = {"institute_phone": 0, "whatsapp": 1, "published_email": 2, "contact_form": 3}
# A chain's website numbers reach a central or front desk, not an owner: 5+ branches named, a
# toll-free line, or a national brand.
LARGE_CHAIN_BRANCHES = 5
NATIONAL_CHAIN_DOMAINS = frozenset({
    "allen.in", "allen.ac.in", "aakash.ac.in", "fiitjee.com", "narayanagroup.com", "srichaitanya.net",
    "resonance.ac.in", "motion.ac.in", "vidyamandir.com", "drishtiias.com", "visionias.in", "pw.live",
    "unacademy.com", "byjus.com", "careerpoint.ac.in", "bansal.ac.in", "vajiramandravi.com", "imsindia.com",
    "time4education.com", "careerlauncher.com", "jamboreeindia.com", "madeeasy.in", "mahendras.org", "adda247.com",
    "testbook.com", "vedantu.com",
})
_CHAIN_NAME = re.compile(r"\b(allen|aakash|fiitjee|narayana|resonance|vidyamandir|drishti|unacademy|byju'?s|"
                         r"physics\s*wallah|sri\s+chaitanya|career\s+launcher)\b", re.I)


def is_national_brand(lead: dict[str, Any]) -> bool:
    """ALLEN, Aakash, Narayana...: a local centre of a national brand, whose founders do not buy for it."""
    organisation = lead["organisation"]
    return ((organisation.get("domain") or "").lower() in NATIONAL_CHAIN_DOMAINS
            or bool(_CHAIN_NAME.search(organisation.get("name") or "")))


def is_large_chain(lead: dict[str, Any]) -> bool:
    organisation = lead["organisation"]
    return (
        is_national_brand(lead)
        or len(organisation.get("branches") or []) >= LARGE_CHAIN_BRANCHES
        or any(c["kind"] == "institute_phone" and c.get("note") in ("toll-free", "shared-cost") for c in lead["contacts"])
    )


def rate_contacts(lead: dict[str, Any], buyer_roles: list[str]) -> list[dict[str, Any]]:
    """Each contact with its quality tier (contacts.TIERS) and the reason, best first."""
    people = lead["people"]
    leaders = {p["name"] for p in people if _role_rank(p["role"], buyer_roles) < 999}
    organisation = lead["organisation"]
    large_chain = is_large_chain(lead)
    region = lead.get("phone_region") or phone_region(organisation.get("domain"))
    rated = []
    for c in lead["contacts"]:
        c = dict(c)
        if c["kind"] == "published_email" and not c.get("person"):
            owner = email_person(c["value"], people, organisation.get("name") or "")
            if owner:
                c["person"] = {"name": owner["name"], "role": owner.get("role", "")}
                c["person_match"] = "mailbox name"
        c["quality"], c["quality_note"] = rate_contact(
            c, site_domain=organisation.get("domain"), organisation=organisation.get("name") or "",
            leaders=leaders, large_chain=large_chain, region=region,
        )
        rated.append(c)
    return sorted(rated, key=lambda c: (TIERS.index(c["quality"]), _KIND_ORDER.get(c["kind"], 9)))


def _contact_summary(usable: list[dict[str, Any]], decision_maker: dict[str, Any] | None,
                     contacts: list[dict[str, Any]]) -> dict[str, Any]:
    """The best way to reach the lead, in one line for the sheet and the table."""
    if not usable:
        if any(c["kind"] != "contact_form" for c in contacts):
            label = "No sales contact: only helplines, fax or support inboxes"
        elif contacts:
            label = "Enquiry form only"
        else:
            label = "No contact published"
        return {"level": "none", "label": label}
    best = usable[0]
    level = best["quality"]
    person = best.get("person")
    if level == "direct":
        label = f"Direct to {person['name']} ({person.get('role', '')})" if person else "Direct: a leader's inbox"
    elif level == "likely":
        channel = "Personal mailbox" if best["kind"] == "published_email" else "Desk mobile / WhatsApp"
        label = f"{channel}: ask for {decision_maker['name']}" if decision_maker else f"{channel}: no named decision maker"
    else:
        label = "Reception or general inbox only"
    return {"level": level, "label": label, "kind": best["kind"], "value": best["value"]}


def refresh_contacts(lead: dict[str, Any], texts: list[str], country: str | None = None,
                     mx_lookup: MxLookup | None = None) -> dict[str, Any]:
    """Re-reads the saved page text around each contact and checks email domains, for leads saved
    before contacts were rated (rescoring). Links on the pages (tel:, wa.me) are not stored, so a
    number only shown as a link keeps what it had. mx_lookup: see contacts.check_mail_domains."""
    region = phone_region(lead["organisation"].get("domain"), country)
    contacts = lead["contacts"]
    if texts:
        contacts = [describe(c, texts, region) if c["kind"] != "contact_form" and not c.get("found_by") else c
                    for c in contacts]
        contacts = link_people(contacts, lead["people"], texts, region)
    return {**lead, "contacts": check_mail_domains(contacts, mx_lookup), "phone_region": region}


def apply_rules(lead: dict[str, Any], products, buyer_roles: list[str],
                hiring_roles: list[str] | None = None) -> dict[str, Any]:
    """Everything decided by fixed rules rather than the model: which signals count, product
    scores, decision maker, stage and confidence. Safe to re-run on a saved lead (rescoring).
    products: product keys or an Offer (engine/offer.py)."""
    offer = as_offer(products)
    lead = dict(lead)
    # Hiring counts only when the post's role is one the run is looking for; other hiring stays
    # listed as "Hiring (other roles)" but never scores or headlines (also re-labels older leads).
    roles = offer.run_hiring_roles(hiring_roles)
    relabel: dict[str, str] = {}
    normalised = []
    for s in lead["signals"]:
        if s["key"] in HIRING_SIGNALS:
            role = matching_role(roles, s.get("value"), s.get("quote"))
            key, label = ("hiring" if role else "hiring_other"), hiring_label(role)
            if label != s.get("label"):
                relabel[s.get("quote") or ""] = label
            s = {**s, "key": key, "label": label}
        if s["key"] in offer.signals:  # buying or fit signal, as the catalogue says now (also for saved leads)
            s = {**s, "direct": offer.signals[s["key"]].direct}
        normalised.append(s)
    if relabel:
        lead["evidence"] = [
            {**e, "field": f"Signal: {relabel[e.get('quote') or '']}"}
            if e["field"].startswith("Signal: Hiring") and (e.get("quote") or "") in relabel else e
            for e in lead["evidence"]
        ]
    signals, rejected = [], []
    for s in normalised:
        if s.get("derived") or signal_holds(s["key"], s["value"], s.get("quote") or "", offer):
            signals.append(s)
        else:
            rejected.append(s)
    if rejected:
        gone = {s.get("quote") for s in rejected}
        lead["evidence"] = [
            e for e in lead["evidence"] if not (e["field"].startswith("Signal: ") and e.get("quote") in gone)
        ]
        lead["rule_dropped_claims"] = lead.get("rule_dropped_claims", 0) + len(rejected)

    # Several named branches is itself a signal, even if the model did not tag it.
    branches = lead["organisation"]["branches"]
    keys = {s["key"] for s in signals}
    if len(branches) >= 2 and "multiple_branches" not in keys:
        signals.append({"key": "multiple_branches", "label": SIGNALS["multiple_branches"].label, "direct": False,
                        "value": f"{len(branches)} branches named on the website", "event_date": None,
                        "quote": branches[0]["quote"], "url": branches[0]["url"], "derived": True})
        keys.add("multiple_branches")
    lead["signals"] = signals

    # A job post found closed or removed no longer counts as a buying signal (it stays listed).
    live_keys = {s["key"] for s in signals if (s.get("verification") or {}).get("status") != "removed"}
    scores: list[ProductScore] = offer.score_products(live_keys)
    assessed = [s for s in scores if s.score is not None]
    primary = assessed[0] if assessed and assessed[0].score else None
    secondary = [s for s in assessed[1:] if s.score and s.score >= 25]
    lead["products"] = [{"key": s.key, "name": s.name, "score": s.score, "why": s.why} for s in scores]
    lead["primary_product"] = (
        {"key": primary.key, "name": primary.name, "score": primary.score, "why": primary.why} if primary else None
    )
    lead["secondary_products"] = [{"key": s.key, "name": s.name, "score": s.score, "why": s.why} for s in secondary]

    org_name = lead["organisation"].get("name") or ""
    people = sorted((p for p in lead["people"] if is_person_name(p["name"], org_name)),
                    key=lambda p: _role_rank(p["role"], buyer_roles))
    lead["people"] = people
    decision_maker = dict(people[0]) if people and _role_rank(people[0]["role"], buyer_roles) < 999 else None
    # A national brand's founder or group director is named on its website but does not buy for a
    # local centre: kept and marked, but never "ask for" and never what makes a lead contact ready.
    # (A multi-branch institute's own founder is its buyer, so this is for national brands only.)
    if (decision_maker and offer.education and is_national_brand(lead)
            and not _local_leader(decision_maker, lead["organisation"])):
        decision_maker["scope"] = "group"
    lead["decision_maker"] = decision_maker
    local_decision_maker = decision_maker if decision_maker and decision_maker.get("scope") != "group" else None

    # Headline signal: only one that counts for the products being sold (a telecaller post is not
    # headlined for an LMS search). Explicit requests first, then signals found by search (the reason
    # the organisation was found), then dated events, then the heaviest.
    relevant = offer.relevant_signals()
    ranked = sorted((s for s in signals if s["key"] in relevant), key=lambda s: (
        (s.get("verification") or {}).get("status") == "removed", not s["direct"], not s.get("external"),
        s["event_date"] is None, -offer.weight(s["key"]),
    ))
    lead["top_signal"] = ranked[0] if ranked else None

    lead["contacts"] = rate_contacts(lead, buyer_roles)
    usable = [c for c in lead["contacts"] if c["kind"] != "contact_form" and c["quality"] != "avoid"]
    lead["contact_quality"] = _contact_summary(usable, local_decision_maker, lead["contacts"])

    # Contact ready means someone who can buy is reachable: a number or mailbox printed next to a
    # decision maker, or a named decision maker plus a mobile / WhatsApp to ask for them on. A
    # reception landline, a helpline or a general inbox alone is not enough.
    in_segment = lead["organisation"]["is_target_segment"]
    direct = any(c["quality"] == "direct" for c in usable)
    likely = any(c["quality"] == "likely" for c in usable)
    reachable = direct or (local_decision_maker is not None and likely)
    qualified = bool(primary and primary.score >= QUALIFIED_SCORE and in_segment)
    lead["stage"] = "contact_ready" if qualified and reachable else "qualified" if qualified else "researched"
    read_pages = len(lead["pages"])
    if len(signals) >= 3 and read_pages >= 3 and in_segment:
        lead["confidence"] = "high"
    elif signals:
        lead["confidence"] = "medium"
    else:
        lead["confidence"] = "low"
    reason = f"{len(signals)} verified signal(s) from {read_pages} page(s)"
    if lead.get("dropped_claims"):
        reason += f"; {lead['dropped_claims']} claim(s) dropped because the quote was not found on the page"
    if lead.get("rule_dropped_claims"):
        reason += f"; {lead['rule_dropped_claims']} signal(s) dropped because the quote did not show it"
    if not in_segment:
        reason += "; may not match the requested segment or location"
    lead["confidence_reason"] = reason

    model_unknowns = lead.get("model_unknowns")
    if model_unknowns is None:  # leads saved before model_unknowns was stored
        model_unknowns = [u for u in lead.get("unknowns", []) if u not in _COMPUTED_UNKNOWNS]
    unknowns = list(model_unknowns)
    if not lead["current_software"]:
        unknowns.append("Current software")
    unknowns.append("Budget")
    if not lead["decision_maker"]:
        unknowns.append("Decision maker")
    elif lead["decision_maker"].get("scope") == "group":
        unknowns.append("Local centre's decision maker")
    lead["unknowns"] = list(dict.fromkeys(unknowns))
    return lead