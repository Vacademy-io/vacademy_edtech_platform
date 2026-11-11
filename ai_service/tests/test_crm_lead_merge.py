"""
crm_lead_merge merge_people / unmerge_people, and the similar-name warning of crm_lead_intake add_lead.

Pinned here: both merge actions are for institute admins only and are two-step (the preview reads
admin-core's merge preview with a GET and writes nothing; the confirm sends exactly the two resolved
people); they sit in a settings group of their own that is turned on separately, so a group that allows
the other lead edits does not reach them; a merge admin-core refuses, or a converted duplicate kept under
a person who is not converted, comes back as merge_refused with the reasons and no token; a
confirm is refused when the people changed after the preview; undo picks the merged person and asks
when several were merged in; get shows the merge, and a lead whose person was merged is flagged.
add_lead lists live leads with a similar name (contact masked) and still adds the lead: it only warns.
The real-Postgres tests (skipped unless AI_LIMITS_PG_URL points at a throwaway Postgres) run the name
match and the merge state on a real driver.
"""
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as registry  # noqa: E402,F401
from app.services import assistant_tools_crm_lead_edit as m  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import entitlements as ent  # noqa: E402
from app.services import institute_setting_reader as isr  # noqa: E402
from crm_fakes import CrmBackend, confirm_db, lead_row, make_ctx  # noqa: E402

KEEP, DUP = "u-keep", "u-dup"


class _Leads:
    def __init__(self, *rows):
        self.rows = {r["lead_id"]: r for r in rows}

    def __call__(self, p, sql):
        rows = list(self.rows.values())
        if "AS exact_name" in sql or "AS phone_digits" in sql or "merged_from_user_id" in sql:
            return []
        if "ar.user_id = ANY(:uids)" in sql:
            return [{"id": r["lead_id"]} for r in rows if r.get("lead_user_id") in p["uids"]]
        if "ar.id = :lid" in sql:
            return [r for r in rows if r["lead_id"] == p["lid"]]
        return []


@pytest.fixture
def backend(monkeypatch):
    b = CrmBackend().install(monkeypatch)
    b.sql.on("FROM audience_response ar", _Leads(lead_row("r-keep", KEEP, name="Asha Rao"),
                                                 lead_row("r-dup", DUP, name="Asha  Rao", phone="+91 90000 00002"),
                                                 lead_row("r-other", "u-other", in_scope=False)))
    b.sql.on("FROM workflow_trigger", [])
    monkeypatch.setattr(isr, "load_institute_setting_data", lambda db, inst, key: None)
    b.lead_scope("ADMIN")
    return b


def _plan(can_merge=True, refusals=(), moving=("r-dup",), keep_status="CONVERTED"):
    def person(uid, name, rows, status):
        return {"user_id": uid, "profile_id": "p-" + uid, "name": name, "conversion_status": status,
                "lead_tier": "HOT", "counsellor_name": "Ravi", "merged_into_user_id": None,
                "enquiries": [{"response_id": r, "list_name": "Website", "phone": "+91 90000 00002",
                               "email": "asha.rao@example.com", "status_key": "NEW", "audience_status": "ACTIVE",
                               "source_type": "MANUAL", "submitted_at": "2026-10-01T10:00:00"} for r in rows]}
    return {"keep": person(KEEP, "Asha Rao", ["r-keep"], keep_status),
            "duplicate": person(DUP, "Asha  Rao", list(moving), "CONVERTED"),
            "can_merge": can_merge, "refusals": [{"code": c, "message": t} for c, t in refusals],
            "effects": ["1 enquiry of the duplicate moves to the person you keep."]}


def _routes(backend, plan):
    backend.admin_core.on("GET", m.MERGE_PREVIEW_PATH, lambda mth, path, params, body: plan())
    backend.admin_core.on("POST", m.MERGE_PATH, {"keep_user_id": KEEP, "duplicate_user_id": DUP,
                                                 "enquiries_moved": 1})
    backend.admin_core.on("POST", m.UNMERGE_PATH, {"keep_user_id": KEEP, "duplicate_user_id": DUP,
                                                   "enquiries_moved_back": 1})


def _writes(backend):
    return [c for c in backend.admin_core.calls if c["method"] in ("POST", "PUT", "DELETE", "PATCH")]


async def _edit(ctx, **args):
    return json.loads(await m.execute_crm_lead_merge(args, ctx))


async def _intake(ctx, **args):
    return json.loads(await m.execute_crm_lead_intake(args, ctx))


# ── the tool surface ─────────────────────────────────────────────────────

def test_both_merge_actions_are_admin_only_confirmed_writes():
    for action in ("merge_people", "unmerge_people"):
        assert action in m.MERGE_ACTIONS and action not in m.EDIT_ACTIONS
        spec = m.ACTION_SPEC[action]
        assert spec["admin_only"] and spec["writes"] and spec["confirm"] == "edit_token"
    props = m.MERGE_SCHEMA["function"]["parameters"]["properties"]
    assert "duplicate_lead_id" in props and "merged_user_id" in props
    assert "duplicate_lead_id" not in m.EDIT_SCHEMA["function"]["parameters"]["properties"]
    assert "similar_name_leads" in m.INTAKE_SCHEMA["function"]["description"]


def test_merging_is_its_own_opt_in_group():
    from app.mcp import adapter
    from app.mcp.access import normalize_setting
    from app.mcp.constants import MCP_ALLOWED_WRITE_TOOLS, MCP_EXPOSED_TOOLS, MCP_OPT_IN_GROUPS
    from app.schemas.auth import PinnedPrincipal
    assert registry.ASSISTANT_TOOLS[m.MERGE_TOOL].key() == "crm_lead_merges" == m.MERGE_GROUP
    assert m.MERGE_TOOL in MCP_EXPOSED_TOOLS and "confirm" in MCP_ALLOWED_WRITE_TOOLS[m.MERGE_TOOL]
    assert m.MERGE_GROUP in MCP_OPT_IN_GROUPS
    entry = next(c for c in adapter.tool_catalog() if c["name"] == m.MERGE_TOOL)
    assert entry["opt_in"] is True and entry["level"] == "edit" and entry["risk"] == "live"
    assert m.MERGE_GROUP not in {c["key"] for c in adapter.tool_catalog(include_opt_in=False)}
    who = PinnedPrincipal(user_id="u-1", institute_id="inst-1", roles=["ADMIN"], permissions=[],
                          is_root_user=False)

    def listed(groups):
        setting = normalize_setting({"enabled": True, "allowed_roles": ["ADMIN"], "enabled_tools": groups,
                                     "role_overrides": {}})
        return [t.name for t in adapter.list_tools_for(who, setting)]
    assert m.EDIT_TOOL in listed(["crm_leads", "crm_lead_edits"])
    assert m.MERGE_TOOL not in listed(["crm_leads", "crm_lead_edits"])
    assert m.MERGE_TOOL in listed(["crm_leads", "crm_lead_merges"])


async def test_the_edit_tool_no_longer_takes_merge_actions(backend):
    out = json.loads(await m.execute_crm_lead_edit({"action": "merge_people", "lead_id": "r-keep",
                                                    "duplicate_lead_id": "r-dup"}, make_ctx()))
    assert out["error"] == "unknown_action" and "merge_people" not in out["available"]
    assert _writes(backend) == []


# ── merge_people ─────────────────────────────────────────────────────────

async def test_merge_previews_both_people_then_merges_on_the_confirm(backend):
    _routes(backend, _plan)
    ctx = make_ctx(db=confirm_db())
    shown = await _edit(ctx, action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup")
    assert shown["applied"] is False and _writes(backend) == []
    [get] = backend.admin_core.called(m.MERGE_PREVIEW_PATH, "GET")
    assert get["params"] == {"instituteId": "inst-1", "keepUserId": KEEP, "duplicateUserId": DUP}
    assert shown["keep"]["lead_user_id"] == KEEP and shown["duplicate"]["lead_user_id"] == DUP
    lead = shown["duplicate"]["leads"][0]
    assert lead["lead_id"] == "r-dup" and lead["phone"] == "******0002" and lead["email"] == "a***@example.com"
    assert shown["effects"] and "unmerge_people" in shown["undo"]
    done = await _edit(ctx, action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup",
                       confirm_token=shown["confirm_token"])
    [post] = backend.admin_core.called(m.MERGE_PATH, "POST")
    assert post["body"] == {"keep_user_id": KEEP, "duplicate_user_id": DUP}
    assert post["params"] == {"instituteId": "inst-1"}
    assert done["merged"] and done["enquiries_moved"] == 1 and done["merged_lead_user_id"] == DUP


async def test_a_refused_merge_says_why_and_offers_no_token(backend):
    _routes(backend, lambda: _plan(False, [("DUPLICATE_HAS_PAYMENT", "The duplicate has fees or payments "
                                                                     "recorded here.")]))
    out = await _edit(make_ctx(), action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup")
    assert out["error"] == "merge_refused" and "confirm_token" not in out
    assert out["reasons"] == [{"code": "DUPLICATE_HAS_PAYMENT",
                               "reason": "The duplicate has fees or payments recorded here."}]
    assert "payments" in out["message"] and _writes(backend) == []


async def test_the_confirm_is_refused_when_the_people_changed_after_the_preview(backend):
    moving = {"rows": ("r-dup",)}
    _routes(backend, lambda: _plan(moving=moving["rows"]))
    ctx = make_ctx(db=confirm_db())
    shown = await _edit(ctx, action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup")
    moving["rows"] = ("r-dup", "r-dup-new")
    out = await _edit(ctx, action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup",
                      confirm_token=shown["confirm_token"])
    assert out.get("error") and _writes(backend) == []


@pytest.mark.parametrize("keep_status", ["LEAD", None, "LOST"])
async def test_a_converted_duplicate_is_not_merged_into_an_unconverted_person(backend, keep_status):
    _routes(backend, lambda: _plan(keep_status=keep_status))
    out = await _edit(make_ctx(db=confirm_db()), action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup")
    assert out["error"] == "merge_refused" and "confirm_token" not in out
    assert [r["code"] for r in out["reasons"]] == ["DUPLICATE_CONVERTED_KEEP_NOT"]
    assert "Keep the converted person instead" in out["message"] and _writes(backend) == []


async def test_the_converted_refusal_is_listed_once_when_admin_core_gives_it_too(backend):
    _routes(backend, lambda: _plan(False, [("DUPLICATE_CONVERTED_KEEP_NOT", "The duplicate is marked converted.")],
                                   keep_status="LEAD"))
    out = await _edit(make_ctx(), action="merge_people", lead_id="r-keep", duplicate_lead_id="r-dup")
    assert [r["code"] for r in out["reasons"]] == ["DUPLICATE_CONVERTED_KEEP_NOT"]


async def test_merge_refusals_before_admin_core(backend):
    _routes(backend, _plan)
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    out = await _edit(make_ctx("c-1", ("COUNSELLOR",)), action="merge_people", lead_id="r-keep",
                      duplicate_lead_id="r-dup")
    assert out["error"] == "admin_only"
    backend.lead_scope("ADMIN")
    assert (await _edit(make_ctx(), action="merge_people", lead_id="r-keep"))["error"] == "missing_argument"
    assert (await _edit(make_ctx(), action="merge_people", lead_id="r-keep",
                        duplicate_lead_id="r-keep"))["error"] == "same_person"
    assert (await _edit(make_ctx(), action="merge_people", lead_id="r-keep",
                        duplicate_lead_id="r-other"))["error"] == "out_of_scope"
    assert backend.admin_core.called(m.MERGE_PREVIEW_PATH) == [] and _writes(backend) == []


# ── unmerge_people ───────────────────────────────────────────────────────

def _merged_in(backend, *people):
    backend.sql.on("FROM user_lead_profile p", lambda p, sql: [
        {"kind": "from", "other_id": u, "merged_at": datetime(2026, 11, 1, 10, 0), "enquiries": 1} for u in people])


async def test_unmerge_previews_then_undoes_the_one_merge(backend):
    _routes(backend, _plan)
    _merged_in(backend, DUP)
    ctx = make_ctx(db=confirm_db())
    shown = await _edit(ctx, action="unmerge_people", lead_id="r-keep")
    assert shown["applied"] is False and _writes(backend) == []
    assert shown["merged_person"]["lead_user_id"] == DUP and shown["effects"]
    done = await _edit(ctx, action="unmerge_people", lead_id="r-keep", confirm_token=shown["confirm_token"])
    [post] = backend.admin_core.called(m.UNMERGE_PATH, "POST")
    assert post["body"] == {"duplicate_user_id": DUP} and post["params"] == {"instituteId": "inst-1"}
    assert done["unmerged"] and done["enquiries_moved_back"] == 1


async def test_unmerge_asks_which_person_when_several_were_merged_in(backend):
    _routes(backend, _plan)
    _merged_in(backend, DUP, "u-dup-2")
    out = await _edit(make_ctx(), action="unmerge_people", lead_id="r-keep")
    assert out["error"] == "ambiguous_merge" and len(out["merged_people"]) == 2
    picked = await _edit(make_ctx(), action="unmerge_people", lead_id="r-keep", merged_user_id="u-dup-2")
    assert picked["merged_person"]["lead_user_id"] == "u-dup-2"
    wrong = await _edit(make_ctx(), action="unmerge_people", lead_id="r-keep", merged_user_id="u-nobody")
    assert wrong["error"] == "not_merged" and _writes(backend) == []


async def test_unmerge_with_nothing_merged(backend):
    _routes(backend, _plan)
    out = await _edit(make_ctx(), action="unmerge_people", lead_id="r-keep")
    assert out["error"] == "not_merged" and _writes(backend) == []


# ── what reads show ──────────────────────────────────────────────────────

def test_a_lead_whose_person_was_merged_is_flagged():
    assert "merged_into_other_person" in cd.lead_flags(lead_row("r-1", "u-1", profile_merged_into=KEEP))
    assert "merged_into_other_person" not in cd.lead_flags(lead_row("r-1", "u-1"))


def test_merge_state_reads_both_directions(backend):
    backend.sql.on("FROM user_lead_profile p", [
        {"kind": "into", "other_id": KEEP, "merged_at": datetime(2026, 11, 1), "enquiries": 0}])
    out = cd.merge_state(make_ctx(), DUP)
    assert out["merged_into"] == KEEP and out["note"] == cd.MERGED_NOTE and "merged_people" not in out
    _merged_in(backend, DUP)
    out = cd.merge_state(make_ctx(), KEEP)
    assert out == {"merged_people": [{"lead_user_id": DUP, "merged_at": out["merged_people"][0]["merged_at"],
                                      "enquiries_moved": 1}]}
    backend.sql.on("FROM user_lead_profile p", [])
    assert cd.merge_state(make_ctx(), KEEP) is None and cd.merge_state(make_ctx(), "") is None


def test_admissions_and_reports_leave_merged_profiles_out():
    from app.services import assistant_tools_crm_money as money
    from app.services import assistant_tools_crm_team as team
    from app.services import crm_admissions as adm
    assert "ulp.merged_into_user_id IS NULL" in adm._BASE
    assert "ulp.merged_into_user_id IS NULL" in money._CONVERTED_NOT_PAID_SQL
    assert "ulp.merged_into_user_id IS NULL" in team._OPEN_PROFILES_SQL


# ── add_lead: similar names ──────────────────────────────────────────────

def _intake_backend(backend):
    backend.sql.on("FROM audience a WHERE", lambda p, sql: [
        {"id": i, "name": "NEET 2027", "status": "ACTIVE", "sub_org_id": None} for i in p["ids"]])
    backend.sql.on("FROM institute_custom_fields icf\nJOIN custom_fields", [])
    backend.admin_core.on("POST", m.SUBMIT_PATH, "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6")


async def test_add_lead_warns_about_similar_names_and_still_adds(backend):
    _intake_backend(backend)
    backend.sql.on("AS exact_name", [
        {**lead_row("r-sim-1", "u-sim-1", name="Asha Rao", phone="+91 98111 22334"), "exact_name": True},
        {**lead_row("r-sim-2", "u-sim-2", name="Rao Asha", in_scope=False), "exact_name": False},
        {**lead_row("r-sim-3", "u-sim-3", name="Asha Rao"), "exact_name": True, "profile_merged_into": KEEP}])
    ctx = make_ctx(db=confirm_db())
    args = dict(action="add_lead", list_id="list-1", name="ASHA rao", phone="9000000099")
    shown = await _intake(ctx, **args)
    [(sql, params)] = backend.sql.matching("AS exact_name")
    assert params["name"] == "ASHA rao" and params["days"] == m.SIMILAR_NAME_DAYS == 180
    assert [x["lead_id"] for x in shown["similar_name_leads"]] == ["r-sim-1"]
    assert shown["similar_name_leads"][0]["phone"] == "******2334" and shown["similar_name_leads"][0]["exact_name"]
    assert shown["similar_names_not_shown"] == 1 and "Only a warning" in shown["similar_name_note"]
    assert shown["applied"] is False and _writes(backend) == []
    done = await _intake(ctx, **args, confirm_token=shown["confirm_token"])
    assert done["done"] and len(backend.admin_core.called(m.SUBMIT_PATH, "POST")) == 1


async def test_add_lead_without_similar_names_has_no_warning(backend):
    _intake_backend(backend)
    shown = await _intake(make_ctx(db=confirm_db()), action="add_lead", list_id="list-1", name="Zed Q",
                          phone="9000000098")
    assert "similar_name_leads" not in shown and shown["applied"] is False


# ── real Postgres ────────────────────────────────────────────────────────

_DDL = """
create table audience(id varchar primary key, institute_id varchar, campaign_type text, campaign_name varchar,
    status varchar default 'ACTIVE', sub_org_id varchar);
create table audience_response(id varchar primary key, audience_id varchar, user_id varchar, student_user_id varchar,
    audience_status varchar, overall_status varchar, parent_name varchar, parent_mobile varchar, parent_email varchar,
    submitted_at timestamp, source_type varchar, enquiry_id varchar, lead_status_id varchar,
    merged_from_user_id varchar);
create table linked_users(id varchar primary key, user_id varchar, source varchar, source_id varchar,
    created_at timestamp);
create table user_lead_profile(id text primary key, user_id text, institute_id text, conversion_status varchar,
    assigned_counselor_id varchar, merged_into_user_id text, merged_at timestamp, unique (user_id, institute_id));
create table lead_status(id text primary key, status_key varchar);
create table custom_fields(id varchar primary key, field_key varchar);
create table institute_custom_fields(id varchar primary key, institute_id varchar, custom_field_id varchar);
create table custom_field_values(id varchar primary key, source_type varchar, source_id varchar,
    custom_field_id varchar, value varchar, updated_at timestamp);
"""


class _Ent:
    mode = "MANAGED"

    def on(self, key):
        return True


@pytest.fixture
def real_ctx(monkeypatch):
    url = os.environ.get("AI_LIMITS_PG_URL")
    if not url:
        pytest.skip("set AI_LIMITS_PG_URL to run on a throwaway Postgres")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    be = CrmBackend()
    schema = "crm_merge_" + uuid.uuid4().hex[:12]
    admin = create_engine(url)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE SCHEMA {schema}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    recent, old = (now - timedelta(days=10)).isoformat(), (now - timedelta(days=200)).isoformat()
    rows = [
        # id, list, user, name, status, overall, source, submitted
        ("a1", "web", "same", "Asha Rao", "ACTIVE", None, "WEB", recent),            # same name
        ("a2", "web", "caps", "  ASHA   rao. ", "ACTIVE", None, "WEB", recent),     # same once normalised
        ("a3", "web", "swap", "Rao Asha", "ACTIVE", None, "WEB", recent),           # first and last swapped
        ("a4", "web", "middle", "Asha K Rao", "ACTIVE", None, "WEB", recent),       # same first and last word
        ("a5", "web", "form", None, "ACTIVE", None, "WEB", recent),                 # name only in the form
        ("a6", "web", "old", "Asha Rao", "ACTIVE", None, "WEB", old),               # too old
        ("a7", "web", "gone", "Asha Rao", "DELETED", None, "WEB", recent),          # deleted
        ("a8", "web", "opted", "Asha Rao", "ACTIVE", "OPTED_OUT", "WEB", recent),   # opted out
        ("a9", "optl", "listed", "Asha Rao", "ACTIVE", None, "OPT_OUT", recent),    # opt-out list row
        ("a10", "else", "other", "Asha Rao", "ACTIVE", None, "WEB", recent),        # another institute
        ("a11", "web", "differ", "Asha Rani", "ACTIVE", None, "WEB", recent),       # different last name
        ("a12", "web", "merged", "Asha Rao", "ACTIVE", None, "WEB", recent),        # merged into someone
        ("a13", "web", "kept", "Kiran Das", "ACTIVE", None, "WEB", recent),         # took a12's old enquiry
    ]
    with engine.begin() as c:
        c.exec_driver_sql(_DDL)
        c.exec_driver_sql("insert into audience(id,institute_id,campaign_type,campaign_name) values "
                          "('web','I','WEB','Web'),('optl','I','OPT_OUT_LIST','Opt-out list'),"
                          "('else','OTHER','WEB','Other')")
        for r in rows:
            c.exec_driver_sql("insert into audience_response(id,audience_id,user_id,parent_name,audience_status,"
                              "overall_status,source_type,submitted_at,parent_mobile) values "
                              "(%s,%s,%s,%s,%s,%s,%s,%s,'+91 90000 00011')", r)
        c.exec_driver_sql("update audience_response set merged_from_user_id = 'merged' where id = 'a13'")
        c.exec_driver_sql("insert into custom_fields values ('cf-name','full_name'),('cf-city','city')")
        c.exec_driver_sql("insert into institute_custom_fields values ('i1','I','cf-name'),('i2','I','cf-city')")
        c.exec_driver_sql("insert into custom_field_values values ('v1','AUDIENCE_RESPONSE','a5','cf-name',"
                          "'asha rao',now()),('v2','AUDIENCE_RESPONSE','a11','cf-city','Asha Rao',now())")
        for u in ("same", "caps", "swap", "middle", "form", "kept"):
            c.exec_driver_sql("insert into user_lead_profile(id,user_id,institute_id,assigned_counselor_id) "
                              "values (%s,%s,'I','c-1')", ("p-" + u, u))
        c.exec_driver_sql("insert into user_lead_profile(id,user_id,institute_id,merged_into_user_id,merged_at) "
                          "values ('p-merged','merged','I','kept',now())")
    monkeypatch.setattr(cd.cbd, "admin_core", be.admin_core)
    monkeypatch.setattr(cd.ld, "auth_call", be._auth_call)
    monkeypatch.setattr(ent, "entitlements", lambda db, inst: _Ent())
    be.lead_scope("ADMIN")
    db = Session(bind=engine, future=True)
    try:
        yield make_ctx(db=db, institute_id="I"), be
    finally:
        db.close()
        engine.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        admin.dispose()


async def test_real_driver_similar_names(real_ctx):
    ctx, be = real_ctx
    out = await m._similar_names(ctx, "asha RAO")
    got = {x["lead_id"]: x["exact_name"] for x in out["similar_name_leads"]}
    assert got == {"a1": True, "a2": True, "a3": False, "a4": False, "a5": True}
    assert "similar_names_not_shown" not in out
    assert (await m._similar_names(ctx, "asha rao", skip_people=["same", "caps"]))["similar_name_leads"][0]["lead_id"] \
        in ("a3", "a4", "a5")
    assert await m._similar_names(ctx, "Nobody Here") == {}
    assert await m._similar_names(ctx, "Al") == {}
    single = await m._similar_names(ctx, "Asha")
    assert single == {}


async def test_real_driver_similar_names_hide_leads_outside_the_callers_scope(real_ctx):
    ctx, be = real_ctx
    be.lead_scope("COUNSELLOR_TREE", owner_ids=["c-9"], include_unassigned=False)
    out = await m._similar_names(make_ctx("c-9", ("COUNSELLOR",), db=ctx.db, institute_id="I"), "Asha Rao")
    assert out["similar_name_leads"] == [] and out["similar_names_not_shown"] == 5


def test_real_driver_merge_state(real_ctx):
    ctx, be = real_ctx
    kept = cd.merge_state(ctx, "kept")
    assert kept["merged_people"][0]["lead_user_id"] == "merged" and kept["merged_people"][0]["enquiries_moved"] == 1
    merged = cd.merge_state(ctx, "merged")
    assert merged["merged_into"] == "kept" and "merged_people" not in merged
    assert cd.merge_state(ctx, "same") is None
