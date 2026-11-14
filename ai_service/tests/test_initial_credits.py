"""A product's demo credits: the amount a new institute opens with, set only by a service."""
import os
import sys
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routers import credits as credits_router  # noqa: E402
from app.services.credit_service import CreditService, INITIAL_CREDITS  # noqa: E402


def _service():
    svc = CreditService.__new__(CreditService)
    svc.db = MagicMock()
    svc.get_balance = MagicMock(return_value=SimpleNamespace(current_balance=Decimal("0")))
    return svc


def _amounts(svc):
    params = [c.args[1] for c in svc.db.execute.call_args_list]
    return params[0]["total"], params[0]["balance"], params[1]["amount"], params[1]["balance"]


def test_default_stays_the_platform_amount():
    svc = _service()
    svc.create_initial_credits("i")
    assert _amounts(svc) == (INITIAL_CREDITS,) * 4


def test_a_product_amount_is_used_everywhere():
    svc = _service()
    svc.create_initial_credits("i", Decimal("250"))
    assert _amounts(svc) == (Decimal("250"),) * 4


def test_zero_is_an_amount_not_the_default():
    svc = _service()
    svc.create_initial_credits("i", Decimal("0"))
    assert _amounts(svc) == (Decimal("0"),) * 4


def _call(monkeypatch, *, internal, initial_credits):
    monkeypatch.setattr(credits_router, "_require_user_or_internal", lambda *a: None)
    monkeypatch.setattr(credits_router, "_internal_token_matches", lambda token: internal)
    service = MagicMock()
    service.get_balance.return_value = None
    credits_router.initialize_credits("i", initial_credits, service, {"id": "u"}, "t", "a")
    return service.create_initial_credits.call_args.args


def test_a_service_can_set_the_opening_amount(monkeypatch):
    assert _call(monkeypatch, internal=True, initial_credits=250) == ("i", Decimal(250))


def test_a_signed_in_admin_cannot_choose_their_own_balance(monkeypatch):
    assert _call(monkeypatch, internal=False, initial_credits=99999) == ("i", None)


def test_an_existing_wallet_is_left_alone(monkeypatch):
    monkeypatch.setattr(credits_router, "_require_user_or_internal", lambda *a: None)
    monkeypatch.setattr(credits_router, "_internal_token_matches", lambda token: True)
    service = MagicMock()
    service.get_balance.return_value = SimpleNamespace(current_balance=Decimal("5"))
    credits_router.initialize_credits("i", 250, service, None, "t", None)
    service.create_initial_credits.assert_not_called()
