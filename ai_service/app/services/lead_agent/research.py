"""Researching one READY candidate (spec §1 "research worker").

Cheapest filter first:
  1. free rejects, before any LLM call: suppressed domain, no readable page,
     left-out kind of organisation (by name), no contact at all, every contact
     suppressed;
  2. the engine: LLM extraction (quotes checked against the pages) ->
     build_lead (contacts rated, stage) -> platform fingerprint + size (no AI) ->
     score_lead;
  3. only when the score reaches the agent's review bar and the website shows
     no direct route: the decision-maker lookup (one Parallel search + one LLM
     reply, engine.research.contact_search), then the contacts are re-rated and
     the lead re-scored;
  4. engine.scoring.gate -> AUTO (APPROVED, waits for the window and quota),
     REVIEW, or REJECT; lead_json / score_json / stage / decision are saved.

The engine's functions are synchronous; the whole pipeline runs on a worker
thread and its search / ask calls hop back onto the event loop.
"""
from __future__ import annotations

import asyncio
import dataclasses
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from . import db as ladb
from . import engine_api, llm, pacing, planner, store
from . import search as search_mod
from .search import SearchCounter, SearchFailed

logger = logging.getLogger(__name__)

EXTRACT_MAX_TOKENS = 6000  # reasoning counts as output (llm.REASONING_EFFORT)
LOOKUP_MAX_TOKENS = 3000  # ~1,500 of it can be reasoning
LLM_RETRY_S = 600
INVALID_RETRY_S = 1800
DEFAULT_GATE = {"auto_score": 70, "review_score": 45, "min_contact": "likely", "require_intent": False}


class Rejected(Exception):
    """A free reject: no LLM call is spent on this candidate."""


def last10(value: Optional[str]) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else ""


def _filter_suppressed(contacts: List[Any], supp: Dict[str, set]) -> List[Any]:
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


def pipeline(data: Dict[str, Any], *, ask, search, mx=None) -> Dict[str, Any]:
    """The research of one candidate (blocking; pure apart from `ask` / `search`).
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

    if org["domain"] in supp.get("DOMAIN", set()):
        raise Rejected("Suppressed domain")
    ok = [p for p in pages if p["access"] == "ok" and (p.get("text") or "").strip()]
    if not ok or not any(p["page_type"] == "home" for p in ok):
        raise Rejected("No readable page (website could not be read)")
    name = org.get("name") or org["domain"]
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
    if not contacts and not any(r["has_form"] for r in raw):
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

    discovery = cand.get("discovery_json") or {}
    lead = engine_api.build_lead(
        name=name, website=org.get("website") or home["url"], domain=site_domain, extraction=extraction,
        pages=page_texts, contacts=contacts, products=offer, buyer_roles=buyer_roles,
        external_signals=discovery.get("signals") or [], signal_checks=None, hiring_roles=hiring_roles,
        country=country,
    )
    social = engine_api.social_links(raw)
    lead["social"] = social
    platforms = engine_api.detect_platforms(records, offer)
    size = engine_api.size_signals(records, social)
    score_brief = {**brief, "markets": markets}
    scored = engine_api.score_lead(lead, score_brief, platforms, size)

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

    decision, reasons = engine_api.gate(scored, lead, gate_cfg)
    status = {"AUTO": "APPROVED", "REVIEW": "REVIEW"}.get(decision, "REJECTED")
    lead["platforms"] = platforms
    lead["size"] = size
    # Billing (local vs remote) counts the pages fetched for THIS candidate, never pages reused
    # from the shared cache: data["own_extension_pages"] = its tasks the extension finished.
    lead["fetch"] = {"extension_pages": int(data.get("own_extension_pages") or 0),
                     "pages_used": len(ok), "agent_mode": agent.get("mode"),
                     "decision_maker_lookup": looked_up}
    return {
        "status": status, "decision": decision if decision in ("AUTO", "REVIEW") else "REJECT",
        "score": int(scored.get("score") or 0), "score_json": {**scored, "gate_reasons": list(reasons)},
        "lead_json": lead, "stage": (lead.get("stage") or None),
        "reject_reason": "; ".join(reasons)[:300] if status == "REJECTED" else None,
        "platforms": platforms, "size": size, "social": social,
        "org_name": (lead.get("organisation") or {}).get("name"), "org_city": (lead.get("organisation") or {}).get("city"),
    }


def _rejected_after_llm(reason: str) -> Dict[str, Any]:
    return {"status": "REJECTED", "decision": "REJECT", "score": None, "score_json": None, "lead_json": None,
            "stage": None, "reject_reason": reason[:300]}


def _save(cand: Dict[str, Any], agent: Dict[str, Any], result: Dict[str, Any]) -> Optional[str]:
    day = pacing.agent_day(agent.get("window_json"))
    with ladb.session() as db:
        row = store.set_candidate(
            db, cand["id"], expect=["RESEARCHING"], status=result["status"], decision=result["decision"],
            score=result.get("score"), score_json=result.get("score_json"), lead_json=result.get("lead_json"),
            stage=(result.get("stage") or None) and str(result["stage"])[:20], reject_reason=result.get("reject_reason"),
            claimed_at=None, last_error=None, not_before="now()")
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

    try:
        from .mx import mx_lookup

        result = await asyncio.to_thread(pipeline, data, ask=ask, search=search, mx=mx_lookup)
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


__all__ = ["Rejected", "pipeline", "research_candidate", "last10"]
