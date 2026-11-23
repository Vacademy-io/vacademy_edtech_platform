"""In-memory stand-ins for the demo guide's database, settings, catalogue host,
voice, sign-in and admin_core.

`install(monkeypatch)` swaps every repository function and db_session for an
in-memory store with the same semantics, so the engine, service and router run
end to end without Postgres or the network.
"""
from __future__ import annotations

import json
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.demo_guide import app_session as app_session_mod  # noqa: E402
from app.demo_guide import caps as caps_mod  # noqa: E402
from app.demo_guide import catalog as catalog_mod  # noqa: E402
from app.demo_guide import engine as engine_mod  # noqa: E402
from app.demo_guide import internal_client as ac  # noqa: E402
from app.demo_guide import knowledge as knowledge_mod  # noqa: E402
from app.demo_guide import repository as repo_mod  # noqa: E402
from app.demo_guide import service as service_mod  # noqa: E402
from app.demo_guide import settings as settings_mod  # noqa: E402
from app.demo_guide import speech as speech_mod  # noqa: E402
from app.demo_guide import tools as tools_mod  # noqa: E402
from app.demo_guide import usage as usage_mod  # noqa: E402

STAGE = "https://demo.vacademy.io"
LEAD_INST = "inst-vacademy"
APP_INST = "inst-demo"
AUDIENCE = "aud-demo-leads"
CATALOG_URL = "https://demo.vacademy.io/tours/vacademy.json"
KNOWLEDGE_URL = "https://demo.vacademy.io/knowledge/vacademy.md"
SECRET = "test-demo-guide-secret-0123456789"

PRODUCTS = {"vacademy": {"catalog_url": CATALOG_URL, "knowledge_url": KNOWLEDGE_URL, "audience_id": AUDIENCE,
                         "lead_institute_id": LEAD_INST, "app_institute_id": APP_INST, "stage_origins": [STAGE]}}

CATALOG = {
    "screens": [{"route": "/manage-institute/teams", "label": "Team and roles"},
                {"route": "https://evil.example/x", "label": "bad"}],
    "product": "vacademy",
    "copy": {"hello": {"en": "Hi"}},
    "audiences": [{"id": "academy", "label": {"en": "Coaching or online academy", "hi": "कोचिंग या ऑनलाइन अकादमी"}},
                  {"id": "school", "label": {"en": "School"}}],
    "topics": [{"id": "fees", "tour": "fee-collection", "label": {"en": "Collect fees"},
                "intro": {"en": "Here is the fee collection view."}}],
    "tours": [
        {"id": "fee-collection", "title": {"en": "Fee collection"}, "about": "Shows dues, reminders and receipts.",
         "audiences": ["academy", "school"],
         "steps": [
             {"go": "/fees", "spot": "[data-tour=secret-selector]",
              "say": {"en": "Every due fee is listed here.", "hi": "हर बकाया फ़ीस यहाँ दिखती है।"}},
             {"spot": {"sel": "button", "text": "Remind"}, "say": {"en": "One click sends a reminder."}},
             {"pause": 500},
         ]},
        {"id": "tests", "title": {"en": "Tests and exams"}, "about": "Shows how a test is created and tracked.",
         "audiences": [], "steps": [{"go": "/tests", "say": {"en": "Tests live here."}}]},
    ],
}

KNOWLEDGE = """# Vacademy facts

## Pricing
Vacademy is sold as a base platform fee plus usage. The team shares an exact quote after a short call.

## Languages
The learner app is available in English, Hindi and Kannada.

## Live classes
Live classes run inside the app. Recordings are saved automatically after the class ends.
"""


def now() -> datetime:
    return datetime.now(timezone.utc)


class FakeDB:
    def execute(self, *a, **k):
        raise RuntimeError("unexpected raw SQL in a unit test")

    def commit(self):
        pass

    def rollback(self):
        pass


class Store:
    def __init__(self):
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.msgs: List[Dict[str, Any]] = []
        self.writes: List[tuple] = []

    # sessions
    def create_session(self, db, *, product, lang, visitor_id, ip_hash, origin, page_url, utm, ip_cap):
        if sum(1 for s in self.sessions.values() if s["ip_hash"] == ip_hash) >= ip_cap:
            return None
        sid = str(uuid.uuid4())
        self.sessions[sid] = dict(id=sid, product=product, lang=lang, visitor_id=visitor_id, ip_hash=ip_hash,
                                  origin=origin, page_url=page_url, utm=utm, qualification=None, tours=None,
                                  lead_id=None, turns=0, speech_chars=0, listen_seconds=0,
                                  created_at=now().isoformat(), last_at=now().isoformat())
        return sid

    def get_session(self, db, sid):
        s = self.sessions.get(sid)
        return json.loads(json.dumps(s)) if s else None

    def set_lang(self, db, sid, lang):
        self.sessions[sid]["lang"] = lang

    def take_turn(self, db, sid, ip_hash, *, session_cap, ip_cap, daily_cap):
        s = self.sessions[sid]
        if s["turns"] >= session_cap:
            return None
        if sum(x["turns"] for x in self.sessions.values() if x["ip_hash"] == (ip_hash or "")) >= ip_cap:
            return None
        if sum(x["turns"] for x in self.sessions.values()) >= daily_cap:
            return None
        s["turns"] += 1
        return s["turns"]

    def give_turn_back(self, db, sid):
        self.sessions[sid]["turns"] = max(0, self.sessions[sid]["turns"] - 1)

    def add_tour(self, db, sid, tour_id):
        self.sessions[sid]["tours"] = (self.sessions[sid]["tours"] or []) + [{"id": tour_id, "finished": None}]

    def finish_tour(self, db, sid, tour_id, finished):
        tours = self.sessions[sid]["tours"] or []
        for t in reversed(tours):
            if t["id"] == tour_id and t["finished"] is None:
                t["finished"] = bool(finished)
                break
        else:
            tours.append({"id": tour_id, "finished": bool(finished)})
        self.sessions[sid]["tours"] = tours

    def merge_qualification(self, db, sid, fields):
        self.sessions[sid]["qualification"] = {**(self.sessions[sid]["qualification"] or {}), **fields}

    def add_speech_chars(self, db, sid, chars, cap):
        s = self.sessions[sid]
        if s["speech_chars"] + chars > cap:
            return False
        s["speech_chars"] += chars
        return True

    def add_listen_seconds(self, db, sid, seconds):
        self.sessions[sid]["listen_seconds"] += max(int(seconds), 0)

    def set_lead(self, db, sid, lead_id):
        self.sessions[sid]["lead_id"] = lead_id

    def leads_from_ip_today(self, db, ip_hash):
        return sum(1 for s in self.sessions.values() if s["ip_hash"] == ip_hash and s["lead_id"])

    # messages
    def add_message(self, db, sid, role, kind, text_, *, actions=None, message_id=None):
        mid = message_id or str(uuid.uuid4())
        self.msgs.append(dict(id=mid, session_id=sid, role=role, kind=kind, text=text_ or "",
                              actions=json.loads(json.dumps(actions)) if actions is not None else None,
                              created_at=now().isoformat()))
        self.writes.append(("add", mid, role))
        return mid

    def update_message(self, db, mid, text_, actions):
        m = next(m for m in self.msgs if m["id"] == mid)
        m["text"], m["actions"] = text_ or "", json.loads(json.dumps(actions))
        self.writes.append(("update", mid, len((actions or {}).get("sentences") or [])))

    def get_message(self, db, sid, mid):
        m = next((m for m in self.msgs if m["id"] == mid and m["session_id"] == sid), None)
        return json.loads(json.dumps(m)) if m else None

    def history(self, db, sid, limit=14):
        return [json.loads(json.dumps(m)) for m in self.msgs if m["session_id"] == sid][-limit:]

    def transcript(self, db, sid, limit=400):
        return [json.loads(json.dumps(m)) for m in self.msgs if m["session_id"] == sid][:limit]

    def forms_shown(self, db, sid):
        return sum(1 for m in self.msgs if m["session_id"] == sid and m["role"] == "assistant"
                   and "form" in (m["actions"] or {}))

    def list_sessions(self, db, products, *, page, size, lead=None):
        items = [dict(s, lead=bool(s["lead_id"])) for s in self.sessions.values()
                 if s["product"] in products and s["turns"] > 0
                 and (lead is None or bool(s["lead_id"]) == lead)]
        return {"items": items[page * size:(page + 1) * size], "page": page, "size": size, "total": len(items)}


REPO_FUNCS = [
    "create_session", "get_session", "set_lang", "take_turn", "give_turn_back", "add_tour", "finish_tour",
    "merge_qualification", "add_speech_chars", "add_listen_seconds", "set_lead", "leads_from_ip_today",
    "add_message", "update_message", "get_message", "history", "transcript", "forms_shown", "list_sessions",
]


class Fakes(SimpleNamespace):
    pass


def install(monkeypatch, *, enabled: bool = True, environment: str = "production") -> Fakes:
    store = Store()
    for name in REPO_FUNCS:
        monkeypatch.setattr(repo_mod, name, getattr(store, name))

    @contextmanager
    def fake_session():
        yield FakeDB()

    for mod in (engine_mod, service_mod, tools_mod):
        monkeypatch.setattr(mod, "db_session", fake_session)

    monkeypatch.setenv("DEMO_GUIDE_TOKEN_SECRET", SECRET)
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("DEMO_GUIDE_APP_USER", "demo_guide_user")
    monkeypatch.setenv("DEMO_GUIDE_APP_PASSWORD", "not-a-real-password")

    settings: Dict[str, Any] = {"demo_guide.enabled": enabled, "demo_guide.products": json.dumps(PRODUCTS)}
    monkeypatch.setattr(settings_mod, "_platform", lambda key, default, db=None: settings.get(key, default))

    files = {CATALOG_URL: json.dumps(CATALOG).encode(), KNOWLEDGE_URL: KNOWLEDGE.encode()}
    fetched: List[str] = []

    async def http_get(url, max_bytes):
        fetched.append(url)
        body = files.get(url)
        if body is None:
            raise RuntimeError("HTTP 404")
        return body

    catalog_mod.clear_cache()
    monkeypatch.setattr(catalog_mod, "_http_get", http_get)

    sign_ins: List[tuple] = []

    async def sign_in(user, password, institute_id):
        sign_ins.append((user, institute_id))
        return {"accessToken": f"access-{len(sign_ins)}", "refreshToken": f"refresh-{len(sign_ins)}"}

    app_session_mod.reset()
    monkeypatch.setattr(app_session_mod, "_sign_in", sign_in)

    spoken: List[tuple] = []

    async def tts(text, lang):
        spoken.append((text, lang))
        provider = speech_mod.voice_for(lang)[0]
        return (f"AUDIO[{lang}]{text}".encode(), "audio/mpeg" if provider == "edge" else "audio/wav", provider)

    speech_mod.reply_cache.clear()
    speech_mod.narration_cache.clear()
    caps_mod.reset_narration()
    monkeypatch.setattr(speech_mod, "tts", tts)

    help_calls: List[str] = []

    async def search_help(query, institute_id, top_k=3):
        help_calls.append(query)
        return []

    monkeypatch.setattr(knowledge_mod, "search_help", search_help)

    leads: List[Dict[str, Any]] = []

    async def submit_lead(body):
        leads.append(body)
        return {"status": "received", "lead_ref": f"lead-{len(leads)}"}

    monkeypatch.setattr(ac, "submit_lead", submit_lead)

    usage_rows: List[tuple] = []
    monkeypatch.setattr(usage_mod, "record_turn", lambda **kw: usage_rows.append(("turn", kw)))
    monkeypatch.setattr(usage_mod, "record_speech", lambda **kw: usage_rows.append(("speech", kw)))
    monkeypatch.setattr(usage_mod, "record_listen", lambda **kw: usage_rows.append(("listen", kw)))

    return Fakes(store=store, settings=settings, files=files, fetched=fetched, sign_ins=sign_ins, spoken=spoken,
                 help_calls=help_calls, leads=leads, usage=usage_rows, monkeypatch=monkeypatch)
