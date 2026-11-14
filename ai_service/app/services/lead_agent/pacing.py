"""Time rules of an agent: its day (in the window's time zone), whether delivery
is inside the window, and the start of its month (for the monthly credit cap)."""
from __future__ import annotations

import re
from datetime import date, datetime, time, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_WINDOW: Dict[str, Any] = {"tz": "Asia/Kolkata", "start": "09:30", "end": "19:00", "days": [1, 2, 3, 4, 5, 6]}
_HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def tz_of(window: Optional[dict]) -> ZoneInfo:
    name = str((window or {}).get("tz") or DEFAULT_WINDOW["tz"])
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_WINDOW["tz"])


def valid_tz(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def parse_hhmm(value: Any) -> Optional[time]:
    m = _HHMM.match(str(value or "").strip())
    return time(int(m.group(1)), int(m.group(2))) if m else None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def agent_day(window: Optional[dict], now: Optional[datetime] = None) -> date:
    """Today in the agent's window time zone (lead_agent_day.day)."""
    return (now or now_utc()).astimezone(tz_of(window)).date()


def in_window(window: Optional[dict], now: Optional[datetime] = None) -> bool:
    """True inside the delivery window: an allowed ISO weekday (1 = Monday)
    between start and end, local time. A window whose end is before its start
    runs past midnight."""
    w = {**DEFAULT_WINDOW, **(window or {})}
    local = (now or now_utc()).astimezone(tz_of(w))
    days = {int(d) for d in (w.get("days") or []) if str(d).isdigit()}
    start, end = parse_hhmm(w.get("start")), parse_hhmm(w.get("end"))
    if not days or start is None or end is None:
        return False
    t = local.time()
    if start <= end:
        return local.isoweekday() in days and start <= t < end
    # overnight window: the part after midnight belongs to the previous day
    if t >= start:
        return local.isoweekday() in days
    prev = 7 if local.isoweekday() == 1 else local.isoweekday() - 1
    return t < end and prev in days


def month_start_utc(window: Optional[dict], now: Optional[datetime] = None) -> datetime:
    local = (now or now_utc()).astimezone(tz_of(window))
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


__all__ = ["DEFAULT_WINDOW", "tz_of", "valid_tz", "parse_hhmm", "now_utc", "agent_day", "in_window",
           "month_start_utc"]
