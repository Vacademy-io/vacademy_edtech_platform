"""The direct and proxy routes through youtube-transcript-api (pinned 1.2.4).

Everything here is SYNCHRONOUS and runs inside ``asyncio.to_thread``. One
``YouTubeTranscriptApi`` and one ``requests.Session`` are created per attempt
(the session is not thread-safe, and a fresh client is what makes an outer
retry land on a new proxy IP).

``make_api`` is the test seam: tests replace it with a fake that returns
(fake_api, meter) where ``meter.bytes_in`` is an int.

Notes on the library (1.2.4):
  * ``list()`` retries a blocked listing ``retries_when_blocked`` times (each
    on a new connection, so a rotating proxy gives a new IP); ``fetch()`` of a
    track is never retried, which is why the service adds outer retries;
  * ``GenericProxyConfig`` keeps connections alive and has 0 retries, so it
    would never rotate: ``RotatingGenericProxyConfig`` fixes both;
  * with ``retries_when_blocked > 0`` the constructor mounts adapters with
    ``Retry(total=n, status_forcelist=[429])`` on our session: every GET is
    then retried n more times on connect / read timeouts (minutes per call
    against a hanging proxy) and an exhausted 429 surfaces as
    ``requests.RetryError``. ``make_api`` re-mounts adapters with NO
    transport retries: a 429 reaches the library as ``IpBlocked`` (re-listed
    on a new IP by the library, retried with a fresh client by the service).

Wall clock: ``fetch_route(deadline=...)`` gives the session a monotonic
deadline; each request's (connect, read) timeout is cut to what is left and a
request after the deadline raises ``DeadlineReached`` (a requests Timeout ->
TIMEOUT), so one attempt never outlives the caller's budget by more than one
socket read.
"""
from __future__ import annotations

import time
import zlib
from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple

import requests

from . import languages
from .types import CaptionSegment, Outcome, logger

CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = 20
PROXY_MODES = ("webshare", "generic", "off")

try:  # pragma: no cover - depends on the installed distribution
    from importlib.metadata import version as _dist_version
    LIB_VERSION = _dist_version("youtube-transcript-api")
except Exception:  # noqa: BLE001
    LIB_VERSION = "unknown"


# Sentinel: the candidate cannot be produced (not translatable); try the next one.
SKIP = "SKIP"


@dataclass(frozen=True)
class ProxySettings:
    mode: str = "off"                       # webshare | generic | off
    username: Optional[str] = None
    password: Optional[str] = None
    http_url: Optional[str] = None
    https_url: Optional[str] = None
    countries: Tuple[str, ...] = ()
    retries_when_blocked: int = 4

    @property
    def configured(self) -> bool:
        if self.mode == "webshare":
            return bool(self.username and self.password)
        if self.mode == "generic":
            return bool(self.http_url or self.https_url)
        return False


@dataclass
class RouteAttempt:
    """One route's attempt at one video (one client)."""
    route: str
    outcome: Outcome
    segments: Tuple[CaptionSegment, ...] = ()
    language: Optional[str] = None
    kind: Optional[str] = None
    translated_from: Optional[str] = None
    available: Tuple[str, ...] = ()
    snippets: int = 0
    bytes_in: int = 0
    ms: int = 0
    detail: Optional[str] = None            # short, redacted reason for logs
    credits: int = 0                        # Supadata only
    open_breaker_s: Optional[int] = None    # Supadata only: auth / rate-limit cooldown
    tracks_tried: List[str] = field(default_factory=list)


# ── client construction ──────────────────────────────────────────────────────

DEADLINE_DETAIL = "caption deadline reached"


class DeadlineReached(requests.exceptions.Timeout):
    """The caller's wall-clock budget ran out before this request."""


def _session_class():
    class _TimeoutSession(requests.Session):
        """Default (connect, read) timeout on every request, cut to the time
        left before ``deadline`` (monotonic); counts bytes in."""

        def __init__(self) -> None:
            super().__init__()
            self.bytes_in = 0
            self.decoded_bytes = 0
            self.deadline: Optional[float] = None
            self.hooks["response"].append(self._count)

        def set_deadline(self, deadline: Optional[float]) -> None:
            self.deadline = deadline

        def request(self, method, url, **kwargs):  # noqa: D401 - requests API
            timeout = kwargs.get("timeout") or (CONNECT_TIMEOUT_S, READ_TIMEOUT_S)
            if self.deadline is not None:
                left = self.deadline - time.monotonic()
                if left <= 0.05:
                    raise DeadlineReached(DEADLINE_DETAIL)
                connect, read = timeout if isinstance(timeout, tuple) else (timeout, timeout)
                timeout = (min(float(connect), left), min(float(read), left))
            kwargs["timeout"] = timeout
            return super().request(method, url, **kwargs)

        def _count(self, resp, *args, **kwargs):
            """Approximate bytes over the wire, which is what proxy bandwidth is
            billed on. urllib3 does not expose the compressed size of a chunked
            body, so a compressed response is re-compressed (zlib level 6, in
            this worker thread) as the estimate; measured on a watch page:
            330 KB on the wire vs 1.4 MB decoded. decoded_bytes keeps the raw size."""
            try:
                body = resp.content or b""
                self.decoded_bytes += len(body)
                wire = 0
                try:
                    wire = int(resp.headers.get("content-length") or 0)
                except (TypeError, ValueError):
                    wire = 0
                if wire <= 0 or wire == len(body):
                    encoded = (resp.headers.get("content-encoding") or "").strip().lower()
                    wire = len(zlib.compress(body, 6)) if encoded and encoded != "identity" else len(body)
                self.bytes_in += wire
            except Exception:  # noqa: BLE001 - metering never fails a request
                pass
            return resp

    return _TimeoutSession


def _rotating_generic_class():
    from youtube_transcript_api.proxies import GenericProxyConfig

    class RotatingGenericProxyConfig(GenericProxyConfig):
        def __init__(self, http_url: Optional[str], https_url: Optional[str], retries: int) -> None:
            super().__init__(http_url=http_url, https_url=https_url)
            self._retries = max(0, int(retries))

        @property
        def prevent_keeping_connections_alive(self) -> bool:
            return True

        @property
        def retries_when_blocked(self) -> int:
            return self._retries

    return RotatingGenericProxyConfig


def make_proxy_config(proxy: Optional[ProxySettings]):
    if proxy is None or not proxy.configured:
        return None
    if proxy.mode == "webshare":
        from youtube_transcript_api.proxies import WebshareProxyConfig
        return WebshareProxyConfig(
            proxy_username=proxy.username, proxy_password=proxy.password,
            filter_ip_locations=list(proxy.countries) or None,
            retries_when_blocked=max(0, int(proxy.retries_when_blocked)),
        )
    return _rotating_generic_class()(proxy.http_url, proxy.https_url, proxy.retries_when_blocked)


def _no_retry_adapter():
    from requests.adapters import HTTPAdapter
    from urllib3 import Retry
    # No transport retries at all: a hanging proxy costs one timeout, and a 429
    # comes back as a response the library turns into IpBlocked.
    return HTTPAdapter(max_retries=Retry(total=0, connect=0, read=0, redirect=0, status=0, other=0,
                                         status_forcelist=(), raise_on_status=False,
                                         respect_retry_after_header=False))


def make_api(proxy: Optional[ProxySettings]) -> Tuple[Any, Any]:
    """(YouTubeTranscriptApi, meter) for one attempt; ``proxy=None`` = direct.
    The meter is the session: ``bytes_in`` and ``set_deadline``."""
    from youtube_transcript_api import YouTubeTranscriptApi
    session = _session_class()()
    api = YouTubeTranscriptApi(proxy_config=make_proxy_config(proxy), http_client=session)
    # Replace the adapters the library mounted (Retry(total=n, status_forcelist=[429])).
    session.mount("http://", _no_retry_adapter())
    session.mount("https://", _no_retry_adapter())
    return api, session


# ── error mapping ────────────────────────────────────────────────────────────

_PRIVATE_WORDS = ("private", "members", "sign in", "sign-in", "log in")
# Geo-blocks stay transient: another proxy country can play the video.
_GEO_WORDS = ("in your country", "your country", "not available in your", "region")
# YouTube's rate-limit screen ("This content isn't available, try again later").
_RATE_LIMIT_WORDS = ("try again later", "content isn't available", "not available on this app")
# The video itself is gone (removed, terminated account, copyright / policy strike).
_GONE_WORDS = ("removed", "terminated", "no longer available", "isn't available anymore", "copyright",
               "violat", "deleted", "does not exist", "doesn't exist")
_BARE_UNAVAILABLE = ("video unavailable", "this video is unavailable", "this video isn't available anymore",
                     "this video is no longer available")


def _unplayable(exc: Any) -> Outcome:
    head = str(getattr(exc, "reason", "") or "").strip().lower()
    subs = [str(s).strip().lower() for s in (getattr(exc, "sub_reasons", None) or []) if str(s).strip()]
    reason = " ".join([head] + subs)
    if "bot" in reason:                      # "Sign in to confirm you're not a bot" (spelling variants)
        return Outcome.BLOCKED
    if "confirm your age" in reason or "inappropriate" in reason or "age-restricted" in reason:
        return Outcome.AGE_RESTRICTED
    if any(w in reason for w in _GEO_WORDS):
        return Outcome.UNPLAYABLE
    if any(w in reason for w in _RATE_LIMIT_WORDS):
        return Outcome.BLOCKED
    if any(w in reason for w in _GONE_WORDS):
        return Outcome.UNAVAILABLE
    if any(w in reason for w in _PRIVATE_WORDS):
        return Outcome.PRIVATE
    if head.rstrip(".") in _BARE_UNAVAILABLE and not subs:
        return Outcome.UNAVAILABLE
    return Outcome.UNPLAYABLE


def _is_407(exc: Any) -> bool:
    text = f"{getattr(exc, 'reason', '')} {exc}"
    return "407" in text or "proxy authentication required" in text.lower()


def classify(exc: BaseException):
    """Map a library / requests error to an Outcome, or SKIP for a candidate
    that cannot be produced (not translatable)."""
    from xml.etree.ElementTree import ParseError
    from youtube_transcript_api import _errors as E

    if isinstance(exc, (E.NotTranslatable, E.TranslationLanguageNotAvailable)):
        return SKIP
    if isinstance(exc, E.RequestBlocked):           # IpBlocked is a subclass
        return Outcome.BLOCKED
    if isinstance(exc, E.PoTokenRequired):
        return Outcome.PO_TOKEN
    if isinstance(exc, E.YouTubeDataUnparsable):
        return Outcome.UNPARSABLE
    if isinstance(exc, E.AgeRestricted):
        return Outcome.AGE_RESTRICTED
    if isinstance(exc, (E.TranscriptsDisabled, E.NoTranscriptFound)):
        return Outcome.NO_CAPTIONS
    if isinstance(exc, (E.VideoUnavailable, E.InvalidVideoId)):
        return Outcome.UNAVAILABLE
    if isinstance(exc, E.VideoUnplayable):
        return _unplayable(exc)
    if isinstance(exc, E.YouTubeRequestFailed):
        return Outcome.PROXY_AUTH if _is_407(exc) else Outcome.NETWORK
    if isinstance(exc, E.FailedToCreateConsentCookie):
        return Outcome.NETWORK
    if isinstance(exc, requests.exceptions.ProxyError):
        return Outcome.PROXY_AUTH if _is_407(exc) else Outcome.NETWORK
    if isinstance(exc, requests.exceptions.RetryError):
        # urllib3 retries ran out (only if some adapter retries status codes):
        # "too many 429 error responses" is YouTube rate-limiting the IP.
        return Outcome.BLOCKED if "429" in str(exc) else Outcome.NETWORK
    if isinstance(exc, requests.exceptions.Timeout):
        return Outcome.TIMEOUT
    if isinstance(exc, requests.exceptions.ConnectionError):
        return Outcome.NETWORK
    if isinstance(exc, ParseError) or type(exc).__name__ == "ParseError":
        return Outcome.EMPTY_BODY                    # a 200 with an empty / non-XML body
    logger.warning("yt_captions: unexpected error %s: %s", type(exc).__name__, str(exc)[:300], exc_info=True)
    return Outcome.NETWORK


def _short(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {str(exc).splitlines()[0][:160] if str(exc) else ''}"


# ── one route attempt ────────────────────────────────────────────────────────

def _num(raw: Any) -> float:
    try:
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def to_segments(snippets: Any) -> Tuple[CaptionSegment, ...]:
    out: List[CaptionSegment] = []
    for snip in snippets or []:
        if isinstance(snip, dict):
            text, start, dur = snip.get("text"), snip.get("start"), snip.get("duration")
        else:
            text, start, dur = getattr(snip, "text", ""), getattr(snip, "start", 0.0), getattr(snip, "duration", 0.0)
        t = str(text or "").strip()
        if not t:
            continue
        s, d = _num(start), _num(dur)
        start_ms = int(round(s * 1000))
        out.append(CaptionSegment(start_ms=start_ms, end_ms=max(start_ms, int(round((s + d) * 1000))), text=t))
    return tuple(out)


def fetch_route(video_id: str, route: str, proxy: Optional[ProxySettings], *,
                language: Optional[str] = None, strict: bool = False,
                deadline: Optional[float] = None) -> RouteAttempt:
    """List the tracks and fetch the best candidate through one fresh client.
    ``deadline`` (time.monotonic) bounds every request of the attempt. Never
    raises for a YouTube / network outcome."""
    t0 = time.monotonic()
    api, meter = make_api(proxy if route == "proxy" else None)
    setter = getattr(meter, "set_deadline", None)
    if deadline is not None and callable(setter):
        setter(deadline)

    def done(outcome: Outcome, **kw: Any) -> RouteAttempt:
        return RouteAttempt(route=route, outcome=outcome, bytes_in=int(getattr(meter, "bytes_in", 0) or 0),
                            ms=int((time.monotonic() - t0) * 1000), **kw)

    try:
        listing = api.list(video_id)
        transcripts = list(listing)
    except Exception as exc:  # noqa: BLE001 - classified below
        oc = classify(exc)
        return done(Outcome.NETWORK if oc == SKIP else oc, detail=_short(exc))

    tracks = [languages.Track(str(t.language_code), bool(t.is_generated), bool(getattr(t, "is_translatable", False)))
              for t in transcripts]
    available = languages.availability(tracks)
    if not tracks:
        return done(Outcome.NO_CAPTIONS, available=available, detail="no caption tracks listed")
    by_key = {(str(t.language_code), bool(t.is_generated)): t for t in transcripts}
    cands = languages.route_candidates(languages.pick(tracks, language, strict))
    if not cands:
        return done(Outcome.NO_CAPTIONS, available=available, detail="no track in the requested language")

    last: Optional[Outcome] = None
    last_detail: Optional[str] = None
    tried: List[str] = []
    for cand in cands:
        tr = by_key.get((cand.code, cand.is_generated))
        if tr is None:
            continue
        tried.append(f"{cand.code}:{cand.kind}")
        try:
            if cand.translate_to:
                tr = tr.translate(cand.translate_to)
            fetched = tr.fetch(preserve_formatting=False)
        except Exception as exc:  # noqa: BLE001
            oc = classify(exc)
            if oc == SKIP:
                continue
            if oc in (Outcome.PO_TOKEN, Outcome.EMPTY_BODY):
                last, last_detail = oc, _short(exc)
                continue                              # a track-level failure: next candidate
            return done(oc, available=available, detail=_short(exc), tracks_tried=tried)
        segs = to_segments(getattr(fetched, "snippets", fetched))
        if not segs:
            last, last_detail = Outcome.EMPTY_BODY, f"{cand.code}:{cand.kind} came back empty"
            continue
        lang = str(getattr(fetched, "language_code", None) or cand.translate_to or cand.code)
        return done(Outcome.OK, segments=segs, language=lang, kind=cand.kind,
                    translated_from=cand.code if cand.translate_to else None, available=available,
                    snippets=len(segs), tracks_tried=tried)
    return done(last or Outcome.NO_CAPTIONS, available=available, detail=last_detail or "no candidate track",
                tracks_tried=tried)


def is_deadline(attempt: RouteAttempt) -> bool:
    """The attempt stopped because the caller's budget ran out (not the route's fault)."""
    return attempt.outcome is Outcome.TIMEOUT and DEADLINE_DETAIL in (attempt.detail or "")


__all__ = ["ProxySettings", "RouteAttempt", "make_api", "make_proxy_config", "classify", "fetch_route",
           "to_segments", "is_deadline", "LIB_VERSION", "PROXY_MODES", "SKIP", "DEADLINE_DETAIL"]
