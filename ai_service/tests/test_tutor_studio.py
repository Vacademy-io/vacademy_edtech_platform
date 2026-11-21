"""Tutezy Studio (stall kiosk): access codes, limits, the notes parser, the
job life cycle and the kiosk's exemption from the one-lesson-per-visitor rule."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.services.tutor import studio

CFG = {"enabled": True, "kiosk_code": "stall-G60", "visitor_code": "hello", "daily_cap": 5, "visitor_per_ip": 2,
       "minutes": 5, "model": None, "event": "DIDAC India 2026"}


# ── access ───────────────────────────────────────────────────────────────────

def test_roles_by_code():
    assert studio.role_for("stall-G60", CFG) == "kiosk"
    assert studio.role_for(" hello ", CFG) == "visitor"
    assert studio.role_for("nope", CFG) is None and studio.role_for("", CFG) is None and studio.role_for(None, CFG) is None


def test_no_role_when_off_or_codes_blank():
    assert studio.role_for("stall-G60", {**CFG, "enabled": False}) is None
    assert studio.role_for("", {**CFG, "kiosk_code": "", "visitor_code": ""}) is None


class _Counts:
    """A db whose count(*) queries answer from a list, in call order."""
    def __init__(self, *answers):
        self.answers, self.sql = list(answers), []

    def execute(self, stmt, params=None):
        self.sql.append(str(stmt))
        return SimpleNamespace(scalar=lambda: self.answers.pop(0))


def test_create_limits():
    assert studio.create_allowed(_Counts(0, 0), role="kiosk", iph="h", c=CFG) is None
    assert "being built" in studio.create_allowed(_Counts(studio.MAX_CONCURRENT_JOBS), role="kiosk", iph="h", c=CFG)
    assert "Today's lessons" in studio.create_allowed(_Counts(0, 5), role="kiosk", iph="h", c=CFG)
    # The per-visitor limit applies to the visitor code only.
    assert studio.create_allowed(_Counts(0, 0, 1), role="visitor", iph="h", c=CFG) is None
    assert "free lessons for today" in studio.create_allowed(_Counts(0, 0, 2), role="visitor", iph="h", c=CFG)
    db = _Counts(0, 0)
    studio.create_allowed(db, role="kiosk", iph="h", c=CFG)
    assert len(db.sql) == 2


# ── notes ────────────────────────────────────────────────────────────────────

NOTES = """# Photosynthesis in four minutes
Emoji: 🌱
Audience: class 7. Goal: say what a leaf makes and from what.
## Leaves are kitchens
Plants make food in their leaves. Chlorophyll traps sunlight.
Check: Where does a plant make its food? (Expected: in the leaves)
## The recipe
Water and carbon dioxide become glucose and oxygen.
Check: Which gas goes in? (Expected: carbon dioxide)
## Why it matters
The oxygen we breathe comes from it.
Check: Which gas comes out? (Expected: oxygen)"""


def test_parse_notes_ok():
    out = studio.parse_notes(NOTES)
    assert out["title"] == "Photosynthesis in four minutes" and out["emoji"] == "🌱"
    assert out["source"].startswith("# Photosynthesis") and "Emoji:" not in out["source"] and "## The recipe" in out["source"]


@pytest.mark.parametrize("raw", ["REJECT: Let's pick a classroom topic instead.", "reject: no"])
def test_parse_notes_reject(raw):
    assert "reject" in studio.parse_notes(raw)


@pytest.mark.parametrize("raw", ["", "Sure! Here is a lesson about plants.", "# Title only\nno ideas"])
def test_parse_notes_unusable_is_a_polite_reject(raw):
    assert studio.parse_notes(raw)["reject"].startswith("We could not plan")


def test_notes_prompt_grounds_material_and_caps_it():
    topic = studio.notes_messages("topic", "x" * 1000)
    assert "asked to learn" in topic[1]["content"] and len(topic[1]["content"]) < 400
    pdf = studio.notes_messages("pdf", "y" * 50000)
    assert studio.GROUNDED_RULE in pdf[1]["content"] and "from a PDF" in pdf[1]["content"]
    assert pdf[1]["content"].count("y") == studio.MATERIAL_MAX_CHARS
    assert "REJECT:" in topic[0]["content"]


def test_phone_cleaning():
    assert studio.clean_phone("+91 99933-36616") == "+919993336616"
    assert studio.clean_phone("12") is None and studio.clean_phone(None) is None


# ── QR ───────────────────────────────────────────────────────────────────────

def test_qr_only_for_our_links():
    assert studio.qr_svg("https://learner.vacademy.io/try?topic=studio-abc").lstrip().startswith("<svg")
    assert studio.qr_svg("https://vacademy.io/didac/?src=tutezy-studio")
    assert studio.qr_svg("https://evil.example/x") is None
    assert studio.qr_svg("http://learner.vacademy.io/try") is None
    assert studio.qr_svg("https://learner.vacademy.io/" + "a" * 500) is None


# ── the job ──────────────────────────────────────────────────────────────────

def _run(monkeypatch, *, kind="topic", text_="Photosynthesis", notes=None, compiled=None, captions=None):
    updates, topics, warmed = [], [], []

    class _DB:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, stmt, params=None):
            return SimpleNamespace(first=lambda: (kind, text_, "kn"))

    monkeypatch.setattr(studio, "db_session", lambda: _DB())
    monkeypatch.setattr(studio, "config", lambda db=None: dict(CFG))
    monkeypatch.setattr(studio.demo, "config", lambda db=None: {"institute_id": "inst", "teacher_name": "Riya Maam"})
    monkeypatch.setattr(studio, "_update", lambda job_id, **cols: updates.append(cols))
    monkeypatch.setattr(studio.demo, "upsert_topic", lambda db, **kw: topics.append(kw))

    async def write(kind_, text__, **kw):
        return notes if notes is not None else studio.parse_notes(NOTES)
    monkeypatch.setattr(studio, "write_notes", write)

    async def compile_(key, lang, **kw):
        return (compiled or {"type": "PLAN_READY", "plan_id": "p1"}), SimpleNamespace(tts_provider="smallest")
    monkeypatch.setattr(studio, "_compile", compile_)
    monkeypatch.setattr(studio, "_warm_voice", lambda *a: warmed.append(a))
    if captions is not None:
        async def yt(url):
            if isinstance(captions, Exception):
                raise captions
            return captions
        monkeypatch.setattr(studio, "youtube_text", yt)
    asyncio.run(studio.run_job("job-1"))
    return updates, topics, warmed


def test_job_builds_an_unlisted_topic_in_the_asked_language(monkeypatch):
    updates, topics, warmed = _run(monkeypatch)
    assert [u["status"] for u in updates] == ["WRITING", "BUILDING", "READY"]
    t = topics[0]
    assert t["key"].startswith(studio.KEY_PREFIX) and t["language"] == "kn" and t["title"] == "Photosynthesis in four minutes"
    assert t["sort_order"] >= studio.demo.UNLISTED_SORT_ORDER          # never in the public picker
    assert updates[-1]["topic_key"] == t["key"] and updates[-1]["seconds"] >= 0
    assert warmed and warmed[0][0] == "p1" and warmed[0][2] == "kn"


def test_job_rejected_by_the_safety_check_builds_nothing(monkeypatch):
    updates, topics, warmed = _run(monkeypatch, notes={"reject": "Let's pick a classroom topic instead."})
    assert updates[-1] == {"status": "REJECTED", "error": "Let's pick a classroom topic instead."}
    assert not topics and not warmed


def test_job_compile_failure_is_a_plain_failure(monkeypatch):
    updates, topics, warmed = _run(monkeypatch, compiled={"type": "PLAN_ERROR", "error": "validation"})
    assert updates[-1]["status"] == "FAILED" and "try once more" in updates[-1]["error"]
    assert not warmed


def test_job_video_without_captions_says_so(monkeypatch):
    updates, topics, _ = _run(monkeypatch, kind="youtube", text_="https://youtu.be/x", captions=ValueError("This video has no captions."))
    assert updates[-1] == {"status": "REJECTED", "error": "This video has no captions."} and not topics


def test_job_thin_material_is_refused_before_any_model_call(monkeypatch):
    updates, topics, _ = _run(monkeypatch, kind="youtube", text_="https://youtu.be/x", captions="too short")
    assert updates[-1]["status"] == "REJECTED" and "not enough text" in updates[-1]["error"] and not topics


# ── endpoints ────────────────────────────────────────────────────────────────

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import db_dependency  # noqa: E402
from app.routers import tutor_studio  # noqa: E402


def _client(monkeypatch, cfg=None):
    monkeypatch.setattr(studio, "config", lambda db=None: dict(cfg or CFG))
    monkeypatch.setattr(studio, "stats", lambda db, **kw: {"made": 12, "avg_seconds": 41.0, "recent": []})
    app = FastAPI()
    app.include_router(tutor_studio.router)
    app.dependency_overrides[db_dependency] = lambda: _Counts(0, 0, 0)
    return TestClient(app)


def test_config_needs_a_code_and_only_the_kiosk_gets_the_visitor_link(monkeypatch):
    c = _client(monkeypatch)
    assert c.get("/tutor/v1/studio/config").status_code == 403
    assert c.get("/tutor/v1/studio/config", params={"code": "wrong"}).status_code == 403
    kiosk = c.get("/tutor/v1/studio/config", params={"code": "stall-G60"}).json()
    assert kiosk["role"] == "kiosk" and kiosk["visitor_link"].endswith("/studio?v=hello") and kiosk["made"] == 12
    visitor = c.get("/tutor/v1/studio/config", params={"code": "hello"}).json()
    assert visitor["role"] == "visitor" and visitor["visitor_link"] is None
    assert "kiosk_code" not in kiosk and "stall-G60" not in str(visitor)


def test_job_endpoint_queues_and_launches(monkeypatch):
    c = _client(monkeypatch)
    made, launched = [], []
    monkeypatch.setattr(studio, "create_job", lambda db, **kw: made.append(kw) or "job-9")
    monkeypatch.setattr(studio, "launch", lambda job_id: launched.append(job_id))
    r = c.post("/tutor/v1/studio/jobs", json={"code": "hello", "text": "Ohm's law", "name": "riya sharma", "language": "kn",
                                                 "phone": "+91 99933 36616"})
    assert r.status_code == 200 and r.json() == {"job_id": "job-9"} and launched == ["job-9"]
    assert made[0]["source"] == "visitor" and made[0]["visitor_name"] == "Riya" and made[0]["language"] == "kn"
    assert c.post("/tutor/v1/studio/jobs", json={"code": "bad", "text": "Ohm's law", "name": "R"}).status_code == 403
    assert c.post("/tutor/v1/studio/jobs", json={"code": "hello", "text": "x", "name": "R", "language": "fr"}).status_code == 422


def test_upload_refuses_non_pdf(monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/tutor/v1/studio/jobs/upload", data={"code": "hello", "name": "R"}, files={"file": ("a.pdf", b"not a pdf", "application/pdf")})
    assert r.status_code == 415


def test_qr_endpoint(monkeypatch):
    c = _client(monkeypatch)
    ok = c.get("/tutor/v1/studio/qr", params={"u": "https://tutezy.ai/#demo"})
    assert ok.status_code == 200 and ok.headers["content-type"].startswith("image/svg+xml")
    assert c.get("/tutor/v1/studio/qr", params={"u": "https://example.com"}).status_code == 400
