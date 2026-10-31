"""Value types, outcomes and user-facing notes for the YouTube caption service.

Every module in this package logs through the ONE package logger defined here,
which carries a redaction filter: proxy credentials, proxy URLs and the
Supadata key are registered with ``register_secrets`` when the config is read,
and any log record that contains one has it replaced (and its traceback
dropped) before it is emitted.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from enum import Enum
from typing import FrozenSet, Literal, Optional, Set, Tuple

Kind = Literal["manual", "auto", "translated", "unknown"]
Route = Literal["cache", "legacy_cache", "direct", "proxy", "supadata"]

PURPOSES = ("tutor", "kb_ingest", "course_knowledge", "probe")
INTERACTIVE_PURPOSES = frozenset({"tutor", "kb_ingest", "probe"})
BATCH_PURPOSES = frozenset({"course_knowledge"})


class Outcome(str, Enum):
    OK = "OK"
    # definitive: about the video (negative-cached)
    NO_CAPTIONS = "NO_CAPTIONS"
    UNAVAILABLE = "UNAVAILABLE"
    PRIVATE = "PRIVATE"
    AGE_RESTRICTED = "AGE_RESTRICTED"
    # transient: about us / YouTube today (never cached)
    BLOCKED = "BLOCKED"
    PO_TOKEN = "PO_TOKEN"
    UNPARSABLE = "UNPARSABLE"
    EMPTY_BODY = "EMPTY_BODY"
    UNPLAYABLE = "UNPLAYABLE"
    TIMEOUT = "TIMEOUT"
    NETWORK = "NETWORK"
    PROXY_AUTH = "PROXY_AUTH"
    BUSY = "BUSY"
    DISABLED = "DISABLED"


DEFINITIVE: FrozenSet[Outcome] = frozenset({
    Outcome.NO_CAPTIONS, Outcome.UNAVAILABLE, Outcome.PRIVATE, Outcome.AGE_RESTRICTED,
})
TRANSIENT: FrozenSet[Outcome] = frozenset(o for o in Outcome if o is not Outcome.OK and o not in DEFINITIVE)
# Definitive outcomes that end the chain (Supadata never runs after them).
TRUSTED_FINAL: FrozenSet[Outcome] = frozenset({Outcome.NO_CAPTIONS, Outcome.UNAVAILABLE, Outcome.PRIVATE})


@dataclass(frozen=True)
class CaptionSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class CaptionResult:
    video_id: str
    outcome: Outcome
    segments: Tuple[CaptionSegment, ...] = ()
    language: Optional[str] = None          # code of the track returned ("hi", "en-IN")
    kind: Optional[Kind] = None
    translated_from: Optional[str] = None
    route: Optional[Route] = None
    available: Tuple[str, ...] = ()         # ("hi:auto", "en:manual") from the listing
    transient: bool = False                 # True = retry later, never mark "no captions"
    retry_after_s: Optional[int] = None     # breaker remaining / backoff hint
    note: Optional[str] = None              # user-facing sentence
    # False = a definitive answer only the direct route gave, with nothing to
    # confirm it (no proxy / Supadata configured): reported as definitive, as
    # before the service existed, but never negative-cached.
    confirmed: bool = True
    # A fallback route (proxy or Supadata) is configured. False = a transient
    # result will most likely repeat on a retry from this server's IP.
    fallback_configured: bool = True

    @property
    def ok(self) -> bool:
        return self.outcome is Outcome.OK

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.segments if s.text)


class CaptionsError(ValueError):
    """Raised by require_captions. A ValueError, so existing ``except ValueError``
    callers keep working; ``str(exc)`` is the user-facing note."""

    def __init__(self, result: CaptionResult):
        super().__init__(result.note or f"YouTube captions unavailable ({result.outcome.value})")
        self.result = result


# ── user-facing notes ────────────────────────────────────────────────────────

NOTE_RETRY_AUTO = ("YouTube didn't give us the captions just now (blocked or busy). We'll try again "
                   "automatically. Nothing needs to change on your side.")
NOTE_RETRY_TUTOR = ("YouTube blocked our caption request just now. Try again in a few minutes, add what "
                    "the video teaches, or upload the video file.")
# Knowledge-base sources are not retried automatically (an admin re-adds them),
# so they must not be promised an automatic retry.
NOTE_RETRY_KB = ("YouTube didn't give us the captions just now (blocked or busy). Try adding this video "
                 "again in a few minutes.")

NOTES = {
    Outcome.NO_CAPTIONS: "This YouTube video has no captions. Add what it teaches, or upload the video so it can be transcribed.",
    Outcome.PRIVATE: ("This YouTube video is private or members-only, so its captions can't be read. Make it public "
                      "or unlisted, or upload the video."),
    Outcome.AGE_RESTRICTED: ("This YouTube video is age-restricted, so its captions can't be read. Upload the video "
                             "or add what it teaches."),
    Outcome.UNAVAILABLE: "This YouTube video was removed or the link is wrong. Check the link.",
}


def note_for(outcome: Outcome, purpose: str, *, transient: Optional[bool] = None) -> Optional[str]:
    """The sentence shown to the user for this outcome and caller."""
    if outcome is Outcome.OK:
        return None
    is_transient = (outcome in TRANSIENT) if transient is None else transient
    if is_transient:
        if purpose == "tutor":
            return NOTE_RETRY_TUTOR
        if purpose == "kb_ingest":
            return NOTE_RETRY_KB
        return NOTE_RETRY_AUTO
    return NOTES.get(outcome, NOTE_RETRY_AUTO)


# ── package logger with secret redaction ─────────────────────────────────────

_SECRETS: Set[str] = set()
_SECRETS_LOCK = threading.Lock()
_URL_CREDS = re.compile(r"(://)[^/\s:@]+:[^/\s@]+@")
REDACTED = "[redacted]"


def register_secrets(*values: Optional[str]) -> None:
    """Values that must never appear in a log line (proxy creds, URLs, keys)."""
    with _SECRETS_LOCK:
        for v in values:
            if v and len(str(v)) >= 4:
                _SECRETS.add(str(v))


def redact(text: str) -> str:
    out = _URL_CREDS.sub(r"\1" + REDACTED + "@", str(text))
    with _SECRETS_LOCK:
        secrets = sorted(_SECRETS, key=len, reverse=True)
    for s in secrets:
        if s in out:
            out = out.replace(s, REDACTED)
    return out


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 - logging API
        try:
            msg = record.getMessage()
            clean = redact(msg)
            if clean != msg:
                record.msg, record.args = clean, None
            if record.exc_info:
                import traceback
                tb = "".join(traceback.format_exception(*record.exc_info))
                if redact(tb) != tb:
                    record.exc_info, record.exc_text = None, None
                    record.msg = f"{record.msg} (traceback dropped: it contained a credential)"
        except Exception:  # noqa: BLE001 - never lose a log line to the filter
            pass
        return True


logger = logging.getLogger(__name__.rsplit(".", 1)[0])
if not any(isinstance(f, _RedactFilter) for f in logger.filters):
    logger.addFilter(_RedactFilter())


__all__ = [
    "Kind", "Route", "Outcome", "DEFINITIVE", "TRANSIENT", "TRUSTED_FINAL",
    "PURPOSES", "INTERACTIVE_PURPOSES", "BATCH_PURPOSES",
    "CaptionSegment", "CaptionResult", "CaptionsError",
    "NOTES", "NOTE_RETRY_AUTO", "NOTE_RETRY_TUTOR", "NOTE_RETRY_KB", "note_for",
    "register_secrets", "redact", "logger",
]
