"""Judging the kind of organisation and "sells what you sell" (2026-10-30 prod audit of 5 agents: 42 of 179
"not the kind" rejects were a kind the brief lists, 34 more were pages of another organisation, and 16 of 38
"sells what you sell" flags were false). The model cannot run offline, so this tests what the code controls:

* the extraction prompt names every industry of the brief (any one is enough, each read broadly), the
  plan's segment only as a hint, and says the offer is what we sell, not who buys it;
* markets one per line, never flattened into one place ("Rajasthan, India, delhi");
* is_target_segment is the kind only; pages of another organisation are their own hard reject
  (wrong_site), and a reply without the field still parses;
* sells_the_offer means selling to other organisations, the brief's competitors are in the prompt, and
  the flag needs a quote found on the page."""
from __future__ import annotations

from datetime import datetime, timezone

from conftest import BRIEF, PLAN
from app.services.lead_agent import engine_api, llm, research
from app.services.lead_agent.engine.offer import resolve_offer
from app.services.lead_agent.engine.planning import market_names
from app.services.lead_agent.engine.research.contacts import Contact, extract_contacts
from app.services.lead_agent.engine.research.extract import (
    PageText, build_extraction_prompt, left_out_after_extraction,
)
from app.services.lead_agent.engine.research.lead import build_lead
from app.services.lead_agent.engine.schema_tools import strict_schema
from app.services.lead_agent.engine.schemas import AccountExtraction
from app.services.lead_agent.engine.scoring import DEFAULT_GATE, HARD_REJECT_FLAGS, flag_words, gate, score_lead

SITE = "https://www.moneytreerealty.com/"
HOME = ("MoneyTree Realty\nIndia's trusted real estate advisory and channel partner for top developers.\n"
        "Call +91 98100 12345\nWe also sell our CRM to other brokers and developers.")
PAGES = [PageText(1, SITE, "home", "MoneyTree Realty", HOME)]
TELLEO = ["Coaching institutes and test-prep centres", "Real estate developers and brokers", "Lenders and NBFCs",
          "Insurance companies and brokers", "Hospitals and clinics", "E-commerce and D2C brands"]
VACADEMY = {
    "products": [], "description": "we sell to online educatio companies around the globe",
    "industries": [{"name": n, "search_term": n.lower()} for n in (
        "Online education companies / online academies", "Coaching institutes (test prep)",
        "Tutoring and tuition centres", "K-12 schools and playschools", "Corporate training teams",
        "Colleges and higher education")],
    "offer": {"name": "LMS platform for institutes selling online courses", "seller": "Vacademy",
              "competitors": [{"name": "Classplus", "domain": "classplus.co"}, {"name": "Moodle", "domain": "moodle.org"},
                              {"name": "Teachable", "domain": None}],
              "competitor_kinds": ["lms", "crm", "website"], "fit_signals": [], "education": True},
}
EVALEZY_MARKETS = [{"state": "Rajasthan", "country": "India"}, {"state": "delhi", "country": "India"}]


def _prompt(**kw):
    args = {"organisation": "MoneyTree Realty", "website": SITE, "segment": "real estate developer",
            "industries": TELLEO, "locations": ["India"], "products": resolve_offer(VACADEMY), "pages": PAGES,
            "max_input_chars": 40_000, **kw}
    return build_extraction_prompt(**args)


def _extraction(**fields):
    return AccountExtraction.model_validate({
        "organisation_name": "MoneyTree Realty", "is_target_segment": True,
        "what_they_do": "Real estate advisory and channel partner", "city": "Noida", "branches": [], "signals": [],
        "people": [], "current_software": [], "job_posts": [], "unknowns": [], "discovery_question": "",
        "summary": "A real estate broker.", **fields,
    })


def _lead(extraction, name="MoneyTree Realty"):
    return build_lead(name=name, website=SITE, domain="moneytreerealty.com", extraction=extraction, pages=PAGES,
                      contacts=[Contact("institute_phone", "+91 98100 12345", SITE, "mobile")],
                      products=resolve_offer(VACADEMY), buyer_roles=["owner"], country="India")


# ------------------------------------------------------------------------------- the kinds of organisation

def test_the_prompt_names_every_industry_and_any_one_is_enough():
    _system, user = _prompt()
    for industry in TELLEO:
        assert f"\n- {industry}\n" in user
    assert "a match with ANY one is enough; read each broadly" in user
    assert "'Real estate developers and brokers' includes brokers" in user
    assert "'Colleges and universities' includes medical and engineering colleges" in user
    # The planner's segment ("real estate developer" lost the brokers) is a hint only.
    assert "Planner's one-line summary (a hint only; the list above decides): real estate developer" in user
    assert "Requested segment" not in user


def test_left_out_kinds_and_must_haves_are_said_plainly_and_no_industries_keeps_the_segment():
    _system, user = _prompt(exclude=["Schools & playschools"], must_have=["Runs online batches"])
    assert "Never these kinds, even when they match one above: Schools & playschools" in user
    assert "The brief also requires: Runs online batches" in user
    _system, user = _prompt(industries=None, segment="coaching institutes")
    assert "\n- coaching institutes\n" in user and "Planner's" not in user


def test_the_rules_judge_the_kind_only():
    system, _user = _prompt()
    assert "Judge the kind only: where the organisation is never matters here" in system
    assert "A match with ANY one kind is enough" in system
    description = AccountExtraction.model_fields["is_target_segment"].description
    assert "never where it is" in description and "and location" not in description


def test_being_sold_says_what_we_sell_not_who_buys():
    _system, user = _prompt()
    assert "Being sold: LMS platform for institutes selling online courses (we sell to online educatio" in user
    assert "This says what we sell, not which organisations may buy it: the kinds that may buy it are the list above" in user


def test_markets_are_one_per_line_never_flattened():
    names = market_names(EVALEZY_MARKETS)
    assert names == ["Rajasthan, India", "delhi, India"]
    assert market_names([{"country": "India", "state": "Rajasthan", "city": "Jaipur"}, {"country": "UAE"}]) == [
        "Jaipur, Rajasthan, India", "UAE"]
    assert market_names([{"country": "Worldwide"}, {"country": "India"}]) == ["Worldwide"]
    assert market_names(None) == [] and market_names([{"note": "x"}]) == []
    _system, user = _prompt(locations=names)
    assert "Markets (where the organisation is never decides is_target_segment" in user
    assert "\n- Rajasthan, India\n- delhi, India\n" in user
    assert "Rajasthan, India, delhi" not in user
    _system, user = _prompt(locations=[])
    assert "Markets: not specified" in user


# ------------------------------------------------------------------------- pages of another organisation

def test_a_reply_parses_with_and_without_pages_match_organisation():
    assert _extraction().pages_match_organisation is True  # older replies: the pages are the organisation's
    assert _extraction(pages_match_organisation=False).pages_match_organisation is False
    assert _extraction().sells_the_offer is False and _extraction().sells_the_offer_cite is None
    # The model is asked for every field (it skips optional ones), in both schemas it may be sent.
    for schema in (AccountExtraction.model_json_schema(), strict_schema(AccountExtraction)):
        assert {"pages_match_organisation", "sells_the_offer", "sells_the_offer_cite"} <= set(schema["required"])
    assert "pages_match_organisation" in llm.schema_instruction(AccountExtraction)


def test_pages_of_another_organisation_are_a_hard_reject_of_their_own():
    assert "wrong_site" in HARD_REJECT_FLAGS
    assert flag_words("wrong_site") == "The pages read belong to another organisation, not this one"
    extraction = _extraction(organisation_name="Bitly", pages_match_organisation=False, is_target_segment=False,
                             what_they_do="A link management platform", city="New York", sells_the_offer=True,
                             sells_the_offer_cite={"page": 1, "quote": "We also sell our CRM to other brokers"})
    lead = _lead(extraction, name="Ramaiah Competitive Coaching Centre")
    org = lead["organisation"]
    assert org["name"] == "Ramaiah Competitive Coaching Centre" and org["city"] is None  # not Bitly's
    assert org["pages_match_organisation"] is False and org["sells_the_offer"] is False
    assert "the pages read belong to another organisation" in lead["confidence_reason"]
    scored = score_lead(lead, {**VACADEMY, "markets": [{"country": "India"}]}, [], {})
    assert "wrong_site" in scored["flags"]
    assert "not_target_segment" not in scored["flags"] and "sells_the_offer" not in scored["flags"]
    decision, reasons = gate(scored, lead, DEFAULT_GATE)
    assert decision == "REJECT" and reasons == ["The pages read belong to another organisation, not this one"]
    # A left-out kind is judged from the organisation's own name only, never from the other site's text.
    assert left_out_after_extraction(_extraction(pages_match_organisation=False, is_target_segment=False,
                                                 what_they_do="A CBSE school"), "Alpha", ["Schools"]) is None


def test_a_lead_saved_before_the_field_is_judged_as_before():
    lead = _lead(_extraction(is_target_segment=False))
    del lead["organisation"]["pages_match_organisation"]
    scored = score_lead(lead, {**VACADEMY, "markets": [{"country": "India"}]}, [], {})
    assert "not_target_segment" in scored["flags"] and "wrong_site" not in scored["flags"]
    assert gate(scored, lead, DEFAULT_GATE) == ("REJECT", ["Not the kind of organisation the brief targets"])
    assert "may not be the kind of organisation the brief targets" in _lead(_extraction(is_target_segment=False))[
        "confidence_reason"]


# ------------------------------------------------------------------------------------ sells what you sell

def test_selling_the_offer_means_selling_it_to_other_organisations():
    system, user = _prompt()
    assert "TO OTHER ORGANISATIONS" in system
    assert "Running its own app, LMS, CRM, website or other tools for its own students, patients or customers " \
           "makes it a BUYER, not a seller" in system
    assert "Selling courses or services is not selling course software" in system
    description = AccountExtraction.model_fields["sells_the_offer"].description
    assert "TO OTHER ORGANISATIONS" in description and "makes it a buyer" in description
    # The brief's competitors and competitor kinds are the examples of a seller.
    assert ("Known sellers of it (competitors, for sells_the_offer): Classplus (classplus.co), Moodle (moodle.org), "
            "Teachable; and companies that sell LMS or course apps, CRM software or website builders to other "
            "organisations") in user
    no_competitors = {**VACADEMY, "offer": {**VACADEMY["offer"], "competitors": [], "competitor_kinds": []}}
    assert "Known sellers" not in _prompt(products=resolve_offer(no_competitors))[1]


def test_sells_the_offer_needs_a_quote_found_on_the_page():
    no_quote = _lead(_extraction(sells_the_offer=True))
    assert no_quote["organisation"]["sells_the_offer"] is False and no_quote["dropped_claims"] == 1
    assert "sells_the_offer" not in score_lead(no_quote, VACADEMY, [], {})["flags"]
    empty = _lead(_extraction(sells_the_offer=True, sells_the_offer_cite={"page": 1, "quote": ""}))
    assert empty["organisation"]["sells_the_offer"] is False
    made_up = _lead(_extraction(sells_the_offer=True,
                                sells_the_offer_cite={"page": 1, "quote": "We resell LMS licences to schools"}))
    assert made_up["organisation"]["sells_the_offer"] is False and made_up["dropped_claims"] == 1

    quoted = _lead(_extraction(sells_the_offer=True,
                               sells_the_offer_cite={"page": 1, "quote": "We also sell our CRM to other brokers"}))
    assert quoted["organisation"]["sells_the_offer"] is True
    assert any(e["field"] == "Sells what is being sold" and e["quote"] == "We also sell our CRM to other brokers"
               for e in quoted["evidence"])
    scored = score_lead(quoted, VACADEMY, [], {})
    assert "sells_the_offer" in scored["flags"]
    assert gate(scored, quoted, DEFAULT_GATE)[0] == "REJECT"
    # A quote with no sells_the_offer claim changes nothing.
    assert _lead(_extraction(sells_the_offer_cite={"page": 1, "quote": "We also sell our CRM to other brokers"}))[
        "organisation"]["sells_the_offer"] is False


# ------------------------------------------------------------------------------------- another country

INDIA = ({"country": "India"},)


def _located(phones=(), domain="acmeprep.com", city="Pune", markets=INDIA):
    """A lead with these phones (printed on its home page) on this domain, scored for these markets."""
    site = f"https://{domain}/"
    home = "Acme Prep: JEE and NEET coaching\n" + "\n".join(f"Admissions: {p}" for p in phones)
    contacts = extract_contacts([{"url": site, "text": f"{home}\nEmail: info@{domain}", "links": [],
                                  "has_form": False, "page_type": "home"}], domain, "India")
    assert len([c for c in contacts if c.kind == "institute_phone"]) == len(phones)
    lead = build_lead(name="Acme Prep", website=site, domain=domain, extraction=_extraction(city=city),
                      pages=[PageText(1, site, "home", "Acme Prep", home)], contacts=contacts,
                      products=resolve_offer(VACADEMY), buyer_roles=["owner"], country="India")
    brief = {**VACADEMY, "markets": markets} if markets is not None else VACADEMY
    return lead, score_lead(lead, brief, [], {})


def _outside(scored):
    return [f for f in scored["flags"] if f.startswith("outside_market")]


def test_a_lead_whose_phones_are_all_in_another_country_is_rejected():
    lead, scored = _located(["+1 347-353-1469", "+1 415-692-0300"])
    assert _outside(scored) == ["outside_market:its phones are +1 (United States)"]
    assert "outside_market" in HARD_REJECT_FLAGS
    decision, reasons = gate(scored, lead, DEFAULT_GATE)
    assert decision == "REJECT" and "Outside your markets: its phones are +1 (United States)" in reasons
    one = _located(["+44 20 7946 0958"], domain="acme.co.uk")[1]
    assert _outside(one) == ["outside_market:its phone is +44 (United Kingdom)"]


def test_a_country_code_domain_outside_the_markets_with_no_phone_from_them_is_rejected():
    scored = _located([], domain="acme.co.uk")[1]
    assert _outside(scored) == ["outside_market:its website is on .uk (United Kingdom)"]


def test_another_state_in_a_market_country_is_not_outside_on_its_city_alone():
    # The audit's Delhi colleges on a Rajasthan + Delhi agent, and a Pune institute: same country, and nothing
    # names a state other than the markets' (outside_market_places: a state market needs that).
    scored = _located(["+91 98100 12345"], city="Pune", markets=EVALEZY_MARKETS)[1]
    assert _outside(scored) == [] and "wrong_site" not in scored["flags"]
    delhi = _located(["+91 11 2766 7011"], domain="du.ac.in", city="New Delhi",
                     markets=[{"state": "Rajasthan", "country": "India"}])[1]
    assert _outside(delhi) == []


def test_unknown_or_mixed_evidence_is_never_outside():
    assert _outside(_located([])[1]) == []                                    # no phones, a .com domain
    assert _outside(_located(["+91 98100 12345", "+1 347-353-1469"])[1]) == []  # an Indian and a US phone
    assert _outside(_located(["+1 347-353-1469"], domain="acmeprep.in")[1]) == []  # an Indian domain
    assert _outside(_located([], domain="acme.io")[1]) == []                  # a generic domain
    assert _outside(_located(["+1 347-353-1469"], markets=[])[1]) == []       # an agent without markets
    assert _outside(_located(["+1 347-353-1469"], markets=None)[1]) == []
    assert _outside(_located(["+1 347-353-1469"], markets=[{"country": "Worldwide"}])[1]) == []
    assert _outside(_located(["+1 347-353-1469"], markets=[{"country": "India"}, {"country": "Japan"}])[1]) == []
    assert _outside(_located(["+1 347-353-1469"], markets=[{"country": "India"}, {"country": "USA"}])[1]) == []


# ------------------------------------------------------------------------------- the agent's cities and states

JAIPUR = [{"country": "India", "state": "Rajasthan", "city": "Jaipur"}]
RAJASTHAN = [{"country": "India", "state": "Rajasthan"}]
INDIAN_PHONE = ["+91 98100 12345"]


def _rescored(lead, markets):
    return score_lead(lead, {**VACADEMY, "markets": markets}, [], {})


def test_a_known_city_outside_every_market_city_is_rejected():
    """Review of PR 3569 (2026-10-31): a Mumbai coaching institute that is hiring scored about 57 on an agent whose
    only market is "Jaipur, Rajasthan, India" and was sent and charged; being elsewhere cost only FIT_LOCATION."""
    lead, scored = _located(INDIAN_PHONE, city="Mumbai", markets=JAIPUR)
    assert _outside(scored) == ["outside_market:it is in Mumbai; your markets are Jaipur"]
    decision, reasons = gate(scored, lead, DEFAULT_GATE)
    assert decision == "REJECT" and "Outside your markets: it is in Mumbai; your markets are Jaipur" in reasons
    two = [*JAIPUR, {"country": "India", "city": "Gurugram"}]
    assert _outside(_located(INDIAN_PHONE, city="Kota", markets=two)[1]) == [
        "outside_market:it is in Kota; your markets are Jaipur, Gurugram"]


def test_a_market_city_or_state_named_anywhere_or_by_its_other_name_is_in_the_market():
    for city in ("Jaipur", "Malviya Nagar, Jaipur", "Kota, Rajasthan"):
        assert _outside(_located(INDIAN_PHONE, city=city, markets=JAIPUR)[1]) == [], city
    # Indian city renamings are one place (discovery's table)
    assert _outside(_located(INDIAN_PHONE, city="Gurgaon", markets=[{"country": "India", "city": "Gurugram"}])[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Bengaluru", markets=[{"country": "India", "city": "Bangalore"}])[1]) \
        == []
    # a branch, the description or the Google Maps address in a market city
    lead, _scored = _located(INDIAN_PHONE, city="Mumbai", markets=JAIPUR)
    branch = {"value": "Vaishali Nagar centre", "city": "Jaipur", "quote": "x", "url": SITE}
    assert _outside(_rescored({**lead, "organisation": {**lead["organisation"], "branches": [branch]}}, JAIPUR)) == []
    described = {**lead["organisation"], "what_they_do": "JEE coaching with centres in Mumbai and Jaipur"}
    assert _outside(_rescored({**lead, "organisation": described}, JAIPUR)) == []
    assert _outside(_rescored({**lead, "maps_listing": {"address": "Tonk Rd, Jaipur, Rajasthan 302015"}}, JAIPUR)) == []


def test_an_unknown_city_or_a_country_wide_market_is_never_outside():
    for city in (None, "", "Online", "India", "Pan India"):
        assert _outside(_located(INDIAN_PHONE, city=city, markets=JAIPUR)[1]) == [], city
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=INDIA)[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=[*JAIPUR, {"country": "India"}])[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=[*JAIPUR, {"country": "Worldwide"}])[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=[])[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=None)[1]) == []


def test_the_audit_case_stays_a_lead():
    """2026-10-30 prod audit: Delhi colleges on an agent with markets "Rajasthan, India" + "delhi, India"."""
    for city in ("New Delhi", "Delhi", "North Campus, Delhi"):
        scored = _located(["+91 11 2766 7011"], domain="du.ac.in", city=city, markets=EVALEZY_MARKETS)[1]
        assert _outside(scored) == [] and "in delhi" in scored["reasons"][0], city  # and it earns the location points


def test_a_country_wide_market_elsewhere_needs_the_lead_shown_in_a_country_where_only_cities_are_named():
    markets = [*JAIPUR, {"country": "UAE"}]
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=markets)[1]) == [
        "outside_market:it is in Mumbai; your markets are Jaipur"]
    assert _outside(_located(INDIAN_PHONE, domain="acmeprep.in", city="Mumbai", markets=markets)[1]) != []
    assert _outside(_located([], city="Mumbai", markets=markets)[1]) == []  # nothing shows its country
    assert _outside(_located(["+971 4 330 0000"], city="Dubai", markets=markets)[1]) == []  # the UAE market


def test_a_state_market_is_ruled_out_only_by_another_state_named_where_it_is():
    # a city rarely carries its state's name: Kota or Pune alone never rules a state market out
    assert _outside(_located(INDIAN_PHONE, city="Kota", markets=RAJASTHAN)[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Pune", markets=RAJASTHAN)[1]) == []
    # its city or Google Maps address naming another state does
    assert _outside(_located(INDIAN_PHONE, city="Pune, Maharashtra", markets=RAJASTHAN)[1]) == [
        "outside_market:it is in Pune, Maharashtra; your markets are Rajasthan"]
    lead, _scored = _located(INDIAN_PHONE, city="Pune", markets=EVALEZY_MARKETS)
    listed = {**lead, "maps_listing": {"address": "FC Road, Shivajinagar, Pune, Maharashtra 411004"}}
    assert _outside(_rescored(listed, EVALEZY_MARKETS)) == [
        "outside_market:it is in Pune; your markets are Rajasthan, delhi"]
    # not a branch in another state, nor a city that is a union territory too (Delhi, Chandigarh)
    lead, _scored = _located(INDIAN_PHONE, city="Kota", markets=RAJASTHAN)
    branch = {"value": "Bhopal centre", "city": "Bhopal, Madhya Pradesh", "quote": "x", "url": SITE}
    with_branch = {**lead, "organisation": {**lead["organisation"], "branches": [branch]}}
    assert _outside(_rescored(with_branch, RAJASTHAN)) == []
    assert _outside(_located(INDIAN_PHONE, city="Chandigarh", markets=[{"country": "India", "state": "Punjab"}])[1]) \
        == []


def test_a_market_city_takes_in_its_metro_area():
    """A "Delhi" customer almost always means NCR (Evalezy's markets: "Rajasthan, India" + "delhi, India")."""
    delhi = [{"country": "India", "city": "Delhi"}]
    for city in ("Noida", "Greater Noida", "Gurgaon", "Gurugram", "Ghaziabad", "Faridabad"):
        assert _outside(_located(INDIAN_PHONE, city=city, markets=delhi)[1]) == [], city
    mumbai = [{"country": "India", "state": "Maharashtra", "city": "Mumbai"}]
    for city in ("Thane", "Navi Mumbai", "Vasai-Virar", "Mira Road"):
        assert _outside(_located(INDIAN_PHONE, city=city, markets=mumbai)[1]) == [], city
    assert _outside(_located(INDIAN_PHONE, city="Thane", markets=[{"country": "India", "city": "Bombay"}])[1]) == []
    assert _outside(_located(INDIAN_PHONE, city="Mohali", markets=[{"country": "India", "city": "Chandigarh"}])[1]) \
        == []
    # Evalezy stores Delhi as a state: an NCR lead whose Maps address names Uttar Pradesh or Haryana stays a lead
    for city, address in (("Noida", "Sector 62, Noida, Uttar Pradesh 201309"),
                          ("Gurgaon", "DLF Phase 3, Gurugram, Haryana 122002")):
        lead, _scored = _located(INDIAN_PHONE, city=city, markets=EVALEZY_MARKETS)
        assert _outside(_rescored({**lead, "maps_listing": {"address": address}}, EVALEZY_MARKETS)) == [], city
    # only the metro area of a market city, and only that way round
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=JAIPUR)[1]) == [
        "outside_market:it is in Mumbai; your markets are Jaipur"]
    assert _outside(_located(INDIAN_PHONE, city="Pune", markets=mumbai)[1]) == [
        "outside_market:it is in Pune; your markets are Mumbai"]
    assert _outside(_located(INDIAN_PHONE, city="Mumbai", markets=[{"country": "India", "city": "Thane"}])[1]) == [
        "outside_market:it is in Mumbai; your markets are Thane"]


def test_pages_of_another_organisation_say_nothing_about_where_it_is():
    lead, _scored = _located(INDIAN_PHONE, city="Mumbai", markets=JAIPUR)
    other = {**lead, "organisation": {**lead["organisation"], "pages_match_organisation": False}}
    assert _outside(_rescored(other, JAIPUR)) == []


# --------------------------------------------------------------------------- what research sends the model

def _data(brief, plan, markets):
    now = datetime.now(timezone.utc)
    page = {"url": "https://winnersinstitute.in/", "final_url": "https://winnersinstitute.in/", "access": "ok",
            "text": "WiNNERS Institute Indore\nCall us: +91 98290 55555\nJEE and NEET coaching since 2004.",
            "links_json": [], "has_form": False, "page_type": "home", "fetched_at": now, "platform_hints_json": []}
    agent = {"id": "a-1", "institute_id": "i-1", "mode": "REMOTE", "brief_json": brief, "plan_json": plan,
             "markets_json": markets, "gate_json": {"send_score": 50, "min_contact": "likely", "effort": "BASIC"}}
    return {"cand": {"id": "c-1", "discovery_json": {"query": "q"}}, "agent": agent,
            "org": {"id": "o-1", "domain": "winnersinstitute.in", "name": "WiNNERS Institute",
                    "website": "https://winnersinstitute.in/", "city": "Indore"},
            "pages": [page], "supp": {}, "own_extension_pages": 0}


def _sent(data):
    prompts = []

    def ask(system, user, output, purpose, max_tokens):
        if output.__name__ != "AccountExtraction":
            return output.model_validate({"people": []})  # the decision-maker lookup's
        prompts.append(user)
        return output.model_validate({
            "organisation_name": "WiNNERS Institute", "is_target_segment": True, "what_they_do": "JEE coaching",
            "city": "Indore", "branches": [], "signals": [], "people": [], "current_software": [], "job_posts": [],
            "unknowns": [], "discovery_question": "", "summary": ""})
    research.pipeline(data, ask=ask, search=lambda q: [], mx=lambda d: True)
    return prompts[0]


def test_research_sends_every_industry_and_each_market_on_its_own_line():
    plan = {**PLAN, "segment": "coaching institutes", "locations": ["Rajasthan", "India", "delhi"],
            "industries_detail": [{"name": "Coaching institutes", "search_term": "coaching institute"},
                                  {"name": "Colleges and universities", "search_term": "college"}]}
    user = _sent(_data(BRIEF, plan, EVALEZY_MARKETS))
    assert "\n- Coaching institutes\n- Colleges and universities\n" in user
    assert "\n- Rajasthan, India\n- delhi, India\n" in user and "Rajasthan, India, delhi" not in user
    assert "Never these kinds, even when they match one above: Schools & playschools" in user


def test_research_falls_back_to_the_briefs_industries_like_the_maps_only_path():
    plan = {k: v for k, v in PLAN.items() if k != "industries_detail"}
    brief = {**BRIEF, "industries": [{"name": "Exam bodies and assessment organisations", "search_term": "exam body"},
                                     {"name": "Coaching institutes", "search_term": "coaching institute"}]}
    user = _sent(_data(brief, plan, [{"country": "India"}]))
    assert "\n- Exam bodies and assessment organisations\n- Coaching institutes\n" in user
    assert research.industry_names(plan, brief) == ["Exam bodies and assessment organisations", "Coaching institutes"]
    assert research.brief_industries(PLAN, brief) == PLAN["industries_detail"]  # the plan's list first
    assert engine_api.maps_kind("Coaching center", "WiNNERS", research.brief_industries(plan, brief)) \
        == "Coaching institutes"
