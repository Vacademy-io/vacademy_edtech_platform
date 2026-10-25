"""Ported from the engine's tests/test_contacts.py."""

from __future__ import annotations

import pytest

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.discovery.search import SearchResult
from app.services.lead_agent.engine.research.contact_search import lookup_query, merge_lookup, verify_lookup
from app.services.lead_agent.engine.research.contacts import extract_contacts, is_person_name, link_people, rate_contact
from app.services.lead_agent.engine.research.extract import PageText
from app.services.lead_agent.engine.research.lead import apply_rules, build_lead
from app.services.lead_agent.engine.schemas import AccountExtraction, ContactLookup

SITE = "https://www.alpha-academy.in/"
FOOTER = "\nCall us: 98450 12345\nToll Free: 1800-102-2727\nFax: 080 4567 8902\ninfo@alpha-academy.in"


def _rate(contact, leaders=(), large_chain=False, region="IN"):
    return rate_contact({"url": SITE, "note": "", **contact}, site_domain="alpha-academy.in",
                        organisation="Alpha Academy", leaders=set(leaders), large_chain=large_chain, region=region)


@pytest.mark.parametrize("contact, tier", [
    ({"kind": "institute_phone", "value": "+91 1800 102 2727", "note": "toll-free"}, "avoid"),
    ({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "fax": True}, "avoid"),
    ({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "context": "Customer care: 98450 12345"}, "avoid"),
    ({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "context": "HR: 98450 12345"}, "avoid"),
    ({"kind": "institute_phone", "value": "+91 98765 43210", "note": "mobile"}, "avoid"),  # template sample
    ({"kind": "institute_phone", "value": "+91 80 4567 8901", "note": "landline"}, "general"),
    ({"kind": "institute_phone", "value": "+1 859-254-6589", "note": "phone"}, "general"),  # another country
    ({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "seen_on": 4}, "likely"),
    ({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile",
      "person": {"name": "Meena Iyer", "role": "Founder"}}, "direct"),
    ({"kind": "published_email", "value": "support@alpha-academy.in"}, "avoid"),
    ({"kind": "published_email", "value": "careers@alpha-academy.in"}, "avoid"),
    ({"kind": "published_email", "value": "info@alpha-academy.in"}, "general"),
    ({"kind": "published_email", "value": "alphaacademy@gmail.com"}, "general"),  # the institute's Gmail
    ({"kind": "published_email", "value": "rk1980@gmail.com"}, "likely"),
    ({"kind": "published_email", "value": "director@alpha-academy.in"}, "direct"),
    ({"kind": "published_email", "value": "ravi@alpha-academy.in", "mx": False}, "avoid"),
])
def test_contacts_are_rated_by_what_they_reach(contact, tier):
    assert _rate(contact, leaders={"Meena Iyer"})[0] == tier


def test_a_large_chains_mobiles_are_its_front_desk():
    contact = {"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile"}
    assert _rate(contact, large_chain=True)[0] == "general"


def test_fax_and_helpline_labels_come_from_the_words_before_each_number():
    pages = [{"url": SITE, "page_type": "home", "has_form": False, "links": [],
              "text": "Telephone: 080 4567 8901 | Fax: 080 4567 8902\nAdmission Helpline\n98450 54321"}]
    found = {c.value: c for c in extract_contacts(pages, "alpha-academy.in")}
    assert not found["+91 80 4567 8901"].fax and found["+91 80 4567 8902"].fax
    assert "Helpline" in found["+91 98450 54321"].context


def test_a_number_next_to_a_name_is_theirs_but_the_footer_line_is_not():
    people = [{"name": "Meena Iyer", "role": "Founder & Director"}, {"name": "Suresh Rao", "role": "Centre Head"}]
    texts = [
        "Home" + FOOTER,
        "Our team\nMeena Iyer\nFounder & Director\nMobile: 99000 11111\nSuresh Rao, Centre Head" + FOOTER,
        "Contact" + FOOTER,
    ]
    contacts = [{"kind": "institute_phone", "value": "+91 99000 11111", "url": SITE, "note": "mobile", "seen_on": 1},
                {"kind": "institute_phone", "value": "+91 98450 12345", "url": SITE, "note": "mobile", "seen_on": 3}]
    linked = {c["value"]: c.get("person") for c in link_people(contacts, people, texts, "IN")}
    assert linked["+91 99000 11111"]["name"] == "Meena Iyer"
    assert linked["+91 98450 12345"] is None  # the site-wide number, printed below Suresh Rao's line


def _extraction(people):
    return AccountExtraction.model_validate({
        "organisation_name": "Alpha Academy", "is_target_segment": True, "what_they_do": "Coaching", "city": "Jaipur",
        "branches": [], "people": people, "current_software": [], "unknowns": [], "discovery_question": "",
        "summary": "", "signals": [
            {"signal": "admissions_open", "observation": "Admissions open", "event_date": None,
             "cite": {"page": 1, "quote": "Admissions open for 2026-27"}},
            {"signal": "enquiry_forms", "observation": "Enquiry form", "event_date": None,
             "cite": {"page": 1, "quote": "Send us your enquiry"}},
        ],
    })


PAGES = [PageText(1, SITE, "home", "Alpha", "Admissions open for 2026-27! Send us your enquiry. Meena Iyer, Founder & Director")]
FOUNDER = [{"name": "Meena Iyer", "role": "Founder & Director", "cite": {"page": 1, "quote": "Meena Iyer, Founder & Director"}}]


def _lead(people, contacts):
    from app.services.lead_agent.engine.research.contacts import Contact

    return build_lead(name="Alpha Academy", website=SITE, domain="alpha-academy.in", extraction=_extraction(people),
                      pages=PAGES, contacts=[Contact(*c) for c in contacts], products=["crm"], buyer_roles=[])


def test_contact_ready_needs_someone_who_can_buy_to_be_reachable():
    landline = ("institute_phone", "+91 141 456 7890", SITE, "landline")
    mobile = ("institute_phone", "+91 98450 12345", SITE, "mobile")
    general = ("published_email", "info@alpha-academy.in", SITE, "generic inbox")
    assert _lead(FOUNDER, [landline, general])["stage"] == "qualified"  # reception only
    assert _lead([], [mobile])["stage"] == "qualified"  # a desk mobile, nobody to ask for
    ready = _lead(FOUNDER, [mobile, landline])
    assert ready["stage"] == "contact_ready"
    assert ready["contact_quality"]["label"] == "Desk mobile / WhatsApp: ask for Meena Iyer"
    assert [c["value"] for c in ready["contacts"]][:1] == ["+91 98450 12345"]  # best first
    own = _lead(FOUNDER, [("published_email", "meena.iyer@alpha-academy.in", SITE, "named inbox")])
    assert own["stage"] == "contact_ready" and own["contact_quality"]["level"] == "direct"


def test_names_that_are_not_people_are_dropped():
    assert not is_person_name("(Managing Director)")
    assert not is_person_name("Samyak IAS RAS", "Samyak IAS Jaipur")
    assert is_person_name("Er. Pranay Srivastava", "SKV Academy")


RESULTS = [
    SearchResult(query="q", rank=1, title="Alpha Academy Jaipur - About", url="https://www.alpha-academy.in/about",
                 snippet="Alpha Academy was founded by Meena Iyer (Founder & Director). Reach Meena Iyer on 99000 11111. "
                         "Admissions office: 98450 12345."),
    SearchResult(query="q", rank=2, title="Beta Classes", url="https://beta-classes.in/",
                 snippet="Beta Classes, Jaipur. Director Ramesh Gupta, 97000 22222."),
]


def test_lookup_keeps_only_what_the_results_show_next_to_the_name():
    reply = ContactLookup.model_validate({"people": [
        {"result": 1, "name": "Meena Iyer", "role": "Founder & Director", "phone": "99000 11111", "email": None,
         "quote": "Reach Meena Iyer on 99000 11111"},
        {"result": 1, "name": "Meena Iyer", "role": "Founder", "phone": "99000 33333", "email": "meena@gmail.com",
         "quote": "Alpha Academy was founded by Meena Iyer"},  # invented number and email
        {"result": 2, "name": "Ramesh Gupta", "role": "Director", "phone": "97000 22222", "email": None,
         "quote": "Director Ramesh Gupta, 97000 22222"},  # another organisation
    ]})
    found = verify_lookup(reply, RESULTS, organisation="Alpha Academy", site_domain="alpha-academy.in", country="India")
    assert [p["name"] for p in found["people"]] == ["Meena Iyer"]
    assert [(c["value"], c["person"]["name"]) for c in found["contacts"]] == [("+91 99000 11111", "Meena Iyer")]


def test_lookup_ties_a_known_website_number_to_the_person_and_rescoring_keeps_it():
    lead = _lead([], [("institute_phone", "+91 99000 11111", SITE, "mobile")])
    assert lead["stage"] == "qualified"
    found = {"people": [{"value": "Meena Iyer (Founder)", "name": "Meena Iyer", "role": "Founder", "quote": "q",
                         "url": "https://x.in/", "source": "web search (x.in)"}],
             "contacts": [{"kind": "institute_phone", "value": "+91 99000 11111", "url": "https://x.in/", "note": "mobile",
                           "person": {"name": "Meena Iyer", "role": "Founder"}, "person_quote": "Meena Iyer 99000 11111",
                           "found_by": "web search (x.in)"}]}
    merged = apply_rules(merge_lookup(lead, found), ["crm"], [])
    assert merged["stage"] == "contact_ready" and merged["contact_quality"]["level"] == "direct"
    again = link_people(merged["contacts"], merged["people"], ["unrelated page text"], "IN")
    assert again[0]["person"]["name"] == "Meena Iyer"


def test_lookup_queries():
    assert lookup_query("Alpha Academy", "Jaipur", "Meena Iyer") == "Meena Iyer Alpha Academy Jaipur mobile number email"
    assert lookup_query("Alpha Academy", None, None).startswith("who is the founder or director of Alpha Academy")


def test_numbers_printed_with_an_area_code_are_landlines():
    contact = {"kind": "institute_phone", "value": "+91 74435 10300", "note": "phone", "context": "Ph: 0744-3510300 ,"}
    assert _rate(contact) == ("general", "Landline: usually reception or the front office")


def test_national_chains_are_reached_through_a_central_desk():
    from app.services.lead_agent.engine.research.lead import is_large_chain

    org = {"name": "ALLEN Career Institute", "domain": "allen.in", "branches": []}
    assert is_large_chain({"organisation": org, "contacts": []})
    assert not is_large_chain({"organisation": {**org, "name": "Alpha Academy", "domain": "alpha-academy.in"}, "contacts": []})


def test_the_lookup_quote_shows_the_name_and_the_number():
    reply = ContactLookup.model_validate({"people": [
        {"result": 1, "name": "Meena Iyer", "role": "Founder & Director", "phone": "99000 11111", "email": None,
         "quote": "Reach Meena Iyer on 99000 11111"}]})
    found = verify_lookup(reply, RESULTS, organisation="Alpha Academy", site_domain="alpha-academy.in", country="India")
    quote = found["contacts"][0]["person_quote"]
    assert "Meena Iyer" in quote and "99000 11111" in quote


def test_another_business_contact_left_in_a_hidden_link_is_not_for_sales():
    # MEOR Training Institute (Dubai): its site keeps mailto:/tel: links from a catering business's template.
    hidden_mail = {"kind": "published_email", "value": "yuvarajcateringservice@gmail.com", "seen_on": 0, "context": ""}
    hidden_phone = {"kind": "institute_phone", "value": "+91 98848 89393", "note": "mobile", "seen_on": 0, "context": ""}
    assert _rate(hidden_mail, region="AE")[0] == "avoid"
    assert _rate(hidden_phone, region="AE") == (
        "avoid", "Only in a hidden link on the website, probably left over from its template: a number in another country (IN)")
    # Shown on the page, or the organisation's own mailbox: kept as before.
    assert _rate({**hidden_mail, "seen_on": 2}, region="AE")[0] == "likely"
    assert _rate({**hidden_phone, "seen_on": 1}, region="AE")[0] == "general"
    assert _rate({"kind": "published_email", "value": "ravi@alpha-academy.in", "seen_on": 0, "context": ""})[0] == "likely"
    # A call button whose label shows the number is not hidden.
    assert _rate({**hidden_phone, "context": "Call +91 98848 89393"}, region="AE")[0] == "general"


def test_a_person_named_twice_by_the_model_does_not_crash_linking():
    # The model can return the same person twice; equal spans used to fall through to
    # comparing the person dicts inside sorted() (TypeError), failing the candidate.
    text = "Founder\nRavi Sharma\n+91 98450 12345"
    contacts = [{"kind": "institute_phone", "value": "+91 98450 12345", "url": SITE, "seen_on": 1}]
    people = [{"name": "Ravi Sharma", "role": "Founder"}, {"name": "Ravi Sharma", "role": "Founder"}]
    linked = link_people(contacts, people, [text], "IN")
    assert linked[0]["person"]["name"] == "Ravi Sharma"
