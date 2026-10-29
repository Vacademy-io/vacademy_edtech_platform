"""Delivery and billing on real Postgres with a fake admin_core and a fake
billing call: quota, window, best-score order, CREATED / DUPLICATE /
existing-contact / suppressed paths, one idempotent charge per lead, local vs
remote price, monthly cap."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, make_candidate, make_world
from app.services.lead_agent import admin_core, billing, delivery, store


def lead(phone="+91 98765 12345", email="aditya@winners.example.in", extension_pages=0, name="Aditya Patel"):
    return {
        "organisation": {"name": "WiNNERS Institute", "website": "https://winners.example.in/", "city": "Indore"},
        "decision_maker": {"name": name, "role": "Founder & Director"},
        "contacts": [
            {"kind": "institute_phone", "value": phone, "quality": "likely", "person": None},
            {"kind": "published_email", "value": email, "quality": "direct",
             "person": {"name": name, "role": "Founder & Director"}},
            {"kind": "contact_form", "value": "https://winners.example.in/contact", "quality": "general"},
        ],
        "contact_quality": {"level": "likely", "label": f"Desk mobile / WhatsApp: ask for {name}"},
        "phone_region": "IN", "summary": "JEE coaching, admissions open", "discovery_question": "How do you follow up?",
        "evidence": [{"field": "Signal: Admissions open", "quote": "Admissions open for 2027", "url": "https://w/"}],
        "platforms": [{"name": "Appx", "kind": "lms"}],
        "fetch": {"extension_pages": extension_pages, "server_pages": 1},
    }


class FakeAdminCore:
    def __init__(self, monkeypatch, existing_phones=(), duplicate_ids=()):
        self.calls, self.existing_phones, self.duplicate_ids = [], set(existing_phones), set(duplicate_ids)
        monkeypatch.setattr(admin_core, "existing_contacts", self.existing)
        monkeypatch.setattr(admin_core, "bulk_intake", self.intake)

    async def existing(self, institute_id, phones, emails):
        self.calls.append(("existing", institute_id, sorted(phones), sorted(emails)))
        return {"phones": [p for p in phones if p in self.existing_phones], "emails": []}

    async def intake(self, institute_id, audience_id, rows):
        self.calls.append(("intake", institute_id, audience_id, [r["external_id"] for r in rows]))
        self.rows = rows
        return [{"external_id": r["external_id"],
                 "status": "DUPLICATE" if r["external_id"] in self.duplicate_ids else "CREATED",
                 "response_id": f"resp-{r['external_id'][:8]}"} for r in rows]


@pytest.fixture
def ledger(la_db, monkeypatch):
    """record_tool_billing that writes the ledger row like the real one (fixed price per tool key)."""
    import app.services.ai_billing as ai_billing

    calls = []

    def fake_record(**kw):
        calls.append(kw)
        price = {"lead_agent_lead_local": 2, "lead_agent_lead_remote": 4}[kw["tool_key"]]
        with la_db() as db:
            db.execute(text("INSERT INTO credit_transactions (institute_id, amount, transaction_type, "
                            "external_reference_id) VALUES (:i, :a, 'USAGE_DEDUCTION', :k) "
                            "ON CONFLICT DO NOTHING"),
                       {"i": kw["institute_id"], "a": -price, "k": kw["idempotency_key"]})
            db.commit()
    monkeypatch.setattr(ai_billing, "record_tool_billing", fake_record)
    return calls


def _approved(la_db, agent, domain, score, **kw):
    return make_candidate(la_db, agent, domain, status="APPROVED", score=score, lead_json=lead(**kw),
                          score_json={"score": score, "reasons": ["Admissions open"]}, decision="AUTO")


def _status(la_db, cid):
    with la_db() as db:
        return db.execute(text("SELECT status, credits_charged, delivered_response_id, delivery_note "
                               "FROM lead_candidate WHERE id = :i"), {"i": cid}).first()


def test_quota_and_best_score_first_then_one_charge_each(la_db, monkeypatch, ledger):
    agent = make_world(la_db, quota=2)
    low = _approved(la_db, agent, "low.in", 71, phone="+91 90000 00001")
    high = _approved(la_db, agent, "high.in", 90, phone="+91 90000 00002")
    mid = _approved(la_db, agent, "mid.in", 80, phone="+91 90000 00003", extension_pages=2)
    fake = FakeAdminCore(monkeypatch)
    out = asyncio.run(delivery.deliver(agent))
    assert out == {"delivered": 2, "skipped": 0, "failed": 0}
    assert fake.calls[1][3] == [high["id"], mid["id"]]
    assert _status(la_db, high["id"])[:2] == ("DELIVERED", Decimal("4.00"))   # server-read: remote price
    assert _status(la_db, mid["id"])[:2] == ("DELIVERED", Decimal("2.00"))    # extension-read: local price
    assert _status(la_db, low["id"])[0] == "APPROVED"
    assert [c["idempotency_key"] for c in ledger] == [f"lead_agent:{high['id']}", f"lead_agent:{mid['id']}"]
    assert {c["tool_key"] for c in ledger} == {"lead_agent_lead_remote", "lead_agent_lead_local"}
    with la_db() as db:
        day = db.execute(text("SELECT delivered, credits FROM lead_agent_day")).first()
    assert day == (2, Decimal("6.00"))
    # quota met: a second pass delivers nothing more
    assert asyncio.run(delivery.deliver(agent))["delivered"] == 0


def test_row_shape(la_db, monkeypatch, ledger):
    agent = make_world(la_db)
    c = _approved(la_db, agent, "w.in", 82)
    fake = FakeAdminCore(monkeypatch)
    asyncio.run(delivery.deliver(agent))
    row = fake.rows[0]
    assert row["external_id"] == c["id"] and row["mobile"] == "+919876512345"
    # The phone sent is the desk mobile, so the lead is the organisation and asks for the founder,
    # whose own email is sent (2026-10-29 replay: named after the email's owner, the call rang the desk).
    assert row["email"] == "aditya@winners.example.in" and row["full_name"] == "WiNNERS Institute"
    cf = row["custom_fields"]
    assert cf["la_org_name"] == "WiNNERS Institute" and cf["la_score"] == "82"
    assert cf["la_role"] == "" and cf["la_platforms"] == "Appx (lms)"
    assert cf["la_ask_for"] == "Aditya Patel (Founder & Director)"
    assert "Admissions open for 2027" in row["note"]
    assert set(cf) == {"la_org_name", "la_website", "la_city", "la_role", "la_ask_for", "la_contact_quality",
                       "la_other_contacts", "la_score", "la_why", "la_opening", "la_platforms", "la_source_url"}


def test_duplicate_existing_and_suppressed_are_skipped_free(la_db, monkeypatch, ledger):
    agent = make_world(la_db, quota=10)
    dup = _approved(la_db, agent, "dup.in", 90, phone="+91 90000 00010")
    known = _approved(la_db, agent, "known.in", 85, phone="+91 90000 00011", email="a@known.in")
    supp = _approved(la_db, agent, "supp.in", 80, phone="+91 90000 00012", email="b@supp.in")
    with la_db() as db:
        store.insert_suppression(db, institute_id=INSTITUTE, kind="PHONE", value="9000000012", reason="CUSTOMER",
                                 note=None, created_by="u")
        db.commit()
    fake = FakeAdminCore(monkeypatch, existing_phones={"9000000011"}, duplicate_ids={dup["id"]})
    out = asyncio.run(delivery.deliver(agent))
    assert out == {"delivered": 0, "skipped": 3, "failed": 0}
    assert _status(la_db, dup["id"])[0] == "SKIPPED"
    assert _status(la_db, known["id"])[3].startswith("Already in your leads")
    assert _status(la_db, supp["id"])[3] == "Suppressed phone"
    assert ledger == []   # nothing delivered, nothing charged


def test_outside_the_window_nothing_is_delivered(la_db, monkeypatch, ledger):
    agent = make_world(la_db, window={"tz": "Asia/Kolkata", "start": "09:30", "end": "19:00", "days": [1]})
    _approved(la_db, agent, "w.in", 90)
    FakeAdminCore(monkeypatch)
    sunday_noon = datetime(2026, 10, 25, 6, 30, tzinfo=timezone.utc)   # Sunday 12:00 IST
    assert asyncio.run(delivery.deliver(agent, now=sunday_noon))["delivered"] == 0


def test_admin_core_failure_keeps_the_lead_approved_and_held(la_db, monkeypatch, ledger):
    agent = make_world(la_db)
    c = _approved(la_db, agent, "w.in", 90)

    async def broken(*a, **k):
        raise admin_core.AdminCoreError("HTTP 503")
    monkeypatch.setattr(admin_core, "existing_contacts", broken)
    assert asyncio.run(delivery.deliver(agent))["failed"] == 1
    with la_db() as db:
        row = db.execute(text("SELECT status, not_before > now(), last_error FROM lead_candidate")).first()
    assert row[0] == "APPROVED" and row[1] is True and "503" in row[2]


def test_charge_is_idempotent(la_db, ledger):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, status="DELIVERED", lead_json=lead())
    with la_db() as db:
        cand = store.get_candidate(db, c["id"])
    assert billing.charge(cand, agent) == Decimal("4")
    assert billing.charge(cand, agent) == Decimal("4")
    assert len(ledger) == 1
    with la_db() as db:
        assert db.execute(text("SELECT credits FROM lead_agent_day")).scalar() == Decimal("4.00")


def test_uncharged_delivered_leads_are_charged_on_the_next_pass(la_db, monkeypatch, ledger):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, status="DELIVERED", lead_json=lead(), delivered_at=datetime.now(timezone.utc))
    FakeAdminCore(monkeypatch)
    asyncio.run(delivery.deliver(agent))
    assert _status(la_db, c["id"])[1] == Decimal("4.00") and len(ledger) == 1


def test_monthly_cap_stops_discovery_and_delivery(la_db, monkeypatch, ledger):
    import app.services.ai_billing as ai_billing

    agent = make_world(la_db)
    with la_db() as db:
        store.update_agent(db, agent["id"], INSTITUTE, {"monthly_credit_cap": Decimal("6")})
        db.commit()
        agent = store.get_agent(db, agent["id"])
    monkeypatch.setattr(ai_billing, "preflight_tool_credits",
                        lambda db, **kw: {"current_balance": 1000, "sufficient": True})
    assert billing.affordable(agent, 1) == (True, "")
    make_candidate(la_db, agent, "a.in", status="DELIVERED", credits_charged=Decimal("4"),
                   delivered_at=datetime.now(timezone.utc))
    ok, why = billing.affordable(agent, 1)
    assert ok is False and "Monthly credit cap" in why
    make_candidate(la_db, agent, "b.in", status="DELIVERED", credits_charged=Decimal("2"),
                   delivered_at=datetime.now(timezone.utc))
    assert billing.cap_reached(agent) is True
    _approved(la_db, agent, "c.in", 90)
    FakeAdminCore(monkeypatch)
    assert asyncio.run(delivery.deliver(agent))["delivered"] == 0


def test_wallet_must_cover_the_rest_of_the_quota(la_db, monkeypatch):
    import app.services.ai_billing as ai_billing

    agent = make_world(la_db, mode="REMOTE")
    monkeypatch.setattr(ai_billing, "preflight_tool_credits",
                        lambda db, **kw: {"current_balance": 10, "sufficient": True})
    assert billing.affordable(agent, 2)[0] is True       # 2 x 4 = 8 <= 10
    ok, why = billing.affordable(agent, 3)                 # 12 > 10
    assert ok is False and "Not enough credits" in why
    monkeypatch.setattr(ai_billing, "preflight_tool_credits",
                        lambda db, **kw: {"current_balance": 0, "sufficient": False, "plan_covered": "INCLUDED"})
    assert billing.affordable(agent, 3)[0] is True        # an AI plan covers it


def _unhold(la_db):
    with la_db() as db:
        db.execute(text("UPDATE lead_candidate SET not_before = now() WHERE status = 'APPROVED'"))
        db.commit()


def test_a_failed_chunk_keeps_earlier_chunks_and_retries_idempotently(la_db, monkeypatch, ledger):
    agent = make_world(la_db, quota=12)
    cands = [_approved(la_db, agent, f"c{i:02d}.in", 90 - i, phone=f"+91 90000 001{i:02d}") for i in range(12)]
    fake = FakeAdminCore(monkeypatch)
    calls = {"n": 0}
    created = {}

    async def flaky(institute_id, audience_id, rows):
        calls["n"] += 1
        if calls["n"] == 2:
            for r in rows:   # admin_core created them, but the answer never came back
                created[r["external_id"]] = f"resp-{r['external_id'][:8]}"
            raise admin_core.AdminCoreError("/bulk-intake: ReadTimeout")
        out = []
        for r in rows:
            status = "ALREADY_CREATED" if r["external_id"] in created else "CREATED"
            created.setdefault(r["external_id"], f"resp-{r['external_id'][:8]}")
            out.append({"external_id": r["external_id"], "status": status, "response_id": created[r["external_id"]]})
        return out
    monkeypatch.setattr(admin_core, "bulk_intake", flaky)
    out = asyncio.run(delivery.deliver(agent))
    assert out == {"delivered": 10, "skipped": 0, "failed": 2}
    later = [c["id"] for c in cands[10:]]
    assert all(_status(la_db, c["id"])[0] == "DELIVERED" for c in cands[:10]) and len(ledger) == 10
    with la_db() as db:
        assert db.execute(text("SELECT delivered FROM lead_agent_day")).scalar() == 10   # 2 slots given back
        rows = db.execute(text("SELECT intake_attempted_at IS NOT NULL, delivery_attempts FROM lead_candidate "
                               "WHERE id = ANY(CAST(:i AS VARCHAR[]))"), {"i": later}).fetchall()
    assert rows == [(True, 1), (True, 1)]
    # admin_core now has their phones: a retry must NOT be stopped by existing-contacts
    fake.existing_phones = {"9000000110", "9000000111"}
    _unhold(la_db)
    out = asyncio.run(delivery.deliver(agent))
    assert out == {"delivered": 2, "skipped": 0, "failed": 0}
    assert all(_status(la_db, i)[0] == "DELIVERED" and _status(la_db, i)[2] == created[i] for i in later)
    assert len(ledger) == 12 and all(call[0] != "existing" or not call[2] for call in fake.calls[1:])


def test_permanent_failures_stop_at_the_attempts_cap(la_db, monkeypatch, ledger):
    agent = make_world(la_db)
    c = _approved(la_db, agent, "bad.in", 90)
    FakeAdminCore(monkeypatch)

    async def always_failed(institute_id, audience_id, rows):
        return [{"external_id": r["external_id"], "status": "FAILED", "message": "no phone or email"} for r in rows]
    monkeypatch.setattr(admin_core, "bulk_intake", always_failed)
    for _ in range(delivery.MAX_DELIVERY_ATTEMPTS):
        asyncio.run(delivery.deliver(agent))
        _unhold(la_db)
    status, _credits, _resp, note = _status(la_db, c["id"])
    assert status == "FAILED" and note.startswith(f"Delivery failed {delivery.MAX_DELIVERY_ATTEMPTS} times")
    with la_db() as db:
        assert db.execute(text("SELECT delivered FROM lead_agent_day")).scalar() == 0


def test_two_passes_at_once_never_exceed_the_quota(la_db, monkeypatch, ledger):
    agent = make_world(la_db, quota=3)
    for i in range(6):
        _approved(la_db, agent, f"q{i}.in", 90 - i, phone=f"+91 90000 002{i:02d}")
    FakeAdminCore(monkeypatch)

    async def both():
        return await asyncio.gather(delivery.deliver(agent), delivery.deliver(agent))
    a, b = asyncio.run(both())
    assert a["delivered"] + b["delivered"] == 3
    with la_db() as db:
        assert db.execute(text("SELECT count(*) FROM lead_candidate WHERE status = 'DELIVERED'")).scalar() == 3
        assert db.execute(text("SELECT delivered FROM lead_agent_day")).scalar() == 3


def test_a_free_lead_is_settled_once(la_db, monkeypatch, ledger):
    agent = make_world(la_db)
    with la_db() as db:
        db.execute(text("UPDATE ai_tool_pricing SET flat_base_credits = 0"))
        db.commit()
    import app.services.ai_billing as ai_billing
    calls = []
    monkeypatch.setattr(ai_billing, "record_tool_billing", lambda **kw: calls.append(kw))  # no ledger row at 0
    c = _approved(la_db, agent, "free.in", 90)
    FakeAdminCore(monkeypatch)
    try:
        for _ in range(3):
            asyncio.run(delivery.deliver(agent))
    finally:  # the pricing rows are shared by the whole test session
        with la_db() as db:
            db.execute(text("UPDATE ai_tool_pricing SET flat_base_credits = CASE tool_key "
                            "WHEN 'lead_agent_lead_local' THEN 2 ELSE 4 END"))
            db.commit()
    assert len(calls) == 1
    with la_db() as db:
        row = db.execute(text("SELECT credits_charged, charged_at IS NOT NULL FROM lead_candidate WHERE id = :i"),
                         {"i": c["id"]}).first()
    assert tuple(row) == (Decimal("0.00"), True)


def test_cap_room_limits_one_pass(la_db, monkeypatch, ledger):
    agent = make_world(la_db, quota=10, mode="REMOTE")
    with la_db() as db:
        store.update_agent(db, agent["id"], INSTITUTE, {"monthly_credit_cap": Decimal("9")})
        db.commit()
        agent = store.get_agent(db, agent["id"])
    for i in range(4):
        _approved(la_db, agent, f"cap{i}.in", 90 - i, phone=f"+91 90000 003{i:02d}")
    FakeAdminCore(monkeypatch)
    assert billing.cap_room(agent) == 2                    # floor(9 / 4)
    assert asyncio.run(delivery.deliver(agent))["delivered"] == 2


def test_local_agents_and_own_extension_pages_bill_local():
    assert billing.tool_key_for({"fetch": {"extension_pages": 0}}, "LOCAL") == billing.TOOL_LOCAL
    assert billing.tool_key_for({"fetch": {"extension_pages": 1}}, "AUTO") == billing.TOOL_LOCAL
    assert billing.tool_key_for({"fetch": {"extension_pages": 0, "pages_used": 4}}, "AUTO") == billing.TOOL_REMOTE


# Which phone, email and name a lead is delivered with (real cases from the 2026-10-29 audit of the
# live agent "Leads for Vacademy"). Pure: no database.

def _cand(lead_json, cid="c-1"):
    return {"id": cid, "lead_json": lead_json, "score_json": {}, "score": 80}


def _rated(name, domain, contacts, people=(), decision_maker=None):
    """A lead whose contacts the engine rated, as research stores it."""
    from app.services.lead_agent.engine.research.lead import rate_contacts

    lead_json = {"organisation": {"name": name, "domain": domain, "website": f"https://{domain}/", "branches": []},
                 "people": list(people), "phone_region": "IN", "decision_maker": decision_maker,
                 "contacts": [{"url": f"https://{domain}/", "seen_on": 1, "note": "", **c} for c in contacts]}
    lead_json["contacts"] = rate_contacts(lead_json, [])
    return lead_json


def _mail(value, context=""):
    return {"kind": "published_email", "value": value, "context": context or value}


@pytest.mark.parametrize("name, domain, emails, sent", [
    ("Aadhar Institute", "aadharinstitute.com",
     [_mail("iguruji.in@gmail.com"), _mail("aadharinstitute@gmail.com")], "aadharinstitute@gmail.com"),
    ("Persona Educational Institute", "personaei.in",
     [_mail("ja10106371@yahoo.com"), _mail("a1persona@yahoo.com")], "a1persona@yahoo.com"),
    ("Bharadwaj Institute", "bharadwajinstitute.com",
     [_mail("contact@mysite.com"), _mail("bharadwajinstitute@gmail.com")], "bharadwajinstitute@gmail.com"),
    ("Indian Institute of Skill Development Training (IISDT)", "bkvps.in",
     [_mail("royalindiasecuritaus@gmail.com"), _mail("info@iisdt.in")], "info@iisdt.in"),
    ("Kristu Jayanti College", "kristujayanti.edu.in",
     [_mail("navajyothistudyhouse@gmail.com"), _mail("admission@kristujayanti.com")], "admission@kristujayanti.com"),
    ("Turning Point", "turningpointedu.org",
     [_mail("tnchowdhary@hotmail.com", "You can mail your resume at tnchowdhary@hotmail.com"),
      _mail("info@turningpointedu.org")], "info@turningpointedu.org"),
    ("Samved School", "samvedschool.com",
     [_mail("aves1967@gmail.com", "resume, kindly indicate the post applied for and send to aves1967@gmail.com"),
      _mail("office@samvedschool.in")], "office@samvedschool.in"),
    # A mailbox named after the organisation on another domain is its own (2026-10-29 replay).
    ("Evolvv", "evolvv.in", [_mail("rk1980@gmail.com"), _mail("evolvv@techvito.in")], "evolvv@techvito.in"),
    ("AICPE Educational Services Pvt. Ltd.", "aicpeindia.org", [_mail("aicpe@bizindia.org")], "aicpe@bizindia.org"),
])
def test_the_email_sent_is_the_one_the_organisation_owns(name, domain, emails, sent):
    row = delivery.build_row(_cand(_rated(name, domain, emails)))
    assert row["email"] == sent


def test_an_unnamed_gmail_is_sent_only_when_nothing_better_is_on_the_lead():
    row = delivery.build_row(_cand(_rated("Alpha Academy", "alpha-academy.in", [_mail("rk1980@gmail.com")])))
    assert row["email"] == "rk1980@gmail.com"


def test_leads_rated_before_owners_were_stored_still_prefer_their_own_domain():
    lead_json = {"organisation": {"name": "WiNNERS Institute", "website": "https://www.winners.example.in/"},
                 "phone_region": "IN", "contacts": [
                     {"kind": "published_email", "value": "rk1980@gmail.com", "quality": "likely"},
                     {"kind": "published_email", "value": "info@winners.example.in", "quality": "general"}]}
    assert delivery.build_row(_cand(lead_json))["email"] == "info@winners.example.in"


def _phone(value, quality, note, **extra):
    return {"kind": "institute_phone", "value": value, "quality": quality, "note": note, **extra}


def test_the_phone_sent_is_the_best_tier_then_a_mobile_then_one_google_maps_also_lists():
    # The tier comes first since the 2026-10-29 replay: a likely mobile used to beat a decision maker's
    # direct landline, and iimidr.ac.in was sent a student's mobile from its placements page ("Aarna
    # Khera 9818457004") over the chairman's own line.
    principal = {"name": "Dr. Asmita A. Vaidya", "role": "Principal"}
    contacts = [
        _phone("+91 22 2204 1707", "direct", "landline", person=principal),
        _phone("+91 98450 12345", "likely", "mobile"),
        _phone("+91 98290 55555", "likely", "mobile", maps_confirmed=True),
        _phone("+91 99000 11111", "general", "mobile"),
    ]
    lead_json = {"organisation": {"name": "Alpha Academy"}, "phone_region": "IN", "contacts": contacts}
    phone, _, others = delivery.best_contacts(lead_json)
    assert phone["value"] == "+91 22 2204 1707"  # the principal's own landline beats a desk mobile
    assert [c["value"] for c in others] == ["+91 98450 12345", "+91 98290 55555", "+91 99000 11111"]
    phone, _, _ = delivery.best_contacts({**lead_json, "contacts": contacts[1:]})
    assert phone["value"] == "+91 98290 55555"  # within a tier a mobile, and one Google Maps also lists
    phone, _, _ = delivery.best_contacts({**lead_json, "contacts": contacts[1:2] + contacts[3:]})
    assert phone["value"] == "+91 98450 12345"
    general = [_phone("+91 80 4567 8901", "general", "landline"), _phone("+91 99000 11111", "general", "")]
    phone, _, _ = delivery.best_contacts({**lead_json, "contacts": general})
    assert phone["value"] == "+91 99000 11111"  # typed from the number itself when the note is missing
    founder = {"name": "Meena Iyer", "role": "Founder"}
    own_line = [_phone("+91 98290 55555", "likely", "mobile", maps_confirmed=True),
                _phone("+91 98450 12345", "direct", "mobile", person=founder)]
    phone, _, _ = delivery.best_contacts({**lead_json, "contacts": own_line})
    assert phone["value"] == "+91 98450 12345"  # the founder's own mobile beats a desk mobile Maps lists


def test_the_maps_listing_and_the_website_number_are_listed_once():
    contacts = [_phone("+91 98290 55555", "likely", "mobile", maps_confirmed=True),
                {"kind": "institute_phone", "value": "+91 98290 55555", "quality": "likely", "found_by": "google_maps"}]
    phone, _, others = delivery.best_contacts({"organisation": {}, "phone_region": "IN", "contacts": contacts})
    assert phone["value"] == "+91 98290 55555" and others == []


def test_a_lead_on_a_front_desk_line_is_named_after_the_organisation_and_asks_for_the_decision_maker():
    # glcmumbai.com was delivered as "Dr. Asmita A. Vaidya" on the college's general landline.
    lead_json = {"organisation": {"name": "Government Law College, Mumbai", "website": "https://glcmumbai.com/"},
                 "decision_maker": {"name": "Dr. Asmita A. Vaidya", "role": "Principal"}, "phone_region": "IN",
                 "contacts": [_phone("+91 22 2204 1707", "general", "landline")]}
    row = delivery.build_row(_cand(lead_json))
    assert row["full_name"] == "Government Law College, Mumbai" and row["mobile"] == "+912222041707"
    assert row["custom_fields"]["la_role"] == ""
    assert row["custom_fields"]["la_ask_for"] == "Dr. Asmita A. Vaidya (Principal)"


def test_a_lead_is_named_after_a_person_only_when_the_contact_sent_is_theirs():
    founder = {"name": "Meena Iyer", "role": "Founder & Director"}
    counsellor = {"name": "Priya Sharma", "role": "Admission Counsellor"}
    base = {"organisation": {"name": "Alpha Academy", "domain": "alpha-academy.in"}, "phone_region": "IN",
            "decision_maker": founder}
    own = delivery.build_row(_cand({**base, "contacts": [_phone("+91 98450 12345", "direct", "mobile", person=founder)]}))
    assert own["full_name"] == "Meena Iyer" and own["custom_fields"]["la_role"] == "Founder & Director"
    desk = delivery.build_row(_cand({**base, "contacts": [_phone("+91 98450 12345", "general", "mobile", person=counsellor)]}))
    assert desk["full_name"] == "Priya Sharma" and desk["custom_fields"]["la_role"] == "Admission Counsellor"
    assert desk["custom_fields"]["la_ask_for"] == "Meena Iyer (Founder & Director)"
    # The founder's own Gmail beats the organisation's inbox: it reaches the person who buys. The phone
    # sent is the desk mobile, so the lead is named after the organisation and asks for her (until the
    # 2026-10-29 replay it was named after her while the call rang the desk).
    mixed = delivery.build_row(_cand({**base, "contacts": [
        _phone("+91 98450 12345", "likely", "mobile"),
        {"kind": "published_email", "value": "meenaiyer@gmail.com", "quality": "direct", "owner": "person",
         "person": founder},
        {"kind": "published_email", "value": "info@alpha-academy.in", "quality": "general", "owner": "own"}]}))
    assert mixed["email"] == "meenaiyer@gmail.com" and mixed["full_name"] == "Alpha Academy"
    assert mixed["custom_fields"]["la_role"] == "" and "info@alpha-academy.in (general)" in \
        mixed["custom_fields"]["la_other_contacts"]
    assert mixed["custom_fields"]["la_ask_for"] == "Meena Iyer (Founder & Director)"
    # With no phone, the lead is named after the owner of the email sent, and nobody else is asked for.
    email_only = delivery.build_row(_cand({**base, "contacts": [
        {"kind": "published_email", "value": "meenaiyer@gmail.com", "quality": "direct", "owner": "person",
         "person": founder}]}))
    assert email_only["full_name"] == "Meena Iyer" and email_only["custom_fields"]["la_ask_for"] == ""
    # Without her mailbox, the organisation's own inbox is sent and the lead is named after the organisation.
    inbox = delivery.build_row(_cand({**base, "contacts": [
        _phone("+91 98450 12345", "likely", "mobile"),
        {"kind": "published_email", "value": "rk1980@gmail.com", "quality": "likely", "owner": "free"},
        {"kind": "published_email", "value": "info@alpha-academy.in", "quality": "general", "owner": "own"}]}))
    assert inbox["email"] == "info@alpha-academy.in" and inbox["full_name"] == "Alpha Academy"
    assert inbox["custom_fields"]["la_role"] == ""


def test_a_national_brands_group_leader_is_not_who_to_ask_for():
    lead_json = {"organisation": {"name": "ALLEN Career Institute, Indore", "domain": "allen.ac.in"},
                 "decision_maker": {"name": "Rajesh Maheshwari", "role": "Director", "scope": "group"},
                 "phone_region": "IN", "contacts": [_phone("+91 731 400 1234", "general", "landline")]}
    row = delivery.build_row(_cand(lead_json))
    assert row["full_name"] == "ALLEN Career Institute, Indore" and row["custom_fields"]["la_ask_for"] == ""


# Naming follows the phone sent (2026-10-29 replay: 30 leads were named after the email's owner while
# the phone rang the desk, 9 of them asking for someone else: ymcacollege.ac.in, iitd.ac.in,
# tomarchemistrytutorial.com).

def test_a_desk_phone_names_the_organisation_and_asks_for_the_local_decision_maker():
    hod = {"name": "Prof. Nilanjan Senroy", "role": "Head of Department"}
    lead_json = {"organisation": {"name": "IIT Delhi", "domain": "iitd.ac.in"}, "phone_region": "IN",
                 "decision_maker": {"name": "Prof. Rangan Banerjee", "role": "Director"},
                 "contacts": [_phone("+91 11 2659 1999", "general", "landline"),
                              {"kind": "published_email", "value": "hod@ee.iitd.ac.in", "quality": "general",
                               "owner": "own", "person": hod}]}
    row = delivery.build_row(_cand(lead_json))
    assert row["full_name"] == "IIT Delhi" and row["custom_fields"]["la_role"] == ""
    assert row["custom_fields"]["la_ask_for"] == "Prof. Rangan Banerjee (Director)"


def test_with_no_local_decision_maker_a_desk_phone_asks_for_the_leader_whose_mailbox_is_sent():
    principal = {"name": "Dr. George Abraham", "role": "Principal"}
    base = {"organisation": {"name": "YMCA College", "domain": "ymcacollege.ac.in"}, "phone_region": "IN",
            "decision_maker": None}
    desk = [_phone("+91 93422 04126", "likely", "mobile")]
    leader = {"kind": "published_email", "value": "principal.george@ymcacollege.ac.in", "quality": "direct",
              "owner": "own", "person": principal}
    row = delivery.build_row(_cand({**base, "contacts": desk + [leader]}))
    assert row["full_name"] == "YMCA College" and row["custom_fields"]["la_ask_for"] == "Dr. George Abraham (Principal)"
    # Not a leader (rated general): nobody to ask for.
    staff = {**leader, "quality": "general", "person": {"name": "Mr. M. Jeya Nesa Kumar", "role": "Office"}}
    assert delivery.build_row(_cand({**base, "contacts": desk + [staff]}))["custom_fields"]["la_ask_for"] == ""


@pytest.mark.parametrize("on_phone, decision_maker", [
    ("Mr. Anshudeep Tomar", "Anshudeep Tomar"),
    ("Anshudeep Singh Tomar", "Anshudeep Tomar"),
    ("MAJ ASHOK YADAV", "Major Ashok Yadav"),  # pathfinderglobalschool.com
])
def test_the_person_whose_phone_is_sent_is_not_asked_for_again_however_the_name_is_written(on_phone, decision_maker):
    lead_json = {"organisation": {"name": "Alpha Academy"}, "phone_region": "IN",
                 "decision_maker": {"name": decision_maker, "role": "Founder"},
                 "contacts": [_phone("+91 97138 07075", "direct", "mobile", person={"name": on_phone, "role": "Founder"})]}
    row = delivery.build_row(_cand(lead_json))
    assert row["full_name"] == on_phone and row["custom_fields"]["la_ask_for"] == ""
    other = {**lead_json, "decision_maker": {"name": "Meena Ashok Iyer", "role": "Director"}}
    assert delivery.build_row(_cand(other))["custom_fields"]["la_ask_for"] == "Meena Ashok Iyer (Director)"


def test_a_number_from_another_country_is_not_sent_as_the_mobile():
    # talentresourze.com was sent "USA: +1 (347) 353-1469" over its Indian mobile.
    contacts = [_phone("+1 347-353-1469", "general", "phone"), _phone("+91 90594 61732", "general", "mobile")]
    phone, _, _ = delivery.best_contacts({"organisation": {}, "phone_region": "IN", "contacts": contacts})
    assert phone["value"] == "+91 90594 61732"


def test_a_number_of_the_leads_own_country_is_sent_before_a_foreign_one_of_the_same_tier():
    # mygreatlearning.com was sent "+1 512-647-2647" over its Bengaluru landline, both "general" (2026-10-29 replay).
    contacts = [_phone("+1 512-647-2647", "general", "phone"), _phone("+91 80 6947 4555", "general", "landline")]
    phone, _, others = delivery.best_contacts({"organisation": {}, "phone_region": "IN", "contacts": contacts})
    assert phone["value"] == "+91 80 6947 4555" and [c["value"] for c in others] == ["+1 512-647-2647"]
