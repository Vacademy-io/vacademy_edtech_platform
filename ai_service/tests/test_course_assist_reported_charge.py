"""Course assist reports what the WALLET was charged, not its flat price.

With an AI plan, an INCLUDED or ALLOWANCE use deducts 0 from the wallet (the
list price is still metered); the response used to echo the flat price, so the
editor showed credits spent that were not. A failed deduction still reports
the flat price, as before. No network, no DB.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_course_assist_reported_charge.py -q
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.models.ai_token_usage import RequestType  # noqa: E402
from ai_service.app.routers import course_assist as ca  # noqa: E402


@contextmanager
def _fake_session():
    yield object()


def _patch(monkeypatch, deduct):
    monkeypatch.setattr(ca, "db_session", _fake_session)
    monkeypatch.setattr(ca, "CreditService", lambda db: SimpleNamespace(deduct_credits=deduct))


def _charge():
    return ca._charge("inst-1", "user-1", Decimal("5"), RequestType.IMAGE, "m", "d", "run-1")


def test_plan_paid_use_reports_zero(monkeypatch):
    _patch(monkeypatch, lambda req: SimpleNamespace(credits_deducted=Decimal("0")))
    assert _charge() == Decimal("0")


def test_wallet_charge_reports_what_was_deducted(monkeypatch):
    _patch(monkeypatch, lambda req: SimpleNamespace(credits_deducted=Decimal("2.5")))
    assert _charge() == Decimal("2.5")


def test_failed_deduction_reports_the_flat_price(monkeypatch):
    def boom(req):
        raise RuntimeError("db down")
    _patch(monkeypatch, boom)
    assert _charge() == Decimal("5")
