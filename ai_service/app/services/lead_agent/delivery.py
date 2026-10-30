"""Delivering APPROVED leads into the agent's lead list (spec §1 "delivery", §5).

Inside the agent's window and while today's delivered count is below the daily
quota (and the monthly credit cap is not reached): the best-scored APPROVED
candidates are held (not_before pushed 10 minutes, SKIP LOCKED) so no other
replica takes them, re-checked against the institute's suppression list and
admin_core's existing-contacts (phone last 10 / email, institute-wide), then sent
through bulk-intake. CREATED -> DELIVERED + one charge (billing.charge);
DUPLICATE (or already a contact) -> SKIPPED with a note, free; FAILED / an error
-> stays APPROVED and is retried after the hold.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import admin_core, billing, engine_api, pacing, store
from . import db as ladb
from .research import last10

logger = logging.getLogger(__name__)

CHARGE_RETRY_LIMIT = 50


def _usable(contacts: List[dict]) -> List[dict]:
    return [c for c in contacts or [] if c.get("kind") != "contact_form" and c.get("quality") != "avoid"]


def e164(number: Optional[str], region: Optional[str]) -> Optional[str]:
    if not number:
        return None
    try:
        import phonenumbers

        parsed = phonenumbers.parse(number, (region or "IN").upper())
        if phonenumbers.is_possible_number(parsed):
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception:  # noqa: BLE001
        pass
    digits = "".join(ch for ch in number if ch.isdigit() or ch == "+")
    return digits or None


_TIER_RANK = {"direct": 0, "likely": 1, "general": 2}
# Whose mailbox an email is (engine contacts.OWNER_RANK, stored as "owner" when the lead is rated).
_OWNER_RANK = {"own": 0, "sister": 1, "org_free": 1, "org_named": 1, "person": 2, "unknown": 2, "free": 3,
               "other": 4}
_HONORIFICS = {"mr", "mrs", "ms", "miss", "dr", "er", "prof", "shri", "smt", "sri", "sir", "madam", "mam", "maj",
               "major", "col", "capt", "lt", "brig", "gen", "rev", "fr", "ca", "adv"}


def _org_domain(lead: dict) -> str:
    org = lead.get("organisation") or {}
    domain = (org.get("domain") or "").lower()
    if not domain and org.get("website"):
        domain = (urlparse(org["website"]).hostname or "").lower()
    return domain[4:] if domain.startswith("www.") else domain


def _email_rank(c: dict, org_domain: str) -> int:
    owner = c.get("owner")
    if owner is None:  # rated before owners were stored (2026-10-29): only its own domain is known
        domain = (c.get("value") or "").lower().partition("@")[2]
        owner = "own" if org_domain and (domain == org_domain or domain.endswith("." + org_domain)) else "unknown"
    return _OWNER_RANK.get(owner, 2)


def _phone_rank(c: dict, region: Optional[str]) -> Tuple[int, int, int, int]:
    """Outreach calls and WhatsApps the number sent, so: the tier first (a decision maker's own line,
    then a likely desk line, then a general one); within a tier a number of the lead's own country
    before a foreign one (2026-10-29 replay: mygreatlearning.com was sent "+1 512-647-2647" over its
    Bengaluru landline, both "general"), then a mobile before a landline (2026-10-29 audit: 42 live leads
    were sent a landline, 19 of them with a mobile on the lead), then one Google Maps also lists. The
    tier comes first: the replay sent iimidr.ac.in a student's mobile listed on its placements page
    ("Aarna Khera 9818457004", likely) over the chairman's own landline (direct). Maps only breaks ties:
    a desk mobile it lists must not beat the founder's own mobile."""
    home = 0 if engine_api.is_home_number(c, region) else 1
    mobile = 0 if engine_api.is_mobile(c, region) else 1
    maps = 0 if (c.get("maps_confirmed") or c.get("found_by") == "google_maps") else 1
    return _TIER_RANK.get(c.get("quality"), 3), home, mobile, maps


def _email_key(c: dict, org_domain: str) -> Tuple[int, int, int]:
    """A decision maker's own mailbox first (it reaches the person who buys), then by whose it is, then
    by tier."""
    return (0 if c.get("quality") == "direct" else 1), _email_rank(c, org_domain), _TIER_RANK.get(c.get("quality"), 3)


def best_contacts(lead: dict) -> Tuple[Optional[dict], Optional[dict], List[dict]]:
    """(phone contact, email contact, the other usable contacts) to send.

    The email: a decision maker's own mailbox first, then by whose it is: the organisation's own
    domain, a sister domain or a Gmail carrying its name, one tied to a named person, an unnamed Gmail
    last (2026-10-29: aadharinstitute.com was sent iguruji.in@gmail.com while aadharinstitute@gmail.com
    was on the lead). The phone by _phone_rank. Ties keep the rated order (best first)."""
    usable = _usable(lead.get("contacts") or [])
    region = lead.get("phone_region")
    org_domain = _org_domain(lead)
    phones = [c for c in usable if c.get("kind") in ("institute_phone", "whatsapp")]
    emails = [c for c in usable if c.get("kind") == "published_email"]
    phone = min(phones, key=lambda c: _phone_rank(c, region), default=None)
    email = min(emails, key=lambda c: _email_key(c, org_domain), default=None)
    # The Maps listing and the website can both carry the number sent: list it once.
    sent = {_contact_key(c) for c in (phone, email) if c}
    others = [c for c in usable if c is not phone and c is not email and _contact_key(c) not in sent]
    return phone, email, others


def _contact_key(c: dict) -> str:
    value = c.get("value") or ""
    return value.lower() if c.get("kind") == "published_email" else (last10(value) or value)


def _name_key(name: str) -> str:
    """A person's name compared without case, titles or a bracketed role."""
    words = re.findall(r"[a-z]+", re.sub(r"\([^)]*\)", " ", (name or "").lower()))
    return " ".join(w for w in words if w not in _HONORIFICS)


def _same_person(a: str, b: str) -> bool:
    """One person written two ways: "MAJ ASHOK YADAV" and "Major Ashok Yadav", "Anshudeep Singh Tomar"
    and "Anshudeep Tomar" (every word of the shorter name, at least two, in the longer one)."""
    ka, kb = _name_key(a).split(), _name_key(b).split()
    short, long_ = sorted((ka, kb), key=len)
    return bool(short) and (ka == kb or (len(short) >= 2 and set(short) <= set(long_)))


def _ask_for(lead: dict, phone: Optional[dict], email: Optional[dict]) -> dict:
    """{name, role} of the person outreach asks for: the local decision maker (a national brand's group
    leader does not buy for a centre), else the leader whose own mailbox is the email sent, else the
    person a web result showed with the number sent."""
    dm = lead.get("decision_maker") or {}
    if dm.get("name") and dm.get("scope") != "group":
        return dm
    owner = (email or {}).get("person") or {}
    if (owner.get("name") and (email or {}).get("quality") == "direct"
            and not (dm.get("name") and _same_person(owner["name"], dm["name"]))):
        return owner  # rated direct: a leader's own mailbox
    return (phone or {}).get("ask_for") or (email or {}).get("ask_for") or {}


def _how_to_reach(lead: dict, phone: Optional[dict], email: Optional[dict]) -> str:
    """"How to reach" describes the phone and email actually sent. The lead's contact_quality label
    describes its best-rated contact, which since 2026-10-29 may not be the one sent (an unnamed
    Gmail rated likely loses to the organisation's own inbox)."""
    parts = [f"{what}: {c['quality_note']}" for what, c in (("Phone", phone), ("Email", email))
             if c and c.get("quality_note")]
    return "; ".join(parts) or (lead.get("contact_quality") or {}).get("label") or ""


def _contact_line(c: dict) -> str:
    who = (c.get("person") or {}).get("name")
    bits = [c.get("value") or "", f"({c.get('quality')})" if c.get("quality") else ""]
    if who:
        bits.append(f"- {who}")
    return " ".join(b for b in bits if b)


def send_plan(cand: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """What delivery sends for a candidate (None when it has no phone or email): {phone, email, others}
    (contacts, best_contacts), full_name and role (who the lead is named after), ask_for ("Name (Role)",
    "" when nobody else) and how_to_reach. build_row and the dashboard (models.candidate_summary) both
    read it, so the card shows exactly what goes out."""
    lead = cand.get("lead_json") or {}
    org = lead.get("organisation") or {}
    phone, email, others = best_contacts(lead)
    if phone is None and email is None:
        return None
    # Named after the person the phone sent belongs to (outreach calls first and greets the full name);
    # only when no phone is sent, after the email's. On a desk line the lead is the organisation and the
    # decision maker is who to ask for: a front desk answered as the principal sounds wrong (2026-10-29:
    # glcmumbai.com was delivered as "Dr. Asmita A. Vaidya" on the college's reception landline; 335 of
    # 674 live leads were like it). The replay then named 30 leads after the email's owner while the
    # phone rang the desk, 9 of them with someone else to ask for (ymcacollege.ac.in, iitd.ac.in,
    # tomarchemistrytutorial.com).
    person = ((phone if phone is not None else email) or {}).get("person") or {}
    named = bool((person.get("name") or "").strip())
    full_name = person["name"].strip() if named else (org.get("name") or cand.get("org_name") or cand.get("org_domain"))
    role = (person.get("role") or "").strip() if named else ""
    who = _ask_for(lead, phone, email)
    ask_name, ask_role = (who.get("name") or "").strip(), (who.get("role") or "").strip()
    ask_for = f"{ask_name} ({ask_role})" if ask_name and ask_role else ask_name
    if named and _same_person(ask_name, full_name):
        ask_for = ""  # the line sent is already theirs
    return {"phone": phone, "email": email, "others": others, "full_name": full_name, "role": role,
            "ask_for": ask_for, "how_to_reach": _how_to_reach(lead, phone, email)}


def build_row(cand: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The bulk-intake row for a candidate (None when it has no phone or email)."""
    plan = send_plan(cand)
    if plan is None:
        return None
    lead = cand.get("lead_json") or {}
    org = lead.get("organisation") or {}
    scored = cand.get("score_json") or {}
    phone, email, others, full_name = plan["phone"], plan["email"], plan["others"], plan["full_name"]
    platforms = ", ".join(f"{p.get('name')} ({p.get('kind')})" for p in lead.get("platforms") or [] if p.get("name"))
    reasons = scored.get("reasons") or []
    top = lead.get("top_signal") or {}
    source_url = (top.get("url") or (cand.get("discovery_json") or {}).get("url") or org.get("website")
                  or cand.get("org_website") or "")
    evidence = []
    for e in (lead.get("evidence") or [])[:12]:
        if e.get("quote"):
            evidence.append(f"- {e.get('field')}: \"{str(e.get('quote'))[:200]}\" ({e.get('url')})")
    note = "Lead Agent evidence:\n" + ("\n".join(evidence) if evidence else "- (no quoted evidence)")
    if reasons:
        note += "\nWhy: " + "; ".join(map(str, reasons[:5]))
    return {
        "external_id": cand["id"],
        "full_name": (full_name or "")[:200],
        "email": (email or {}).get("value"),
        "mobile": e164((phone or {}).get("value"), lead.get("phone_region")),
        "custom_fields": {
            "la_org_name": org.get("name") or cand.get("org_name") or "",
            "la_website": org.get("website") or cand.get("org_website") or "",
            "la_city": org.get("city") or cand.get("org_city") or "",
            "la_role": plan["role"],
            "la_ask_for": plan["ask_for"],
            "la_contact_quality": plan["how_to_reach"],
            "la_other_contacts": "; ".join(_contact_line(c) for c in others[:5]),
            "la_score": str(cand.get("score") if cand.get("score") is not None else ""),
            "la_why": (lead.get("summary") or "; ".join(map(str, reasons[:3])))[:1000],
            "la_opening": lead.get("discovery_question") or "",
            "la_platforms": platforms,
            "la_source_url": source_url,
        },
        "note": note[:4000],
    }


def _suppressed_row(row: Dict[str, Any], supp: Dict[str, set], domain: Optional[str]) -> Optional[str]:
    if domain and domain in supp.get("DOMAIN", set()):
        return "Suppressed domain"
    if row.get("mobile") and last10(row["mobile"]) in supp.get("PHONE", set()):
        return "Suppressed phone"
    if row.get("email") and row["email"].lower() in supp.get("EMAIL", set()):
        return "Suppressed email"
    return None


MAX_DELIVERY_ATTEMPTS = 5
CREATED_STATUSES = ("CREATED", "ALREADY_CREATED")   # bulk-intake is idempotent on external_id


def _prepare(agent: Dict[str, Any], want: int, day, quota: int,
             only_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Hold up to `want` APPROVED candidates (of only_ids, when given) and take as many of
    today's delivery slots (atomically, lead_agent_day.delivered); held candidates without a
    slot are let go again."""
    with ladb.session() as db:
        picked = store.claim_approved(db, agent["id"], want, ids=only_ids)
        granted = store.reserve_deliveries(db, agent["id"], day, len(picked), quota)
        for extra in picked[granted:]:
            store.set_candidate(db, extra["id"], expect=["APPROVED"], not_before="now()")
        supp = store.suppressed(db, agent["institute_id"])
        full = [store.get_candidate(db, c["id"]) for c in picked[:granted]]
    return {"picked": [c for c in full if c], "supp": supp, "granted": granted}


def _release_slots(agent: Dict[str, Any], day, n: int) -> None:
    with ladb.session() as db:
        store.release_deliveries(db, agent["id"], day, n)


def _skip(cand_id: str, note: str) -> None:
    with ladb.session() as db:
        store.set_candidate(db, cand_id, expect=["APPROVED"], status="SKIPPED", delivery_note=note[:300])


def _delivered(cand_id: str, response_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """APPROVED -> DELIVERED (its slot was reserved already)."""
    with ladb.session() as db:
        return store.set_candidate(db, cand_id, expect=["APPROVED"], status="DELIVERED",
                                   delivered_response_id=(response_id or None) and str(response_id)[:255],
                                   delivered_at="now()", delivery_note=None, last_error=None)


def _failed(cand: Dict[str, Any], message: str) -> str:
    """A delivery attempt failed: retry after the hold, FAILED at the attempts cap."""
    attempts = int(cand.get("delivery_attempts") or 0) + 1
    with ladb.session() as db:
        if attempts >= MAX_DELIVERY_ATTEMPTS:
            store.set_candidate(db, cand["id"], expect=["APPROVED"], status="FAILED", delivery_attempts=attempts,
                                delivery_note=f"Delivery failed {attempts} times: {message}"[:300],
                                last_error=f"delivery: {message}"[:2000])
            return "FAILED"
        store.set_candidate(db, cand["id"], expect=["APPROVED"], delivery_attempts=attempts,
                            last_error=f"delivery: {message}"[:2000])
    return "RETRY"


def _mark_sent(ids: List[str]) -> None:
    """Before a bulk-intake call: a retry of these rows goes straight to bulk-intake
    (idempotent on external_id), skipping the existing-contacts check that would
    otherwise find the lead an earlier, half-answered call created."""
    from sqlalchemy import text

    with ladb.session() as db:
        db.execute(text("UPDATE lead_candidate SET intake_attempted_at = COALESCE(intake_attempted_at, now()) "
                        "WHERE id = ANY(CAST(:ids AS VARCHAR[]))"), {"ids": list(ids)})


def _uncharged(agent_id: str) -> List[Dict[str, Any]]:
    with ladb.session() as db:
        ids = store.uncharged_delivered(db, agent_id, CHARGE_RETRY_LIMIT)
        return [c for c in (store.get_candidate(db, i) for i in ids) if c]


async def deliver(agent: Dict[str, Any], *, now=None, ignore_window: bool = False,
                  only_ids: Optional[List[str]] = None) -> Dict[str, int]:
    """One delivery pass for an agent. Returns counts. ignore_window / only_ids: an admin's Sync
    now, which delivers outside the window too, all approved leads or the ones picked (the daily
    quota and the monthly credit cap still apply)."""
    out = {"delivered": 0, "skipped": 0, "failed": 0}
    # charges that were not settled earlier (same idempotency key; charged_at marks settled)
    for cand in await asyncio.to_thread(_uncharged, agent["id"]):
        await asyncio.to_thread(billing.charge, cand, agent)
    if not ignore_window and not pacing.in_window(agent.get("window_json"), now):
        return out
    quota = int(agent.get("daily_quota") or 0)
    want = quota
    cap_room = await asyncio.to_thread(billing.cap_room, agent)
    if cap_room is not None:
        want = min(want, cap_room)
    if only_ids is not None:
        want = min(want, len(only_ids))
    if want <= 0:
        return out
    day = pacing.agent_day(agent.get("window_json"), now)
    prep = await asyncio.to_thread(_prepare, agent, want, day, quota, only_ids)
    unused = 0          # reserved slots not turned into a delivered lead

    async def give_back(n: int = 1) -> None:
        nonlocal unused
        unused += n

    try:
        by_id: Dict[str, Dict[str, Any]] = {}
        retry_rows: List[Dict[str, Any]] = []
        fresh_rows: List[Dict[str, Any]] = []
        for cand in prep["picked"]:
            row = build_row(cand)
            if row is None:
                await asyncio.to_thread(_skip, cand["id"], "No phone or email to deliver")
                out["skipped"] += 1
                await give_back()
                continue
            reason = _suppressed_row(row, prep["supp"], cand.get("org_domain"))
            if reason and cand.get("intake_attempted_at") is None:
                await asyncio.to_thread(_skip, cand["id"], reason)
                out["skipped"] += 1
                await give_back()
                continue
            by_id[cand["id"]] = cand
            (retry_rows if cand.get("intake_attempted_at") is not None else fresh_rows).append(row)

        if fresh_rows:
            try:
                found = await admin_core.existing_contacts(
                    agent["institute_id"], [p for p in (last10(r.get("mobile")) for r in fresh_rows) if p],
                    [r["email"].lower() for r in fresh_rows if r.get("email")])
            except admin_core.AdminCoreError as exc:
                logger.warning("lead agent: existing-contacts failed for agent %s: %s", agent["id"], exc)
                for r in fresh_rows:
                    await asyncio.to_thread(_failed, by_id[r["external_id"]], str(exc))
                    out["failed"] += 1
                    await give_back()
                fresh_rows = []
                found = {}
            phones, emails = set(found.get("phones") or []), set(found.get("emails") or [])
            keep = []
            for r in fresh_rows:
                if (r.get("mobile") and last10(r["mobile"]) in phones) or (
                        r.get("email") and r["email"].lower() in emails):
                    await asyncio.to_thread(_skip, r["external_id"], "Already in your leads (same phone or email)")
                    out["skipped"] += 1
                    await give_back()
                else:
                    keep.append(r)
            fresh_rows = keep

        to_send = retry_rows + fresh_rows
        for i in range(0, len(to_send), admin_core.BULK_ROWS):
            chunk = to_send[i:i + admin_core.BULK_ROWS]
            await asyncio.to_thread(_mark_sent, [r["external_id"] for r in chunk])
            try:
                results = await admin_core.bulk_intake(agent["institute_id"], agent["audience_id"], chunk)
            except admin_core.AdminCoreError as exc:
                # This chunk only: earlier chunks keep their results; these rows retry (idempotent).
                logger.warning("lead agent: bulk-intake chunk failed for agent %s: %s", agent["id"], exc)
                for r in chunk:
                    await asyncio.to_thread(_failed, by_id[r["external_id"]], str(exc))
                    out["failed"] += 1
                    await give_back()
                continue
            seen = set()
            for res in results:
                cid = res.get("external_id")
                if cid not in by_id or cid in seen or cid not in {r["external_id"] for r in chunk}:
                    continue
                seen.add(cid)
                status = str(res.get("status") or "").upper()
                if status in CREATED_STATUSES:
                    row = await asyncio.to_thread(_delivered, cid, res.get("response_id"))
                    if row is not None:
                        out["delivered"] += 1
                        await asyncio.to_thread(billing.charge, {**by_id[cid], **row}, agent)
                    else:
                        await give_back()
                elif status == "DUPLICATE":
                    await asyncio.to_thread(_skip, cid, (res.get("message") or "Duplicate in the lead list")[:300])
                    out["skipped"] += 1
                    await give_back()
                else:
                    await asyncio.to_thread(_failed, by_id[cid], res.get("message") or status or "no result")
                    out["failed"] += 1
                    await give_back()
            for r in chunk:
                if r["external_id"] not in seen:
                    await asyncio.to_thread(_failed, by_id[r["external_id"]], "no result for this row")
                    out["failed"] += 1
                    await give_back()
    finally:
        await asyncio.to_thread(_release_slots, agent, day, unused)
    return out


__all__ = ["build_row", "deliver", "e164", "best_contacts", "send_plan"]
