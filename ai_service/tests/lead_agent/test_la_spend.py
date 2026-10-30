"""Spend where it pays (2026-10-30): work research and discovery no longer waste.

* an organisation whose phone or email is already in the institute's leads is SKIPPED before the AI
  step (admin_core existing-contacts; an error there never stops research);
* the decision-maker lookup only for a lead the gate would not reject even with a contact;
* a discovery lane is done for the day when it wraps past the last results page or finds nothing new
  in two rounds; a round with every lane done spends nothing; the lanes come back the next day;
* the organisation and Maps lanes done: the round's budget goes to buying-signal searches; the
  new-centre searches run every third round;
* the cheap kind-of-organisation checks at discovery (Maps category, the selection prompt's kinds,
  sites that are never an organisation's own)."""
from __future__ import annotations

import asyncio
import re
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from conftest import BRIEF, INSTITUTE, PLAN, make_candidate, make_world
from app.services.lead_agent import admin_core, contact_hunt, discovery, engine_api, fetcher, llm, pacing
from app.services.lead_agent import research, store
from app.services.lead_agent import search as search_mod
from app.services.lead_agent.engine.discovery import kinds, pipeline
from app.services.lead_agent.search import SearchResult

HOME = ("WiNNERS Institute Indore\nCall our admissions team: +91 98765 12345\n"
        "Email: info@winnersinstitute.in\nJEE and NEET coaching since 2004.\n"
        "Admissions open for the 2027 batch.\nWe are hiring telecallers for our admissions office.\n"
        "Founder & Director: Aditya Patel")
OPEN_GATE = {"send_score": 0, "auto_score": 0, "review_score": 0, "min_contact": "likely", "require_intent": False}


def _extraction(in_segment: bool = True):
    return engine_api.schema("AccountExtraction").model_validate({
        "organisation_name": "WiNNERS Institute", "is_target_segment": in_segment,
        "what_they_do": "JEE and NEET coaching in Indore", "city": "Indore", "branches": [],
        "signals": [{"signal": "hiring", "observation": "Hiring telecallers", "event_date": None,
                     "cite": {"page": 1, "quote": "We are hiring telecallers for our admissions office."}}],
        "people": [], "current_software": [], "job_posts": [], "unknowns": [],
        "discovery_question": "How do you follow up on enquiries?", "summary": "A coaching institute.",
    })


@pytest.fixture
def scripted(monkeypatch):
    """A scripted LLM and searches; existing-contacts answers from `crm` (records what was asked)."""
    calls: list = []
    crm = SimpleNamespace(asked=[], phones=[], emails=[], error=None, in_segment=True)

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=4000):
        calls.append(purpose)
        if output.__name__ == "AccountExtraction":
            return _extraction(crm.in_segment)
        if output.__name__ == "ContactLookup":
            return output.model_validate({"people": []})
        raise AssertionError(output)
    monkeypatch.setattr(llm, "ask", fake_ask)

    class Search:
        available = True

        async def search(self, query, **kw):
            calls.append("search")
            return []

        async def maps(self, query, **kw):
            calls.append("maps")
            return []
    monkeypatch.setattr(search_mod, "parallel", lambda: Search())
    monkeypatch.setattr(search_mod, "serper", lambda: Search())
    monkeypatch.setattr("app.services.lead_agent.mx.mx_lookup", lambda d: True)

    async def existing(institute_id, phones, emails):
        crm.asked.append((institute_id, list(phones), list(emails)))
        if crm.error:
            raise crm.error
        return {"phones": [p for p in phones if p in crm.phones], "emails": [e for e in emails if e in crm.emails]}
    monkeypatch.setattr(admin_core, "existing_contacts", existing)
    return SimpleNamespace(calls=calls, crm=crm)


def _ready(la_db, agent, domain="winnersinstitute.in", home=HOME, **fields):
    cand = make_candidate(la_db, agent, domain, status="READY", **fields)
    with la_db() as db:
        store.upsert_page(db, org_id=cand["org_id"], url=f"https://{domain}/", page_type="home",
                          record={"access": "ok", "text": home, "links": [], "has_form": False,
                                  "final_url": f"https://{domain}/", "platform_hints": []},
                          fetched_by="SERVER", institute_id=cand["institute_id"])
        assert [r["id"] for r in store.claim_ready(db, 1)] == [cand["id"]]
        db.commit()
    return cand


def _row(la_db, cid):
    with la_db() as db:
        return db.execute(text("SELECT status, decision, reject_reason, delivery_note, lead_json, score_json "
                               "FROM lead_candidate WHERE id = :i"), {"i": cid}).mappings().first()


def _open_gate(la_db, agent, **extra):
    with la_db() as db:
        store.update_agent(db, agent["id"], INSTITUTE, {"gate_json": {**OPEN_GATE, **extra}})
        db.commit()


# ---------------------------------------------------------------- already in your leads, before the AI step

def test_an_organisation_already_in_the_leads_is_skipped_before_the_ai_step(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    scripted.crm.phones = ["9876512345"]
    cand = _ready(la_db, agent)
    assert asyncio.run(research.research_candidate(cand["id"])) == "SKIPPED"
    assert scripted.calls == []  # no extraction, no lookup, no search
    assert scripted.crm.asked == [(INSTITUTE, ["9876512345"], ["info@winnersinstitute.in"])]
    row = _row(la_db, cand["id"])
    assert row["delivery_note"] == research.ALREADY_IN_LEADS == "Already in your leads (same phone or email)"
    assert row["decision"] is None and row["reject_reason"] is None and row["lead_json"] is None
    assert row["score_json"]["already_in_leads"] == {"phones": ["9876512345"], "emails": []}
    with la_db() as db:
        day = db.execute(text("SELECT researched, review, rejected FROM lead_agent_day")).first()
    assert day is None or tuple(day) == (0, 0, 0)


def test_a_matching_email_is_enough(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    scripted.crm.emails = ["info@winnersinstitute.in"]
    cand = _ready(la_db, agent)
    assert asyncio.run(research.research_candidate(cand["id"])) == "SKIPPED"
    assert scripted.calls == []


def test_research_continues_when_nothing_is_in_the_leads(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    cand = _ready(la_db, agent)
    assert asyncio.run(research.research_candidate(cand["id"])) in ("APPROVED", "REVIEW", "REJECTED")
    assert scripted.calls[0] == "extract" and len(scripted.crm.asked) == 1
    assert _row(la_db, cand["id"])["lead_json"] is not None


def test_an_admin_core_error_never_stops_research(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    scripted.crm.error = admin_core.AdminCoreError("/existing-contacts: HTTP 503")
    cand = _ready(la_db, agent)
    assert asyncio.run(research.research_candidate(cand["id"])) in ("APPROVED", "REVIEW", "REJECTED")
    assert scripted.calls[0] == "extract"


def test_only_the_organisations_own_usable_contacts_are_looked_up():
    """Helplines, toll-free and template numbers and support inboxes are printed on other sites too; the
    Maps listing's number is the organisation's own."""
    page = ("Student support helpline: +91 98765 12345\nToll free: 1800 102 2727\nCall us: 98765 43210\n"
            "Admissions desk: +91 98450 11111\nsupport@winnersinstitute.in | info@winnersinstitute.in")
    contacts = engine_api.extract_contacts([{"url": "https://winnersinstitute.in/", "text": page, "links": [],
                                             "has_form": False, "page_type": "home"}], "winnersinstitute.in", "India")
    maps = contact_hunt.maps_phone({"maps": {"phone": "0731 405 8393", "address": "Indore"}}, "WiNNERS Institute",
                                   "winnersinstitute.in", "India", {})
    phones, emails = research.usable_keys(contacts, maps, site_domain="winnersinstitute.in",
                                          organisation="WiNNERS Institute", country="India")
    assert phones == {"9845011111", "7314058393"}
    assert emails == {"info@winnersinstitute.in"}


def test_nothing_usable_means_nothing_is_looked_up():
    asked = []
    assert research._already_in_leads(lambda p, e: asked.append((p, e)), set(), set()) is None
    assert asked == []


# --------------------------------------------------------------------------------- decision-maker lookup guard

def test_a_lead_the_gate_rejects_anyway_gets_no_decision_maker_lookup(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    _open_gate(la_db, agent)
    scripted.crm.in_segment = False  # "Not the kind of organisation the brief targets": a hard reject
    cand = _ready(la_db, agent)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REJECTED"
    assert "contacts" not in scripted.calls and "search" not in scripted.calls
    row = _row(la_db, cand["id"])
    assert "not_target_segment" in row["score_json"]["flags"]
    assert row["lead_json"]["fetch"]["decision_maker_lookup"] is False


def test_a_lead_in_the_segment_still_gets_its_lookup(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    _open_gate(la_db, agent)
    cand = _ready(la_db, agent)
    asyncio.run(research.research_candidate(cand["id"]))
    assert "search" in scripted.calls  # the lookup's search (a reachable phone: no contact hunt)
    assert _row(la_db, cand["id"])["lead_json"]["fetch"]["decision_maker_lookup"] is True


def test_the_lookup_guard():
    lead = {"contact_quality": {"level": "none"}}

    def as_scored(score, *flags):
        return {"score": score, "base_score": score, "flags": list(flags), "risk": 0}
    cfg = {"send_score": 50, "review_score": 50, "auto_score": 70, "min_contact": "likely"}
    same = lambda scored: (lambda _lead: scored)  # noqa: E731 - a rescore that changes nothing
    # its own score reaches the bar; only the contact is missing: looked up
    assert contact_hunt.worth_a_lookup(lead, as_scored(60, "no_contact"), cfg, same(as_scored(60)))
    # another segment or a competitor: never, whatever the score
    s = as_scored(90, "not_target_segment")
    assert not contact_hunt.worth_a_lookup(lead, s, cfg, same(s))
    s = as_scored(90, "sells_the_offer")
    assert not contact_hunt.worth_a_lookup(lead, s, cfg, same(s))
    # a weak lead is not lifted by a lookup (the Maps lookup and the hunt do that, at the agent's effort)
    assert not contact_hunt.worth_a_lookup(lead, as_scored(20, "no_contact"), cfg, same(as_scored(80)))
    # a list that takes only direct contacts: the lookup is the one search that can find one
    direct = {**cfg, "min_contact": "direct"}
    likely = {"contact_quality": {"level": "likely"}}
    assert contact_hunt.worth_a_lookup(likely, as_scored(60), direct, same(as_scored(60)))
    assert not contact_hunt.worth_searching(likely, as_scored(60), direct, same(as_scored(60)))


# --------------------------------------------------------------------------------------- discovery lanes

ORG_RESULTS = [("WiNNERS Institute - JEE Coaching Indore", "https://www.winnersinstitute.in/jee"),
               ("Pulse Academy | NEET coaching", "https://pulseacademy.co.in/")]


class FakeSerper:
    available = True

    def __init__(self):
        self.queries, self.maps_queries = [], []
        self.listings = [{"title": "IIT-PULSE Indore", "website": "http://www.iitpulse.com/", "phone": "+91 98937 04288",
                          "address": "AB Rd, Indore", "type": "Coaching center"}]

    async def search(self, query, *, gl=None, location=None, num=10, page=1, counter=None):
        self.queries.append((query, page))
        return [SearchResult(query=query, rank=i, title=t, url=u, snippet=f"{t} in Indore.")
                for i, (t, u) in enumerate(ORG_RESULTS, start=1)]

    async def maps(self, query, *, gl=None, location=None, page=1, counter=None):
        self.maps_queries.append((query, page))
        return list(self.listings)


@pytest.fixture
def lanes(monkeypatch):
    serper = FakeSerper()
    monkeypatch.setattr(search_mod, "serper", lambda: serper)
    monkeypatch.setattr(search_mod, "parallel", lambda: SimpleNamespace(available=False))
    asked = []

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=4000):
        asked.append(output.__name__)
        if output.__name__ == "DiscoverySelection":
            picks = [{"result_id": int(m.group(1)), "name": m.group(2).split(" - ")[0].strip(), "reason": "own site"}
                     for m in re.finditer(r"^\[(\d+)\] ([^|]+)\|", user, re.M)]
            return output.model_validate({"organisations": picks})
        return output.model_validate({"findings": []})
    monkeypatch.setattr(llm, "ask", fake_ask)

    async def unread(url, state=None):
        return None
    monkeypatch.setattr(fetcher, "read_post", unread)
    return SimpleNamespace(serper=serper, asked=asked)


# The lists PLAN's positions belong to (a cursor without them starts its lists again).
PLAN_KEYS = {"org_key": discovery._fingerprint(PLAN["search_queries"]),
             "maps_key": discovery._fingerprint(["coaching institute|Indore"])}


def _agent(la_db, sources, cursor=None, **brief):
    agent = make_world(la_db, mode="REMOTE", plan=PLAN)
    agent["brief_json"] = {**BRIEF, "sources": sources, **brief}
    if cursor is not None:
        agent["cursor_json"] = {"day": pacing.agent_day(agent["window_json"]).isoformat(), **PLAN_KEYS, **cursor}
    return agent


def _round(agent, plan=PLAN, need=10):
    return asyncio.run(discovery.run_round(agent, plan, need))


def test_a_lane_that_wraps_past_the_last_page_is_done_for_the_day(la_db, lanes):
    agent = _agent(la_db, ["organisation_search", "maps"], cursor={"org_page": discovery.MAX_PAGE})
    out = _round(agent)
    assert {p for _q, p in lanes.serper.queries} == {discovery.MAX_PAGE}
    cursor = agent["cursor_json"]
    assert cursor["lane_done"] == {"org": "wrapped"} and cursor["org_page"] == 1
    assert out["lanes_done"] == {"org": "wrapped"}
    lanes.serper.queries.clear()
    _round(agent)
    assert lanes.serper.queries == [] and lanes.serper.maps_queries  # page 1 waits for tomorrow; Maps goes on


def test_the_maps_lane_wrapping_past_the_last_page_stops_for_the_day(la_db, lanes):
    agent = _agent(la_db, ["maps"], cursor={"maps_page": discovery.MAX_PAGE})
    lanes.serper.listings = []
    _round(agent)
    # one industry in one place: its last page, then no page 1 in the same round
    assert lanes.serper.maps_queries == [("coaching institute Indore", discovery.MAX_PAGE)]
    assert agent["cursor_json"]["lane_done"] == {"maps": "wrapped"} and agent["cursor_json"]["maps_page"] == 1
    lanes.serper.maps_queries.clear()
    assert _round(agent)["skipped"] == "every search lane is used up for today"
    assert lanes.serper.maps_queries == []


def test_two_rounds_with_nothing_new_end_a_lane_and_a_round_with_every_lane_done_costs_nothing(la_db, lanes):
    agent = _agent(la_db, ["organisation_search"])
    assert _round(agent)["created"] == 2
    assert _round(agent)["created"] == 0 and agent["cursor_json"]["lane_dry"] == {"org": 1}
    assert "org" not in agent["cursor_json"]["lane_done"]
    _round(agent)
    assert agent["cursor_json"]["lane_done"] == {"org": "dry"}
    rounds = agent["cursor_json"]["rounds"]
    lanes.serper.queries.clear()
    lanes.asked.clear()
    out = _round(agent)
    assert out == {"skipped": "every search lane is used up for today", "lanes_done": {"org": "dry"}}
    assert lanes.serper.queries == [] and lanes.asked == []  # no search, no AI selection
    assert agent["cursor_json"]["rounds"] == rounds


def test_a_lane_that_finds_something_counts_from_zero_again():
    cursor = {"lane_dry": {"org": 1, "maps": 1}, "lane_done": {}}
    discovery._count_dry(cursor, {"org": True, "maps": True, "sig": False}, {"org": 1, "maps": 0, "sig": 0},
                         filled=False)
    assert cursor == {"lane_dry": {"org": 0, "maps": 2}, "lane_done": {"maps": "dry"}}


def test_a_round_that_found_all_it_wanted_counts_for_no_lane():
    cursor = {"lane_dry": {"maps": 1}, "lane_done": {}}
    discovery._count_dry(cursor, {"org": True, "maps": True, "sig": True}, {"org": 3, "maps": 0, "sig": 0},
                         filled=True)
    assert cursor == {"lane_dry": {"org": 0, "maps": 1}, "lane_done": {}}


def test_lanes_come_back_the_next_day(la_db, lanes):
    agent = _agent(la_db, ["organisation_search"])
    agent["cursor_json"] = {"day": "2026-10-29", "rounds": 30, "lane_done": {"org": "dry"}, "lane_dry": {"org": 2},
                            "org_key": discovery._fingerprint(PLAN["search_queries"]), "org_idx": 0, "org_page": 3}
    out = _round(agent)
    assert "skipped" not in out and lanes.serper.queries
    assert agent["cursor_json"]["lane_done"] == {} and agent["cursor_json"]["rounds"] == 1
    fresh = discovery._fresh_cursor({"day": "2026-10-29", "lane_done": {"maps": "wrapped"}, "lane_dry": {"sig": 1}},
                                    "2026-10-30")
    assert fresh["lane_done"] == {} and fresh["lane_dry"] == {} and fresh["rounds"] == 0


def test_a_rebuilt_plan_brings_its_lane_back(la_db, lanes):
    agent = _agent(la_db, ["organisation_search"], cursor={"lane_done": {"org": "dry"}, "lane_dry": {"org": 2}})
    assert _round(agent)["skipped"] == "every search lane is used up for today"
    out = _round(agent, {**PLAN, "search_queries": ["UPSC coaching Indore"]})
    assert "skipped" not in out and lanes.serper.queries == [("UPSC coaching Indore", 1)]


# ---------------------------------------------------------------------- the signal budget and the new-centre lane

@pytest.fixture
def captured(monkeypatch, lanes):
    """engine discover() replaced: records what each round asked of it, finds nothing."""
    seen = []

    def fake_discover(**kw):
        seen.append(kw)
        return SimpleNamespace(candidates=[], included=[], notes=[])
    monkeypatch.setattr(engine_api, "discover", fake_discover)
    return seen


def test_the_org_and_maps_lanes_done_give_their_budget_to_buying_signals(la_db, captured):
    agent = _agent(la_db, ["organisation_search", "maps", "hiring", "keyword"])
    _round(agent)
    assert captured[-1]["max_signal_queries"] == discovery.MAX_SIGNAL_QUERIES
    assert captured[-1]["max_keyword_queries"] == discovery.MAX_KEYWORD_QUERIES
    agent["cursor_json"]["lane_done"] = {"org": "wrapped", "maps": "dry"}
    out = _round(agent)
    kw = captured[-1]
    assert kw["max_signal_queries"] == discovery.MAX_SIGNAL_QUERIES * discovery.SIGNAL_BOOST
    assert kw["max_keyword_queries"] == discovery.MAX_KEYWORD_QUERIES * discovery.SIGNAL_BOOST
    assert kw["max_queries"] == 0 and kw["use_signals"] is True and out["signal_boost"] == discovery.SIGNAL_BOOST
    # one lane still searching: no boost
    agent["cursor_json"]["lane_done"] = {"org": "wrapped"}
    _round(agent)
    assert captured[-1]["max_signal_queries"] == discovery.MAX_SIGNAL_QUERIES


def test_a_signal_only_agent_keeps_its_normal_budget(la_db, captured):
    agent = _agent(la_db, ["hiring"])
    _round(agent)
    assert captured[-1]["max_signal_queries"] == discovery.MAX_SIGNAL_QUERIES


def test_the_boosted_signal_searches_are_the_ones_sent_to_parallel(la_db, lanes, monkeypatch):
    agent = _agent(la_db, ["organisation_search", "maps", "hiring"],
                   cursor={"lane_done": {"org": "wrapped", "maps": "wrapped"}})
    asked = []

    class Parallel:
        available = True

        async def search(self, query, *, objective=None, country=None, counter=None, **kw):
            asked.append(query)
            return []
    monkeypatch.setattr(search_mod, "parallel", lambda: Parallel())
    _round(agent)
    expected = discovery._signal_query_set(["hiring_callers", "linkedin_posts"], PLAN["industries_detail"], ["Indore"],
                                           PLAN, engine_api.resolve_offer(agent["brief_json"]), 0,
                                           discovery.MAX_SIGNAL_QUERIES * discovery.SIGNAL_BOOST)
    assert asked and set(asked) == expected and lanes.serper.queries == []
    assert len(expected) > len(discovery._signal_query_set(["hiring_callers", "linkedin_posts"],
                                                           PLAN["industries_detail"], ["Indore"], PLAN,
                                                           engine_api.resolve_offer(agent["brief_json"]), 0))


def test_new_centre_searches_run_every_third_round(la_db, captured):
    agent = _agent(la_db, ["hiring", "new_centre"])
    for _ in range(4):
        _round(agent)
        agent["cursor_json"]["lane_dry"] = {}  # the fake finds nothing: keep the lane from going dry
    assert ["new_centres" in kw["sources"] for kw in captured] == [True, False, False, True]
    assert all("hiring_callers" in kw["sources"] for kw in captured)
    assert discovery.round_sources(["new_centres", "hiring_callers"], 5) == ["hiring_callers"]
    assert discovery.round_sources(["new_centres"], 6) == ["new_centres"]


def test_a_new_centre_only_agent_idles_between_its_rounds_without_spending(la_db, captured, lanes):
    agent = _agent(la_db, ["new_centre"], cursor={"sig_turn": 1})
    out = _round(agent)
    assert captured == [] and lanes.asked == [] and out["created"] == 0
    assert agent["cursor_json"]["sig_turn"] == 2 and "sig" not in agent["cursor_json"]["lane_dry"]


# ------------------------------------------------------------------------- the kind of organisation, cheaply

GARMENTS = [{"name": "Garment manufacturers", "search_term": "garment manufacturer"},
            {"name": "Home furnishing producers", "search_term": "home furnishing manufacturer"},
            {"name": "Tailoring and alteration shops", "search_term": "tailor shop"}]
COACHING = [{"name": "Coaching institutes", "search_term": "coaching institute"},
            {"name": "Edtech platforms", "search_term": "edtech company"}]


@pytest.mark.parametrize("category, name, industries, other", [
    ("Furniture store", "Excel Furniture", GARMENTS, "furniture_interiors"),
    ("Department store", "Shoppers Stop", GARMENTS, "retail"),
    ("Garment exporter", "Stitch Well Exports", GARMENTS, None),          # the brief's kind
    ("Corporate office", "Lookmybiz", GARMENTS, None),                    # a category the table does not know
    ("Physiotherapist", "Dr. Abhishek Sharma", COACHING, "health"),
    ("Bank", "slice small finance bank", COACHING, "finance"),
    ("Stock broker", "Pinnacle Academy of Financial Markets", COACHING, None),  # its name shows a school
    ("Medical college", "GSVM Medical College", COACHING, None),           # a college is education too
    ("Software company", "Codons Technologies", COACHING, None),          # edtech is listed as software
    ("Restaurant", "Spice Hub", [{"name": "Consumer services (salons, gyms, travel)",
                                  "search_term": "consumer services"}], None),  # a broad industry: no check
    ("Bank", "HDFC Bank", [*COACHING, {"name": "Corporate training teams", "search_term": "corporate training"}],
     None),                                                                # every company has a training team
])
def test_a_maps_category_of_another_kind(category, name, industries, other):
    assert kinds.other_kind(category, name, industries) == other


def test_an_unknown_category_or_brief_is_always_kept():
    assert kinds.other_kind("", "Anything", GARMENTS) is None
    assert kinds.other_kind("Furniture store", "Excel", []) is None
    assert kinds.other_kind("Furniture store", "Excel", [{"name": "Solar panel installers"}]) is None
    assert kinds.brief_kinds(COACHING) == {"education", "software"}


def test_the_maps_lane_skips_another_kind_and_left_out_kinds_before_any_fetch(la_db, lanes):
    agent = _agent(la_db, ["maps"])
    lanes.serper.listings = [
        {"title": "Excel Furniture", "website": "https://excelfurniture.co.in/", "type": "Furniture store",
         "address": "Sector 63, Indore"},
        {"title": "Delhi Public School", "website": "https://dpsindore.org/", "type": "CBSE school",
         "address": "Nipania, Indore"},  # the brief leaves schools out
        {"title": "Lookmybiz", "website": "https://lookmybiz.in/", "type": "Corporate office", "address": "Indore"},
        {"title": "Shortened", "website": "https://bit.ly/abc123", "type": "Coaching center", "address": "Indore"},
        {"title": "IIT-PULSE Indore", "website": "http://www.iitpulse.com/", "type": "Coaching center",
         "address": "AB Rd, Indore"},
    ]
    plan = {**PLAN, "industries_detail": [{"name": "Coaching institutes", "search_term": "coaching institute"}]}
    out = _round(agent, plan)
    with la_db() as db:
        domains = {r[0] for r in db.execute(text("SELECT o.domain FROM lead_candidate c "
                                                 "JOIN lead_org o ON o.id = c.org_id"))}
    assert domains == {"lookmybiz.in", "iitpulse.com"}
    assert out["maps_other_kind"] == 1


def test_sites_that_are_never_an_organisations_own_are_excluded():
    for domain in ("bit.ly", "fb.me", "crunchbase.com", "rediff.com", "freshersnow.com", "mysuru.directory",
                   "getcampusinfo.com", "revenuebase.ai"):
        assert engine_api.is_excluded(domain), domain
    assert not engine_api.is_excluded("bitmesra.ac.in")
    from app.services.lead_agent.engine.discovery.domains import is_portal_name
    assert not is_portal_name("BIT") and is_portal_name("Rediff")


def test_the_selection_prompt_lists_every_kind_and_never_judges_the_place():
    industries = [{"name": "Real estate developers", "search_term": "real estate developer"},
                  {"name": "Coaching institutes and edtech", "search_term": "coaching institute"},
                  {"name": "Healthcare providers and clinics", "search_term": "clinic"}]
    plan = engine_api.schema("ResearchPlan").model_validate({
        **{k: PLAN[k] for k in engine_api.schema("ResearchPlan").model_fields if k in PLAN},
        "segment": "real estate developers"})  # the planner's one-line rewording drops kinds
    results = [SearchResult(query="q", rank=1, title="Finlearn Academy", url="https://finlearn.in/", snippet="x")]
    system, user = pipeline.build_selection_prompt(plan, results, 5, industries=industries)
    assert "Kinds wanted (any one is enough):\n- Real estate developers\n- Coaching institutes and edtech\n" \
           "- Healthcare providers and clinics\n" in user
    assert "Segment:" not in user and "real estate developers" not in user
    assert "ANY one of them is enough" in system and "never the location" in system
    assert "must match the requested" not in system
    assert re.search(r"^\[1\] Finlearn Academy \|", user, re.M)
    # no industries: the plan's segment stands in
    assert pipeline.kinds_wanted(plan, None) == ["real estate developers"]


def test_the_signal_prompt_never_takes_the_news_site_reporting_it():
    plan = engine_api.schema("ResearchPlan").model_validate(
        {k: PLAN[k] for k in engine_api.schema("ResearchPlan").model_fields if k in PLAN})
    system, _user = pipeline.build_signal_prompt(plan, [], hiring_roles=["telecaller"])
    assert "the news site, magazine or directory reporting it" in system
