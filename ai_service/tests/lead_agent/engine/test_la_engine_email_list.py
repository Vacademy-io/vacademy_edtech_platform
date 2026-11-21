"""Ported from the engine's tests/test_email_list.py."""

from __future__ import annotations

import pytest

from la_engine_fixtures import PLAN

from app.services.lead_agent.engine.config import EngineConfig
from app.services.lead_agent.engine.planning import email_query_count, email_site_count, finalise_plan
from app.services.lead_agent.engine.research.contacts import email_kind, list_emails


@pytest.mark.parametrize("email, kind", [
    ("info@alpha-academy.in", "Organisation inbox"),
    ("admissions@alpha-academy.in", "Organisation inbox"),
    ("director@alpha-academy.in", "Leader's inbox"),
    ("ravi.kumar@alpha-academy.in", "Named mailbox"),
    ("alphaacademy@gmail.com", "Institute's Gmail"),
    ("rk1980@gmail.com", "Personal mailbox"),
])
def test_email_kinds(email, kind):
    assert email_kind(email, "Alpha Academy") == kind


def test_only_mailable_and_unsuppressed_emails_are_listed():
    contacts = [
        {"kind": "published_email", "value": "info@alpha-academy.in", "url": "https://alpha-academy.in/contact", "note": "", "seen_on": 2,
         "context": "info@alpha-academy.in", "mx": True},
        {"kind": "published_email", "value": "careers@alpha-academy.in", "url": "https://alpha-academy.in/", "note": "", "seen_on": 1,
         "context": "careers@alpha-academy.in"},
        {"kind": "published_email", "value": "old@alpha-academy.in", "url": "https://alpha-academy.in/", "note": "", "seen_on": 1,
         "context": "old@alpha-academy.in"},
        {"kind": "published_email", "value": "x@deadmail.in", "url": "https://alpha-academy.in/", "note": "", "seen_on": 1,
         "context": "x@deadmail.in", "mx": False},
        {"kind": "institute_phone", "value": "+91 98450 12345", "url": "https://alpha-academy.in/", "note": "mobile"},
    ]
    rows = list_emails(contacts, site_domain="alpha-academy.in", organisation="Alpha Academy", suppressed={"old@alpha-academy.in"})
    assert rows == [{"email": "info@alpha-academy.in", "email_type": "Organisation inbox", "mx": True,
                     "page_url": "https://alpha-academy.in/contact"}]


def test_an_email_list_reads_more_websites_than_emails_wanted_and_plans_many_searches():
    cfg = EngineConfig()
    assert email_site_count(500, cfg) == 750 and email_query_count(750) == 200 and email_query_count(75) == 38
    assert email_query_count(5000) == 200 and email_query_count(4) == 3
    guided = {"guided": True, "mode": "emails", "products": ["crm"], "lead_count": 500, "format": "csv",
              "location": {"country": "India", "city": "Jaipur"},
              "industries": [{"name": "Coaching institutes", "search_term": "coaching institute"}]}
    data = finalise_plan(PLAN, cfg, guided)
    assert data["mode"] == "emails" and data["candidate_count"] == 750
    assert any(n.startswith("Email list: reading up to 750 websites") for n in data["notes"])
    assert not any(n.startswith("Search budget") or n.startswith("Decision makers") for n in data["notes"])


def test_generic_free_mail_and_unrelated_domains_are_not_listed():
    def c(email):
        return {"kind": "published_email", "value": email, "url": "https://chemica.in/", "note": "", "seen_on": 1, "context": email}
    rows = list_emails([c("info@gmail.com"), c("hello@raque.com"), c("dssirchemistry@gmail.com"), c("info@chemica.in"),
                        c("admissions@chemicaclasses.com")],
                       site_domain="chemica.in", organisation="Chemica chemistry classes", suppressed=set())
    assert [r["email"] for r in rows] == ["dssirchemistry@gmail.com", "info@chemica.in", "admissions@chemicaclasses.com"]


def test_an_email_list_plans_only_the_searches_its_budget_pays_for():
    from decimal import Decimal

    from app.services.lead_agent.engine.planning import affordable_searches

    assert affordable_searches(Decimal("0.034"), Decimal("0.001")) == 20  # about Rs 3
    assert affordable_searches(Decimal("1.00"), Decimal("0")) == 664
    assert affordable_searches(Decimal("0.004"), Decimal("0.003")) == 0


def test_email_lists_choose_own_websites_by_rules_without_ai():
    from app.services.lead_agent.engine.discovery.pipeline import rule_selection
    from app.services.lead_agent.engine.discovery.search import SearchResult

    results = [
        SearchResult("q", 1, "Top 10 Tutoring Centers in Austin (2026)", "https://blog.example.com/top-tutoring", "Our list"),
        SearchResult("q", 2, "Bright Minds Tutoring Center | Austin, TX", "https://brightminds.com/", "Tutoring for K-12"),
        SearchResult("q", 3, "Tutor jobs in Austin", "https://jobs.example.com/tutor", "Hiring tutors"),
        SearchResult("q", 4, "Austin Learning Center - Math & Reading", "https://austinlearning.com/about", "Learning center"),
        SearchResult("q", 5, "City Bakery", "https://citybakery.com/", "Fresh bread"),
        SearchResult("q", 6, "Tutoring tips", "https://example.org/a/b/c", "How tutoring helps"),
    ]
    picked = rule_selection(results, 10, [{"name": "Tutoring centers", "search_term": "tutoring center"},
                                          {"name": "Learning centers", "search_term": "learning center"}])
    assert [(o.result_id, o.name) for o in picked.organisations] == [(2, "Bright Minds Tutoring Center"), (4, "Austin Learning Center")]
