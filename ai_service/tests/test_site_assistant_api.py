"""Site Assistant HTTP API: session paths (hosted / embed / preview), token
ownership, SSE over HTTP, contact → leads call shape, feedback, history and
the staff endpoints. admin_core and the model are faked."""
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from site_assistant_fakes import HOST, INST, OTHER_INST, TAG, ScriptedLLM, install, tokens, tool_call  # noqa: E402

from app.site_assistant import engine  # noqa: E402
from app.site_assistant import service as svc  # noqa: E402
from app.site_assistant import tokens as T  # noqa: E402
from app.site_assistant.router import router  # noqa: E402

BASE = "/ai-service/site-assistant/v1"
EMBED_KEY = "vak_pub_" + "a" * 48
PAGE = {"url": f"https://{HOST}/{TAG}?utm_source=google&utm_campaign=diwali", "route": "/", "title": "Home"}


@pytest.fixture
def api(monkeypatch):
    f = install(monkeypatch)
    app = FastAPI()
    app.include_router(router, prefix="/ai-service")
    f.client = TestClient(app)
    f.monkeypatch = monkeypatch

    async def staff(request):
        auth = request.headers.get("authorization") or ""
        cid = request.headers.get("clientId")
        if auth == "Bearer staff-admin" and cid == INST:
            return svc.Staff(user_id="admin-1", institute_id=INST, roles=frozenset({"ADMIN"}))
        if auth == "Bearer staff-teacher" and cid == INST:
            return svc.Staff(user_id="teacher-1", institute_id=INST, roles=frozenset({"TEACHER"}))
        raise HTTPException(status_code=403, detail="not staff")

    monkeypatch.setattr(svc, "staff_from_request", staff)
    return f


def open_hosted(api, **body):
    payload = {"site_tag": TAG, "page": PAGE, "visitor_id": "v_visitor0001", **body}
    return api.client.post(f"{BASE}/sessions", json=payload, headers={"Origin": f"https://{HOST}"})


def sse_events(resp):
    out = []
    for block in resp.text.strip().split("\n\n"):
        if block.startswith(":"):
            continue          # a keep-alive comment
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def ask(api, session, text, cmid="m1", llm=None, token=None):
    if llm is not None:
        api.monkeypatch.setattr(engine, "llm_stream", llm)
    return api.client.post(f"{BASE}/sessions/{session['session_id']}/messages",
                           json={"text": text, "page": PAGE, "client_msg_id": cmid},
                           headers={"Authorization": f"Bearer {token or session['token']}"})


# ── hosted ───────────────────────────────────────────────────────────────

def test_hosted_session_resolves_the_site_from_the_origin(api):
    r = open_hosted(api, institute_id=OTHER_INST)        # a body institute id is ignored
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {"session_id", "token", "expires_at", "assistant", "history"}
    assert body["assistant"]["name"] == "Ask Brahm Varchas"
    assert body["assistant"]["suggestions"] == ["Courses for parents", "Any free class?"]
    conv = api.store.convs[body["session_id"]]
    assert conv["institute_id"] == INST and conv["channel"] == "HOSTED" and conv["site_tag"] == TAG
    assert conv["utm"] == {"utm_source": "google", "utm_campaign": "diwali"}
    claims = T.verify(body["token"])
    assert (claims.sid, claims.iid, claims.tag, claims.ch) == (body["session_id"], INST, TAG, "HOSTED")


def test_hosted_unknown_host_or_wrong_tag_refused(api):
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG}, headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": "someone-elses"}, headers={"Origin": f"https://{HOST}"})
    assert r.status_code == 403
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG})         # no Origin / Referer
    assert r.status_code == 403


def test_hosted_disabled_site_refused(api):
    api.admin_core.catalogues[(INST, TAG)]["globalSettings"]["siteAssistant"]["enabled"] = False
    assert open_hosted(api).status_code == 403


def test_logged_in_learner_is_recognised_only_for_this_institute(api, monkeypatch):
    from app.core import security
    monkeypatch.setattr(security, "decode_access_token",
                        lambda tok: {"user": "learner-1", "authorities": {INST: {"roles": ["STUDENT"]}}}
                        if tok == "learner-jwt" else {"user": "x", "authorities": {OTHER_INST: {}}})
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG},
                        headers={"Origin": f"https://{HOST}", "Authorization": "Bearer learner-jwt"})
    assert api.store.convs[r.json()["session_id"]]["user_id"] == "learner-1"
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG},
                        headers={"Origin": f"https://{HOST}", "Authorization": "Bearer other-jwt"})
    assert api.store.convs[r.json()["session_id"]]["user_id"] is None


def test_resume_same_visitor_within_ttl(api):
    first = open_hosted(api).json()
    api.store.add_message(None, first["session_id"], "user", "hello", page={"client_msg_id": "x"})
    again = open_hosted(api, resume_session_id=first["session_id"]).json()
    assert again["session_id"] == first["session_id"]
    assert [h["content"] for h in again["history"]] == ["hello"]
    other = open_hosted(api, resume_session_id=first["session_id"], visitor_id="v_someoneelse").json()
    assert other["session_id"] != first["session_id"]


def test_new_chats_are_capped_per_network_but_resumes_and_previews_are_not(api):
    api.monkeypatch.setattr(svc.S, "ip_daily_sessions", lambda db=None: 2)
    first = open_hosted(api)
    assert first.status_code == 200
    assert open_hosted(api, visitor_id="v_visitor0002").status_code == 200
    third = open_hosted(api, visitor_id="v_visitor0003")
    assert third.status_code == 429 and third.json()["detail"]["code"] == "rate_limited"
    assert len(api.store.convs) == 2
    # Resuming an existing chat creates no row, so it is not counted.
    again = open_hosted(api, resume_session_id=first.json()["session_id"])
    assert again.status_code == 200 and again.json()["session_id"] == first.json()["session_id"]
    # Another network has its own allowance (Cloudflare's visitor address, not the edge's).
    other = open_hosted(api, visitor_id="v_visitor0004")
    assert other.status_code == 429
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "visitor_id": "v_visitor0005"},
                        headers={"Origin": f"https://{HOST}", "CF-Connecting-IP": "203.0.113.50"})
    assert r.status_code == 200
    s_keys = [k for k in api.store.visitor_daily if k.startswith("s:")]
    assert len(s_keys) == 2
    # Staff previews are never counted.
    for _ in range(3):
        p = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "preview": True},
                            headers={"Authorization": "Bearer staff-admin", "clientId": INST})
        assert p.status_code == 200


def test_client_ip_is_cloudflares_visitor_address_not_the_edge():
    class Req:
        headers = {"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "172.70.1.1, 10.0.0.1"}
        client = None
    assert svc.client_ip(Req()) == "203.0.113.7"
    Req.headers = {"x-forwarded-for": "198.51.100.4, 172.70.1.1"}
    assert svc.client_ip(Req()) == "198.51.100.4"


# ── embed ────────────────────────────────────────────────────────────────

def embed(api, key=EMBED_KEY, origin="https://www.brahmvarchas.org"):
    headers = {"X-API-Key": key}
    if origin:
        headers["Origin"] = origin
    return api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "page": {"url": origin or ""}}, headers=headers)


def test_embed_key_and_verified_origin(api):
    r = embed(api)
    assert r.status_code == 200, r.text
    assert api.store.convs[r.json()["session_id"]]["channel"] == "EMBED"
    assert ("origin_allowed", INST, "www.brahmvarchas.org") in api.admin_core.calls


def test_embed_rejections(api):
    assert embed(api, key="vak_pub_" + "b" * 48).status_code == 401
    assert embed(api, origin="https://copycat.example.com").status_code == 403
    assert embed(api, origin=None).status_code == 403
    api.admin_core.catalogues[(INST, TAG)]["globalSettings"]["siteAssistant"]["embed"]["enabled"] = False
    assert embed(api).status_code == 403


# ── preview ──────────────────────────────────────────────────────────────

def test_preview_with_staff_jwt_works_even_when_disabled(api):
    api.admin_core.catalogues[(INST, TAG)]["globalSettings"]["siteAssistant"]["enabled"] = False
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "page": {"url": f"/{TAG}", "route": "/",
                                                                          "title": "Admin preview"}},
                        headers={"Authorization": "Bearer staff-teacher", "clientId": INST,
                                 "Origin": "https://dash.vacademy.io"})
    assert r.status_code == 200, r.text
    conv = api.store.convs[r.json()["session_id"]]
    assert conv["channel"] == "PREVIEW" and conv["institute_id"] == INST and conv["user_id"] == "teacher-1"
    resp = ask(api, r.json(), "hi", llm=ScriptedLLM([tokens("Hello from preview.")]))
    events = sse_events(resp)
    assert events[-1][0] == "done" and events[-1][1]["billed"] is True and "tools" in events[-1][1]


def test_staff_browsing_the_live_site_is_a_hosted_visitor(api):
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG},
                        headers={"Authorization": "Bearer staff-admin", "clientId": INST, "Origin": f"https://{HOST}"})
    assert api.store.convs[r.json()["session_id"]]["channel"] == "HOSTED"


def test_preview_flag_wins_over_a_hosted_origin(api):
    # The admin app sends preview: true, so an admin domain that also serves the site gets a preview.
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "preview": True},
                        headers={"Authorization": "Bearer staff-admin", "clientId": INST, "Origin": f"https://{HOST}"})
    assert r.status_code == 200 and api.store.convs[r.json()["session_id"]]["channel"] == "PREVIEW"


def test_preview_needs_staff_of_that_institute(api):
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "preview": True},
                        headers={"Authorization": "Bearer learner", "clientId": INST})
    assert r.status_code == 403
    r = api.client.post(f"{BASE}/sessions", json={"site_tag": TAG, "preview": True},
                        headers={"Authorization": "Bearer staff-admin", "clientId": OTHER_INST})
    assert r.status_code == 403


# ── token ownership ──────────────────────────────────────────────────────

def test_messages_need_the_sessions_own_token(api):
    a = open_hosted(api).json()
    b = open_hosted(api, visitor_id="v_otherperson").json()
    llm = ScriptedLLM([tokens("x")])
    assert ask(api, a, "hi", token="garbage", llm=llm).status_code == 401
    assert ask(api, a, "hi", token=b["token"], llm=llm).status_code == 403
    assert api.client.get(f"{BASE}/sessions/{a['session_id']}").status_code == 401
    assert api.client.get(f"{BASE}/sessions/{a['session_id']}",
                          headers={"Authorization": f"Bearer {b['token']}"}).status_code == 403
    # a forged token with the right sid but another institute
    forged = T.mint(sid=a["session_id"], iid=OTHER_INST, tag=TAG, vid="v_visitor0001", ch="HOSTED")["token"]
    assert ask(api, a, "hi", token=forged, llm=llm).status_code == 403
    assert not llm.calls


def test_platform_jwt_is_not_a_session_token(api):
    from jose import jwt
    a = open_hosted(api).json()
    fake = jwt.encode({"sid": a["session_id"], "iid": INST, "tag": TAG, "vid": "v_visitor0001", "ch": "HOSTED",
                       "exp": 9999999999, "aud": "site-assistant"}, "some-other-secret", algorithm="HS256")
    assert ask(api, a, "hi", token=fake, llm=ScriptedLLM([])).status_code == 401


# ── SSE over HTTP ────────────────────────────────────────────────────────

def test_sse_order_over_http(api):
    s = open_hosted(api).json()
    llm = ScriptedLLM([[tool_call("search_courses", {"q": "parenting"})],
                       tokens("Vedic Parenting is ₹4,999 and taught live.")])
    resp = ask(api, s, "Courses for parents?", llm=llm)
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
    events = sse_events(resp)
    kinds = [e[0] for e in events]
    assert kinds[0] == "token" and kinds[-1] == "done" and "card" in kinds
    assert kinds.index("card") > max(i for i, k in enumerate(kinds) if k == "token")
    card = next(d for k, d in events if k == "card")
    assert card["type"] == "course_list" and card["items"][0]["title"] == "Vedic Parenting"


def test_sse_keepalive_pings_while_waiting_and_the_deadline_ends_with_internal():
    import asyncio
    from app.site_assistant import router as R

    async def slow():
        await asyncio.sleep(0.25)
        yield R.sse("token", {"text": "Hi"})
        await asyncio.sleep(5)
        yield R.sse("done", {})

    async def go():
        return [f async for f in R.with_keepalive(slow(), ping_seconds=0.1, deadline_seconds=0.6)]

    frames = asyncio.run(go())
    assert frames[0] == R.PING == ": ping\n\n"
    assert frames.index(R.sse("token", {"text": "Hi"})) >= 2
    assert frames[-1] == R.sse("error", {"code": "internal", "message": engine.MESSAGES["internal"]})
    assert R.sse("done", {}) not in frames


# ── contact → leads ──────────────────────────────────────────────────────

def test_contact_sends_the_lead_with_context(api):
    s = open_hosted(api).json()
    ask(api, s, "Courses for parents?", llm=ScriptedLLM([[tool_call("search_courses", {"q": "parenting"})],
                                                         tokens("We have Vedic Parenting.")]))
    r = api.client.post(f"{BASE}/sessions/{s['session_id']}/contact",
                        json={"kind": "SALES", "full_name": "Asha Rao", "phone": "+91 98765 43210", "consent": True,
                              "fields": {"child_age": "4-7"}, "institute_id": OTHER_INST},
                        headers={"Authorization": f"Bearer {s['token']}"})
    assert r.status_code == 200 and r.json() == {"status": "received"}
    lead = api.admin_core.leads[0]
    assert set(lead) == {"institute_id", "kind", "campaign_id", "full_name", "email", "phone", "course_ids",
                         "page_url", "utm", "summary", "reason", "custom_fields"}
    assert lead["institute_id"] == INST and lead["kind"] == "SALES" and lead["email"] is None
    assert lead["phone"] == "+919876543210"
    assert lead["campaign_id"] == "camp-p"           # parenting stream campaign (course c1)
    assert "c1" in lead["course_ids"]
    assert lead["utm"] == {"utm_source": "google", "utm_campaign": "diwali"}
    assert lead["custom_fields"] == {"child_age": "4-7", "conversation_id": s["session_id"]}
    assert lead["summary"].count("\n") == 2 and "Vedic Parenting" in lead["summary"]
    assert api.store.convs[s["session_id"]]["lead_status"] == "SALES"
    again = api.client.post(f"{BASE}/sessions/{s['session_id']}/contact",
                            json={"kind": "SALES", "full_name": "Asha", "phone": "9876543210", "consent": True},
                            headers={"Authorization": f"Bearer {s['token']}"})
    assert again.json() == {"status": "duplicate"} and len(api.admin_core.leads) == 1


# admin_core's CustomFieldKeyGenerator suffix with a real (UUID) institute id.
BV_INST_KEY = "_inst_8a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d"


def bv_campaign(api):
    """A Brahm-Varchas-style campaign: admin_core's field keys end in "_inst_<instituteId>"."""
    api.admin_core.campaigns[(INST, "camp-bv")] = {"id": "camp-bv", "institute_id": INST, "institute_custom_fields": [
        {"status": "ACTIVE", "individual_order": 1, "field_id": "cf-name", "custom_field": {
            "id": "cf-name", "fieldKey": "full_name" + BV_INST_KEY, "fieldName": "Full Name", "fieldType": "text",
            "isMandatory": True}},
        {"status": "ACTIVE", "individual_order": 2, "custom_field": {
            "id": "cf-phone", "fieldKey": "phone_number" + BV_INST_KEY, "fieldName": "Phone Number",
            "fieldType": "phone"}},
        {"status": "ACTIVE", "individual_order": 3, "custom_field": {
            "id": "cf-course", "fieldKey": "which_course_are_you_interested_in" + BV_INST_KEY,
            "fieldName": "Which course are you interested in?", "fieldType": "dropdown",
            "config": '{"coommaSepartedOptions":"Vedic Parenting,Garbh Sanskar"}'}},
        {"status": "ACTIVE", "individual_order": 4, "custom_field": {
            "id": "cf-city", "fieldKey": "city" + BV_INST_KEY + "_1", "fieldName": "City", "fieldType": "text"}},
    ]}
    api.admin_core.catalogues[(INST, TAG)]["globalSettings"]["siteAssistant"].setdefault("leads", {})["campaignId"] = "camp-bv"


def test_campaign_form_with_long_institute_keys_reaches_the_lead_by_field_id(api):
    bv_campaign(api)
    raw = [f["custom_field"]["fieldKey"] for f in api.admin_core.campaigns[(INST, "camp-bv")]["institute_custom_fields"]]
    assert max(len(k) for k in raw) > 64                    # what the widget and the lead API refuse
    s = open_hosted(api).json()
    events = sse_events(ask(api, s, "Can someone call me?", llm=ScriptedLLM([
        [tool_call("offer_contact", {"kind": "SALES", "reason": "so our counsellor can call you"})],
        tokens("Sure, leave your details below.")])))
    card = next(d for k, d in events if k == "card" and d["type"] == "contact_form")
    assert card["campaign_id"] == "camp-bv"
    keys = [f["key"] for f in card["fields"]]
    assert keys == ["full_name", "phone_number", "which_course_are_you_interested_in", "city"]
    assert all(len(k) <= 64 and "_inst_" not in k for k in keys)
    assert not any(k in ("cf-name", "cf-course") for k in json.dumps(card))       # ids stay on the server

    # What the widget sends: name/phone pulled out, the rest under the card's keys.
    r = api.client.post(f"{BASE}/sessions/{s['session_id']}/contact",
                        json={"kind": "SALES", "full_name": "Asha Rao", "phone": "+91 98765 43210", "consent": True,
                              "fields": {"which_course_are_you_interested_in": "Garbh Sanskar", "city": "Pune",
                                         "email": "smuggled@x.co", "a" * 70: "too long"}},
                        headers={"Authorization": f"Bearer {s['token']}"})
    assert r.status_code == 200, r.text
    lead = api.admin_core.leads[-1]
    assert lead["campaign_id"] == "camp-bv"
    assert lead["custom_fields"] == {"cf-course": "Garbh Sanskar", "cf-city": "Pune", "cf-name": "Asha Rao",
                                     "cf-phone": "+919876543210", "conversation_id": s["session_id"]}
    assert all(len(k) <= 64 for k in lead["custom_fields"])


def test_support_contact_and_validation(api):
    s = open_hosted(api).json()
    h = {"Authorization": f"Bearer {s['token']}"}
    url = f"{BASE}/sessions/{s['session_id']}/contact"
    assert api.client.post(url, json={"kind": "SALES", "full_name": "A", "phone": "123", "consent": True},
                           headers=h).status_code == 400
    assert api.client.post(url, json={"kind": "SALES", "full_name": "A", "consent": True}, headers=h).status_code == 400
    assert api.client.post(url, json={"kind": "SALES", "full_name": "A", "email": "a@b.co"}, headers=h).status_code == 400
    r = api.client.post(url, json={"kind": "SUPPORT", "full_name": "A", "email": "A@B.co", "consent": True}, headers=h)
    assert r.status_code == 200
    lead = api.admin_core.leads[-1]
    assert lead["kind"] == "SUPPORT" and lead["campaign_id"] is None and lead["email"] == "a@b.co"


def test_lead_spam_brake_per_network(api):
    sent = 0
    for i in range(7):
        s = open_hosted(api, visitor_id=f"v_spammer{i:04d}").json()
        r = api.client.post(f"{BASE}/sessions/{s['session_id']}/contact",
                            json={"kind": "SALES", "full_name": "Bot", "phone": "9876543210", "consent": True},
                            headers={"Authorization": f"Bearer {s['token']}"})
        sent += r.status_code == 200
    assert sent == svc.LEADS_PER_IP_PER_DAY and len(api.admin_core.leads) == svc.LEADS_PER_IP_PER_DAY


# ── feedback / history ───────────────────────────────────────────────────

def test_feedback_and_history(api):
    s = open_hosted(api).json()
    events = sse_events(ask(api, s, "hi", llm=ScriptedLLM([tokens("Namaste!")])))
    mid = events[-1][1]["message_id"]
    h = {"Authorization": f"Bearer {s['token']}"}
    assert api.client.post(f"{BASE}/sessions/{s['session_id']}/feedback", json={"message_id": mid, "rating": -1},
                           headers=h).json() == {"status": "ok"}
    assert api.client.post(f"{BASE}/sessions/{s['session_id']}/feedback", json={"message_id": mid, "rating": 5},
                           headers=h).status_code == 400
    hist = api.client.get(f"{BASE}/sessions/{s['session_id']}", headers=h).json()["history"]
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[1]["feedback"] == -1
    assert "page" not in hist[0]          # client_msg_id stays server-side


# ── staff API ────────────────────────────────────────────────────────────

ADMIN = {"Authorization": "Bearer staff-admin", "clientId": INST}
TEACHER = {"Authorization": "Bearer staff-teacher", "clientId": INST}


def test_knowledge_crud_admin_only_and_shared_items(api):
    r = api.client.post(f"{BASE}/admin/knowledge", json={"site_tag": None, "kind": "FAQ", "title": "Refunds?",
                                                         "body": "Within 7 days.", "active": True}, headers=ADMIN)
    assert r.status_code == 200, r.text
    shared = r.json()["item"]
    assert shared["institute_id"] == INST and r.json()["embedded"] is True
    api.client.post(f"{BASE}/admin/knowledge", json={"site_tag": TAG, "kind": "NOTICE", "title": "Diwali break",
                                                     "body": "Closed 1-5 Nov", "starts_at": "2026-10-25T00:00:00Z",
                                                     "ends_at": "2026-11-06T00:00:00Z"}, headers=ADMIN)
    items = api.client.get(f"{BASE}/admin/knowledge?site_tag={TAG}", headers=TEACHER).json()["items"]
    assert {i["title"] for i in items} == {"Refunds?", "Diwali break"}
    assert api.client.post(f"{BASE}/admin/knowledge", json={"kind": "FAQ", "title": "x", "body": "y"},
                           headers=TEACHER).status_code == 403
    assert api.client.post(f"{BASE}/admin/knowledge", json={"kind": "BLOG", "title": "x", "body": "y"},
                           headers=ADMIN).status_code == 400
    assert api.client.post(f"{BASE}/admin/knowledge", json={"kind": "FAQ", "title": "x", "body": "y",
                                                            "site_tag": "not-a-site"}, headers=ADMIN).status_code == 404
    up = api.client.put(f"{BASE}/admin/knowledge/{shared['id']}", json={"body": "Within 10 days."}, headers=ADMIN)
    assert up.json()["item"]["body"] == "Within 10 days."
    assert api.client.delete(f"{BASE}/admin/knowledge/{shared['id']}", headers=ADMIN).json() == {"status": "deleted"}
    assert api.client.delete(f"{BASE}/admin/knowledge/{shared['id']}", headers=ADMIN).status_code == 404
    assert api.client.get(f"{BASE}/admin/knowledge", headers={"Authorization": "Bearer x"}).status_code == 403


def test_other_institutes_rows_are_invisible(api):
    kid = api.store.create_knowledge(None, OTHER_INST, site_tag=None, kind="FAQ", title="theirs", body="b",
                                     active=True, starts_at=None, ends_at=None, created_by="u")
    assert api.client.put(f"{BASE}/admin/knowledge/{kid}", json={"body": "mine now"}, headers=ADMIN).status_code == 404
    cid = api.store.create_conversation(None, institute_id=OTHER_INST, site_tag="x", channel="HOSTED", visitor_id="v",
                                        user_id=None, ip_hash=None, origin_host=None, started_page=None, utm=None,
                                        locale=None)
    assert api.client.get(f"{BASE}/admin/conversations/{cid}", headers=ADMIN).status_code == 404


def test_conversations_list_hides_chats_nobody_typed_into(api):
    talked = open_hosted(api).json()
    ask(api, talked, "hi", llm=ScriptedLLM([tokens("Namaste!")]))
    open_hosted(api, visitor_id="v_visitor0002")             # opened, never used
    lst = api.client.get(f"{BASE}/admin/conversations?site_tag={TAG}", headers=TEACHER).json()
    assert lst["total"] == 1 and lst["items"][0]["id"] == talked["session_id"]
    every = api.client.get(f"{BASE}/admin/conversations?site_tag={TAG}&include_empty=true", headers=TEACHER).json()
    assert every["total"] == 2


def test_conversations_unanswered_status_reindex_shapes(api):
    s = open_hosted(api).json()
    ask(api, s, "Do you have hostel?", llm=ScriptedLLM([tokens("I don't have that detail. [[unanswered]]")]))
    ask(api, s, "Hostel facilities do you have?", cmid="m2",
        llm=ScriptedLLM([tokens("I don't have that detail. [[unanswered]]")]))
    lst = api.client.get(f"{BASE}/admin/conversations?site_tag={TAG}&page=0&size=10", headers=TEACHER).json()
    assert lst["total"] == 1 and lst["total_pages"] == 1
    assert {"id", "created_at", "last_active_at", "started_page", "message_count", "lead_status", "channel"} <= set(lst["items"][0])
    detail = api.client.get(f"{BASE}/admin/conversations/{s['session_id']}", headers=TEACHER).json()
    assert detail["id"] == s["session_id"] and "ip_hash" not in detail and "visitor_id" not in detail
    assert {"id", "role", "content", "cards", "answered", "feedback", "created_at"} <= set(detail["messages"][1])
    un = api.client.get(f"{BASE}/admin/unanswered?site_tag={TAG}&days=30", headers=TEACHER).json()
    assert len(un) == 1 and un[0]["count"] == 2 and set(un[0]) >= {"question", "count", "last_asked_at", "examples"}
    st = api.client.get(f"{BASE}/admin/status?site_tag={TAG}", headers=TEACHER).json()
    assert st["enabled"] is True and st["today"] == {"answers": 2, "cap": 300}
    assert set(st["index"]) >= {"status", "chunks", "updated_at", "error"}
    assert st["credits"] == {"low": False, "warning": None, "balance": 100}

    async def fake_index(iid, tag, catalogue, force=False):
        assert iid == INST and force
        return {"status": "READY", "chunks": 3}
    api.monkeypatch.setattr(svc.K, "index_site", fake_index)
    assert api.client.post(f"{BASE}/admin/reindex?site_tag={TAG}", headers=TEACHER).status_code == 403
    assert api.client.post(f"{BASE}/admin/reindex?site_tag={TAG}", headers=ADMIN).json() == {"status": "READY", "chunks": 3}
