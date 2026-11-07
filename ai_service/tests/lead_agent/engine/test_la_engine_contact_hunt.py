"""The pure rules behind the validation effort's research extras (2026-10-29): whose mailbox an address
on another domain is, which number of a tier is sent, what counts as a reachable contact, whether a
Google Maps listing found by name is the organisation's, whether a listing shows the brief's kind of
organisation, and what the contact hunt may take from search results."""

from __future__ import annotations

import pytest

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.discovery.search import SearchResult
from app.services.lead_agent.engine.research.contact_search import HUNT_FOUND_BY, hunt_contacts, hunt_queries
from app.services.lead_agent.engine.research.contacts import email_owner, rate_contact, reachable
from app.services.lead_agent.engine.research.lead import rate_contacts
from app.services.lead_agent.engine.research.maps_listing import listing_city, maps_query, pick_listing
from app.services.lead_agent.engine.scoring import gate, maps_kind

# ------------------------------------------------------------------------ mailbox named after the organisation


@pytest.mark.parametrize("email, organisation, site", [
    ("evolvv@techvito.in", "Evolvv", "evolvv.in"),
    ("aicpe@bizindia.org", "AICPE Educational Services Pvt. Ltd.", "aicpeindia.org"),
])
def test_a_mailbox_named_after_the_organisation_on_another_domain_is_theirs(email, organisation, site):
    # 2026-10-29 replay: both were avoided as "Email on another organisation's domain".
    assert email_owner(email, site_domain=site, organisation=organisation) == "org_named"
    tier, note = rate_contact({"kind": "published_email", "value": email, "url": f"https://{site}/",
                               "context": f"Email: {email}", "seen_on": 1},
                              site_domain=site, organisation=organisation, leaders=set(), large_chain=False)
    assert tier == "general" and "named after the organisation" in note


@pytest.mark.parametrize("email, organisation, site", [
    ("info@bizindia.org", "AICPE Educational Services Pvt. Ltd.", "aicpeindia.org"),  # nothing of its name
    ("academy@webhost.in", "Shine Academy", "shineacademy.in"),  # "academy" is a kind, not a name
    ("defence@webhost.in", "Maharana Pratap Defence Academy", "maharanapratapdefence.com"),
    ("connect@webhost.in", "Connect Classes", "connectclasses.in"),  # a general mailbox word
    # The name's place, not its brand: the 2026-10-29 replay first called this Cummins College's own mailbox.
    ("hostel.nagpur@maharshikarve.org", "Cummins College Of Engineering For Women, Nagpur", "cumminscollege.edu.in"),
])
def test_generic_words_do_not_make_another_domains_mailbox_the_organisations(email, organisation, site):
    assert email_owner(email, site_domain=site, organisation=organisation) == "other"
    tier, _ = rate_contact({"kind": "published_email", "value": email, "url": f"https://{site}/",
                            "context": f"Email: {email}", "seen_on": 1},
                           site_domain=site, organisation=organisation, leaders=set(), large_chain=False)
    assert tier == "avoid"


# ------------------------------------------------------------------------------- home country first


def test_a_number_of_the_leads_own_country_comes_before_a_foreign_one_of_the_same_tier():
    # mygreatlearning.com: "+1 512-647-2647" was sent over its Bengaluru landline (both "general").
    lead = {"organisation": {"name": "Great Learning", "domain": "mygreatlearning.com", "branches": []},
            "people": [], "phone_region": "IN", "contacts": [
                {"kind": "institute_phone", "value": "+1 512-647-2647", "note": "phone", "url": "u", "seen_on": 1,
                 "context": "info@mygreatlearning.com +1 512 647 2647"},
                {"kind": "institute_phone", "value": "+91 80 6947 4555", "note": "landline", "url": "u", "seen_on": 1,
                 "context": "info@greatlearning.in 080 6947 4555"}]}
    rated = rate_contacts(lead, [])
    assert [c["quality"] for c in rated] == ["general", "general"]
    assert rated[0]["value"] == "+91 80 6947 4555"


# --------------------------------------------------------------------------------------- reachable


@pytest.mark.parametrize("contact, expected", [
    ({"kind": "institute_phone", "value": "+91 80 6947 4555", "quality": "general"}, True),
    ({"kind": "whatsapp", "value": "+91 98450 12345", "quality": "likely"}, True),
    ({"kind": "institute_phone", "value": "+91 1800 102 2727", "quality": "avoid"}, False),
    ({"kind": "published_email", "value": "info@alpha.in", "quality": "general", "owner": "own"}, True),
    ({"kind": "published_email", "value": "evolvv@techvito.in", "quality": "general", "owner": "org_named"}, True),
    ({"kind": "published_email", "value": "alphaacademy@gmail.com", "quality": "general", "owner": "org_free"}, True),
    ({"kind": "published_email", "value": "principal@lsr.du.ac.in", "quality": "direct", "owner": "person"}, True),
    ({"kind": "published_email", "value": "rk1980@gmail.com", "quality": "likely", "owner": "free"}, False),
    ({"kind": "contact_form", "value": "https://alpha.in/contact", "quality": "general"}, False),
])
def test_reachable_means_a_usable_phone_or_an_email_the_organisation_owns(contact, expected):
    assert reachable(contact) is expected


# ------------------------------------------------------------------------- a Maps listing found by name


def test_the_maps_query_is_the_name_and_the_city():
    assert maps_query("WiNNERS Institute", "Indore, Madhya Pradesh") == "WiNNERS Institute Indore"
    assert maps_query("WiNNERS Institute", None) == "WiNNERS Institute"


def test_a_listing_counts_when_its_website_is_the_organisations_domain():
    places = [{"title": "WiNNERS Institute", "website": "https://winners-coaching.com/", "phone": "1"},
              {"title": "Winners IAS", "website": "https://www.winnersinstitute.in/jee", "phone": "2"}]
    picked = pick_listing(places, organisation="WiNNERS Institute", domain="winnersinstitute.in", city="Indore")
    assert picked["phone"] == "2"  # the first listing is a same-name business on another domain


@pytest.mark.parametrize("listing, theirs", [
    ({"title": "WiNNERS Institute - JEE NEET Coaching", "address": "Vijay Nagar, Indore, Madhya Pradesh 452010"}, True),
    ({"title": "WiNNERS Institute", "address": "Civil Lines, Jaipur, Rajasthan 302006"}, False),  # another city
    ({"title": "WiNNERS Institute of Dance", "address": "Vijay Nagar, Indore"}, False),  # more than its name
    ({"title": "Winners Classes", "address": "Vijay Nagar, Indore"}, True),  # generic words aside
])
def test_a_listing_without_a_website_needs_the_same_name_and_the_organisations_city(listing, theirs):
    picked = pick_listing([{**listing, "phone": "x"}], organisation="WiNNERS Institute", domain="winnersinstitute.in",
                          city="Indore")
    assert (picked is not None) is theirs


def test_a_name_of_only_generic_words_never_matches_a_listing_without_a_website():
    places = [{"title": "Coaching Academy", "address": "Vijay Nagar, Indore", "phone": "x"}]
    assert pick_listing(places, organisation="Coaching Academy", domain="coachingacademy.in", city="Indore") is None


@pytest.mark.parametrize("address, known, city", [
    ("H998+2PH KOTHARI INTERNATIONAL SCHOOL, B-279, Sector 50, Noida, Uttar Pradesh 201303, India", None, "Noida"),
    ("Shop 4, Camp, Pune 411001", None, "Pune"),
    ("Vijay Nagar, Indore, Madhya Pradesh 452010", "Indore", "Indore"),
    ("Raj Nagar, Ghaziabad, Uttar Pradesh 201002", "Noida", "Ghaziabad"),  # listed in a neighbouring city
    ("Near the clock tower", "Indore", "Indore"),
])
def test_the_city_of_a_listings_address(address, known, city):
    assert listing_city(address, known) == city


# ------------------------------------------------------------------- the brief's kind, from a Maps listing

VACADEMY = [
    {"name": "Online education companies / online academies", "search_term": "online academy"},
    {"name": "Coaching institutes (test prep)", "search_term": "coaching institute"},
    {"name": "Tutoring and tuition centres", "search_term": "tutoring centre"},
    {"name": "K-12 schools and playschools", "search_term": "school"},
    {"name": "Corporate training teams", "search_term": "corporate training"},
    {"name": "Colleges and higher education", "search_term": "college"},
]


@pytest.mark.parametrize("category, name, industry", [
    ("Coaching center", "Gyan Classes", "Coaching institutes (test prep)"),
    ("Tutoring service", "Bright Minds", "Tutoring and tuition centres"),
    ("University", "Amity University Noida", "Colleges and higher education"),
    ("CBSE school", "Delhi Public School", "K-12 schools and playschools"),
    ("Educational institution", "Kothari International School", "K-12 schools and playschools"),  # by its name
    ("Education center", "Spark", "Online education companies / online academies"),
    ("Business management consultant", "Growth Partners", None),
    ("Training center", "Skills Hub", None),  # "corporate training" needs both words
    ("Business school", "Excel Business School", None),  # not a K-12 school
    ("Guitar instructor", "Strings", None),
])
def test_a_maps_listing_matches_the_briefs_industry_by_category_or_name(category, name, industry):
    assert maps_kind(category, name, VACADEMY) == industry


def test_words_that_name_no_kind_do_not_match_an_industry():
    industries = [{"name": "Online businesses and service companies", "search_term": "online business"}]
    assert maps_kind("Car repair service", "Speedy Motors", industries) is None


# --------------------------------------------------------------------------------------- maps_only gate


def _scored(score, flags, base=None):
    return {"score": score, "base_score": score if base is None else base, "risk": 0, "flags": flags,
            "has_intent": False, "reach_level": "likely"}


def test_a_lead_judged_from_its_maps_listing_waits_for_review_at_or_above_the_send_bar():
    lead = {"contact_quality": {"level": "likely"}}
    cfg = {"send_score": 25, "min_contact": "likely"}
    decision, reasons = gate(_scored(26, ["maps_only"]), lead, cfg)
    assert decision == "REVIEW" and "Judged from its Google Maps listing" in reasons[-1]
    assert gate(_scored(90, ["maps_only"]), lead, cfg)[0] == "REVIEW"  # never AUTO
    assert gate(_scored(26, ["maps_only", "no_contact"]), lead, cfg)[0] == "REJECT"  # a hard reject still wins
    # below the bar it is rejected (rank and fill, 2026-10-30: nobody reviews in this funnel)
    assert gate(_scored(26, ["maps_only"]), lead, {**cfg, "send_score": 50}) == (
        "REJECT", ["Judged from its Google Maps listing only: score 26 is below the send bar (50)"])


# ------------------------------------------------------------------------------------------ contact hunt


def test_the_hunt_searches_one_query_per_round_and_social_pages_only_on_deep():
    assert hunt_queries("WiNNERS Institute", "Indore", social=False) == [
        "WiNNERS Institute Indore contact number", "WiNNERS Institute Indore email"]
    deep = hunt_queries("WiNNERS Institute", "Indore, MP", social=True)
    assert deep[2] == "WiNNERS Institute Indore site:facebook.com OR site:instagram.com OR site:linkedin.com/company"


def _r(title, url, snippet):
    return SearchResult(query="q", rank=1, title=title, url=url, snippet=snippet)


def _hunt(results, organisation="WiNNERS Institute", site="winnersinstitute.in", city="Indore"):
    return hunt_contacts(results, organisation=organisation, site_domain=site, city=city, country="India")


def test_the_hunt_takes_a_number_printed_next_to_the_organisations_name():
    found = _hunt([_r("WiNNERS Institute Indore | Facebook", "https://www.facebook.com/winnersindore",
                      "WiNNERS Institute, Vijay Nagar, Indore. Call 98450 12345 for JEE admissions.")])
    assert [(c["kind"], c["value"], c["found_by"]) for c in found] == [
        ("institute_phone", "+91 98450 12345", HUNT_FOUND_BY)]
    assert "WiNNERS Institute" in found[0]["context"] and found[0]["note"] == "mobile"


def test_the_hunt_skips_directories_other_places_and_numbers_far_from_the_name():
    far = "WiNNERS Institute, Indore. " + "JEE and NEET coaching with daily doubt classes. " * 4 + "98450 12345"
    assert _hunt([
        _r("WiNNERS Institute Indore", "https://www.justdial.com/Indore/winners", "WiNNERS Institute 98450 12345"),
        _r("WiNNERS Institute Jaipur", "https://www.facebook.com/winnersjaipur", "WiNNERS Institute 97830 12345"),
        _r("WiNNERS Institute Indore", "https://www.instagram.com/winners", far),
    ]) == []


def test_one_shared_word_does_not_make_a_result_about_the_organisation():
    # Nobody checks a hunted number before outreach calls it: "Gyan Classes" is not "Gyan Vidya Coaching
    # Centre" or "Gyan Coaching Centre", and "Indore" alone is not "IMS Indore".
    other = [_r("Gyan Classes Indore", "https://gyanclasses.in/", "Gyan Classes Indore: call 98450 12345")]
    assert _hunt(other, organisation="Gyan Vidya Coaching Centre", site="gyanvidya.in") == []
    assert _hunt(other, organisation="Gyan Coaching Centre", site="gyancoachingcentre.com") == []
    assert _hunt([_r("Best coaching in Indore", "https://blog.example.com/x", "Indore toppers: call 98450 12345")],
                 organisation="IMS Indore", site="imsindore.com") == []
    theirs = [_r("Gyan Coaching Centre, Indore", "https://www.facebook.com/gyan", "Gyan Coaching Centre: 98450 12345")]
    assert [c["value"] for c in _hunt(theirs, organisation="Gyan Coaching Centre", site="gyancoachingcentre.com")] == [
        "+91 98450 12345"]


def test_the_hunt_keeps_only_emails_the_organisation_owns():
    found = _hunt([_r("WiNNERS Institute Indore - Contact", "https://www.facebook.com/winnersindore",
                      "WiNNERS Institute Indore: info@winnersinstitute.in, winnersindore@gmail.com, "
                      "rk1980@gmail.com")])
    assert sorted(c["value"] for c in found) == ["info@winnersinstitute.in", "winnersindore@gmail.com"]


def test_a_result_on_the_organisations_own_site_needs_no_city():
    found = _hunt([_r("Contact - WiNNERS Institute", "https://winnersinstitute.in/contact",
                      "WiNNERS Institute admissions desk: 0731 405 8393")])
    assert [c["value"] for c in found] == ["+91 731 405 8393"]
