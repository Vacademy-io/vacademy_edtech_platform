"""What counts as an API problem, when people hear about it, and what the email says.

Offline: no database and no network. The module loads from its file so these tests do not
need the service's other dependencies. The SQL itself is exercised separately on Postgres.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_external_api_alerts.py -q
"""
from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SERVICE = Path(__file__).resolve().parent.parent / "app" / "services" / "external_api_alerts.py"

spec = importlib.util.spec_from_file_location("external_api_alerts_under_test", SERVICE)
alerts = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = alerts
spec.loader.exec_module(alerts)

NOW = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)


def call(status="FAILED", http_status=500, error=None, minutes_ago=1):
    return {
        "status": status,
        "http_status": http_status,
        "error_message": error,
        "occurred_at": NOW - timedelta(minutes=minutes_ago),
    }


def test_five_failures_in_a_row_is_failing():
    problem = alerts.classify([call() for _ in range(5)], 5, NOW)

    assert (problem.kind, problem.consecutive, problem.http_status) == (alerts.FAILING, 5, 500)


def test_400s_count_too():
    assert alerts.classify([call(http_status=400) for _ in range(5)], 5, NOW).kind == alerts.FAILING


def test_fewer_than_the_threshold_is_nothing():
    assert alerts.classify([call() for _ in range(4)], 5, NOW) is None


def test_one_success_breaks_the_run():
    rows = [call(), call(), call("SUCCESS", 200), call(), call(), call()]

    assert alerts.classify(rows, 5, NOW) is None


def test_the_latest_call_succeeding_is_nothing():
    rows = [call("SUCCESS", 200)] + [call() for _ in range(10)]

    assert alerts.classify(rows, 5, NOW) is None


def test_a_run_that_stopped_over_an_hour_ago_is_no_longer_failing():
    assert alerts.classify([call(minutes_ago=61) for _ in range(5)], 5, NOW) is None


def test_one_402_is_enough_for_out_of_credits():
    problem = alerts.classify([call(http_status=402)], 5, NOW)

    assert (problem.kind, problem.consecutive) == (alerts.CREDITS, 1)


def test_out_of_credits_stays_open_when_nobody_is_calling():
    assert alerts.classify([call(http_status=402, minutes_ago=600)], 5, NOW).kind == alerts.CREDITS


def test_out_of_credits_is_found_behind_a_newer_network_error():
    rows = [call(http_status=None, error="ReadTimeout"), call(http_status=402)]

    assert alerts.classify(rows, 5, NOW).kind == alerts.CREDITS


def test_a_success_after_a_402_clears_it():
    assert alerts.classify([call("SUCCESS", 200), call(http_status=402)], 5, NOW) is None


@pytest.mark.parametrize(
    "error",
    [
        'HTTP 400: Bad Request: {"message":"Not enough credits"}',
        "Your credit balance is too low to access the API",
        "You exceeded your current quota",
        "insufficient_quota",
        "Insufficient balance",
        "WATI sendSessionFile result=false: out of credits",
    ],
)
def test_vendors_saying_the_balance_is_gone(error):
    assert alerts.looks_out_of_credits(400, error)


@pytest.mark.parametrize("error", [None, "HTTP 400: Bad Request", "ReadTimeout", "HTTP 429: Too Many Requests"])
def test_ordinary_failures_are_not_out_of_credits(error):
    assert not alerts.looks_out_of_credits(400, error)


def test_reminders_wait_for_the_repeat_interval():
    assert alerts.is_due(None, 6, NOW)
    assert not alerts.is_due(NOW - timedelta(hours=5, minutes=59), 6, NOW)
    assert alerts.is_due(NOW - timedelta(hours=6), 6, NOW)


def test_emails_keep_the_valid_distinct_addresses():
    assert alerts.parse_emails("a@b.co, not-an-email, a@b.co,,c@d.io ") == ["a@b.co", "c@d.io"]
    assert alerts.parse_emails(None) == []
    assert alerts.invalid_emails("a@b.co, not-an-email,") == ["not-an-email"]


def test_account_comes_from_the_key_details_staff_entered():
    details = {"OPENROUTER_API_KEY:ab12": {"account": "finance@example.com"}, "SERPER_API_KEYS:cd34": {"notes": "x"}}

    assert alerts.account_for(details, "ab12") == "finance@example.com"
    assert alerts.account_for(details, "cd34") is None
    assert alerts.account_for(details, "zzzz") is None


def notice(**kwargs):
    defaults = dict(event="opened", vendor="openrouter.ai", key_hint="ab12", kind=alerts.CREDITS,
                    consecutive=1, http_status=402)
    return alerts.Notice(**{**defaults, **kwargs})


@pytest.mark.parametrize(
    "kwargs, expected",
    [
        ({}, "API alert: openrouter.ai is out of credits"),
        ({"event": "reminder"}, "API alert: openrouter.ai is still out of credits"),
        ({"kind": alerts.FAILING}, "API alert: openrouter.ai is failing"),
        ({"event": "reminder", "kind": alerts.FAILING}, "API alert: openrouter.ai is still failing"),
        ({"event": "recovered"}, "API alert: openrouter.ai is working again"),
    ],
)
def test_subject_says_what_happened(kwargs, expected):
    assert alerts.subject_for([notice(**kwargs)]) == expected


def test_several_problems_share_one_email():
    subject = alerts.subject_for([notice(), notice(vendor="serper", kind=alerts.FAILING)])

    assert subject == "API alert: 2 updates, including openrouter.ai is out of credits"


def test_body_says_what_to_do_and_names_the_account():
    body = alerts.body_for([notice(account="finance@example.com")])

    assert "Top up the account" in body
    assert "Key ending ab12" in body
    assert "finance@example.com" in body


def test_body_says_when_the_account_is_unknown():
    assert "may be an institute&#x27;s own key" in alerts.body_for([notice()])


def test_body_escapes_what_a_vendor_said():
    body = alerts.body_for([notice(error="<script>alert(1)</script>")])

    assert "<script>" not in body
    assert "&lt;script&gt;" in body


class FakeDb:
    """Answers evaluate()'s lock check; anything further would fail the test."""

    def __init__(self, locked):
        self.locked = locked

    def execute(self, *_args, **_kwargs):
        locked = self.locked

        class Result:
            @staticmethod
            def scalar():
                return locked

        return Result()


def test_another_replica_holding_the_lock_means_this_one_does_nothing():
    assert alerts.evaluate(FakeDb(False), NOW) is None
