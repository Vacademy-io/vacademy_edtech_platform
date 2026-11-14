"""AI tools that spend credits report to the admin activity log through
admin_core's internal audit endpoint — the same snake_case body
assessment_service sends, with the actor read from the caller's JWT."""
import asyncio
import base64
import json

import pytest

from app.services import audit_client


class _Resp:
    status_code = 200
    text = ""


class _Client:
    sent = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _Client.sent.append((url, json, headers))
        return _Resp()


class _Req:
    def __init__(self, token):
        self.headers = {"authorization": f"Bearer {token}", "x-forwarded-for": "1.2.3.4, 10.0.0.1",
                        "user-agent": "pytest"}
        self.method = "POST"
        self.url = type("U", (), {"path": "/ai-service/ai/get-question-pdf/math-parser/start-process-pdf-file-id"})()
        self.client = None


def _jwt(payload):
    b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{b64({'alg': 'none'})}.{b64(payload)}.sig"


def test_record_posts_the_activity_log_contract(monkeypatch):
    monkeypatch.setattr(audit_client, "httpx", type("H", (), {"AsyncClient": _Client}))

    async def fake_headers(extra=None):
        return {"clientName": "admin_core_service", "Signature": "s", **(extra or {})}

    monkeypatch.setattr(audit_client, "internal_auth_headers", fake_headers)
    monkeypatch.setattr(audit_client, "decode_access_token",
                        lambda t: {"user": "u-1", "fullname": "Neeraj H", "email": "n@x.com", "sub": "neeraj"})
    _Client.sent.clear()
    asyncio.run(audit_client.record(
        institute_id="inst-1", entity_type="AI_QUESTION_EXTRACTION", entity_id="local-abc", action="UPLOAD",
        description="Uploaded 'mock.pdf'", request=_Req(_jwt({"user": "u-1"})),
        payload={"pages": 12, "question_count": 40, "estimated_credits": 3.0},
    ))
    assert len(_Client.sent) == 1
    url, body, headers = _Client.sent[0]
    assert url.endswith("/admin-core-service/internal/audit/v1/record")
    assert headers["clientName"] == "admin_core_service" and headers["Content-Type"] == "application/json"
    assert body["institute_id"] == "inst-1"
    assert body["actor_id"] == "u-1" and body["actor_name"] == "Neeraj H" and body["actor_email"] == "n@x.com"
    assert body["entity_type"] == "AI_QUESTION_EXTRACTION" and body["action"] == "UPLOAD"
    assert body["ip_address"] == "1.2.3.4" and body["user_agent"] == "pytest" and body["http_method"] == "POST"
    assert body["request_payload"]["question_count"] == 40 and body["response_status"] == 200


def test_record_without_institute_is_a_no_op(monkeypatch):
    monkeypatch.setattr(audit_client, "httpx", type("H", (), {"AsyncClient": _Client}))
    _Client.sent.clear()
    asyncio.run(audit_client.record(institute_id=None, entity_type="X", entity_id="1", action="A", description="d"))
    assert _Client.sent == []


def test_record_never_raises(monkeypatch):
    class Boom(_Client):
        async def post(self, *a, **k):
            raise RuntimeError("down")

    monkeypatch.setattr(audit_client, "httpx", type("H", (), {"AsyncClient": Boom}))

    async def fake_headers(extra=None):
        return {}

    monkeypatch.setattr(audit_client, "internal_auth_headers", fake_headers)
    asyncio.run(audit_client.record(institute_id="i", entity_type="X", entity_id="1", action="A", description="d"))


def test_question_count_from_html():
    from app.services.pdf_local_convert import question_count_of_html

    html = "".join(f"<p>{n}. Q?</p><p>(a) x (b) y</p>" for n in range(1, 13)) + "<p>ANSWER KEY</p><p>1. a 2. b 3. c 4. d 5. a 6. b 7. c 8. d</p>"
    assert question_count_of_html(html) == 12
