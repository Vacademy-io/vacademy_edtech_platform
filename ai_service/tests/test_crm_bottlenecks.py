"""
crm_reports bottlenecks and days in status on one lead, on real Postgres.

Open leads per status by days in that status, how long leads took before moving
on, time to first contact and to convert, and how complete the status data is.

The real-driver tests are skipped unless AI_LIMITS_PG_URL points at a throwaway Postgres.
"""
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402,F401
from app.services import assistant_tools_crm_leads as leads  # noqa: E402
from app.services import assistant_tools_crm_reports as rep  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import entitlements as ent  # noqa: E402
from crm_fakes import CrmBackend, make_ctx  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


def ago(days):
    return (NOW - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


class _Ent:
    mode = "MANAGED"

    def on(self, key):
        return True


_DDL = """
create table audience(id varchar primary key, institute_id varchar, campaign_type text, campaign_name varchar,
    status varchar default 'ACTIVE', sub_org_id varchar);
create table audience_response(id varchar primary key, audience_id varchar, user_id varchar, student_user_id varchar,
    audience_status varchar, overall_status varchar, parent_name varchar, parent_mobile varchar, parent_email varchar,
    submitted_at timestamp, created_at timestamp, updated_at timestamp, source_type varchar, enquiry_id varchar,
    lead_status_id varchar, tat_due_override_at timestamp, tat_due_at timestamp,
    merged_from_user_id varchar);
create table linked_users(id varchar primary key, user_id varchar, source varchar, source_id varchar,
    created_at timestamp);
create table user_lead_profile(id text primary key, user_id text, institute_id text, conversion_status varchar,
    converted_at timestamp, assigned_counselor_id varchar, lead_tier varchar, best_score int4, updated_at timestamp,
    last_activity_at timestamp, first_response_at timestamp, merged_into_user_id text,
    unique (user_id, institute_id));
create table lead_status(id text primary key, status_key varchar, institute_id varchar, label varchar,
    display_order int4, is_default boolean default false, is_active boolean default true, deleted_at timestamp);
create table lead_status_history(id text primary key, audience_response_id text, institute_id varchar,
    from_status_id text, to_status_id text, changed_by_user_id varchar, source varchar, changed_at timestamp);
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
    created_at timestamp, category varchar, action_type varchar, actor_id varchar, actor_type varchar,
    title varchar, description text, metadata_json text, is_pinned boolean);
create table telephony_call_log(id varchar primary key, response_id varchar, subject_type varchar, subject_id varchar,
    user_id varchar, institute_id varchar, callback_at timestamp, counsellor_user_id varchar, created_at timestamp,
    disposition_key varchar, start_time timestamp, status varchar, direction varchar, provider_type varchar);
"""

STATUSES = {"LEAD": "st-new", "INTERESTED": "st-int", "CONVERTED": "st-con", "LOST": "st-lost",
            "NOT_INTERESTED": "st-no"}


def _lead(c, rid, age, status="LEAD", *, owner="c-1", source="WEBSITE", list_id="web", flag=None, active="ACTIVE"):
    user = f"u-{rid}"
    c.exec_driver_sql(
        "insert into audience_response(id,audience_id,user_id,audience_status,overall_status,source_type,created_at,"
        f"submitted_at,updated_at,lead_status_id) values('{rid}','{list_id}','{user}','{active}',"
        f"{repr(flag) if flag else 'null'},'{source}','{ago(age)}','{ago(age)}','{ago(age)}','{STATUSES[status]}')")
    inst = "OTHER" if list_id == "else" else "I"
    c.exec_driver_sql("insert into user_lead_profile(id,user_id,institute_id,conversion_status,"
                      f"assigned_counselor_id) values('p-{rid}','{user}','{inst}','{status}','{owner}')")


def _move(c, rid, age, to, frm=None, source="MANUAL", inst="I"):
    c.exec_driver_sql(
        "insert into lead_status_history(id,audience_response_id,institute_id,from_status_id,to_status_id,source,"
        f"changed_at) values('{uuid.uuid4().hex}','{rid}','{inst}',"
        f"{repr(STATUSES[frm]) if frm else 'null'},'{STATUSES[to]}','{source}','{ago(age)}')")


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

    schema = "crm_bn_" + uuid.uuid4().hex[:12]
    admin = create_engine(url)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE SCHEMA {schema}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    with engine.begin() as c:
        c.exec_driver_sql(_DDL)
        c.exec_driver_sql("""insert into audience(id,institute_id,campaign_type,campaign_name) values
            ('web','I','WEB','Web'),('ads','I','WEB','Ads'),('else','OTHER','WEB','Other')""")
        c.exec_driver_sql("""insert into lead_status(id,status_key,institute_id,label,display_order,is_default) values
            ('st-new','LEAD','I','New',1,true),('st-int','INTERESTED','I','Interested',2,false),
            ('st-con','CONVERTED','I','Converted',3,false),('st-lost','LOST','I','Lost',4,false),
            ('st-no','NOT_INTERESTED','I','Not interested',5,false)""")
        # never moved, enquired long ago
        _lead(c, "old", 40)
        # moved after 2 days, then waiting 10 days
        _lead(c, "waiting", 12, "INTERESTED", owner="c-2", source="META_LEAD_ADS", list_id="ads")
        _move(c, "waiting", 10, "INTERESTED", "LEAD")
        # from New straight on after 1 day, then 3 days in Interested and converted
        _lead(c, "won", 5, "CONVERTED")
        _move(c, "won", 4, "INTERESTED")
        _move(c, "won", 1, "CONVERTED", "INTERESTED")
        # the status came from a backfill: no real time in status, and no time counted
        _lead(c, "filled", 20, "INTERESTED")
        _move(c, "filled", 3, "INTERESTED", "LEAD", source="BACKFILL")
        # the latest change is not the current status, so the age comes from the enquiry
        _lead(c, "drifted", 9, "INTERESTED")
        _move(c, "drifted", 2, "LEAD", "INTERESTED")
        # left out: opted out, deleted, another institute
        _lead(c, "opted", 30, flag="OPTED_OUT")
        _lead(c, "gone", 30, active="INACTIVE")
        _lead(c, "elsewhere", 30, list_id="else")
        _lead(c, "listrow", 30, source="OPT_OUT")
        # the journey is over, by the status's name
        _lead(c, "done", 90, "NOT_INTERESTED", owner="c-3")
        _move(c, "elsewhere", 2, "INTERESTED", "LEAD", inst="OTHER")
        # a first response 60 minutes after the enquiry
        c.exec_driver_sql("insert into timeline_event(id,type,type_id,created_at,category,action_type,actor_type) values"
                          f"('te1','AUDIENCE_RESPONSE','won','{(NOW - timedelta(days=5) + timedelta(minutes=60)).strftime('%Y-%m-%d %H:%M:%S')}',"
                          "'ACTIVITY','NOTE','USER')")
    monkeypatch.setattr(cd.cbd, "admin_core", be.admin_core)
    monkeypatch.setattr(cd.ld, "auth_call", be._auth_call)
    monkeypatch.setattr(cd, "institute_tz", lambda ctx, purpose="reports": cd.DEFAULT_TZ)
    monkeypatch.setattr(ent, "entitlements", lambda db, inst: _Ent())
    be.lead_scope("ADMIN")
    be.user_names.update({"c-1": "Asha", "c-2": "Ravi"})
    be.counsellors({"c-1": "Asha", "c-2": "Ravi"})
    db = Session(bind=engine, future=True)
    try:
        yield make_ctx(db=db, institute_id="I")
    finally:
        db.close()
        engine.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        admin.dispose()


async def _report(ctx, **args):
    return json.loads(await rep.execute_crm_reports({"action": "bottlenecks", **args}, ctx))


def _stage(out, key):
    return next(s for s in out["data"]["stages"] if s["status"] == key)


async def test_real_driver_open_leads_per_status_by_days_in_that_status(real_ctx):
    out = await _report(real_ctx, days=60)
    new, interested = _stage(out, "LEAD"), _stage(out, "INTERESTED")
    assert new["leads_now"] == 1 and new["age"] == {"days_0_1": 0, "days_2_7": 0, "days_8_30": 0, "days_31_plus": 1}
    # waiting: 10 days since its change. filled and drifted: from the enquiry, 20 and 9 days.
    assert interested["leads_now"] == 3
    assert interested["age"] == {"days_0_1": 0, "days_2_7": 0, "days_8_30": 3, "days_31_plus": 0}
    assert interested["median_days_in_status"] == pytest.approx(10.0, abs=0.1)
    assert interested["age_from_enquiry"] == 2
    assert out["data"]["open_now"]["leads"] == 4


async def test_real_driver_a_status_that_looks_closed_stays_out_of_who_is_waiting(real_ctx):
    data = (await _report(real_ctx, days=120))["data"]
    closed = _stage({"data": data}, "NOT_INTERESTED")
    assert closed["looks_closed"] is True and closed["leads_now"] == 1
    assert _stage({"data": data}, "INTERESTED")["looks_closed"] is False
    assert data["open_now"]["leads"] == 4
    assert "c-3" not in [o["owner"]["user_id"] for o in data["by_owner"]]


@pytest.mark.parametrize("status, closed", [
    ("NOT_INTERESTED", True), ("WRONG_NUMBER", True), ("SALES_WON", True), ("IRRELEVANT", True), ("LOST", True),
    ("CALL_BACK", False), ("LEAD", False), ("DNP", False), ("INTERESTED", False), ("WANTED", False), (None, False)])
def test_a_status_looks_closed_by_its_name(status, closed):
    assert rep._looks_closed(status) is closed


async def test_real_driver_a_closed_lead_is_not_waiting_and_its_stays_still_count(real_ctx):
    out = await _report(real_ctx, days=60)
    assert _stage(out, "CONVERTED")["leads_now"] == 0
    assert _stage(out, "CONVERTED")["moved_out"] == 0
    assert _stage(out, "LOST")["leads_now"] == 0


async def test_real_driver_time_before_moving_runs_from_the_enquiry_and_skips_backfill(real_ctx):
    out = await _report(real_ctx, days=60)
    new, interested = _stage(out, "LEAD"), _stage(out, "INTERESTED")
    # waiting took 2 days and won 1 day, with no from status on won. The backfilled move counts but has no time.
    assert new["moved_out"] == 3
    assert new["median_days_before_moving"] == pytest.approx(1.5, abs=0.1)
    assert {m["status"]: m["moves"] for m in new["moved_to"]} == {"INTERESTED": 3}
    assert new["leads_timed"] == 2 and new["other_moves"] == 0
    # won spent 3 days in Interested, drifted went back after 7 days.
    assert interested["moved_out"] == 2
    assert interested["median_days_before_moving"] == pytest.approx(5.0, abs=0.1)
    assert {m["status"]: m["moves"] for m in interested["moved_to"]} == {"CONVERTED": 1, "LEAD": 1}
    assert interested["leads_timed"] == 2


async def test_real_driver_days_to_convert_run_from_the_enquiry(real_ctx):
    totals = (await _report(real_ctx, days=60))["data"]["totals"]
    assert totals["converted"] == 1
    assert totals["median_days_to_convert"] == pytest.approx(4.0, abs=0.1)


async def test_real_driver_first_contact_and_status_data_cover_the_windows_leads(real_ctx):
    totals = (await _report(real_ctx, days=60))["data"]["totals"]
    assert totals["leads_submitted"] == 5
    assert totals["contacted"] == 1 and totals["contacted_pct"] == 20.0
    assert totals["median_first_response_minutes"] == pytest.approx(60.0, abs=0.5)
    # waiting, won and drifted. filled has only a backfilled change, and old has none.
    assert totals["leads_with_status_change"] == 3


async def test_real_driver_the_window_sets_flow_but_not_who_is_waiting_now(real_ctx):
    out = await _report(real_ctx, days=1)
    assert out["data"]["open_now"]["leads"] == 4
    assert _stage(out, "INTERESTED")["leads_now"] == 3
    assert out["data"]["totals"]["leads_submitted"] == 0
    assert _stage(out, "LEAD")["moved_out"] == 0


async def test_real_driver_breakdowns_rank_by_who_has_the_most_leads_waiting(real_ctx):
    data = (await _report(real_ctx, days=60))["data"]
    assert [(o["owner"]["user_id"], o["leads"], o["leads_8_days_plus"]) for o in data["by_owner"]] == [
        ("c-1", 3, 3), ("c-2", 1, 1)]
    assert [(x["list"], x["leads"]) for x in data["by_list"]] == [("Web", 3), ("Ads", 1)]
    assert [(x["source"], x["leads"]) for x in data["by_source"]] == [("WEBSITE", 3), ("META_LEAD_ADS", 1)]


async def test_real_driver_a_counsellor_sees_only_their_own_leads(real_ctx, be):
    be.lead_scope("COUNSELLOR_TREE", owner_ids=["c-2"])
    ctx = make_ctx("c-2", ("COUNSELLOR",), db=real_ctx.db, institute_id="I")
    data = (await _report(ctx, days=60))["data"]
    assert data["open_now"]["leads"] == 1
    assert data["totals"]["leads_submitted"] == 1
    assert [o["owner"]["user_id"] for o in data["by_owner"]] == ["c-2"]


async def test_real_driver_a_filter_narrows_every_part(real_ctx):
    data = (await _report(real_ctx, days=60, source="META_LEAD_ADS"))["data"]
    assert data["open_now"]["leads"] == 1
    assert data["totals"]["leads_submitted"] == 1
    assert sum(s["moved_out"] for s in data["stages"]) == 1


async def test_real_driver_compare_to_compares_the_window_figures(real_ctx):
    out = await _report(real_ctx, days=10, compare_to="previous_period")
    assert "leads_submitted" in out["comparison"]["changes"]
    assert "open_now" not in out["comparison"]["changes"]


async def test_real_driver_get_shows_days_in_the_current_status(real_ctx):
    async def one(lead_id):
        return json.loads(await leads.execute_crm_leads({"action": "get", "lead_id": lead_id}, real_ctx))["lead"]
    waiting = await one("waiting")
    assert waiting["days_in_status"] == pytest.approx(10.0, abs=0.1)
    assert waiting["days_in_status_from"] == "status_change"
    old = await one("old")
    assert old["days_in_status"] == pytest.approx(40.0, abs=0.1)
    assert old["days_in_status_from"] == "enquiry"
    assert (await one("filled"))["days_in_status_from"] == "enquiry"
    assert (await one("drifted"))["days_in_status_from"] == "enquiry"


@pytest.mark.parametrize("leads_, with_status, quality", [
    (19, 19, "too_few_leads"), (20, 14, "good"), (20, 13, "partial"), (20, 6, "partial"), (20, 5, "too_thin"),
    (0, 0, "too_few_leads")])
def test_status_data_says_how_far_the_times_can_be_trusted(leads_, with_status, quality):
    assert rep._status_data(leads_, with_status) == quality


def _stage_row(key, stuck, timed=0, median=None, closed=False):
    return {"status": key, "label": key.title(), "leads_8_days_plus": stuck, "moved_out": timed, "leads_timed": timed,
            "median_days_before_moving": median, "looks_closed": closed, "age_from_enquiry": 0}


@pytest.mark.parametrize("quality", ["too_thin", "too_few_leads"])
def test_no_bottleneck_is_named_without_enough_status_data(quality):
    out = rep._reading(quality, 100, 1, [_stage_row("LEAD", 90, 50, 9.0)])
    assert out["largest_queue"] is None and out["slowest_status"] is None
    assert out["status_data"] == quality and out["note"]


@pytest.mark.parametrize("quality", ["good", "partial"])
def test_the_largest_queue_and_slowest_status_are_named_with_enough_data(quality):
    stages = [_stage_row("LEAD", 90, 50, 2.0), _stage_row("INTERESTED", 10, 12, 9.0), _stage_row("DEMO", 1, 9, 30.0)]
    out = rep._reading(quality, 100, 80, stages)
    assert out["largest_queue"]["status"] == "LEAD"
    assert out["slowest_status"]["status"] == "INTERESTED"


def test_a_status_that_looks_closed_is_never_named():
    stages = [_stage_row("NOT_INTERESTED", 900, 50, 90.0, closed=True), _stage_row("DNP", 10, 12, 9.0)]
    out = rep._reading("good", 100, 80, stages)
    assert out["largest_queue"]["status"] == "DNP" and out["slowest_status"]["status"] == "DNP"


def test_a_status_with_few_timed_leads_is_not_called_slowest():
    out = rep._reading("good", 100, 80, [_stage_row("DEMO", 0, 9, 30.0)])
    assert out["slowest_status"] is None and out["largest_queue"] is None


def test_many_moves_from_few_leads_do_not_make_a_status_slowest():
    stage = {**_stage_row("DNP", 0, 1, 98.0), "moved_out": 31}
    assert rep._reading("good", 100, 80, [stage])["slowest_status"] is None


async def test_real_driver_a_lead_moving_back_and_forth_counts_as_moves_and_one_timed_lead(real_ctx):
    conn = real_ctx.db.connection()
    _lead(conn, "bounce", 20)
    for i in range(6):
        _move(conn, "bounce", 19 - 2 * i, "INTERESTED", "LEAD")
        _move(conn, "bounce", 18 - 2 * i, "LEAD", "INTERESTED")
    real_ctx.db.commit()
    new = _stage(await _report(real_ctx, days=60), "LEAD")
    assert new["moved_out"] == 9
    assert new["leads_timed"] == 3


async def test_real_driver_backfilled_moves_count_as_moves_and_give_no_timed_lead(real_ctx):
    conn = real_ctx.db.connection()
    for i in range(4):
        _lead(conn, f"bf{i}", 20)
        _move(conn, f"bf{i}", 3, "INTERESTED", "LEAD", source="BACKFILL")
    real_ctx.db.commit()
    new = _stage(await _report(real_ctx, days=60), "LEAD")
    assert new["moved_out"] == 7
    assert new["leads_timed"] == 2


async def test_real_driver_destinations_past_the_first_few_add_up_as_other_moves(real_ctx):
    conn = real_ctx.db.connection()
    for i in range(7):
        key = f"S{i}"
        conn.exec_driver_sql(f"insert into lead_status(id,status_key,institute_id,label,display_order) "
                             f"values('st-{key}','{key}','I','{key}',{10 + i})")
        STATUSES[key] = f"st-{key}"
        _lead(conn, f"to{i}", 9)
        _move(conn, f"to{i}", 2, key, "LEAD")
    real_ctx.db.commit()
    try:
        new = _stage(await _report(real_ctx, days=60), "LEAD")
    finally:
        for i in range(7):
            STATUSES.pop(f"S{i}", None)
    assert new["moved_out"] == sum(m["moves"] for m in new["moved_to"]) + new["other_moves"]
    assert len(new["moved_to"]) == 5 and new["other_moves"] > 0
