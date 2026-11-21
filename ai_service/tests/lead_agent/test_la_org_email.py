"""Gate.org_email_only (2026-11-21): lists that send by email abroad take a lead only with a business email.
A person reviewing such leads turned down a personal (Gmail-type) mailbox, no email at all and inboxes nobody
who buys reads (careers@, membership@ ...); the gate now does it, so these lists need no approval. All
organisations and addresses below are invented."""
from __future__ import annotations

import pytest

from conftest import INSTITUTE, make_candidate, make_world
from app.services.lead_agent import contact_hunt, delivery, engine_api, models, scheduler, store

ON = {**engine_api.default_gate(), "org_email_only": True}
OFF = engine_api.default_gate()


def _scored(score=70, flags=()):
    return {"score": score, "base_score": score, "fit": 60, "intent": 0, "reach": 70, "risk": 0,
            "has_intent": False, "reach_level": "likely", "flags": list(flags), "reasons": ["Fit 60/100"],
            "gate_reasons": []}


def _mail(value, quality="likely", **extra):
    return {"kind": "published_email", "value": value, "quality": quality, **extra}


PHONE = {"kind": "institute_phone", "value": "+44 20 7946 0000", "quality": "likely"}


def _lead(*contacts, domain="brightpath-example.co.uk"):
    return {"organisation": {"name": "Brightpath Tutors", "domain": domain, "website": f"https://{domain}/"},
            "phone_region": "GB", "contacts": list(contacts),
            "contact_quality": {"level": "likely", "label": "Named mailbox"}}


def _cand(lead, cid="c-1"):
    return {"id": cid, "lead_json": lead, "score_json": _scored(), "score": 70}


# ------------------------------------------------------------------------------------------ the gate

def test_only_a_gmail_is_rejected_as_a_personal_address():
    decision, reasons = engine_api.gate(_scored(), _lead(_mail("brightpath.tutor@gmail.com"), PHONE), ON)
    assert decision == "REJECT" and reasons[0].startswith("Only a personal email address")


@pytest.mark.parametrize("domain", ["yahoo.co.uk", "hotmail.fr", "outlook.com.au", "btinternet.com", "gmx.de",
                                    "icloud.com", "proton.me"])
def test_free_and_isp_mailboxes_are_personal(domain):
    assert engine_api.is_free_mail(domain)
    decision, reasons = engine_api.gate(_scored(), _lead(_mail(f"someone@{domain}")), ON)
    assert decision == "REJECT" and reasons[0].startswith("Only a personal email address")


def test_an_email_on_the_organisations_domain_goes_out_when_the_score_passes():
    lead = _lead(_mail("hello@brightpath-example.co.uk", "general", owner="own"))
    decision, reasons = engine_api.gate(_scored(70), lead, ON)
    assert decision == "AUTO" and reasons == ["Score 70 meets the send bar (50) with a likely contact"]
    # the score still decides first
    decision, reasons = engine_api.gate(_scored(40), lead, ON)
    assert decision == "REJECT" and reasons[0] == "Score 40 is below the send bar (50)"


def test_another_company_domain_counts_as_business():
    assert engine_api.gate(_scored(), _lead(_mail("office@brightpath-group.example")), ON)[0] == "AUTO"


@pytest.mark.parametrize("inboxes", [["careers@brightpath-example.co.uk"],
                                     ["membership@brightpath-example.co.uk", "records@brightpath-example.co.uk"],
                                     ["jobs@brightpath-example.co.uk", "no-reply@brightpath-example.co.uk"],
                                     ["privacy@brightpath-example.co.uk", "hr.team@brightpath-example.co.uk"]])
def test_only_careers_or_membership_inboxes_are_rejected(inboxes):
    decision, reasons = engine_api.gate(_scored(), _lead(*[_mail(v, owner="own") for v in inboxes], PHONE), ON)
    assert decision == "REJECT" and reasons[0].startswith("Only careers/membership-type inboxes")


def test_no_email_at_all_is_rejected_even_with_a_phone():
    decision, reasons = engine_api.gate(_scored(), _lead(PHONE), ON)
    assert decision == "REJECT" and reasons == ["No business email found: the lead has no email address"]


def test_an_avoided_business_email_does_not_count():
    lead = _lead(_mail("info@webagency-example.com", "avoid", owner="other"))
    decision, reasons = engine_api.gate(_scored(), lead, ON)
    assert decision == "REJECT" and reasons[0].startswith("No business email found")


def test_a_list_that_needs_approval_still_rejects_what_a_person_would():
    gate = {**ON, "require_approval": True}
    assert engine_api.gate(_scored(), _lead(_mail("tutor.jane@gmail.com")), gate)[0] == "REJECT"
    assert engine_api.gate(_scored(), _lead(_mail("info@brightpath-example.co.uk")), gate)[0] == "REVIEW"


def test_flag_off_keeps_the_old_behaviour():
    lead = _lead(_mail("brightpath.tutor@gmail.com"))
    assert engine_api.gate(_scored(), lead, OFF) == (
        "AUTO", ["Score 70 meets the send bar (50) with a likely contact"])
    assert engine_api.gate(_scored(), _lead(PHONE), OFF)[0] == "AUTO"
    assert delivery.build_row(_cand(lead), OFF)["email"] == "brightpath.tutor@gmail.com"
    # an agent without the setting keeps its fingerprint (its REVIEW rows are not read again)
    assert engine_api.gate_fingerprint(OFF) == engine_api.gate_fingerprint({k: v for k, v in OFF.items()
                                                                              if k != "org_email_only"})
    assert engine_api.gate_fingerprint(ON) == engine_api.gate_fingerprint(OFF) + ":orgmail=1"


def test_the_search_guards_do_not_rule_out_a_lead_looking_for_its_business_email():
    lead = _lead(_mail("brightpath.tutor@gmail.com"))
    score = lambda _lead: _scored()  # noqa: E731
    assert contact_hunt.worth_searching(lead, _scored(), ON, score)
    assert contact_hunt.worth_a_lookup(lead, _scored(), ON, score)


def test_the_gate_setting_is_saved_and_defaults_off():
    assert models.Gate().org_email_only is False
    assert models.Gate(org_email_only=True).model_dump()["org_email_only"] is True
    assert store.DEFAULT_GATE_JSON["org_email_only"] is False


# ------------------------------------------------------------------------------------------ delivery

def test_gmail_and_an_org_inbox_goes_out_with_the_org_inbox():
    # a leader's own Gmail rated direct beats the inbox without the setting; with it, only business email goes
    lead = _lead(_mail("jane.founder@gmail.com", "direct", owner="person", person={"name": "Jane Founder"}),
                 _mail("info@brightpath-example.co.uk", "general", owner="own"))
    assert engine_api.gate(_scored(), lead, ON)[0] == "AUTO"
    assert delivery.build_row(_cand(lead), OFF)["email"] == "jane.founder@gmail.com"
    row = delivery.build_row(_cand(lead), ON)
    assert row["email"] == "info@brightpath-example.co.uk"
    assert models.candidate_summary({**_cand(lead), "status": "APPROVED"}, ON)["send"]["email"]["value"] == (
        "info@brightpath-example.co.uk")


def test_a_careers_inbox_is_never_the_email_sent():
    lead = _lead(_mail("careers@brightpath-example.co.uk", "general", owner="own"),
                 _mail("office@brightpath-example.co.uk", "likely", owner="own"))
    assert delivery.build_row(_cand(lead), ON)["email"] == "office@brightpath-example.co.uk"


def test_engine_rated_contacts_keep_the_org_inbox():
    from app.services.lead_agent.engine.research.lead import rate_contacts

    domain = "brightpath-example.co.uk"
    lead = {"organisation": {"name": "Brightpath Tutors", "domain": domain, "website": f"https://{domain}/",
                             "branches": []},
            "people": [], "phone_region": "GB", "decision_maker": None,
            "contacts": [{"url": f"https://{domain}/", "seen_on": 1, "note": "", "kind": "published_email",
                          "value": v, "context": v} for v in ("brightpathtutors@gmail.com", f"info@{domain}")]}
    lead["contacts"] = rate_contacts(lead, [])
    lead["contact_quality"] = {"level": "likely"}
    assert engine_api.gate(_scored(), lead, ON)[0] == "AUTO"
    assert delivery.build_row(_cand(lead), ON)["email"] == f"info@{domain}"


# ------------------------------------------------------------------------------------------ re-judging REVIEW

def _waiting(la_db, agent, domain, lead):
    return make_candidate(la_db, agent, domain, status="REVIEW", decision="REVIEW", score=70,
                          score_json=_scored(70), lead_json=lead)


def test_waiting_leads_are_judged_again_with_org_email_only(la_db):
    agent = make_world(la_db)
    with la_db() as db:  # it needed approval: the queue waited for a person
        agent = store.update_agent(db, agent["id"], INSTITUTE,
                                   {"gate_json": {**store.DEFAULT_GATE_JSON, "require_approval": True}})
        db.commit()
    org = _waiting(la_db, agent, "org.example", _lead(_mail("tutor.sam@gmail.com"),
                                                      _mail("info@org.example", "general", owner="own"),
                                                      domain="org.example"))
    personal = _waiting(la_db, agent, "personal.example", _lead(_mail("tutor.ann@yahoo.co.uk"),
                                                                domain="personal.example"))
    careers = _waiting(la_db, agent, "careers.example", _lead(_mail("careers@careers.example", owner="own"),
                                                              domain="careers.example"))
    none = _waiting(la_db, agent, "none.example", _lead(PHONE, domain="none.example"))
    with la_db() as db:
        assert scheduler.rejudge_waiting(db, store.get_agent(db, agent["id"])) == {"approved": 0, "rejected": 0}
        agent = store.update_agent(db, agent["id"], INSTITUTE, {"gate_json": {
            **store.DEFAULT_GATE_JSON, "require_approval": False, "org_email_only": True}})
        assert scheduler.rejudge_waiting(db, agent) == {"approved": 1, "rejected": 3}
        db.commit()
        rows = {c["id"]: store.get_candidate(db, c["id"]) for c in (org, personal, careers, none)}
    assert (rows[org["id"]]["status"], rows[org["id"]]["decision"]) == ("APPROVED", "AUTO")
    assert delivery.build_row(rows[org["id"]], agent["gate_json"])["email"] == "info@org.example"
    for cand, why in ((personal, "Only a personal email address"), (careers, "Only careers/membership-type inboxes"),
                      (none, "No business email found")):
        row = rows[cand["id"]]
        assert row["status"] == "REJECTED" and row["reject_reason"].startswith(why), row["reject_reason"]
