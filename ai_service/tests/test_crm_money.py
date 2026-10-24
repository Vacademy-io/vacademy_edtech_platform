"""
crm_collections / crm_payment_reminders — fees and payments over MCP.

Pinned here: reads resolve the lead (or the caller's people) in the CRM scope
first and anchor every money read on the pinned institute; the dues and plan
breakdown endpoints get only person ids taken from this institute's lead rows;
institute-wide collections and every reminder are for institute admins;
contacts and payment references are masked and every figure carries its
definitions; reminders are two-step with single-use tokens over the exact
previewed bills (no reminder POST before the confirm; replay / mismatch
refused; foreign, paid, closed and opted-out bills refused before admin-core
is called), capped per hour per bill, and logged as REACHOUT on the lead.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

# The registry first, as the app loads it.
import app.services.assistant_tool_registry  # noqa: E402,F401
from app.models.crm_confirm import CrmConfirm  # noqa: E402
from app.services import assistant_tools_crm_money as money  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import entitlements as ent  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS  # noqa: E402
from crm_fakes import CrmBackend, confirm_db, lead_row, make_ctx  # noqa: E402

TODAY = date(2030, 1, 15)


class _Ent:
    def __init__(self):
        self.off = set()
        self.mode = "MANAGED"

    def on(self, key):
        return key not in self.off


@pytest.fixture
def plan(monkeypatch):
    state = _Ent()
    monkeypatch.setattr(ent, "entitlements", lambda db, inst: state)
    return state


@pytest.fixture
def backend(monkeypatch, plan):
    b = CrmBackend().install(monkeypatch)
    monkeypatch.setattr(money, "_today", lambda ctx: TODAY)
    monkeypatch.setattr(money, "_invoice_email_on", lambda ctx: True)
    b.lead_scope("ADMIN")
    b.counsellors({"c-1": "Asha Rao", "c-2": "Bala K"})
    b.admin_core.on("POST", cd.TIMELINE_EVENT_PATH, {"id": "ev-1"})
    return b


@pytest.fixture
def tctx():
    return make_ctx(db=confirm_db())


def counsellor(db=None):
    return make_ctx("c-1", ("COUNSELLOR",), db=db)


async def read(ctx, **args):
    return json.loads(await money.execute_crm_collections(args, ctx))


async def write(ctx, **args):
    return json.loads(await money.execute_crm_payment_reminders(args, ctx))


def _lead(backend, *rows):
    """Lead SELECTs (resolve_lead) answer ``rows``; every crm_money statement has its own, more specific handler."""
    backend.sql.handlers.append(("FROM audience_response ar", list(rows)))


def _people(backend, people):
    """crm_money.people: pid → (lead_id, owner, opted_out, in_scope)."""
    def answer(params, sql):
        out = []
        for pid in params["pids"]:
            if pid in people:
                lead_id, owner, opted, in_scope = people[pid]
                out.append({"pid": pid, "lead_id": lead_id, "lead_user_id": pid, "parent_name": "Lead " + pid,
                            "parent_mobile": "+91 98765 4" + pid[-4:].rjust(4, "0"),
                            "parent_email": pid + "@example.com", "owner_id": owner,
                            "lead_in_scope": in_scope, "opted_out": opted, "any_in_scope": in_scope})
        return out
    backend.sql.on("crm_money.people", answer)


def _money_calls(backend):
    return [c for c in backend.admin_core.calls if "/student-fee/" in c["path"] or "/user-plan/" in c["path"]
            or "/invoices/" in c["path"]]


def _reminder_posts(backend):
    return [c for c in backend.admin_core.calls if c["path"].endswith("/send-reminder")]


# ── registration ─────────────────────────────────────────────────────────

def test_tools_are_registered_mcp_only_off_by_default_and_tied_to_crm_and_money_modules():
    for name, group, mode in (("crm_collections", "crm_collections", "READ"),
                              ("crm_payment_reminders", "crm_payment_reminders", "WRITE")):
        spec = ASSISTANT_TOOLS[name]
        assert spec is money.CRM_MONEY_TOOLS[name]
        assert spec.mcp_only and not spec.default_enabled and spec.default_roles is None
        assert spec.key() == group and spec.mode == mode
        assert spec.module_feature == "crm.leads"
        assert spec.module_features_any == ("finance.fees", "finance.memberships")
        props = spec.schema["function"]["parameters"]["properties"]
        assert "user_id" not in props and "institute_id" not in props
        assert set(props["action"]["enum"]) == set(money.ACTION_SPEC[name])
        for action, meta in money.ACTION_SPEC[name].items():
            assert set(meta) == {"summary", "writes", "confirm", "feature", "admin_only"}, action
            if mode == "READ":
                assert meta["writes"] is False and meta["confirm"] == "none"
    w = money.WRITE_ACTION_SPEC
    assert w["send_installment_reminder"]["confirm"] == w["send_invoice_reminder"]["confirm"] == "single_use"
    assert w["send_installment_reminder"]["admin_only"] and w["send_invoice_reminder"]["admin_only"]
    assert money.READ_ACTION_SPEC["collections"]["admin_only"]
    assert money.INSTALLMENT_PURPOSE == cd.purpose_of("crm_payment_reminders", "send_installment_reminder")
    assert money.INVOICE_PURPOSE == cd.purpose_of("crm_payment_reminders", "send_invoice_reminder")


async def test_unknown_action_identity_guard_and_learners(backend):
    out = await read(make_ctx(), action="balance")
    assert out["error"] == "unknown_action" and out["available"] == list(money.READ_ACTION_SPEC)
    out = await read(make_ctx(), action="lead_dues", requested_user_id="u-9")
    assert out["error"] == "use_lead_id"
    out = await read(make_ctx("s-1", ("STUDENT",)), action="who_owes")
    assert out["error"] == "not_available_for_role"
    assert _money_calls(backend) == [] and backend.sql.calls == []


# ── lead_dues ────────────────────────────────────────────────────────────

def _dues_routes(backend):
    backend.admin_core.on("POST", money.PLAN_BREAKDOWN_PATH, [
        {"user_plan_id": "up-1", "course_name": "NEET 2027", "plan_status": "ACTIVE",
         "payment_type": "Custom Installment",
         "billed": 60000.0, "paid": 20000.0, "due": 20000.0, "upcoming": 0.0, "counts_towards_due": True,
         "currency": "INR"}])
    backend.admin_core.on("POST", "/admin-core-service/v1/admin/student-fee/", {
        "content": [
            {"id": "b-2", "cpo_name": "NEET plan", "fee_type_name": "Tuition", "amount_expected": 20000,
             "amount_paid": 0, "amount_due": 20000, "due_date": "2030-02-10", "status": "PENDING",
             "is_overdue": False, "days_overdue": None},
            {"id": "b-1", "cpo_name": "NEET plan", "fee_type_name": "Tuition", "amount_expected": 20000,
             "amount_paid": 0, "amount_due": 18000, "adjustment_type": "CONCESSION", "adjustment_status": "APPROVED",
             "adjustment_amount": 2000, "due_date": 1893456000000, "status": "PENDING", "is_overdue": True,
             "days_overdue": 14}],
        "total_fee": 40000, "total_paid": 0, "total_due": 38000})
    backend.sql.on("crm_money.lead_people", [{"pid": "u-1"}])
    backend.sql.on("crm_money.pending_invoices", [
        {"invoice_id": "inv-1", "invoice_number": "INV-0042", "pid": "u-1", "amount": 1500, "currency": "INR",
         "invoice_date": None, "due_on": date(2030, 1, 1), "source": "ADMIN_MANUAL"}])
    backend.sql.on("crm_money.payments", [
        {"id": "pl-1", "payment_status": "PAID", "payment_amount": 20000.0, "currency": "INR", "created_at": None,
         "vendor": "OFFLINE", "payment_mode": "UPI", "payment_sub_mode": "PHONEPE",
         "payment_reference": "UTR 4455 6677 8899", "course": "NEET 2027"}])


async def test_lead_dues_reads_the_dues_and_breakdown_endpoints_for_the_leads_person_only(backend):
    _lead(backend, lead_row("r-1", "u-1"))
    _dues_routes(backend)
    out = await read(make_ctx(), action="lead_dues", lead_id="r-1")
    assert out["people"] == ["u-1"] and out["phone"].endswith("3210") and "98765" not in out["phone"]
    [dues] = backend.admin_core.called("/admin-core-service/v1/admin/student-fee/")
    assert dues["path"] == "/admin-core-service/v1/admin/student-fee/u-1/dues"
    assert dues["params"] == {"instituteId": "inst-1"} and dues["body"] == {"fetch_all": True}
    [plans] = backend.admin_core.called(money.PLAN_BREAKDOWN_PATH)
    assert plans["params"] == {"userId": "u-1"} and plans["body"] == {"institute_id": "inst-1"}
    sched = out["installments"]
    assert [i["bill_id"] for i in sched["schedule"]] == ["b-1", "b-2"]
    assert sched["schedule"][0]["due_date"] == "2030-01-01" and sched["schedule"][0]["overdue"] is True
    assert sched["schedule"][0]["adjustment"]["type"] == "CONCESSION"
    assert sched["overdue_count"] == 1 and sched["overdue_amount"] == 18000 and sched["total_due"] == 38000
    assert out["enrolments"][0]["overdue"] == 20000 and out["enrolments"][0]["counts_towards_due"] is True
    assert out["pending_invoices"][0]["invoice_id"] == "inv-1" and out["pending_invoices"][0]["overdue"] is True
    pay = out["last_payments"][0]
    assert pay["reference"] == "******8899" and "4455" not in json.dumps(out) and pay["mode"] == "UPI"
    assert {"person", "installment_due", "overdue", "owes"} <= set(out["definitions"])
    for _sql, params in backend.sql.matching("crm_money."):
        if "pids" in params:
            assert params["pids"] == ["u-1"] and params["inst"] == "inst-1"


async def test_lead_dues_refuses_another_counsellors_lead_before_any_money_call(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _lead(backend, lead_row("r-9", "u-9", owner_id="c-2", in_scope=False))
    _dues_routes(backend)
    out = await read(counsellor(), action="lead_dues", lead_id="r-9")
    assert out["error"] == "out_of_scope"
    assert _money_calls(backend) == [] and backend.sql.matching("crm_money.") == []


async def test_lead_dues_of_another_institutes_lead_is_unknown(backend):
    _lead(backend)                                     # the institute-anchored lead SELECT finds nothing
    _dues_routes(backend)
    out = await read(make_ctx(), action="lead_dues", lead_id="r-other")
    assert out["error"] == "unknown_lead" and _money_calls(backend) == []


# ── who_owes / due_soon ──────────────────────────────────────────────────

def _owes_rows(params, sql):
    rows = [{"pid": "u-1", "overdue": 18000, "outstanding": 38000, "oldest_due": date(2030, 1, 1),
             "next_due": date(2030, 2, 10), "items": 2, "overdue_items": 1, "courses": "NEET 2027",
             "kinds": "INSTALLMENT", "currencies": "INR"},
            {"pid": "u-2", "overdue": 1500, "outstanding": 1500, "oldest_due": None, "next_due": None, "items": 1,
             "overdue_items": 1, "courses": "Invoice", "kinds": "INVOICE", "currencies": "INR"}]
    return [{**r, "people": 2, "total_overdue": 19500, "total_outstanding": 39500, "all_currencies": "INR"}
            for r in rows]


async def test_who_owes_admin_sees_the_institute_masked_with_counsellor_and_definitions(backend):
    backend.sql.on("crm_money.who_owes", _owes_rows)
    _people(backend, {"u-1": ("r-1", "c-1", False, True), "u-2": ("r-2", None, True, True)})
    out = await read(make_ctx(), action="who_owes", sort="days")
    [(sql, params)] = backend.sql.matching("crm_money.who_owes")
    assert "scoped AS" not in sql and params["inst"] == "inst-1" and params["today"] == TODAY
    assert "p.oldest_due ASC" in sql and "oldest_due <= :cutoff" not in sql
    p1 = out["people"][0]
    assert p1["lead_id"] == "r-1" and p1["counsellor"] == {"counsellor_id": "c-1", "name": "Asha Rao"}
    assert p1["days_overdue"] == 14 and p1["currency"] == "INR" and p1["phone"].startswith("*")
    assert "@example.com" not in p1["email"][1:4] and p1["email"].startswith("u***@")
    assert out["people"][1]["opted_out"] is True and "note" in out
    assert out["totals"]["people"] == 2 and out["totals"]["overdue"] == {"amount": 19500.0, "currency": "INR"}
    assert {"owes", "installment_due", "overdue", "scope"} <= set(out["definitions"])
    assert out["scope"] == "whole institute"


async def test_who_owes_for_a_counsellor_is_cut_to_their_people(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    backend.sql.on("crm_money.who_owes", [])
    out = await read(counsellor(), action="who_owes", min_days_overdue=7)
    [(sql, params)] = backend.sql.matching("crm_money.who_owes")
    assert "scoped AS MATERIALIZED" in sql and "sfp.user_id IN (SELECT pid FROM scoped)" in sql
    assert "inv.user_id IN (SELECT pid FROM scoped)" in sql and "up.user_id IN (SELECT pid FROM scoped)" in sql
    assert params["scope_owners"] == ["c-1"] and params["scope_inst"] == "inst-1"
    assert params["cutoff"] == TODAY - timedelta(days=7)
    assert out["people"] == [] and out["scope"] == "people behind the leads you can see"


async def test_who_owes_argument_errors(backend):
    assert (await read(make_ctx(), action="who_owes", status="paid"))["error"] == "invalid_argument"
    assert (await read(make_ctx(), action="who_owes", sort="name"))["error"] == "invalid_argument"
    assert (await read(make_ctx(), action="who_owes", limit="x"))["error"] == "invalid_argument"


async def test_due_soon_caps_the_horizon_and_lists_bills_and_invoices(backend):
    def rows(params, sql):
        return [{"item_id": "b-2", "pid": "u-1", "kind": "INSTALLMENT", "installment_number": 2, "course": "NEET 2027",
                 "amount": 20000, "due_on": date(2030, 1, 20), "currency": "INR", "total": 2, "total_amount": 21500,
                 "people": 2, "currencies": "INR"},
                {"item_id": "inv-7", "pid": "u-2", "kind": "INVOICE", "installment_number": None, "course": "Invoice",
                 "amount": 1500, "due_on": date(2030, 1, 22), "currency": "INR", "total": 2, "total_amount": 21500,
                 "people": 2, "currencies": "INR"}]
    backend.sql.on("crm_money.due_soon", rows)
    _people(backend, {"u-1": ("r-1", "c-1", False, True), "u-2": ("r-2", "c-1", False, True)})
    out = await read(make_ctx(), action="due_soon", days=365)
    [(_sql, params)] = backend.sql.matching("crm_money.due_soon")
    assert out["days"] == 60 and params["until"] == TODAY + timedelta(days=60)
    assert out["items"][0]["bill_id"] == "b-2" and out["items"][0]["days_left"] == 5
    assert out["items"][1]["invoice_id"] == "inv-7"
    assert out["totals"] == {"items": 2, "people": 2, "amount": {"amount": 21500.0, "currency": "INR"}}
    assert "installment_due" in out["definitions"]


# ── collections (admins) ─────────────────────────────────────────────────

def _grouped(**over):
    base = {"g_day": 1, "g_method": 1, "g_course": 1, "g_owner": 1, "g_currency": 1, "day": None, "method": None,
            "mode": None, "course": None, "owner_id": None, "currency": None, "amount": 0, "payments": 0, "payers": 0,
            "currencies": None}
    base.update(over)
    return base


async def test_collections_totals_breakdowns_and_previous_period(backend):
    backend.sql.on("crm_money.collections_total", [{"amount": 50000, "payments": 5, "payers": 4,
                                                    "currencies": "INR"}])
    backend.sql.on("crm_money.collections\n", [
        _grouped(amount=80000, payments=6, payers=5, currencies="INR,USD"),
        _grouped(g_day=0, day=date(2030, 1, 10), amount=80000, payments=6, payers=5),
        _grouped(g_method=0, method="OFFLINE", mode="UPI", amount=30000, payments=2, payers=2),
        _grouped(g_method=0, method="RAZORPAY", amount=50000, payments=4, payers=3),
        _grouped(g_course=0, course="NEET 2027", amount=80000, payments=6, payers=5),
        _grouped(g_owner=0, owner_id="c-1", amount=60000, payments=4, payers=3),
        _grouped(g_owner=0, owner_id=None, amount=20000, payments=2, payers=2),
        _grouped(g_currency=0, currency="INR", amount=79900, payments=5, payers=4),
        _grouped(g_currency=0, currency="USD", amount=100, payments=1, payers=1)])
    out = await read(make_ctx(), action="collections", period="last_30_days", compare_to="previous_period")
    assert out["totals"]["amount"] == 80000 and out["totals"]["payments"] == 6
    assert out["totals"]["currency"] == ["INR", "USD"] and "note" in out
    assert out["by_method"][0] == {"method": "RAZORPAY", "mode": None, "amount": 50000.0, "payments": 4, "payers": 3}
    assert out["by_method"][1]["mode"] == "UPI"
    assert out["by_counsellor"][0]["counsellor"] == {"counsellor_id": "c-1", "name": "Asha Rao"}
    assert out["by_counsellor"][1]["counsellor"] is None
    assert out["by_day"] == [{"date": "2030-01-10", "amount": 80000.0, "payments": 6, "payers": 5}]
    prev = out["previous_period"]
    assert prev["amount"] == 50000 and prev["change"] == 30000 and prev["change_pct"] == 60.0
    assert prev["window"]["to"] == "2029-12-16" and out["window"]["from"] == "2029-12-17"
    assert {"collected", "method", "course", "counsellor", "currency", "window"} <= set(out["definitions"])
    [(_sql, params)] = backend.sql.matching("crm_money.collections\n")
    assert params["inst"] == "inst-1" and params["tz"] == cd.DEFAULT_TZ


async def test_collections_is_for_institute_admins_only(backend):
    for mode in ("COUNSELLOR_TREE", "DEFAULT", "SUB_ORG"):
        backend.lead_scope(mode, owner_ids=["c-1"])
        ctx = counsellor() if mode != "SUB_ORG" else make_ctx("so-1", ("ADMIN",))
        out = await read(ctx, action="collections")
        assert out["error"] == "admin_only", mode
    assert backend.sql.matching("crm_money.") == []


# ── converted_not_paid / abandoned_checkouts ─────────────────────────────

async def test_converted_not_paid_lists_people_with_flags_in_the_window(backend):
    backend.sql.on("crm_money.converted_not_paid", [
        {"pid": "u-1", "converted_at": None, "profile_owner_id": "c-2", "enrolled": True, "checkout_open": False,
         "total": 1}])
    _people(backend, {"u-1": ("r-1", None, False, True)})
    out = await read(make_ctx(), action="converted_not_paid", days=7)
    [(sql, params)] = backend.sql.matching("crm_money.converted_not_paid")
    assert "scoped AS" not in sql and params["inst"] == "inst-1"
    assert params["w_to"] - params["w_from"] == timedelta(days=7)
    assert out["people"][0]["counsellor"] == {"counsellor_id": "c-2", "name": "Bala K"}
    assert out["people"][0]["enrolled"] is True and out["totals"]["people"] == 1
    assert {"converted", "not_paid", "window"} <= set(out["definitions"])


async def test_converted_not_paid_for_a_counsellor_uses_their_people(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    backend.sql.on("crm_money.converted_not_paid", [])
    await read(counsellor(), action="converted_not_paid")
    [(sql, params)] = backend.sql.matching("crm_money.converted_not_paid")
    assert "ulp.user_id IN (SELECT pid FROM scoped)" in sql and params["scope_owners"] == ["c-1"]


async def test_abandoned_checkouts(backend):
    backend.sql.on("crm_money.abandoned_checkouts", [
        {"pid": "u-3", "attempts": 2, "last_at": None, "last_amount": 4999, "currency": "INR",
         "course": "Crash course", "last_status": "FAILED", "method": "RAZORPAY", "people": 1}])
    _people(backend, {"u-3": ("r-3", "c-1", False, True)})
    out = await read(make_ctx(), action="abandoned_checkouts", period="last_7_days")
    [(sql, params)] = backend.sql.matching("crm_money.abandoned_checkouts")
    assert "stale" in params and params["inst"] == "inst-1"
    assert out["people"][0]["attempts"] == 2 and out["people"][0]["last_status"] == "FAILED"
    assert "abandoned" in out["definitions"]
    out = await read(make_ctx(), action="abandoned_checkouts", days=400)
    assert out["error"] == "invalid_window"


# ── reminders ────────────────────────────────────────────────────────────

BILLS = {
    "b-1": {"item_id": "b-1", "pid": "u-1", "installment_number": 1, "item_status": "PENDING", "plan_status": "ACTIVE",
            "course": "NEET 2027", "amount_expected": 20000, "amount_paid": 0, "amount": 18000,
            "due_on": date(2030, 1, 1), "currency": "INR"},
    "b-2": {"item_id": "b-2", "pid": "u-2", "installment_number": 3, "item_status": "PARTIAL_PAID",
            "plan_status": "ACTIVE", "course": "NEET 2027", "amount_expected": 20000, "amount_paid": 5000,
            "amount": 15000, "due_on": date(2030, 1, 5), "currency": "INR"},
    "b-paid": {"item_id": "b-paid", "pid": "u-1", "installment_number": 2, "item_status": "PAID",
               "plan_status": "ACTIVE", "course": "NEET 2027", "amount_expected": 20000, "amount_paid": 20000,
               "amount": 0, "due_on": date(2029, 12, 1), "currency": "INR"},
    "b-opt": {"item_id": "b-opt", "pid": "u-9", "installment_number": 1, "item_status": "PENDING",
              "plan_status": "ACTIVE", "course": "JEE", "amount_expected": 9000, "amount_paid": 0, "amount": 9000,
              "due_on": date(2029, 12, 20), "currency": "INR"},
}
PEOPLE = {"u-1": ("r-1", "c-1", False, True), "u-2": ("r-2", None, False, True), "u-9": ("r-9", "c-1", True, True)}


def _reminder_setup(backend, bills=None, people=None, automations=True):
    bills = BILLS if bills is None else bills

    def candidates(params, sql):
        if "ids" in params:
            return [dict(bills[i]) for i in params["ids"] if i in bills]
        return [dict(b) for b in bills.values() if b["amount"] > 0 and b["item_status"] != "PAID"]
    backend.sql.on("crm_money.bill_candidates", candidates)
    _people(backend, people or PEOPLE)
    if automations:
        backend.sql.on("FROM workflow_trigger t", [{"trigger_id": "t-1", "event_id": None, "workflow_id": "w-1",
                                                     "workflow_name": "Fee due reminder", "updated_at": None}])
        backend.sql.on("FROM workflow_node_mapping m", [{"workflow_id": "w-1", "node_type": "SEND_WHATSAPP", "n": 1},
                                                         {"workflow_id": "w-1", "node_type": "SEND_EMAIL", "n": 1}])
    backend.admin_core.on("POST", "/admin-core-service/v1/invoices/", lambda m, path, p, b: {
        "invoice_id": path.split("/")[-2], "invoice_number": "INV-0042", "recipient_email": "learner@example.com",
        "email_sent": True, "alert_sent": True, "payment_link": "https://pay.example.com/x"})
    backend.admin_core.on("POST", "/admin-core-service/v1/invoices/sfp/", lambda m, path, p, b: {
        "student_fee_payment_id": path.split("/")[-2], "reminder_type": "OVERDUE",
        "recipient_email": "parent@example.com", "workflow_result": {"w-1": "STARTED"}})


REMIND = {"action": "send_installment_reminder", "bill_ids": ["b-1", "b-2"]}


async def test_reminders_are_for_institute_admins_only(backend, tctx):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _reminder_setup(backend)
    out = await write(counsellor(tctx.db), **REMIND)
    assert out["error"] == "admin_only"
    out = await write(counsellor(tctx.db), action="send_invoice_reminder", invoice_ids=["inv-1"])
    assert out["error"] == "admin_only"
    assert backend.sql.matching("crm_money.") == [] and _money_calls(backend) == []


async def test_preview_sends_nothing_and_says_which_automation_and_channels(backend, tctx):
    _reminder_setup(backend)
    out = await write(tctx, **REMIND)
    assert out["applied"] is False and out["confirm_token"].startswith("vcc_")
    assert [t["bill_id"] for t in out["will_remind"]] == ["b-1", "b-2"]
    t1 = out["will_remind"][0]
    assert t1["days_overdue"] == 14 and t1["amount_due"] == 18000 and t1["reminder_type"] == "OVERDUE"
    assert t1["person"]["phone"].startswith("*") and "@example.com" in t1["person"]["email"]
    assert t1["person"]["email"].startswith("u***@")
    chan = out["goes_out_through"]
    assert chan["fires"] == "INSTALLMENT_DUE_REMINDER" and chan["channels"] == ["email", "whatsapp"]
    assert chan["automations"][0]["name"] == "Fee due reminder"
    assert out["total_due"] == {"amount": 33000.0, "currency": "INR"}
    assert _reminder_posts(backend) == [] and backend.admin_core.called(cd.TIMELINE_EVENT_PATH) == []
    row = tctx.db.query(CrmConfirm).one()
    assert json.loads(row.summary_json) == {"targets": ["b-1", "b-2"]} and row.purpose == money.INSTALLMENT_PURPOSE
    [(_sql, params)] = backend.sql.matching("crm_money.bill_candidates")
    assert params["inst"] == "inst-1" and params["ids"] == ["b-1", "b-2"]


async def test_confirm_sends_exactly_the_previewed_bills_and_logs_reachout(backend, tctx):
    _reminder_setup(backend)
    token = (await write(tctx, **REMIND))["confirm_token"]
    out = await write(tctx, **REMIND, confirm_token=token)
    assert out["applied"] is True and out["sent"] == 2 and out["activity_logged"] == 2
    assert [c["path"] for c in _reminder_posts(backend)] == [
        "/admin-core-service/v1/invoices/sfp/b-1/send-reminder",
        "/admin-core-service/v1/invoices/sfp/b-2/send-reminder"]
    assert all(c["body"] is None for c in _reminder_posts(backend))
    assert out["reminders"][0]["sent_to"] == "p***@example.com" and out["reminders"][0]["automations_started"]
    events = backend.admin_core.called(cd.TIMELINE_EVENT_PATH, "POST")
    assert [e["body"]["type_id"] for e in events] == ["r-1", "r-2"]
    assert all(e["body"]["action_type"] == "REACHOUT" and e["body"]["type"] == "AUDIENCE_RESPONSE" for e in events)
    assert events[0]["body"]["metadata"]["bill_id"] == "b-1" and events[0]["body"]["student_user_id"] == "u-1"
    assert tctx.db.query(CrmConfirm).populate_existing().one().outcome == "done"
    replay = await write(tctx, **REMIND, confirm_token=token)
    assert replay["error"] == "confirm_token_used" and len(_reminder_posts(backend)) == 2


async def test_a_token_for_other_bills_is_refused(backend, tctx):
    _reminder_setup(backend)
    token = (await write(tctx, **REMIND))["confirm_token"]
    other = await write(tctx, action="send_installment_reminder", bill_ids=["b-1"], confirm_token=token)
    assert other["error"] == "confirm_token_mismatch"
    bogus = await write(tctx, **REMIND, confirm_token="vcc_" + "x" * 40)
    assert bogus["error"] == "confirm_token_invalid"
    assert _reminder_posts(backend) == []


async def test_foreign_institute_bill_ids_are_refused_before_admin_core(backend, tctx):
    _reminder_setup(backend)
    out = await write(tctx, action="send_installment_reminder", bill_ids=["b-1", "b-of-inst-2"])
    assert out["error"] == "unknown_bill" and out["ids"] == ["b-of-inst-2"]
    assert _money_calls(backend) == [] and tctx.db.query(CrmConfirm).count() == 0
    out = await write(tctx, action="send_installment_reminder", bill_ids=["bad id!"])
    assert out["error"] == "unknown_bill"


async def test_paid_and_opted_out_bills_are_refused(backend, tctx):
    _reminder_setup(backend)
    out = await write(tctx, action="send_installment_reminder", bill_ids=["b-paid", "b-opt"])
    assert out["error"] == "nothing_to_remind"
    assert out["skipped"]["by_reason"]["already_paid"]["count"] == 1
    assert out["skipped"]["by_reason"]["opted_out"]["count"] == 1
    out = await write(tctx, action="send_installment_reminder", bill_ids=["b-1", "b-paid", "b-opt"])
    assert [t["bill_id"] for t in out["will_remind"]] == ["b-1"]
    assert {x["id"] for x in out["skipped"]["examples"]} == {"b-paid", "b-opt"}
    assert _reminder_posts(backend) == []


async def test_a_bill_paid_after_the_preview_is_skipped_at_confirm(backend, tctx):
    bills = {k: dict(v) for k, v in BILLS.items()}
    _reminder_setup(backend, bills=bills)
    token = (await write(tctx, **REMIND))["confirm_token"]
    bills["b-2"].update(item_status="PAID", amount=0, amount_paid=20000)
    out = await write(tctx, **REMIND, confirm_token=token)
    assert out["sent"] == 1 and [c["path"].split("/")[-2] for c in _reminder_posts(backend)] == ["b-1"]
    assert out["skipped"]["examples"] == [{"id": "b-2", "reason": "already_paid"}]


async def test_overdue_rule_selects_scoped_open_bills_and_skips_opted_out(backend, tctx):
    _reminder_setup(backend)
    out = await write(tctx, action="send_installment_reminder", overdue_more_than_days=7)
    [(sql, params)] = backend.sql.matching("crm_money.bill_candidates")
    assert params["cutoff"] == TODAY - timedelta(days=7) and "ids" not in params
    assert "sfp.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED', 'PAID')" in sql
    assert [t["bill_id"] for t in out["will_remind"]] == ["b-1", "b-2"]
    assert out["skipped"]["examples"] == [{"id": "b-opt", "reason": "opted_out"}]


async def test_no_active_automation_means_nothing_would_be_sent(backend, tctx):
    _reminder_setup(backend, automations=False)
    out = await write(tctx, **REMIND)
    assert out["error"] == "no_reminder_automation" and "confirm_token" not in out


async def test_hourly_cap_counts_each_bill(backend, tctx, monkeypatch):
    monkeypatch.setattr(money, "BILLS_PER_HOUR", 3)
    _reminder_setup(backend)
    token = (await write(tctx, **REMIND))["confirm_token"]
    assert (await write(tctx, **REMIND, confirm_token=token))["sent"] == 2
    over = await write(tctx, **REMIND)
    assert over["error"] == "rate_limited" and over["remaining"] == 1
    one = {"action": "send_installment_reminder", "bill_ids": ["b-1"]}
    token = (await write(tctx, **one))["confirm_token"]
    monkeypatch.setattr(money, "BILLS_PER_HOUR", 2)                      # e.g. another batch landed meanwhile
    refused = await write(tctx, **one, confirm_token=token)
    assert refused["error"] == "rate_limited" and "still works" in refused["message"]
    assert tctx.db.query(CrmConfirm).filter(CrmConfirm.spent_at.is_(None), CrmConfirm.revoked_at.is_(None)).count() == 1
    assert len(_reminder_posts(backend)) == 2
    quota = await write(tctx, action="quota")
    assert quota["reminders"]["used_last_hour"] == 2 and quota["reminders"]["remaining"] == 0


async def test_selection_errors(backend, tctx):
    assert (await write(tctx, action="send_installment_reminder"))["error"] == "missing_argument"
    many = {"action": "send_installment_reminder", "bill_ids": [f"b-{i}" for i in range(51)]}
    assert (await write(tctx, **many))["error"] == "too_many"
    both = {"action": "send_installment_reminder", "overdue_more_than_days": 3, "due_within_days": 3}
    assert (await write(tctx, **both))["error"] == "invalid_argument"
    mixed = {"action": "send_installment_reminder", "bill_ids": ["b-1"], "lead_id": "r-1"}
    assert (await write(tctx, **mixed))["error"] == "invalid_argument"
    assert _reminder_posts(backend) == []


async def test_installment_reminders_need_the_fees_module(backend, tctx, plan):
    plan.off.add("finance.fees")
    _reminder_setup(backend)
    out = await write(tctx, **REMIND)
    assert out["error"] == "module_not_enabled" and out["feature"] == "finance.fees"


INVOICES = {
    "inv-1": {"item_id": "inv-1", "pid": "u-1", "invoice_number": "INV-0042", "item_status": "PENDING_PAYMENT",
              "amount": 1500, "due_on": date(2030, 1, 1), "currency": "INR", "paid_mapped": False},
    "inv-paid": {"item_id": "inv-paid", "pid": "u-2", "invoice_number": "INV-0043", "item_status": "PENDING_PAYMENT",
                 "amount": 900, "due_on": None, "currency": "INR", "paid_mapped": True},
    "inv-rej": {"item_id": "inv-rej", "pid": "u-2", "invoice_number": "INV-0044", "item_status": "REJECTED",
                "amount": 900, "due_on": None, "currency": "INR", "paid_mapped": False},
}


async def test_invoice_reminder_two_step(backend, tctx):
    _reminder_setup(backend)
    backend.sql.on("crm_money.invoice_candidates",
                   lambda params, sql: [dict(INVOICES[i]) for i in params.get("ids", []) if i in INVOICES])
    args = {"action": "send_invoice_reminder", "invoice_ids": ["inv-1", "inv-paid", "inv-rej", "inv-x"]}
    out = await write(tctx, **args)
    assert out["error"] == "unknown_invoice" and out["ids"] == ["inv-x"]
    args["invoice_ids"] = ["inv-1", "inv-paid", "inv-rej"]
    out = await write(tctx, **args)
    assert [t["invoice_id"] for t in out["will_remind"]] == ["inv-1"]
    assert out["goes_out_through"]["channels"] == ["in_app", "email"]
    reasons = out["skipped"]["by_reason"]
    assert reasons["already_paid"]["count"] == 1 and reasons["not_pending"]["count"] == 1
    assert _reminder_posts(backend) == []
    done = await write(tctx, **args, confirm_token=out["confirm_token"])
    assert done["sent"] == 1 and done["reminders"][0]["email_sent"] is True
    assert done["reminders"][0]["sent_to"] == "l***@example.com" and "pay.example.com" not in json.dumps(done)
    assert [c["path"] for c in _reminder_posts(backend)] == ["/admin-core-service/v1/invoices/inv-1/send-reminder"]
    [event] = backend.admin_core.called(cd.TIMELINE_EVENT_PATH, "POST")
    assert event["body"]["type_id"] == "r-1" and event["body"]["metadata"]["invoice_id"] == "inv-1"


async def test_reminder_for_a_person_with_no_lead_says_the_activity_was_not_logged(backend, tctx):
    _reminder_setup(backend, people={"u-1": (None, None, False, False), "u-2": ("r-2", None, False, True)})
    token = (await write(tctx, **REMIND))["confirm_token"]
    out = await write(tctx, **REMIND, confirm_token=token)
    assert out["sent"] == 2 and out["activity_logged"] == 1
    assert out["activity_not_logged"]["ids"] == ["b-1"]


def test_module_never_names_blocked_endpoints():
    src = Path(money.__file__).read_text(encoding="utf-8")
    for bad in cd.NEVER_CALL:
        assert bad not in src


# ── collections group_by / date_basis ────────────────────────────────────

async def test_collections_group_by_state_with_previous_rows(backend):
    backend.sql.on("FROM institute_custom_fields icf", [{"id": "f-city", "field_key": "city", "field_name": "City"}])
    backend.sql.on("WITH people AS", [{"k": "pune", "n": 4}])
    current = [{"g": 0, "d1": "Maharashtra", "amount": 100, "payments": 2, "payers": 2, "currencies": "INR"},
               {"g": 0, "d1": None, "amount": 50, "payments": 1, "payers": 1, "currencies": "INR"},
               {"g": 3, "amount": 150, "payments": 3, "payers": 3, "currencies": "INR"}]
    previous = [{"g": 0, "d1": "Maharashtra", "amount": 80, "payments": 1, "payers": 1, "currencies": "INR"},
                {"g": 3, "amount": 80, "payments": 1, "payers": 1, "currencies": "INR"}]
    calls = []

    def grouped(params, sql):
        calls.append(params["w_from"])
        return current if len(calls) == 1 else previous

    backend.sql.on("crm_money.collections_grouped", grouped)
    out = await read(make_ctx(), action="collections", period="last_30_days", group_by=["state"],
                     compare_to="previous_period")
    assert out["group_by"] == ["state"] and out["date_basis"] == "paid_on"
    assert out["rows"][0] == {"state": "Maharashtra", "amount": 100.0, "payments": 2, "payers": 2,
                              "previous": {"amount": 80.0, "payments": 1, "payers": 1, "change": 20.0,
                                           "change_pct": 25.0}}
    assert out["rows"][1]["state"] == "(unknown)" and out["rows"][1]["previous"]["amount"] == 0.0
    assert out["totals"]["amount"] == 150 and out["previous_period"]["change_pct"] == 87.5
    [(sql, params)] = backend.sql.matching("crm_money.collections_grouped")[:1]
    assert "s.user_id = r.payer_id" in sql and params["geo_k"] == ["pune"] and params["gl1_city_ids"] == ["f-city"]
    assert "pl.date = CAST(pl.created_at AS date)" in sql and len(calls) == 2 and calls[1] < calls[0]


async def test_collections_group_by_month_and_source_and_recorded_on(backend):
    backend.sql.on("crm_money.collections_grouped", [
        {"g": 0, "d1": "2030-01", "d2": "WEBSITE", "amount": 10, "payments": 1, "payers": 1},
        {"g": 0, "d1": "2029-12", "d2": "~no_lead~", "amount": 30, "payments": 1, "payers": 1},
        {"g": 1, "d1": "2030-01", "amount": 10, "payments": 1, "payers": 1},
        {"g": 1, "d1": "2029-12", "amount": 30, "payments": 1, "payers": 1},
        {"g": 2, "d2": "WEBSITE", "amount": 10, "payments": 1, "payers": 1},
        {"g": 2, "d2": "~no_lead~", "amount": 30, "payments": 1, "payers": 1},
        {"g": 3, "amount": 40, "payments": 2, "payers": 2, "currencies": "INR"}])
    out = await read(make_ctx(), action="collections", days=60, group_by=["month", "source"],
                     date_basis="recorded_on")
    assert [r["month"] for r in out["rows"]] == ["2029-12", "2030-01"]
    assert out["rows"][0]["source"] == "(no lead)" and out["date_basis"] == "recorded_on"
    assert [s["month"] for s in out["subtotals"]["month"]] == ["2029-12", "2030-01"]
    assert out["subtotals"]["source"][0]["source"] == "(no lead)"
    [(sql, params)] = backend.sql.matching("crm_money.collections_grouped")
    assert "pl.created_at >= :w_from" in sql and "pl.date" not in sql and params["no_lead"] == "~no_lead~"
    assert "GROUPING SETS ((d1, d2), (d1), (d2), ())" in sql


@pytest.mark.parametrize("args", [
    {"group_by": ["state; drop table x"]},
    {"group_by": ["day", "month"]},
    {"group_by": ["state", "city", "month"]},
    {"group_by": ["list_tag:not ok!"]},
    {"group_by": ["state"], "date_basis": "someday"},
])
async def test_collections_group_by_refuses_unknown_input(backend, args):
    out = await read(make_ctx(), action="collections", **args)
    assert out["error"] == "invalid_argument"
    assert backend.sql.matching("crm_money.") == []
