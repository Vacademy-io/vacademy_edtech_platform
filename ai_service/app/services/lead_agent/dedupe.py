"""The same organisation found twice under two domains, caught after its website is read.

Discovery dedupes by registered domain and by the name in the search result, but one organisation
often runs two sites, and the names only agree once the pages are read. After delivery the outreach
(AI calls, WhatsApp, email) runs with nobody watching, so two leads that share a number are one
organisation called twice and charged twice. Real cases on "Leads for Vacademy" (2026-10-29):
centurionacademy.in and centuriondefenceacademy.com (Lucknow) print the same two mobiles; iisdt.in
and bkvps.in (Indore) share 2 phones and 4 emails; pws.edu.in shows school.pws@pathways.in while
pathways.in was a candidate too, and both were delivered and charged.

A researched lead is compared with the agent's other live candidates (APPROVED, REVIEW, DELIVERED):

  same organisation (the lead is SKIPPED, with a note naming the other domain and what is shared):
    a. a usable phone (last 10 digits) or email (lower-case) in common;
    b. one site's emails are on the other's domain, or one site opens on the other's domain;
  possible duplicate (flag "possible_duplicate:<domain>", the gate sends it to REVIEW, never AUTO):
    c. the same organisation name and the same city, but nothing shared (quantumcoaching.in and
       quantumcoachinginstitute.in, both "Quantum Coaching Institute", Lucknow).

The candidate already live wins: its row is never touched (delivery may be holding it). The check and
the save run in one transaction under the agent's advisory lock (store.lock_agent_dedupe), so two
research workers finishing two sites of one organisation at the same moment cannot both pass.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from . import engine_api, store
from .contact_hunt import last10

SAME, POSSIBLE = "same", "possible"
LIVE_STATUSES = ("APPROVED", "REVIEW", "DELIVERED")
PHONE_KINDS = ("institute_phone", "whatsapp")
MAX_OTHERS = 200
# A web agency's credit line ("Designed & developed by XYZ Infotech, +91 98...") is printed on every
# site it built: never a sign that two sites are one organisation. Not any "design" or "develop": a
# "Skill Development" institute's own number must still match. store.same_org_candidates applies the
# same words in SQL.
_AGENCY = re.compile(r"\b(?:designed|developed|maintained|hosted|created|crafted|built)(?:\s+(?:and|&)\s+\w+)?\s+by\b|"
                     r"\b(?:design|development)\s+by\b|powered\s+by|website\s+by", re.I)


@dataclass(frozen=True)
class Match:
    kind: str  # SAME | POSSIBLE
    candidate_id: str
    domain: str
    shared: Tuple[str, ...] = ()  # what the two have in common, in plain words

    def note(self) -> str:
        if self.kind == SAME:
            return f"Same organisation as {self.domain}: {'; '.join(self.shared)}"
        return f"Possibly the same organisation as {self.domain}: same name and city"

    def as_dict(self) -> Dict[str, Any]:
        return {"candidate_id": self.candidate_id, "domain": self.domain, "shared": list(self.shared)}


def phone_key(value: Optional[str]) -> str:
    """A phone as it is compared everywhere: its last 10 digits ('' when it has fewer)."""
    return last10(value)


def email_key(value: Optional[str]) -> str:
    """An email as it is compared everywhere: trimmed, lower case."""
    return str(value or "").strip().lower()


def keys_of(contacts: Iterable[Any]) -> Tuple[Set[str], Set[str]]:
    """(phones, emails) of these contacts (dicts with kind and value), compared as phone_key / email_key.
    The one normaliser behind the check before research (research.usable_keys), this module's matching and
    delivery's existing-contacts check, so the three cannot disagree on what "the same number" is."""
    phones: Set[str] = set()
    emails: Set[str] = set()
    for c in contacts:
        value = str(c.get("value") or "").strip()
        if c.get("kind") in PHONE_KINDS and phone_key(value):
            phones.add(phone_key(value))
        elif c.get("kind") == "published_email" and "@" in value:
            emails.add(email_key(value))
    return phones, emails


def _mail_domain(email: str) -> str:
    return email.rpartition("@")[2].strip(".").lower()


def _on_domain(host: str, domain: str) -> bool:
    return bool(host and domain) and (host == domain or host.endswith("." + domain))


def _usable(c: Any) -> bool:
    """A route outreach would use: not a form, not rated avoid (helplines, support inboxes, template
    leftovers, placeholder numbers), not a web agency's footer line."""
    return (isinstance(c, dict) and c.get("kind") != "contact_form" and c.get("quality") != "avoid"
            and not _AGENCY.search(c.get("context") or ""))


def contact_keys(lead: Dict[str, Any]) -> Tuple[Set[str], Set[str]]:
    """(phones as their last 10 digits, emails in lower case) of the lead's usable contacts (keys_of)."""
    return keys_of(c for c in lead.get("contacts") or [] if _usable(c))


def city_key(city: Optional[str]) -> str:
    """'Lucknow, Uttar Pradesh ' -> 'lucknow'."""
    return (city or "").split(",")[0].strip().lower()


def name_words(name: Optional[str], city: str = "") -> frozenset:
    """The organisation name's distinctive words (engine_api.name_key, the words discovery dedupes
    on), without the city's: 'Quantum Coaching Lucknow' and 'Quantum Coaching Institute' are one
    name in Lucknow."""
    drop = set(re.findall(r"[a-z0-9]+", city))
    return frozenset(w for w in engine_api.name_key(name or "").split() if w not in drop)


def _shown(values: Iterable[str], limit: int = 3) -> str:
    items = sorted(values)
    more = f" (+{len(items) - limit} more)" if len(items) > limit else ""
    return ", ".join(items[:limit]) + more


def _domains(*domains: Optional[str]) -> Set[str]:
    """The organisation's own domains: its candidate domain and the one its home page opened on, never
    a shared host (blogspot.com, google.com...) that unrelated organisations also land on."""
    return {d.lower() for d in domains if d and not engine_api.is_excluded(d.lower())}


def judge(lead: Dict[str, Any], others: List[Dict[str, Any]], *, org_domain: Optional[str],
          site_domain: Optional[str] = None) -> Optional[Match]:
    """The first of `others` (oldest first) that is the same organisation as this lead, else the first
    possible duplicate, else None. Pure.

    org_domain: this candidate's domain; site_domain: the domain its home page opened on (a redirect).
    others: store.same_org_candidates rows {id, domain, site_domain, name, city, phones, emails}."""
    own = (org_domain or "").lower()
    mine = _domains(own, site_domain)
    phones, emails = contact_keys(lead)
    org = lead.get("organisation") or {}
    city = city_key(org.get("city"))
    words = name_words(org.get("name") or org.get("listed_name"), city)
    possible: Optional[Match] = None
    for other in others:
        domain = (other.get("domain") or "").lower()
        their_site = (other.get("site_domain") or "").lower()
        theirs = _domains(domain, their_site)
        their_emails = {email_key(e) for e in other.get("emails") or []}
        shared: List[str] = []
        if both := phones & set(other.get("phones") or []):
            shared.append(f"both show phone {_shown(both)}")
        if both := emails & their_emails:
            shared.append(f"both show email {_shown(both)}")
        if here := {e for e in emails if any(_on_domain(_mail_domain(e), d) for d in theirs)} - their_emails:
            shared.append(f"this site shows {_shown(here)}")
        if there := {e for e in their_emails if any(_on_domain(_mail_domain(e), d) for d in mine)} - emails:
            shared.append(f"{domain} shows {_shown(there)}")
        if domain and domain in mine:
            shared.append(f"this site opens on {domain}")
        elif own and their_site == own and own in theirs:
            shared.append(f"{domain} opens on {own}")
        if shared:
            return Match(SAME, other["id"], domain, tuple(shared))
        if (possible is None and words and city and city_key(other.get("city")) == city
                and name_words(other.get("name"), city) == words):
            possible = Match(POSSIBLE, other["id"], domain)
    return possible


def check(db, *, agent_id: str, candidate_id: str, lead: Dict[str, Any], org_domain: Optional[str],
          site_domain: Optional[str] = None) -> Optional[Match]:
    """Takes the agent's dedupe lock (held until the caller's transaction ends: save the result in
    the same session), reads the agent's other live candidates that could be this organisation, and
    judges them."""
    store.lock_agent_dedupe(db, agent_id)
    phones, emails = contact_keys(lead)
    others = store.same_org_candidates(
        db, agent_id=agent_id, candidate_id=candidate_id, statuses=LIVE_STATUSES, phones=sorted(phones),
        emails=sorted(emails), mail_domains=sorted({_mail_domain(e) for e in emails}),
        domains=sorted(_domains(org_domain, site_domain)),
        city=city_key((lead.get("organisation") or {}).get("city")), limit=MAX_OTHERS)
    return judge(lead, others, org_domain=org_domain, site_domain=site_domain)


def apply(result: Dict[str, Any], match: Optional[Match], gate_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """The research result after the check. SAME: SKIPPED, the note in delivery_note and first among
    the reasons (the dashboard shows the first reason), the gate's decision kept as it was. POSSIBLE:
    the flag added and the lead gated again, so it waits for a person instead of going out."""
    if match is None:
        return result
    scored = dict(result.get("score_json") or {})
    note = match.note()
    if match.kind == SAME:
        return {**result, "status": "SKIPPED", "delivery_note": note[:300], "reject_reason": None,
                "score_json": {**scored, "reasons": [note, *(scored.get("reasons") or [])], "gate_reasons": [note],
                               "duplicate_of": match.as_dict()}}
    flags = list(dict.fromkeys([*(scored.get("flags") or []), f"possible_duplicate:{match.domain}"]))
    scored = {**scored, "flags": flags, "possible_duplicate_of": match.as_dict()}
    decision, reasons = engine_api.gate(scored, result.get("lead_json") or {}, gate_cfg)
    status = {"AUTO": "APPROVED", "REVIEW": "REVIEW"}.get(decision, "REJECTED")
    return {**result, "status": status, "decision": decision if decision in ("AUTO", "REVIEW") else "REJECT",
            "score_json": {**scored, "gate_reasons": list(reasons)},
            "reject_reason": "; ".join(reasons)[:300] if status == "REJECTED" else None}


__all__ = ["SAME", "POSSIBLE", "LIVE_STATUSES", "Match", "phone_key", "email_key", "keys_of", "contact_keys",
           "city_key", "name_words", "judge", "check", "apply"]
