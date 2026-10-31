"""The validation effort's research extras, through research.pipeline with the REAL engine and scripted
model / searches (no database, no network): the Google Maps lookup by name (STANDARD, DEEP), the contact
hunt (1 search on STANDARD, up to 3 on DEEP), what a lead still without a contact is rejected with, and
when nothing is searched (BASIC, a lead found on Maps, a lead that cannot reach the review bar)."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import BRIEF, PLAN
from app.services.lead_agent import contact_hunt, engine_api, research
from app.services.lead_agent.search import SearchFailed, SearchResult

# A site showing only a support helpline and a support inbox: nothing outreach can use.
HOME = ("WiNNERS Institute Indore\nStudent support helpline: +91 98765 12345\nsupport@winnersinstitute.in\n"
        "JEE and NEET coaching since 2004.\nAdmissions open for the 2027 batch.\n"
        "We are hiring telecallers for our admissions office.\nFounder & Director: Aditya Patel")
REACHABLE_HOME = HOME.replace("Student support helpline: +91 98765 12345", "Call us: +91 98290 55555")
OURS = {"title": "WiNNERS Institute", "website": "https://www.winnersinstitute.in/", "phone": "098450 12345",
        "rating": 4.6, "reviews": 120, "address": "Vijay Nagar, Indore, Madhya Pradesh 452010",
        "type": "Coaching center", "cid": "123"}
SAME_NAME_ELSEWHERE = {"title": "WiNNERS Institute", "website": "https://winners-jaipur.in/", "phone": "0141 270 6587",
                       "address": "Civil Lines, Jaipur, Rajasthan 302006", "type": "Coaching center"}


def _extraction(in_segment=True):
    return engine_api.schema("AccountExtraction").model_validate({
        "organisation_name": "WiNNERS Institute", "is_target_segment": in_segment,
        "what_they_do": "JEE and NEET coaching in Indore", "city": "Indore", "branches": [],
        "signals": [{"signal": "hiring", "observation": "Hiring telecallers", "event_date": None,
                     "cite": {"page": 1, "quote": "We are hiring telecallers for our admissions office."}}],
        "people": [{"name": "Aditya Patel", "role": "Founder & Director",
                    "cite": {"page": 1, "quote": "Founder & Director: Aditya Patel"}}],
        "current_software": [], "job_posts": [], "unknowns": [],
        "discovery_question": "How do you follow up on admission enquiries today?",
        "summary": "A JEE/NEET coaching institute hiring telecallers.",
    })


def _data(effort="STANDARD", home=HOME, discovery=None, review=45, send=50):
    now = datetime.now(timezone.utc)
    agent = {"id": "a-1", "institute_id": "i-1", "mode": "REMOTE", "brief_json": BRIEF, "plan_json": PLAN,
             "markets_json": [{"country": "India", "city": "Indore"}],
             "gate_json": {"send_score": send, "auto_score": 70, "review_score": review, "min_contact": "likely",
                           "effort": effort}}
    page = {"url": "https://winnersinstitute.in/", "final_url": "https://winnersinstitute.in/", "access": "ok",
            "text": home, "links_json": [], "has_form": False, "page_type": "home", "fetched_at": now,
            "platform_hints_json": []}
    return {"cand": {"id": "c-1", "discovery_json": discovery or {"query": "q"}},
            "agent": agent, "org": {"id": "o-1", "domain": "winnersinstitute.in", "name": "WiNNERS Institute",
                                    "website": "https://winnersinstitute.in/", "city": "Indore"},
            "pages": [page], "supp": {}, "own_extension_pages": 0}


class Calls:
    """Scripted model and searches; records every search asked for."""

    def __init__(self, maps_places=(), web_results=None, fail=()):
        self.maps_queries, self.web_queries, self.asks = [], [], []
        self._maps, self._web, self._fail = list(maps_places), dict(web_results or {}), set(fail)

    def ask(self, in_segment=True):
        def ask(system, user, output, purpose, max_tokens):
            self.asks.append(purpose)
            if output.__name__ == "AccountExtraction":
                return _extraction(in_segment)
            return output.model_validate({"people": []})
        return ask

    def search(self, query):  # the decision-maker lookup's
        return []

    def maps(self, query):
        self.maps_queries.append(query)
        if "maps" in self._fail:
            raise SearchFailed("serper: HTTP 500")
        return self._maps

    def web(self, query):
        self.web_queries.append(query)
        if "web" in self._fail:
            raise SearchFailed("serper: HTTP 500")
        return next((v for k, v in self._web.items() if k in query), [])


def _run(data, calls, in_segment=True):
    return research.pipeline(data, ask=calls.ask(in_segment), search=calls.search, mx=lambda d: True,
                             maps=calls.maps, web=calls.web)


def _found_by(result, found_by):
    return [c for c in result["lead_json"]["contacts"] if c.get("found_by") == found_by]


def _snippet(title, url, snippet):
    return [SearchResult(query="q", rank=1, title=title, url=url, snippet=snippet)]


# ----------------------------------------------------------------------------------- Google Maps lookup

def test_a_lead_not_found_on_maps_is_looked_up_once_and_gets_its_listings_phone():
    calls = Calls(maps_places=[SAME_NAME_ELSEWHERE, OURS])
    result = _run(_data(), calls)
    assert calls.maps_queries == ["WiNNERS Institute Indore"]
    maps = _found_by(result, "google_maps")
    assert [c["value"] for c in maps] == ["+91 98450 12345"]  # not the Jaipur namesake's number
    assert maps[0]["quality"] == "likely" and maps[0]["url"] == "https://maps.google.com/?cid=123"
    lead = result["lead_json"]
    assert lead["maps_listing"]["source"] == "maps lookup" and lead["maps_lookup"]["phone"] == "+91 98450 12345"
    assert lead["fetch"]["maps_lookup"] is True and lead["fetch"]["effort"] == "STANDARD"
    assert result["status"] != "REJECTED"
    assert calls.web_queries == []  # reachable now: no hunt


def test_a_maps_phone_matching_a_website_number_confirms_it():
    calls = Calls(maps_places=[{**OURS, "phone": "+91 98290 55555"}])
    result = _run(_data(home=REACHABLE_HOME), calls)
    phone = next(c for c in result["lead_json"]["contacts"] if c["kind"] == "institute_phone")
    assert phone["maps_confirmed"] is True and _found_by(result, "google_maps") == []


def test_a_listing_without_a_website_needs_the_same_name_in_the_same_city():
    no_site = {k: v for k, v in OURS.items() if k != "website"}
    assert _found_by(_run(_data(), Calls(maps_places=[no_site])), "google_maps")
    elsewhere = {**no_site, "address": "Civil Lines, Jaipur, Rajasthan 302006"}
    result = _run(_data(), Calls(maps_places=[elsewhere]))
    assert _found_by(result, "google_maps") == [] and result["lead_json"]["maps_lookup"]["found"] is False


@pytest.mark.parametrize("why, data", [
    ("BASIC buys no search", _data(effort="BASIC")),
    ("found through the Maps lane already", _data(discovery={"query": "q", "maps": {**OURS, "phone": None}})),
    ("cannot reach the send bar even with a contact", _data(send=95)),
])
def test_no_maps_search_when_the_effort_or_the_lead_does_not_call_for_one(why, data):
    calls = Calls(maps_places=[OURS])
    _run(data, calls)
    assert calls.maps_queries == [], why


def test_with_no_assumed_contact_only_a_lead_already_at_the_bar_is_searched(monkeypatch):
    # The literal rule: no reach points without a contact, so this lead (fit + hiring, no contact) is
    # below the bar and would never be searched for.
    monkeypatch.setattr(contact_hunt, "SEARCH_ASSUMES_CONTACT", None)
    calls = Calls(maps_places=[OURS])
    _run(_data(), calls)
    assert calls.maps_queries == [] and calls.web_queries == []


def test_another_segment_is_never_searched_for():
    calls = Calls(maps_places=[OURS])
    result = _run(_data(), calls, in_segment=False)
    assert calls.maps_queries == [] and calls.web_queries == [] and result["status"] == "REJECTED"


def test_a_failed_maps_search_is_skipped():
    calls = Calls(fail={"maps"})
    result = _run(_data(), calls)
    assert calls.maps_queries and result["lead_json"]["fetch"]["maps_lookup"] is False
    assert calls.web_queries == ["WiNNERS Institute Indore contact number"]  # the hunt still runs


# ----------------------------------------------------------------------------------------- contact hunt

HUNTED = _snippet("WiNNERS Institute Indore | Facebook", "https://www.facebook.com/winnersindore",
                  "WiNNERS Institute, Vijay Nagar, Indore. Call 98450 12345 for JEE admissions.")


def test_standard_hunts_once_for_the_organisations_own_number():
    calls = Calls(web_results={"contact number": HUNTED})
    result = _run(_data(), calls)
    assert calls.web_queries == ["WiNNERS Institute Indore contact number"]
    hunted = _found_by(result, "contact_hunt")
    assert [(c["value"], c["quality"]) for c in hunted] == [("+91 98450 12345", "likely")]
    lead = result["lead_json"]
    assert lead["contact_hunt"] == {"searches": 1, "queries": calls.web_queries, "found": 1}
    assert lead["fetch"]["contact_hunt_searches"] == 1 and result["status"] != "REJECTED"
    assert any(e["field"] == "Contact (contact search, facebook.com)" for e in lead["evidence"])


def test_deep_hunts_up_to_three_searches_and_reads_social_pages_from_their_results():
    social = _snippet("WiNNERS Institute Indore - Instagram", "https://www.instagram.com/winnersindore",
                      "WiNNERS Institute Indore. DM or call 98450 12345")
    calls = Calls(web_results={"site:facebook.com": social})
    result = _run(_data(effort="DEEP"), calls)
    assert calls.web_queries == ["WiNNERS Institute Indore contact number", "WiNNERS Institute Indore email",
                                 "WiNNERS Institute Indore site:facebook.com OR site:instagram.com OR "
                                 "site:linkedin.com/company"]
    assert [c["value"] for c in _found_by(result, "contact_hunt")] == ["+91 98450 12345"]


def test_the_hunt_stops_at_the_first_reachable_contact():
    calls = Calls(web_results={"contact number": HUNTED})
    _run(_data(effort="DEEP"), calls)
    assert calls.web_queries == ["WiNNERS Institute Indore contact number"]


def test_an_unnamed_gmail_is_not_a_reachable_contact_so_the_hunt_runs():
    home = HOME.replace("support@winnersinstitute.in", "Email: rk1980@gmail.com")
    calls = Calls(web_results={"contact number": HUNTED})
    result = _run(_data(home=home), calls)
    assert calls.web_queries and _found_by(result, "contact_hunt")


def test_no_hunt_when_the_website_already_gives_a_reachable_contact():
    calls = Calls()
    _run(_data(home=REACHABLE_HOME), calls)
    assert calls.web_queries == []


def test_a_suppressed_hunted_number_is_never_added():
    data = _data()
    data["supp"] = {"PHONE": {"9845012345"}}
    result = _run(data, Calls(web_results={"contact number": HUNTED}))
    assert _found_by(result, "contact_hunt") == []


def test_a_failed_hunt_search_ends_the_hunt():
    calls = Calls(fail={"web"})
    result = _run(_data(effort="DEEP"), calls)
    assert len(calls.web_queries) == 1 and result["lead_json"]["contact_hunt"]["searches"] == 0


# ---------------------------------------------------------------------------- still no reachable contact

def test_a_lead_still_without_a_contact_says_what_was_tried():
    result = _run(_data(), Calls())
    assert result["status"] == "REJECTED"
    assert result["reject_reason"] == "No reachable contact after the website, Google Maps and 1 contact search"


def test_deep_counts_its_searches_in_the_reject_reason():
    result = _run(_data(effort="DEEP"), Calls())
    assert result["reject_reason"] == "No reachable contact after the website, Google Maps and 3 contact searches"


def test_basic_keeps_the_gates_own_words():
    result = _run(_data(effort="BASIC"), Calls())
    assert result["reject_reason"].startswith("No usable contact")


def test_the_reason_helper_names_each_step():
    assert contact_hunt.no_contact_reason(maps_checked=False, decision_maker=False, hunt_searches=0) is None
    assert contact_hunt.no_contact_reason(maps_checked=True, decision_maker=True, hunt_searches=2) == (
        "No reachable contact after the website, Google Maps, a decision-maker search and 2 contact searches")
