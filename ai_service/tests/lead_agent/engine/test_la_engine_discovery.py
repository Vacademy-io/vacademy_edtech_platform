"""Ported from the engine's tests/test_discovery.py (Bing link decoding, the OpenRouter search
adapter and the SQLite search cache stayed in the engine)."""

from __future__ import annotations

import socket

from la_engine_fixtures import PLAN, BatchSearch, FakeSearch, asker

from app.services.lead_agent.engine.discovery.domains import homepage, is_excluded, is_portal_name, registered_domain
from app.services.lead_agent.engine.discovery.pipeline import discover, match_supplied_name, split_budget, usable_results
from app.services.lead_agent.engine.discovery.search import SearchFailed, SearchResult
from app.services.lead_agent.engine.discovery.sources import keyword_queries, signal_queries
from app.services.lead_agent.engine.schemas import DiscoverySelection, SignalSelection

RESULTS = {
    "JEE coaching Bangalore": [
        ("Top 10 Coaching Institutes in Bangalore", "https://collegedunia.com/coaching/bangalore", "List of..."),
        ("ALLEN Bengaluru - JEE coaching", "https://www.allen.ac.in/bengaluru/", "Admissions open"),
        ("NV Classes - JEE & NEET coaching", "https://www.nvclasses.com/", "Bangalore centre"),
    ],
    "NEET coaching Bangalore": [
        ("NV Classes NEET batch", "https://nvclasses.com/neet", "duplicate domain"),
        ("Integrator Classes", "https://www.integratorclasses.com/", "NEET coaching in Bangalore"),
        ("Coaching institutes - Facebook", "https://www.facebook.com/groups/x", "social"),
    ],
}


def run(selection_ids, seeds=(), candidate_count=20, search=None, max_queries=3, sources=("organisation_search",)):
    search = search or FakeSearch(RESULTS)
    prompts: list[str] = []
    events: list[str] = []

    def select(system: str, user: str) -> DiscoverySelection:
        prompts.append(user)
        return DiscoverySelection(organisations=[
            {"result_id": rid, "name": name, "reason": "own website"} for rid, name in selection_ids
        ])

    outcome = discover(
        plan=PLAN, candidate_count=candidate_count, seeds=list(seeds), sources=list(sources), max_queries=max_queries,
        max_signal_queries=0, search=search, ask=asker(select), progress=lambda m, *_: events.append(m),
        check_cancelled=lambda: None,
    )
    return outcome, search, prompts, events


def test_domain_helpers():
    assert registered_domain("https://www.allen.ac.in/bengaluru/") == "allen.ac.in"
    assert registered_domain("nvclasses.com") == "nvclasses.com"
    assert homepage("https://www.allen.ac.in/bengaluru/?x=1") == "https://www.allen.ac.in/"
    assert is_excluded("justdial.com") and is_excluded(None) and not is_excluded("allen.ac.in")


def test_registered_domains_never_fetch_the_suffix_list(monkeypatch):
    """tldextract uses its bundled public-suffix snapshot only (suffix_list_urls=())."""
    import tldextract

    def no_network(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    fresh = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True)
    assert fresh("https://www.allen.ac.in/").top_domain_under_public_suffix == "allen.ac.in"
    assert registered_domain("https://learn.example.co.uk/x") == "example.co.uk"


def _pool():
    return [SearchResult(q, rank, t, u, s) for q, rows in RESULTS.items() for rank, (t, u, s) in enumerate(rows, 1)]


def _id(domain: str) -> int:
    """The [id] the model sees for a domain (1-based position in the usable list)."""
    return [registered_domain(r.url) for r in usable_results(_pool(), set())].index(domain) + 1


def test_directories_social_and_duplicate_domains_are_filtered():
    usable = usable_results(_pool(), taken=set())
    # One result per domain (the best-ranked), ordered by rank across queries.
    assert sorted(registered_domain(r.url) for r in usable) == ["allen.ac.in", "integratorclasses.com", "nvclasses.com"]
    assert [r.rank for r in usable] == sorted(r.rank for r in usable)


def test_search_finds_organisations_and_model_can_only_pick_real_results():
    # 99 does not exist and NV Classes is picked twice. Websites come from results, names from the model.
    picks = [(_id("allen.ac.in"), "ALLEN Bengaluru"), (99, "Invented Academy"),
             (_id("integratorclasses.com"), "Integrator"), (_id("nvclasses.com"), "NV Classes"),
             (_id("nvclasses.com"), "NV again")]
    outcome, search, prompts, _ = run(picks)

    assert search.queries == ["JEE coaching Bangalore", "NEET coaching Bangalore"]
    assert [(c.name, c.domain, c.source) for c in outcome.candidates] == [
        ("ALLEN Bengaluru", "allen.ac.in", "search"),
        ("Integrator", "integratorclasses.com", "search"),
        ("NV Classes", "nvclasses.com", "search"),
    ]
    assert outcome.candidates[0].website == "https://www.allen.ac.in/"
    assert outcome.candidates[0].detail["query"] == "JEE coaching Bangalore"
    assert "collegedunia" not in prompts[0] and "facebook" not in prompts[0]
    assert any("Found 3 of the 20" in n for n in outcome.notes)


def test_supplied_websites_come_first_and_are_not_repeated_from_search():
    seeds = [{"name": "ALLEN", "url": "https://www.allen.ac.in/"}]
    outcome, _, prompts, _ = run([(1, "First remaining result")], seeds=seeds)
    assert [c.source for c in outcome.candidates] == ["supplied", "search"]
    assert "allen.ac.in" not in prompts[0]


def test_enough_supplied_organisations_means_no_search():
    seeds = [{"url": f"https://org{i}.in/"} for i in range(3)]
    outcome, search, _, _ = run([], seeds=seeds, candidate_count=3)
    assert search.queries == [] and len(outcome.candidates) == 3


def test_supplied_names_get_their_website_from_search_or_are_flagged():
    search = FakeSearch({
        "Integrator Classes Bangalore": [("Integrator Classes | NEET", "https://www.integratorclasses.com/", "")],
        "Unknown Tutorials Bangalore": [("Some other site", "https://othersite.in/", "")],
    })
    seeds = [{"name": "Integrator Classes"}, {"name": "Unknown Tutorials"}]
    outcome, _, _, _ = run([], seeds=seeds, candidate_count=2, search=search)
    found, missing = outcome.candidates
    assert found.website == "https://www.integratorclasses.com/" and found.included
    assert missing.website is None and not missing.included and "No website found" in missing.note


def test_name_matching_ignores_generic_words():
    results = [SearchResult("q", 1, "Best Coaching Academy in Bangalore", "https://bestacademy.in/", "")]
    assert match_supplied_name("Coaching Academy", results, set()) is None
    assert match_supplied_name("Best Academy", results, set()) is not None


def test_name_matching_with_a_place_skips_same_name_organisations_elsewhere():
    results = [
        SearchResult("q", 1, "Vinayak Public School, Ayodhya", "https://vinayakps.in/", "CBSE school in Ayodhya"),
        SearchResult("q", 2, "Vinayak Classes Jaipur | JEE NEET", "https://vinayakclasses.in/", "Coaching in Jaipur"),
    ]
    assert match_supplied_name("Vinayak Education Society", results, set()).url == "https://vinayakps.in/"
    assert match_supplied_name("Vinayak Education Society", results, set(), "Jaipur").url == "https://vinayakclasses.in/"
    assert match_supplied_name("Vinayak Education Society", results[:1], set(), "Jaipur") is None


def test_free_hosting_sites_are_separate_and_portals_are_never_organisations():
    assert registered_domain("https://sainikcoaching.web.app/contact") == "sainikcoaching.web.app"
    assert registered_domain("https://alpha.web.app/") != registered_domain("https://beta.web.app/")
    assert is_excluded("someone.blogspot.com") and is_excluded("shine.com") and not is_excluded("allen.ac.in")
    assert is_portal_name("Shine.com") and is_portal_name("Naukri jobs") and is_portal_name("Indeed India")
    assert not is_portal_name("CollegeBatch.com / Drishti IAS") and not is_portal_name("Aakash Institute")


def test_blocked_search_keeps_what_was_found():
    outcome, _, _, _ = run([], search=FakeSearch(RESULTS, blocked_after=1))
    assert any("asked for verification" in n for n in outcome.notes)


def test_a_failed_search_is_skipped_and_others_still_run():
    calls: list[str] = []

    def flaky(query: str):
        calls.append(query)
        if query == "JEE coaching Bangalore":
            raise SearchFailed("timeout")
        return FakeSearch(RESULTS)(query)

    outcome, _, prompts, events = run([(1, "NV Classes")], search=flaky)
    assert calls == ["JEE coaching Bangalore", "NEET coaching Bangalore"]
    assert any("failed" in e for e in events) and outcome.candidates[0].domain == "nvclasses.com"


def test_search_results_are_capped_per_query():
    many = {"JEE coaching Bangalore": [(f"Academy {i}", f"https://academy{i}.in/", "coaching") for i in range(20)]}
    outcome, _, prompts, _ = run([], search=FakeSearch(many), max_queries=1)
    assert prompts[0].count("\n[") == 8  # RESULTS_PER_QUERY


# ------------------------------------------------------------------ signal sources

NAUKRI = "https://www.naukri.com/job-listings-telecaller-alpha-academy-bangalore-123"
LINKEDIN = "https://www.linkedin.com/posts/beta-classes_hiring-admission-counsellor-activity-1"
SIGNAL_RESULTS = {"*": [
    ("Telecaller - Alpha Academy - Bangalore | Naukri.com", NAUKRI,
     "Alpha Academy is hiring telecallers for admissions follow-up. Posted 3 days ago"),
    ("Beta Classes on LinkedIn: We are hiring an Admission Counsellor", LINKEDIN,
     "We are hiring an Admission Counsellor for our Jayanagar centre"),
    ("Telecaller jobs in Bangalore - Quess Staffing", "https://www.quesscorp.com/jobs/telecaller",
     "Apply for telecaller jobs with top companies"),
    ("Alpha Academy | JEE and NEET coaching", "https://www.alphaacademy.in/", "Classroom programmes for JEE and NEET"),
]}


def signal_run(findings, *, known=None, sources=("hiring_callers", "linkedin_posts"), candidate_count=5, plan=PLAN):
    search = FakeSearch(SIGNAL_RESULTS)
    prompts: dict[str, str] = {}

    def select_signals(system: str, user: str) -> SignalSelection:
        prompts["signals"] = user
        return SignalSelection(findings=findings)

    outcome = discover(
        plan=plan, candidate_count=candidate_count, seeds=[], sources=list(sources), max_queries=2,
        max_signal_queries=6, search=search, ask=asker(select_signals=select_signals),
        find_known=lambda name: known.get(name) if known else None,
    )
    return outcome, search, prompts


def finding(result_id, org, quote, signal="hiring", role="Telecaller", date=None):
    return {"result_id": result_id, "organisation_name": org, "signal": signal, "role_or_need": role,
            "quote": quote, "event_date": date, "location": "Bangalore"}


def test_signal_queries_are_built_per_industry_for_the_chosen_sources():
    coaching = {"search_term": "coaching institute"}
    queries = signal_queries(["hiring_callers", "linkedin_posts"], [coaching], "Bangalore", 6)
    assert ("hiring_callers", "coaching institute hiring telecaller Bangalore") in queries
    assert all("site:linkedin.com" in q for k, q in queries if k == "linkedin_posts")
    assert signal_queries(["organisation_search"], [coaching], "y", 6) == []

    # The product analysis's phrases replace the defaults, and each industry gets its own searches.
    estate = {"search_term": "real estate developer", "hiring_phrases": ["hiring tele sales"],
              "need_phrases": ["need CRM for leads"]}
    queries = signal_queries(["hiring_callers", "software_requests"], [coaching, estate], "Jaipur", 2)
    assert ("hiring_callers", "real estate developer hiring tele sales Jaipur") in queries
    assert ("software_requests", "real estate developer Jaipur need CRM for leads") in queries
    # With 2 searches per industry, each industry gets one from each source rather than two hiring searches.
    for kind in ("coaching institute", "real estate developer"):
        assert sorted(k for k, q in queries if q.startswith(kind)) == ["hiring_callers", "software_requests"]

    # A run's hiring roles replace those phrases; each industry starts with a different role.
    roles = ["admission counsellor", "academic counsellor"]
    queries = signal_queries(["hiring_callers"], [coaching, estate], "Jaipur", 2, roles)
    assert queries == [  # industries take turns, so a budget that cuts the list still covers both
        ("hiring_callers", "coaching institute hiring admission counsellor Jaipur"),
        ("hiring_callers", "real estate developer hiring academic counsellor Jaipur"),
        ("hiring_callers", "coaching institute hiring academic counsellor Jaipur"),
        ("hiring_callers", "real estate developer hiring admission counsellor Jaipur"),
    ]
    # Several places: each industry-place pair gets its searches, taking turns.
    two = signal_queries(["hiring_callers"], [coaching], ["Jaipur", "Kota"], 1, roles)
    assert two == [("hiring_callers", "coaching institute hiring admission counsellor Jaipur"),
                   ("hiring_callers", "coaching institute hiring admission counsellor Kota")]


def test_signals_find_the_hiring_organisation_and_its_website_without_extra_searches():
    outcome, search, prompts = signal_run([
        finding(1, "Alpha Academy", "Alpha Academy is hiring telecallers", date="3 days ago"),
        finding(1, "Alpha Academy", "hiring telecallers for admissions follow-up"),  # same signal again
        finding(2, "Beta Classes", "Invented quote that is not in the result"),  # quote check fails
        finding(9, "Ghost Institute", "anything"),  # no such result
    ])
    # Only results mentioning a hiring word reach the model; the plain website result does not.
    assert "Quess Staffing" in prompts["signals"] and "Classroom programmes" not in prompts["signals"]
    [alpha] = outcome.candidates
    assert (alpha.name, alpha.source, alpha.domain) == ("Alpha Academy", "signal", "alphaacademy.in")
    assert alpha.detail["website_from"] == "matched in search results"
    [signal] = alpha.detail["signals"]
    assert signal["url"] == NAUKRI and signal["event_date"] == "3 days ago"
    assert signal["source"] == "Hiring posts"
    assert (signal["key"], signal["label"]) == ("hiring", "Hiring telecaller")
    assert not any(q.startswith("Alpha Academy") for q in search.queries)  # no extra lookup needed


def test_signal_organisation_without_a_website_is_kept_as_a_signal_only_lead():
    outcome, search, _ = signal_run([finding(2, "Beta Classes", "We are hiring an Admission Counsellor")])
    [beta] = outcome.candidates
    assert beta.website is None and beta.included and "search result only" in beta.note
    assert "Beta Classes Bangalore" in search.queries  # one lookup was tried


def test_hiring_counts_only_for_the_roles_the_search_is_about():
    lms = PLAN.model_copy(update={"target_products": ["lms"], "hiring_roles": ["admission counsellor"]})
    outcome, search, prompts = signal_run([
        finding(1, "Alpha Academy", "Alpha Academy is hiring telecallers"),
        finding(2, "Beta Classes", "We are hiring an Admission Counsellor", role="Admission Counsellor"),
    ], plan=lms)
    [beta] = outcome.candidates  # the telecaller post is not a sign that Alpha needs an LMS
    assert beta.name == "Beta Classes" and beta.detail["signals"][0]["label"] == "Hiring admission counsellor"
    assert any("hiring admission counsellor" in q for q in search.queries)
    assert not any("telecaller" in q for q in search.queries)


def test_websites_known_from_earlier_runs_are_reused():
    outcome, search, _ = signal_run(
        [finding(2, "Beta Classes", "We are hiring an Admission Counsellor")],
        known={"Beta Classes": ("betaclasses.in", "https://www.betaclasses.in/")},
    )
    assert outcome.candidates[0].domain == "betaclasses.in"
    assert outcome.candidates[0].detail["website_from"] == "known from an earlier run"
    assert "Beta Classes Bangalore" not in search.queries


def test_no_signal_sources_means_no_signal_searches():
    outcome, search, prompts = signal_run([], sources=("organisation_search",))
    assert "signals" not in prompts
    assert all("telecaller" not in q for q in search.queries)


def test_signals_can_be_switched_off():
    search = FakeSearch(SIGNAL_RESULTS)
    discover(plan=PLAN, candidate_count=5, seeds=[], sources=["hiring_callers", "keyword_search"], max_queries=0,
             max_signal_queries=6, search=search, ask=asker(), use_signals=False, keywords=["looking for LMS"],
             max_keyword_queries=2)
    assert search.queries == []


def test_searches_go_out_together_when_the_provider_allows():
    search = BatchSearch(SIGNAL_RESULTS)
    discover(
        plan=PLAN, candidate_count=5, seeds=[], sources=["hiring_callers", "linkedin_posts", "organisation_search"],
        max_queries=2, max_signal_queries=6, search=search, search_many=search.search_many,
        ask=asker(select_signals=lambda s, u: SignalSelection(findings=[
            finding(2, "Beta Classes", "We are hiring an Admission Counsellor"),
            finding(1, "Alpha Academy", "Alpha Academy is hiring telecallers"),
        ])),
    )
    signal_and_general, lookups = search.batches
    assert len(signal_and_general) == 4 + 2  # 4 signal searches and 2 general searches in one batch
    assert lookups == ["Beta Classes Bangalore"]  # Alpha's website was already in the results


def test_keyword_queries_cover_every_keyword_on_the_web_before_linkedin_and_facebook():
    keywords = ["looking for LMS", "learning management software", "online test platform"]
    industries = [{"search_term": "coaching institute"}, {"search_term": "school"}]
    queries = keyword_queries(keywords, industries, "Jaipur", ["web", "linkedin", "facebook"], 5)
    assert queries == [
        ("web", "looking for LMS coaching institute Jaipur"),
        ("web", "learning management software school Jaipur"),
        ("web", "online test platform coaching institute Jaipur"),
        ("linkedin", "looking for LMS Jaipur site:linkedin.com"),
        ("linkedin", "learning management software Jaipur site:linkedin.com"),
    ]
    assert keyword_queries(keywords, industries, "", ["facebook"], 1) == [("facebook", "looking for LMS site:facebook.com")]


KEYWORD_RESULTS = {"*": [
    ("Gamma Classes on LinkedIn: we are looking for an LMS for our 4 centres",
     "https://www.linkedin.com/posts/gamma-classes-1", "Gamma Classes is looking for an LMS for our 4 centres in Bangalore"),
    ("Delta Academy | Online test platform for NEET", "https://www.deltaacademy.in/",
     "Delta Academy runs its own online test platform for NEET students in Bangalore"),
    ("Top 10 LMS software 2026", "https://www.capterra.com/lms", "Compare learning management software"),
]}


def test_keyword_search_finds_need_posts_and_checks_the_keyword_is_really_quoted():
    search = FakeSearch(KEYWORD_RESULTS)
    prompts: dict[str, str] = {}
    keywords = ["looking for LMS", "online test platform"]

    def select_signals(system: str, user: str) -> SignalSelection:
        prompts["system"], prompts["user"] = system, user
        return SignalSelection(findings=[
            finding(1, "Gamma Classes", "looking for an LMS for our 4 centres", signal="explicit_software_need",
                    role="LMS for 4 centres"),
            finding(2, "Delta Academy", "runs its own online test platform", signal="keyword_need", role="online test platform"),
            finding(2, "Delta Academy", "NEET students in Bangalore", signal="keyword_need", role="LMS"),  # no keyword quoted
        ])

    outcome = discover(
        plan=PLAN, candidate_count=5, seeds=[], sources=["keyword_search"], max_queries=0, max_signal_queries=0,
        search=search, ask=asker(select_signals=select_signals),
        keywords=keywords, keyword_channels=["web", "linkedin"], max_keyword_queries=4,
    )
    assert search.queries[:4] == [
        "looking for LMS coaching institute Bangalore", "online test platform coaching institute Bangalore",
        "looking for LMS Bangalore site:linkedin.com", "online test platform Bangalore site:linkedin.com",
    ]
    assert "Keywords: looking for LMS, online test platform" in prompts["system"]
    by_name = {c.name: c for c in outcome.candidates}
    assert by_name["Gamma Classes"].detail["signals"][0]["key"] == "explicit_software_need"
    [delta_signal] = by_name["Delta Academy"].detail["signals"]
    assert (delta_signal["key"], delta_signal["label"]) == ("keyword_need", 'Mentions "online test platform"')
    assert delta_signal["source"] == "Keyword search"
    assert outcome.keyword_queries_run == 4


def test_the_search_budget_keeps_general_searches_and_shares_the_rest():
    org, signals, keywords, lookups = split_budget(8, ["g1", "g2", "g3"], [f"s{i}" for i in range(12)], [f"k{i}" for i in range(10)])
    assert org == ["g1", "g2", "g3"] and lookups == 1
    assert signals == ["s0", "s1"] and keywords == ["k0", "k1"]
    assert split_budget(8, ["g1"], [], ["k0"]) == (["g1"], [], ["k0"], 6)  # unused searches go to lookups


def test_budgeted_discovery_runs_no_more_searches_than_allowed():
    search = FakeSearch(SIGNAL_RESULTS)
    discover(
        plan=PLAN, candidate_count=5, seeds=[], sources=["hiring_callers", "linkedin_posts", "organisation_search", "keyword_search"],
        max_queries=2, max_signal_queries=6, search=search,
        ask=asker(select_signals=lambda s, u: SignalSelection(findings=[
            finding(2, "Beta Classes", "We are hiring an Admission Counsellor")])),
        keywords=["looking for LMS", "LMS tender", "which LMS"], max_keyword_queries=10, search_budget=6,
    )
    assert len(search.queries) <= 6


def test_the_model_is_asked_with_the_output_model_it_must_fill():
    asked: list[type] = []

    def ask(system, user, model):
        asked.append(model)
        return model(organisations=[]) if model is DiscoverySelection else model(findings=[])

    discover(plan=PLAN, candidate_count=5, seeds=[], sources=["hiring_callers", "organisation_search"], max_queries=2,
             max_signal_queries=2, search=FakeSearch(SIGNAL_RESULTS), ask=ask)
    assert set(asked) == {DiscoverySelection, SignalSelection}
