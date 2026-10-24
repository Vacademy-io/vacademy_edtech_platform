"""
crm_team_edit — assigning and reassigning leads, pausing / resuming routing.

Pinned here: only admins and managers (for counsellors in their own team) get
through; every lead is in the institute AND the caller's scope and every
counsellor in the dashboard's rosters; previews call only the workbench
/preview endpoints; the apply sends exactly the previewed people / profile ids
(round robin as explicit targets, never an empty or whole list); single-use
tokens refuse mismatch, replay and expiry and count towards the hourly cap;
pause / resume tokens are signed over the pool statuses; phones are masked.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

# The registry first, as the app loads it: it imports every feature tool module itself.
import app.services.assistant_tool_registry  # noqa: E402,F401
from app.models.crm_confirm import CrmConfirm  # noqa: E402
from app.services import assistant_tools_crm_team as team  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import learner_data as ld  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS  # noqa: E402
from crm_fakes import CrmBackend, confirm_db, lead_row, make_ctx  # noqa: E402

ROSTER = {"c-1": "Asha Rao", "c-2": "Bala K", "c-3": "Chitra M", "mgr-1": "Meera Manager"}


@pytest.fixture
def backend(monkeypatch):
    b = CrmBackend().install(monkeypatch)
    b.lead_scope("ADMIN")
    b.counsellors(ROSTER)
    b.admin_core.on("POST", team.ASSIGN_PATH, _assign_echo)
    b.admin_core.on("POST", team.ASSIGN_PREVIEW_PATH, _assign_echo)       # later routes win: preview first
    b.admin_core.on("POST", team.REASSIGN_PATH, _reassign_echo)
    b.admin_core.on("POST", team.REASSIGN_PREVIEW_PATH, _reassign_echo)
    b.admin_core.on("PATCH", team.WORKBENCH + "/counsellors/", _status_echo)
    return b


def _assign_echo(method, path, params, body):
    mode, uids = body["mode"], body["user_ids"]
    if mode == "SINGLE":
        plan = [(u, body["target_user_id"]) for u in uids]
    elif mode == "ROUND_ROBIN":
        cands = sorted(body["candidate_user_ids"])
        plan = [(u, cands[i % len(cands)]) for i, u in enumerate(uids)]
    elif mode == "MANUAL":
        plan = [(a["user_id"], a["to_user_id"]) for a in body["assignments"]]
    else:
        plan = [(u, None) for u in uids]
    return {"dry_run": path.endswith("/preview"), "total_leads": len(plan),
            "assignments": [{"user_id": u, "to_user_id": t, "to_user_name": None} for u, t in plan]}


def _reassign_echo(method, path, params, body):
    ids = body.get("lead_ids") or []
    if body["mode"] == "MANUAL":
        plan = [(a["lead_id"], a["to_user_id"]) for a in body["assignments"]]
    elif body["mode"] == "SINGLE":
        plan = [(i, body["target_user_id"]) for i in ids]
    else:
        plan = [(i, ("c-2", "c-3")[n % 2]) for n, i in enumerate(ids)]
    dry = path.endswith("/preview")
    return {"dry_run": dry, "total_leads": len(plan), "marked_inactive": bool(body.get("mark_inactive")) and not dry,
            "assignments": [{"lead_id": i, "lead_name": None, "from_user_id": body["from_user_id"], "to_user_id": t,
                             "to_user_name": None} for i, t in plan]}


def _status_echo(method, path, params, body):
    return {"user_id": path.split("/")[-2], "status": body["status"], "pools_affected": 2,
            "open_leads": [{"lead_name": "Someone", "phone": "+919999999999"}]}


def _writes(backend):
    """Admin-core calls that change data (anything but GET and the /preview dry runs)."""
    return [c for c in backend.admin_core.calls if c["method"] != "GET" and not c["path"].endswith("/preview")]


def _leads(backend, rows):
    by_id = {r["lead_id"]: r for r in rows}
    backend.sql.on("ar.id = ANY(:lids)", lambda params, sql: [by_id[i] for i in params["lids"] if i in by_id])


def _profile(pid, uid, lead_id, *, in_scope=True, opted_out=False, enquiry_owner=None, phone="+91 98765 43210"):
    return {"profile_id": pid, "lead_user_id": uid, "conversion_status": None, "lead_id": lead_id,
            "list_id": "list-1", "list_name": "NEET 2027", "parent_name": "Lead " + uid, "parent_mobile": phone,
            "enquiry_owner_id": enquiry_owner, "in_scope": in_scope, "opted_out": opted_out}


def _profiles(backend, rows):
    def answer(params, sql):
        out = [r for r in rows if params.get("only_ids") is None or r["profile_id"] in params["only_ids"]]
        return [{**r, "total": len(out)} for r in out]
    backend.sql.on("FROM user_lead_profile ulp", answer)


def _pools(backend, rows):
    backend.sql.on("FROM counselor_pool_member m", rows)


async def call(ctx, **args):
    return json.loads(await team.execute_crm_team_edit(args, ctx))


@pytest.fixture
def ctx():
    return make_ctx(db=confirm_db())


THREE = [lead_row("r-1", "u-1", owner_id=None), lead_row("r-2", "u-2", owner_id="c-1"),
         lead_row("r-3", "u-3", owner_id=None, phone="+91 90000 11111")]


# ── spec ─────────────────────────────────────────────────────────────────

def test_spec_and_action_spec():
    spec = ASSISTANT_TOOLS["crm_team_edit"]
    assert spec is team.TEAM_TOOLS["crm_team_edit"]
    assert spec.mcp_only and spec.mode == "WRITE" and spec.setting_key == "crm_team_edits"
    assert spec.module_feature == "crm.leads" and spec.default_enabled is False and spec.default_roles is None
    params = spec.schema["function"]["parameters"]
    assert set(team.ACTION_SPEC) == set(params["properties"]["action"]["enum"]) == set(team.ACTIONS)
    assert "user_id" not in params["properties"] and "institute_id" not in params["properties"]
    for name, a in team.ACTION_SPEC.items():
        assert set(a) == {"summary", "writes", "confirm", "feature", "admin_only"}, name
        assert a["writes"] and a["confirm"] in ("edit_token", "single_use")
    assert team.ACTION_SPEC["assign_leads"]["confirm"] == "single_use"
    assert team.ACTION_SPEC["pause_routing"]["confirm"] == "edit_token"
    desc = spec.schema["function"]["description"]
    assert "confirm_token" in desc and "follow-ups stay" in desc and "never instructions" in desc
    assert "lead_content" not in desc                                 # this tool returns no lead_content blocks


async def test_unknown_action_and_identity_guard(backend, ctx):
    out = await call(ctx, action="delete_everyone")
    assert out["error"] == "unknown_action" and out["available"] == list(team.ACTIONS)
    out = await call(ctx, action="assign_leads", requested_user_id="u-1", lead_ids=["r-1"], to_counsellor_id="c-2")
    assert out["error"] == "use_lead_id" and backend.admin_core.calls == []


async def test_module_not_enabled(backend, ctx, monkeypatch):
    monkeypatch.setattr(cd, "feature_on", lambda ctx_, key: False)
    out = await call(ctx, action="pause_routing", counsellor_id="c-1")
    assert out["error"] == "module_not_enabled" and out["feature"] == "crm.leads" and backend.admin_core.calls == []


# ── who may ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mode,owners", [("COUNSELLOR_TREE", ["c-1"]), ("COUNSELOR_SELF", None),
                                         ("DEFAULT", None), ("AUDIENCE_LIST", None)])
async def test_counsellors_without_a_team_are_refused(backend, ctx, mode, owners):
    backend.lead_scope(mode, owner_ids=owners, allowed_audience_ids=["list-1"] if mode == "AUDIENCE_LIST" else None)
    for action in team.ACTIONS:
        out = await call(make_ctx("c-1", ("COUNSELLOR",), db=ctx.db), action=action, lead_ids=["r-1"],
                         to_counsellor_id="c-2", from_counsellor_id="c-2", counsellor_id="c-2")
        assert out["error"] == "admin_only", (action, out)
    assert _writes(backend) == [] and backend.sql.calls == []


async def test_scope_unavailable(backend, ctx):
    backend.admin_core.on("GET", cd.LEAD_SCOPE_PATH, cd.err("admin_core_rejected", status=500))
    out = await call(ctx, action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-2")
    assert out["error"] == "scope_unavailable"


# ── assign_leads ─────────────────────────────────────────────────────────

async def test_assign_single_preview_then_apply(backend, ctx):
    _leads(backend, THREE + [lead_row("r-4", "u-1", owner_id=None, list_id="list-2")])
    backend.sql.on("FROM lead_followup lf JOIN", [{"created_by": "c-1", "n": 2}])
    args = dict(action="assign_leads", lead_ids=["r-1", "r-2", "r-3", "r-4"], to_counsellor_id="c-2")
    shown = await call(ctx, **args)
    assert shown["applied"] is False and shown["confirm_token"].startswith("vcc_")
    assert _writes(backend) == []                                       # the preview changed nothing
    prev = backend.admin_core.called(team.ASSIGN_PREVIEW_PATH, "POST")[0]["body"]
    assert prev == {"institute_id": "inst-1", "user_ids": ["u-1", "u-2", "u-3"], "mode": "SINGLE",
                    "target_user_id": "c-2"}
    assert shown["people"] == 3 and shown["by_counsellor"] == [{"to": {"counsellor_id": "c-2", "name": "Bala K"},
                                                               "people": 3}]
    first = shown["changes"][0]
    assert first["lead_ids"] == ["r-1", "r-4"] and first["to"]["counsellor_id"] == "c-2" and first["from"] is None
    assert shown["changes"][1]["from"] == {"counsellor_id": "c-1", "name": "Asha Rao"}
    text = json.dumps(shown)
    assert "98765 43210" not in text and "9876543210" not in text and "priya@example.com" not in text
    assert first["phone"].endswith("3210")
    assert any("Permanent" in e for e in shown["effects"]) and any("follow-ups" in e for e in shown["effects"])
    assert shown["open_followups"]["open"] == 2 and shown["open_followups"]["by_creator"][0]["created_by"]["name"] \
        == "Asha Rao"
    assert shown["automations"]["event"] == "LEAD_ASSIGNED_TO_COUNSELOR"
    assert shown["definitions"]["owner"] == cd.definition("owner")

    done = await call(ctx, **args, confirm_token=shown["confirm_token"])
    assert done["applied"] is True and done["people_assigned"] == 3
    write = _writes(backend)
    assert len(write) == 1 and write[0]["path"] == team.ASSIGN_PATH
    assert write[0]["body"] == {"institute_id": "inst-1", "user_ids": ["u-1", "u-2", "u-3"], "mode": "SINGLE",
                                "target_user_id": "c-2"}
    assert ctx.db.query(CrmConfirm).populate_existing().one().outcome == "done"


async def test_assign_round_robin_from_a_filter_sends_the_previewed_plan(backend, ctx):
    _leads(backend, THREE)
    backend.sql.on("opted_out_total", [{"id": r["lead_id"], "opted_out": False, "total": 3, "opted_out_total": 0}
                                       for r in THREE])
    args = dict(action="assign_leads", filter={"owner": "unassigned", "status_keys": ["NEW"]}, mode="round_robin",
                candidate_ids=["c-2", "c-3"])
    shown = await call(ctx, **args)
    assert shown["matched"]["matched"] == 3 and shown["mode"] == "round_robin"
    prev = backend.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"]
    assert prev["mode"] == "ROUND_ROBIN" and prev["candidate_user_ids"] == ["c-2", "c-3"]
    planned = {c["lead_user_id"]: c["to"]["counsellor_id"] for c in shown["changes"]}
    await call(ctx, **args, confirm_token=shown["confirm_token"])
    body = _writes(backend)[0]["body"]
    assert body["mode"] == "MANUAL" and {a["user_id"]: a["to_user_id"] for a in body["assignments"]} == planned
    assert sorted(body["user_ids"]) == ["u-1", "u-2", "u-3"]


async def test_round_robin_default_candidates_are_the_assignable_roster(backend, ctx):
    backend.counsellors(ROSTER, assignable={"c-2": "Bala K", "c-3": "Chitra M"})
    _leads(backend, THREE)
    await call(ctx, action="assign_leads", lead_ids=["r-1"], mode="round_robin")
    assert backend.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"]["candidate_user_ids"] == ["c-2", "c-3"]


async def test_assign_skips_opted_out_deleted_and_already_owned(backend, ctx):
    _leads(backend, THREE + [lead_row("r-5", "u-5", audience_status="DELETED"), lead_row("r-6", "u-6", owner_id="c-2"),
                             lead_row("r-7", None)])
    backend.sql.on("SELECT DISTINCT ar.user_id", [{"user_id": "u-3"}])
    shown = await call(ctx, action="assign_leads", lead_ids=["r-1", "r-3", "r-5", "r-6", "r-7"],
                       to_counsellor_id="c-2")
    assert shown["people"] == 1
    assert shown["skipped"]["by_reason"] == {"no_person_record": 1, "opted_out": 1, "deleted": 1,
                                             "already_with_that_counsellor": 1}
    assert backend.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"]["user_ids"] == ["u-1"]


async def test_assign_nothing_left_never_calls_admin_core(backend, ctx):
    _leads(backend, [lead_row("r-6", "u-6", owner_id="c-2")])
    out = await call(ctx, action="assign_leads", lead_ids=["r-6"], to_counsellor_id="c-2")
    assert out["error"] == "nothing_to_assign" and backend.admin_core.called(team.WORKBENCH) == []


async def test_assign_input_errors(backend, ctx):
    assert (await call(ctx, action="assign_leads", to_counsellor_id="c-2"))["error"] == "missing_argument"
    both = await call(ctx, action="assign_leads", lead_ids=["r-1"], filter={}, to_counsellor_id="c-2")
    assert both["error"] == "invalid_argument"
    assert (await call(ctx, action="assign_leads", lead_ids=["r-1"]))["error"] == "missing_argument"
    many = await call(ctx, action="assign_leads", lead_ids=[f"r-{i}" for i in range(501)], to_counsellor_id="c-2")
    assert many["error"] == "too_many" and many["max"] == 500
    bad = await call(ctx, action="assign_leads", filter={"colour": "red"}, to_counsellor_id="c-2")
    assert bad["error"] == "invalid_filter"
    assert _writes(backend) == []


async def test_unknown_or_foreign_ids_are_refused(backend, ctx):
    _leads(backend, THREE)                                  # r-x (another institute's lead) is not found here
    out = await call(ctx, action="assign_leads", lead_ids=["r-1", "r-x"], to_counsellor_id="c-2")
    assert out["error"] == "unknown_lead" and out["ids"] == ["r-x"]
    out = await call(ctx, action="assign_leads", lead_ids=["r-1"], to_counsellor_id="someone-elsewhere")
    assert out["error"] == "unknown_counsellor"
    out = await call(ctx, action="pause_routing", counsellor_id="someone-elsewhere")
    assert out["error"] == "unknown_counsellor"
    assert backend.admin_core.called(team.WORKBENCH) == []


async def test_no_assignable_counsellors(backend, ctx):
    backend.counsellors({}, assignable={})
    out = await call(ctx, action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-2")
    assert out["error"] == "no_assignable_counsellors"


async def test_unassign_is_admin_only(backend, ctx):
    _leads(backend, THREE)
    shown = await call(ctx, action="assign_leads", lead_ids=["r-2"], mode="unassign")
    assert shown["by_counsellor"] == [{"to": None, "people": 1}]
    assert backend.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"]["mode"] == "UNASSIGN"
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["mgr-1", "c-1", "c-2"])
    out = await call(make_ctx("mgr-1", ("COUNSELLOR",), db=ctx.db), action="assign_leads", lead_ids=["r-2"],
                     mode="unassign")
    assert out["error"] == "admin_only"


async def test_unassign_apply_sends_no_target_and_runs_no_automation(backend, ctx):
    _leads(backend, THREE)
    backend.sql.on("SELECT DISTINCT ar.user_id", [{"user_id": "u-2"}])      # opted out: still unassignable
    args = dict(action="assign_leads", lead_ids=["r-2"], mode="unassign")
    shown = await call(ctx, **args)
    assert shown["people"] == 1 and shown["skipped"] is None
    assert shown["automations"]["runs_per_lead"] == [] and "warning" not in shown["automations"]
    assert backend.sql.matching("FROM workflow_trigger") == []
    done = await call(ctx, **args, confirm_token=shown["confirm_token"])
    assert done["applied"] is True
    assert _writes(backend)[0]["body"] == {"institute_id": "inst-1", "user_ids": ["u-2"], "mode": "UNASSIGN"}


async def test_unassign_apply_rechecks_admin(backend, ctx):
    _leads(backend, THREE)
    args = dict(action="assign_leads", lead_ids=["r-2"], mode="unassign")
    tok = (await call(ctx, **args))["confirm_token"]
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["admin-1", "c-1"])     # no longer an admin, still a manager
    out = await call(make_ctx("admin-1", ("COUNSELLOR",), db=ctx.db), **args, confirm_token=tok)
    assert out["error"] == "admin_only" and _writes(backend) == []


async def test_bulk_apply_timeout_is_not_reported_as_nothing_changed(backend, ctx, monkeypatch):
    _leads(backend, THREE)
    timeouts = []
    real = cd.ac

    async def recording(ctx_, method, path, params=None, body=None, *, timeout=30.0):
        timeouts.append((path, timeout))
        return await real(ctx_, method, path, params, body, timeout=timeout)
    monkeypatch.setattr(cd, "ac", recording)
    args = dict(action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-2")
    tok = (await call(ctx, **args))["confirm_token"]
    backend.admin_core.on("POST", team.ASSIGN_PATH, cd.err("request_failed", message="no answer"))
    backend.admin_core.on("POST", team.ASSIGN_PREVIEW_PATH, _assign_echo)
    out = await call(ctx, **args, confirm_token=tok)
    assert out["error"] == "request_failed" and "may still have been applied" in out["message"]
    assert "Nothing was changed" not in out["message"]
    assert (team.ASSIGN_PATH, 180.0) in timeouts


async def test_admin_core_refusal_is_reported(backend, ctx):
    _leads(backend, THREE)
    backend.admin_core.on("POST", team.ASSIGN_PREVIEW_PATH,
                          cd.err("admin_core_rejected", status=400, message="No counsellors available"))
    out = await call(ctx, action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-2")
    assert out["error"] == "admin_core_rejected" and out["status"] == 400 and "confirm_token" not in out


# ── managers ─────────────────────────────────────────────────────────────

@pytest.fixture
def manager(backend, ctx):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["mgr-1", "c-1", "c-2"])
    return make_ctx("mgr-1", ("COUNSELLOR",), db=ctx.db)


async def test_manager_assigns_within_the_team(backend, manager):
    _leads(backend, THREE)
    shown = await call(manager, action="assign_leads", lead_ids=["r-1", "r-2"], to_counsellor_id="c-2")
    assert shown["people"] == 2 and "confirm_token" in shown


async def test_list_scoped_manager_is_a_manager(backend, ctx):
    # A list-restricted institute still hands a manager their team as owner_ids.
    backend.lead_scope("AUDIENCE_LIST", owner_ids=["mgr-1", "c-1", "c-2"], allowed_audience_ids=["list-1"])
    mgr = make_ctx("mgr-1", ("COUNSELLOR",), db=ctx.db)
    _leads(backend, THREE)
    shown = await call(mgr, action="assign_leads", lead_ids=["r-1", "r-2"], to_counsellor_id="c-2")
    assert shown["people"] == 2 and "confirm_token" in shown
    out = await call(mgr, action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-3")
    assert out["error"] == "out_of_scope"
    backend.lead_scope("AUDIENCE_LIST", owner_ids=["c-1"], allowed_audience_ids=["list-1"])   # only their own
    out = await call(make_ctx("c-1", ("COUNSELLOR",), db=ctx.db), action="assign_leads", lead_ids=["r-1"],
                     to_counsellor_id="c-2")
    assert out["error"] == "admin_only"


async def test_manager_cannot_reach_out_of_scope_leads_or_outside_counsellors(backend, manager):
    _leads(backend, THREE + [lead_row("r-9", "u-9", owner_id="c-3", in_scope=False)])
    out = await call(manager, action="assign_leads", lead_ids=["r-1", "r-9"], to_counsellor_id="c-2")
    assert out["error"] == "out_of_scope" and out["ids"] == ["r-9"]
    out = await call(manager, action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-3")
    assert out["error"] == "out_of_scope" and out["ids"] == ["c-3"]
    out = await call(manager, action="assign_leads", lead_ids=["r-1"], mode="round_robin",
                     candidate_ids=["c-2", "c-3"])
    assert out["error"] == "out_of_scope"
    out = await call(manager, action="reassign_from_counsellor", from_counsellor_id="c-3", to_counsellor_id="c-2")
    assert out["error"] == "out_of_scope"
    out = await call(manager, action="pause_routing", counsellor_id="c-3")
    assert out["error"] == "out_of_scope"
    assert backend.admin_core.called(team.WORKBENCH) == []


async def test_manager_round_robin_only_over_their_team(backend, manager):
    _leads(backend, THREE)
    await call(manager, action="assign_leads", lead_ids=["r-1"], mode="round_robin")
    assert backend.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"]["candidate_user_ids"] == \
        ["c-1", "c-2", "mgr-1"]


async def test_manager_skips_a_visible_lead_owned_outside_the_team(backend, manager):
    # Visible through the enquiry-linked counsellor, but the profile owner is someone else's.
    _leads(backend, THREE + [lead_row("r-8", "u-8", enquiry_owner_id="c-1", profile_owner_id="c-3", owner_id="c-1")])
    shown = await call(manager, action="assign_leads", lead_ids=["r-1", "r-8"], to_counsellor_id="c-2")
    assert shown["people"] == 1 and shown["skipped"]["by_reason"] == {"owned_outside_your_team": 1}


# ── single-use tokens ────────────────────────────────────────────────────

async def test_token_mismatch_replay_and_expiry(backend, ctx):
    _leads(backend, THREE)
    args = dict(action="assign_leads", lead_ids=["r-1", "r-2"], to_counsellor_id="c-2")
    tok = (await call(ctx, **args))["confirm_token"]
    other = await call(ctx, **{**args, "to_counsellor_id": "c-3"}, confirm_token=tok)
    assert other["error"] == "confirm_token_mismatch"
    reordered = await call(ctx, **{**args, "lead_ids": ["r-2", "r-1"]}, confirm_token=tok)
    assert reordered["applied"] is True                               # same request, ids in another order
    replay = await call(ctx, **args, confirm_token=tok)
    assert replay["error"] == "confirm_token_used"
    assert len(_writes(backend)) == 1
    tok2 = (await call(ctx, **args))["confirm_token"]
    ctx.db.query(CrmConfirm).filter(CrmConfirm.spent_at.is_(None)).update(
        {CrmConfirm.expires_at: datetime.now(timezone.utc) - timedelta(seconds=1)})
    ctx.db.commit()
    assert (await call(ctx, **args, confirm_token=tok2))["error"] == "confirm_token_expired"
    assert (await call(ctx, **args, confirm_token="vcc_" + "z" * 40))["error"] == "confirm_token_invalid"
    assert len(_writes(backend)) == 1


async def test_another_user_cannot_spend_the_token(backend, ctx):
    _leads(backend, THREE)
    args = dict(action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-2")
    tok = (await call(ctx, **args))["confirm_token"]
    out = await call(make_ctx("admin-2", db=ctx.db), **args, confirm_token=tok)
    assert out["error"] == "confirm_token_invalid" and _writes(backend) == []


async def test_hourly_cap(backend, ctx, monkeypatch):
    monkeypatch.setitem(cd.CAPS, team._ASSIGN_PURPOSE, 1)
    _leads(backend, THREE)
    first = dict(action="assign_leads", lead_ids=["r-1"], to_counsellor_id="c-2")
    await call(ctx, **first, confirm_token=(await call(ctx, **first))["confirm_token"])
    second = dict(action="assign_leads", lead_ids=["r-3"], to_counsellor_id="c-2")
    out = await call(ctx, **second, confirm_token=(await call(ctx, **second))["confirm_token"])
    assert out["error"] == "rate_limited" and out["cap_per_hour"] == 1 and out["retry_after_s"] > 0
    assert len(_writes(backend)) == 1


async def test_reassign_purpose_keeps_its_cap():
    # the full name is the CAPS key (mcp_crm_confirm.purpose is VARCHAR(64)): never truncated
    assert team._REASSIGN_PURPOSE == "crm.crm_team_edit.reassign_from_counsellor" == \
        cd.purpose_of("crm_team_edit", "reassign_from_counsellor")
    assert cd.cap_for(team._REASSIGN_PURPOSE) == 10


async def test_apply_rechecks_scope_and_owner_and_never_sends_an_empty_list(backend, ctx):
    rows = {r["lead_id"]: dict(r) for r in THREE}
    backend.sql.on("ar.id = ANY(:lids)", lambda params, sql: [rows[i] for i in params["lids"] if i in rows])
    args = dict(action="assign_leads", lead_ids=["r-1", "r-2", "r-3"], to_counsellor_id="c-2")
    tok = (await call(ctx, **args))["confirm_token"]
    rows["r-1"]["in_scope"] = False                       # left the caller's scope
    rows["r-2"]["profile_owner_id"] = "c-3"               # someone else assigned it meanwhile
    done = await call(ctx, **args, confirm_token=tok)
    assert _writes(backend)[0]["body"]["user_ids"] == ["u-3"]
    assert done["skipped"]["by_reason"] == {"no_longer_in_scope": 1, "owner_changed_since_preview": 1}

    tok = (await call(ctx, **dict(args, lead_ids=["r-3"])))["confirm_token"]
    rows["r-3"]["in_scope"] = False
    out = await call(ctx, **dict(args, lead_ids=["r-3"]), confirm_token=tok)
    assert out["error"] == "nothing_to_apply" and len(_writes(backend)) == 1


# ── reassign_from_counsellor ─────────────────────────────────────────────

PROFILES = [_profile("p-1", "u-1", "r-1"), _profile("p-2", "u-2", "r-2", enquiry_owner="c-1"),
            _profile("p-3", "u-3", "r-3", opted_out=True)]


async def test_reassign_single_with_mark_inactive(backend, ctx):
    _profiles(backend, PROFILES)
    _pools(backend, [{"member_id": "m-1", "pool_id": "pool-1", "pool_name": "NEET", "status": "ACTIVE",
                      "audience_id": "list-1", "others_active": 2, "open_leads": 3}])
    args = dict(action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2",
                mark_inactive=True)
    shown = await call(ctx, **args)
    assert _writes(backend) == []
    prev = backend.admin_core.called(team.REASSIGN_PREVIEW_PATH)[0]["body"]
    assert prev == {"institute_id": "inst-1", "from_user_id": "c-1", "mode": "SINGLE", "lead_ids": ["p-1", "p-2"],
                    "mark_inactive": True, "target_user_id": "c-2"}
    assert shown["leads"] == 2 and shown["skipped"]["by_reason"] == {"opted_out": 1}
    assert shown["pools"][0]["from"] == "ACTIVE" and shown["pools"][0]["to"] == "INACTIVE"
    assert any("LOST" in e for e in shown["effects"]) and any("follow-ups" in e.lower() for e in shown["effects"])
    assert "98765 43210" not in json.dumps(shown)
    assert shown["still_shown_with_enquiry_counsellor"]["leads"] == 1
    assert "open_lead" in shown["definitions"]

    done = await call(ctx, **args, confirm_token=shown["confirm_token"])
    write = _writes(backend)
    assert len(write) == 1 and write[0]["path"] == team.REASSIGN_PATH
    assert write[0]["body"] == {"institute_id": "inst-1", "from_user_id": "c-1", "lead_ids": ["p-1", "p-2"],
                                "mark_inactive": True, "mode": "SINGLE", "target_user_id": "c-2"}
    assert done["leads_moved"] == 2 and done["routing_stopped"] is True


async def test_reassign_round_robin_applies_the_previewed_targets(backend, ctx):
    _profiles(backend, PROFILES[:2])
    args = dict(action="reassign_from_counsellor", from_counsellor_id="c-1", mode="round_robin")
    shown = await call(ctx, **args)
    assert {c["to"]["counsellor_id"] for c in shown["changes"]} == {"c-2", "c-3"}
    await call(ctx, **args, confirm_token=shown["confirm_token"])
    body = _writes(backend)[0]["body"]
    assert body["mode"] == "MANUAL" and body["lead_ids"] == ["p-1", "p-2"]
    assert body["assignments"] == [{"lead_id": "p-1", "to_user_id": "c-2"}, {"lead_id": "p-2", "to_user_id": "c-3"}]


async def test_reassign_only_listed_leads(backend, ctx):
    _profiles(backend, PROFILES[:2])
    _leads(backend, [lead_row("r-1", "u-1", owner_id="c-1", profile_id="p-1"),
                     lead_row("r-5", "u-5", owner_id="c-2", profile_id="p-5")])
    out = await call(ctx, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2",
                     lead_ids=["r-1", "r-5"])
    assert out["error"] == "not_their_open_lead" and out["ids"] == ["r-5"]
    shown = await call(ctx, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2",
                       lead_ids=["r-1"])
    assert shown["leads"] == 1
    assert backend.sql.matching("FROM user_lead_profile ulp")[-1][1]["only_ids"] == ["p-1"]
    assert backend.admin_core.called(team.REASSIGN_PREVIEW_PATH)[-1]["body"]["lead_ids"] == ["p-1"]


async def test_reassign_with_nothing_to_move_pauses_instead_of_sweeping(backend, ctx):
    _profiles(backend, [])
    _pools(backend, [{"member_id": "m-1", "pool_id": "pool-1", "pool_name": "NEET", "status": "ACTIVE",
                      "audience_id": "list-1", "others_active": 0, "open_leads": 0}])
    args = dict(action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2",
                mark_inactive=True)
    shown = await call(ctx, **args)
    assert shown["leads"] == 0 and backend.admin_core.called(team.REASSIGN_PREVIEW_PATH) == []
    done = await call(ctx, **args, confirm_token=shown["confirm_token"])
    write = _writes(backend)
    assert [w["method"] for w in write] == ["PATCH"] and write[0]["body"] == {"institute_id": "inst-1",
                                                                              "status": "INACTIVE"}
    assert done["leads_moved"] == 0 and not [c for c in backend.admin_core.calls if c["path"] == team.REASSIGN_PATH]
    out = await call(ctx, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2")
    assert out["error"] == "nothing_to_move"


async def test_reassign_apply_with_every_lead_gone_pauses_only_where_there_are_pools(backend, ctx):
    rows = list(PROFILES[:1])
    _profiles(backend, rows)
    pools = [{"member_id": "m-1", "pool_id": "pool-1", "pool_name": "NEET", "status": "ACTIVE",
              "audience_id": "list-1", "others_active": 1, "open_leads": 1, "updated_at": "t1"}]
    backend.sql.on("FROM counselor_pool_member m", lambda params, sql: pools)
    args = dict(action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2",
                mark_inactive=True)
    tok = (await call(ctx, **args))["confirm_token"]
    rows.clear()                                                    # every lead left them meanwhile
    pools.clear()                                                   # and they were taken out of the pool
    out = await call(ctx, **args, confirm_token=tok)
    assert out["error"] == "nothing_to_apply" and "no lead pool" in out["message"] and _writes(backend) == []

    rows.append(PROFILES[0])
    pools.append({"member_id": "m-1", "pool_id": "pool-1", "pool_name": "NEET", "status": "INACTIVE",
                  "audience_id": "list-1", "others_active": 1, "open_leads": 1, "updated_at": "t2"})
    tok = (await call(ctx, **args))["confirm_token"]
    rows.clear()
    done = await call(ctx, **args, confirm_token=tok)
    assert done["applied"] and done["routing_stopped"] is True and done["routing"]["already_paused"] is True
    assert _writes(backend) == []                                   # already paused: nothing to send


async def test_reassign_reports_routing_already_paused(backend, ctx):
    _profiles(backend, PROFILES[:1])
    _pools(backend, [{"member_id": "m-1", "pool_id": "pool-1", "pool_name": "NEET", "status": "INACTIVE",
                      "audience_id": "list-1", "others_active": 1, "open_leads": 1, "updated_at": "t1"}])
    args = dict(action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2",
                mark_inactive=True)
    backend.admin_core.on("POST", team.REASSIGN_PATH,
                          lambda m, p, params, body: {**_reassign_echo(m, p, params, body), "marked_inactive": False})
    backend.admin_core.on("POST", team.REASSIGN_PREVIEW_PATH, _reassign_echo)
    shown = await call(ctx, **args)
    done = await call(ctx, **args, confirm_token=shown["confirm_token"])
    assert done["leads_moved"] == 1 and done["routing_stopped"] is True and "already paused" in done["routing_note"]


async def test_reassign_input_errors(backend, ctx):
    assert (await call(ctx, action="reassign_from_counsellor", to_counsellor_id="c-2"))["error"] == "missing_argument"
    same = await call(ctx, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-1")
    assert same["error"] == "invalid_argument"
    _profiles(backend, [])
    out = await call(ctx, action="reassign_from_counsellor", from_counsellor_id="ghost", to_counsellor_id="c-2")
    assert out["error"] == "unknown_counsellor"
    assert _writes(backend) == []


async def test_reassign_apply_drops_leads_that_moved_meanwhile(backend, ctx):
    rows = list(PROFILES[:2])
    _profiles(backend, rows)
    args = dict(action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2")
    tok = (await call(ctx, **args))["confirm_token"]
    rows.pop(0)                                                     # p-1 is no longer theirs
    done = await call(ctx, **args, confirm_token=tok)
    assert _writes(backend)[0]["body"]["lead_ids"] == ["p-2"]
    assert done["skipped"]["by_reason"] == {"no_longer_their_open_lead": 1}


async def test_manager_reassigns_within_team(backend, manager):
    _profiles(backend, PROFILES[:1])
    shown = await call(manager, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2")
    assert shown["leads"] == 1
    out = await call(manager, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-3")
    assert out["error"] == "out_of_scope"


async def test_reassign_drops_out_of_scope_profiles_for_managers(backend, manager):
    _profiles(backend, [_profile("p-1", "u-1", "r-1"), _profile("p-4", "u-4", "r-4", in_scope=False)])
    shown = await call(manager, action="reassign_from_counsellor", from_counsellor_id="c-1", to_counsellor_id="c-2")
    assert shown["leads"] == 1 and shown["skipped"]["by_reason"] == {"outside_your_lead_scope": 1}


# ── pause / resume routing ───────────────────────────────────────────────

POOLS = [{"member_id": "m-1", "pool_id": "pool-1", "pool_name": "NEET", "status": "ACTIVE", "audience_id": "list-1",
          "others_active": 2, "open_leads": 7},
         {"member_id": "m-2", "pool_id": "pool-2", "pool_name": "JEE", "status": "ACTIVE", "audience_id": "list-2",
          "others_active": 0, "open_leads": 7}]


async def test_pause_routing_preview_then_apply(backend, ctx):
    _pools(backend, POOLS)
    shown = await call(ctx, action="pause_routing", counsellor_id="c-1")
    assert shown["applied"] is False and _writes(backend) == []
    assert shown["counsellor"] == {"counsellor_id": "c-1", "name": "Asha Rao"} and shown["open_leads"] == 7
    assert [p["to"] for p in shown["pools"]] == ["INACTIVE", "INACTIVE"]
    assert any("JEE" in e for e in shown["effects"]) and any("No lead moves" in e for e in shown["effects"])
    done = await call(ctx, action="pause_routing", counsellor_id="c-1", confirm_token=shown["confirm_token"])
    write = _writes(backend)
    assert len(write) == 1 and write[0]["method"] == "PATCH"
    assert write[0]["path"] == team.WORKBENCH + "/counsellors/c-1/status"
    assert write[0]["body"] == {"institute_id": "inst-1", "status": "INACTIVE"}
    assert done["applied"] and done["status"] == "INACTIVE" and done["pools_affected"] == 2
    assert "open_leads" not in json.dumps(done["status"]) and "+919999999999" not in json.dumps(done)


async def test_routing_token_is_bound_to_the_pool_statuses(backend, ctx):
    pools = [dict(p) for p in POOLS]
    backend.sql.on("FROM counselor_pool_member m", lambda params, sql: pools)
    tok = (await call(ctx, action="pause_routing", counsellor_id="c-1"))["confirm_token"]
    pools[1]["status"] = "INACTIVE"                                  # changed in the dashboard meanwhile
    out = await call(ctx, action="pause_routing", counsellor_id="c-1", confirm_token=tok)
    assert out["error"] == "confirm_token_mismatch" and _writes(backend) == []
    assert (await call(ctx, action="pause_routing", counsellor_id="c-2", confirm_token=tok))["error"] \
        == "confirm_token_mismatch"


async def test_routing_token_cannot_be_replayed_after_a_pause_and_resume(backend, ctx):
    pools = [dict(p, updated_at="2026-10-15 09:00:00") for p in POOLS]
    backend.sql.on("FROM counselor_pool_member m", lambda params, sql: pools)

    def flip(method, path, params, body):
        for n, p in enumerate(pools):
            p.update(status=body["status"], updated_at=f"2026-10-15 10:{len(backend.admin_core.calls):02d}:{n:02d}")
        return _status_echo(method, path, params, body)
    backend.admin_core.on("PATCH", team.WORKBENCH + "/counsellors/", flip)
    first = (await call(ctx, action="pause_routing", counsellor_id="c-1"))["confirm_token"]
    assert (await call(ctx, action="pause_routing", counsellor_id="c-1", confirm_token=first))["applied"]
    tok = (await call(ctx, action="resume_routing", counsellor_id="c-1"))["confirm_token"]
    assert (await call(ctx, action="resume_routing", counsellor_id="c-1", confirm_token=tok))["applied"]
    assert {p["status"] for p in pools} == {"ACTIVE"}                # statuses match the first preview again
    out = await call(ctx, action="pause_routing", counsellor_id="c-1", confirm_token=first)
    assert out["error"] == "confirm_token_mismatch" and len(_writes(backend)) == 2


async def test_pool_sql_counts_other_counsellors_not_rows():
    assert "COUNT(DISTINCT o.counselor_user_id)" in team._POOLS_SQL and "m.updated_at" in team._POOLS_SQL


async def test_routing_token_expires(backend, ctx, monkeypatch):
    _pools(backend, POOLS)
    tok = (await call(ctx, action="pause_routing", counsellor_id="c-1"))["confirm_token"]
    real = ld.time.time
    monkeypatch.setattr(ld.time, "time", lambda: real() + ld.CONFIRM_TTL_SECONDS + 60)
    out = await call(ctx, action="pause_routing", counsellor_id="c-1", confirm_token=tok)
    assert out["error"] == "confirm_token_expired" and _writes(backend) == []


async def test_resume_routing_and_no_change(backend, ctx):
    _pools(backend, [{**p, "status": "INACTIVE"} for p in POOLS])
    assert (await call(ctx, action="pause_routing", counsellor_id="c-1"))["error"] == "no_change"
    shown = await call(ctx, action="resume_routing", counsellor_id="c-1")
    assert [p["from"] for p in shown["pools"]] == ["INACTIVE", "INACTIVE"]
    done = await call(ctx, action="resume_routing", counsellor_id="c-1", confirm_token=shown["confirm_token"])
    assert done["status"] == "ACTIVE" and _writes(backend)[0]["body"]["status"] == "ACTIVE"


async def test_routing_needs_a_pool_and_a_counsellor(backend, ctx):
    _pools(backend, [])
    assert (await call(ctx, action="pause_routing", counsellor_id="c-1"))["error"] == "not_in_any_pool"
    assert (await call(ctx, action="pause_routing"))["error"] == "missing_argument"
    backend.sql.fail = True
    assert (await call(ctx, action="pause_routing", counsellor_id="c-1"))["error"] == "query_failed"
    assert _writes(backend) == []
