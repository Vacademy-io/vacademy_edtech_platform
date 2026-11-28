"""
The CRM writes that contact nobody in the in-product assistant, confirmed on
the assistant's card (app/services/crm_cards.py).

Pinned here: a write's preview becomes a card and changes nothing; the card's
Confirm runs the same executor with the preview's token and applies once; an
expired, replayed or edited card, or one whose leads changed in between,
changes nothing; a counsellor acts only on their own leads at preview and at
Confirm; the admission rule warns on the card (WARN) or refuses (BLOCK, also
when switched on after the card was shown); actions that contact a lead are
refused; the groups are opt-in and offered on CRM pages; and MCP keeps its
own two-step. Postgres-only parts (the atomic claim of a card, single-use
tokens) run with AI_LIMITS_PG_URL=postgresql+psycopg://...
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import sys
import uuid
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402  (load the registry first)
from app.services import assistant_service as asv  # noqa: E402
from app.services import assistant_tools_crm_lead_edit as m  # noqa: E402
from app.services import crm_cards  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import institute_setting_reader as isr  # noqa: E402
from app.services.entitlements import LEGACY  # noqa: E402
from app.mcp.constants import MCP_OPT_IN_GROUPS  # noqa: E402
from crm_fakes import CrmBackend, lead_row, make_ctx, principal  # noqa: E402
import test_crm_lead_edit as le  # noqa: E402  (its fakes, not its tests)

CARD_WRITES = ("crm_lead_activity", "crm_lead_edit", "crm_lead_merge", "crm_lead_intake", "crm_team_edit",
               "crm_meetings_edit")
WRITE_GROUPS = ("crm_lead_activity", "crm_lead_edits", "crm_lead_merges", "crm_team_edits", "crm_lead_intake",
                "crm_meeting_edits")
OUTBOUND = ("crm_dial", "crm_ai_campaign", "crm_send", "crm_payment_reminders")
SETTING = {"enabled_tools": ["crm_leads", *WRITE_GROUPS], "role_overrides": {}}
LEADS_PAGE = "/audience-manager/recent-leads"
STATUS_ONE, STATUS_BULK, TIMELINE, FOLLOWUP = le.STATUS_ONE, le.STATUS_BULK, le.TIMELINE, le.FOLLOWUP


def names(schemas):
    return {s["function"]["name"] for s in schemas}


@pytest.fixture
def backend(monkeypatch):
    b = CrmBackend().install(monkeypatch)
    b.leads = le.Leads(lead_row("r-1", "u-1", status_key="NEW", lead_status_id="st-new", owner_id="c-1"))
    b.sql.on("FROM audience_response ar", b.leads)
    b.sql.on("FROM lead_status st", le._statuses)
    b.sql.on("LOWER(st.label) = LOWER(:label)",
             lambda p, sql: [s for s in le.STATUSES if s["label"].lower() == p["label"].lower()])
    b.sql.on("FROM workflow_trigger", [])
    b.admin_core.on("POST", TIMELINE, {"id": "ev-1"})
    b.admin_core.on("POST", FOLLOWUP, lambda mth, path, params, body: {"id": "fu-new", "status": "PENDING"})
    b.admin_core.on("POST", STATUS_ONE, "Lead status updated")
    b.admin_core.on("POST", STATUS_BULK, lambda mth, path, params, body: {
        "updated": len(body["response_ids"]), "unchanged": 0, "failed": 0, "errors": []})
    monkeypatch.setattr(isr, "load_institute_setting_data", lambda db, inst, key: None)
    monkeypatch.setattr(reg, "load_entitlements", lambda db, inst: LEGACY)
    return b


def writes(backend):
    return le.writes(backend)


def shared_db():
    """An sqlite session with mcp_crm_confirm that a worker thread can use too (CRM writes run off the loop)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.models.crm_confirm import CrmConfirm

    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    CrmConfirm.__table__.create(bind=engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


class Panel:
    """The dashboard panel's two halves: tool calls in the conversation and the card's Confirm endpoint."""

    def __init__(self, monkeypatch, user="admin-1", roles=("ADMIN",), setting=SETTING, db=None):
        self.store = []
        self.user, self.roles, self.setting = user, roles, setting
        self.db = db if db is not None else shared_db()
        self.principal = principal(user_id=user, roles=roles)
        store = self.store

        class Messages:
            def __init__(self, db):
                pass

            def create_message(self, session_id, message_type, content, metadata=None):
                msg = SimpleNamespace(id=len(store) + 1, session_id=session_id, message_type=message_type,
                                      content=content, meta_data=dict(metadata or {}),
                                      created_at=datetime.now(timezone.utc))
                store.append(msg)
                return msg

        class Sessions:
            def __init__(self, db):
                pass

            def get_session_by_id(self, sid):
                return SimpleNamespace(id=sid, user_id=user, institute_id="inst-1",
                                       context_type=reg.ASSISTANT_CONTEXT_TYPE, status="ACTIVE")

        from app.repositories import chat_message_repository
        monkeypatch.setattr(chat_message_repository, "ChatMessageRepository", Messages)
        monkeypatch.setattr(asv, "ChatMessageRepository", Messages)
        monkeypatch.setattr(asv, "ChatSessionRepository", Sessions)
        monkeypatch.setattr(asv, "load_assistant_tools_setting", lambda db, inst: self.setting)
        svc = asv.AssistantAgentService(lambda: nullcontext(self.db))

        def load(db, sid, nonce):
            for msg in store:
                if msg.message_type == "pending_action" and msg.meta_data.get("nonce") == nonce and msg.session_id == sid:
                    return (msg.id, msg.content, dict(msg.meta_data))
            return None

        def move(db, row_id, meta, from_status):    # the in-memory twin of the SQL in _move_pending_action
            row = store[row_id - 1]
            if row.meta_data.get("status") != from_status:
                return False
            row.meta_data = dict(meta)
            return True

        svc._load_pending_action, svc._move_pending_action = load, move
        self.service = svc
        self.ctx = None

    async def ask(self, tool, session="s-1", **args):
        """
        One tool call of the model, as the agent loop makes it (in_product, the caller's JWT). A card's text
        reaches the model labelled as lead-written data; it is unpacked here for the assertions.
        """
        self.ctx = make_ctx(self.user, self.roles, via_mcp=False, db=self.db)
        self.ctx.session_id = session
        out = json.loads(await reg.execute_tool(tool, args, self.ctx, self.setting, in_product=True))
        if "card" in out:
            assert out["card"]["_note"] == cd.LEAD_CONTENT_NOTE and not {"summary", "details", "warnings"} & set(out)
            out.update({k: v for k, v in out["card"].items() if k != "_note"})
        return out

    def cards(self):
        return [msg for msg in self.store if msg.message_type == "pending_action"]

    def card(self):
        return self.cards()[-1]

    async def confirm(self, card=None, session="s-1"):
        card = card or self.card()
        return await self.service.confirm_action(session, self.principal, card.meta_data["nonce"], "jwt")

    def said(self):
        return [msg.content for msg in self.store if msg.message_type == "assistant"]


# ── a preview becomes a card ─────────────────────────────────────────────

async def test_a_preview_becomes_a_card_and_changes_nothing(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    assert out["status"] == "awaiting_user_confirmation"
    assert out["summary"] == "Change status to Interested for 1 lead"
    assert out["details"] == ["Priya Sharma (******3210) · NEET 2027: NEW → Interested"]
    blob = json.dumps(out)
    assert "confirm_token" not in blob and cd.CARD_TOKEN_KEY not in blob and "98765" not in blob
    assert writes(backend) == []
    card = panel.card()
    assert card.content == out["summary"] and card.meta_data["status"] == "PENDING"
    assert card.meta_data["tool"] == "crm_lead_edit" and card.meta_data["details"] == out["details"]
    stored = card.meta_data["args"]
    assert stored["args"]["action"] == "set_status" and stored["args"]["status"] == "Interested"
    # the token is kept encrypted with the card, never in clear
    assert "." not in stored["token"][:12] and crm_cards._cipher().decrypt(stored["token"]).count(".") == 1
    # the card lives no longer than the edit token it carries
    expires = datetime.fromisoformat(card.meta_data["expires_at"])
    assert expires <= datetime.now(timezone.utc) + timedelta(minutes=reg.PENDING_ACTION_TTL_MINUTES)
    assert panel.ctx.pending_action["action_id"] == card.meta_data["nonce"]
    assert panel.ctx.pending_action["details"] == out["details"]


async def test_a_confirm_token_from_the_model_is_ignored(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    mcp = make_ctx()
    mcp.client_id = "client-1"
    minted = json.loads(await m.execute_crm_lead_edit(
        {"action": "set_status", "lead_id": "r-1", "status": "Interested"}, mcp))["confirm_token"]
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested",
                          confirm_token=minted)
    assert out["status"] == "awaiting_user_confirmation" and writes(backend) == []
    assert "confirm_token" not in panel.card().meta_data["args"]["args"]


# ── Confirm applies once ─────────────────────────────────────────────────

async def test_confirm_applies_exactly_the_change_once(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    done = await panel.confirm()
    assert done["status"] == "executed" and done["message"].startswith("✅ Done — Change status to Interested")
    sent = backend.admin_core.called(STATUS_ONE + "r-1", "POST")
    assert len(sent) == 1 and sent[0]["params"] == {"statusId": "st-int", "source": "MANUAL"}
    assert panel.card().meta_data["status"] == "EXECUTED"
    again = await panel.confirm()
    assert again["message"] == "This action was already handled."
    assert len(backend.admin_core.called(STATUS_ONE)) == 1


async def test_two_confirms_at_once_apply_once(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_activity", action="add_note", lead_id="r-1", note="Asked about fees")
    # Both requests read the card while it was still PENDING; only one wins the claim.
    card = panel.card()
    seen = (card.id, card.content, dict(card.meta_data))
    panel.service._load_pending_action = lambda db, sid, nonce: (seen[0], seen[1], dict(seen[2]))
    outs = await asyncio.gather(panel.confirm(), panel.confirm())
    assert sorted(o["status"] for o in outs) == ["executed", "executing"]
    assert "already being applied" in next(o["message"] for o in outs if o["status"] == "executing")
    assert len(backend.admin_core.called(TIMELINE, "POST")) == 1


async def test_an_expired_card_changes_nothing(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    panel.card().meta_data["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    out = await panel.confirm()
    assert out["status"] == "expired" and writes(backend) == []


async def test_an_edited_card_changes_nothing(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    card = panel.card()
    card.meta_data["args"]["args"]["status"] = "Admitted"                  # a different change than the one shown
    out = await panel.confirm()
    assert out["status"] == "failed" and "changed after it was shown" in out["message"]
    assert writes(backend) == []

    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    panel.card().meta_data["args"]["token"] = "not-a-sealed-token"
    out = await panel.confirm()
    assert out["status"] == "failed" and writes(backend) == []

    # a card's token is bound to its conversation: confirmed from another one, it is refused
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    other = make_ctx(via_mcp=False, db=panel.db)
    other.session_id = "s-2"
    res = await reg.performer_for("crm_lead_edit")(panel.card().meta_data["args"], other)
    assert res["ok"] is False and "changed after it was shown" in res["message"] and writes(backend) == []


async def test_a_card_token_does_not_work_over_mcp(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    token = crm_cards._cipher().decrypt(panel.card().meta_data["args"]["token"])
    mcp = make_ctx()
    mcp.client_id = "client-1"
    out = json.loads(await m.execute_crm_lead_edit(
        {"action": "set_status", "lead_id": "r-1", "status": "Interested", "confirm_token": token}, mcp))
    assert out["error"] == "confirm_token_mismatch" and writes(backend) == []


async def test_a_lead_changed_since_the_card_is_refused(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    backend.leads.rows["r-1"]["updated_at"] = datetime(2026, 11, 18, 9, 0)    # changed in the dashboard meanwhile
    out = await panel.confirm()
    assert out["status"] == "failed" and "Ask the assistant again" in out["message"]
    assert writes(backend) == [] and panel.card().meta_data["status"] == "FAILED"


def _two_people(backend):
    backend.leads = le.Leads(
        lead_row("r-1", "u-1", status_key="NEW", lead_status_id="st-new"),
        lead_row("r-3", "u-2", status_key="NEW", lead_status_id="st-new", name="Rahul Verma",
                 phone="+91 90000 11111"))
    backend.sql.on("FROM audience_response ar", backend.leads)


async def test_bulk_card_counts_leads_and_leaves_ones_that_changed(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _two_people(backend)
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_edit", action="set_status", lead_ids=["r-1", "r-3"], status="INTERESTED")
    assert out["summary"] == "Change status to Interested for 2 leads"
    assert set(out["details"]) == {"Priya Sharma (******3210) · NEET 2027: NEW → Interested",
                                   "Rahul Verma (******1111) · NEET 2027: NEW → Interested"}
    assert crm_cards._cipher().decrypt(panel.card().meta_data["args"]["token"]).startswith(cd.ONCE_PREFIX)
    backend.leads.rows["r-3"].update(lead_status_id="st-won", status_key="CONVERTED")
    done = await panel.confirm()
    assert done["status"] == "executed" and "1 of them changed after the card was shown" in done["message"]
    assert backend.admin_core.called(STATUS_BULK, "POST")[0]["body"]["response_ids"] == ["r-1"]


async def test_a_replayed_single_use_token_changes_nothing(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _two_people(backend)
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_ids=["r-1", "r-3"], status="INTERESTED")
    first = panel.card()
    assert (await panel.confirm())["status"] == "executed"
    # the same token on a second card (a copied row): the token itself was spent
    copy = SimpleNamespace(**{**first.__dict__, "id": len(panel.store) + 1,
                              "meta_data": {**first.meta_data, "status": "PENDING", "nonce": str(uuid.uuid4())}})
    panel.store.append(copy)
    out = await panel.confirm(copy)
    assert out["status"] == "failed" and "already used" in out["message"]
    assert len(backend.admin_core.called(STATUS_BULK)) == 1


async def test_an_hourly_limit_keeps_the_card_open(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _two_people(backend)
    monkeypatch.setitem(cd.CAPS, "crm.crm_lead_edit.set_status", 0)
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_ids=["r-1", "r-3"], status="INTERESTED")
    out = await panel.confirm()
    assert out["status"] == "pending" and "limited to 0 an hour" in out["message"]
    assert panel.card().meta_data["status"] == "PENDING" and writes(backend) == []


# ── scope: a counsellor's own leads, at preview and at Confirm ───────────

async def test_a_counsellor_gets_no_card_for_a_lead_outside_their_scope(backend, monkeypatch):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    backend.leads.rows["r-1"]["in_scope"] = False
    panel = Panel(monkeypatch, user="c-1", roles=("COUNSELLOR",))
    for tool, args in (("crm_lead_edit", dict(action="set_status", lead_id="r-1", status="INTERESTED")),
                       ("crm_lead_activity", dict(action="add_note", lead_id="r-1", note="hi")),
                       ("crm_lead_activity", dict(action="log_interaction", lead_id="r-1", note="hi"))):
        out = await panel.ask(tool, **args)
        assert out["error"] == "out_of_scope", (tool, out)
    assert panel.cards() == [] and writes(backend) == []
    assert backend.sql.matching("ar.id = :lid")[0][1]["scope_owners"] == ["c-1"]


async def test_scope_is_checked_again_at_confirm(backend, monkeypatch):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    panel = Panel(monkeypatch, user="c-1", roles=("COUNSELLOR",))
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="INTERESTED")
    assert out["status"] == "awaiting_user_confirmation"
    backend.leads.rows["r-1"]["in_scope"] = False                       # reassigned to someone else meanwhile
    done = await panel.confirm()
    assert done["status"] == "failed" and writes(backend) == []


async def test_admin_only_actions_stay_admin_only(backend, monkeypatch):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    panel = Panel(monkeypatch, user="c-1", roles=("COUNSELLOR",))
    out = await panel.ask("crm_lead_merge", action="merge_people", lead_id="r-1", duplicate_lead_id="r-2")
    assert out["error"] == "admin_only"
    out = await panel.ask("crm_lead_edit", action="tag_lists", lists=[{"list_id": "list-1", "tags": {"state": "MP"}}])
    assert out["error"] == "admin_only"
    assert panel.cards() == [] and writes(backend) == []


# ── the admission rule on a move to CONVERTED ────────────────────────────

def _rule(backend, monkeypatch, mode, missing):
    monkeypatch.setattr(isr, "load_institute_setting_data",
                        lambda db, inst, key: {"admissionCourseRule": {"mode": mode}} if key == "LEAD_SETTING" else None)
    backend.sql.on("AS no_course_lead_id", lambda p, sql: [{"no_course_lead_id": i} for i in p["lids"] if i in missing])


async def test_warn_shows_the_warning_on_the_card_and_still_confirms(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _rule(backend, monkeypatch, "WARN", {"r-1"})
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Admitted")
    assert out["details"] == ["Priya Sharma (******3210) · NEET 2027: NEW → Admitted (no course yet)"]
    assert any("no course or fee plan here yet" in w for w in out["warnings"])
    assert panel.card().meta_data["warnings"] == out["warnings"] and writes(backend) == []
    done = await panel.confirm()
    assert done["status"] == "executed"
    assert backend.admin_core.called(STATUS_ONE + "r-1", "POST")[0]["params"]["statusId"] == "st-won"


async def test_warn_on_a_logged_interaction_too(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _rule(backend, monkeypatch, "WARN", {"r-1"})
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_activity", action="log_interaction", lead_id="r-1", kind="CALL",
                          note="Paid the deposit", status="CONVERTED")
    assert "Status: NEW → Admitted" in out["details"]
    assert any("no course or fee plan here yet" in w for w in out["warnings"])


async def test_block_refuses_at_preview_and_at_confirm(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _rule(backend, monkeypatch, "BLOCK", {"r-1"})
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Admitted")
    assert out["error"] == "course_required" and panel.cards() == []
    # rule off when the card is shown, switched to BLOCK before Confirm
    _rule(backend, monkeypatch, "OFF", {"r-1"})
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Admitted")
    assert out["status"] == "awaiting_user_confirmation"
    _rule(backend, monkeypatch, "BLOCK", {"r-1"})
    done = await panel.confirm()
    assert done["status"] == "failed" and "no course or fee plan" in done["message"]
    assert writes(backend) == []


# ── the activity writes are one card each ────────────────────────────────

async def test_log_interaction_is_one_card_applied_together(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    le.automation(backend, "SEND_WHATSAPP")
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_activity", action="log_interaction", lead_id="r-1", kind="CALL",
                          note="Wants NEET", next_followup_at=le.in_hours(48), status="interested")
    assert out["summary"] == "Log a call with Priya Sharma (******3210) · NEET 2027"
    assert "Note: Wants NEET" in out["details"] and "Status: NEW → Interested" in out["details"]
    assert any(d.startswith("Next follow-up: ") for d in out["details"])
    assert any("contact people" in w and "whatsapp" in w for w in out["warnings"])
    assert writes(backend) == []
    done = await panel.confirm()
    assert done["status"] == "executed"
    assert len(backend.admin_core.called(TIMELINE, "POST")) == 1
    assert len(backend.admin_core.called(FOLLOWUP, "POST")) == 1
    assert backend.admin_core.called(STATUS_ONE + "r-1", "POST")[0]["params"]["statusId"] == "st-int"


async def test_a_note_waits_for_the_card(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_activity", action="add_note", lead_id="r-1", note="Asked about fees")
    assert out["summary"] == "Add a note to Priya Sharma (******3210) · NEET 2027"
    assert out["details"] == ["Asked about fees"] and writes(backend) == []
    assert (await panel.confirm())["status"] == "executed"
    assert backend.admin_core.called(TIMELINE, "POST")[0]["body"]["type_id"] == "r-1"


async def test_an_opted_out_lead_keeps_its_status_and_the_card_says_so(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    backend.leads.rows["r-1"]["overall_status"] = "OPTED_OUT"
    backend.leads.rows["r-1"]["lead_opted_out"] = True
    backend.leads.rows["r-1"]["own_opted_out"] = True
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="INTERESTED")
    assert out.get("applied") is False and panel.cards() == []          # nothing to change: no card
    out = await panel.ask("crm_lead_activity", action="log_interaction", lead_id="r-1", note="Called",
                          status="INTERESTED")
    assert any("status stays as it is" in w for w in out["warnings"])
    await panel.confirm()
    assert backend.admin_core.called(STATUS_ONE) == []


async def test_adding_a_walk_in_is_one_card(backend, monkeypatch):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    backend.counsellors({"c-1": "Asha"}, assignable={"c-1": "Asha"})
    backend.admin_core.on("POST", "/admin-core-service/v1/audience/lead/submit", le.UUID)
    backend.sql.on("FROM audience a WHERE", lambda p, sql: [
        {"id": i, "name": "NEET 2027", "status": "ACTIVE", "sub_org_id": None} for i in p["ids"] if i == "list-1"])
    backend.sql.on("FROM institute_custom_fields icf", [])
    panel = Panel(monkeypatch, user="c-1", roles=("COUNSELLOR",))
    out = await panel.ask("crm_lead_intake", action="add_lead", list_id="list-1", name="Ravi Kumar",
                          phone="+91 91234 56789", source="WALK_IN", counsellor_id="me")
    assert out["summary"] == "Add lead Ravi Kumar to NEET 2027"
    assert "Owner: Asha" in out["details"] and "Source: WALK_IN" in out["details"]
    assert writes(backend) == []
    assert (await panel.confirm())["status"] == "executed"
    assert len(backend.admin_core.called("/admin-core-service/v1/audience/lead/submit", "POST")) == 1


async def test_assigning_leads_is_one_card(monkeypatch):
    import test_crm_team as tt
    b = CrmBackend().install(monkeypatch)
    b.lead_scope("ADMIN")
    b.counsellors(tt.ROSTER)
    b.admin_core.on("POST", "/admin-core-service/v1/counsellor-workbench/assign", tt._assign_echo)
    monkeypatch.setattr(reg, "load_entitlements", lambda db, inst: LEGACY)
    tt._leads(b, tt.THREE)
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_team_edit", action="assign_leads", lead_ids=["r-1", "r-2", "r-3"],
                          to_counsellor_id="c-2")
    assert out["summary"].startswith("3 people (3 leads) get a new owner")
    assert "Priya Sharma (******3210) · NEET 2027: unassigned → Bala K" in out["details"]
    assert "Priya Sharma (******3210) · NEET 2027: Asha Rao → Bala K" in out["details"]
    assert tt._writes(b) == []
    assert (await panel.confirm())["status"] == "executed"
    sent = tt._writes(b)
    assert len(sent) == 1 and sent[0]["body"]["target_user_id"] == "c-2"


async def test_logging_a_meeting_outcome_is_one_card_and_only_once(monkeypatch):
    import test_crm_meetings as tm
    b = CrmBackend().install(monkeypatch)
    b.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    b.sql.on("FROM booking_instance bi\nLEFT JOIN", lambda p, s: [tm._booking_row()] if "bi-1" in p["ids"] else [])
    b.sql.on("FROM audience_response ar", tm.leads(lead_row("r-1", "u-1", owner_id="c-1")))
    b.admin_core.on("POST", cd.TIMELINE_EVENT_PATH, {"id": "te-1"})
    monkeypatch.setattr(reg, "load_entitlements", lambda db, inst: LEGACY)
    panel = Panel(monkeypatch, user="c-1", roles=("COUNSELLOR",))
    out = await panel.ask("crm_meetings_edit", action="log_outcome", meeting_id="bi-1", outcome="no_show",
                          note="Did not join")
    assert out["summary"] == "Log the meeting with Priya Sharma (******3210) · NEET 2027 as a no-show"
    assert writes(b) == []
    assert (await panel.confirm())["status"] == "executed"
    (call,) = writes(b)
    assert call["body"]["metadata"]["via"] == "ASSISTANT" and call["body"]["metadata"]["outcome"] == "NO_SHOW"
    # logged meanwhile (another card, the dashboard): a second card is refused at Confirm
    await panel.ask("crm_meetings_edit", action="log_outcome", meeting_id="bi-1", outcome="HELD")
    b.sql.on("FROM timeline_event te", [{"id": "te-1", "outcome": "NO_SHOW", "created_at": None}])
    again = await panel.confirm()
    assert again["status"] == "failed" and "already on the lead's timeline" in again["message"]
    assert len(writes(b)) == 1


# ── adding leads: the acknowledgement email, automations, the admission rule ──

SUBMIT = "/admin-core-service/v1/audience/lead/submit"
BULK_SUBMIT = "/admin-core-service/v1/audience/lead/bulk-submit"


def _intake(backend, *, respondent_email=None, triggers=()):
    """A lead list ``list-1`` with one form question; ``triggers``: (event, node type) automations."""
    backend.sql.on("FROM audience a WHERE", lambda p, sql: [
        {"id": i, "name": "NEET 2027", "status": "ACTIVE", "sub_org_id": None} for i in p["ids"] if i == "list-1"])
    backend.sql.on("FROM institute_custom_fields icf", [
        {"id": "cf-course", "field_key": "course", "field_name": "Course interested in", "field_type": "text",
         "config": None}])
    backend.sql.on("AS respondent_email_on", [{"respondent_email_on": respondent_email}])
    wanted = dict(triggers)
    backend.sql.on("FROM workflow_trigger", lambda p, sql: [
        {"trigger_id": "t-" + p["event"], "event_id": None, "workflow_id": "w-" + p["event"],
         "workflow_name": f"On {p['event'].lower()}", "updated_at": None}] if p["event"] in wanted else [])
    backend.sql.on("FROM workflow_node_mapping", lambda p, sql: [
        {"workflow_id": w, "node_type": wanted[w[2:]], "n": 1} for w in p["wids"]])
    backend.admin_core.on("POST", SUBMIT, le.UUID)
    backend.admin_core.on("POST", BULK_SUBMIT, lambda mth, path, params, body: {
        "summary": {"total_requested": len(body["rows"]), "successful": len(body["rows"]), "failed": 0,
                    "skipped": 0},
        "results": [{"index": i, "status": "SUCCESS", "audience_response_id": f"new-{i}"}
                    for i in range(len(body["rows"]))]})


async def test_adding_a_lead_with_an_email_says_it_will_be_emailed(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _intake(backend)                                        # respondent email unset (= on), no new-lead automation
    panel = Panel(monkeypatch)
    args = dict(action="add_lead", list_id="list-1", name="Ravi Kumar", email="ravi@example.com",
                answers={"Course interested in": "JEE"})
    out = await panel.ask("crm_lead_intake", **args)
    assert "Course interested in: JEE" in out["details"]
    assert any("acknowledgement email" in w and "as soon as they are added" in w for w in out["warnings"])
    # the same warning over MCP, from the same preview
    mcp = make_ctx(db=shared_db())
    shown = json.loads(await m.execute_crm_lead_intake(dict(args), mcp))
    assert shown["acknowledgement_email"]["will_send"] is True and shown["acknowledgement_email"]["emails"] == 1
    assert shown["answers"]["items"] == [{"question": "Course interested in", "answer": "JEE"}]
    assert writes(backend) == []
    # behaviour is unchanged: admin-core decides, nothing is suppressed
    assert (await panel.confirm())["status"] == "executed"
    assert "suppress_respondent_email" not in backend.admin_core.called(SUBMIT, "POST")[0]["body"]


@pytest.mark.parametrize("setup, will_send", [
    (dict(respondent_email=False), False),                                      # the list's respondent email is off
    (dict(triggers=[("AUDIENCE_LEAD_SUBMISSION", "SEND_EMAIL")]), False),       # its automation runs instead
])
async def test_no_acknowledgement_warning_when_it_is_not_sent(backend, monkeypatch, setup, will_send):
    backend.lead_scope("ADMIN")
    _intake(backend, **setup)
    shown = json.loads(await m.execute_crm_lead_intake(
        dict(action="add_lead", list_id="list-1", name="Ravi Kumar", email="ravi@example.com"), make_ctx(db=shared_db())))
    assert shown["acknowledgement_email"]["will_send"] is will_send
    card = crm_cards.build_card("crm_lead_intake", "add_lead", shown)
    assert not any("acknowledgement email (" in w for w in card["warnings"])


async def test_acknowledgement_unknown_or_no_email(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _intake(backend)
    backend.sql.on("AS respondent_email_on", [])            # the setting could not be read
    ctx = make_ctx(db=shared_db())
    shown = json.loads(await m.execute_crm_lead_intake(
        dict(action="add_lead", list_id="list-1", name="Ravi Kumar", email="ravi@example.com"), ctx))
    assert shown["acknowledgement_email"]["will_send"] is None and "may get" in shown["acknowledgement_email"]["message"]
    phone_only = json.loads(await m.execute_crm_lead_intake(
        dict(action="add_lead", list_id="list-1", name="Asha Rao", phone="9123456780"), ctx))
    assert "acknowledgement_email" not in phone_only


async def test_owner_and_repeat_enquiry_automations_are_on_the_card(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _intake(backend, triggers=[("LEAD_ASSIGNED_TO_COUNSELOR", "SEND_WHATSAPP"), ("LEAD_REATTEMPT", "SEND_EMAIL")])
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_intake", action="add_lead", list_id="list-1", name="Priya",
                          phone="+91 98765 43210", re_enquiry=True)
    assert any("when an owner is set" in w and "whatsapp" in w for w in out["warnings"])
    assert any("for a repeat enquiry" in w and "email" in w for w in out["warnings"])
    fresh = await panel.ask("crm_lead_intake", action="add_lead", list_id="list-1", name="Kiran", phone="9000000001")
    assert any("when an owner is set" in w for w in fresh["warnings"])
    assert not any("repeat enquiry" in w for w in fresh["warnings"])


async def test_import_card_shows_each_rows_status_with_contacts_masked(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _intake(backend)
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_intake", action="import_leads", list_id="list-1", rows=[
        {"name": "Kiran Rao", "phone": "9000000001", "status": "INTERESTED"},
        {"name": "Meera Iyer", "email": "meera@example.com"}])
    assert out["summary"] == "Import 2 leads into NEET 2027"
    assert "Kiran Rao (******0001) · list routing · status INTERESTED" in out["details"]
    assert "Meera Iyer (m***@example.com) · list routing" in out["details"]
    assert any("1 of the new leads will get the list's acknowledgement email" in w for w in out["warnings"])
    assert "9000000001" not in json.dumps(out) and "meera@example.com" not in json.dumps(out)


def _converted_rule(monkeypatch, mode):
    monkeypatch.setattr(isr, "load_institute_setting_data",
                        lambda db, inst, key: {"admissionCourseRule": {"mode": mode}} if key == "LEAD_SETTING" else None)


async def test_a_new_lead_starting_as_converted_follows_the_admission_rule(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _intake(backend)
    _converted_rule(monkeypatch, "WARN")
    panel = Panel(monkeypatch)
    args = dict(action="add_lead", list_id="list-1", name="Kiran", phone="9000000001", status="Admitted")
    out = await panel.ask("crm_lead_intake", **args)
    assert any("has only just been added" in w and "Admitted" in w for w in out["warnings"])
    mcp = json.loads(await m.execute_crm_lead_intake(dict(args), make_ctx(db=shared_db())))
    assert mcp["no_course_yet"]["count"] == 1 and mcp["confirm_token"]
    _converted_rule(monkeypatch, "BLOCK")
    for out in (await panel.ask("crm_lead_intake", **args),
                json.loads(await m.execute_crm_lead_intake(dict(args), make_ctx(db=shared_db())))):
        assert out["error"] == "course_required" and "has only just been added" in out["message"]
    # switched to BLOCK after the card was shown: refused at Confirm
    _converted_rule(monkeypatch, "OFF")
    await panel.ask("crm_lead_intake", **args)
    _converted_rule(monkeypatch, "BLOCK")
    assert (await panel.confirm())["status"] == "failed"
    assert writes(backend) == []


async def test_import_flags_or_leaves_out_rows_starting_as_converted(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _intake(backend)
    rows = [{"name": "Kiran Rao", "phone": "9000000001", "status": "CONVERTED"},
            {"name": "Asha Rao", "phone": "9000000002", "status": "INTERESTED"}]
    _converted_rule(monkeypatch, "WARN")
    panel = Panel(monkeypatch)
    out = await panel.ask("crm_lead_intake", action="import_leads", list_id="list-1", rows=rows)
    assert "Kiran Rao (******0001) · list routing · status CONVERTED (no course yet)" in out["details"]
    assert any("has only just been added" in w for w in out["warnings"])
    _converted_rule(monkeypatch, "BLOCK")
    shown = json.loads(await m.execute_crm_lead_intake(
        dict(action="import_leads", list_id="list-1", rows=rows), make_ctx(db=shared_db())))
    assert shown["will_add"] == 1 and [r["row"] for r in shown["rows"]] == [1]
    assert shown["dropped"][0]["row"] == 0 and "has only just been added" in shown["dropped"][0]["reason"]
    blocked = json.loads(await m.execute_crm_lead_intake(
        dict(action="import_leads", list_id="list-1", rows=rows[:1]), make_ctx(db=shared_db())))
    assert blocked["error"] == "nothing_to_import"


# ── the card's state: cancel, a broken run, expiry ───────────────────────

async def test_a_run_that_breaks_off_leaves_the_card_open(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    spec = reg.ASSISTANT_TOOLS["crm_lead_edit"]

    async def broken(args, ctx):
        raise RuntimeError("connection reset")

    monkeypatch.setitem(reg.ASSISTANT_TOOLS, "crm_lead_edit", dataclasses.replace(spec, executor=broken))
    out = await panel.confirm()
    assert out["status"] == "pending" and "may or may not have been made" in out["message"]
    assert "Nothing was modified" not in out["message"] and panel.card().meta_data["status"] == "PENDING"
    monkeypatch.setitem(reg.ASSISTANT_TOOLS, "crm_lead_edit", spec)
    assert (await panel.confirm())["status"] == "executed"
    assert len(backend.admin_core.called(STATUS_ONE, "POST")) == 1


async def test_cancel_never_overrides_a_confirm(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_activity", action="add_note", lead_id="r-1", note="Asked about fees")
    card = panel.card()
    seen = (card.id, card.content, dict(card.meta_data))       # Cancel read the card while it was PENDING
    assert (await panel.confirm())["status"] == "executed"
    panel.service._load_pending_action = lambda db, sid, nonce: (seen[0], seen[1], dict(seen[2]))
    out = await panel.service.cancel_action("s-1", panel.principal, card.meta_data["nonce"])
    assert out["status"] != "cancelled" and card.meta_data["status"] == "EXECUTED"
    assert not any("cancelled" in said for said in panel.said())
    # while a Confirm is running, Cancel says so
    await panel.ask("crm_lead_activity", action="add_note", lead_id="r-1", note="Second note")
    running = panel.card()
    running.meta_data["status"] = "EXECUTING"
    panel.service._load_pending_action = lambda db, sid, nonce: (running.id, running.content, dict(running.meta_data))
    out = await panel.service.cancel_action("s-1", panel.principal, running.meta_data["nonce"])
    assert out["status"] == "executing" and "already being applied" in out["message"]


async def test_an_expiry_never_overrides_a_confirm(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_activity", action="add_note", lead_id="r-1", note="Asked about fees")
    card = panel.card()
    stale = dict(card.meta_data, expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    assert (await panel.confirm())["status"] == "executed"
    panel.service._load_pending_action = lambda db, sid, nonce: (card.id, card.content, dict(stale))
    out = await panel.confirm()
    assert out["status"] != "expired" and card.meta_data["status"] == "EXECUTED"


# ── CRM writes run off the event loop ────────────────────────────────────

async def test_crm_cards_run_on_a_worker_thread(backend, monkeypatch):
    import threading
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    seen = []
    real = reg.performer_for

    def recording(tool):
        inner = real(tool)

        async def perform(args, ctx):
            seen.append((tool, threading.get_ident()))
            return await inner(args, ctx)
        return perform

    monkeypatch.setattr(reg, "performer_for", recording)
    assert (await panel.confirm())["status"] == "executed"
    assert seen and seen[0][1] != threading.get_ident()
    # proposing runs there too, as the CRM reads do
    calls = []

    async def fake_execute(name, args, ctx, setting, *, in_product=False):
        calls.append(threading.get_ident())
        return json.dumps({"ok": True})

    monkeypatch.setattr(asv, "execute_tool", fake_execute)
    await panel.service._dispatch_tool("crm_lead_edit", {}, panel.principal, (), "jwt", "s-1", SETTING)
    await panel.service._dispatch_tool("search_help_knowledge", {}, panel.principal, (), "jwt", "s-1", SETTING)
    assert calls[0] != threading.get_ident() and calls[1] == threading.get_ident()


# ── outbound actions are refused ─────────────────────────────────────────

async def test_actions_that_contact_a_lead_are_refused(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    every = {"enabled_tools": [reg.ASSISTANT_TOOLS[n].key() for n in CARD_WRITES + OUTBOUND], "role_overrides": {}}
    panel = Panel(monkeypatch, setting=every)
    out = await panel.ask("crm_meetings_edit", action="book", lead_id="r-1", start_time="2030-01-01T10:00:00+05:30")
    assert out["error"] == "action_not_available" and "invite" in out["message"]
    for name in OUTBOUND:
        out = await panel.ask(name, action="send")
        assert out["error"] == "tool_not_available", name
    assert panel.cards() == [] and backend.admin_core.calls == []
    # a card for book can never run either (e.g. a stored row edited by hand)
    res = await reg.performer_for("crm_meetings_edit")({"args": {"action": "book"}, "token": "x"},
                                                       make_ctx(via_mcp=False))
    assert res["ok"] is False and backend.admin_core.calls == []
    offered = names(reg.build_offered_tools(principal(), every, topics={"crm"}, entitlements=LEGACY))
    assert set(CARD_WRITES) <= offered and not offered & set(OUTBOUND)
    edit = next(s for s in reg.build_offered_tools(principal(), every, topics={"crm"}) if
                s["function"]["name"] == "crm_meetings_edit")
    assert edit["function"]["parameters"]["properties"]["action"]["enum"] == ["log_outcome"]


# ── settings: off by default, opt-in ─────────────────────────────────────

@pytest.mark.parametrize("roles", [["ADMIN"], ["COUNSELLOR"], ["Counsellor"], ["TEACHER"]])
def test_crm_writes_are_off_without_a_saved_setting(roles):
    p = principal(roles=roles)
    for name in CARD_WRITES:
        assert not reg.is_tool_allowed(name, p, None), (name, roles)
    assert not names(reg.build_offered_tools(p, None, topics={"crm"})) & set(CARD_WRITES)


def test_an_admin_switches_each_group_on_for_a_role():
    granted = {"enabled_tools": [], "role_overrides": {"COUNSELLOR": {"enabled_tools": ["crm_lead_activity"]}}}
    counsellor, admin = principal(roles=["COUNSELLOR"]), principal(roles=["ADMIN"])
    assert reg.is_tool_allowed("crm_lead_activity", counsellor, granted)
    assert not reg.is_tool_allowed("crm_lead_edit", counsellor, granted)
    assert not reg.is_tool_allowed("crm_lead_activity", admin, granted)


def test_opt_in_comes_from_the_registry_and_covers_every_mcp_opt_in_change():
    from app.mcp import adapter
    for spec in reg.ASSISTANT_TOOLS.values():
        if spec.mcp_only:
            continue
        if spec.mode == "WRITE" and spec.key(via_mcp=True) in MCP_OPT_IN_GROUPS:
            assert spec.opt_in, spec.name
        if spec.opt_in and spec.key(via_mcp=True) == spec.key():
            # the same group on both doors: it starts off in the assistant as it does over MCP
            assert not spec.default_enabled and not spec.default_roles, spec.name
    for entry in adapter.assistant_catalog():
        specs = [s for s in reg.ASSISTANT_TOOLS.values() if not s.mcp_only and s.key() == entry["key"]]
        assert entry["opt_in"] is any(s.opt_in for s in specs), entry["key"]
    assert {reg.ASSISTANT_TOOLS[n].key() for n in CARD_WRITES} == set(WRITE_GROUPS) <= MCP_OPT_IN_GROUPS


def test_the_crm_change_groups_sit_in_their_crm_areas_on_ai_access():
    from app.mcp import adapter
    from app.services.entitlements import MODE_MANAGED, Entitlements
    catalog = {e["key"]: e for e in adapter.assistant_catalog()}
    areas = {"crm_lead_activity": "crm_leads", "crm_lead_edits": "crm_leads", "crm_team_edits": "crm_leads",
             "crm_lead_intake": "crm_leads", "crm_lead_merges": "crm_leads", "crm_meeting_edits": "crm_meetings"}
    for key, area in areas.items():
        entry = catalog[key]
        assert (entry["area"], entry["level"], entry["mode"]) == (area, "edit", "WRITE"), key
        assert entry["opt_in"] is True and entry["default_enabled"] is False and entry["default_roles"] == [], key
        assert entry["label"] == reg.GROUP_LABELS[key] and entry["module_feature"] == "crm.leads", key
    planned = {e["key"]: e["entitled"] for e in adapter.assistant_catalog(entitlements=LEGACY)}
    unplanned = {e["key"]: e["entitled"] for e in adapter.assistant_catalog(
        entitlements=Entitlements(mode=MODE_MANAGED, rows={}))}
    assert all(planned[k] for k in areas) and not any(unplanned[k] for k in areas)
    # the screen's default (never-saved) setting leaves them off for every role
    default = adapter.assistant_default_setting()
    granted = set(default["enabled_tools"]) | {t for r in default["role_overrides"].values() for t in r["enabled_tools"]}
    assert not granted & set(areas)


@pytest.mark.parametrize("roles", [["ADMIN"], ["Admin"], ["admin "]])
def test_admins_keep_the_assistant_edits_they_had_by_default(roles):
    p = principal(roles=roles)
    assert reg.is_tool_allowed("manage_enrollment", p, None) and reg.is_tool_allowed("send_announcement", p, None)
    assert not any(reg.is_tool_allowed(n, p, None) for n in CARD_WRITES)


@pytest.mark.parametrize("saved_role", ["COUNSELLOR", "Counsellor", "counsellor", " COUNSELLOR "])
def test_a_role_list_turns_a_crm_change_group_on_in_any_spelling(saved_role):
    granted = {"enabled_tools": [], "role_overrides": {saved_role: {"enabled_tools": ["crm_lead_activity"]}}}
    assert reg.is_tool_allowed("crm_lead_activity", principal(roles=["Counsellor"]), granted)
    assert not reg.is_tool_allowed("crm_lead_edit", principal(roles=["Counsellor"]), granted)


async def test_a_group_switched_off_refuses_the_call_and_the_card(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    panel.setting = {"enabled_tools": ["crm_leads"], "role_overrides": {}}
    out = await panel.confirm()
    assert out["status"] == "denied" and writes(backend) == []
    out = await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    assert out["error"] == "tool_not_permitted" and "AI access" in out["message"]


async def test_a_plan_without_the_crm_module_refuses_the_card(backend, monkeypatch):
    from app.services.entitlements import MODE_MANAGED, Entitlements
    backend.lead_scope("ADMIN")
    panel = Panel(monkeypatch)
    await panel.ask("crm_lead_edit", action="set_status", lead_id="r-1", status="Interested")
    monkeypatch.setattr(reg, "load_entitlements", lambda db, inst: Entitlements(mode=MODE_MANAGED, rows={}))
    out = await panel.confirm()
    assert out["status"] == "failed" and "plan" in out["message"] and writes(backend) == []


# ── offered by page ──────────────────────────────────────────────────────

def test_the_writes_are_offered_on_crm_pages_and_after_crm_use():
    p = principal(roles=["COUNSELLOR"])
    off_page = names(reg.build_offered_tools(p, SETTING, topics=reg.topics_for_route("/study-library/courses")))
    assert not off_page & set(CARD_WRITES) and "load_tools" in off_page
    on_page = names(reg.build_offered_tools(p, SETTING, topics=reg.topics_for_route(LEADS_PAGE)))
    assert set(CARD_WRITES) <= on_page and "load_tools" not in on_page
    used = asv.conversation_topics("/dashboard", [{"tool_name": "crm_lead_edit"}])
    assert set(CARD_WRITES) <= names(reg.build_offered_tools(p, SETTING, topics=used))
    _result, loaded = asv.load_topic({"topic": "crm"}, reg.in_product_specs(p, SETTING))
    assert loaded == "crm"
    # a caller whose settings leave them off never gets them, on any page
    reads_only = {"enabled_tools": ["crm_leads"], "role_overrides": {}}
    assert not names(reg.build_offered_tools(p, reads_only, topics={"crm"})) & set(CARD_WRITES)


def test_the_prompt_tells_the_model_how_the_card_works():
    svc = asv.AssistantAgentService(lambda: nullcontext(None))
    p = principal(roles=["ADMIN"])
    prompt = svc._build_system_prompt(p, SETTING, entitlements=LEGACY, active_topics={"crm"})
    assert "only PROPOSES" in prompt and "`crm_lead_edit`" in prompt and "only READ CRM data" not in prompt
    assert "booking meetings" in prompt and "not available in this assistant" in prompt
    for name in CARD_WRITES:
        assert "confirm_token" not in reg.ASSISTANT_TOOLS[name].schema["function"]["parameters"]["properties"]


# ── MCP is unchanged ─────────────────────────────────────────────────────

async def test_mcp_keeps_its_two_step_and_direct_writes(backend):
    backend.lead_scope("ADMIN")
    ctx = make_ctx()
    ctx.client_id = "client-1"
    shown = json.loads(await reg.execute_tool("crm_lead_edit", {"action": "set_status", "lead_id": "r-1",
                                                                "status": "Interested"}, ctx, SETTING))
    assert shown["confirm_token"] and cd.CARD_TOKEN_KEY not in shown and "next" in shown
    assert ctx.pending_action is None and writes(backend) == []
    note = json.loads(await reg.execute_tool("crm_lead_activity", {"action": "add_note", "lead_id": "r-1",
                                                                   "note": "hi"}, make_ctx(), SETTING))
    assert note["done"] is True and len(backend.admin_core.called(TIMELINE, "POST")) == 1
    for name in CARD_WRITES:
        spec = reg.ASSISTANT_TOOLS[name]
        assert "confirm_token" in spec.schema_for(via_mcp=True)["function"]["parameters"]["properties"], name


# ── every action renders a card ──────────────────────────────────────────

def test_every_card_action_has_readable_text_even_for_a_sparse_preview():
    actions = {"crm_lead_activity": m.ACTIVITY_ACTIONS, "crm_lead_edit": m.EDIT_ACTIONS,
               "crm_lead_merge": m.MERGE_ACTIONS, "crm_lead_intake": m.INTAKE_ACTIONS,
               "crm_team_edit": ("assign_leads", "reassign_from_counsellor", "pause_routing", "resume_routing"),
               "crm_meetings_edit": ("log_outcome",)}
    for tool, acts in actions.items():
        for action in acts:
            card = crm_cards.build_card(tool, action, {})
            assert card["title"] and "Confirm this CRM change" not in card["title"], (tool, action)
            assert all(isinstance(x, str) for x in card["details"] + card["warnings"])


def test_team_and_intake_cards_name_who_and_how_many():
    assign = crm_cards.build_card("crm_team_edit", "assign_leads", {
        "preview": "2 people (3 leads) get a new owner (1 counsellor).", "people": 2,
        "changes": [{"name": "Priya Sharma", "phone": "******3210", "list": "NEET 2027", "from": None,
                     "to": {"counsellor_id": "c-2", "name": "Asha"}}],
        "automations": {"event": "LEAD_ASSIGNED_TO_COUNSELOR", "runs_per_lead": [{"name": "Welcome"}],
                        "warning": "Some of these automations contact the lead (WhatsApp / email / call) for every "
                                   "lead assigned."},
        "skipped": {"count": 1, "by_reason": {"opted_out": 1}}})
    assert assign["title"].startswith("2 people")
    assert assign["details"][0] == "Priya Sharma (******3210) · NEET 2027: unassigned → Asha"
    assert any("contact the lead" in w for w in assign["warnings"])
    assert any("1 lead left as they are" in w for w in assign["warnings"])
    intake = crm_cards.build_card("crm_lead_intake", "add_lead", {
        "list": {"list_id": "list-1", "name": "NEET 2027"}, "source": "WALK_IN",
        "lead": {"name": "Kiran Rao", "phone": "+919876500000", "email": None}, "owner": "routing",
        "similar_name_leads": [{"name": "Kiran Rao", "phone": "******1234", "list": "JEE"}],
        "automations": [{"name": "Welcome WA", "contacts_people": True, "channels": ["whatsapp"]}]})
    assert intake["title"] == "Add lead Kiran Rao to NEET 2027"
    assert any("Similar names" in w for w in intake["warnings"])
    assert any("contact people" in w for w in intake["warnings"])


# ── Postgres: the card's atomic claim and single-use tokens ──────────────

@pytest.fixture
def pg_db():
    url = os.environ.get("AI_LIMITS_PG_URL")
    if not url:
        pytest.skip("set AI_LIMITS_PG_URL to run on a throwaway Postgres")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.models.crm_confirm import CrmConfirm

    schema = "crm_cards_" + uuid.uuid4().hex[:12]
    admin = create_engine(url)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE SCHEMA {schema}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    assert engine.dialect.driver == "psycopg"
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE chat_messages (id BIGSERIAL PRIMARY KEY, metadata JSONB)")
    CrmConfirm.__table__.create(bind=engine)
    db = Session(bind=engine, future=True)
    try:
        yield db
    finally:
        db.close()
        engine.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        admin.dispose()


def test_the_claim_lets_one_confirm_through_on_postgres(pg_db):
    from sqlalchemy import text
    meta = {"nonce": "n-1", "status": "PENDING", "tool": "crm_lead_edit"}
    row_id = pg_db.execute(text("INSERT INTO chat_messages (metadata) VALUES (CAST(:m AS jsonb)) RETURNING id"),
                           {"m": json.dumps(meta)}).scalar()
    pg_db.commit()
    move = asv.AssistantAgentService._move_pending_action
    assert move(pg_db, row_id, {**meta, "status": "EXECUTING"}, "PENDING") is True
    assert move(pg_db, row_id, {**meta, "status": "EXECUTING"}, "PENDING") is False     # a second Confirm
    assert move(pg_db, row_id, {**meta, "status": "CANCELLED"}, "PENDING") is False     # a late Cancel
    stored = pg_db.execute(text("SELECT metadata FROM chat_messages WHERE id = :id"), {"id": row_id}).scalar()
    assert stored["status"] == "EXECUTING" and stored["nonce"] == "n-1"
    assert move(pg_db, row_id, {**meta, "status": "EXECUTED"}, "EXECUTING") is True


async def test_a_bulk_card_spends_its_token_once_on_postgres(backend, monkeypatch, pg_db):
    backend.lead_scope("ADMIN")
    _two_people(backend)
    panel = Panel(monkeypatch, db=pg_db)
    await panel.ask("crm_lead_edit", action="set_status", lead_ids=["r-1", "r-3"], status="INTERESTED")
    first = panel.card()
    assert (await panel.confirm())["status"] == "executed"
    copy = SimpleNamespace(**{**first.__dict__, "id": len(panel.store) + 1,
                              "meta_data": {**first.meta_data, "status": "PENDING", "nonce": str(uuid.uuid4())}})
    panel.store.append(copy)
    assert (await panel.confirm(copy))["status"] == "failed"
    assert len(backend.admin_core.called(STATUS_BULK)) == 1
    from app.models.crm_confirm import CrmConfirm
    rows = pg_db.query(CrmConfirm).all()
    assert len(rows) == 1 and rows[0].spent_at is not None and rows[0].outcome == "done"
