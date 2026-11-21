"""CreditService.get_usage_forecast: daily use is per calendar day, not per day that had usage."""
import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.credit_service import CreditService  # noqa: E402


def _forecast(total_usage, first_usage, balance="757.48", active_days=11, per_calendar_day=True):
    db = MagicMock()
    db.execute.return_value = SimpleNamespace(
        fetchone=lambda: SimpleNamespace(total_usage=total_usage, first_usage=first_usage, days_with_usage=active_days)
    )
    svc = CreditService.__new__(CreditService)
    svc.db = db
    svc.get_balance = MagicMock(return_value=SimpleNamespace(current_balance=Decimal(balance)))
    return svc.get_usage_forecast("inst-1", per_calendar_day=per_calendar_day)


def test_quiet_days_count_towards_the_average():
    # 1662 credits since 26 days ago. Over 11 active days this used to read 151 a day and 5 days left.
    out = _forecast(Decimal("1662.03"), datetime.utcnow() - timedelta(days=26))
    assert out.average_daily_usage == Decimal("61.56")
    assert out.estimated_days_remaining == 12


def test_first_use_today_is_one_day():
    out = _forecast(Decimal("10"), datetime.utcnow() - timedelta(hours=2), balance="100")
    assert out.average_daily_usage == Decimal("10.00")
    assert out.estimated_days_remaining == 10


def test_no_usage_gives_no_estimate():
    out = _forecast(Decimal("0"), None)
    assert out.average_daily_usage == Decimal("0.00")
    assert out.estimated_days_remaining is None


def test_the_portal_keeps_its_active_days_figure():
    out = _forecast(Decimal("1662.03"), datetime.utcnow() - timedelta(days=26), per_calendar_day=False)
    assert out.average_daily_usage == Decimal("151.09")
    assert out.estimated_days_remaining == 5
