"""
crm_reports revenue and custom reports on real Postgres: first- and last-touch
attribution of payments, and grouping leads and payments by the ad they came from.

The real-driver tests are skipped unless AI_LIMITS_PG_URL points at a throwaway Postgres.
"""
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402,F401
from app.services import assistant_tools_crm_reports as rep  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import entitlements as ent  # noqa: E402
from crm_fakes import CrmBackend, make_ctx  # noqa: E402

OCTOBER = {"from": "2026-10-01", "to": "2026-10-31"}


class _Ent:
    mode = "MANAGED"

    def on(self, key):
        return True


_DDL = """
create table audience(id varchar primary key, institute_id varchar, campaign_type text, campaign_name varchar,
    status varchar default 'ACTIVE', sub_org_id varchar, tags_json text);
create table audience_response(id varchar primary key, audience_id varchar, user_id varchar, student_user_id varchar,
    audience_status varchar, overall_status varchar, submitted_at timestamp, created_at timestamp,
    source_type varchar, enquiry_id varchar, lead_status_id varchar,
    ad_campaign_id varchar(100), ad_campaign_name varchar(255), ad_set_id varchar(100), ad_set_name varchar(255),
    ad_id varchar(100), ad_name varchar(255), ad_form_id varchar(100));
create table linked_users(id varchar primary key, user_id varchar, source varchar, source_id varchar,
    created_at timestamp);
create table user_lead_profile(id text primary key, user_id text, institute_id text, conversion_status varchar,
    converted_at timestamp, assigned_counselor_id varchar, lead_tier varchar, best_score int4,
    unique (user_id, institute_id));
create table lead_status(id text primary key, status_key varchar);
create table enroll_invite(id varchar primary key, institute_id varchar);
create table user_plan(id varchar primary key, user_id varchar, enroll_invite_id varchar);
create table invoice(id varchar primary key, institute_id varchar);
create table invoice_payment_log_mapping(id varchar primary key, payment_log_id varchar, invoice_id varchar);
create table payment_log(id varchar primary key, user_id varchar, user_plan_id varchar, payment_amount float8,
    currency varchar, payment_status varchar, date date, created_at timestamp);
"""

_SEED = """
insert into audience(id,institute_id,campaign_type,campaign_name) values
  ('web','I','WEB','Web'),('ads','I','WEB','Ads'),('else','OTHER','WEB','Other');
insert into enroll_invite values('ei','I'),('ei2','OTHER');
insert into user_plan values('up1','p1','ei'),('up2','p2','ei'),('up3','p3','ei'),('upx','p1','ei2');
insert into user_lead_profile(id,user_id,institute_id,conversion_status,converted_at,assigned_counselor_id) values
  ('l1','p1','I','CONVERTED','2026-10-11','c-1'),('l2','p2','I','CONVERTED','2026-10-14','c-1'),
  ('l3','p3','I','LEAD',null,'c-2');
-- p1: a Google lead in September, a Meta lead on 10 Oct, a walk-in on 25 Oct
insert into audience_response(id,audience_id,user_id,audience_status,submitted_at,created_at,source_type,
    ad_campaign_id,ad_campaign_name,ad_set_id,ad_set_name,ad_id,ad_name,ad_form_id) values
  ('r1','web','p1','ACTIVE','2026-09-01','2026-09-01','GOOGLE_LEAD_ADS','21345678901',null,'20000000002',null,
   '30000000003',null,'40000000001'),
  ('r2','ads','p1','ACTIVE','2026-10-10','2026-10-10','META_LEAD_ADS','120200000000000003','NEET 2027 leads',
   '120200000000000002','Students 17-19','120200000000000001','Carousel','444444444444'),
  ('r3','web','p1','ACTIVE','2026-10-25','2026-10-25','WALK_IN',null,null,null,null,null,null,null);
-- p2: the only lead came after the payment
insert into audience_response(id,audience_id,user_id,audience_status,submitted_at,created_at,source_type) values
  ('r4','web','p2','ACTIVE','2026-10-20','2026-10-20','WEBSITE');
-- p1 pays between the Meta lead and the walk-in, and again after the walk-in; p2 before its lead;
-- p3 (not converted) pays too; a payment through another institute's invite is not counted
insert into payment_log values
  ('pay1','p1','up1',1000,'INR','PAID','2026-10-12','2026-10-12 06:00'),
  ('pay2','p1','up1',500,'INR','PAID','2026-10-28','2026-10-28 06:00'),
  ('pay3','p2','up2',200,'INR','PAID','2026-10-15','2026-10-15 06:00'),
  ('pay4','p3','up3',300,'INR','PAID','2026-10-16','2026-10-16 06:00'),
  ('payx','p1','upx',9999,'INR','PAID','2026-10-16','2026-10-16 06:00');
"""


@pytest.fixture
def real_ctx(monkeypatch):
    url = os.environ.get("AI_LIMITS_PG_URL")
    if not url:
        pytest.skip("set AI_LIMITS_PG_URL to run on a throwaway Postgres")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    schema = "crm_attr_" + uuid.uuid4().hex[:12]
    admin = create_engine(url)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE SCHEMA {schema}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    assert engine.dialect.driver == "psycopg"
    with engine.begin() as c:
        c.exec_driver_sql(_DDL)
        c.exec_driver_sql(_SEED)
    be = CrmBackend()
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
    return json.loads(await rep.execute_crm_reports({**OCTOBER, **args}, ctx))


def _by_source(out):
    return {(s["source"] if isinstance(s["source"], str) else "(lead content)"): s["revenue"]
            for s in out["data"]["by_source"]}


async def test_real_driver_revenue_first_and_last_touch(real_ctx):
    first = await _report(real_ctx, action="revenue")
    last = await _report(real_ctx, action="revenue", attribution="last")
    assert first["attribution"] == "first" and last["attribution"] == "last"
    assert _by_source(first) == {"GOOGLE_LEAD_ADS": 1500.0, "WEBSITE": 200.0}
    # pay1 follows the Meta lead, pay2 the walk-in; p2's only lead came after its payment, so the first is used.
    assert _by_source(last) == {"META_LEAD_ADS": 1000.0, "WALK_IN": 500.0, "WEBSITE": 200.0}
    assert first["data"]["totals"] == last["data"]["totals"]
    assert first["data"]["totals"]["revenue"] == 1700.0
    assert first["data"]["reconciliation"] == last["data"]["reconciliation"]
    assert first["data"]["reconciliation"]["collected_all_payments"] == 2000.0


def _rows(out, dim):
    return {(r[dim][dim], r[dim][f"{dim}_id"]): r for r in out["rows"]}


async def test_real_driver_custom_groups_leads_by_their_ad(real_ctx):
    out = await _report(real_ctx, action="custom", group_by=["campaign"], metrics=["leads"])
    rows = _rows(out, "campaign")
    # October leads: the Meta one by name, and the walk-in and website ones with no ad.
    assert rows[("NEET 2027 leads", "120200000000000003")]["leads"] == 1
    assert rows[("(no ad)", None)]["leads"] == 2 and out["totals"]["leads"] == 3
    ad_sets = _rows(await _report(real_ctx, action="custom", group_by=["ad_set"], metrics=["leads"]), "ad_set")
    assert ("Students 17-19", "120200000000000002") in ad_sets
    ads = _rows(await _report(real_ctx, action="custom", group_by=["ad"], metrics=["leads"]), "ad")
    assert ("Carousel", "120200000000000001") in ads


async def test_real_driver_custom_revenue_by_campaign_first_and_last_touch(real_ctx):
    first = await _report(real_ctx, action="custom", group_by=["campaign"], metrics=["revenue", "collected"])
    last = await _report(real_ctx, action="custom", group_by=["campaign"], metrics=["revenue", "collected"],
                         attribution="last")
    assert first["attribution"] == "first" and last["attribution"] == "last"
    f, lt = _rows(first, "campaign"), _rows(last, "campaign")
    # First touch: p1's Google lead (no name, so its id), p2's website lead (no ad), p3 has no lead.
    assert f[("21345678901", "21345678901")]["revenue"] == 1500.0
    assert f[("(no ad)", None)]["revenue"] == 200.0
    assert f[("(no lead)", None)]["collected"] == 300.0
    # Last touch: pay1 goes to the Meta campaign; pay2 (walk-in) and pay3 (website) have no ad.
    assert lt[("NEET 2027 leads", "120200000000000003")]["revenue"] == 1000.0
    assert lt[("(no ad)", None)]["revenue"] == 700.0
    assert first["totals"]["revenue"] == last["totals"]["revenue"] == 1700.0
    assert first["totals"]["collected"] == last["totals"]["collected"] == 2000.0
