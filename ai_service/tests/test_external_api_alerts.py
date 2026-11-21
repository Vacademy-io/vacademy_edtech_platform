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


def test_a_success_after_a_402_clears_it_once_the_402_has_settled():
    # A minute after the 402 is too soon: a low balance still lets small calls through.
    assert alerts.classify([call("SUCCESS", 200), call(http_status=402, minutes_ago=2)], 5, NOW).kind == alerts.CREDITS
    assert alerts.classify([call("SUCCESS", 200), call(http_status=402, minutes_ago=31)], 5, NOW) is None


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


def test_whatsapp_numbers_get_their_country_code_and_bad_ones_are_named():
    assert alerts.parse_phones("+91 98765 43210, 9876543210, 09876543211, 0044 7700 900123, 12345") == [
        "919876543210", "919876543211", "447700900123",
    ]
    assert alerts.parse_phones(None) == []
    assert alerts.invalid_phones("9876543210, 12345, abc,") == ["12345", "abc"]
    assert len(alerts.parse_phones(",".join(f"98765432{i:02d}" for i in range(30)))) == alerts.MAX_PHONES


def test_whatsapp_fields_fill_the_health_check_template():
    fields = alerts.whatsapp_fields([notice(account="finance@example.com", http_status=402)], now=NOW)

    assert set(fields) == {"1", "2", "3", "4", "5"}
    assert fields["1"] == "API alert: openrouter.ai is out of credits"
    assert fields["2"] == "openrouter.ai"
    assert fields["3"] == "finance@example.com (key ending ab12)"
    assert "Top up the account" in fields["4"] and "Last status 402." in fields["4"]
    assert fields["5"] == "06 Nov 2026 05:30 PM IST"


def test_whatsapp_fields_are_text_meta_accepts():
    long_error = "line one\nline two\t" + "x     " * 400
    fields = alerts.whatsapp_fields(
        [notice(error=long_error), notice(vendor="serper", kind=alerts.FAILING, key_hint="****")], now=NOW)

    for value in fields.values():
        assert value, "Meta refuses an empty field"
        assert "\n" not in value and "\t" not in value and "     " not in value
    assert len(fields["4"]) <= alerts.WHATSAPP_DETAILS_LIMIT
    assert fields["2"] == "openrouter.ai, serper"
    assert "key too short to show" in fields["3"]


def test_the_template_is_the_approved_health_check_one_unless_overridden(monkeypatch):
    monkeypatch.delenv("EXTERNAL_API_ALERT_WHATSAPP_TEMPLATE", raising=False)
    assert alerts.whatsapp_template() == "vacademy_server_health_check_utility"
    monkeypatch.setenv("EXTERNAL_API_ALERT_WHATSAPP_TEMPLATE", "other_utility")
    assert alerts.whatsapp_template() == "other_utility"


def test_recipients_count_when_either_channel_has_someone():
    assert not alerts.Recipients([], [])
    assert alerts.Recipients([], ["919876543210"])
    assert alerts.Recipients(["a@b.co"], [])


def test_whatsapp_payload_is_the_health_check_format():
    fields = {"2": "openrouter.ai", "1": "API alert: x", "10": "ten", "3": "k", "4": "d", "5": "t"}
    payload = alerts.whatsapp_payload("919876543210", "vacademy_server_health_check_utility", fields)

    assert payload["messaging_product"] == "whatsapp"
    assert payload["to"] == "919876543210"
    assert payload["type"] == "template"
    assert payload["template"]["name"] == "vacademy_server_health_check_utility"
    assert payload["template"]["language"] == {"code": "en"}
    params = payload["template"]["components"][0]["parameters"]
    assert [p["text"] for p in params] == ["API alert: x", "openrouter.ai", "k", "d", "t", "ten"]
    assert all(p["type"] == "text" for p in params)


def test_meta_refusals_are_reported_in_metas_words():
    body = {"error": {"code": 132001, "message": "(#132001) Template name does not exist in the translation",
                      "error_data": {"details": "template name (x) does not exist in en"}}}
    assert alerts.meta_error(body) == "(#132001) template name (x) does not exist in en"
    assert alerts.meta_error({"error": {"message": "Invalid OAuth access token"}}) == "Invalid OAuth access token"
    assert alerts.meta_error("not json") == "refused"


def test_without_the_token_every_number_is_reported_not_silently_skipped(monkeypatch):
    import asyncio

    monkeypatch.delenv("WHATSAPP_ACCESS_TOKEN_VIDYAYATAN", raising=False)
    monkeypatch.delenv("WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN", raising=False)
    results = asyncio.run(alerts.send_whatsapp(["919876543210", "447700900123"], {"1": "a"}))

    assert [r["success"] for r in results] == [False, False]
    assert "WHATSAPP_ACCESS_TOKEN_VIDYAYATAN" in results[0]["error"]


def free(status="SUCCESS", minutes_ago=1, http_status=200):
    return {**call(status, http_status=http_status, minutes_ago=minutes_ago), "operation": "POST /api/v1 (free model)"}


def test_a_free_model_answering_does_not_clear_out_of_credits():
    rows = [free(minutes_ago=1), free(minutes_ago=2), call(http_status=402, minutes_ago=3)]

    problem = alerts.classify(rows, threshold=5, now=NOW)

    assert problem.kind == alerts.CREDITS
    assert problem.http_status == 402


def test_free_model_calls_do_not_break_a_failing_run():
    rows = [call(minutes_ago=1), free(minutes_ago=2), call(minutes_ago=3), free(minutes_ago=4),
            call(minutes_ago=5), call(minutes_ago=6), call(minutes_ago=7)]

    assert alerts.classify(rows, threshold=5, now=NOW).kind == alerts.FAILING


def test_free_model_failures_alone_are_not_an_api_problem():
    rows = [free("FAILED", minutes_ago=i, http_status=429) for i in range(1, 10)]

    assert alerts.classify(rows, threshold=5, now=NOW) is None


def test_a_small_paid_call_getting_through_right_after_a_402_is_not_a_recovery():
    rows = [call("SUCCESS", http_status=200, minutes_ago=1),
            call(http_status=402, error="This request requires more credits, can only afford 900", minutes_ago=5),
            call("SUCCESS", http_status=200, minutes_ago=6)]

    assert alerts.classify(rows, threshold=5, now=NOW).kind == alerts.CREDITS


def test_paid_calls_succeeding_well_after_the_last_402_clear_it():
    rows = [call("SUCCESS", http_status=200, minutes_ago=1), call(http_status=402, minutes_ago=45)]

    assert alerts.classify(rows, threshold=5, now=NOW) is None


def test_recovery_needs_a_paid_call_not_a_free_one():
    paid = alerts.paid_calls([free(minutes_ago=1), call(http_status=402, minutes_ago=2)])

    assert [r["status"] for r in paid] == ["FAILED"]
    assert alerts.is_free_call(free()) and not alerts.is_free_call(call())
