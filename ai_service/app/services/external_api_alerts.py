"""Email and WhatsApp the team when a third-party API runs out of credits or keeps failing.

Every few minutes one replica reads the newest external_api_call_log rows of each API and key:
  * CREDITS: the current run of failures includes a 402 or the vendor saying the balance is gone.
    One call is enough, because nothing will succeed until someone tops up.
  * FAILING: the last `alert_consecutive_failures` calls all failed, with no success between.

An alert emails once, again every `alert_repeat_hours` while it lasts, and once more when a call
succeeds. A key can be muted from the portal. Emails carry the last four characters of a key at
most, and every problem in a pass shares one email, so an outage does not send one per API.

WhatsApp goes to the numbers set on the portal, one message per pass, straight to Meta from the
Vidyayatan account exactly as community_service's server health check pages (same env vars, same
already-approved UTILITY template: status, host, ip, details, time), so it needs no new approval.

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
PHONES_SETTING = "external_apis.alert_whatsapp_phones"
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
MAX_PHONES = 10
# Meta caps a template body at 1024 characters; the template's own words take some of it.
WHATSAPP_FIELD_LIMIT = 250
WHATSAPP_DETAILS_LIMIT = 600
# India when a number is written without its country code, as people here usually do.
DEFAULT_COUNTRY_CODE = "91"
IST = timezone(timedelta(hours=5, minutes=30))

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


def _phone(part: str) -> Optional[str]:
    """A WhatsApp number as Meta wants it: digits with the country code. None when it is not one."""
    digits = re.sub(r"[\s\-().]", "", part.strip())
    if digits.startswith("+"):
        digits = digits[1:]
    elif digits.startswith("00"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = DEFAULT_COUNTRY_CODE + digits[1:]
    elif len(digits) == 10:
        digits = DEFAULT_COUNTRY_CODE + digits
    return digits if digits.isdigit() and 11 <= len(digits) <= 15 else None


def parse_phones(raw: Any) -> List[str]:
    """The valid, distinct numbers in the setting, with their country code. Anything else is left out."""
    found = (_phone(part) for part in str(raw or "").split(","))
    return list(dict.fromkeys(p for p in found if p))[:MAX_PHONES]


def invalid_phones(raw: str) -> List[str]:
    return [p for p in (part.strip() for part in raw.split(",")) if p and not _phone(p)]


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


@dataclass(frozen=True)
class Recipients:
    emails: List[str]
    phones: List[str]

    def __bool__(self) -> bool:
        return bool(self.emails or self.phones)


def _recipients(db: Any) -> Recipients:
    from .platform_settings_service import get_platform_setting

    return Recipients(
        emails=parse_emails(get_platform_setting(EMAILS_SETTING, db=db)),
        phones=parse_phones(get_platform_setting(PHONES_SETTING, default="", db=db)),
    )


def _settings(db: Any) -> Tuple[Recipients, int, float]:
    from .platform_settings_service import get_platform_setting

    return (
        _recipients(db),
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
    recipients, threshold, repeat_hours = _settings(db)

    calls: Dict[Tuple[str, str], List[Mapping[str, Any]]] = {}
    for row in db.execute(_RECENT_CALLS, {"lookback": LOOKBACK_HOURS, "max_rows": MAX_ROWS_PER_KEY}).mappings():
        calls.setdefault((row["vendor"], row["key_hint"]), []).append(row)

    problems = {pair: p for pair, rows in calls.items() if (p := classify(rows, threshold, now))}
    for (vendor, hint), p in problems.items():
        db.execute(_UPSERT, {
            "vendor": vendor, "key_hint": hint, "kind": p.kind, "now": now, "last_failed_at": p.last_failed_at,
            "consecutive": p.consecutive, "http_status": p.http_status, "error": p.error,
        })

    notices = _close_finished(db, problems, calls, now, bool(recipients))
    if recipients:
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


def whatsapp_template() -> str:
    """The approved UTILITY template the server health check pages with (status, host, ip,
    details, time). UTILITY matters: Meta throttles MARKETING templates sent to the same number."""
    return os.getenv("EXTERNAL_API_ALERT_WHATSAPP_TEMPLATE") or "vacademy_server_health_check_utility"


def _wa_text(value: Any, limit: int = WHATSAPP_FIELD_LIMIT) -> str:
    """Meta rejects a template field that is empty, holds a newline or tab, or runs more than
    four spaces together."""
    flat = re.sub(r"\s+", " ", str(value or "")).strip() or "-"
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _key_line(notice: Notice) -> str:
    key = f"key ending {notice.key_hint}" if notice.key_hint != "****" else "key too short to show"
    return f"{notice.account} ({key})" if notice.account else key


def whatsapp_fields(notices: Sequence[Notice], now: Optional[datetime] = None) -> Dict[str, str]:
    """The five fields of the health-check template, for every notice of one pass together."""
    now = now or datetime.now(timezone.utc)
    vendors = list(dict.fromkeys(n.vendor for n in notices))
    details = []
    for n in notices:
        status = f" Last status {n.http_status}." if n.http_status else ""
        error = f" Last error: {n.error}" if n.error and n.event != "recovered" else ""
        details.append(f"{_headline(n)}: {_advice(n)}{status}{error}")
    details.append("Recipients and mute: health dashboard, External APIs, Alerts.")
    return {
        "1": _wa_text(subject_for(notices)),
        "2": _wa_text(", ".join(vendors)),
        "3": _wa_text("; ".join(dict.fromkeys(_key_line(n) for n in notices))),
        "4": _wa_text(" | ".join(details), WHATSAPP_DETAILS_LIMIT),
        "5": _wa_text(now.astimezone(IST).strftime("%d %b %Y %I:%M %p IST")),
    }


META_API = "https://graph.facebook.com/v21.0"


def whatsapp_payload(phone: str, template: str, fields: Mapping[str, str]) -> Dict[str, Any]:
    """The Meta Cloud API template message, exactly as community_service's health check builds it:
    the body parameters in order 1..5."""
    return {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "template",
        "template": {
            "name": template,
            "language": {"code": "en"},
            "components": [{
                "type": "body",
                "parameters": [{"type": "text", "text": fields[k]} for k in sorted(fields, key=int)],
            }],
        },
    }


def meta_error(body: Any) -> str:
    """Meta's own words for a refusal ("(#132001) Template name does not exist in the translation")."""
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        code = error.get("code")
        message = (error.get("error_data") or {}).get("details") or error.get("message") or ""
        return f"(#{code}) {message}".strip() if code else str(message) or "refused"
    return "refused"


async def send_whatsapp(phones: Sequence[str], fields: Mapping[str, str]) -> List[Dict[str, Any]]:
    """One template message per number, straight to Meta from the Vidyayatan WhatsApp account, the
    way community_service pages the server health check (same token and phone number id env vars).
    Returns each number's result {"phone", "success", "error"}; one bad number never stops the rest."""
    import httpx

    token = (os.getenv("WHATSAPP_ACCESS_TOKEN_VIDYAYATAN") or "").strip()
    phone_number_id = (os.getenv("WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN") or "").strip()
    if not token or not phone_number_id:
        # Loud: an alert was due and could not go. Silence here looks like a healthy channel.
        logger.warning("external API alerts: WhatsApp not configured on ai-service "
                       "(WHATSAPP_ACCESS_TOKEN_VIDYAYATAN / WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN)")
        return [{"phone": p, "success": False,
                 "error": "WhatsApp is not set up on ai-service: WHATSAPP_ACCESS_TOKEN_VIDYAYATAN "
                          "and WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN are missing"} for p in phones]

    url = f"{META_API}/{phone_number_id}/messages"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    template = whatsapp_template()
    results: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for phone in phones:
            try:
                resp = await client.post(url, json=whatsapp_payload(phone, template, fields), headers=headers)
            except Exception as exc:  # noqa: BLE001
                results.append({"phone": phone, "success": False, "error": f"{type(exc).__name__}: {exc}"[:200]})
                continue
            if resp.is_success:
                results.append({"phone": phone, "success": True, "error": None})
                continue
            try:
                error = meta_error(resp.json())
            except ValueError:
                error = f"HTTP {resp.status_code}"
            logger.warning("external API alerts: Meta refused WhatsApp to %s: HTTP %s %s",
                           phone, resp.status_code, error)
            results.append({"phone": phone, "success": False, "error": error})
    return results


def platform_institute_id() -> str:
    """notification_service refuses a send with no institute, and team alerts belong to no
    customer. The same platform institute as community_service's team-facing mail."""
    return os.getenv("PLATFORM_INSTITUTE_ID") or "c8a5d265-858b-4a8e-9449-25be857db538"


def _with_accounts(db: Any, notices: List[Notice]) -> Tuple[List[Notice], Recipients]:
    details = _key_details(db)
    named = [replace(n, account=account_for(details, n.key_hint)) for n in notices]
    return named, _recipients(db)


def _evaluate_pass() -> Tuple[List[Notice], Recipients]:
    from ..db import db_session

    with db_session() as db:
        notices = evaluate(db)
        return _with_accounts(db, notices) if notices else ([], Recipients([], []))


def _release_pass(notices: List[Notice]) -> None:
    from ..db import db_session

    with db_session() as db:
        release(db, notices)


async def run_sweep() -> int:
    """The scheduled pass. Returns how many notices went out. Never raises."""
    try:
        notices, recipients = await asyncio.to_thread(_evaluate_pass)
        if not notices:
            return 0
        delivered = False
        if recipients.emails:
            if await send_email(recipients.emails, subject_for(notices), body_for(notices)):
                delivered = True
            else:
                logger.warning("external API alerts: email not accepted")
        if recipients.phones:
            results = await send_whatsapp(recipients.phones, whatsapp_fields(notices))
            for r in results:
                if not r.get("success"):
                    logger.warning("external API alerts: WhatsApp to %s refused: %s", r.get("phone"), r.get("error"))
            delivered = delivered or any(r.get("success") for r in results)
        if delivered:
            return len(notices)
        # Nobody was told: unclaim so the next pass tries again. One channel getting through is
        # enough, or a broken channel would resend the working one every five minutes.
        logger.warning("external API alerts: nothing delivered, retrying on the next pass")
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
    "invalid_phones",
    "is_due",
    "looks_out_of_credits",
    "parse_emails",
    "parse_phones",
    "PHONES_SETTING",
    "release",
    "run_sweep",
    "send_email",
    "meta_error",
    "send_whatsapp",
    "whatsapp_payload",
    "start_external_api_alerts",
    "subject_for",
    "whatsapp_fields",
    "whatsapp_template",
]
