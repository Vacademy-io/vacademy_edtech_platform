"""An agent's offer (engine/offer.py): research, scoring and prompts follow what the institute sells,
not Vacademy's product catalogue; briefs with only product keys behave as before."""

from __future__ import annotations

from datetime import date

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.fingerprint import detect_platforms
from app.services.lead_agent.engine.offer import as_offer, offer_dict, resolve_offer
from app.services.lead_agent.engine.planning import build_plan_prompt, guided_from_brief
from app.services.lead_agent.engine.profiles import build_profile_prompt, parse_profile
from app.services.lead_agent.engine.research.contacts import Contact
from app.services.lead_agent.engine.research.extract import PageText, build_extraction_prompt
from app.services.lead_agent.engine.research.lead import build_lead
from app.services.lead_agent.engine.schemas import AccountExtraction
from app.services.lead_agent.engine.scoring import score_lead

TODAY = date(2026, 10, 25)
SITE = "https://www.kesar-logistics.in/"
SOLAR = {
    "name": "Rooftop solar installation", "seller": "SunGrid", "website": None,
    "fit_signals": [
        {"label": "Owns a warehouse or factory", "description": "The site says it runs its own warehouse, plant or factory.",
         "weight": 3},
        {"label": "Cold storage", "description": "The site mentions cold storage or refrigerated rooms.", "weight": 2},
    ],
    "competitors": [{"name": "Tata Power Solar", "domain": "tatapowersolar.com"}],
    "competitor_kinds": [], "education": False, "discovery_question": "What do you pay for power each month?",
}
BRIEF = {"products": [], "offer": SOLAR, "description": "Solar rooftops for warehouses that want lower power bills.",
         "industries": [{"name": "Warehouses", "search_term": "warehouse"}],
         "buyer_roles": ["owner"], "markets": [{"country": "India", "city": "Indore"}]}
HOME = ("Kesar Logistics, Indore\nOur 40,000 sq ft warehouse at Pithampur\nCold storage rooms for pharma\n"
        "Looking for rooftop solar vendors for our warehouse\nCall 98260 12345")
PAGES = [PageText(1, SITE, "home", "Kesar", HOME)]


def _extraction(signals):
    return AccountExtraction.model_validate({
        "organisation_name": "Kesar Logistics", "is_target_segment": True, "what_they_do": "Warehousing in Indore.",
        "city": "Indore", "branches": [], "people": [], "current_software": [], "unknowns": [],
        "discovery_question": "", "summary": "",
        "signals": [{"signal": k, "observation": q, "event_date": None, "cite": {"page": 1, "quote": q}}
                    for k, q in signals],
    })


def _lead(signals, brief=BRIEF):
    return build_lead(name="Kesar Logistics", website=SITE, domain="kesar-logistics.in", extraction=_extraction(signals),
                      pages=PAGES, contacts=[Contact("institute_phone", "+91 98260 12345", SITE, "mobile")],
                      products=resolve_offer(brief), buyer_roles=["owner"], country="India")


def test_an_offer_brings_its_own_signals_and_a_brief_with_products_keeps_the_catalogue():
    offer = resolve_offer(BRIEF)
    assert offer.custom and offer.products == ("offer",)
    assert {"fit_1", "fit_2", "explicit_software_need", "hiring"} <= set(offer.signals)
    assert "test_series" not in offer.signals and "admissions_open" not in offer.signals
    assert "Rooftop solar installation" in offer.signals["explicit_software_need"].description
    legacy = resolve_offer({"products": ["complete_vacademy"]})
    assert not legacy.custom and legacy.education and "test_series" in legacy.signals
    assert as_offer(["crm"]).products == ("crm",)


def test_the_extraction_prompt_is_about_the_offer_not_vacademy():
    system, user = build_extraction_prompt(organisation="Kesar Logistics", website=SITE, segment="warehouses",
                                           locations=["Indore"], products=resolve_offer(BRIEF), pages=PAGES,
                                           max_input_chars=40_000)
    assert "SunGrid's sales team" in system and "Vacademy" not in system
    assert "fit_1: The site says it runs its own warehouse" in system and "test_series" not in system
    assert "Being sold: Rooftop solar installation" in user


def test_signals_outside_the_offer_are_dropped_and_its_own_count():
    lead = _lead([("fit_1", "Our 40,000 sq ft warehouse at Pithampur"), ("test_series", "Cold storage rooms for pharma"),
                  ("explicit_software_need", "Looking for rooftop solar vendors for our warehouse")])
    keys = {s["key"] for s in lead["signals"]}
    assert keys == {"fit_1", "explicit_software_need"}  # an explicit need names the offer, no software word needed
    assert lead["primary_product"]["name"] == "Rooftop solar installation"
    assert lead["discovery_question"] == "What do you pay for power each month?"
    scored = score_lead(lead, BRIEF, [], {}, today=TODAY)
    assert scored["fit"] == 30 + 10 + 15  # segment + Indore + a high-weight fit signal
    assert scored["has_intent"] and scored["intent"] == 70


def test_competitors_follow_the_offer():
    lead = _lead([("fit_1", "Our 40,000 sq ft warehouse at Pithampur")])
    appx = [{"key": "appx", "name": "Appx", "kind": "lms", "competitor": True, "evidence": "x", "url": SITE}]
    assert score_lead(lead, BRIEF, appx, {}, today=TODAY)["risk"] == 0  # a course app does not compete with solar
    lms_seller = {**BRIEF, "offer": {**SOLAR, "competitor_kinds": ["lms"]}}
    assert "competitor_platform:appx" in score_lead(lead, lms_seller, appx, {}, today=TODAY)["flags"]

    offer = resolve_offer(BRIEF)
    page = {"url": SITE, "text": "Powered by Tata Power Solar", "links": [], "platform_hints": []}
    found = offer.mark_competitors(detect_platforms([page], offer.extra_vendors()))
    assert [(p["name"], p["competitor"]) for p in found] == [("Tata Power Solar", True)]
    scored = score_lead(lead, BRIEF, found, {}, today=TODAY)
    assert scored["risk"] == 40 and "competitor_platform:tatapowersolar.com" in scored["flags"]


def test_an_organisation_that_sells_the_offer_is_rejected():
    lead = _lead([("fit_1", "Our 40,000 sq ft warehouse at Pithampur")])
    lead["organisation"] = {**lead["organisation"], "sells_the_offer": True}
    scored = score_lead(lead, BRIEF, [], {}, today=TODAY)
    assert "sells_the_offer" in scored["flags"]
    from app.services.lead_agent.engine.scoring import DEFAULT_GATE, gate
    decision, reasons = gate(scored, lead, DEFAULT_GATE)
    assert decision == "REJECT" and "competitor or reseller" in reasons[0]


def test_a_news_story_is_not_taken_for_the_organisations_website():
    from app.services.lead_agent.engine.discovery.pipeline import match_supplied_name
    from app.services.lead_agent.engine.discovery.search import SearchResult

    story = SearchResult(query="q", rank=1, title="BKT Tyres Opens New Indore Warehouse | Autocar Professional",
                         url="https://www.autocarpro.in/news/bkt-tyres-expands-commercial-distribution-with-new-indore-warehouse-134246",
                         snippet="BKT Tyres opens a new warehouse in Indore")
    own = SearchResult(query="q", rank=2, title="BKT Tyres - Off-highway tyres", url="https://www.bkt-tires.com/in/en",
                       snippet="")
    assert match_supplied_name("BKT Tyres", [story], set()) is None
    assert match_supplied_name("BKT Tyres", [story, own], set()).url == own.url
    park = SearchResult(query="q", rank=1, title="Adani Logistics Park", url="https://adanilogisticspark.com/", snippet="")
    assert match_supplied_name("Mahindra Logistics", [park], set()) is None  # a sector word is not a name
    guru = SearchResult(query="q", rank=1, title="HomeGuru World - tutors in Gurgaon", url="https://homeguruworld.com/",
                        snippet="")
    assert match_supplied_name("Pathways World School Gurgaon", [guru], set()) is None  # not its first word


def test_a_framework_never_competes():
    lead = _lead([("fit_1", "Our 40,000 sq ft warehouse at Pithampur")])
    site_seller = {**BRIEF, "offer": {**SOLAR, "competitor_kinds": ["website"]}}
    nextjs = [{"key": "nextjs", "name": "Next.js", "kind": "framework", "competitor": False, "evidence": "x", "url": SITE}]
    wix = [{"key": "wix", "name": "Wix", "kind": "website", "competitor": False, "evidence": "x", "url": SITE}]
    assert score_lead(lead, site_seller, nextjs, {}, today=TODAY)["risk"] == 0
    assert score_lead(lead, site_seller, wix, {}, today=TODAY)["risk"] == 40


def test_education_checks_only_for_education_offers():
    lead = _lead([("fit_1", "Our 40,000 sq ft warehouse at Pithampur")])
    lead["organisation"] = {**lead["organisation"], "name": "ALLEN Logistics", "domain": "allen.in"}
    assert "enterprise" not in score_lead(lead, BRIEF, [], {"tier": "micro"}, today=TODAY)["flags"]
    assert "micro" not in score_lead(lead, BRIEF, [], {"tier": "micro"}, today=TODAY)["flags"]
    school = {**BRIEF, "offer": {**SOLAR, "education": True}}
    assert "enterprise" in score_lead(lead, school, [], {}, today=TODAY)["flags"]


def test_planning_and_profile_prompts_name_the_offer():
    guided = guided_from_brief(BRIEF, BRIEF["markets"], 20)
    assert guided["products"] == ["offer"] and guided["offer"]["name"] == "Rooftop solar installation"
    system, user = build_plan_prompt("Selling: rooftop solar", 0, guided=guided)
    assert "offer: Rooftop solar installation" in system and "Vacademy" not in system
    system, user = build_profile_prompt([], "For warehouses", None, name="Rooftop solar installation", seller="SunGrid")
    assert "SunGrid's sales team" in system and "coaching" not in system and "What is sold: Rooftop solar" in user
    system, _ = build_profile_prompt(["lms"], None, None)
    assert "Vacademy sells to coaching institutes" in system  # Vacademy's own products keep its education rule


def test_the_profile_reply_carries_an_offer():
    reply = {
        "summary": "Rooftop solar.", "keywords": ["need rooftop solar"], "offer_name": "Solar",
        "industries": [{"name": "Warehouses", "search_term": "warehouse", "fit": "high", "why": "Big roofs.",
                        "products": ["crm"], "buyer_roles": ["owner"], "hiring_phrases": [], "need_phrases": []}],
        "fit_signals": [{"label": "Big roof", "description": "Large sheds.", "weight": 3},
                        {"label": "big roof", "description": "dupe", "weight": 1}],
        "competitors": [{"name": "Tata Power Solar", "domain": "https://www.tatapowersolar.com/"}],
        "competitor_kinds": ["crm", "crm"], "education": False, "discovery_question": "What is your power bill?",
    }
    data = parse_profile(reply, name="Rooftop solar installation")
    assert data["industries"][0]["products"] == ["offer"]
    assert data["offer"]["name"] == "Rooftop solar installation"
    assert data["offer"]["fit_signals"] == [{"label": "Big roof", "description": "Large sheds.", "weight": 3}]
    assert data["offer"]["competitors"] == [{"name": "Tata Power Solar", "domain": "tatapowersolar.com"}]
    assert data["offer"]["competitor_kinds"] == ["crm"]


def test_an_older_brief_gets_an_offer_the_form_can_edit():
    derived = offer_dict({"products": ["complete_vacademy"]})
    assert derived["name"] == "Complete Vacademy" and derived["education"] is True
    assert {"Online courses", "Test series"} <= {s["label"] for s in derived["fit_signals"]}
    assert offer_dict(BRIEF) is SOLAR
