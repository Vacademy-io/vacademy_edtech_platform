"""Ported from the engine's tests/test_exclusions.py."""

from __future__ import annotations

import pytest

from la_engine_fixtures import PLAN, FakeSearch, asker

from app.services.lead_agent.engine.config import EngineConfig
from app.services.lead_agent.engine.discovery.exclusions import kept_industries, left_out
from app.services.lead_agent.engine.discovery.pipeline import ORG_BATCH, discover
from app.services.lead_agent.engine.errors import InvalidOutput
from app.services.lead_agent.engine.planning import finalise_plan
from app.services.lead_agent.engine.schemas import DiscoverySelection

SCHOOLS = ["Schools & playschools"]


@pytest.mark.parametrize("name", [
    "Peepal Prodigy School", "Manchester International School", "THE HILLSIDE PREP SCHOOL", "Little Illusions Preschool",
    "Lilliputs Play Way School", "Kendriya Vidyalaya No. 2", "Tiny Tots Montessori", "K-12 schools & playschools",
])
def test_schools_are_left_out(name):
    assert left_out(name, SCHOOLS) == "Schools & playschools"


@pytest.mark.parametrize("name", [
    "Vidyamandir Classes", "LISAA School Of Design", "MINIBOSS BUSINESS SCHOOL", "Coding School India",
    "Online coaching institutes", "ALLEN Career Institute", "Manipal University Jaipur (Online)",
])
def test_coaching_online_academies_and_training_schools_are_kept(name):
    assert left_out(name, SCHOOLS) is None


def test_colleges_and_typed_kinds_are_left_out_only_when_listed():
    assert left_out("Manipal University Jaipur (Online)", SCHOOLS + ["Colleges & universities"]) == "Colleges & universities"
    assert left_out("Government Polytechnic Indore", ["Government institutions"]) == "Government institutions"
    assert left_out("Government Polytechnic Indore", SCHOOLS) is None


def test_left_out_industries_are_dropped_from_the_run():
    industries = [{"name": "Coaching institutes", "search_term": "coaching institute"},
                  {"name": "K-12 schools & playschools", "search_term": "school"},
                  {"name": "Online academies", "search_term": "online academy"}]
    assert [i["name"] for i in kept_industries(industries, SCHOOLS)] == ["Coaching institutes", "Online academies"]
    only_schools = industries[1:2]
    assert kept_industries(only_schools, SCHOOLS) == only_schools  # never an empty run


def test_the_plan_searches_only_kept_industries_and_says_what_is_left_out():
    guided = {
        "guided": True, "products": ["complete_vacademy"], "lead_count": 10, "format": "xlsx",
        "location": {"country": "India", "city": "Indore"}, "exclude": SCHOOLS,
        "industries": [{"name": "K-12 schools & playschools", "search_term": "school"},
                       {"name": "Online coaching institutes", "search_term": "online coaching institute"}],
    }
    data = finalise_plan(PLAN, EngineConfig(), guided)
    assert data["industries"] == ["Online coaching institutes"]
    assert data["search_term"] == "online coaching institute"
    assert data["exclude"] == SCHOOLS
    assert "Leaving out: Schools & playschools." in data["notes"]


def test_discovery_lists_left_out_organisations_without_researching_them():
    results = {"JEE coaching Bangalore": [
        ("Peepal Prodigy School - CBSE", "https://www.peepalprodigy.com/", "K-12 school in Bangalore"),
        ("Integrator Classes", "https://www.integratorclasses.com/", "JEE and NEET coaching"),
    ]}
    prompts: list[str] = []

    def select(system: str, user: str) -> DiscoverySelection:
        prompts.append(system)
        return DiscoverySelection(organisations=[
            {"result_id": 1, "name": "Peepal Prodigy School", "reason": "own website"},
            {"result_id": 2, "name": "Integrator Classes", "reason": "own website"},
        ])

    outcome = discover(
        plan=PLAN, candidate_count=5, seeds=[], sources=["organisation_search"], max_queries=1, max_signal_queries=0,
        search=FakeSearch(results), ask=asker(select), exclude=SCHOOLS,
    )
    assert "Leave out these kinds of organisations even when they match: Schools & playschools." in prompts[0]
    assert [(c.name, c.included, c.note) for c in outcome.candidates] == [
        ("Peepal Prodigy School", False, "Left out: Schools & playschools."),
        ("Integrator Classes", True, None),
    ]


def test_big_runs_choose_organisations_in_batches_and_survive_a_bad_reply():
    queries = [f"coaching query {q}" for q in range(12)]
    results = {q: [(f"Academy {q}-{i} - coaching", f"https://www.academy{q}x{i}.in/", "coaching") for i in range(8)]
               for q in queries}
    seen: list[int] = []

    def select(system: str, user: str) -> DiscoverySelection:
        count = user.count("\n[")  # one line per result
        seen.append(count)
        if len(seen) == 2:
            raise InvalidOutput("cut off")
        return DiscoverySelection(organisations=[
            {"result_id": i, "name": f"Org {len(seen)}-{i}", "reason": "own site"} for i in range(1, count + 1)])

    outcome = discover(
        plan=PLAN.model_copy(update={"search_queries": queries}), candidate_count=200, seeds=[],
        sources=["organisation_search"], max_queries=12, max_signal_queries=0,
        search=FakeSearch(results), ask=asker(select),
    )
    assert len(seen) == 3 and max(seen) <= ORG_BATCH
    assert len(outcome.included) == sum(seen) - seen[1]  # the bad batch is skipped, the others kept
    assert any("skipped" in n for n in outcome.notes)
