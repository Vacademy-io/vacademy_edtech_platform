"""Why a copy failed, as a machine code (spec 8.3, T0.26).

The failed callback used to carry only `error_message`, and assessment_service
told failures apart by matching that prose. Every failure site in the
orchestrator now raises `CopyCheckFailure` with a code from the spec, or is
mapped here; `error_message` stays for people.

A failed copy is never billed, whatever the code.
"""
from __future__ import annotations

import re

COPY_UNREADABLE = "copy_unreadable"
LANGUAGE_NOT_SUPPORTED = "language_not_supported"
FILE_MISSING = "file_missing"
FILE_UNAVAILABLE = "file_unavailable"
NO_GRADABLE_QUESTIONS = "no_gradable_questions"
TIMED_OUT = "timed_out"
CANCELLED = "cancelled"
ENGINE_UNAVAILABLE = "engine_unavailable"

FAILURE_CODES = frozenset({
    COPY_UNREADABLE, LANGUAGE_NOT_SUPPORTED, FILE_MISSING, FILE_UNAVAILABLE,
    NO_GRADABLE_QUESTIONS, TIMED_OUT, CANCELLED, ENGINE_UNAVAILABLE,
    # set by assessment_service, listed so a code from there round-trips
    "insufficient_credits", "identify_failed",
})


class CopyCheckFailure(RuntimeError):
    """A copy that cannot be graded, with the spec's code for why."""

    def __init__(self, error_code: str, message: str):
        if error_code not in FAILURE_CODES:
            raise ValueError(f"unknown copy-check failure code {error_code!r}")
        super().__init__(message)
        self.error_code = error_code


# render_worker reports "render_worker job <id> failed: <error>" when its own
# download of pdf_url fails; the URL is then dead or forbidden, not the engine.
_FETCH_FAILED = re.compile(
    r"render_worker job \S+ failed:.*\b(download|fetch|404|403|410|not found|forbidden|"
    r"no such key|access denied)\b",
    re.I | re.S,
)


def error_code_for(exc: BaseException) -> str:
    """The code for an exception that ended a run. Anything unrecognised is
    `engine_unavailable`: the pipeline broke, a retry may succeed."""
    code = getattr(exc, "error_code", None)
    if isinstance(code, str) and code in FAILURE_CODES:
        return code
    if _FETCH_FAILED.search(str(exc) or ""):
        return FILE_UNAVAILABLE
    return ENGINE_UNAVAILABLE


# A presigned URL's query string is its credential. Failure text can quote the
# URL (an httpx error on pdf_url, render_worker's download error), and it rides
# to assessment_service in error_message; keep the URL, drop the signature.
_URL_QUERY = re.compile(r"(https?://[^\s?#'\"]+)\?[^\s'\"]*", re.I)


def redact_urls(message: str) -> str:
    """`message` with the query string of every http(s) URL replaced by `?<redacted>`."""
    return _URL_QUERY.sub(r"\1?<redacted>", message or "")
