"""Researching one READY candidate (spec §1 "research worker").

Cheapest filter first:
  1. free rejects, before any LLM call: suppressed domain, no readable page
     (unless the Google Maps listing has a phone: then the lead is judged from
     the listing, without the model, and always waits for REVIEW), left-out kind
     of organisation (by name), no contact at all (neither on the website nor on
     its Google Maps listing), every contact suppressed;
  2. the engine: LLM extraction (quotes checked against the pages) ->
     build_lead (contacts rated, stage; the Maps listing's phone confirms a
     website number or is added as one more) -> platform fingerprint + size
     (no AI) -> score_lead;
  3. the searches the agent's validation effort buys (effort.py, contact_hunt.py),
     only for a lead that reaches the review bar once it has a reachable contact:
     a Maps search by name for a lead not found on Maps (STANDARD, DEEP), then,
     when the score reaches the bar and the website shows no direct route, the
     decision-maker lookup (one Parallel search + one LLM reply,
     engine.research.contact_search), then, while no reachable contact is known,
     the contact hunt (1 search on STANDARD, up to 3 on DEEP); the contacts are
     re-rated and the lead re-scored after each;
  4. engine.scoring.gate -> AUTO (APPROVED, waits for the window and quota),
     REVIEW, or REJECT (a lead with no usable contact says what was tried);
  5. a lead that is not rejected is checked against the agent's other live
     leads (dedupe.py, in the save's transaction): the same organisation under
     another domain is SKIPPED, a possible one waits for REVIEW;
     lead_json / score_json / stage / decision are saved.

The engine's functions are synchronous; the whole pipeline runs on a worker
thread and its search / ask calls hop back onto the event loop.
"""
from __future__ import annotations

import asyncio
import dataclasses
import logging
from typing import Any, Dict, List, Optional, Tuple

from . import db as ladb
from . import contact_hunt, dedupe, effort, engine_api, llm, pacing, planner, store
from . import search as search_mod
from .contact_hunt import MAPS_CONTEXT, MAPS_FOUND_BY, last10  # noqa: F401 - delivery imports last10 from here
from .contact_hunt import filter_suppressed as _filter_suppressed
from .contact_hunt import maps_phone as _maps_phone
from .contact_hunt import with_maps_phone as _with_maps_phone
from .search import SearchCounter, SearchFailed

logger = logging.getLogger(__name__)

EXTRACT_MAX_TOKENS = 6000  # reasoning counts as output (llm.REASONING_EFFORT)
LOOKUP_MAX_TOKENS = 3000  # ~1,500 of it can be reasoning
LLM_RETRY_S = 600
INVALID_RETRY_S = 1800
DEFAULT_GATE = {"auto_score": 70, "review_score": 45, "min_contact": "likely", "require_intent": False,
                "auto_competitor_users": False}
REGATE_MAX = 1000
UNREADABLE = "No readable page (website could not be read)"
MAPS_UNFIT = "Website unreadable and its Google Maps listing does not show the kind of organisation the brief targets"


class Rejected(Exception):
    """A free reject: no LLM call is spent on this candidate."""


def _load(candidate_id: str) -> Optional[Dict[str, Any]]:
    with ladb.session() as db:
        cand = store.get_candidate(db, candidate_id)
        if cand is None:
            return None
        agent = store.get_agent(db, cand["agent_id"])
        org = store.get_org(db, cand["org_id"])
        pages = store.org_pages(db, cand["org_id"], institute_id=cand["institute_id"])
        supp = store.suppressed(db, cand["institute_id"])
        own_extension_pages = store.candidate_extension_pages(db, candidate_id)
    return {"cand": cand, "agent": agent, "org": org, "pages": pages, "supp": supp,
            "own_extension_pages": own_extension_pages}


def pipeline(data: Dict[str, Any], *, ask, search, mx=None, maps=None, web=None) -> Dict[str, Any]:
    """The research of one candidate (blocking; pure apart from `ask` and the searches).
    search(query) is the decision-maker lookup's; maps(query) -> Google Maps places and
    web(query) -> web results are the searches the agent's validation effort may spend
    (contact_hunt.py), each step skipped without its callable.
    Returns {"status", "decision", "score", "score_json", "lead_json", "stage",
    "reject_reason", "platforms", "size", "social"}. Raises Rejected for a free
    reject, or whatever ask raises (InvalidOutput / LLMUnavailable)."""
    cand, agent, org, pages, supp = data["cand"], data["agent"], data["org"], data["pages"], data["supp"]
    brief = agent.get("brief_json") or {}
    plan = agent.get("plan_json") or {}
    gate_cfg = {**DEFAULT_GATE, **(agent.get("gate_json") or {})}
    markets = agent.get("markets_json") or []
    country = (markets[0] or {}).get("country") if markets else None
    place = (plan.get("places") or [None])[0]
    offer = engine_api.resolve_offer(brief)  # what is sold: the brief's offer, or its product keys
    buyer_roles = list(brief.get("buyer_roles") or plan.get("buyer_roles") or [])
    hiring_roles = plan.get("hiring_roles") or list(brief.get("hiring_roles") or []) or None
    exclude = plan.get("exclude") or list(brief.get("exclude") or [])
    level = effort.of(agent)
    discovery = cand.get("discovery_json") or {}

    if org["domain"] in supp.get("DOMAIN", set()):
        raise Rejected("Suppressed domain")
    name = org.get("name") or org["domain"]
    ok = [p for p in pages if p["access"] == "ok" and (p.get("text") or "").strip()]
    if not ok or not any(p["page_type"] == "home" for p in ok):
        return _judged_from_maps(data, name=name, discovery=discovery, offer=offer, brief=brief, plan=plan,
                                 markets=markets, country=country, buyer_roles=buyer_roles,
                                 hiring_roles=hiring_roles, exclude=exclude, gate_cfg=gate_cfg)
    if phrase := engine_api.left_out(name, exclude):
        raise Rejected(f"Left out: {phrase}")

    ok.sort(key=lambda p: (p["page_type"] != "home", p["fetched_at"]))
    home = ok[0]
    site_domain = engine_api.registered_domain(home.get("final_url") or home["url"]) or org["domain"]
    records = [{"url": p["url"], "final_url": p.get("final_url") or p["url"], "access": p["access"],
                "title": "", "text": p["text"] or "",
                "links": [tuple(l) for l in (p.get("links_json") or []) if isinstance(l, (list, tuple)) and len(l) >= 2],
                "has_form": bool(p.get("has_form")), "page_type": p["page_type"],
                "platform_hints": p.get("platform_hints_json") or []} for p in ok]
    raw = engine_api.contact_pages(records)
    contacts = engine_api.extract_contacts(raw, site_domain, country)
    contacts = _filter_suppressed(list(contacts), supp)
    if mx is not None:  # emails whose domain has no mail server would bounce
        contacts = [dataclasses.replace(c, mx=engine_api.mail_domain_ok(c.value.partition("@")[2], mx))
                    if getattr(c, "kind", "") == "published_email" and dataclasses.is_dataclass(c) else c
                    for c in contacts]
    # The Maps listing's number is a contact too: 21 of 29 "No contact published" rejects on
    # "Leads for Vacademy" had one (2026-10-29).
    maps_phone = _maps_phone(discovery, name, site_domain, country, supp)
    if not contacts and maps_phone is None and not any(r["has_form"] for r in raw):
        raise Rejected("No contact published (or every contact is suppressed)")

    page_texts = engine_api.extraction_pages(records)
    segment = plan.get("segment") or ", ".join(i.get("name", "") for i in plan.get("industries_detail") or [])
    if exclude:
        segment += f" (not: {', '.join(exclude)})"
    if brief.get("must_have"):
        segment += f"; must have: {'; '.join(map(str, brief['must_have']))}"
    system, user = engine_api.build_extraction_prompt(
        organisation=name, website=org.get("website") or home["url"], segment=segment,
        locations=plan.get("locations") or [], products=offer, pages=page_texts,
        max_input_chars=engine_api.config().max_input_chars,
        hiring_roles=engine_api.run_hiring_roles(offer, hiring_roles),
    )
    extraction = ask(system, user, engine_api.schema("AccountExtraction"), "extract", EXTRACT_MAX_TOKENS)
    phrase = engine_api.left_out(extraction.organisation_name or name, exclude) or (
        engine_api.left_out(extraction.what_they_do, exclude) if not extraction.is_target_segment else None)
    if phrase:
        return _rejected_after_llm(f"Left out: {phrase}")

    lead = engine_api.build_lead(
        name=name, website=org.get("website") or home["url"], domain=site_domain, extraction=extraction,
        pages=page_texts, contacts=contacts, products=offer, buyer_roles=buyer_roles,
        external_signals=discovery.get("signals") or [], signal_checks=None, hiring_roles=hiring_roles,
        country=country,
    )
    if maps_phone is not None:
        lead = engine_api.apply_rules(_with_maps_phone(lead, maps_phone), offer, buyer_roles, hiring_roles)
    social = engine_api.social_links(raw)
    lead["social"] = social
    platforms = engine_api.detect_platforms(records, offer)
    size = engine_api.size_signals(records, social)
    score_brief = {**brief, "markets": markets}

    def score(lead_: Dict[str, Any]) -> Dict[str, Any]:
        return engine_api.score_lead(lead_, score_brief, platforms, size)

    def rescore(lead_: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        lead_ = engine_api.apply_rules(lead_, offer, buyer_roles, hiring_roles)
        lead_["social"] = social
        return lead_, score(lead_)

    scored = score(lead)
    listing = discovery.get("maps") if isinstance(discovery.get("maps"), dict) and discovery.get("maps") else None
    city = (lead.get("organisation") or {}).get("city") or org.get("city") or place

    # Effort STANDARD / DEEP: a lead not found through the Maps lane is looked up on Maps once.
    maps_info = None
    if maps is not None and level.maps_lookup and listing is None \
            and contact_hunt.worth_searching(lead, scored, gate_cfg, score):
        try:
            lead, rescored, maps_info = contact_hunt.maps_lookup(lead, maps=maps, city=city, country=country,
                                                                 supp=supp, rescore=rescore)
            scored = rescored or scored
        except SearchFailed as exc:
            logger.info("lead agent: Google Maps lookup skipped (%s)", exc)

    looked_up = False
    if (int(scored.get("score") or 0) >= int(gate_cfg.get("review_score") or 0)
            and brief.get("find_contacts", True) is not False
            and (lead.get("contact_quality") or {}).get("level") != "direct"):
        try:
            found = engine_api.lookup_contacts(
                lead, place=place, country=country, search=search,
                ask=lambda s, u, model=None: ask(s, u, model or engine_api.schema("ContactLookup"), "contacts",
                                                 LOOKUP_MAX_TOKENS))
            lead = engine_api.merge_lookup(lead, found)
            lead["contacts"] = engine_api.check_mail_domains(lead["contacts"], mx)
            lead = engine_api.apply_rules(lead, offer, buyer_roles, hiring_roles)
            lead["social"] = social
            scored = engine_api.score_lead(lead, score_brief, platforms, size)
            looked_up = True
        except engine_api.invalid_output():
            pass  # the lookup's reply was unusable: the lead stands on its website contacts
        except SearchFailed as exc:
            logger.info("lead agent: decision-maker lookup skipped (%s)", exc)

    # Effort STANDARD / DEEP: still no contact outreach can use, the organisation's own is searched for.
    hunt_info = None
    if web is not None and level.contact_hunt_rounds > 0 and not contact_hunt.reachable(lead) \
            and contact_hunt.worth_searching(lead, scored, gate_cfg, score):
        lead, rescored, hunt_info = contact_hunt.hunt(
            lead, web=web, rounds=level.contact_hunt_rounds, social=level.social_pages, city=city, country=country,
            supp=supp, mx=mx, rescore=rescore)
        scored = rescored or scored

    decision, reasons = engine_api.gate(scored, lead, gate_cfg)
    status = {"AUTO": "APPROVED", "REVIEW": "REVIEW"}.get(decision, "REJECTED")
    if status == "REJECTED":
        reasons = _what_was_tried(reasons, maps_checked=listing is not None or maps_info is not None,
                                  decision_maker=looked_up, hunt_searches=(hunt_info or {}).get("searches", 0))
    lead["platforms"] = platforms
    lead["size"] = size
    # Billing (local vs remote) counts the pages fetched for THIS candidate, never pages reused
    # from the shared cache: data["own_extension_pages"] = its tasks the extension finished.
    lead["fetch"] = {"extension_pages": int(data.get("own_extension_pages") or 0),
                     "pages_used": len(ok), "agent_mode": agent.get("mode"),
                     "decision_maker_lookup": looked_up, "effort": level.level,
                     "maps_lookup": maps_info is not None,
                     "contact_hunt_searches": (hunt_info or {}).get("searches", 0)}
    return {
        "status": status, "decision": decision if decision in ("AUTO", "REVIEW") else "REJECT",
        "score": int(scored.get("score") or 0), "score_json": {**scored, "gate_reasons": list(reasons)},
        "lead_json": lead, "stage": (lead.get("stage") or None),
        "reject_reason": "; ".join(reasons)[:300] if status == "REJECTED" else None,
        "platforms": platforms, "size": size, "social": social,
        "org_name": (lead.get("organisation") or {}).get("name"), "org_city": (lead.get("organisation") or {}).get("city"),
    }


def _what_was_tried(reasons: List[str], **tried) -> List[str]:
    """The gate's "no usable contact" reason replaced by what research tried before giving up ("No
    reachable contact after the website, Google Maps and 1 contact search"), when it tried more than
    the website."""
    words = contact_hunt.no_contact_reason(**tried)
    none = engine_api.flag_words("no_contact")
    return [words if words and reason == none else reason for reason in reasons]


def _judged_from_maps(data: Dict[str, Any], *, name: str, discovery: Dict[str, Any], offer, brief: Dict[str, Any],
                      plan: Dict[str, Any], markets: List[dict], country: Optional[str], buyer_roles: List[str],
                      hiring_roles: Optional[List[str]], exclude: List[str],
                      gate_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """A candidate whose home page could not be read, judged from its Google Maps listing alone, at
    every effort level and for nothing (no model, no search). 2026-10-29 audit of "Leads for Vacademy":
    202 of 237 "No readable page" rejects had a listing with a phone, 125 of them with 100+ reviews.

    No listing phone (or it is suppressed): the old "No readable page" reject. The listing's category
    or name must show one of the brief's industries (engine scoring.maps_kind) and not a left-out kind,
    else MAPS_UNFIT. Then a minimal lead is built from the listing (name, category, address and city,
    rating, reviews, phone; nothing extracted by the model), scored with what is known, and sent to
    REVIEW with flag maps_only, never AUTO: a person decides on what a listing cannot show."""
    cand, agent, org, supp = data["cand"], data["agent"], data["org"], data["supp"]
    listing = discovery.get("maps") if isinstance(discovery.get("maps"), dict) else {}
    domain = org["domain"]
    phone = _maps_phone(discovery, name, domain, country, supp)
    if not listing or phone is None:
        raise Rejected(UNREADABLE)
    category = str(listing.get("type") or "").strip()
    if phrase := engine_api.left_out(f"{name} {category}", exclude):
        raise Rejected(f"Left out: {phrase}")
    kind = engine_api.maps_kind(category, name, plan.get("industries_detail") or brief.get("industries") or [])
    if kind is None:
        raise Rejected(MAPS_UNFIT)

    city = engine_api.listing_city(listing.get("address"), org.get("city"))
    rated = (f"rated {listing['rating']} from {listing.get('reviews') or 0} reviews"
             if listing.get("rating") is not None else None)
    seen = "; ".join(x for x in (category or None, rated, listing.get("address")) if x)
    extraction = engine_api.schema("AccountExtraction").model_validate({
        "organisation_name": name, "is_target_segment": True,
        "what_they_do": f"{category} (its Google Maps category)" if category else "Listed on Google Maps",
        "city": city, "sells_the_offer": False, "branches": [], "signals": [], "people": [], "current_software": [],
        "job_posts": [], "unknowns": ["What it offers and who runs it: its website could not be read"],
        "discovery_question": "",
        "summary": f"Judged from its Google Maps listing ({seen}): its website could not be read.",
    })
    lead = engine_api.build_lead(
        name=name, website=org.get("website") or f"https://{domain}/", domain=domain, extraction=extraction,
        pages=[], contacts=[], products=offer, buyer_roles=buyer_roles,
        external_signals=discovery.get("signals") or [], signal_checks=None, hiring_roles=hiring_roles,
        country=country)
    lead = _with_maps_phone(lead, phone)
    lead["maps_only"] = True
    lead["maps_listing"] = {**{k: listing.get(k) for k in ("type", "rating", "reviews", "address", "cid")
                               if listing.get(k) is not None}, "source": "maps lane", "matches": kind}
    lead["organisation"] = {**lead["organisation"],
                            "identity": "Google Maps listing only: the website could not be read"}
    lead["evidence"] = [*lead["evidence"], {"field": "Google Maps listing",
                                            "value": f"{category or 'Listed'}: matches \"{kind}\"",
                                            "quote": listing.get("address") or None, "url": phone["url"]}]
    lead = engine_api.apply_rules(lead, offer, buyer_roles, hiring_roles)
    lead["social"] = {}
    scored = engine_api.score_lead(lead, {**brief, "markets": markets}, [], {})
    decision, reasons = engine_api.gate(scored, lead, gate_cfg)
    status = {"AUTO": "APPROVED", "REVIEW": "REVIEW"}.get(decision, "REJECTED")
    lead["platforms"], lead["size"] = [], {}
    lead["fetch"] = {"extension_pages": int(data.get("own_extension_pages") or 0), "pages_used": 0,
                     "agent_mode": agent.get("mode"), "decision_maker_lookup": False,
                     "effort": effort.level(agent), "maps_only": True}
    return {
        "status": status, "decision": decision if decision in ("AUTO", "REVIEW") else "REJECT",
        "score": int(scored.get("score") or 0), "score_json": {**scored, "gate_reasons": list(reasons)},
        "lead_json": lead, "stage": (lead.get("stage") or None),
        "reject_reason": "; ".join(reasons)[:300] if status == "REJECTED" else None,
        "platforms": [], "size": {}, "social": {},
        "org_name": lead["organisation"].get("name"), "org_city": lead["organisation"].get("city"),
    }


def _rejected_after_llm(reason: str) -> Dict[str, Any]:
    return {"status": "REJECTED", "decision": "REJECT", "score": None, "score_json": None, "lead_json": None,
            "stage": None, "reject_reason": reason[:300]}


def _dedupe(db, cand: Dict[str, Any], agent: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    """A lead that is not rejected, checked against the agent's other live leads (dedupe.py) inside
    the save's transaction: the agent's lock is held until the save commits, so two workers saving
    two sites of one organisation at once cannot both pass. A failing check never blocks research:
    it is logged and the lead is saved as the gate decided."""
    lead = result.get("lead_json")
    if result["status"] not in ("APPROVED", "REVIEW") or not isinstance(lead, dict):
        return result
    try:
        with db.begin_nested():  # a failed query must not abort the save's transaction
            match = dedupe.check(db, agent_id=agent["id"], candidate_id=cand["id"], lead=lead,
                                 org_domain=cand.get("org_domain"),
                                 site_domain=(lead.get("organisation") or {}).get("domain"))
    except Exception:  # noqa: BLE001
        logger.exception("lead agent: duplicate check of %s failed; saved without it", cand["id"])
        return result
    return dedupe.apply(result, match, {**DEFAULT_GATE, **(agent.get("gate_json") or {})})


def _save(cand: Dict[str, Any], agent: Dict[str, Any], result: Dict[str, Any]) -> Optional[str]:
    """Writes the research result. A SKIPPED duplicate counts as researched (its LLM call was spent)
    and neither as review nor as rejected; it never takes a delivery slot."""
    day = pacing.agent_day(agent.get("window_json"))
    with ladb.session() as db:
        result = _dedupe(db, cand, agent, result)
        extra = {"delivery_note": result["delivery_note"]} if result.get("delivery_note") else {}
        row = store.set_candidate(
            db, cand["id"], expect=["RESEARCHING"], status=result["status"], decision=result["decision"],
            score=result.get("score"), score_json=result.get("score_json"), lead_json=result.get("lead_json"),
            stage=(result.get("stage") or None) and str(result["stage"])[:20], reject_reason=result.get("reject_reason"),
            claimed_at=None, last_error=None, not_before="now()", **extra)
        if row is None:
            return None  # re-armed meanwhile (lease ran out): the other attempt owns it now
        if result.get("platforms") is not None:
            store.update_org_facts(db, cand["org_id"], platforms=result.get("platforms"), size=result.get("size"),
                                   social=result.get("social"), city=result.get("org_city"))
        store.bump_day(db, agent["id"], day, researched=1 if result.get("lead_json") is not None else 0,
                       review=1 if result["status"] == "REVIEW" else 0,
                       rejected=1 if result["status"] == "REJECTED" else 0)
    return result["status"]


def _free_reject(cand: Dict[str, Any], agent: Dict[str, Any], reason: str) -> Optional[str]:
    return _save(cand, agent, _rejected_after_llm(reason))


def _renew(candidate_id: str) -> None:
    try:
        with ladb.session() as db:
            store.renew_research(db, candidate_id)
    except Exception:  # noqa: BLE001 - a missed renewal only risks a re-arm after the lease
        logger.warning("lead agent: could not renew the research lease of %s", candidate_id, exc_info=True)


def _release(candidate_id: str, error: str, delay_s: int) -> Optional[str]:
    with ladb.session() as db:
        return store.release_candidate(db, candidate_id, error, delay_s)


async def research_candidate(candidate_id: str) -> Optional[str]:
    """Research one claimed (RESEARCHING) candidate. Returns its new status."""
    data = await asyncio.to_thread(_load, candidate_id)
    if data is None or data["agent"] is None or data["org"] is None:
        return None
    cand, agent = data["cand"], data["agent"]
    if not agent.get("plan_json"):
        return await asyncio.to_thread(_release, candidate_id, "The agent has no plan yet", 300)
    loop = asyncio.get_running_loop()
    day = pacing.agent_day(agent.get("window_json"))
    ctx = llm.CallContext(institute_id=agent["institute_id"], agent_id=agent["id"], day=day, candidate_id=candidate_id)
    counter = SearchCounter(agent["id"], day)
    markets = agent.get("markets_json") or []
    country = search_mod.country_code((markets[0] or {}).get("country")) if markets else None

    def ask(system, user, output, purpose, max_tokens):
        _renew(candidate_id)  # each LLM step may take minutes: keep the claim's lease alive
        return search_mod.run_sync(loop, llm.ask(system, user, output, purpose=purpose, ctx=ctx,
                                                 max_tokens=max_tokens), timeout=300)

    def search(query: str):
        async def one():
            par = search_mod.parallel()
            if par.available:
                return await par.search(query, country=country, max_results=engine_api.lookup_results(),
                                        counter=counter)
            return await search_mod.serper().search(query, gl=country, counter=counter)
        return search_mod.run_sync(loop, one(), timeout=120)

    # The validation effort's searches (contact_hunt.py): Google through Serper, which reads "site:" and
    # "OR"; counted into the agent's day and cached like every search.
    def maps(query: str):
        return search_mod.run_sync(loop, search_mod.serper().maps(query, gl=country, counter=counter), timeout=120)

    def web(query: str):
        return search_mod.run_sync(loop, search_mod.serper().search(query, gl=country, counter=counter), timeout=120)

    try:
        from .mx import mx_lookup

        result = await asyncio.to_thread(pipeline, data, ask=ask, search=search, mx=mx_lookup, maps=maps, web=web)
    except Rejected as exc:
        return await asyncio.to_thread(_free_reject, cand, agent, str(exc))
    except llm.LLMUnavailable as exc:
        return await asyncio.to_thread(_release, candidate_id, f"LLM unavailable: {exc}", LLM_RETRY_S)
    except engine_api.invalid_output() as exc:
        return await asyncio.to_thread(_release, candidate_id, f"Unusable AI reply: {exc}", INVALID_RETRY_S)
    except Exception as exc:  # noqa: BLE001 - an engine bug on one site: retry later, FAILED at the cap
        logger.exception("lead agent: research of %s raised", candidate_id)
        return await asyncio.to_thread(_release, candidate_id, f"{type(exc).__name__}: {str(exc)[:500]}",
                                       INVALID_RETRY_S)
    return await asyncio.to_thread(_save, cand, agent, result)


def regate_waiting(db, agent: Dict[str, Any]) -> int:
    """The leads waiting for review, gated again with the agent's current gate (an admin lowered
    the bar or let competitor users through): those it now passes go on to delivery, as research
    would have sent them. Nothing is rejected or held back here. Returns how many moved."""
    gate_cfg = {**DEFAULT_GATE, **(agent.get("gate_json") or {})}
    rows, _total = store.list_candidates(db, agent["id"], status="REVIEW", page=0, size=REGATE_MAX)
    moved = 0
    for cand in rows:
        scored, lead = cand.get("score_json"), cand.get("lead_json")
        if not isinstance(scored, dict) or not isinstance(lead, dict):
            continue
        decision, reasons = engine_api.gate(scored, lead, gate_cfg)
        if decision == "AUTO" and store.set_candidate(
                db, cand["id"], expect=["REVIEW"], status="APPROVED", decision="AUTO",
                score_json={**scored, "gate_reasons": list(reasons)}, not_before="now()"):
            moved += 1
    return moved


__all__ = ["Rejected", "pipeline", "research_candidate", "regate_waiting", "last10"]
