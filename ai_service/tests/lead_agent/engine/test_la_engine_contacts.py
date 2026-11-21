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


# What the words around an address say it is for, template junk, and whose mailbox it is
# (real cases from the 2026-10-29 audit of the live agent "Leads for Vacademy").

def _rate_on(contact, site, organisation, leaders=(), region="IN"):
    return rate_contact({"url": f"https://{site}/", "note": "", "seen_on": 1, **contact}, site_domain=site,
                        organisation=organisation, leaders=set(leaders), large_chain=False, region=region)


def _email(value, context=""):
    return {"kind": "published_email", "value": value, "context": context or value}


@pytest.mark.parametrize("site, organisation, email, context, why", [
    ("kangarookids.in", "Kangaroo Kids", "cybersecurity@lighthouse-learning.com",
     "Any security related incident can be reported on this mail id cybersecurity@lighthouse-learning.com", "security"),
    ("kumonglobal.com", "Kumon", "mohd.amjad@kumon.co.in",
     "Interested applicants can share their CVs at mohd.amjad@kumon.co.in", "job applications"),
    ("samvedschool.com", "Samved School", "aves1967@gmail.com",
     "resume, kindly indicate the post applied for and send to aves1967@gmail.com", "job applications"),
    ("turningpointedu.org", "Turning Point", "tnchowdhary@hotmail.com",
     "You can mail your resume at tnchowdhary@hotmail.com", "job applications"),
    ("uniraj.ac.in", "University of Rajasthan", "heepsconference@gmail.com",
     "(Submission E-Mail : heepsconference@gmail.com)", "submissions"),
    ("alpha-academy.in", "Alpha Academy", "office@alpha-academy.in",
     "For grievances and complaints write to office@alpha-academy.in", "complaints"),
])
def test_an_address_printed_for_something_other_than_sales_is_avoided(site, organisation, email, context, why):
    tier, note = _rate_on(_email(email, context), site, organisation)
    assert tier == "avoid" and why in note and note.endswith("not for sales")


@pytest.mark.parametrize("context", [
    "For career courses write to info@alpha-academy.in",
    "Admissions open, apply now: info@alpha-academy.in",
    "Cyber Security courses info@alpha-academy.in",
    "We value your feedback info@alpha-academy.in",
    "Classes resume on 5 June. info@alpha-academy.in",
    "Job-oriented training programmes info@alpha-academy.in",
    "Interested candidates can apply for admission to the new batch at info@alpha-academy.in",
    "Fashion design courses: info@alpha-academy.in",  # a design school, not a web agency's credit line
    "Indian Institute of Skill Development Training info@alpha-academy.in",
])
def test_sales_words_around_an_address_do_not_trip_the_purpose_rules(context):
    assert _rate(_email("info@alpha-academy.in", context)) == ("general", "General inbox: read by the front office")


def test_a_leaders_own_mailbox_is_kept_whatever_the_line_around_it_asks_for():
    assert _rate(_email("director@alpha-academy.in", "Send your CV to director@alpha-academy.in"))[0] == "direct"


@pytest.mark.parametrize("context, tier", [
    ("Placement Cell: 98450 12345", "avoid"),
    ("Training & Placement Officer 98450 12345", "avoid"),
    ("HR Department 98450 12345", "avoid"),
    ("Send your CV on WhatsApp 98450 12345", "avoid"),
    ("Vacancy for teachers 98450 12345", "avoid"),
    ("Admissions: 98450 12345", "likely"),
    ("Career Courses: call 98450 12345", "likely"),
    ("Career Counselling 98450 12345", "likely"),
    ("Job-oriented training, call 98450 12345", "likely"),
    ("Gurukripa Career Institute 98450 12345", "likely"),  # the old rule avoided any "career"
    ("100% placement assistance. Call 98450 12345", "likely"),
    ("Police Recruitment coaching 98450 12345", "likely"),
])
def test_hr_and_placement_numbers_are_avoided_but_career_courses_are_not(context, tier):
    assert _rate({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "context": context})[0] == tier


@pytest.mark.parametrize("site, organisation, email, context", [
    ("bharadwajinstitute.com", "Bharadwaj Institute", "contact@mysite.com", ""),
    ("quantumcoaching.in", "Quantum Coaching", "filler@godaddy.com", "Signed in as: filler@godaddy.com"),
    ("alpha-academy.in", "Alpha Academy", "test@alpha-academy.in", ""),
    ("alpha-academy.in", "Alpha Academy", "sample@alpha-academy.in", ""),
    ("alpha-academy.in", "Alpha Academy", "youremail@gmail.com", ""),
    ("alpha-academy.in", "Alpha Academy", "info@example.org", ""),
    ("alpha-academy.in", "Alpha Academy", "info@yourdomain.com", ""),
])
def test_a_website_templates_placeholder_email_is_avoided(site, organisation, email, context):
    assert _rate_on(_email(email, context), site, organisation) == ("avoid", "Placeholder from the website template")


def test_a_us_style_template_number_on_an_indian_site_is_avoided():
    # artisticschool.biz printed "Phone: (888) 4567890", which used to become a likely +91 88845 67890.
    sample = {"kind": "institute_phone", "value": "+91 88845 67890", "note": "mobile", "context": "Phone: (888) 4567890"}
    assert _rate(sample)[0] == "avoid" and "template" in _rate(sample)[1]
    assert _rate({"kind": "institute_phone", "value": "+91 98234 56789", "note": "mobile"})[0] == "avoid"  # a run


@pytest.mark.parametrize("value, context", [
    ("+91 79 2657 8452", "Phone: (079) 26578452"),  # Indian STD code: trunk 0 in the brackets
    ("+91 22 2204 1707", "Tel: (022) 2204 1707"),
    ("+91 141 270 6587", "Tel: +91 (141) 2706587"),  # the country code, then the area code
])
def test_indian_area_codes_in_brackets_stay_valid(value, context):
    contact = {"kind": "institute_phone", "value": value, "note": "landline", "context": context}
    assert _rate(contact) == ("general", "Landline: usually reception or the front office")


@pytest.mark.parametrize("site, organisation, email, tier", [
    ("foreignlanguagestraining.com", "Foreign Languages Training Institute", "info@iitgroup.in", "avoid"),
    ("bkvps.in", "Indian Institute of Skill Development Training (IISDT)", "info@iisdt.in", "general"),
    ("podareducation.org", "Podar Education Network", "admissions@podar.org", "general"),
    ("kristujayanti.edu.in", "Kristu Jayanti College", "admission@kristujayanti.com", "general"),
    ("samvedschool.com", "Samved School", "office@samvedschool.in", "general"),  # same name, another ending
    ("chemica.in", "Chemica chemistry classes", "hello@raque.com", "avoid"),
])
def test_an_email_on_another_organisations_domain_is_avoided_unless_it_carries_its_name(site, organisation, email, tier):
    tier_found, note = _rate_on(_email(email), site, organisation)
    assert tier_found == tier
    if tier == "avoid":
        assert note == "Email on another organisation's domain"


def test_an_email_on_another_domain_tied_to_a_named_person_is_kept():
    contact = {**_email("k.rao@parent-university.edu"), "person": {"name": "K Rao", "role": "Director"}}
    assert _rate(contact, leaders={"K Rao"})[0] == "direct"


@pytest.mark.parametrize("email, site, organisation, person, owner", [
    ("info@turningpointedu.org", "turningpointedu.org", "Turning Point", None, "own"),
    ("info@iisdt.in", "bkvps.in", "Indian Institute of Skill Development Training (IISDT)", None, "sister"),
    ("aadharinstitute@gmail.com", "aadharinstitute.com", "Aadhar Institute", None, "org_free"),
    ("a1persona@yahoo.com", "personaei.in", "Persona Educational Institute", None, "org_free"),
    ("bharadwajinstitute@gmail.com", "bharadwajinstitute.com", "Bharadwaj Institute", None, "org_free"),
    ("meenaiyer@gmail.com", "alpha-academy.in", "Alpha Academy", {"name": "Meena Iyer"}, "person"),
    ("iguruji.in@gmail.com", "aadharinstitute.com", "Aadhar Institute", None, "free"),
    ("ja10106371@yahoo.com", "personaei.in", "Persona Educational Institute", None, "free"),
    ("royalindiasecuritaus@gmail.com", "bkvps.in", "Indian Institute of Skill Development Training (IISDT)", None, "free"),
    ("navajyothistudyhouse@gmail.com", "kristujayanti.edu.in", "Kristu Jayanti College", None, "free"),
    ("info@iitgroup.in", "foreignlanguagestraining.com", "Foreign Languages Training Institute", None, "other"),
    ("info@other.in", None, "Alpha Academy", None, "unknown"),
])
def test_whose_mailbox_an_email_is(email, site, organisation, person, owner):
    from app.services.lead_agent.engine.research.contacts import email_owner

    assert email_owner(email, site_domain=site, organisation=organisation, person=person) == owner


def test_within_a_tier_the_organisations_own_email_and_a_maps_confirmed_mobile_come_first():
    from app.services.lead_agent.engine.research.lead import rate_contacts

    lead = {"people": [], "phone_region": "IN",
            "organisation": {"name": "Samved School", "domain": "samvedschool.com", "branches": []},
            "contacts": [
                {"kind": "published_email", "value": "office@samvedschool.in", "url": SITE, "seen_on": 1,
                 "context": "office@samvedschool.in"},
                {"kind": "published_email", "value": "info@samvedschool.com", "url": SITE, "seen_on": 1,
                 "context": "info@samvedschool.com"},
                {"kind": "institute_phone", "value": "+91 98450 12345", "url": SITE, "note": "mobile", "seen_on": 1,
                 "context": "Call 98450 12345"},
                {"kind": "institute_phone", "value": "+91 98290 55555", "url": SITE, "note": "mobile", "seen_on": 1,
                 "context": "Call 98290 55555", "maps_confirmed": True},
            ]}
    rated = rate_contacts(lead, [])
    assert [c["value"] for c in rated] == ["+91 98290 55555", "+91 98450 12345", "info@samvedschool.com",
                                           "office@samvedschool.in"]
    assert {c["value"]: c.get("owner") for c in rated if c["kind"] == "published_email"} == {
        "info@samvedschool.com": "own", "office@samvedschool.in": "sister"}


def test_mobiles_are_told_from_landlines_by_the_number_when_the_type_is_missing():
    from app.services.lead_agent.engine.research.contacts import is_mobile

    assert is_mobile({"kind": "institute_phone", "value": "+91 98450 12345"}, "IN")  # e.g. a Google Maps listing
    assert not is_mobile({"kind": "institute_phone", "value": "+91 22 2204 1707"}, "IN")
    assert is_mobile({"kind": "whatsapp", "value": "+91 22 2204 1707", "note": ""}, "IN")


MAPS_PHONE = {"kind": "institute_phone", "value": "+91 99000 11111", "url": "https://maps.google.com/?cid=1",
              "note": "mobile", "context": "Phone number on the organisation's Google Maps listing", "seen_on": 0,
              "found_by": "google_maps"}


def test_the_google_maps_number_is_a_desk_line_so_a_lookup_never_makes_it_direct():
    from app.services.lead_agent.engine.research.contacts import site_desk_line

    assert site_desk_line(MAPS_PHONE) == "it is the number on the organisation's Google Maps listing"
    website = {"kind": "institute_phone", "value": "+91 98450 12345", "seen_on": 1, "context": "98450 12345"}
    assert site_desk_line(website) is None and site_desk_line({**website, "maps_confirmed": True})
    lead = _lead([], [])
    lead = apply_rules({**lead, "contacts": [*lead["contacts"], dict(MAPS_PHONE)]}, ["crm"], [])
    found = {"people": [{"value": "Meena Iyer (Founder)", "name": "Meena Iyer", "role": "Founder", "quote": "q",
                         "url": "https://x.in/", "source": "web search (x.in)"}],
             "contacts": [{"kind": "institute_phone", "value": "+91 99000 11111", "url": "https://x.in/", "note": "mobile",
                           "person": {"name": "Meena Iyer", "role": "Founder"}, "person_quote": "Meena Iyer 99000 11111",
                           "found_by": "web search (x.in)"}]}
    merged = apply_rules(merge_lookup(lead, found), ["crm"], [])
    maps = next(c for c in merged["contacts"] if c["value"] == "+91 99000 11111")
    assert maps["quality"] == "likely" and "person" not in maps and maps["ask_for"]["name"] == "Meena Iyer"
    # Saved before this rule (person + linked_by on the Maps number): read the same way.
    legacy = {**MAPS_PHONE, "person": {"name": "Meena Iyer", "role": "Founder"}, "linked_by": "web search (x.in)"}
    assert _rate(legacy, leaders={"Meena Iyer"})[0] == "likely"


def test_a_maps_listed_mobile_reaches_its_centre_even_on_a_large_chains_lead():
    assert _rate(MAPS_PHONE, large_chain=True) == (
        "likely", "Mobile on the Google Maps listing: usually the front desk, sometimes the owner")
    website = {"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "context": "Call 98450 12345"}
    assert _rate({**website, "maps_confirmed": True}, large_chain=True)[0] == "likely"
    assert _rate(website, large_chain=True)[0] == "general"
    # A helpline stays a helpline when Google lists it too.
    assert _rate({**website, "context": "Helpline 98450 12345", "maps_confirmed": True})[0] == "avoid"


@pytest.mark.parametrize("context, tier", [
    ("Website designed & developed by XYZ Infotech 98450 12345", "avoid"),
    ("Developed by Webtech Solutions | +91 98450 12345", "avoid"),
    ("Study material designed by IIT alumni, call 98450 12345", "likely"),
    ("Alpha Classes powered by Alpha Group, call 98450 12345", "likely"),
])
def test_a_web_agencys_credit_line_number_is_avoided(context, tier):
    assert _rate({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "context": context})[0] == tier


# Over-blocking the 2026-10-29 offline replay of "Leads for Vacademy" found in the rules above.

@pytest.mark.parametrize("context", [
    "Feedback e-mail: office@alpha-academy.in",
    "Send your feedback to office@alpha-academy.in",
    "For feedback: office@alpha-academy.in",
    "Feedback / Suggestions office@alpha-academy.in",
    "Grievance Officer: Mr. R. K. Jain office@alpha-academy.in",
    "Complaints office@alpha-academy.in",
])
def test_a_feedback_or_complaints_channel_is_avoided(context):
    assert _rate(_email("office@alpha-academy.in", context)) == ("avoid", "Printed for complaints or feedback: not for sales")


@pytest.mark.parametrize("value, note, context", [
    # vibrantacademy.com's only number: a help line that mentions feedback
    ("+91 91161 47816", "mobile", "or want to share feedback, our team is ready to assist you. 9116147816"),
    ("+91 98450 12345", "mobile", "For admission enquiries or feedback, call 98450 12345"),
    ("+91 98450 12345", "mobile", "Queries / Feedback: 98450 12345"),
    ("+91 98450 12345", "mobile", "Feedback & Enquiries 98450 12345"),
])
def test_a_help_line_that_mentions_feedback_stays_usable(value, note, context):
    assert _rate({"kind": "institute_phone", "value": value, "note": note, "context": context})[0] == "likely"


def test_a_browsers_audio_fallback_text_is_not_a_support_line():
    # nibmpomaker.com: "...your browser does not support the audio element. 882 525 0625"
    fallback = {"kind": "institute_phone", "value": "+91 88252 50625", "note": "mobile",
                "context": "is because your browser does not support the audio element. 882 525 0625"}
    assert _rate(fallback)[0] == "likely"
    assert _rate({**fallback, "context": "Student support: 882 525 0625"})[0] == "avoid"


@pytest.mark.parametrize("site, organisation, email, tier", [
    ("lsr.edu.in", "Lady Shri Ram College For Women", "principal@lsr.du.ac.in", "direct"),  # the university's domain
    ("bjmcabd.edu.in", "B. J. Medical College, Ahmedabad", "dean-bjmc-ahm@gujarat.gov.in", "direct"),
    ("mkhsancheti.com", "MKH Sancheti Public School", "director.admissions@ssisedu.org", "direct"),
    # Still another organisation's: not a leader's title, or printed for something else.
    ("foreignlanguagestraining.com", "IITT Language Academy", "info@iitgroup.in", "avoid"),
    ("lsr.edu.in", "Lady Shri Ram College For Women", "vp@lsrcollege.org", "avoid"),
    ("kumonglobal.com", "Kumon", "director@kumon.co.in", "direct"),
])
def test_a_leaders_mailbox_is_kept_on_any_domain(site, organisation, email, tier):
    assert _rate_on(_email(email), site, organisation)[0] == tier


def test_a_leaders_mailbox_printed_for_cvs_on_another_domain_is_still_the_leaders():
    # The leader's-inbox rule ignores the line around it, as on the organisation's own domain.
    tier, _ = _rate_on(_email("principal@other-trust.org", "Send your CV to principal@other-trust.org"),
                       "alpha-academy.in", "Alpha Academy")
    assert tier == "direct"


@pytest.mark.parametrize("site, organisation, email, tier", [
    ("gcpatna.ac.in", "Government College of Arts, Patna", "gcpatna@nic.in", "general"),
    ("itidelhi.gov.in", "Industrial Training Institute Pusa", "itipusa-dl@gov.in", "general"),
    ("rajkiyacollege.in", "Rajkiya Mahavidyalaya Kota", "rmkota-rj@nic.in", "general"),
    # A private institute printing a government office's address (professoracademy.com, the TRB's).
    ("professoracademy.com", "Professor Academy", "trbgrievances@tn.gov.in", "avoid"),
])
def test_a_government_address_on_a_government_institutions_site_is_its_own(site, organisation, email, tier):
    tier_found, note = _rate_on(_email(email), site, organisation)
    assert tier_found == tier
    if tier == "general":
        assert note == "Email on a government domain: the institution is government-run"


@pytest.mark.parametrize("email, site, organisation", [
    ("info@bischool.in", "bangaloreinternationalschool.org", "Bangalore International School"),
    ("info@cisb.org.in", "canadianinternationalschool.com", "Canadian International School"),
    ("indore@imsindia.com", "imsindore.com", "IMS Indore"),
    ("info@gfegroup.org", "gfebusiness.org", "GFE Business (GFE Group)"),
    ("info@alsias.net", "alsedunation.com", "ALS IAS"),
])
def test_a_sister_domain_with_the_organisations_initials_is_its_own(email, site, organisation):
    from app.services.lead_agent.engine.research.contacts import email_owner

    assert email_owner(email, site_domain=site, organisation=organisation) == "sister"
    assert _rate_on(_email(email), site, organisation)[0] == "general"


@pytest.mark.parametrize("email, site, organisation", [
    ("info@iitgroup.in", "foreignlanguagestraining.com", "IITT Language Academy"),
    ("news@newindianexpress.com", "newera.in", "New Era School"),  # a common word, not an initialism
    ("office@iitb.ac.in", "iitd.ac.in", "IIT Delhi"),  # another institute of the same family
    ("hello@raque.com", "chemica.in", "Chemica chemistry classes"),
])
def test_initials_and_short_words_shared_by_chance_are_not_a_sister_domain(email, site, organisation):
    from app.services.lead_agent.engine.research.contacts import email_owner

    assert email_owner(email, site_domain=site, organisation=organisation) == "other"


def test_a_word_for_what_the_organisation_teaches_does_not_carry_its_name():
    from app.services.lead_agent.engine.research.contacts import carries_org_name, email_owner

    # maharanapratapdefence.com was sent defence@gmail.com over the founder's mdadoulatfouji@gmail.com.
    organisation = "Maharana Pratap Defence Academy"
    assert not carries_org_name("defence", organisation) and carries_org_name("maharanapratap", organisation)
    for local in ("englishclasses", "computer.institute", "mathstuition", "sciencetutorials"):
        assert not carries_org_name(local, "Bright English Maths Science Computer Tutorials")
    assert email_owner("defence@gmail.com", site_domain="maharanapratapdefence.com", organisation=organisation) == "free"
    assert _rate_on(_email("defence@gmail.com"), "maharanapratapdefence.com", organisation) == (
        "likely", "Personal mailbox (Gmail etc.): person not identified")
    assert _rate_on(_email("maharanapratap.academy@gmail.com"), "maharanapratapdefence.com", organisation)[0] == "general"
    assert not is_person_name("Defence Academy") and not is_person_name("Bright Science Classes", "Bright")


@pytest.mark.parametrize("context", [
    "For feedback: 98450 12345",
    "HR Department 98450 12345",
    "Website designed & developed by XYZ Infotech 98450 12345",
])
def test_the_google_maps_listing_overrules_the_words_around_a_number(context):
    # The business line wins over what the website prints around it (vibrantacademy.com).
    number = {"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile", "context": context}
    assert _rate(number)[0] == "avoid"
    assert _rate({**number, "maps_confirmed": True}) == (
        "likely", "Mobile on the Google Maps listing: usually the front desk, sometimes the owner")
    landline = {"kind": "institute_phone", "value": "+91 80 4567 8901", "note": "landline", "context": context,
                "maps_confirmed": True}
    assert _rate(landline) == ("general", "Landline: usually reception or the front office")


@pytest.mark.parametrize("contact", [
    {"value": "+91 98450 12345", "note": "mobile", "context": "Helpline: 98450 12345"},
    {"value": "+91 98450 12345", "note": "mobile", "context": "Give a missed call on 98450 12345"},
    {"value": "+91 1800 102 2727", "note": "toll-free", "context": "Toll Free: 1800 102 2727"},
    {"value": "+91 98450 12345", "note": "mobile", "context": "Fax: 98450 12345", "fax": True},
    {"value": "+91 98765 43210", "note": "mobile", "context": "Call 98765 43210"},
    {"value": "+91 88845 67890", "note": "mobile", "context": "Phone: (888) 4567890"},
])
def test_a_helpline_toll_free_fax_or_template_number_stays_avoided_when_google_lists_it(contact):
    assert _rate({"kind": "institute_phone", "maps_confirmed": True, **contact})[0] == "avoid"


def test_a_number_from_another_country_is_not_a_mobile_for_the_lead():
    from app.services.lead_agent.engine.research.contacts import is_mobile

    # talentresourze.com: "USA: +1 (347) 353-1469" counted as a mobile on an Indian lead.
    us = {"kind": "institute_phone", "value": "+1 347-353-1469", "note": "phone"}
    assert not is_mobile(us, "IN") and is_mobile(us, "US")
    assert not is_mobile({"kind": "institute_phone", "value": "+971 55 205 0927", "note": "mobile"}, "IN")
    assert not is_mobile({"kind": "whatsapp", "value": "+971 58 589 0040", "note": ""}, "IN")
    assert is_mobile({"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile"}, None)


def test_within_a_tier_a_mobile_comes_before_a_landline_then_one_google_maps_lists():
    from app.services.lead_agent.engine.research.contacts import send_rank

    mobile = {"kind": "institute_phone", "value": "+91 98450 12345", "note": "mobile"}
    landline = {"kind": "institute_phone", "value": "+91 80 4567 8901", "note": "landline"}
    order = [{**mobile, "maps_confirmed": True}, mobile, {**landline, "maps_confirmed": True}, landline]
    assert [send_rank(c, "IN") for c in order] == [0, 1, 2, 3]


def test_a_gmail_rated_the_institutes_own_is_owned_as_one():
    from app.services.lead_agent.engine.research.contacts import email_owner

    # tcsacademy.org: "TCS" names tcsacademylko@gmail.com, which lost to another Gmail once "academy" stopped counting.
    assert _rate_on(_email("tcsacademylko@gmail.com"), "tcsacademy.org", "TCS Academy")[0] == "general"
    assert email_owner("tcsacademylko@gmail.com", site_domain="tcsacademy.org", organisation="TCS Academy") == "org_free"
    assert email_owner("rk1980academy@gmail.com", site_domain="tcsacademy.org", organisation="TCS Academy") == "free"
