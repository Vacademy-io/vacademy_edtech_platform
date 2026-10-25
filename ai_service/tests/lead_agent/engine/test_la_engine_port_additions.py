"""Changes made while porting: injected callables instead of network calls, Complete Vacademy weights,
and the pure helpers lifted out of the engine's jobs/research.py."""

from __future__ import annotations

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.discovery.search import SearchResult
from app.services.lead_agent.engine.research.catalogue import score_products
from app.services.lead_agent.engine.research.contact_search import LOOKUP_RESULTS, lookup_contacts
from app.services.lead_agent.engine.research.contacts import check_mail_domains, mail_domain_ok
from app.services.lead_agent.engine.research.extract import left_out_after_extraction, signal_only_extraction
from app.services.lead_agent.engine.research.social import find_linkedin
from app.services.lead_agent.engine.schemas import AccountExtraction, ContactLookup


def test_complete_vacademy_scores_a_coaching_site_with_online_courses():
    """The engine gave a typical coaching site 12 for the product Vacademy sells most (v1 weights)."""
    [online] = score_products(["complete_vacademy"], {"online_courses", "test_series", "admissions_open", "enquiry_forms"})
    assert online.score == 75
    [basic] = score_products(["complete_vacademy"], {"admissions_open", "enquiry_forms"})
    assert basic.score == 33
    assert score_products(["complete_vacademy"], {"hiring", "online_courses"})[0].score == 50
    # The other products keep the engine's weights.
    assert score_products(["crm"], {"hiring", "admissions_open"})[0].score == 62


def test_mail_servers_are_checked_through_the_given_lookup_only():
    contacts = [{"kind": "published_email", "value": "ravi@alpha-academy.in"},
                {"kind": "published_email", "value": "x@deadmail.in"},
                {"kind": "published_email", "value": "rk1980@gmail.com"},
                {"kind": "institute_phone", "value": "+91 98450 12345"}]
    asked: list[str] = []

    def lookup(domain):
        asked.append(domain)
        return domain != "deadmail.in"

    checked = check_mail_domains(contacts, lookup)
    assert [c.get("mx") for c in checked] == [True, False, True, None]
    assert asked == ["alpha-academy.in", "deadmail.in"]  # free mail needs no lookup
    assert [c.get("mx") for c in check_mail_domains(contacts)] == [None, None, True, None]  # no lookup, no guess
    assert mail_domain_ok("gmail.com") is True and mail_domain_ok("alpha-academy.in") is None


def test_the_lookup_asks_for_contact_lookup_and_reads_at_most_eight_results():
    lead = {"organisation": {"name": "Alpha Academy", "domain": "alpha-academy.in", "city": "Jaipur"},
            "people": [], "decision_maker": None}
    results = [SearchResult("q", i, f"Alpha Academy Jaipur {i}", f"https://site{i}.in/", "Alpha Academy Jaipur")
               for i in range(1, 15)]
    seen: dict[str, object] = {}

    def ask(system, user, model):
        seen["model"], seen["user"] = model, user
        return ContactLookup(people=[])

    lookup_contacts(lead, place=None, country="India", search=lambda q: results, ask=ask)
    assert seen["model"] is ContactLookup
    assert f"[R{LOOKUP_RESULTS}]" in seen["user"] and f"[R{LOOKUP_RESULTS + 1}]" not in seen["user"]


def test_linkedin_lookup_runs_only_for_leads_worth_calling():
    lead = {"stage": "researched", "organisation": {"name": "PCP Sikar", "city": "Sikar"}, "decision_maker": None}
    queries: list[str] = []
    search = lambda q: queries.append(q) or [  # noqa: E731
        SearchResult("q", 1, "PCP Sikar | LinkedIn", "https://www.linkedin.com/company/pcp-sikar/", "")]
    assert find_linkedin(lead, {}, "Sikar", search)["company"] is None and queries == []
    found = find_linkedin({**lead, "stage": "qualified"}, {}, "Sikar", search)
    assert found == {"company": "https://www.linkedin.com/company/pcp-sikar", "company_source": "search result",
                     "person": None}
    assert find_linkedin(lead, {"linkedin": "https://www.linkedin.com/company/x"}, None, None)["company_source"] == "website"


def test_signal_only_leads_and_left_out_kinds_after_extraction():
    extraction = signal_only_extraction("Beta Classes", [{"value": "Admission Counsellor", "location": "Jaipur",
                                                          "source": "Hiring posts"}])
    assert extraction.city == "Jaipur" and extraction.summary == "Found from Hiring posts: Admission Counsellor."
    school = AccountExtraction.model_validate({
        "organisation_name": "Alpha", "is_target_segment": False, "what_they_do": "A CBSE school", "city": None,
        "branches": [], "signals": [], "people": [], "current_software": [], "unknowns": [],
        "discovery_question": "", "summary": ""})
    assert left_out_after_extraction(school, "Alpha", ["Schools & playschools"]) == "Schools & playschools"
    coaching = school.model_copy(update={"is_target_segment": True, "what_they_do": "Coaching for school students"})
    assert left_out_after_extraction(coaching, "Alpha", ["Schools & playschools"]) is None
