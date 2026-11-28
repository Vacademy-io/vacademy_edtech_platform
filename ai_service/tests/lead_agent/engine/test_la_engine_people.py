"""Decision makers and LinkedIn people: only leaders of this organisation, never students, staff,
namesakes at other organisations, or a chain's national founder presented as the local buyer.
(Ported from the engine's tests/test_people.py.)"""

from __future__ import annotations

import pytest

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.discovery.search import SearchResult
from app.services.lead_agent.engine.research.lead import apply_rules, role_rank
from app.services.lead_agent.engine.research.social import names_organisation, pick_linkedin, recheck_person

BUYER_ROLES = ["Founder/Director", "Academic head", "Operations manager", "Admissions head"]


@pytest.mark.parametrize("role", [
    "Program Chair, Marketing", "Vice Principal & Head of Primary", "Assistant Director – Head of Retail Sales & Training",
    "MATHS faculty, Exp. 13 Years", "Academic Coordinator", "Student", "Topper, JEE 2025",
])
def test_these_are_not_decision_makers(role):
    assert role_rank(role, BUYER_ROLES) == 999


def test_leaders_rank_owners_first():
    ranks = {role: role_rank(role, BUYER_ROLES) for role in (
        "Founder & Director", "FOUNDER / PROFESSOR", "Managing Director- KPR IAS Academy", "Principal",
        "Centre Head - Bangalore East", "Admissions Manager")}
    assert ranks["Founder & Director"] == ranks["FOUNDER / PROFESSOR"] == 0
    assert max(ranks.values()) < 999
    assert ranks["Principal"] < ranks["Admissions Manager"]


def _lead(name, domain, people, city="Bengaluru", branches=()):
    return {
        "organisation": {"name": name, "listed_name": name, "website": f"https://{domain}/", "domain": domain, "city": city,
                         "what_they_do": "Coaching", "is_target_segment": True, "branches": list(branches),
                         "identity": "Official website read"},
        "signals": [{"key": "admissions_open", "label": "Admissions open", "direct": False, "value": "Admissions open",
                     "event_date": None, "quote": "Admissions open", "url": f"https://{domain}/"},
                    {"key": "enquiry_forms", "label": "Enquiry forms", "direct": False, "value": "Enquiry form",
                     "event_date": None, "quote": "Enquire now", "url": f"https://{domain}/"}],
        "people": people,
        "contacts": [{"kind": "institute_phone", "value": "+91 98450 12345", "url": f"https://{domain}/", "note": "mobile",
                      "seen_on": 3, "context": "Call us +91 98450 12345"}],
        "current_software": [], "job_posts": [], "model_unknowns": [], "discovery_question": "", "summary": "",
        "pages": [{"url": f"https://{domain}/", "type": "home", "title": name}], "evidence": [], "dropped_claims": 0,
        "researched_at": "2026-10-08T10:00:00+00:00",
    }


def _person(name, role, quote=None):
    return {"name": name, "role": role, "value": f"{name} ({role})", "quote": quote or f"{name} {role}",
            "url": "https://example.in/about"}


def test_a_chains_national_founder_is_marked_group_and_is_not_asked_for():
    lead = apply_rules(_lead("ALLEN Bengaluru", "allen.ac.in", [
        _person("Rajesh Maheshwari", "Founder Director of ALLEN Career Institute")]), ["crm"], BUYER_ROLES)
    assert lead["decision_maker"]["scope"] == "group"
    assert lead["stage"] == "qualified"  # a desk mobile with only the national founder to ask for
    assert "ask for" not in lead["contact_quality"]["label"]
    assert "Local centre's decision maker" in lead["unknowns"]
    local = apply_rules(_lead("ALLEN Bengaluru", "allen.ac.in", [
        _person("Dewansh Diwan", "Centre Head - Bangalore East")]), ["crm"], BUYER_ROLES)
    assert "scope" not in local["decision_maker"]


def test_a_program_chair_is_listed_but_not_the_decision_maker():
    lead = apply_rules(_lead("SOIL Institute of Management", "soil.edu.in", [
        _person("Prof. AN Bhattachraya", "Program Chair, Marketing, 1 Year PGPM")]), ["crm"], BUYER_ROLES)
    assert lead["decision_maker"] is None and lead["people"]
    assert lead["stage"] == "qualified"


def _result(title, url, snippet=""):
    return SearchResult("q", 1, title, url, snippet)


def test_organisation_names_need_more_than_one_shared_word():
    assert names_organisation("Founder of Gurukripa Career Institute", "Gurukripa Career Institute")
    assert names_organisation("Founder Director at ALLEN Career ...", "ALLEN Bengaluru")
    assert not names_organisation("Co-founder · aslam.sham architects", "SHAM Institute")
    assert not names_organisation("Owner, Tutor Destination Kota", "Tutorial Point Kota")


def test_linkedin_never_takes_students_namesakes_or_other_businesses():
    results = [
        _result("Purnendu Mishra - Student - GyanEdge Coaching Institute | LinkedIn", "https://in.linkedin.com/in/pm-1"),
        _result("Shilpa Bodapati - Zentech Innovations | LinkedIn", "https://in.linkedin.com/in/sb-2"),
        _result("Sham Salim - Co-founder - aslam.sham architects | LinkedIn", "https://in.linkedin.com/in/ss-3"),
    ]
    assert pick_linkedin(results, "GyanEdge Coaching Institute", "Purnendu Mishra")["person"] is None  # a student
    assert pick_linkedin(results, "Visible Campus", "Shilpa Bodapati")["person"] is None  # another company
    assert pick_linkedin(results, "SHAM Institute")["person"] is None  # an architects' firm
    real = [_result("Purnendu Mishra - Founder & Director - GyanEdge | LinkedIn", "https://in.linkedin.com/in/pm-9",
                    "Founder & Director at GyanEdge Coaching Institute · Noida")]
    assert pick_linkedin(real, "GyanEdge Coaching Institute", "Purnendu Mishra")["person"]["source"] == "decision maker"


def test_a_leader_found_by_search_must_be_in_the_runs_place():
    results = [_result("Rajesh Maheshwari - Founder Director at ALLEN Career Institute | LinkedIn",
                       "https://in.linkedin.com/in/rm-1", "Kota, Rajasthan, India")]
    assert pick_linkedin(results, "ALLEN Career Institute", None, "Coimbatore")["person"] is None
    assert pick_linkedin(results, "ALLEN Career Institute", None, "Kota")["person"]["name"] == "Rajesh Maheshwari"


def test_saved_linkedin_people_are_rechecked_without_new_searches():
    lead = _lead("Roar Education", "roareducation.ae", [], city="Dubai")
    lead["linkedin"] = {"company": None, "person": {"name": "Qaadirah Abdur-Rahim, M.B.A.", "role": "Founder & CEO of ROAR · LinkedIn",
                                                    "url": "https://www.linkedin.com/in/q", "source": "search result"}}
    assert recheck_person(lead, None, "Dubai") is None  # "ROAR" alone is not "Roar Education"
    lead["linkedin"]["person"]["role"] = "Founder & CEO · Roar Education"
    assert recheck_person(lead, None, "Dubai")["name"].startswith("Qaadirah")


@pytest.mark.parametrize("role", [
    "Directore of Power Mind Institute", "Chief Academic Officer",
    "Principal, The Shri Ram Early Years; Associate Vice President, Shri Educare Limited",
])
def test_leaders_with_unusual_titles_still_count(role):
    assert role_rank(role, BUYER_ROLES) < 999


def test_a_multi_branch_institutes_own_founder_is_its_buyer():
    branches = [{"value": f"Centre {i}", "city": None, "quote": "", "url": ""} for i in range(6)]
    lead = apply_rules(_lead("Shankar IAS Academy", "shankariasacademy.com", [
        _person("Mr. Shankar Devarajan", "Founder")], city="Chennai", branches=branches), ["crm"], BUYER_ROLES)
    assert lead["decision_maker"]["name"] == "Mr. Shankar Devarajan" and "scope" not in lead["decision_maker"]


def test_a_profile_listing_the_institute_under_education_is_a_former_student():
    results = [_result("shankar devarajan - education at shankar ias academy", "https://in.linkedin.com/in/sd-2")]
    assert pick_linkedin(results, "Shankar IAS Academy", "Mr. Shankar Devarajan")["person"] is None
