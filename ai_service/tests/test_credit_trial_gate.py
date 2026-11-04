"""A self sign-up's trial: its end date stops AI spend, buying credits lifts it, nothing else is touched."""
import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.credit_service import CreditService  # noqa: E402
from app.schemas.credits import CreditCheckRequest  # noqa: E402


def _service(row):
    db = MagicMock()
    db.execute.return_value = SimpleNamespace(fetchone=lambda: row)
    svc = CreditService.__new__(CreditService)
    svc.db = db
    return svc


def test_no_row_is_not_a_trial():
    # Vacademy, Vimotion and every paying institute: the query filters them out.
    assert _service(None).get_trial_status("i") == {"is_trial": False, "expired": False, "days_left": None, "ends_at": None}


def test_running_trial_counts_days_up():
    row = SimpleNamespace(demo_expires_at=datetime.utcnow() + timedelta(days=2, hours=1), purchased=False)
    out = _service(row).get_trial_status("i")
    assert out["is_trial"] and not out["expired"] and out["days_left"] == 3


def test_lapsed_trial_is_expired():
    row = SimpleNamespace(demo_expires_at=datetime.utcnow() - timedelta(minutes=1), purchased=False)
    out = _service(row).get_trial_status("i")
    assert out["expired"] and out["days_left"] == 0


def test_purchase_ends_the_trial():
    row = SimpleNamespace(demo_expires_at=datetime.utcnow() - timedelta(days=9), purchased=True)
    assert _service(row).get_trial_status("i")["expired"] is False


def test_check_credits_refuses_a_lapsed_trial_with_a_balance():
    row = SimpleNamespace(demo_expires_at=datetime.utcnow() - timedelta(days=1), purchased=False)
    svc = _service(row)
    svc.get_balance = MagicMock(return_value=SimpleNamespace(current_balance=Decimal("100")))
    out = svc.check_credits(CreditCheckRequest(institute_id="i", request_type="content", estimated_tokens=10))
    assert out.has_sufficient_credits is False
    assert "trial" in out.message


def test_only_products_with_open_signup_are_looked_at():
    svc = _service(None)
    svc.get_trial_status("i")
    sql = str(svc.db.execute.call_args.args[0])
    assert "FROM platform_product p" in sql and "'FREE_TRIAL'" in sql
    assert "self_signup_enabled" not in sql, "closing sign-up must not lift lapsed trials"
    assert "evalezy" not in sql


def test_a_failed_read_never_blocks_ai():
    svc = _service(None)
    svc.db.execute.side_effect = RuntimeError("boom")
    assert svc.get_trial_status("i")["expired"] is False


def test_a_live_plan_is_not_a_trial(monkeypatch):
    from app.services import credit_service
    monkeypatch.setattr(credit_service, "_plan_live", lambda _i: True)
    row = SimpleNamespace(demo_expires_at=datetime.utcnow() - timedelta(days=1), purchased=False)
    assert _service(row).get_trial_status("i")["expired"] is False


def test_credits_granted_by_hand_count_as_bought():
    svc = _service(None)
    svc.get_trial_status("i")
    assert "'PURCHASE', 'ADMIN_GRANT'" in str(svc.db.execute.call_args.args[0])


def test_copy_check_quote_sees_no_balance_after_a_lapsed_trial():
    from app.services.tool_cost_estimator import ToolCostEstimator
    row = SimpleNamespace(demo_expires_at=datetime.utcnow() - timedelta(days=1), purchased=False)
    svc = _service(row)
    est = ToolCostEstimator.__new__(ToolCostEstimator)
    est.db = svc.db
    est.estimate = MagicMock(return_value={"estimated_credits": 5})
    from unittest.mock import patch
    with patch("app.services.credit_service.CreditService.get_balance",
               return_value=SimpleNamespace(current_balance=Decimal("100"))):
        out = est.estimate_with_balance("copy_check", {}, "i")
    assert out["current_balance"] == 0.0 and out["sufficient"] is False and out["trial_expired"] is True
