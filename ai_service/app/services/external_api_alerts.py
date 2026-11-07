"""Email the team when a third-party API runs out of credits or keeps failing.

Every few minutes one replica reads the newest external_api_call_log rows of each API and key:
  * CREDITS: the current run of failures includes a 402 or the vendor saying the balance is gone.
    One call is enough, because nothing will succeed until someone tops up.
  * FAILING: the last `alert_consecutive_failures` calls all failed, with no success between.

An alert emails once, again every `alert_repeat_hours` while it lasts, and once more when a call
succeeds. A key can be muted from the portal. Emails carry the last four characters of a key at
most, and every problem in a pass shares one email, so an outage does not send one per API.

Covers what reaches external_api_call_log: calls with a key through httpx (httpx_capture) and
Serper. Java services and the voice bot do not write there yet.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy import text

logger = logging.getLogger(__name__)

EMAILS_SETTING = "external_apis.alert_emails"
THRESHOLD_SETTING = "external_apis.alert_consecutive_failures"
REPEAT_SETTING = "external_apis.alert_repeat_hours"

SWEEP_SECONDS = 300
# No calls for this long and a run of failures is no longer news. An empty balance stays open
# for the whole lookback: it is still empty at 8am though nobody called overnight.
FAILING_WINDOW = timedelta(hours=1)
LOOKBACK_HOURS = 24
# Enough to report a long run. The highest threshold the setting allows is 50.
MAX_ROWS_PER_KEY = 100
MAX_RECIPIENTS = 20
MAX_ERROR_LENGTH = 300

CREDITS = "CREDITS"
FAILING = "FAILING"

_EMAIL = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")
_OUT_OF_CREDITS = re.compile(
    r"insufficient[ _](credit|fund|balance|quota)|not enough credit|out of credit|credit balance"
    r"|exceeded your current quota|quota exceeded|payment required",
    re.IGNORECASE,
)
_LOCK_KEY = "external_api_alerts"
_TRY_LOCK = text("SELECT pg_try_advisory_xact_lock(hashtext(:key))")

_RECENT_CALLS = text("""
    SELECT vendor, key_hint, status, http_status, error_message, occurred_at
    FROM (
        SELECT vendor, key_hint, status, http_status, error_message, occurred_at,
               row_number() OVER (PARTITION BY vendor, key_hint ORDER BY occurred_at DESC) AS newest_first
        FROM external_api_call_log
        WHERE key_hint IS NOT NULL
          AND occurred_at > now() - make_interval(hours => CAST(:lookback AS int))
    ) ranked
    WHERE newest_first <= :max_rows
    ORDER BY vendor, key_hint, occurred_at DESC
""")

_UPSERT = text("""
    INSERT INTO external_api_alert (vendor, key_hint, kind, is_open, opened_at, last_failed_at,
                                    consecutive_failures, last_http_status, last_error)
    VALUES (:vendor, :key_hint, :kind, TRUE, :now, :last_failed_at, :consecutive, :http_status, :error)
    ON CONFLICT (vendor, key_hint) DO UPDATE SET
        kind = EXCLUDED.kind,
        last_failed_at = EXCLUDED.last_failed_at,
        consecutive_failures = EXCLUDED.consecutive_failures,
        last_http_status = EXCLUDED.last_http_status,
        last_error = EXCLUDED.last_error,
        opened_at = CASE WHEN external_api_alert.is_open THEN external_api_alert.opened_at ELSE EXCLUDED.opened_at END,
        last_notified_at = CASE WHEN external_api_alert.is_open THEN external_api_alert.last_notified_at END,
        is_open = TRUE,
        resolved_at = NULL
""")


@dataclass(frozen=True)
class Problem:
    kind: str
    consecutive: int
    last_failed_at: datetime
    http_status: Optional[int]
    error: Optional[str]


@dataclass(frozen=True)
class Notice:
    event: str  # opened | reminder | recovered
    vendor: str
    key_hint: str
    kind: str
    consecutive: int = 0
    http_status: Optional[int] = None
    error: Optional[str] = None
    previous_notified_at: Optional[datetime] = None
    account: Optional[str] = None


def parse_emails(raw: Any) -> List[str]:
    """The valid, distinct addresses in the setting. Anything else is left out, not fatal."""
    found = [part.strip() for part in str(raw or "").split(",")]
    return list(dict.fromkeys(e for e in found if _EMAIL.match(e)))[:MAX_RECIPIENTS]


def invalid_emails(raw: str) -> List[str]:
    return [e for e in (part.strip() for part in raw.split(",")) if e and not _EMAIL.match(e)]


def looks_out_of_credits(http_status: Optional[int], error: Optional[str]) -> bool:
    return http_status == 402 or bool(error and _OUT_OF_CREDITS.search(error))


def classify(rows: Sequence[Mapping[str, Any]], threshold: int, now: datetime) -> Optional[Problem]:
    """What is wrong with one API and key, from its calls, newest first. None when nothing is."""
    streak = []
    for row in rows:
        if row["status"] != "FAILED":
            break
        streak.append(row)
    if not streak:
        return None
    latest = streak[0]
    out_of_credits = any(looks_out_of_credits(r["http_status"], r["error_message"]) for r in streak)
    if out_of_credits:
        kind = CREDITS
    elif len(streak) >= threshold and now - latest["occurred_at"] <= FAILING_WINDOW:
        kind = FAILING
    else:
        return None
    return Problem(
        kind=kind,
        consecutive=len(streak),
        last_failed_at=latest["occurred_at"],
        http_status=latest["http_status"],
        error=(latest["error_message"] or "")[:MAX_ERROR_LENGTH] or None,
    )


def is_due(previous_notified_at: Optional[datetime], repeat_hours: float, now: datetime) -> bool:
    return previous_notified_at is None or now - previous_notified_at >= timedelta(hours=repeat_hours)


def account_for(details: Mapping[str, Mapping[str, Any]], hint: str) -> Optional[str]:
    """The account staff entered for the key with this hint on the Keys & accounts tab."""
    for name, entry in details.items():
        if name.endswith(f":{hint}") and entry.get("account"):
            return str(entry["account"])
    return None


def _settings(db: Any) -> Tuple[List[str], int, float]:
    from .platform_settings_service import get_platform_setting

    return (
        parse_emails(get_platform_setting(EMAILS_SETTING, db=db)),
        int(get_platform_setting(THRESHOLD_SETTING, db=db)),
        float(get_platform_setting(REPEAT_SETTING, db=db)),
    )


def _key_details(db: Any) -> Dict[str, Dict[str, Any]]:
    from .external_api_keys import DETAILS_SETTING, parse_details
    from .platform_settings_service import get_platform_setting

    return parse_details(get_platform_setting(DETAILS_SETTING, default="{}", db=db))


def evaluate(db: Any, now: Optional[datetime] = None) -> Optional[List[Notice]]:
    """One pass: bring external_api_alert up to date and claim what is due to be sent.

    Returns the notices, or None when another replica holds the lock. Claiming here, inside the
    lock, is what stops a second replica sending the same email; release() undoes a failed send.
    """
    now = now or datetime.now(timezone.utc)
    if not db.execute(_TRY_LOCK, {"key": _LOCK_KEY}).scalar():
        return None
    # Created by admin_core's Flyway, which may deploy after this service.
    if not db.execute(text("SELECT to_regclass('external_api_alert') IS NOT NULL")).scalar():
        return []
    emails, threshold, repeat_hours = _settings(db)

    calls: Dict[Tuple[str, str], List[Mapping[str, Any]]] = {}
    for row in db.execute(_RECENT_CALLS, {"lookback": LOOKBACK_HOURS, "max_rows": MAX_ROWS_PER_KEY}).mappings():
        calls.setdefault((row["vendor"], row["key_hint"]), []).append(row)

    problems = {pair: p for pair, rows in calls.items() if (p := classify(rows, threshold, now))}
    for (vendor, hint), p in problems.items():
        db.execute(_UPSERT, {
            "vendor": vendor, "key_hint": hint, "kind": p.kind, "now": now, "last_failed_at": p.last_failed_at,
            "consecutive": p.consecutive, "http_status": p.http_status, "error": p.error,
        })

    notices = _close_finished(db, problems, calls, now, bool(emails))
    if emails:
        notices += _claim_due(db, repeat_hours, now)
    db.commit()
    return notices


def _close_finished(
    db: Any,
    problems: Mapping[Tuple[str, str], Problem],
    calls: Mapping[Tuple[str, str], Sequence[Mapping[str, Any]]],
    now: datetime,
    can_notify: bool,
) -> List[Notice]:
    """Close alerts that no longer hold. Only a real success counts as recovered: an alert that
    merely went quiet closes without an email, because nobody knows that it works again."""
    notices: List[Notice] = []
    rows = db.execute(text(
        "SELECT vendor, key_hint, kind, muted, last_notified_at FROM external_api_alert WHERE is_open"
    )).mappings().all()
    for row in rows:
        pair = (row["vendor"], row["key_hint"])
        if pair in problems:
            continue
        db.execute(
            text("UPDATE external_api_alert SET is_open = FALSE, resolved_at = :now "
                 "WHERE vendor = :vendor AND key_hint = :key_hint"),
            {"now": now, "vendor": pair[0], "key_hint": pair[1]},
        )
        latest = calls.get(pair)
        told = row["last_notified_at"] is not None and not row["muted"]
        if can_notify and told and latest and latest[0]["status"] == "SUCCESS":
            notices.append(Notice("recovered", pair[0], pair[1], row["kind"]))
    return notices


def _claim_due(db: Any, repeat_hours: float, now: datetime) -> List[Notice]:
    notices: List[Notice] = []
    rows = db.execute(text(
        "SELECT vendor, key_hint, kind, consecutive_failures, last_http_status, last_error, last_notified_at "
        "FROM external_api_alert WHERE is_open AND NOT muted"
    )).mappings().all()
    for row in rows:
        previous = row["last_notified_at"]
        if not is_due(previous, repeat_hours, now):
            continue
        db.execute(
            text("UPDATE external_api_alert SET last_notified_at = :now WHERE vendor = :vendor AND key_hint = :key_hint"),
            {"now": now, "vendor": row["vendor"], "key_hint": row["key_hint"]},
        )
        notices.append(Notice(
            event="reminder" if previous else "opened",
            vendor=row["vendor"], key_hint=row["key_hint"], kind=row["kind"],
            consecutive=row["consecutive_failures"], http_status=row["last_http_status"],
            error=row["last_error"], previous_notified_at=previous,
        ))
    return notices


def release(db: Any, notices: Iterable[Notice]) -> None:
    """The email did not go: unclaim, so the next pass tries again."""
    for notice in notices:
        if notice.event == "recovered":
            continue
        db.execute(
            text("UPDATE external_api_alert SET last_notified_at = :previous "
                 "WHERE vendor = :vendor AND key_hint = :key_hint"),
            {"previous": notice.previous_notified_at, "vendor": notice.vendor, "key_hint": notice.key_hint},
        )
    db.commit()


def _headline(notice: Notice) -> str:
    who = notice.vendor
    if notice.event == "recovered":
        return f"{who} is working again"
    still = "still " if notice.event == "reminder" else ""
    if notice.kind == CREDITS:
        return f"{who} is {still}out of credits"
    return f"{who} is {still}failing"


def subject_for(notices: Sequence[Notice]) -> str:
    if len(notices) == 1:
        return f"API alert: {_headline(notices[0])}"
    return f"API alert: {len(notices)} updates, including {_headline(notices[0])}"


def _advice(notice: Notice) -> str:
    if notice.event == "recovered":
        return "A call just succeeded. Nothing to do."
    if notice.kind == CREDITS:
        return "Top up the account that owns this key. Calls using it will keep failing until then."
    return f"The last {notice.consecutive} calls failed with no success between them. Check the vendor's status and this key."


def body_for(notices: Sequence[Notice]) -> str:
    """Everything from a vendor or from staff is escaped: this is HTML going to people's inboxes."""
    parts = ['<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">']
    for notice in notices:
        facts = [f"Key ending {notice.key_hint}" if notice.key_hint != "****" else "Key too short to show"]
        facts.append(f"Account: {notice.account}" if notice.account
                     else "Account not entered, and it may be an institute's own key")
        if notice.http_status:
            facts.append(f"Last status: {notice.http_status}")
        if notice.error:
            facts.append(f"Last error: {notice.error}")
        parts.append(f"<p><strong>{html.escape(_headline(notice))}</strong><br>{html.escape(_advice(notice))}</p><ul>")
        parts.extend(f"<li>{html.escape(fact)}</li>" for fact in facts)
        parts.append("</ul>")
    parts.append("<p style=\"color:#555\">Details, recipients and mute are on the health dashboard: "
                 "External APIs, Alerts. Automatic alert.</p></div>")
    return "".join(parts)


async def send_email(emails: Sequence[str], subject: str, body: str, source_id: Optional[str] = None) -> bool:
    from .staff_notify import email

    return await email(
        platform_institute_id(),
        [{"email": address} for address in emails],
        subject,
        body,
        source="EXTERNAL_API_ALERT",
        source_id=source_id,
    )


def platform_institute_id() -> str:
    """notification_service refuses a send with no institute, and team alerts belong to no
    customer. The same platform institute as community_service's team-facing mail."""
    return os.getenv("PLATFORM_INSTITUTE_ID") or "c8a5d265-858b-4a8e-9449-25be857db538"


def _with_accounts(db: Any, notices: List[Notice]) -> Tuple[List[Notice], List[str]]:
    details = _key_details(db)
    named = [replace(n, account=account_for(details, n.key_hint)) for n in notices]
    return named, _settings(db)[0]


def _evaluate_pass() -> Tuple[List[Notice], List[str]]:
    from ..db import db_session

    with db_session() as db:
        notices = evaluate(db)
        return _with_accounts(db, notices) if notices else ([], [])


def _release_pass(notices: List[Notice]) -> None:
    from ..db import db_session

    with db_session() as db:
        release(db, notices)


async def run_sweep() -> int:
    """The scheduled pass. Returns how many notices went out. Never raises."""
    try:
        notices, emails = await asyncio.to_thread(_evaluate_pass)
        if not notices:
            return 0
        if await send_email(emails, subject_for(notices), body_for(notices)):
            return len(notices)
        logger.warning("external API alerts: email not accepted, retrying on the next pass")
        await asyncio.to_thread(_release_pass, notices)
    except Exception as exc:  # noqa: BLE001 - e.g. the database is unreachable
        logger.warning("external API alerts: pass skipped: %s", exc)
    return 0


def start_external_api_alerts() -> None:
    """Schedule the sweep on the running event loop, like the billing reconciliation."""

    async def _loop() -> None:
        while True:
            await asyncio.sleep(SWEEP_SECONDS)
            await run_sweep()

    asyncio.get_event_loop().create_task(_loop())


__all__ = [
    "CREDITS",
    "EMAILS_SETTING",
    "FAILING",
    "REPEAT_SETTING",
    "THRESHOLD_SETTING",
    "Notice",
    "account_for",
    "body_for",
    "classify",
    "evaluate",
    "invalid_emails",
    "is_due",
    "looks_out_of_credits",
    "parse_emails",
    "release",
    "run_sweep",
    "send_email",
    "start_external_api_alerts",
    "subject_for",
]
