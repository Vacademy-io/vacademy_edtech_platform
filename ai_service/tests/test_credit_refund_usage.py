"""CreditService.refund_usage_charge: give back one earlier usage charge, capped, at most once."""
import os
import sys
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.credit_service import CreditService  # noqa: E402


def _service(charged, refunded):
    db = MagicMock()
    lookups = [None, SimpleNamespace(fetchone=lambda: SimpleNamespace(charged=charged, refunded=refunded))]
    db.execute.side_effect = lambda *a, **k: lookups.pop(0) if lookups else None
    svc = CreditService.__new__(CreditService)
    svc.db = db
    svc.refund_credits = MagicMock(return_value=SimpleNamespace(success=True, credits_deducted=Decimal("1")))
    return svc, db


def test_refunds_up_to_the_charge_under_its_key():
    svc, db = _service(Decimal("1.0000"), Decimal("0"))
    svc.refund_usage_charge("inst-1", "a-1", Decimal("5"), "Refund")
    svc.refund_credits.assert_called_once_with("inst-1", Decimal("1.0000"), "Refund", batch_id="a-1")
    assert "pg_advisory_xact_lock" in str(db.execute.call_args_list[0].args[0])


def test_already_refunded_gives_back_nothing():
    svc, db = _service(Decimal("1"), Decimal("1"))
    out = svc.refund_usage_charge("inst-1", "a-1", Decimal("1"))
    assert out.success is True and out.credits_deducted == Decimal("0")
    svc.refund_credits.assert_not_called()
    db.rollback.assert_called_once()


def test_nothing_charged_gives_back_nothing():
    svc, _ = _service(0, 0)
    out = svc.refund_usage_charge("inst-1", "a-1", Decimal("1"))
    assert out.credits_deducted == Decimal("0")
    svc.refund_credits.assert_not_called()
