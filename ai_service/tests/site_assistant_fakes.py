"""In-memory stand-ins for the Site Assistant's database and admin_core.

`install(monkeypatch)` swaps every repository function, the cap counters and
db_session for an in-memory store with the same semantics, so the engine,
service and router run end to end without Postgres. The real SQL is covered
by tests/test_site_assistant_pg.py against a live Postgres when one is given.
"""
from __future__ import annotations

import itertools
import json
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.site_assistant import admin as admin_mod  # noqa: E402
from app.site_assistant import billing as billing_mod  # noqa: E402
from app.site_assistant import caps as caps_mod  # noqa: E402
from app.site_assistant import engine as engine_mod  # noqa: E402
from app.site_assistant import internal_client as ac  # noqa: E402
from app.site_assistant import knowledge as knowledge_mod  # noqa: E402
from app.site_assistant import repository as repo_mod  # noqa: E402
from app.site_assistant import service as service_mod  # noqa: E402
from app.site_assistant import settings as settings_mod  # noqa: E402

INST = "inst-bv"
OTHER_INST = "inst-other"
TAG = "bv"
HOST = "learning.brahmvarchas.org"


def now() -> datetime:
    return datetime.now(timezone.utc)


class FakeDB:
    """What a db_session yields. Raw SQL outside the repository is not expected."""

    def execute(self, *a, **k):
        raise RuntimeError("unexpected raw SQL in a unit test")

    def commit(self):
        pass

    def rollback(self):
        pass


class Store:
    def __init__(self):
        self.convs: Dict[str, Dict[str, Any]] = {}
        self.msgs: List[Dict[str, Any]] = []
        self.knowledge: Dict[str, Dict[str, Any]] = {}
        self.index: Dict[tuple, Dict[str, Any]] = {}
        self.chunks: Dict[tuple, List[Dict[str, Any]]] = {}
        self.visitor_daily: Dict[str, int] = {}
        self.site_daily: Dict[tuple, int] = {}
        self._ids = itertools.count(1)

    # conversations
    def create_conversation(self, db, *, institute_id, site_tag, channel, visitor_id, user_id, ip_hash,
                            origin_host, started_page, utm, locale):
        cid = str(uuid.uuid4())
        self.convs[cid] = dict(id=cid, institute_id=institute_id, site_tag=site_tag, channel=channel,
                               visitor_id=visitor_id, user_id=user_id, ip_hash=ip_hash, origin_host=origin_host,
                               started_page=started_page, utm=utm, locale=locale, status="ACTIVE", message_count=0,
                               answers_billed=0, lead_status=None, lead_ref=None, created_at=now(),
                               last_active_at=now())
        return cid

    def get_conversation(self, db, cid):
        c = self.convs.get(cid)
        return dict(c) if c else None

    def find_resumable(self, db, *, conversation_id, institute_id, site_tag, visitor_id, channel, ttl_seconds):
        c = self.convs.get(conversation_id)
        if (c and c["institute_id"] == institute_id and c["site_tag"] == site_tag and c["visitor_id"] == visitor_id
                and c["channel"] == channel and c["status"] == "ACTIVE"
                and c["last_active_at"] > now() - timedelta(seconds=ttl_seconds)):
            return dict(c)
        return None

    def touch_conversation(self, db, cid, *, messages=0, billed=0):
        c = self.convs[cid]
        c["message_count"] += messages
        c["answers_billed"] += billed
        c["last_active_at"] = now()

    def recent_leads_from_ip(self, db, iid, ip_hash, hours=24):
        return sum(1 for c in self.convs.values() if c["institute_id"] == iid and c["ip_hash"] == ip_hash
                   and c["lead_status"])

    def set_lead(self, db, cid, kind, ref):
        self.convs[cid]["lead_status"] = kind
        self.convs[cid]["lead_ref"] = ref

    # messages
    def add_message(self, db, cid, role, content, *, cards=None, tool_name=None, sources=None, answered=None,
                    page=None):
        mid = next(self._ids)
        self.msgs.append(dict(id=mid, conversation_id=cid, role=role, content=content or "",
                              cards=json.loads(json.dumps(cards)) if cards is not None else None, tool_name=tool_name,
                              sources=json.loads(json.dumps(sources)) if sources is not None else None,
                              answered=answered, feedback=None, page=page, created_at=now()))
        return mid

    def mark_billed(self, db, mid):
        for m in self.msgs:
            if m["id"] == mid:
                m["sources"] = {**(m["sources"] or {}), "billed": True}

    def find_by_client_msg_id(self, db, cid, cmid):
        user = next((m for m in self.msgs if m["conversation_id"] == cid and m["role"] == "user"
                     and (m.get("page") or {}).get("client_msg_id") == cmid), None)
        if not user:
            return None
        reply = None
        for m in self.msgs:
            if m["conversation_id"] != cid or m["id"] <= user["id"]:
                continue
            if m["role"] == "user":
                break
            if m["role"] == "assistant":
                reply = m
                break
        return {"user": dict(user), "reply": dict(reply) if reply else None}

    def recent_user_messages(self, db, cid, seconds=60):
        return sum(1 for m in self.msgs if m["conversation_id"] == cid and m["role"] == "user"
                   and m["created_at"] > now() - timedelta(seconds=seconds))

    def history(self, db, cid, limit=8):
        rows = [dict(m) for m in self.msgs if m["conversation_id"] == cid and m["role"] in ("user", "assistant")]
        return rows[-limit:]

    def transcript(self, db, cid, *, include_tools=False, limit=200):
        roles = ("user", "assistant", "tool") if include_tools else ("user", "assistant")
        return [dict(m) for m in self.msgs if m["conversation_id"] == cid and m["role"] in roles][:limit]

    def set_feedback(self, db, cid, mid, rating):
        for m in self.msgs:
            if m["id"] == mid and m["conversation_id"] == cid and m["role"] == "assistant":
                m["feedback"] = rating
                return True
        return False

    def advisory_lock(self, db, key):
        pass

    def site_answers_today(self, db, iid, tag):
        return self.site_daily.get((iid, tag), 0)

    # knowledge
    def list_knowledge(self, db, iid, *, site_tag=None, kind=None, limit=500):
        return [dict(k) for k in self.knowledge.values() if k["institute_id"] == iid
                and (site_tag is None or k["site_tag"] in (None, site_tag)) and (kind is None or k["kind"] == kind)]

    def get_knowledge(self, db, iid, kid):
        k = self.knowledge.get(kid)
        return dict(k) if k and k["institute_id"] == iid else None

    def create_knowledge(self, db, iid, *, site_tag, kind, title, body, active, starts_at, ends_at, created_by):
        kid = str(uuid.uuid4())
        self.knowledge[kid] = dict(id=kid, institute_id=iid, site_tag=site_tag, kind=kind, title=title, body=body,
                                   active=active, starts_at=starts_at, ends_at=ends_at, created_by=created_by,
                                   embedded=False)
        return kid

    def update_knowledge(self, db, iid, kid, fields):
        k = self.knowledge.get(kid)
        if not k or k["institute_id"] != iid:
            return False
        k.update(fields)
        return True

    def delete_knowledge(self, db, iid, kid):
        k = self.knowledge.get(kid)
        if not k or k["institute_id"] != iid:
            return False
        del self.knowledge[kid]
        return True

    def set_knowledge_embedding(self, db, iid, kid, emb):
        if kid in self.knowledge and self.knowledge[kid]["institute_id"] == iid:
            self.knowledge[kid]["embedded"] = bool(emb)

    # index
    def index_state(self, db, iid, tag):
        s = self.index.get((iid, tag))
        return dict(s) if s else None

    def try_lock_index(self, db, iid, tag, fp, *, stale_seconds=900, retry_failed_seconds=1800, force=False):
        s = self.index.get((iid, tag))
        if s is None:
            self.index[(iid, tag)] = dict(institute_id=iid, site_tag=tag, fingerprint=fp, status="INDEXING", chunks=0,
                                          error=None, updated_at=now())
            return True
        if s["status"] == "INDEXING":
            if s["updated_at"] > now() - timedelta(seconds=stale_seconds):
                return False
        elif not (force or s["fingerprint"] != fp or (s["status"] == "FAILED"
                                                     and s["updated_at"] < now() - timedelta(seconds=retry_failed_seconds))):
            return False
        s.update(status="INDEXING", fingerprint=fp, error=None, updated_at=now())
        return True

    def finish_index(self, db, iid, tag, *, fingerprint, ok, chunks=0, error=None):
        self.index[(iid, tag)].update(status="READY" if ok else "FAILED", chunks=chunks, error=error,
                                      fingerprint=fingerprint, updated_at=now())

    def replace_page_chunks(self, db, iid, tag, fp, chunks):
        self.chunks[(iid, tag)] = [dict(c) for c in chunks]
        return len(chunks)

    def list_conversations(self, db, iid, *, site_tag, lead, page, size, include_empty=False):
        items = [dict(c) for c in self.convs.values() if c["institute_id"] == iid
                 and (site_tag is None or c["site_tag"] == site_tag)
                 and (include_empty or c["message_count"] > 0)]
        return {"items": items[page * size:(page + 1) * size], "page": page, "size": size, "total": len(items)}

    def unanswered_questions(self, db, iid, *, site_tag, days, limit=500):
        out = []
        for m in self.msgs:
            c = self.convs.get(m["conversation_id"])
            if m["role"] == "assistant" and m["answered"] is False and c and c["institute_id"] == iid:
                q = [u for u in self.msgs if u["conversation_id"] == c["id"] and u["role"] == "user" and u["id"] < m["id"]]
                out.append({"reply_id": m["id"], "created_at": m["created_at"], "conversation_id": c["id"],
                            "site_tag": c["site_tag"], "question": q[-1]["content"] if q else None})
        return out

    # caps (same all-or-nothing semantics as caps.reserve)
    def reserve(self, db, *, visitor_key, ip_key, institute_id, site_tag, visitor_cap, ip_cap, site_cap):
        keys = [(visitor_key, visitor_cap)] + ([(ip_key, ip_cap)] if ip_key else [])
        if any(self.visitor_daily.get(k, 0) >= cap or cap <= 0 for k, cap in keys):
            return None
        if self.site_daily.get((institute_id, site_tag), 0) >= site_cap or site_cap <= 0:
            return None
        for k, _ in keys:
            self.visitor_daily[k] = self.visitor_daily.get(k, 0) + 1
        self.site_daily[(institute_id, site_tag)] = self.site_daily.get((institute_id, site_tag), 0) + 1
        return caps_mod.Reservation(visitor_key=visitor_key, ip_key=ip_key, institute_id=institute_id,
                                    site_tag=site_tag)

    def take_session(self, db, key, cap):
        if cap <= 0 or self.visitor_daily.get(key, 0) >= cap:
            return False
        self.visitor_daily[key] = self.visitor_daily.get(key, 0) + 1
        return True

    def release(self, db, r):
        for k in (r.visitor_key, r.ip_key):
            if k:
                self.visitor_daily[k] = max(0, self.visitor_daily.get(k, 0) - 1)
        key = (r.institute_id, r.site_tag)
        self.site_daily[key] = max(0, self.site_daily.get(key, 0) - 1)


REPO_FUNCS = [
    "create_conversation", "get_conversation", "recent_leads_from_ip", "find_resumable", "touch_conversation", "set_lead", "add_message",
    "mark_billed", "find_by_client_msg_id", "recent_user_messages", "history", "transcript", "set_feedback",
    "advisory_lock", "site_answers_today", "list_knowledge", "get_knowledge", "create_knowledge", "update_knowledge",
    "delete_knowledge", "set_knowledge_embedding", "index_state", "try_lock_index", "finish_index",
    "replace_page_chunks", "list_conversations", "unanswered_questions",
]


def course(cid="c1", title="Vedic Parenting", amount=4999.0, visible=True, **extra):
    c = {"id": cid, "title": title, "subtitle": "For new parents", "image_url": "https://cdn.example.com/c.png",
         "url": f"https://{HOST}/{TAG}/course/{cid}", "formats": [{"key": "live", "label": "Live"}],
         "languages": [{"code": "hi", "label": "Hindi"}], "level": "Beginner", "availability": "available",
         "price_visible": visible, "badges": ["bestseller"], "duration_minutes": 600,
         "price": {"amount": amount, "currency": "INR", "is_free": amount == 0, "varies": False,
                   "min_amount": amount, "max_amount": amount, "compare_at_amount": None},
         "stream": {"slug": "parenting", "label": "Parenting"}, "coming_soon": None}
    c.update(extra)
    return c


CATALOGUE = {
    "globalSettings": {"siteAssistant": {"enabled": True, "name": "Ask Brahm Varchas",
                                         "suggestions": ["Courses for parents", "Any free class?"],
                                         "leads": {"campaignId": "camp-1", "streamCampaigns": {"parenting": "camp-p"}},
                                         "support": {"email": "help@bv.org", "phone": "+91 99999 00000"},
                                         "embed": {"enabled": True}}},
    "pages": [
        {"id": "p1", "route": "home", "title": "Home", "components": [
            {"id": "hero", "type": "heroSection", "props": {"title": "Brahm Varchas",
                                                             "subtitle": "Vedic learning for families and children"}}]},
        {"id": "p2", "route": "about", "title": "About us", "components": [
            {"id": "ab", "type": "textBlock", "props": {"content": "We were founded in 2004 by Dr. Pranav. "
                                                                   "Our philosophy is rooted in the Vedas."}}]},
        {"id": "p3", "route": "contact", "title": "Contact", "components": [
            {"id": "ct", "type": "textBlock", "props": {"content": "Visit us at Shantikunj, Haridwar."}}]},
    ],
}


class FakeAdminCore:
    """Records every admin_core call; answers from fixtures."""

    def __init__(self):
        self.calls: List[tuple] = []
        self.leads: List[Dict[str, Any]] = []
        self.sites = {HOST: {"institute_id": INST, "site_tag": TAG}}
        self.keys = {"vak_pub_" + "a" * 48: {"institute_id": INST, "key_id": "k1"}}
        self.allowed_origins = {(INST, "www.brahmvarchas.org")}
        self.catalogues = {(INST, TAG): json.loads(json.dumps(CATALOGUE))}
        self.courses = {INST: [course(), course("c2", "Garbh Sanskar", 0.0),
                               course("c3", "Ayurveda Basics", 2500.0, visible=False)]}
        self.live = {INST: [{"session_id": "s1", "title": "Free Satsang", "starts_at": "2026-10-25T04:30:00Z",
                             "ends_at": "2026-10-25T05:30:00Z", "timezone": "Asia/Kolkata", "is_paid": False,
                             "price": None, "currency": None,
                             "registration_url": f"https://{HOST}/register/live-class?s=s1"}]}
        self.campaigns = {(INST, "camp-1"): {"id": "camp-1", "institute_id": INST, "institute_custom_fields": [
            {"status": "ACTIVE", "individual_order": 1, "custom_field": {
                "fieldKey": "full_name", "fieldName": "Full name", "fieldType": "text", "isMandatory": True}},
            {"status": "ACTIVE", "individual_order": 2, "custom_field": {
                "fieldKey": "phone", "fieldName": "Phone", "fieldType": "phone", "isMandatory": True}},
            {"status": "ACTIVE", "individual_order": 3, "custom_field": {
                "fieldKey": "child_age", "fieldName": "Child's age", "fieldType": "dropdown",
                "config": '{"coommaSepartedOptions":"0-3,4-7,8-12"}'}},
            {"status": "DELETED", "individual_order": 4, "custom_field": {"fieldKey": "x", "fieldName": "X"}},
        ]}}

    def install(self, monkeypatch):
        async def resolve_site(host, tag=None):
            self.calls.append(("resolve_site", host, tag))
            site = self.sites.get(host)
            if site and tag and (site["institute_id"], tag) in self.catalogues:
                return {"institute_id": site["institute_id"], "site_tag": tag}
            return site

        async def origin_allowed(iid, host):
            self.calls.append(("origin_allowed", iid, host))
            return (iid, host) in self.allowed_origins

        async def verify_api_key(key, ip=None):
            self.calls.append(("verify_api_key", key))
            return self.keys.get(key)

        async def published_catalogue(iid, tag):
            self.calls.append(("published_catalogue", iid, tag))
            cat = self.catalogues.get((iid, tag))
            return {"catalogue": cat, "tag": tag} if cat else None

        async def catalog_site(iid):
            return {"institute": {"id": iid, "name": "Brahm Varchas", "logo_url": "https://cdn.example.com/logo.png"},
                    "price_visible": True, "catalog": {"popular_searches": [{"label": "Parenting"}]}}

        async def catalog_courses(iid, params):
            self.calls.append(("catalog_courses", iid, dict(params)))
            data = self.courses.get(iid, [])
            if params.get("price") == "free":
                data = [c for c in data if c["price"]["is_free"]]
            return {"data": data[:params.get("page_size", 4)], "total": len(data)}

        async def catalog_course(iid, cid, language=None):
            self.calls.append(("catalog_course", iid, cid))
            return next((dict(c, description_text="A course.") for c in self.courses.get(iid, []) if c["id"] == cid), None)

        async def catalog_outline(iid, cid):
            return {"levels": []}

        async def catalog_learning_paths(iid):
            return {"data": [{"code": "path-1", "name": "Parenting path", "step_count": 2}]}

        async def catalog_learning_path(iid, code):
            if code != "path-1":
                return None
            return {"code": "path-1", "name": "Parenting path",
                    "steps": [{"position": 1, "course": course()}, {"position": 2, "course": course("c2", "Garbh Sanskar", 0.0)}]}

        async def live_sessions(iid, days=30, limit=20):
            self.calls.append(("live", iid, days))
            return {"data": self.live.get(iid, [])}

        async def campaign(iid, aid):
            self.calls.append(("campaign", iid, aid))
            return self.campaigns.get((iid, aid))

        async def submit_lead(body):
            self.leads.append(body)
            return {"status": "received", "lead_ref": "lead-1"}

        for name, fn in dict(resolve_site=resolve_site, origin_allowed=origin_allowed, verify_api_key=verify_api_key,
                             published_catalogue=published_catalogue, catalog_site=catalog_site,
                             catalog_courses=catalog_courses, catalog_course=catalog_course,
                             catalog_outline=catalog_outline, catalog_learning_paths=catalog_learning_paths,
                             catalog_learning_path=catalog_learning_path, live_sessions=live_sessions,
                             campaign=campaign, submit_lead=submit_lead).items():
            monkeypatch.setattr(ac, name, fn)


class FakeBilling:
    def __init__(self):
        self.charges: List[Dict[str, Any]] = []
        self.sufficient = True

    def install(self, monkeypatch):
        monkeypatch.setattr(billing_mod, "preflight", lambda iid, **k: self.sufficient)

        def charge(**kw):
            self.charges.append(kw)
            return True

        monkeypatch.setattr(billing_mod, "charge", charge)
        monkeypatch.setattr(billing_mod, "balance_warning", lambda iid: {"balance": 100, "sufficient": True,
                                                                          "credits_per_answer": 1})


class ScriptedLLM:
    """Plays back scripted rounds: each round is a list of chunks."""

    def __init__(self, rounds: List[List[Dict[str, Any]]]):
        self.rounds = list(rounds)
        self.calls: List[Dict[str, Any]] = []

    async def __call__(self, messages, tools, ctx):
        self.calls.append({"messages": [dict(m) for m in messages], "tools": tools})
        chunks = self.rounds.pop(0) if self.rounds else [{"type": "token", "content": "Okay."}]
        for c in chunks:
            if isinstance(c, Exception):
                raise c
            yield c
        yield {"type": "done", "usage": {"prompt_tokens": 100, "completion_tokens": 20}, "model": "google/gemini-2.5-flash"}


def tool_call(name: str, args: Dict[str, Any], cid: str = "call_1") -> Dict[str, Any]:
    return {"type": "tool_calls", "tool_calls": [{"id": cid, "type": "function",
                                                   "function": {"name": name, "arguments": json.dumps(args)}}]}


def tokens(text: str) -> List[Dict[str, Any]]:
    return [{"type": "token", "content": text[i:i + 7]} for i in range(0, len(text), 7)]


class Fakes(SimpleNamespace):
    pass


def install(monkeypatch) -> Fakes:
    store = Store()
    for name in REPO_FUNCS:
        monkeypatch.setattr(repo_mod, name, getattr(store, name))
    monkeypatch.setattr(caps_mod, "reserve", store.reserve)
    monkeypatch.setattr(caps_mod, "release", store.release)
    monkeypatch.setattr(caps_mod, "take_session", store.take_session)

    @contextmanager
    def fake_session():
        yield FakeDB()

    for mod in (engine_mod, service_mod, admin_mod, knowledge_mod, billing_mod):
        monkeypatch.setattr(mod, "db_session", fake_session)
    monkeypatch.setattr(settings_mod, "_platform", lambda key, default, db=None: default)
    monkeypatch.setattr(service_mod, "learner_portal_base", lambda iid: f"https://{HOST}")

    admin_core = FakeAdminCore()
    admin_core.install(monkeypatch)
    bill = FakeBilling()
    bill.install(monkeypatch)

    async def no_pages(iid, tag, query, top_k=4):
        return [c for c in store.chunks.get((iid, tag), []) if any(w in c["content"].lower() for w in query.lower().split())][:top_k]

    async def no_knowledge(iid, tag, query, kinds, top_k=4):
        return [k for k in store.list_knowledge(None, iid, site_tag=tag) if k["kind"] in kinds and k["active"]
                and any(w in (k["title"] + " " + k["body"]).lower() for w in query.lower().split())][:top_k]

    async def no_kb(*a, **k):
        return []

    async def embed_ok(iid, kid, title, body):
        store.set_knowledge_embedding(None, iid, kid, [0.1])
        return True

    monkeypatch.setattr(knowledge_mod, "search_pages", no_pages)
    monkeypatch.setattr(knowledge_mod, "search_knowledge", no_knowledge)
    monkeypatch.setattr(knowledge_mod, "search_linked_kbs", no_kb)
    monkeypatch.setattr(knowledge_mod, "search_institute_info", no_kb)
    monkeypatch.setattr(knowledge_mod, "embed_knowledge", embed_ok)
    monkeypatch.setattr(knowledge_mod, "ensure_index_background", lambda *a, **k: None)
    return Fakes(store=store, admin_core=admin_core, billing=bill)
