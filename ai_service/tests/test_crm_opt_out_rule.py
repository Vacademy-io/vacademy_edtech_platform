"""
Who counts as opted out in crm_leads, on real Postgres.

A row stays out of list, export, bulk targets and my_day when the row is flagged
or on an opt-out list, or when the row's user or linked student has a row in this
institute that is, whatever the row's date. get and find give the same answer. The
intake gate, assignment, reassignment and status and tier changes use the same
person rule, and never change an opt-out list row.

Skipped unless AI_LIMITS_PG_URL points at a throwaway Postgres.
"""
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402,F401
from app.services import assistant_tools_crm_calls as calls  # noqa: E402
from app.services import assistant_tools_crm_lead_edit as edit  # noqa: E402
from app.services import assistant_tools_crm_leads as m  # noqa: E402
from app.services import assistant_tools_crm_messages as msgs  # noqa: E402
from app.services import assistant_tools_crm_team as team  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import entitlements as ent  # noqa: E402
from app.services import file_exports as fe  # noqa: E402
from crm_fakes import CrmBackend, make_ctx  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


class _Ent:
    mode = "MANAGED"

    def on(self, key):
        return True


_DDL = """
create table audience(id varchar primary key, institute_id varchar, campaign_type text, campaign_name varchar,
    status varchar default 'ACTIVE', sub_org_id varchar);
create table mcp_file_export(id varchar primary key, institute_id varchar, created_by_user_id varchar,
    source_tool varchar, kind varchar, file_name varchar, content_type varchar, size_bytes bigint, ciphertext text,
    key_hash varchar, status varchar, download_count int4, max_downloads int4, expires_at timestamptz,
    metadata_json text, created_at timestamptz, updated_at timestamptz, last_downloaded_at timestamptz);
create table audience_response(id varchar primary key, audience_id varchar, user_id varchar, student_user_id varchar,
    audience_status varchar, overall_status varchar, parent_name varchar, parent_mobile varchar, parent_email varchar,
    submitted_at timestamp, created_at timestamp, updated_at timestamp, source_type varchar, enquiry_id varchar,
    lead_status_id varchar, tat_due_override_at timestamp, tat_due_at timestamp);
create table linked_users(id varchar primary key, user_id varchar, source varchar, source_id varchar,
    created_at timestamp);
create table user_lead_profile(id text primary key, user_id text, institute_id text, conversion_status varchar,
    converted_at timestamp, assigned_counselor_id varchar, lead_tier varchar, best_score int4, updated_at timestamp,
    last_activity_at timestamp, unique (user_id, institute_id));
create table lead_status(id text primary key, status_key varchar, institute_id varchar, label varchar,
    deleted_at timestamp, is_active boolean);
create table lead_tier(id text primary key, tier_key varchar, institute_id varchar, is_active boolean, min_score int4,
    display_order int4, label varchar, deleted_at timestamp);
create table lead_score(id text primary key, audience_response_id text, raw_score int4, updated_at timestamp);
create table lead_followup(id text primary key, audience_response_id text, institute_id varchar, is_closed boolean,
    schedule_time timestamp, created_by varchar, is_priority boolean, next_action varchar, follow_up_mode varchar,
    content varchar, status varchar, student_response varchar);
create table lead_sla_config(id text primary key, institute_id varchar, tat_enabled boolean, tat_minutes int4,
    tat_hours int4);
create table custom_fields(id varchar primary key, field_key varchar);
create table custom_field_values(id varchar primary key, source_type varchar, source_id varchar,
    custom_field_id varchar, value varchar);
create table timeline_event(id varchar primary key, type varchar, type_id varchar, student_user_id varchar,
    created_at timestamp, category varchar, action_type varchar, actor_id varchar, actor_type varchar);
create table telephony_call_log(id varchar primary key, response_id varchar, subject_type varchar, subject_id varchar,
    user_id varchar, institute_id varchar, callback_at timestamp, counsellor_user_id varchar, created_at timestamp,
    disposition_key varchar, start_time timestamp, status varchar, direction varchar, provider_type varchar);
create table ai_call_result(id varchar primary key, call_log_id varchar, institute_id varchar, created_at timestamp,
    received_at timestamp, follow_up varchar, follow_up_gist varchar, lead_rating int4, disposition varchar);
create table ai_call_queue(id varchar primary key, institute_id varchar, status varchar, response_id varchar,
    user_id varchar);
"""

_ROW = ("insert into audience_response(id,audience_id,user_id,student_user_id,audience_status,overall_status,"
        "source_type,created_at,submitted_at,updated_at,parent_name,parent_mobile,parent_email) values")


def _r(rid, list_id, user, *, student=None, status="ACTIVE", flag=None, source="WEBSITE", at="2026-09-01", sub="same",
       updated="same", phone=None, email=None, name=None):
    sub = at if sub == "same" else sub
    updated = at if updated == "same" else updated
    q = lambda v: "null" if v is None else "'" + str(v) + "'"  # noqa: E731
    return "(" + ",".join(q(v) for v in (rid, list_id, user, student, status, flag, source, at, sub, updated, name,
                                         phone, email)) + ")"


#: Every shape the rule treats differently. Each person has their own number and email.
_PEOPLE = [
    # never opted out
    _r("n1", "web", "never", phone="9000000001", email="never@example.com", name="Nina Never"),
    # the shape admin-core's opt-out service writes: an older row, the newest row flagged, then a row on the list
    _r("f_old", "web", "flagged", phone="9000000002", at="2026-09-01"),
    _r("f_flag", "web2", "flagged", flag="OPTED_OUT", phone="9000000002", at="2026-09-02"),
    _r("f_list", "optl", "flagged", source="OPT_OUT", phone="9000000002", at="2026-09-03"),
    # on the list with no flagged row
    _r("lo_live", "web", "listonly", phone="9000000003", at="2026-09-01"),
    _r("lo_list", "optl", "listonly", source="OPT_OUT", phone="9000000003", at="2026-09-03"),
    # opted out, then a new enquiry on the same person
    _r("re_flag", "web", "reenq", flag="OPTED_OUT", phone="9000000004", at="2026-01-10"),
    _r("re_list", "optl", "reenq", source="OPT_OUT", phone="9000000004", at="2026-01-11"),
    _r("re_new", "web2", "reenq", phone="9000000004", at="2026-11-01"),
    # a father opted out; the mother's lead for the same child has her own number
    _r("g_father", "web", "father", student="kid", flag="OPTED_OUT", phone="9000000005", at="2026-09-01"),
    _r("g_flist", "optl", "father", source="OPT_OUT", phone="9000000005", at="2026-09-02"),
    _r("g_mother", "web2", "mother", student="kid", phone="9000000006", at="2026-09-01"),
    # the student themselves opted out: a parent's lead linked to them is left out, older or newer
    _r("k_own", "web", "kid2", flag="OPTED_OUT", phone="9000000010", at="2026-09-05"),
    _r("k_parent", "web", "dad2", student="kid2", phone="9000000007", at="2026-09-01"),
    _r("k_newer", "web", "dad3", student="kid2", phone="9000000008", at="2026-10-01"),
    # rows on both sides of a flagged row
    _r("u_flag", "web", "upd", flag="OPTED_OUT", phone="9000000009", at="2026-09-01", updated="2026-10-20"),
    _r("u_new", "web2", "upd", phone="9000000009", at="2026-10-15"),
    _r("u_newer", "web3", "upd", phone="9000000009", at="2026-10-25"),
    # a newer row that is itself flagged or on a list stays out
    _r("s_list", "optl", "self", source="OPT_OUT", phone="9000000011", at="2026-09-01"),
    _r("s_flag", "web", "self", flag="OPTED_OUT", phone="9000000011", at="2026-10-01"),
    _r("s_srclist", "web2", "self", source="OPT_OUT", phone="9000000011", at="2026-10-02"),
    # an unknown submit time
    _r("nu_list", "optl", "nullsub", source="OPT_OUT", phone="9000000012", at="2026-09-01"),
    _r("nu_row", "web", "nullsub", phone="9000000012", at="2026-10-01", sub=None),
    # an opt-out list row with no user
    _r("nl_list", "optl", None, source="OPT_OUT", phone="9000000017", at="2026-09-01"),
    # a deleted flagged row still counts
    _r("d_flag", "web", "deleted", status="INACTIVE", flag="OPTED_OUT", phone="9000000013", at="2026-09-01"),
    _r("d_live", "web2", "deleted", phone="9000000013", at="2026-08-01"),
    # another institute's opt-out does not
    _r("x_flag", "else", "elsewhere", flag="OPTED_OUT", phone="9000000014", at="2026-09-01"),
    _r("x_live", "web", "elsewhere", phone="9000000014", at="2026-08-01"),
    # rows with no user stand alone
    _r("nn_flag", "web", None, flag="OPTED_OUT", phone="9000000015", at="2026-09-01"),
    _r("nn_live", "web", None, phone="9000000016", at="2026-08-01"),
]
_LISTED = {"n1", "g_mother", "x_live", "nn_live"}
#: Active rows left out as opted out; rows of an opt-out list are not leads and are not counted.
_LEFT_OUT = {"f_old", "f_flag", "lo_live", "re_flag", "re_new", "g_father", "k_own", "k_parent", "k_newer", "u_flag",
             "u_new", "u_newer", "s_flag", "nu_row", "d_live", "nn_flag"}
_LIST_ROWS = {"f_list", "lo_list", "re_list", "g_flist", "s_list", "s_srclist", "nu_list", "nl_list"}


@pytest.fixture
def be():
    return CrmBackend()


@pytest.fixture
def real_ctx(monkeypatch, be):
    url = os.environ.get("AI_LIMITS_PG_URL")
    if not url:
        pytest.skip("set AI_LIMITS_PG_URL to run on a throwaway Postgres")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    schema = "crm_opt_" + uuid.uuid4().hex[:12]
    admin = create_engine(url)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE SCHEMA {schema}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    assert engine.dialect.driver == "psycopg"
    ctx_probe = make_ctx()
    me = ctx_probe.principal.user_id
    users = sorted({"never", "flagged", "listonly", "reenq", "father", "mother", "kid2", "dad2", "dad3", "upd", "self",
                    "nullsub", "deleted", "elsewhere"})
    with engine.begin() as c:
        c.exec_driver_sql(_DDL)
        c.exec_driver_sql("""insert into audience(id,institute_id,campaign_type,campaign_name) values
            ('web','I','WEB','Web'),('web2','I','WEB','Web 2'),('web3','I','WEB','Web 3'),
            ('optl','I','OPT_OUT_LIST','Opt-out list'),('else','OTHER','WEB','Other')""")
        c.exec_driver_sql(_ROW + ",\n".join(_PEOPLE))
        for u in users:
            c.exec_driver_sql(f"insert into user_lead_profile(id,user_id,institute_id,assigned_counselor_id) "
                              f"values('p-{u}','{u}','I','{me}')")
    monkeypatch.setattr(cd.cbd, "admin_core", be.admin_core)
    monkeypatch.setattr(cd.ld, "auth_call", be._auth_call)
    monkeypatch.setattr(cd, "institute_tz", lambda ctx, purpose="reports": cd.DEFAULT_TZ)
    monkeypatch.setattr(ent, "entitlements", lambda db, inst: _Ent())
    monkeypatch.setattr(fe.get_settings().__class__, "resolve_mcp_encryption_key", lambda self: "k" * 44, raising=False)
    be.lead_scope("ADMIN")
    be.counsellors({"c-1": "Asha Rao"})
    db = Session(bind=engine, future=True)
    try:
        yield make_ctx(db=db, institute_id="I")
    finally:
        db.close()
        engine.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        admin.dispose()


def _exec(ctx, sql):
    ctx.db.connection().exec_driver_sql(sql)
    ctx.db.commit()


async def _run(ctx, **args):
    return json.loads(await m.execute_crm_leads(args, ctx))


# ── resolve_filter, list, export ─────────────────────────────────────────

async def test_real_driver_each_shape_is_listed_or_left_out_by_the_rule(real_ctx):
    ids, info = await cd.resolve_filter(real_ctx, {})
    assert set(ids) == _LISTED and not _LIST_ROWS & set(ids)
    assert info["matched"] == len(_LISTED) and info["opted_out_dropped"] == len(_LEFT_OUT)
    assert info["over_cap_dropped"] == 0 and "note" not in info


async def test_real_driver_the_date_of_a_row_never_changes_the_answer(real_ctx):
    # After every other row of that person, and with the flagged row's updated_at left as created_at.
    _exec(real_ctx, _ROW + _r("re_later", "web3", "reenq", phone="9000000004", at="2026-11-05") + ","
          + _r("k_later", "web3", "dad4", student="kid2", phone="9000000022", at="2026-11-05"))
    _exec(real_ctx, "update audience_response set updated_at = created_at where overall_status = 'OPTED_OUT'")
    ids, _ = await cd.resolve_filter(real_ctx, {})
    assert not {"re_later", "k_later", "re_new", "k_newer"} & set(ids)


async def test_real_driver_list_export_and_counts_agree(real_ctx):
    out = await _run(real_ctx, action="list", limit=50)
    listed = {x["lead_id"] for p in out["people"] for x in p["leads"]}
    assert listed == _LISTED and out["matched"] == len(_LISTED) and out["excluded"]["opted_out"] == len(_LEFT_OUT)
    assert "by person" in out["definition"] and "whatever the date" in out["definition"]
    assert all(set(p["person"]) == {"lead_user_id", "name", "phone", "email", "owner", "tier", "flags"}
               for p in out["people"])
    exported = await _run(real_ctx, action="export")
    assert exported["matched"] == len(_LISTED) and exported["excluded"]["opted_out"] == len(_LEFT_OUT)


async def test_real_driver_a_filter_on_an_opt_out_list_says_why_it_is_empty(real_ctx):
    out = await _run(real_ctx, action="list", filter={"list_ids": ["optl"]})
    assert out["matched"] == 0 and out["people"] == [] and out["excluded"]["opted_out"] == 0
    assert "Opt-out list rows are not shown" in " ".join(out["notes"])
    exported = await _run(real_ctx, action="export", filter={"list_ids": ["optl"]})
    assert exported["status"] == "empty" and "Opt-out list rows are not shown" in exported["note"]
    mixed = await _run(real_ctx, action="list", filter={"list_ids": ["optl", "web2"]})
    assert {x["lead_id"] for p in mixed["people"] for x in p["leads"]} == {"g_mother"}
    assert "Opt-out list rows are not shown" in " ".join(mixed["notes"])
    file = await _run(real_ctx, action="export", filter={"list_ids": ["optl", "web2"]})
    assert file["rows"] == 1 and "Opt-out list rows are not shown" in file["opt_out_list_note"]
    plain = await _run(real_ctx, action="list", filter={"list_ids": ["web2"]})
    assert "Opt-out list rows are not shown" not in " ".join(plain["notes"])


# ── get and find give the same answer ────────────────────────────────────

@pytest.mark.parametrize("lead_id, opted_out, flag", [
    ("n1", False, None),
    ("f_flag", True, "opted_out"),
    ("f_old", True, "opted_out"),
    ("lo_live", True, "opted_out"),
    ("lo_list", True, "opted_out"),
    ("re_new", True, "opted_out"),
    ("re_flag", True, "opted_out"),
    ("g_mother", False, None),
    ("g_father", True, "opted_out"),
    ("k_parent", True, "linked_student_opted_out"),
    ("k_newer", True, "linked_student_opted_out"),
    ("u_new", True, "opted_out"),
    ("u_newer", True, "opted_out"),
    ("nu_row", True, "opted_out"),
    ("nn_flag", True, "opted_out"),
    ("nl_list", True, "opted_out"),
    ("nn_live", False, None),
    ("d_live", True, "opted_out"),
    ("x_live", False, None),
])
async def test_real_driver_get_agrees_with_list(real_ctx, lead_id, opted_out, flag):
    ids, _ = await cd.resolve_filter(real_ctx, {})
    assert (lead_id in ids) is (not opted_out)
    out = await _run(real_ctx, action="get", lead_id=lead_id)
    lead = out["lead"]
    assert lead["lead_id"] == lead_id and lead["opted_out"] is opted_out
    assert set(lead) == {"lead_id", "lead_user_id", "list_id", "list", "source", "submitted_at", "status",
                         "status_label", "in_status_since", "days_in_status", "days_in_status_from", "tier", "score",
                         "flags", "opted_out"}
    assert (flag in lead["flags"]) if flag else not {"opted_out", "linked_student_opted_out"} & set(lead["flags"])
    assert out.get("opt_out_note") == (cd.LINKED_STUDENT_OPT_OUT_NOTE if flag == "linked_student_opted_out" else None)


@pytest.mark.parametrize("lead_id, refused", [
    ("n1", False), ("f_old", True), ("f_flag", True), ("lo_live", True), ("lo_list", True), ("re_new", True),
    ("re_flag", True), ("g_mother", False), ("g_father", True), ("k_parent", False), ("k_newer", False),
    ("u_new", True), ("u_newer", True), ("nu_row", True), ("nn_flag", True), ("nl_list", True), ("nn_live", False),
    ("d_live", True), ("x_live", False),
])
async def test_real_driver_the_send_check_refuses_by_the_persons_id_number_and_email(real_ctx, lead_id, refused):
    resolved = await cd.resolve_lead(real_ctx, lead_id=lead_id)
    assert msgs.opted_out(real_ctx, resolved) is refused
    assert cd.own_opted_out(resolved) is refused


@pytest.mark.parametrize("query, user, flags, opted_out, row_flags", [
    ("9000000001", "never", [], False, {"n1": []}),
    ("9000000002", "flagged", ["opted_out"], True,
     {"f_old": ["opted_out"], "f_flag": ["opted_out"], "f_list": ["opted_out"]}),
    ("9000000003", "listonly", ["opted_out"], True, {"lo_live": ["opted_out"], "lo_list": ["opted_out"]}),
    ("9000000004", "reenq", ["opted_out"], True,
     {"re_flag": ["opted_out"], "re_list": ["opted_out"], "re_new": ["opted_out"]}),
    ("9000000006", "mother", [], False, {"g_mother": []}),
    ("9000000007", "dad2", ["linked_student_opted_out"], True, {"k_parent": ["linked_student_opted_out"]}),
])
async def test_real_driver_find_agrees_with_list(real_ctx, query, user, flags, opted_out, row_flags):
    out = await _run(real_ctx, action="find", query=query)
    assert out["count"] == 1
    person = out["people"][0]
    assert person["person"]["lead_user_id"] == user
    assert person["person"]["flags"] == flags and person["person"]["opted_out"] is opted_out
    assert {x["lead_id"]: x["flags"] for x in person["leads"]} == row_flags


async def test_real_driver_find_says_opted_out_for_the_rows_it_matched(real_ctx):
    _exec(real_ctx, _ROW + _r("two_kid", "web", "tkid", flag="OPTED_OUT", phone="9000000022", at="2026-09-01") + ","
          + _r("two_a", "web", "twophones", student="tkid", phone="9000000023", at="2026-09-02") + ","
          + _r("two_b", "web2", "twophones", phone="9000000024", at="2026-09-03"))
    out = await _run(real_ctx, action="find", query="9000000023")
    assert out["people"][0]["person"]["opted_out"] is True
    out = await _run(real_ctx, action="find", query="9000000024")
    assert out["people"][0]["person"]["opted_out"] is False
    text = m.CRM_LEADS_SCHEMA["function"]["description"]
    assert "cover the rows this query matched" in text and "not counted" in text


async def test_real_driver_a_dashboard_search_hit_carries_opted_out_like_find(real_ctx, be):
    be.admin_core.on("POST", m.LEADS_PATH, lambda *a: {"content": [{"response_id": "lo_live"}, {"response_id": "n1"}]})
    out = await _run(real_ctx, action="find", query="zzz not in any row")
    got = {p["person"]["lead_user_id"]: p["person"]["opted_out"] for p in out["people"]}
    assert got == {"listonly": True, "never": False}


async def test_real_driver_get_shows_each_row_of_the_person_by_the_same_rule(real_ctx):
    out = await _run(real_ctx, action="get", lead_id="re_new")
    assert {p["lead_id"]: p["flags"] for p in out["person_leads"]} == {
        "re_flag": ["opted_out"], "re_list": ["opted_out"], "re_new": ["opted_out"]}
    out = await _run(real_ctx, action="get", lead_id="lo_live")
    assert {p["lead_id"]: p["flags"] for p in out["person_leads"]} == {"lo_live": ["opted_out"], "lo_list": ["opted_out"]}


async def test_real_driver_resolve_lead_prefers_a_row_not_on_an_opt_out_list(real_ctx):
    # The newest row of this person is the list row.
    assert (await cd.resolve_lead(real_ctx, phone="9000000003"))["lead_id"] == "lo_live"
    flagged = await cd.resolve_lead(real_ctx, phone="9000000002")
    assert flagged["lead_id"] == "f_old" and flagged["on_opt_out_list"] is False
    # Every row but the list row is flagged: the flagged row is still preferred.
    _exec(real_ctx, _ROW + _r("o_flag", "web", "only", flag="OPTED_OUT", phone="9000000020", at="2026-09-01") + ","
          + _r("o_list", "optl", "only", source="OPT_OUT", phone="9000000020", at="2026-09-02"))
    assert (await cd.resolve_lead(real_ctx, phone="9000000020"))["lead_id"] == "o_flag"
    # By the person's id too.
    assert (await _run(real_ctx, action="get", lead_user_id="listonly"))["lead"]["lead_id"] == "lo_live"
    # A person only on the list resolves to that row, and an explicit lead_id is honoured.
    _exec(real_ctx, _ROW + _r("a_list", "optl", "alone", source="OPT_OUT", phone="9000000021", at="2026-09-02"))
    assert (await cd.resolve_lead(real_ctx, phone="9000000021"))["lead_id"] == "a_list"
    assert (await cd.resolve_lead(real_ctx, lead_id="lo_list"))["lead_id"] == "lo_list"


async def test_real_driver_a_new_enquiry_of_someone_who_opted_out_stays_refused_for_calls(real_ctx):
    res = await calls._guards(real_ctx, ["re_new", "n1", "g_mother", "k_parent", "lo_live"], "AAVTAAR")
    g = res["rows"]
    assert calls._drop_reason(g["re_new"], {"per_lead_cap": 3}) == "opted_out"
    assert calls._hard_refusal(g["re_new"])["error"] == "opted_out"
    assert calls._drop_reason(g["lo_live"], {"per_lead_cap": 3}) == "opted_out"
    assert not g["n1"]["opted_out_any"] and not g["g_mother"]["opted_out_any"]


# ── my_day ───────────────────────────────────────────────────────────────

def _followup(ctx, lead_id):
    _exec(ctx, f"insert into lead_followup(id,audience_response_id,institute_id,is_closed,schedule_time,created_by) "
               f"values('lf-{lead_id}','{lead_id}','I',false,'{NOW - timedelta(hours=2)}','{ctx.principal.user_id}')")


def _callback(ctx, lead_id):
    _exec(ctx, f"insert into telephony_call_log(id,response_id,institute_id,callback_at,counsellor_user_id,created_at) "
               f"values('tc-{lead_id}','{lead_id}','I','{NOW - timedelta(hours=2)}','{ctx.principal.user_id}',"
               f"'{NOW - timedelta(days=1)}')")


def _ai(ctx, lead_id):
    _exec(ctx, f"insert into telephony_call_log(id,response_id,institute_id,created_at) "
               f"values('ta-{lead_id}','{lead_id}','I','{NOW - timedelta(hours=3)}');"
               f"insert into ai_call_result(id,call_log_id,institute_id,created_at,follow_up,lead_rating) "
               f"values('ar-{lead_id}','ta-{lead_id}','I','{NOW - timedelta(hours=2)}','CALL',9)")


@pytest.mark.parametrize("seed, code", [(_followup, "followup_overdue"), (_callback, "callback_overdue"),
                                        (_ai, "ai_call_asks_for_call")])
@pytest.mark.parametrize("lead_id, shown", [
    ("n1", True), ("g_mother", True), ("re_new", False), ("k_newer", False), ("u_newer", False),
    ("f_old", False), ("f_flag", False), ("lo_live", False), ("lo_list", False), ("g_father", False),
    ("k_parent", False), ("u_new", False), ("re_flag", False), ("nu_row", False),
])
async def test_real_driver_my_day_follows_the_rule_for_each_reason(real_ctx, seed, code, lead_id, shown):
    seed(real_ctx, lead_id)
    out = await _run(real_ctx, action="my_day", limit=50)
    assert "Could not read" not in " ".join(out["notes"])
    items = {i["lead_id"]: i for i in out["items"]}
    assert (lead_id in items) is shown
    assert out["by_reason"].get(code, 0) == (1 if shown else 0)
    if shown:
        assert items[lead_id]["reason_code"] == code


async def test_real_driver_my_day_new_today_follows_the_rule(real_ctx):
    today = NOW.strftime("%Y-%m-%d %H:%M:%S")
    _exec(real_ctx, _ROW + _r("t_never", "web3", "never", phone="9000000001", at=today) + ","
          + _r("t_reenq", "web3", "reenq", phone="9000000004", at=today) + ","
          + _r("t_kid", "web3", "dad3", student="kid2", phone="9000000008", at=today))
    out = await _run(real_ctx, action="my_day", limit=50)
    assert {i["lead_id"] for i in out["items"]} == {"t_never"}


# ── add_lead and import_leads ────────────────────────────────────────────

@pytest.fixture
def intake(real_ctx, be, monkeypatch):
    """The real match statement and the real preview and apply, with the list checks and token steps passed over."""
    async def checks(ctx, args):
        return {"list": {"list_id": "web3", "name": "Web 3"}, "source": "MANUAL", "fields": [],
                "scope": await cd.sql_scope(ctx)}

    async def both_steps(ctx, args, *, preview, apply, **kwargs):
        shown = await preview()
        return {"preview": shown, "reply": await apply(shown.pop("_summary", None))}

    monkeypatch.setattr(edit, "_intake_checks", checks)
    monkeypatch.setattr(cd, "preview_or_apply", both_steps)
    return real_ctx


def _new_lead_text(text):
    return "will not appear in crm_leads list, export or my_day" in text and "stay refused" in text


@pytest.mark.parametrize("phone", ["9000000003", "9000000002", "9000000004"], ids=["list-only", "flagged", "re-enquiry"])
async def test_real_driver_add_lead_says_what_happens_to_someone_who_opted_out(intake, be, phone):
    be.admin_core.on("POST", edit.SUBMIT_PATH, "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6")
    refused = await edit._add_lead({"list_id": "web3", "name": "Asha", "phone": phone}, intake)
    assert refused["error"] == "opted_out" and _new_lead_text(refused["message"])
    both = await edit._add_lead({"list_id": "web3", "name": "Asha", "phone": phone, "re_enquiry": True}, intake)
    assert _new_lead_text(both["preview"]["warning"]) and both["preview"]["re_enquiry_of"]["matching_leads"]
    assert all("opted_out" in x["flags"] for x in both["preview"]["re_enquiry_of"]["matching_leads"])
    assert both["reply"]["done"] is True and _new_lead_text(both["reply"]["opt_out_note"])


async def test_real_driver_add_lead_finds_a_person_through_a_deleted_row_when_the_list_row_has_no_contact(intake):
    _exec(intake, _ROW + _r("g_gone", "web", "gone", status="INACTIVE", phone="9000000030", at="2026-09-01") + ","
          + _r("g_list", "optl", "gone", source="OPT_OUT", at="2026-09-02"))
    out = await edit._add_lead({"list_id": "web3", "name": "Asha", "phone": "9000000030"}, intake)
    assert out["error"] == "opted_out"


@pytest.mark.parametrize("phone, error", [("9000000001", "already_lead"), ("9000000007", "already_lead")],
                         ids=["never-opted-out", "linked-student-only"])
async def test_real_driver_add_lead_keeps_already_lead_for_anyone_else(intake, be, phone, error):
    be.admin_core.on("POST", edit.SUBMIT_PATH, "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6")
    out = await edit._add_lead({"list_id": "web3", "name": "Asha", "phone": phone}, intake)
    assert out["error"] == error and "will not appear" not in out["message"]
    both = await edit._add_lead({"list_id": "web3", "name": "Asha", "phone": phone, "re_enquiry": True}, intake)
    assert "warning" not in both["preview"] and "opt_out_note" not in both["reply"]


async def test_real_driver_import_leaves_out_someone_only_on_an_opt_out_list_and_says_so(intake, be):
    be.admin_core.on("POST", edit.BULK_SUBMIT_PATH, {"summary": {"successful": 1}, "results": []})
    rows = [{"name": "Listed", "phone": "9000000003"}, {"name": "New", "phone": "9000000099"}]
    both = await edit._import_leads({"list_id": "web3", "rows": rows, "re_enquiry": True}, intake)
    assert [r["row"] for r in both["preview"]["rows"]] == [1]
    assert both["preview"]["dropped"][0]["row"] == 0 and "opted out" in both["preview"]["dropped"][0]["reason"]
    assert _new_lead_text(both["preview"]["opt_out_note"])
    assert both["reply"]["not_added_because_they_opted_out"] == [0] and _new_lead_text(both["reply"]["opt_out_note"])
    sent = be.admin_core.called(edit.BULK_SUBMIT_PATH)[0]["body"]["rows"]
    assert [r["user_dto"]["mobile_number"] for r in sent] == ["9000000099"]


async def test_real_driver_import_with_only_opted_out_rows_says_so_and_sends_nothing(intake, be):
    out = await edit._import_leads({"list_id": "web3", "rows": [{"name": "Listed", "phone": "9000000003"}],
                                    "re_enquiry": True}, intake)
    assert out["error"] == "nothing_to_import" and _new_lead_text(out["opt_out_note"])
    assert be.admin_core.called(edit.BULK_SUBMIT_PATH) == []


# ── assign and reassign ──────────────────────────────────────────────────

def _assign_answer(method, path, params, body):
    return {"assignments": [{"user_id": u, "to_user_id": body.get("target_user_id")} for u in body["user_ids"]]}


@pytest.fixture
def assign(real_ctx, be):
    be.counsellors({"c-2": "Ravi Kumar"})
    be.admin_core.on("POST", team.ASSIGN_PREVIEW_PATH, _assign_answer)

    async def run(lead_ids, **extra):
        s = await cd.sql_scope(real_ctx)
        extra = extra or {"to_counsellor_id": "c-2"}
        return await team._assign_preview(real_ctx, s, {"lead_ids": lead_ids, **extra})
    return run


async def test_real_driver_the_opted_out_check_covers_flags_and_opt_out_lists(real_ctx):
    assert team._opted_out(real_ctx, ["reenq", "never", "mother", "listonly"]) == {"reenq", "listonly"}


@pytest.mark.parametrize("lead_id, reason", [
    ("lo_live", {"opted_out": 1}),
    ("f_old", {"opted_out": 1}),
    ("re_new", {"opted_out": 1}),
    ("u_newer", {"opted_out": 1}),
    ("k_parent", {"opted_out": 1}),
    ("k_newer", {"opted_out": 1}),
    ("lo_list", {"opt_out_list_row": 1}),
    ("nl_list", {"opt_out_list_row": 1}),
])
async def test_real_driver_assign_skips_by_the_list_rule_with_a_reason(assign, be, lead_id, reason):
    out = await assign([lead_id])
    assert out["error"] == "nothing_to_assign" and out["skipped"]["by_reason"] == reason
    assert be.admin_core.called(team.ASSIGN_PREVIEW_PATH) == []


async def test_real_driver_assign_keeps_a_listed_lead_and_reports_the_rest(assign, be):
    out = await assign(["n1", "lo_live", "lo_list", "k_parent"])
    assert out["people"] == 1 and out["changes"][0]["lead_ids"] == ["n1"]
    assert out["skipped"]["by_reason"] == {"opted_out": 2, "opt_out_list_row": 1}
    assert be.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"]["user_ids"] == ["never"]


@pytest.mark.parametrize("lead_ids, user", [
    (["lo_list"], "listonly"),
    (["lo_live", "lo_list"], "listonly"),
    (["so_list"], "soleflag"),
    (["so_flag", "so_list"], "soleflag"),
])
async def test_real_driver_unassign_clears_the_owner_whichever_row_is_named(real_ctx, assign, be, lead_ids, user):
    _exec(real_ctx, _ROW + _r("so_flag", "web", "soleflag", flag="OPTED_OUT", phone="9000000020", at="2026-09-01") + ","
          + _r("so_list", "optl", "soleflag", source="OPT_OUT", phone="9000000020", at="2026-09-02"))
    _exec(real_ctx, "insert into user_lead_profile(id,user_id,institute_id,assigned_counselor_id) "
                    "values('p-soleflag','soleflag','I','c-2')")
    out = await assign(lead_ids, mode="unassign")
    assert out["people"] == 1 and out["changes"][0]["lead_user_id"] == user and out["skipped"] is None
    assert be.admin_core.called(team.ASSIGN_PREVIEW_PATH)[0]["body"] == {
        "institute_id": "I", "user_ids": [user], "mode": "UNASSIGN"}


async def test_real_driver_unassign_at_confirm_acts_on_the_person_and_names_no_row(real_ctx, assign, be):
    be.admin_core.on("POST", team.ASSIGN_PATH, lambda *a: {"total_leads": 1, "assignments": [
        {"user_id": "listonly", "to_user_id": None}]})
    s = await cd.sql_scope(real_ctx)
    me = real_ctx.principal.user_id
    out = await team._assign_apply(real_ctx, s, {"mode": "unassign", "to": None, "plan": {"listonly": None},
                                                 "lead_ids": {"listonly": ["lo_list"]}, "from": {"listonly": me}})
    assert out["applied"] is True and out["skipped"] is None
    assert be.admin_core.called(team.ASSIGN_PATH)[0]["body"] == {
        "institute_id": "I", "user_ids": ["listonly"], "mode": "UNASSIGN"}


async def test_real_driver_assign_decides_on_the_named_leads_that_are_not_deleted(real_ctx, assign, be):
    _exec(real_ctx, _ROW + _r("kp_del", "web2", "dad2", status="INACTIVE", phone="9000000007", at="2026-08-01") + ","
          + _r("del_a", "web", "gone", status="INACTIVE", phone="9000000021", at="2026-08-01") + ","
          + _r("mix_del", "web", "dad3", status="INACTIVE", phone="9000000008", at="2026-08-01") + ","
          + _r("mix_ok", "web2", "dad3", phone="9000000008", at="2026-08-02"))
    out = await assign(["k_parent", "kp_del"])
    assert out["error"] == "nothing_to_assign" and out["skipped"]["by_reason"] == {"opted_out": 1}
    for only_deleted in ("kp_del", "del_a"):
        out = await assign([only_deleted])
        assert out["error"] == "nothing_to_assign" and out["skipped"]["by_reason"] == {"deleted": 1}
    out = await assign(["k_newer", "mix_ok", "mix_del"])
    assert out["people"] == 1 and out["changes"][0]["lead_user_id"] == "dad3"
    assert be.admin_core.called(team.ASSIGN_PREVIEW_PATH)[-1]["body"]["user_ids"] == ["dad3"]


async def _open(ctx):
    s = await cd.sql_scope(ctx)
    keep, dropped = team._movable(s, team._open_profiles(ctx, s, ctx.principal.user_id))
    return {r["lead_user_id"]: r["lead_id"] for r in keep}, {d["lead_user_id"]: d for d in dropped}


async def test_real_driver_reassign_moves_only_people_lists_show(real_ctx):
    keep, dropped = await _open(real_ctx)
    assert keep == {"never": "n1", "mother": "g_mother", "elsewhere": "x_live"}
    assert set(dropped) == {"flagged", "listonly", "reenq", "father", "kid2", "dad2", "dad3", "upd", "self", "nullsub",
                            "deleted"}
    assert all(d["reason"] == "opted_out" for d in dropped.values())


async def test_real_driver_reassign_never_names_an_opt_out_list_row(real_ctx):
    _, dropped = await _open(real_ctx)
    assert dropped["listonly"]["lead_ids"] == ["lo_live"]
    assert dropped["flagged"]["lead_ids"] != ["f_list"]
    assert dropped["reenq"]["lead_ids"] == ["re_new"]


async def test_real_driver_reassign_shows_a_person_by_the_lead_lists_show(real_ctx):
    # The newer lead is linked to a student who opted out; the older one stands alone and is listed.
    _exec(real_ctx, _ROW + _r("ks_own", "web", "dad5", phone="9000000023", at="2026-09-01") + ","
          + _r("ks_linked", "web2", "dad5", student="kid2", phone="9000000023", at="2026-10-01"))
    _exec(real_ctx, f"insert into user_lead_profile(id,user_id,institute_id,assigned_counselor_id) "
                    f"values('p-dad5','dad5','I','{real_ctx.principal.user_id}')")
    keep, _ = await _open(real_ctx)
    assert keep["dad5"] == "ks_own"


# ── status and tier by lead_id ───────────────────────────────────────────

@pytest.fixture
def previews(real_ctx, monkeypatch):
    """The real target selection and preview, with the token step passed over."""
    async def preview_only(ctx, args, *, preview, **kwargs):
        return await preview()

    monkeypatch.setattr(cd, "preview_or_apply", preview_only)
    _exec(real_ctx, "insert into lead_status(id,status_key,institute_id,label) values('st-1','INTERESTED','I','Interested');"
                    "insert into lead_tier(id,tier_key,institute_id,is_active,min_score,display_order) "
                    "values('ti-1','HOT','I',true,80,1)")
    return real_ctx


@pytest.mark.parametrize("lead_id, reason", [
    ("lo_live", "opted out: change it in the admin portal"),
    ("f_old", "opted out: change it in the admin portal"),
    ("re_new", "opted out: change it in the admin portal"),
    ("k_parent", "linked student opted out: change it in the admin portal"),
    ("lo_list", "a row of an opt-out list: not a lead"),
    ("nl_list", "a row of an opt-out list: not a lead"),
])
async def test_real_driver_a_status_change_skips_by_the_list_rule_with_a_reason(previews, lead_id, reason):
    out = await edit._set_status({"lead_ids": [lead_id], "status": "INTERESTED"}, previews)
    assert out["applied"] is False and {"lead_id": lead_id, "reason": reason} in out["skipped"]


async def test_real_driver_a_status_change_never_reaches_a_siblings_opt_out_list_row(previews):
    out = await edit._set_status({"lead_ids": ["lo_live"], "status": "INTERESTED"}, previews)
    assert {s["lead_id"] for s in out["skipped"]} == {"lo_live"}
    out = await edit._set_status({"lead_ids": ["f_old"], "status": "INTERESTED"}, previews)
    assert {s["lead_id"] for s in out["skipped"]} == {"f_old"}


async def test_real_driver_a_status_change_keeps_a_listed_lead_and_reports_the_rest(previews):
    out = await edit._set_status({"lead_ids": ["n1", "lo_live", "lo_list", "k_parent"], "status": "INTERESTED"},
                                 previews)
    assert [x["lead_id"] for x in out["leads"]] == ["n1"] and out["count"] == 1
    assert {s["lead_id"] for s in out["skipped"]} == {"lo_live", "lo_list", "k_parent"}


@pytest.fixture
def logging_status(previews, monkeypatch):
    """log_interaction on the real lead row, with admin-core's writes recorded."""
    sent = []

    async def no_automations(*a, **k):
        return []

    async def activity(ctx, lead, kind, note, meta, title=None):
        return {"event_id": "ev-1"}

    async def apply_status(ctx, lead_id, status_id):
        sent.append((lead_id, status_id))
        return {"status_changed": True}

    monkeypatch.setattr(cd, "automations_for", no_automations)
    monkeypatch.setattr(cd, "write_activity", activity)
    monkeypatch.setattr(edit, "_apply_status_one", apply_status)
    return previews, sent


@pytest.mark.parametrize("lead_id, reason", [
    ("lo_live", "opted out: change it in the admin portal"),
    ("f_old", "opted out: change it in the admin portal"),
    ("re_new", "opted out: change it in the admin portal"),
    ("k_parent", "linked student opted out: change it in the admin portal"),
    ("lo_list", "a row of an opt-out list: not a lead"),
])
async def test_real_driver_logging_with_a_status_saves_the_note_and_keeps_the_status_by_the_list_rule(
        logging_status, lead_id, reason):
    ctx, sent = logging_status
    out = await edit._log_interaction({"lead_id": lead_id, "note": "spoke", "status": "INTERESTED"}, ctx)
    assert sent == [] and out["done"] is True and out["saved"]["activity"] == {"event_id": "ev-1"}
    assert out["status"] == {"status": "INTERESTED", "label": "Interested", "applied": False, "reason": reason}
    assert "status_change_waiting" not in out


async def test_real_driver_logging_with_a_status_applies_it_to_a_listed_lead(logging_status):
    ctx, sent = logging_status
    out = await edit._log_interaction({"lead_id": "n1", "note": "spoke", "status": "INTERESTED"}, ctx)
    assert sent == [("n1", "st-1")] and out["saved"]["status"]["status"] == "INTERESTED"
    assert "status" not in out


async def test_real_driver_logging_with_a_status_at_confirm_says_why_nothing_waits(logging_status):
    ctx, sent = logging_status
    out = await edit._log_interaction({"lead_id": "lo_live", "note": "spoke", "status": "INTERESTED",
                                       "confirm_token": "t"}, ctx)
    assert sent == [] and out["error"] == "nothing_to_confirm"
    assert out["status"]["reason"] == "opted out: change it in the admin portal"


@pytest.mark.parametrize("lead_id, reason", [
    ("lo_live", "opted out: change it in the admin portal"),
    ("re_new", "opted out: change it in the admin portal"),
    ("k_parent", "linked student opted out: change it in the admin portal"),
    ("lo_list", "a row of an opt-out list: not a lead"),
])
async def test_real_driver_a_tier_change_skips_by_the_list_rule_with_a_reason(previews, lead_id, reason):
    out = await edit._set_tier({"lead_ids": [lead_id], "tier": "HOT"}, previews)
    assert out["applied"] is False and out["skipped"] == [{"lead_id": lead_id, "reason": reason}]


async def test_real_driver_a_tier_change_keeps_a_listed_lead(previews):
    out = await edit._set_tier({"lead_ids": ["n1", "lo_live"], "tier": "HOT"}, previews)
    assert [x["lead_id"] for x in out["leads"]] == ["n1"] and len(out["skipped"]) == 1


# ── the words ────────────────────────────────────────────────────────────

def test_the_rule_is_stated_where_people_read_it():
    text = cd.OPT_OUT_RULE_TEXT
    assert "by person, not by number or email" in text and "another guardian" in text
    assert "whatever the date" in text and "opt-out list" in text
    assert "linked_student_opted_out" in text and "counts as opted out" not in text
    assert "own contact" not in text
    for words in (text, cd.LINKED_STUDENT_OPT_OUT_NOTE):
        assert "Message sends check the person's id, number and email" in words
        assert "calls check the row and the person's id" in words
    assert "never shown in lists, export or my_day; find and get can still open one" in text
    assert "on this person's own record" in cd.OPT_OUT_READD_NOTE
    assert "under a different account counts as a different person" in cd.OPT_OUT_READD_NOTE
    assert text in m.CRM_LEADS_SCHEMA["function"]["parameters"]["properties"]["filter"]["description"]
    assert "person.opted_out is true when list leaves out every one of them" in m.CRM_LEADS_SCHEMA["function"]["description"]
    assert "own contact" not in m.CRM_LEADS_SCHEMA["function"]["description"]
    assert cd.OPT_OUT_READD_NOTE in edit.INTAKE_SCHEMA["function"]["description"]
