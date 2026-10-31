"""Drip parity (CK-07): the Python port in course_knowledge/drip.py against the
shared cases the learner app's vitest suite runs (dripParity.test.ts).

The shared cases use 12:00 UTC anchors, so each one must give the same answer
in UTC and in Asia/Kolkata. Midnight edges, DST and the time_exact mode are
Python-only tests below (zoneinfo), because they depend on the time zone.
Skipped when the fixtures file is absent (ai_service checked out alone).
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.course_knowledge import drip  # noqa: E402

FIXTURES = (Path(__file__).resolve().parents[2] / "frontend-learner-dashboard-app/src/utils/drip-conditions"
            / "__fixtures__/drip_parity_cases.json")
CASES = json.loads(FIXTURES.read_text()) if FIXTURES.exists() else None
needs_fixtures = pytest.mark.skipif(CASES is None, reason=f"shared drip fixtures not found at {FIXTURES}")

ZONES = ("UTC", "Asia/Kolkata")


def _now(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _ids(kind):
    return [c["name"] for c in CASES[kind]] if CASES else []


def _cases(kind):
    return CASES[kind] if CASES else []


@needs_fixtures
def test_there_are_at_least_40_shared_cases():
    assert len(CASES["evaluate"]) + len(CASES["resolve"]) + len(CASES["level_select"]) >= 40


@needs_fixtures
@pytest.mark.parametrize("zone", ZONES)
@pytest.mark.parametrize("case", _cases("evaluate"), ids=_ids("evaluate"))
def test_evaluate_matches_the_learner_app(case, zone):
    result = drip.evaluate_drip_condition(
        case["condition"], drip.ProgressData.from_dict(case["progress"]),
        _now(case.get("now") or CASES["now"]), tz=zone, mode=drip.MODE_MIRROR,
    )
    expected = case["expected"]
    assert result.is_locked is expected["is_locked"]
    assert result.is_hidden is expected["is_hidden"]
    if "message_regex" in expected:
        assert result.unlock_message is not None and re.search(expected["message_regex"], result.unlock_message), \
            result.unlock_message
    elif "message" in expected:
        assert result.unlock_message == expected["message"]


@needs_fixtures
@pytest.mark.parametrize("case", _cases("resolve"), ids=_ids("resolve"))
def test_settings_and_resolve_match_the_learner_app(case):
    settings = drip.parse_course_settings_drip_conditions(case["settings_json"])
    expected = case["expected"]
    assert settings.enabled is expected["enabled"]
    assert settings.apply_configured_rules is expected["apply_configured_rules"]
    t = case["target"]
    condition = drip.resolve_drip_condition(
        settings.conditions, level=t["level"], level_id=t["levelId"], package_id=t["packageId"],
        apply_configured_rules=settings.apply_configured_rules,
    )
    assert condition == expected["condition"]


@needs_fixtures
@pytest.mark.parametrize("case", _cases("level_select"), ids=_ids("level_select"))
def test_parse_and_level_select_match_the_learner_app(case):
    parsed = drip.parse_drip_condition(case["drip_json"])
    assert parsed.success is case["expected"]["success"]
    condition = drip.get_condition_for_level(parsed.data, case["level"]) if parsed.success and parsed.data else None
    assert condition == case["expected"]["condition"]


# ── Python-only: midnight edges and DST (zoneinfo) ───────────────────────────

def _day(n, **params):
    return {"behavior": "lock", "rules": [{"type": "relative_date", "params": {"unlock_on_day": n, **params}}]}


def _eval(condition, now, tz, **progress):
    return drip.evaluate_drip_condition(condition, drip.ProgressData(item_index=3, **progress), now, tz=tz)


def test_day_two_opens_at_local_midnight_in_kolkata_before_utc():
    # Enrolled 2026-10-05 (a DATE column = UTC midnight, like its JSON in the app).
    # Day 2 starts at 00:00 IST on the 6th = 18:30 UTC on the 5th.
    anchor = date(2026, 10, 5)
    just_after = datetime(2026, 10, 5, 18, 31, tzinfo=timezone.utc)
    just_before = datetime(2026, 10, 5, 18, 29, tzinfo=timezone.utc)
    assert not _eval(_day(2), just_after, "Asia/Kolkata", enrollment_date=anchor).is_locked
    assert _eval(_day(2), just_before, "Asia/Kolkata", enrollment_date=anchor).is_locked
    assert _eval(_day(2), just_after, "UTC", enrollment_date=anchor).is_locked
    assert not _eval(_day(2), datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc), "UTC",
                     enrollment_date=anchor).is_locked


def test_enrolling_just_before_midnight_still_gets_day_two_at_midnight():
    # 23:50 IST enrolment: day 2 is ten minutes later, not 24 hours later.
    enrolled = datetime(2026, 10, 5, 18, 20, tzinfo=timezone.utc)  # 23:50 IST
    assert not _eval(_day(2), datetime(2026, 10, 5, 18, 31, tzinfo=timezone.utc), "Asia/Kolkata",
                     enrollment_date=enrolled).is_locked
    # The same instant is 18:20 on the 5th in UTC: day 2 is the 6th there.
    assert _eval(_day(2), datetime(2026, 10, 5, 18, 31, tzinfo=timezone.utc), "UTC",
                 enrollment_date=enrolled).is_locked


def test_unlock_time_is_local_wall_clock():
    anchor = date(2026, 10, 5)
    cond = _day(1, unlock_time="09:30")
    # 09:30 IST on the 5th = 04:00 UTC.
    assert _eval(cond, datetime(2026, 10, 5, 3, 59, tzinfo=timezone.utc), "Asia/Kolkata",
                 enrollment_date=anchor).is_locked
    assert not _eval(cond, datetime(2026, 10, 5, 4, 0, tzinfo=timezone.utc), "Asia/Kolkata",
                     enrollment_date=anchor).is_locked


def test_unlock_time_is_clamped_and_lenient_like_the_app():
    anchor = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
    now = datetime(2026, 10, 5, 23, 58, tzinfo=timezone.utc)
    assert _eval(_day(1, unlock_time="99:99"), now, "UTC", enrollment_date=anchor).is_locked  # 23:59
    assert not _eval(_day(1, unlock_time="9am"), now, "UTC", enrollment_date=anchor).is_locked  # 00:00
    with pytest.raises(TypeError):  # the app throws on a numeric unlock_time; callers fail closed
        _eval(_day(1, unlock_time=9), now, "UTC", enrollment_date=anchor)


def test_dst_zone_counts_calendar_days_not_24h_blocks():
    # America/New_York leaves DST on 2026-11-01: that day is 25 hours long.
    anchor = datetime(2026, 10, 31, 16, tzinfo=timezone.utc)  # 12:00 EDT on Oct 31
    # Day 3 = Nov 2, 00:00 EST = 05:00 UTC.
    assert _eval(_day(3), datetime(2026, 11, 2, 4, 59, tzinfo=timezone.utc), "America/New_York",
                 enrollment_date=anchor).is_locked
    assert not _eval(_day(3), datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc), "America/New_York",
                     enrollment_date=anchor).is_locked


def test_date_without_offset_is_local_and_date_only_is_utc():
    rule = lambda d: {"behavior": "lock", "rules": [{"type": "date_based", "params": {"unlock_date": d}}]}  # noqa: E731
    now = datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)  # 05:30 IST
    assert not _eval(rule("2026-11-12T05:00:00"), now, "Asia/Kolkata").is_locked  # 05:00 IST
    assert _eval(rule("2026-11-12T06:00:00"), now, "Asia/Kolkata").is_locked
    assert not _eval(rule("2026-11-12"), now, "Asia/Kolkata").is_locked  # UTC midnight
    assert _eval(rule("2026-11-12T00:00:01Z"), now, "UTC").is_locked


def test_failed_time_rules_report_their_unlock_moment():
    anchor = date(2026, 10, 5)
    result = _eval(_day(10), datetime(2026, 10, 6, tzinfo=timezone.utc), "Asia/Kolkata", enrollment_date=anchor)
    assert result.is_locked
    (rule,) = result.failed_rules
    assert rule.rule_type == "relative_date"
    assert rule.unlock_at == datetime(2026, 10, 14, 0, 0, tzinfo=drip.resolve_tz("Asia/Kolkata"))


# ── Python-only: time_exact mode ─────────────────────────────────────────────

SEQ = {"behavior": "lock", "rules": [{"type": "sequential", "params": {"requires_previous": True, "threshold": 80}}]}
NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)


def test_time_exact_treats_progress_rules_as_unmet():
    done = drip.ProgressData(item_index=2, previous_item_completion=100)
    assert not drip.evaluate_drip_condition(SEQ, done, NOW, mode=drip.MODE_MIRROR).is_locked
    exact = drip.evaluate_drip_condition(SEQ, done, NOW, mode=drip.MODE_TIME_EXACT)
    assert exact.is_locked
    assert [r.rule_type for r in exact.failed_rules] == ["sequential"]


def test_time_exact_keeps_the_app_exemptions():
    first = drip.ProgressData(item_index=0)
    assert not drip.evaluate_drip_condition(SEQ, first, NOW, mode=drip.MODE_TIME_EXACT).is_locked
    last_n = {"behavior": "lock", "rules": [{"type": "completion_based",
                                             "params": {"metric": "average_of_last_n", "count": 3, "threshold": 90}}]}
    assert not drip.evaluate_drip_condition(last_n, drip.ProgressData(item_index=2, recent_scores=[0, 0]),
                                            NOW, mode=drip.MODE_TIME_EXACT).is_locked
    assert drip.evaluate_drip_condition(last_n, drip.ProgressData(item_index=3, recent_scores=[100, 100, 100]),
                                        NOW, mode=drip.MODE_TIME_EXACT).is_locked


def test_time_exact_prerequisites_are_all_pending():
    prereq = {"behavior": "lock", "rules": [{"type": "prerequisite",
                                             "params": {"required_slides": ["a", "b"], "threshold": 100}}]}
    result = drip.evaluate_drip_condition(
        prereq, drip.ProgressData(item_index=1, prerequisite_completions={"a": 100, "b": 100}), NOW,
        mode=drip.MODE_TIME_EXACT)
    assert result.is_locked and result.failed_rules[0].pending_ids == ("a", "b")


def test_time_exact_still_opens_rules_every_learner_meets():
    zero = {"behavior": "lock",
            "rules": [{"type": "sequential", "params": {"requires_previous": True, "threshold": 0}}]}
    assert not drip.evaluate_drip_condition(zero, drip.ProgressData(item_index=4), NOW,
                                            mode=drip.MODE_TIME_EXACT).is_locked


# ── Python-only: inputs the app would throw on ───────────────────────────────

@pytest.mark.parametrize("condition", [
    {"behavior": "lock", "rules": [None]},
    {"behavior": "lock", "rules": [{"type": "date_based", "params": None}]},
    {"behavior": "lock", "rules": {"type": "date_based"}},
])
def test_malformed_conditions_raise_so_callers_fail_closed(condition):
    with pytest.raises(TypeError):
        drip.evaluate_drip_condition(condition, drip.ProgressData(item_index=1), NOW)
    closed = drip.fail_closed(condition)
    assert closed.is_locked and closed.error


def test_fail_closed_hides_when_the_condition_asked_to_hide():
    assert drip.fail_closed({"behavior": "hide"}).is_hidden
    assert drip.fail_closed({"behavior": "both"}).is_hidden
    assert not drip.fail_closed(None).is_hidden


def test_row_conditions_follow_the_course_page():
    raw = json.dumps([{"target": "chapter", "behavior": "lock", "rules": []},
                      {"behavior": "hide", "is_enabled": False, "rules": []},
                      {"target": "slide", "behavior": "both", "rules": []}])
    assert drip.row_condition_for_level(raw, "slide")["behavior"] == "both"
    assert drip.row_condition_for_level(raw, "chapter")["behavior"] == "lock"
    assert drip.row_condition_for_level("{broken", "slide") is None
    assert drip.row_condition_for_level(json.dumps([None]), "slide") is None


def test_select_drip_condition_prefers_an_enabled_package_condition():
    pkg, item = {"behavior": "lock", "rules": []}, {"behavior": "hide", "rules": []}
    assert drip.select_drip_condition(pkg, item) is pkg
    assert drip.select_drip_condition({**pkg, "is_enabled": False}, item) is item
    assert drip.select_drip_condition(None, {**item, "is_enabled": False}) is None
    assert drip.select_drip_condition(None, None) is None


def test_settings_row_switch_uses_truthiness():
    blob = json.dumps({"setting": {"COURSE_SETTING": {"data": {"dripConditions": {"enabled": "yes"}}}}})
    parsed = drip.parse_course_settings_drip_conditions(blob)
    assert parsed.enabled is False and parsed.row_path_enabled is True
    assert drip.parse_course_settings_drip_conditions(None) == drip.EMPTY_SETTINGS
