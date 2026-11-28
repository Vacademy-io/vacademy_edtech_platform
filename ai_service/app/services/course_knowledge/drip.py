"""Drip conditions, evaluated on the server exactly as the learner app does.

A faithful port of frontend-learner-dashboard-app/src/utils/drip-conditions:
- evaluateDripCondition.ts  -> evaluate_drip_condition (+ every rule)
- resolveDripCondition.ts   -> parse_course_settings_drip_conditions,
                               enforceable_condition, resolve_drip_condition
- parseDripCondition.ts     -> parse_drip_condition, get_condition_for_level
- selectDripCondition.ts    -> select_drip_condition
The TypeScript evaluator is the source of truth. Both sides run the shared
cases in __fixtures__/drip_parity_cases.json; change both together.

JavaScript semantics are kept where they decide the outcome: `||` and `??`
fallbacks, Number() coercion of thresholds, `new Date(...)` parsing (an
unparseable unlock date never passes; a missing anchor always does), local
calendar days counted in the learner's time zone, and Math.round. Inputs the
app would throw on (a rule that is not an object, params of null) raise here
too, and callers treat any exception as LOCKED: fail closed, never open.

Two modes:
- ``mirror``: progress rules are evaluated with the learner's real progress.
- ``time_exact`` (the default): time rules are exact; progress rules are
  evaluated against a learner who has done nothing yet (every completion 0,
  same item position). Every progress rule is monotone in completion, so this
  is "unmet" unless the rule holds for any learner at all (a 0% threshold, an
  empty prerequisite list, nothing before the item); the first-item and
  average_of_last_n exemptions still open items exactly as in the app.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

MODE_MIRROR = "mirror"
MODE_TIME_EXACT = "time_exact"
DRIP_MODES = (MODE_TIME_EXACT, MODE_MIRROR)

TIME_RULE_TYPES: Tuple[str, ...] = ("date_based", "relative_date")
PROGRESS_RULE_TYPES: Tuple[str, ...] = ("completion_based", "prerequisite", "sequential")

DAY_MS = 24 * 60 * 60 * 1000
_UTC = timezone.utc
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_MISSING = object()


# ── JavaScript value semantics ───────────────────────────────────────────────

def _truthy(v: Any) -> bool:
    """JS truthiness (NaN, 0, "", null, false are falsy; [] and {} are truthy)."""
    if v is None or v is False or v is _MISSING:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return not (v == 0 or (isinstance(v, float) and math.isnan(v)))
    if isinstance(v, str):
        return v != ""
    return True


js_truthy = _truthy


def _js_number(v: Any) -> float:
    """Number(v): null -> 0, undefined -> NaN, "" -> 0, "12" -> 12, junk -> NaN."""
    if v is _MISSING:
        return math.nan
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0.0
        try:
            if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", s):
                return float(s)
            if re.fullmatch(r"0[xX][0-9a-fA-F]+", s):
                return float(int(s, 16))
            if s in ("Infinity", "+Infinity"):
                return math.inf
            if s == "-Infinity":
                return -math.inf
        except (ValueError, OverflowError):
            return math.nan
        return math.nan
    if isinstance(v, list):
        if not v:
            return 0.0
        if len(v) == 1:
            return _js_number(v[0])
        return math.nan
    return math.nan


def _js_str(v: Any) -> str:
    """`${v}` in a template literal."""
    if v is _MISSING:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return _num_str(float(v))
    if isinstance(v, list):
        return ",".join("" if x is None else _js_str(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def _num_str(x: float) -> str:
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    return repr(x)


def _js_round(x: float) -> float:
    """Math.round: halves round towards +Infinity (Python's round() is banker's)."""
    if math.isnan(x) or math.isinf(x):
        return x
    return float(math.floor(x + 0.5))


def _ge(a: Any, b: Any) -> bool:
    """`a >= b` after numeric coercion (NaN compares false)."""
    x, y = _js_number(a), _js_number(b)
    if math.isnan(x) or math.isnan(y):
        return False
    return x >= y


def _lt(a: Any, b: Any) -> bool:
    x, y = _js_number(a), _js_number(b)
    if math.isnan(x) or math.isnan(y):
        return False
    return x < y


def _prop(obj: Any, key: str) -> Any:
    """obj.key, raising where JavaScript would (property of null/undefined)."""
    if obj is None or obj is _MISSING:
        raise TypeError(f"Cannot read properties of null (reading '{key}')")
    if isinstance(obj, dict):
        return obj.get(key, _MISSING)
    return _MISSING


def _opt(obj: Any, key: str) -> Any:
    """obj?.key: undefined instead of raising."""
    if obj is None or obj is _MISSING:
        return _MISSING
    return _prop(obj, key)


def _has(params: Any, key: str) -> bool:
    """`key in params`: arrays have no such keys; primitives throw a TypeError."""
    if isinstance(params, dict):
        return key in params
    if isinstance(params, list):
        return False
    raise TypeError(f"Cannot use 'in' operator to search for '{key}' in {params!r}")


def _undef_to_none(v: Any) -> Any:
    return None if v is _MISSING else v


def _strict_eq(a: Any, b: Any) -> bool:
    """`a === b` for JSON values."""
    if a is _MISSING or b is _MISSING:
        return a is b
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(a) == float(b)
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        return a is b
    return type(a) is type(b) and a == b


def _js_spread(v: Any) -> List[Any]:
    """[...(v || [])]."""
    if not _truthy(v):
        return []
    if isinstance(v, list):
        return list(v)
    if isinstance(v, str):
        return list(v)
    raise TypeError(f"{v!r} is not iterable")


# ── Dates (new Date(...) in the learner's time zone) ─────────────────────────

_ISO_DATE = re.compile(r"^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")
_ISO_DATETIME = re.compile(
    r"^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?"
    r"\s*(Z|z|[+-]\d{2}:?\d{2})?$"
)


def resolve_tz(tz: Any) -> tzinfo:
    if isinstance(tz, tzinfo):
        return tz
    if isinstance(tz, str) and tz:
        try:
            return ZoneInfo(tz)
        except Exception:  # noqa: BLE001 - unknown zone: UTC, the caller validates names
            return _UTC
    return _UTC


def _from_ms(ms: float) -> Optional[datetime]:
    if math.isnan(ms) or math.isinf(ms) or abs(ms) > 8.64e15:
        return None
    try:
        return datetime(1970, 1, 1, tzinfo=_UTC) + timedelta(milliseconds=math.trunc(ms))
    except OverflowError:
        return None


def _parse_js_date(value: Any, tz: tzinfo) -> Optional[datetime]:
    """new Date(value) as an aware datetime, or None for an Invalid Date.

    ISO date-only strings are UTC midnight, date-times without an offset are
    local (tz) time, numbers are epoch milliseconds, null is the epoch. A
    naive datetime from the DB is UTC (the JVM and the DB run in UTC), and a
    date is UTC midnight, which is what its "YYYY-MM-DD" JSON parses to."""
    if value is _MISSING:
        return None
    if value is None:
        return _from_ms(0)
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=_UTC)
        return dt.replace(microsecond=(dt.microsecond // 1000) * 1000)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=_UTC)
    if isinstance(value, (bool, int, float)):
        return _from_ms(float(value))
    if not isinstance(value, str):
        return None
    s = value.strip()
    try:
        m = _ISO_DATE.match(s)
        if m:
            return datetime(int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1), tzinfo=_UTC)
        m = _ISO_DATETIME.match(s)
        if not m:
            return None
        year, month, day, hh, mi = (int(m.group(i)) for i in range(1, 6))
        ss = int(m.group(6) or 0)
        frac = (m.group(7) or "")[:3].ljust(3, "0")
        ms = int(frac)
        extra_day = False
        if hh == 24 and mi == 0 and ss == 0 and ms == 0:
            hh, extra_day = 0, True
        off = m.group(8)
        if off in (None, ""):
            dt = datetime(year, month, day, hh, mi, ss, ms * 1000, tzinfo=tz)
        elif off in ("Z", "z"):
            dt = datetime(year, month, day, hh, mi, ss, ms * 1000, tzinfo=_UTC)
        else:
            sign = 1 if off[0] == "+" else -1
            digits = off[1:].replace(":", "")
            delta = timedelta(hours=int(digits[:2]), minutes=int(digits[2:]))
            dt = datetime(year, month, day, hh, mi, ss, ms * 1000, tzinfo=timezone(sign * delta))
        if extra_day:
            dt += timedelta(days=1)
        return dt
    except (ValueError, OverflowError):
        return None


def _to_date(value: Any, tz: tzinfo) -> Optional[datetime]:
    """toDate(): a falsy value is "not known"; otherwise new Date(value)."""
    if not _truthy(value):
        return None
    return _parse_js_date(value, tz)


def _add_days_at_time(anchor: datetime, offset_days: float, unlock_time: Any, tz: tzinfo) -> Optional[datetime]:
    """addDaysAtTime(): anchor's LOCAL calendar day + N days, at HH:mm local."""
    raw = unlock_time if _truthy(unlock_time) else "00:00"
    if not isinstance(raw, str):
        raise TypeError("unlock_time.split is not a function")
    parts = raw.split(":")
    hours = _js_number(parts[0])
    minutes = _js_number(parts[1]) if len(parts) > 1 else math.nan
    hours = 0.0 if not _truthy(hours) else hours
    minutes = 0.0 if not _truthy(minutes) else minutes
    h = int(min(23.0, max(0.0, hours)))
    mi = int(min(59.0, max(0.0, minutes)))
    if math.isnan(offset_days) or math.isinf(offset_days):
        return None
    try:
        local_day = anchor.astimezone(tz).date() + timedelta(days=int(offset_days))
        return datetime.combine(local_day, time(h, mi), tzinfo=tz)
    except (OverflowError, ValueError):
        return None


def _fmt_date_time(dt: Optional[datetime], tz: tzinfo) -> str:
    """toLocaleString(en-US, {year, month: short, day, hour: 2-digit, minute: 2-digit})."""
    if dt is None:
        return "Invalid Date"
    d = dt.astimezone(tz)
    hour12 = d.hour % 12 or 12
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}, {hour12:02d}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"


def _fmt_date(dt: Optional[datetime], tz: tzinfo) -> str:
    """toLocaleDateString(en-US, {month: short, day, year})."""
    if dt is None:
        return "Invalid Date"
    d = dt.astimezone(tz)
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}"


def _ms_between(later: datetime, earlier: datetime) -> float:
    return (later - earlier) / timedelta(milliseconds=1)


# ── Data types ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ProgressData:
    """LearnerProgressData (evaluateDripCondition.ts)."""
    percentage_completed: float = 0
    recent_scores: Optional[Sequence[float]] = None
    completed_prerequisite_ids: Optional[Sequence[str]] = None
    prerequisite_completions: Optional[Mapping[str, Any]] = None
    previous_item_id: Optional[str] = None
    previous_item_completion: Any = None
    item_index: Optional[int] = None
    enrollment_date: Any = None
    session_start_date: Any = None

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "ProgressData":
        """Build from the camelCase object the TypeScript side takes."""
        return cls(
            percentage_completed=raw.get("percentageCompleted", 0),
            recent_scores=raw.get("recentScores"),
            completed_prerequisite_ids=raw.get("completedPrerequisiteIds"),
            prerequisite_completions=raw.get("prerequisiteCompletions"),
            previous_item_id=raw.get("previousItemId"),
            previous_item_completion=raw.get("previousItemCompletion"),
            item_index=raw.get("itemIndex"),
            enrollment_date=raw.get("enrollmentDate"),
            session_start_date=raw.get("sessionStartDate"),
        )

    def nothing_done(self) -> "ProgressData":
        """The same item, for a learner who has completed nothing (time_exact)."""
        return replace(
            self,
            percentage_completed=0,
            recent_scores=[0] * len(self.recent_scores or []),
            completed_prerequisite_ids=[],
            prerequisite_completions={},
            previous_item_completion=0,
        )


@dataclass(frozen=True)
class RuleResult:
    """One rule's outcome. unlock_at is set for a time rule that has a date;
    pending_ids lists the prerequisites still short of the threshold."""
    passed: bool
    message: Optional[str] = None
    rule_type: Optional[str] = None
    unlock_at: Optional[datetime] = None
    pending_ids: Tuple[str, ...] = ()


@dataclass(frozen=True)
class Evaluation:
    """DripConditionEvaluation. failed_rules are the rules that decided a
    lock/hide (the ones the TS loop counted); error marks a fail-closed result."""
    is_locked: bool
    is_hidden: bool
    unlock_message: Optional[str]
    failed_rules: Tuple[RuleResult, ...] = ()
    error: bool = False


OPEN = Evaluation(is_locked=False, is_hidden=False, unlock_message=None)


@dataclass(frozen=True)
class ResolvedDripConditions:
    enabled: bool = False
    apply_configured_rules: bool = False
    conditions: Tuple[Any, ...] = ()
    # JS truthiness of dripConditions.enabled: the legacy row-level switch
    # (isDrippingEnable). Stricter than `enabled` only when someone stored a
    # non-boolean, so honouring it never opens anything.
    row_path_enabled: bool = False


EMPTY_SETTINGS = ResolvedDripConditions()


# ── Rules (evaluateDripCondition.ts evaluateRule) ────────────────────────────

def _is_date_based(params: Any) -> bool:
    return _has(params, "unlock_date")


def _is_relative_date(params: Any) -> bool:
    return _has(params, "unlock_on_day")


def _is_completion_based(params: Any) -> bool:
    return _has(params, "metric") and _has(params, "threshold")


def _is_prerequisite(params: Any) -> bool:
    return (_has(params, "required_chapters") or _has(params, "required_slides")) and _has(params, "threshold")


def _is_sequential(params: Any) -> bool:
    return _has(params, "requires_previous") and _has(params, "threshold")


def _plural(n: float, word: str) -> str:
    return word if n == 1 else word + "s"


def evaluate_rule(rule: Any, progress: ProgressData, now: datetime, tz: tzinfo) -> RuleResult:
    rtype = _prop(rule, "type")
    params = _prop(rule, "params")
    rt = rtype if isinstance(rtype, str) else None

    if rtype == "date_based":
        if not _is_date_based(params):
            return RuleResult(True, "Invalid date params", rt)
        unlock = _parse_js_date(params.get("unlock_date"), tz)
        passed = unlock is not None and now >= unlock
        return RuleResult(passed, None if passed else f"Available from {_fmt_date_time(unlock, tz)}", rt, unlock)

    if rtype == "relative_date":
        if not _is_relative_date(params):
            return RuleResult(True, "Invalid relative date params", rt)
        by_batch = params.get("anchor") == "session_start"
        anchor_raw = progress.session_start_date if by_batch else progress.enrollment_date
        anchor = _to_date(anchor_raw, tz)
        if anchor is None:
            return RuleResult(True, None, rt)
        day = params.get("unlock_on_day")
        day_n = _js_round(_js_number(day if _truthy(day) else 1))
        offset = math.nan if math.isnan(day_n) else max(1.0, day_n) - 1
        unlock_at = _add_days_at_time(anchor, offset, params.get("unlock_time", _MISSING), tz)
        if unlock_at is not None and now >= unlock_at:
            return RuleResult(True, None, rt, unlock_at)
        if unlock_at is None:
            return RuleResult(False, "Unlocks in NaN days (Invalid Date)", rt)
        days_left = max(1, math.ceil(_ms_between(unlock_at, now) / DAY_MS))
        return RuleResult(
            False, f"Unlocks in {days_left} {_plural(days_left, 'day')} ({_fmt_date(unlock_at, tz)})", rt, unlock_at
        )

    if rtype == "completion_based":
        if not _is_completion_based(params):
            return RuleResult(True, "Invalid completion params", rt)
        metric, threshold = params.get("metric"), params.get("threshold")
        count = params.get("count", _MISSING)
        scores = [float(_js_number(s)) for s in (progress.recent_scores or [])]

        def average(values: List[float]) -> float:
            return sum(values) / len(values) if values else math.nan

        if metric == "average_of_last_n":
            required = _js_number(count if _truthy(count) else 1)
            if _lt(len(scores), required):
                missing = required - len(scores)
                return RuleResult(
                    False,
                    f"Complete {_num_str(missing)} more {_plural(missing, 'slide')}/"
                    f"{_plural(missing, 'chapter')} to unlock",
                    rt,
                )
            # scores.slice(-requiredCount); -0 slices from the start, like JS.
            n = math.trunc(required) if not math.isnan(required) else 0
            avg = average(scores[-n:])
            passed = _ge(avg, threshold)
            return RuleResult(
                passed,
                None if passed else
                f"Score average of {_js_str(threshold)}% needed (current: {_num_str(_js_round(avg))}%)",
                rt,
            )
        if metric == "average_of_all":
            if not scores:
                return RuleResult(True, None, rt)
            avg = average(scores)
            passed = _ge(avg, threshold)
            return RuleResult(
                passed,
                None if passed else
                f"Overall average of {_js_str(threshold)}% needed (current: {_num_str(_js_round(avg))}%)",
                rt,
            )
        return RuleResult(True, None, rt)

    if rtype == "prerequisite":
        if not _is_prerequisite(params):
            return RuleResult(True, "Invalid prerequisite params", rt)
        threshold = params.get("threshold")
        ids = _js_spread(params.get("required_chapters")) + _js_spread(params.get("required_slides"))
        completions = progress.prerequisite_completions or {}
        pending = []
        for pid in ids:
            value = completions.get(pid) if isinstance(pid, str) else None
            if not _ge(value if _truthy(value) else 0, threshold):
                pending.append(pid)
        passed = not pending
        return RuleResult(
            passed,
            None if passed else f"Complete {len(pending)} prerequisite(s) with {_js_str(threshold)}% completion",
            rt,
            pending_ids=tuple(str(p) for p in pending),
        )

    if rtype == "sequential":
        if not _is_sequential(params):
            return RuleResult(True, "Invalid sequential params", rt)
        threshold = params.get("threshold")
        prev = progress.previous_item_completion if _truthy(progress.previous_item_completion) else 0
        passed = _ge(prev, threshold)
        return RuleResult(
            passed,
            None if passed else f"Complete previous item with {_js_str(threshold)}% (current: {_js_str(prev)}%)",
            rt,
        )

    return RuleResult(True, None, rt)


# ── evaluateDripCondition ────────────────────────────────────────────────────

def evaluate_drip_condition(
    condition: Any,
    progress: ProgressData,
    now: Optional[datetime] = None,
    *,
    tz: Any = None,
    mode: str = MODE_MIRROR,
) -> Evaluation:
    """evaluateDripCondition (evaluateDripCondition.ts). May raise on input the
    app would throw on; callers treat that as locked."""
    zone = resolve_tz(tz)
    now = now or datetime.now(_UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=_UTC)

    rules = _opt(condition, "rules")
    if not _truthy(condition) or not _truthy(rules):
        return OPEN
    if isinstance(rules, list) and len(rules) == 0:
        return OPEN
    if _prop(condition, "is_enabled") is False:
        return OPEN
    if not isinstance(rules, list):
        raise TypeError("condition.rules.every is not a function")

    item_index = progress.item_index if progress.item_index is not None else 0
    # Computed before the index test, as in TS (`every` stops at the first miss).
    deadlocks_on_first_item = all(_prop(r, "type") in PROGRESS_RULE_TYPES for r in rules)
    if _strict_eq(item_index, 0) and deadlocks_on_first_item:
        return OPEN

    completion_rule = None
    for r in rules:
        if (_prop(r, "type") == "completion_based" and _is_completion_based(_prop(r, "params"))
                and r["params"].get("metric") == "average_of_last_n"):
            completion_rule = r
            break
    if completion_rule is not None:
        count = completion_rule["params"].get("count", _MISSING)
        if _lt(item_index, count if _truthy(count) else 1):
            return OPEN

    effective = progress.nothing_done() if mode == MODE_TIME_EXACT else progress
    failed: List[RuleResult] = []
    for rule in rules:
        result = evaluate_rule(rule, effective, now, zone)
        # The TS loop only counts a failed rule that carries a message.
        if not result.passed and result.message:
            failed.append(result)
    if not failed:
        return OPEN

    message = "; ".join(r.message for r in failed if r.message)
    behavior = condition.get("behavior")
    if behavior == "lock":
        return Evaluation(True, False, message, tuple(failed))
    if behavior == "hide":
        return Evaluation(False, True, message, tuple(failed))
    if behavior == "both":
        return Evaluation(True, True, message, tuple(failed))
    return OPEN


def fail_closed(condition: Any = None) -> Evaluation:
    """The result for an item whose evaluation raised: locked, and hidden too
    when the condition asked to hide. Never open."""
    behavior = condition.get("behavior") if isinstance(condition, dict) else None
    return Evaluation(True, behavior in ("hide", "both"), None, (), error=True)


# ── resolveDripCondition.ts ──────────────────────────────────────────────────

def parse_course_settings_drip_conditions(raw_settings_json: Any) -> ResolvedDripConditions:
    """The drip block of institutes.setting_json (COURSE_SETTING.data.dripConditions).
    Both blob shapes are accepted: {setting: {COURSE_SETTING}} and {COURSE_SETTING}."""
    if isinstance(raw_settings_json, (dict, list)):
        parsed = raw_settings_json
    else:
        if not isinstance(raw_settings_json, str) or raw_settings_json.strip() == "":
            return EMPTY_SETTINGS
        try:
            parsed = json.loads(raw_settings_json)
        except (ValueError, TypeError):
            return EMPTY_SETTINGS
    course_setting = _opt(_opt(parsed, "setting"), "COURSE_SETTING")
    if course_setting is None or course_setting is _MISSING:
        course_setting = _opt(parsed, "COURSE_SETTING")
    drip = _opt(_opt(course_setting, "data"), "dripConditions")
    if not _truthy(drip) or not isinstance(drip, (dict, list)):
        return EMPTY_SETTINGS
    if not isinstance(drip, dict):
        return EMPTY_SETTINGS
    enabled_raw = drip.get("enabled")
    conditions = drip.get("conditions")
    return ResolvedDripConditions(
        enabled=enabled_raw is True,
        apply_configured_rules=drip.get("applyConfiguredRules") is True,
        conditions=tuple(conditions) if isinstance(conditions, list) else (),
        row_path_enabled=_truthy(enabled_raw),
    )


def _configs_of(condition: Any) -> List[Any]:
    raw = _prop(condition, "drip_condition")
    if not _truthy(raw):
        return []
    return list(raw) if isinstance(raw, list) else [raw]


def _is_live(config: Any) -> bool:
    if config is None:
        raise TypeError("Cannot read properties of null (reading 'is_enabled')")
    if not isinstance(config, dict):
        return False
    rules = config.get("rules")
    return config.get("is_enabled") is not False and isinstance(rules, list) and len(rules) > 0


def enforceable_condition(condition: Any, apply_configured_rules: bool) -> Optional[Any]:
    """The part of a saved condition the institute enforces: time rules always,
    progress rules only with applyConfiguredRules."""
    if not _truthy(condition):
        return None
    if apply_configured_rules:
        return condition
    rules = _prop(condition, "rules")
    if rules is None or rules is _MISSING:
        rules = []
    if not isinstance(rules, list):
        raise TypeError("condition.rules.filter is not a function")
    kept = [r for r in rules if _prop(r, "type") in TIME_RULE_TYPES]
    if not kept:
        return None
    if len(kept) == len(condition.get("rules") or []):
        return condition
    return {**condition, "rules": kept}


def resolve_drip_condition(
    conditions: Optional[Sequence[Any]],
    *,
    level: str,
    level_id: Optional[str],
    package_id: Optional[str],
    apply_configured_rules: bool = False,
) -> Optional[Any]:
    """An item's own condition wins; otherwise the package condition whose
    target is this level."""
    if not conditions:
        return None

    def enforceable(config: Any) -> Optional[Any]:
        return enforceable_condition(config, apply_configured_rules is True) if _is_live(config) else None

    def first(found: List[Any]) -> Optional[Any]:
        return next((c for c in found if c is not None), None)

    # Eager like the TS filter/flatMap/map chain: a malformed entry anywhere in
    # the list raises (and the caller fails closed) even after a match.
    if _truthy(level_id):
        own = first([
            enforceable(config)
            for c in [c for c in conditions
                      if _strict_eq(_prop(c, "level"), level) and _strict_eq(_prop(c, "level_id"), level_id)
                      and _prop(c, "enabled") is not False]
            for config in _configs_of(c)
        ])
        if own is not None:
            return own

    if _truthy(package_id):
        matching = [c for c in conditions
                    if _strict_eq(_prop(c, "level"), "package") and _strict_eq(_prop(c, "level_id"), package_id)
                    and _prop(c, "enabled") is not False]
        configs = [config for c in matching for config in _configs_of(c)]
        targeted = [config for config in configs if _strict_eq(_prop(config, "target"), level)]
        from_package = first([enforceable(config) for config in targeted])
        if from_package is not None:
            return from_package
    return None


# ── parseDripCondition.ts / selectDripCondition.ts ───────────────────────────

@dataclass(frozen=True)
class ParseResult:
    success: bool
    data: Any = None
    errors: Tuple[Dict[str, str], ...] = field(default_factory=tuple)


def parse_drip_condition(json_string: Any) -> ParseResult:
    """parseDripCondition: one object, or an array of at most 2 targets."""
    if json_string is None or (isinstance(json_string, str) and json_string.strip() == ""):
        return ParseResult(True, None)
    try:
        return _parse_drip_condition(json_string)
    except (ValueError, TypeError) as exc:
        # The TS try/catch covers JSON.parse and the validation that follows it.
        return ParseResult(False, errors=({"field": "json", "message": f"Invalid JSON: {exc}"},))


def _parse_drip_condition(json_string: Any) -> ParseResult:
    parsed = json.loads(json_string) if isinstance(json_string, str) else json_string
    if isinstance(parsed, dict):
        if not _truthy(parsed.get("behavior")) or not isinstance(parsed.get("rules"), list):
            return ParseResult(False, errors=(
                {"field": "root", "message": "Drip condition must have behavior and rules array"},))
        return ParseResult(True, parsed)

    if isinstance(parsed, list):
        if not parsed:
            return ParseResult(True, None)
        if len(parsed) > 2:
            return ParseResult(False, errors=(
                {"field": "targets", "message": "Maximum 2 targets allowed in drip condition array"},))
        errors = []
        for i, target in enumerate(parsed):
            if not _truthy(_prop(target, "behavior")) or not isinstance(_undef_to_none(_prop(target, "rules")), list):
                errors.append({"field": f"array[{i}]",
                               "message": "Each drip condition must have behavior and rules array"})
        if errors:
            return ParseResult(False, errors=tuple(errors))
        return ParseResult(True, parsed)

    return ParseResult(False, errors=({"field": "root", "message": "Drip condition must be an object or array"},))


def get_condition_for_level(drip_condition: Any, level: str) -> Optional[Any]:
    """getConditionForLevel: the enabled condition targeting `level` (or no target)."""
    if not _truthy(drip_condition):
        return None
    if isinstance(drip_condition, list):
        for c in drip_condition:
            target = _prop(c, "target")
            if (_strict_eq(target, level) or not _truthy(target)) and _prop(c, "is_enabled") is not False:
                return c
        return None
    if _prop(drip_condition, "is_enabled") is False:
        return None
    target = _prop(drip_condition, "target")
    if _truthy(target):
        return drip_condition if _strict_eq(target, level) else None
    return drip_condition


def row_condition_for_level(raw: Any, level: str) -> Optional[Any]:
    """The condition stamped on a chapter/slide row, read the way the course
    page and slide viewer read it: JSON (or an object), the first enabled
    entry whose target is `level` or absent. Unparseable JSON is ignored."""
    if not _truthy(raw):
        return None
    try:
        return _row_condition_for_level(raw, level)
    except (ValueError, TypeError):
        # The app parses these inside try/catch and logs: no condition.
        return None


def _row_condition_for_level(raw: Any, level: str) -> Optional[Any]:
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(parsed, list):
        for c in parsed:
            target = _prop(c, "target")
            if (_strict_eq(target, level) or not _truthy(target)) and _prop(c, "is_enabled") is not False:
                return c
        return None
    if isinstance(parsed, dict):
        target = parsed.get("target")
        if (_strict_eq(target, level) or not _truthy(target)) and parsed.get("is_enabled") is not False:
            return parsed
    return None


def package_condition_for_level(raw: Any, level: str) -> Optional[Any]:
    """useDripConditions(packageDripJson, level): parse, then pick the level."""
    result = parse_drip_condition(raw)
    if not result.success or not _truthy(result.data):
        return None
    return get_condition_for_level(result.data, level)


def select_drip_condition(package_condition: Any, item_condition: Any) -> Optional[Any]:
    """selectDripCondition: an enabled package condition first, then the item's."""
    if _truthy(package_condition) and _prop(package_condition, "is_enabled") is not False:
        return package_condition
    if _truthy(item_condition):
        if _prop(item_condition, "is_enabled") is False:
            return None
        return item_condition
    return None


__all__ = [
    "MODE_MIRROR", "MODE_TIME_EXACT", "DRIP_MODES", "TIME_RULE_TYPES", "PROGRESS_RULE_TYPES",
    "js_truthy", "ProgressData", "RuleResult", "Evaluation", "OPEN", "ResolvedDripConditions", "EMPTY_SETTINGS",
    "ParseResult", "resolve_tz", "evaluate_rule", "evaluate_drip_condition", "fail_closed",
    "parse_course_settings_drip_conditions", "enforceable_condition", "resolve_drip_condition",
    "parse_drip_condition", "get_condition_for_level", "row_condition_for_level",
    "package_condition_for_level", "select_drip_condition",
]
