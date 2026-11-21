"""Shared YouTube caption service: the fallback chain, breakers, pools, Supadata.

No network and no DB: youtube-transcript-api is replaced through
youtube_lib.make_api (a fake API per attempt, so constructions are countable),
Supadata runs on httpx.MockTransport, the cache is an in-memory fake and the
config is a fixed Config. The real library's exception classes are raised by
the fakes, so the error mapping under test is the production one.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional

import httpx
import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from youtube_transcript_api import (  # noqa: E402
    AgeRestricted, IpBlocked, NoTranscriptFound, PoTokenRequired, RequestBlocked, TranscriptsDisabled,
    VideoUnavailable, VideoUnplayable, YouTubeDataUnparsable, YouTubeRequestFailed,
)

from app.services.youtube_captions import cache, guard, service, supadata, youtube_lib  # noqa: E402
from app.services.youtube_captions.service import Config  # noqa: E402
from app.services.youtube_captions.types import (  # noqa: E402
    NOTE_RETRY_AUTO, NOTE_RETRY_KB, NOTE_RETRY_TUTOR, NOTES, CaptionResult, CaptionSegment, CaptionsError, Outcome,
)
from app.services.youtube_captions.youtube_lib import ProxySettings  # noqa: E402

VID = "dQw4w9WgXcQ"
VID2 = "abcdefghijk"
USER, PASSWORD, SUPA_KEY = "wsuser-secret-77", "wspass-secret-88", "supa-secret-key-99"


def run(coro):
    return asyncio.run(coro)


# ── fakes ────────────────────────────────────────────────────────────────────

class Snip:
    def __init__(self, text: str, start: float, duration: float = 2.0) -> None:
        self.text, self.start, self.duration = text, start, duration


class FakeTranscript:
    def __init__(self, code: str, generated: bool, translatable: bool = False,
                 fetch: Optional[Callable[[], Any]] = None, log: Optional[list] = None) -> None:
        self.language_code, self.is_generated, self.is_translatable = code, generated, translatable
        self._fetch, self._log = fetch, log if log is not None else []

    def fetch(self, preserve_formatting: bool = False):
        self._log.append(f"{self.language_code}:{'auto' if self.is_generated else 'manual'}")
        if self._fetch is None:
            snippets = [Snip(f"{self.language_code} line {i}", i * 2.0) for i in range(3)]
        else:
            snippets = self._fetch()
        return SimpleNamespace(snippets=snippets, language_code=self.language_code)

    def translate(self, code: str):
        if not self.is_translatable:
            from youtube_transcript_api import NotTranslatable
            raise NotTranslatable(VID)
        return FakeTranscript(code, True, False, log=self._log)


class World:
    """Scripted behaviour per route. Each route entry is a list consumed per
    attempt (the last one repeats): a callable(video_id) returning a listing
    (list of FakeTranscript) or raising."""

    def __init__(self) -> None:
        self.routes: Dict[str, List[Callable[[str], Any]]] = {"direct": [], "proxy": []}
        self.made: Dict[str, int] = {"direct": 0, "proxy": 0}
        self.calls: Dict[str, int] = {"direct": 0, "proxy": 0}
        self.delay = 0.0
        self.active = 0
        self.peak = 0
        self._lock = threading.Lock()

    def set(self, route: str, *behaviours: Callable[[str], Any]) -> None:
        self.routes[route] = list(behaviours)

    def make_api(self, proxy):
        route = "direct" if proxy is None else "proxy"
        self.made[route] += 1
        world = self

        class Api:
            def list(self, video_id):
                with world._lock:
                    world.active += 1
                    world.peak = max(world.peak, world.active)
                try:
                    if world.delay:
                        time.sleep(world.delay)
                    seq = world.routes[route]
                    if not seq:
                        raise AssertionError(f"route {route} must not be called")
                    i = min(world.calls[route], len(seq) - 1)
                    world.calls[route] += 1
                    return seq[i](video_id)
                finally:
                    with world._lock:
                        world.active -= 1

        return Api(), SimpleNamespace(bytes_in=1000)


def listing(*tracks: FakeTranscript):
    return lambda vid: list(tracks)


def raises(exc_factory: Callable[[], BaseException]):
    def _f(vid):
        raise exc_factory()
    return _f


class FakeCache:
    def __init__(self) -> None:
        self.rows: Dict[str, CaptionResult] = {}
        self.writes: List[CaptionResult] = []
        self.credits = 0
        self.usage: List[int] = []
        self.proxy_bytes = 0
        self.proxy_usage: List[int] = []

    def read(self, vid, language=None, strict=False):
        hit = self.rows.get(cache.cache_key(vid, language, strict))
        if hit is None:
            return None
        return CaptionResult(**{**hit.__dict__, "route": "cache"})

    def write(self, result, *, language=None, strict=False, extra=None):
        if not cache.cacheable(result):
            return False
        self.writes.append(result)
        self.rows[cache.cache_key(result.video_id, language, strict)] = result
        return True

    def credits_today(self):
        return self.credits

    def record_usage(self, credits, vid, outcome):
        self.usage.append(credits)
        self.credits += credits
        return True

    def proxy_today(self):
        return self.proxy_bytes

    def record_proxy(self, bytes_in, vid, outcome):
        self.proxy_usage.append(bytes_in)
        self.proxy_bytes += bytes_in
        return True


@pytest.fixture
def world(monkeypatch):
    w = World()
    monkeypatch.setattr(youtube_lib, "make_api", w.make_api)
    return w


@pytest.fixture
def fcache(monkeypatch):
    c = FakeCache()
    monkeypatch.setattr(cache, "read", c.read)
    monkeypatch.setattr(cache, "write", c.write)
    monkeypatch.setattr(cache, "supadata_credits_today", c.credits_today)
    monkeypatch.setattr(cache, "record_supadata_usage", c.record_usage)
    monkeypatch.setattr(cache, "proxy_bytes_today", c.proxy_today)
    monkeypatch.setattr(cache, "record_proxy_usage", c.record_proxy)
    return c


@pytest.fixture
def cfg(monkeypatch):
    holder = {"cfg": Config(
        proxy=ProxySettings(mode="webshare", username=USER, password=PASSWORD, countries=("in",),
                            retries_when_blocked=4),
        outer_retries=2, supadata_enabled=False, supadata_key=SUPA_KEY,
        max_concurrent_batch=3, max_concurrent_interactive=2, max_per_minute=600,
    )}
    monkeypatch.setattr(service, "load_config", lambda: holder["cfg"])
    from app.services.youtube_captions.types import register_secrets
    register_secrets(USER, PASSWORD, SUPA_KEY)

    def set_(**kw):
        holder["cfg"] = Config(**{**holder["cfg"].__dict__, **kw})
    holder["set"] = set_
    return holder


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    guard.reset_for_tests()
    service._PROXY_SPEND.update(day=None, at=0.0, db=0, local=0)
    monkeypatch.setattr(service, "OUTER_BACKOFF_S", (0.0, 0.0))
    monkeypatch.setattr(supadata, "POLL_EVERY_S", 0.0)
    yield
    guard.reset_for_tests()


class Supa:
    """httpx.MockTransport for Supadata; ``responses`` consumed in order."""

    def __init__(self, monkeypatch, *responses: httpx.Response) -> None:
        self.responses = list(responses)
        self.requests: List[httpx.Request] = []
        monkeypatch.setattr(supadata, "make_client",
                            lambda: httpx.AsyncClient(transport=httpx.MockTransport(self._handle)))

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("unexpected Supadata request")
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]


def supa_ok(text="supadata line", lang="hi"):
    return httpx.Response(200, json={"lang": lang, "content": [
        {"text": text, "offset": 0, "duration": 1500, "lang": lang},
        {"text": "second", "offset": 1500, "duration": 1000, "lang": lang}]})


def en_manual(**kw):
    return FakeTranscript("en", False, True, **kw)


def hi_auto(**kw):
    return FakeTranscript("hi", True, True, **kw)


# ── the chain ────────────────────────────────────────────────────────────────

def test_cache_hit_makes_no_network_call(world, fcache, cfg):
    fcache.rows[VID] = CaptionResult(video_id=VID, outcome=Outcome.OK, segments=(CaptionSegment(0, 1, "cached"),),
                                     route="proxy", kind="manual")
    res = run(service.get_captions(f"https://youtu.be/{VID}", purpose="tutor"))
    assert res.outcome is Outcome.OK and res.route == "cache" and res.text == "cached"
    assert world.made == {"direct": 0, "proxy": 0}


def test_invalid_id_is_unavailable(world, fcache, cfg):
    res = run(service.get_captions("https://example.com/x", purpose="tutor"))
    assert res.outcome is Outcome.UNAVAILABLE and not res.transient and world.made["direct"] == 0


def test_unknown_purpose_is_a_programmer_error(world, fcache, cfg):
    with pytest.raises(ValueError):
        run(service.get_captions(VID, purpose="nope"))


def test_direct_blocked_falls_through_to_proxy(world, fcache, cfg):
    world.set("direct", raises(lambda: RequestBlocked(VID)))
    world.set("proxy", listing(en_manual()))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.OK and res.route == "proxy" and res.kind == "manual" and res.language == "en"
    assert res.segments[1] == CaptionSegment(2000, 4000, "en line 1")
    assert world.made == {"direct": 1, "proxy": 1} and fcache.writes[-1].outcome is Outcome.OK


def test_po_token_moves_to_next_candidate_then_supadata(world, fcache, cfg, monkeypatch):
    cfg["set"](supadata_enabled=True)
    log: List[str] = []
    world.set("direct", raises(lambda: IpBlocked(VID)))
    world.set("proxy", listing(FakeTranscript("en", False, True, fetch=lambda: (_ for _ in ()).throw(PoTokenRequired(VID)), log=log),
                               FakeTranscript("hi", True, True, fetch=lambda: (_ for _ in ()).throw(PoTokenRequired(VID)), log=log)))
    supa = Supa(monkeypatch, supa_ok())
    res = run(service.get_captions(VID, purpose="tutor"))
    assert log[:2] == ["en:manual", "hi:auto"]                 # second candidate tried after a PO token
    assert world.made["proxy"] == 2                            # PO_TOKEN retried with a fresh client (tutor: 1 retry)
    assert res.outcome is Outcome.OK and res.route == "supadata" and res.kind == "unknown" and res.language == "hi"
    assert len(supa.requests) == 1 and fcache.usage == [1]


def test_fetch_ip_blocked_is_wrapped_and_retried_with_a_fresh_client(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    attempts = {"n": 0}

    def flaky():
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise IpBlocked(VID)
        return [Snip("finally", 0.0)]

    world.set("proxy", listing(en_manual(fetch=flaky)))
    res = run(service.get_captions(VID, purpose="kb_ingest"))
    assert res.outcome is Outcome.OK and res.text == "finally"
    assert world.made["proxy"] == 2                            # a new client (new IP) per outer attempt


def test_empty_body_falls_back_and_is_never_no_captions(world, fcache, cfg):
    from xml.etree.ElementTree import ParseError
    cfg["set"](direct_enabled=False)
    world.set("proxy", listing(en_manual(fetch=lambda: [Snip("  ", 0.0)]),
                               hi_auto(fetch=lambda: (_ for _ in ()).throw(ParseError("no element found")))))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.EMPTY_BODY and res.transient and res.note == NOTE_RETRY_AUTO
    assert world.made["proxy"] == 3 and fcache.writes == []


def test_no_captions_is_cached_and_transient_is_not(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    world.set("proxy", raises(lambda: TranscriptsDisabled(VID)))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.NO_CAPTIONS and not res.transient and res.note == NOTES[Outcome.NO_CAPTIONS]
    assert [w.outcome for w in fcache.writes] == [Outcome.NO_CAPTIONS]
    world.set("proxy", raises(lambda: IpBlocked(VID2)))
    res2 = run(service.get_captions(VID2, purpose="course_knowledge"))
    assert res2.outcome is Outcome.BLOCKED and res2.transient and len(fcache.writes) == 1


def test_direct_no_captions_is_not_trusted_without_a_recent_direct_ok(world, fcache, cfg):
    world.set("direct", raises(lambda: TranscriptsDisabled(VID)))
    world.set("proxy", listing(hi_auto()))
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.OK and res.route == "proxy" and world.made["proxy"] == 1


def test_direct_no_captions_is_trusted_after_a_recent_direct_ok(world, fcache, cfg):
    guard.note_direct_ok()
    world.set("direct", raises(lambda: NoTranscriptFound(VID, ["en"], [])))
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.NO_CAPTIONS and not res.transient and world.made["proxy"] == 0


def test_unconfirmed_direct_no_captions_with_fallback_unavailable_is_transient(world, fcache, cfg):
    # A proxy is configured but its breaker is open: the answer waits for confirmation.
    guard.breaker("proxy").trip(600, "test")
    world.set("direct", raises(lambda: TranscriptsDisabled(VID)))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.NO_CAPTIONS and res.transient and fcache.writes == []
    assert res.fallback_configured and world.made["proxy"] == 0


@pytest.mark.parametrize("exc,outcome", [
    (lambda: TranscriptsDisabled(VID), Outcome.NO_CAPTIONS),
    (lambda: VideoUnavailable(VID), Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "Video unavailable", ["This video has been removed by the uploader"]),
     Outcome.UNAVAILABLE),
])
def test_no_fallback_direct_definitive_is_definitive_but_not_cached(world, fcache, cfg, exc, outcome):
    # No proxy, no Supadata: nothing could confirm it, so answer as before the
    # service existed (definitive, so course knowledge marks it EMPTY), unconfirmed, never cached.
    cfg["set"](proxy=ProxySettings(mode="off"))
    world.set("direct", raises(exc))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is outcome and not res.transient and res.note == NOTES[outcome]
    assert res.confirmed is False and res.fallback_configured is False and fcache.writes == []
    tutor = run(service.get_captions(VID, purpose="tutor"))
    assert tutor.note == NOTES[outcome]                       # not "blocked, try again"


def test_trusted_direct_definitive_is_confirmed_and_cached(world, fcache, cfg):
    cfg["set"](proxy=ProxySettings(mode="off"))
    guard.note_direct_ok()
    world.set("direct", raises(lambda: TranscriptsDisabled(VID)))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.NO_CAPTIONS and res.confirmed and [w.outcome for w in fcache.writes] == [Outcome.NO_CAPTIONS]


def test_age_restricted_skips_proxy_and_is_definitive(world, fcache, cfg):
    world.set("direct", raises(lambda: AgeRestricted(VID)))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.AGE_RESTRICTED and not res.transient and world.made["proxy"] == 0
    assert fcache.writes[-1].outcome is Outcome.AGE_RESTRICTED


def test_enabled_false_returns_disabled_but_cache_still_answers(world, fcache, cfg):
    cfg["set"](enabled=False)
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.DISABLED and res.transient and world.made == {"direct": 0, "proxy": 0}
    fcache.rows[VID] = CaptionResult(video_id=VID, outcome=Outcome.OK, segments=(CaptionSegment(0, 1, "x"),))
    assert run(service.get_captions(VID, purpose="tutor")).outcome is Outcome.OK


def test_network_false_is_cache_only(world, fcache, cfg):
    res = run(service.get_captions(VID, purpose="tutor", network=False))
    assert res.outcome is Outcome.DISABLED and world.made == {"direct": 0, "proxy": 0}


def test_require_captions_raises_a_value_error_with_the_note(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    world.set("proxy", raises(lambda: IpBlocked(VID)))
    with pytest.raises(ValueError) as err:
        run(service.require_captions(VID, purpose="tutor"))
    assert isinstance(err.value, CaptionsError) and str(err.value) == NOTE_RETRY_TUTOR
    assert "block" in str(err.value).lower()
    assert err.value.result.outcome is Outcome.BLOCKED


def test_notes_by_purpose(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    world.set("proxy", raises(lambda: IpBlocked(VID)))
    assert run(service.get_captions(VID, purpose="kb_ingest")).note == NOTE_RETRY_KB
    assert run(service.get_captions(VID, purpose="course_knowledge")).note == NOTE_RETRY_AUTO


# ── error mapping ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("exc,expected", [
    (lambda: IpBlocked(VID), Outcome.BLOCKED),
    (lambda: RequestBlocked(VID), Outcome.BLOCKED),
    (lambda: PoTokenRequired(VID), Outcome.PO_TOKEN),
    (lambda: YouTubeDataUnparsable(VID), Outcome.UNPARSABLE),
    (lambda: AgeRestricted(VID), Outcome.AGE_RESTRICTED),
    (lambda: TranscriptsDisabled(VID), Outcome.NO_CAPTIONS),
    (lambda: VideoUnavailable(VID), Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "This video is private", []), Outcome.PRIVATE),
    (lambda: VideoUnplayable(VID, "Join this channel to get access to members-only content", []), Outcome.PRIVATE),
    (lambda: VideoUnplayable(VID, "Sign in to confirm you're not a bot", []), Outcome.BLOCKED),
    (lambda: VideoUnplayable(VID, "Sign in to confirm your age", []), Outcome.AGE_RESTRICTED),
    (lambda: VideoUnplayable(VID, "Playback on other websites has been disabled", []), Outcome.UNPLAYABLE),
    (lambda: YouTubeRequestFailed(VID, requests.HTTPError("407 Client Error: Proxy Authentication Required")),
     Outcome.PROXY_AUTH),
    (lambda: YouTubeRequestFailed(VID, requests.HTTPError("500 Server Error")), Outcome.NETWORK),
    (lambda: requests.exceptions.ProxyError("Tunnel connection failed: 407 Proxy Authentication Required"),
     Outcome.PROXY_AUTH),
    (lambda: requests.exceptions.ReadTimeout("read timed out"), Outcome.TIMEOUT),
    (lambda: requests.exceptions.ConnectionError("reset"), Outcome.NETWORK),
    (lambda: RuntimeError("weird"), Outcome.NETWORK),
    # removed / terminated / struck videos are about the video, not about us
    (lambda: VideoUnplayable(VID, "Video unavailable", ["This video has been removed by the uploader"]),
     Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "Video unavailable", ["This video is no longer available because the YouTube "
                                                        "account associated with this video has been terminated."]),
     Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "Video unavailable", ["This video is no longer available due to a copyright "
                                                        "claim by XYZ"]), Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "This video has been removed for violating YouTube's Terms of Service", []),
     Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "This video isn't available anymore", []), Outcome.UNAVAILABLE),
    (lambda: VideoUnplayable(VID, "Video unavailable", []), Outcome.UNAVAILABLE),
    # geo-blocks stay transient (another proxy country may play it); the rate-limit screen is BLOCKED
    (lambda: VideoUnplayable(VID, "Video unavailable", ["The uploader has not made this video available in "
                                                        "your country"]), Outcome.UNPLAYABLE),
    (lambda: VideoUnplayable(VID, "This content isn't available, try again later.", []), Outcome.BLOCKED),
    # urllib3 429 retries ran out
    (lambda: requests.exceptions.RetryError("HTTPSConnectionPool(host='www.youtube.com', port=443): Max retries "
                                            "exceeded with url: /watch?v=x (Caused by ResponseError('too many 429 "
                                            "error responses'))"), Outcome.BLOCKED),
    (lambda: requests.exceptions.RetryError("Max retries exceeded (Caused by ResponseError('too many 500 error "
                                            "responses'))"), Outcome.NETWORK),
    (lambda: requests.exceptions.RetryError("Max retries exceeded"), Outcome.NETWORK),
])
def test_classify(exc, expected):
    assert youtube_lib.classify(exc()) is expected


def test_classify_not_translatable_is_skip():
    from youtube_transcript_api import NotTranslatable, TranslationLanguageNotAvailable
    assert youtube_lib.classify(NotTranslatable(VID)) == youtube_lib.SKIP
    assert youtube_lib.classify(TranslationLanguageNotAvailable(VID)) == youtube_lib.SKIP


def test_strict_translation_is_used_when_no_native_track(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    world.set("proxy", listing(hi_auto()))
    res = run(service.get_captions(VID, purpose="tutor", language="en", strict_language=True))
    assert res.outcome is Outcome.OK and res.kind == "translated" and res.translated_from == "hi"
    assert res.language == "en" and cache.cache_key(VID, "en", True) in fcache.rows


# ── PROXY_AUTH and breakers ──────────────────────────────────────────────────

def test_proxy_407_is_proxy_auth_and_opens_the_breaker(world, fcache, cfg, caplog):
    cfg["set"](direct_enabled=False)
    world.set("proxy", raises(lambda: requests.exceptions.ProxyError(
        "HTTPSConnectionPool: Tunnel connection failed: 407 Proxy Authentication Required")))
    with caplog.at_level(logging.ERROR):
        res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.PROXY_AUTH and res.transient and world.made["proxy"] == 1   # no outer retry
    snap = guard.breaker("proxy").snapshot()
    assert snap["state"] == "open" and 1700 < snap["seconds_left"] <= 1800
    assert "rejected our credentials" in caplog.text
    res2 = run(service.get_captions(VID2, purpose="tutor"))
    assert res2.outcome is Outcome.BLOCKED and res2.retry_after_s and world.made["proxy"] == 1


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_direct_breaker_opens_after_two_blocks_and_half_opens(world, fcache, cfg, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(guard, "_now", clock)
    # A fallback is configured (Supadata, but at its daily cap), so the direct breaker is used.
    cfg["set"](proxy=ProxySettings(mode="off"), supadata_enabled=True, supadata_daily_cap=0)
    world.set("direct", raises(lambda: IpBlocked(VID)))
    run(service.get_captions(VID, purpose="tutor", refresh=True))
    clock.t += 60
    run(service.get_captions(VID, purpose="tutor", refresh=True))
    assert guard.breaker("direct").snapshot()["state"] == "open" and world.made["direct"] == 2
    clock.t += 3600
    res = run(service.get_captions(VID, purpose="tutor", refresh=True))
    assert world.made["direct"] == 2 and res.outcome is Outcome.BLOCKED and res.retry_after_s > 3600 * 4
    clock.t += 6 * 3600                                         # cooldown over: one half-open request
    world.set("direct", listing(en_manual()))
    res = run(service.get_captions(VID, purpose="tutor", refresh=True))
    assert world.made["direct"] == 3 and res.outcome is Outcome.OK
    assert guard.breaker("direct").snapshot()["state"] == "closed" and guard.direct_trusted()


def test_no_fallback_direct_breaker_is_not_used(world, fcache, cfg, monkeypatch):
    # No proxy and no Supadata: every request tries direct, as before the service.
    clock = Clock()
    monkeypatch.setattr(guard, "_now", clock)
    cfg["set"](proxy=ProxySettings(mode="off"))
    world.set("direct", raises(lambda: IpBlocked(VID)))
    for _ in range(4):
        res = run(service.get_captions(VID, purpose="tutor", refresh=True))
        assert res.outcome is Outcome.BLOCKED and res.transient and not res.fallback_configured
        clock.t += 60
    assert world.made["direct"] == 4


def test_half_open_failure_reopens_and_admits_one_at_a_time(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(guard, "_now", clock)
    b = guard.Breaker("t", open_s=100, fail_count=2, fail_window_s=60)
    b.record(True)
    clock.t += 61                                               # outside the window: no trip
    b.record(True)
    assert b.state == "closed"
    b.record(True)
    assert b.state == "open"
    clock.t += 101
    assert b.allow() == (True, None) and b.state == "half_open"
    assert b.allow()[0] is False                                # one probe at a time
    b.record(True, "still blocked")
    assert b.state == "open" and b.allow()[0] is False


def test_proxy_ratio_breaker(monkeypatch):
    b = guard.Breaker("p", open_s=600, ratio_last=10, ratio_fails=5)
    for failed in (True, False, True, False, True, False, True):
        b.record(failed)
    assert b.state == "closed"
    b.record(True)
    assert b.state == "open"


# ── capacity ─────────────────────────────────────────────────────────────────

def test_batch_pool_cap_holds_and_interactive_is_not_starved(world, fcache, cfg):
    cfg["set"](direct_enabled=False, max_concurrent_batch=2, max_concurrent_interactive=1)
    world.delay = 0.15
    world.set("proxy", listing(en_manual()))
    vids = [f"vid{i:08d}" for i in range(6)]
    times: Dict[str, float] = {}

    async def main():
        t0 = time.monotonic()

        async def one(v, purpose):
            await service.get_captions(v, purpose=purpose)
            times[v] = time.monotonic() - t0

        batch = [asyncio.create_task(one(v, "course_knowledge")) for v in vids]
        await asyncio.sleep(0.02)
        await one("interact001", "tutor")
        await asyncio.gather(*batch)
        return guard.pool("course_knowledge").peak, guard.pool("tutor").peak

    batch_peak, interactive_peak = run(main())
    assert batch_peak == 2 and interactive_peak == 1
    assert world.peak <= 3
    assert times["interact001"] < 0.4                         # did not wait behind 6 batch fetches (~0.45 s)


def test_single_flight_two_concurrent_calls_fetch_once(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    world.delay = 0.1
    world.set("proxy", listing(en_manual()))

    async def main():
        return await asyncio.gather(service.get_captions(VID, purpose="tutor"),
                                    service.get_captions(VID, purpose="course_knowledge"))

    a, b = run(main())
    assert a.outcome is Outcome.OK and b.outcome is Outcome.OK and world.made["proxy"] == 1
    assert {a.route, b.route} == {"proxy", "cache"}


def test_busy_when_no_slot_frees_up(world, fcache, cfg, monkeypatch):
    monkeypatch.setattr(service, "INTERACTIVE_SLOT_WAIT_S", 0.05)
    cfg["set"](direct_enabled=False, max_concurrent_interactive=1)
    world.delay = 1.0   # wide margins: the full suite runs under load
    world.set("proxy", listing(en_manual()))

    async def main():
        first = asyncio.create_task(service.get_captions(VID, purpose="tutor"))
        await asyncio.sleep(0.3)   # let the first call take the only slot
        second = await service.get_captions(VID2, purpose="tutor")
        return await first, second

    first, second = run(main())
    assert first.outcome is Outcome.OK
    assert second.outcome is Outcome.BUSY and second.transient and fcache.writes == [first]


# ── Supadata ─────────────────────────────────────────────────────────────────

@pytest.fixture
def supa_only(cfg):
    cfg["set"](direct_enabled=False, proxy=ProxySettings(mode="off"), supadata_enabled=True)
    return cfg


def test_supadata_200_always_native(world, fcache, supa_only, monkeypatch):
    supa = Supa(monkeypatch, supa_ok())
    res = run(service.get_captions(VID, purpose="course_knowledge", language="hi"))
    assert res.outcome is Outcome.OK and res.route == "supadata" and res.segments[0] == CaptionSegment(0, 1500, "supadata line")
    req = supa.requests[0]
    assert req.url.params["mode"] == "native" and req.url.params["lang"] == "hi"
    assert req.headers["x-api-key"] == SUPA_KEY and SUPA_KEY not in str(req.url)


def test_supadata_202_then_polls(world, fcache, supa_only, monkeypatch):
    supa = Supa(monkeypatch, httpx.Response(202, json={"jobId": "job-1"}),
                httpx.Response(200, json={"status": "active"}),
                httpx.Response(200, json={"status": "completed", "lang": "en",
                                          "content": [{"text": "done", "offset": 0, "duration": 10}]}))
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.OK and res.text == "done"
    assert [r.url.path for r in supa.requests] == ["/v1/transcript", "/v1/transcript/job-1", "/v1/transcript/job-1"]


def test_supadata_206_is_trusted_no_captions(world, fcache, supa_only, monkeypatch):
    Supa(monkeypatch, httpx.Response(206, json={"error": "transcript-unavailable"}))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.NO_CAPTIONS and not res.transient and fcache.usage == [1]
    assert fcache.writes[-1].outcome is Outcome.NO_CAPTIONS


def test_supadata_402_opens_its_breaker(world, fcache, supa_only, monkeypatch, caplog):
    supa = Supa(monkeypatch, httpx.Response(402, json={"error": "payment-required"}))
    with caplog.at_level(logging.ERROR):
        res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.transient and guard.breaker("supadata").snapshot()["state"] == "open"
    assert "Supadata rejected" in caplog.text and SUPA_KEY not in caplog.text
    res2 = run(service.get_captions(VID2, purpose="course_knowledge"))
    assert res2.outcome is Outcome.BLOCKED and len(supa.requests) == 1


def test_supadata_429_uses_retry_after(world, fcache, supa_only, monkeypatch):
    Supa(monkeypatch, httpx.Response(429, headers={"retry-after": "120"}))
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.BUSY and 110 < guard.breaker("supadata").snapshot()["seconds_left"] <= 120


def test_supadata_daily_cap_blocks_calls(world, fcache, supa_only, monkeypatch):
    supa_only["set"](supadata_daily_cap=5)
    fcache.credits = 5
    supa = Supa(monkeypatch, supa_ok())
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.DISABLED and res.transient and supa.requests == []


def test_supadata_never_after_trusted_no_captions(world, fcache, cfg, monkeypatch):
    cfg["set"](direct_enabled=False, supadata_enabled=True)
    world.set("proxy", raises(lambda: TranscriptsDisabled(VID)))
    supa = Supa(monkeypatch, supa_ok())
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.NO_CAPTIONS and supa.requests == []


def test_supadata_after_proxy_blocked(world, fcache, cfg, monkeypatch):
    cfg["set"](direct_enabled=False, supadata_enabled=True, outer_retries=0)
    world.set("proxy", raises(lambda: IpBlocked(VID)))
    Supa(monkeypatch, supa_ok())
    res = run(service.get_captions(VID, purpose="tutor"))
    assert res.outcome is Outcome.OK and res.route == "supadata"


# ── secrets ──────────────────────────────────────────────────────────────────

def test_no_secret_in_logs_or_health(world, fcache, cfg, monkeypatch, caplog):
    cfg["set"](supadata_enabled=True)
    proxy_url = f"http://{USER}-IN-rotate:{PASSWORD}@p.webshare.io:80/"
    world.set("direct", raises(lambda: RuntimeError(f"boom via {proxy_url}")))
    world.set("proxy", raises(lambda: requests.exceptions.ProxyError(f"Cannot connect to proxy {proxy_url}: 407")))
    Supa(monkeypatch, httpx.Response(401, json={"error": "invalid key " + SUPA_KEY}))
    with caplog.at_level(logging.DEBUG):
        run(service.get_captions(VID, purpose="tutor"))
        for _ in range(2):
            guard._last_summary = None
            run(service.get_captions(VID2, purpose="course_knowledge", refresh=True))
    text = caplog.text + "".join(str(r.exc_text or "") for r in caplog.records)
    for secret in (USER, PASSWORD, SUPA_KEY):
        assert secret not in text
    health = json.dumps(service.health_snapshot(include_db=False), default=str)
    for secret in (USER, PASSWORD, SUPA_KEY):
        assert secret not in health
    assert '"proxy_configured": true' in health and '"supadata_key_present": true' in health


def test_make_proxy_config_rotates_and_retries():
    rot = youtube_lib.make_proxy_config(ProxySettings(mode="generic", http_url="http://u:p@h:1",
                                                      retries_when_blocked=3))
    assert rot.prevent_keeping_connections_alive is True and rot.retries_when_blocked == 3
    ws = youtube_lib.make_proxy_config(ProxySettings(mode="webshare", username="u", password="p",
                                                     countries=("in", "us"), retries_when_blocked=4))
    assert ws.retries_when_blocked == 4 and "-IN-US-rotate" in ws.url
    assert youtube_lib.make_proxy_config(ProxySettings(mode="webshare")) is None


def test_real_make_api_sets_a_default_timeout():
    api, session = youtube_lib.make_api(None)
    seen = {}

    class FakeAdapter(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            seen.update(kwargs)
            resp = requests.Response()
            resp.status_code, resp._content, resp.url = 200, b"abc", request.url
            resp.request = request
            return resp

        def close(self):
            pass

    session.mount("https://", FakeAdapter())
    session.get("https://www.youtube.com/watch?v=x")
    assert seen["timeout"] == (youtube_lib.CONNECT_TIMEOUT_S, youtube_lib.READ_TIMEOUT_S)
    assert session.bytes_in == 3


# ── tutor messages per outcome ───────────────────────────────────────────────

@pytest.mark.parametrize("outcome,transient,expected", [
    (Outcome.BLOCKED, True, NOTE_RETRY_TUTOR),
    (Outcome.PO_TOKEN, True, NOTE_RETRY_TUTOR),
    (Outcome.BUSY, True, NOTE_RETRY_TUTOR),
    (Outcome.NO_CAPTIONS, True, NOTE_RETRY_TUTOR),            # unconfirmed: retry, never "no captions"
    (Outcome.NO_CAPTIONS, False, NOTES[Outcome.NO_CAPTIONS]),
    (Outcome.PRIVATE, False, NOTES[Outcome.PRIVATE]),
    (Outcome.AGE_RESTRICTED, False, NOTES[Outcome.AGE_RESTRICTED]),
    (Outcome.UNAVAILABLE, False, NOTES[Outcome.UNAVAILABLE]),
])
def test_tutor_resolve_free_text_message_per_outcome(monkeypatch, outcome, transient, expected):
    from app.services.tutor import source_text
    from app.services.tutor.slide_source import SlideSource
    monkeypatch.setattr(source_text, "_cached", lambda vendor, key: None)
    stored = []
    monkeypatch.setattr(source_text, "_store", lambda *a, **k: stored.append(a))

    async def fake_require(video, **kw):
        assert kw["purpose"] == "tutor"
        raise CaptionsError(CaptionResult(video_id=VID, outcome=outcome, transient=transient))

    monkeypatch.setattr(service, "require_captions", fake_require)
    src = SlideSource(slide_id="s1", title="t", source_type="VIDEO", source_id=None, kind="video",
                      media_url=f"https://www.youtube.com/watch?v={VID}")
    run(source_text.resolve_free_text(src))
    assert src.text_note == expected and not src.text and stored == []


def test_tutor_ok_uses_service_text_and_writes_no_tutor_row(monkeypatch):
    from app.services.tutor import source_text
    from app.services.tutor.slide_source import SlideSource
    monkeypatch.setattr(source_text, "_cached", lambda vendor, key: None)
    stored = []
    monkeypatch.setattr(source_text, "_store", lambda *a, **k: stored.append(a))

    async def fake_require(video, **kw):
        return CaptionResult(video_id=VID, outcome=Outcome.OK, segments=(CaptionSegment(0, 1, "hello class"),))

    monkeypatch.setattr(service, "require_captions", fake_require)
    src = SlideSource(slide_id="s1", title="t", source_type="VIDEO", source_id=None, kind="video",
                      media_url=f"https://youtu.be/{VID}")
    run(source_text.resolve_free_text(src))
    assert src.text == "hello class" and src.text_kind == "captions" and stored == []


# ── review fixes: proxy breaker, transport retries, deadline, budget, Supadata 404 ──

def test_proxy_network_failures_open_the_proxy_breaker(world, fcache, cfg):
    # A refused / dropped proxy (ProxyError without 407) is NETWORK and counts as a failure.
    cfg["set"](direct_enabled=False, outer_retries=0)
    world.set("proxy", raises(lambda: requests.exceptions.ProxyError("Cannot connect to proxy: refused")))
    for i in range(5):
        res = run(service.get_captions(f"vid{i:08d}", purpose="course_knowledge"))
        assert res.outcome is Outcome.NETWORK and res.transient
    assert guard.breaker("proxy").snapshot()["state"] == "open"
    res = run(service.get_captions("vidzzzzzzzz", purpose="course_knowledge"))
    assert res.outcome is Outcome.BLOCKED and res.retry_after_s and world.made["proxy"] == 5


def test_interactive_callers_get_fewer_proxy_retries(world, fcache, cfg, monkeypatch):
    seen = []
    real = service._lib_attempt

    async def spy(vid, route, cfg_, language, strict, deadline=None, proxy=None):
        seen.append((route, proxy.retries_when_blocked if proxy else None, deadline))
        return await real(vid, route, cfg_, language, strict, deadline=deadline, proxy=proxy)

    monkeypatch.setattr(service, "_lib_attempt", spy)
    cfg["set"](direct_enabled=False)
    world.set("proxy", raises(lambda: IpBlocked(VID)))
    run(service.get_captions(VID, purpose="tutor"))
    assert [r for r in seen] and all(r[1] == service.INTERACTIVE_LIB_RETRIES for r in seen)
    assert len(seen) == 1 + service.INTERACTIVE_OUTER_RETRIES and all(r[2] for r in seen)
    seen.clear()
    run(service.get_captions(VID2, purpose="course_knowledge"))
    assert len(seen) == 3 and all(r[1] == 4 for r in seen)


def test_proxy_bytes_are_recorded_per_run(world, fcache, cfg):
    cfg["set"](direct_enabled=False)
    world.set("proxy", raises(lambda: IpBlocked(VID)))
    run(service.get_captions(VID, purpose="course_knowledge"))
    assert fcache.proxy_usage == [3000]                        # 3 attempts x 1000 bytes, one usage row


def test_proxy_daily_budget_skips_the_proxy(world, fcache, cfg, monkeypatch):
    cfg["set"](direct_enabled=False, proxy_daily_mb=1)
    fcache.proxy_bytes = 1024 * 1024
    world.set("proxy", listing(en_manual()))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.BLOCKED and res.transient and res.retry_after_s > 0
    assert world.made["proxy"] == 0
    # Supadata (its own cap) still runs when the proxy budget is spent.
    cfg["set"](supadata_enabled=True)
    Supa(monkeypatch, supa_ok())
    res = run(service.get_captions(VID2, purpose="course_knowledge"))
    assert res.outcome is Outcome.OK and res.route == "supadata" and world.made["proxy"] == 0
    rows = run(service.probe([VID], ["proxy"]))
    assert rows[0]["outcome"] == "DISABLED" and "budget" in rows[0]["note"]


def test_proxy_budget_unreadable_fails_closed(world, fcache, cfg, monkeypatch):
    cfg["set"](direct_enabled=False)
    monkeypatch.setattr(cache, "proxy_bytes_today", lambda: None)
    world.set("proxy", listing(en_manual()))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.BLOCKED and world.made["proxy"] == 0


def test_proxy_budget_counts_local_spend_between_db_reads(world, fcache, cfg, monkeypatch):
    cfg["set"](direct_enabled=False, proxy_daily_mb=1)
    reads = []
    monkeypatch.setattr(cache, "proxy_bytes_today", lambda: reads.append(1) or 0)
    monkeypatch.setattr(cache, "record_proxy_usage", lambda b, v, o: True)
    big = SimpleNamespace(bytes_in=2 * 1024 * 1024)
    monkeypatch.setattr(youtube_lib, "make_api", lambda proxy: (SimpleNamespace(list=lambda v: [en_manual()]), big))
    assert run(service.get_captions(VID, purpose="course_knowledge")).outcome is Outcome.OK
    res = run(service.get_captions(VID2, purpose="course_knowledge"))
    assert res.outcome is Outcome.BLOCKED and len(reads) == 1  # local spend counted without a DB re-read


def test_make_api_mounts_no_transport_retries():
    # youtube-transcript-api mounts Retry(total=n, status_forcelist=[429]) for a proxy config; we replace it.
    api, session = youtube_lib.make_api(ProxySettings(mode="generic", http_url="http://u:p@127.0.0.1:9",
                                                      https_url="http://u:p@127.0.0.1:9", retries_when_blocked=4))
    retry = session.get_adapter("https://www.youtube.com").max_retries
    assert retry.total == 0 and not retry.status_forcelist


def test_session_deadline_cuts_timeouts_and_stops_requests():
    api, session = youtube_lib.make_api(None)
    seen = {}

    class FakeAdapter(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            seen.update(kwargs)
            resp = requests.Response()
            resp.status_code, resp._content, resp.url, resp.request = 200, b"x", request.url, request
            return resp

        def close(self):
            pass

    session.mount("https://", FakeAdapter())
    session.set_deadline(time.monotonic() + 2.0)
    session.get("https://www.youtube.com/watch?v=x")
    connect, read = seen["timeout"]
    assert connect <= 2.0 and read <= 2.0
    session.set_deadline(time.monotonic() - 1)
    with pytest.raises(requests.exceptions.Timeout) as err:
        session.get("https://www.youtube.com/watch?v=x")
    assert youtube_lib.classify(err.value) is Outcome.TIMEOUT


def test_youtube_429_is_blocked_not_network(monkeypatch):
    real = youtube_lib.make_api

    class TooMany(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            resp = requests.Response()
            resp.status_code, resp._content, resp.url, resp.request = 429, b"", request.url, request
            return resp

        def close(self):
            pass

    def make(proxy):
        api, session = real(proxy)
        session.mount("https://", TooMany())
        return api, session

    monkeypatch.setattr(youtube_lib, "make_api", make)
    a = youtube_lib.fetch_route(VID, "direct", None, deadline=time.monotonic() + 5)
    assert a.outcome is Outcome.BLOCKED


def test_hanging_proxy_is_bounded_by_the_deadline():
    """A proxy that accepts and never answers: one connection, back within the deadline."""
    import socket
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(16)
    port = srv.getsockname()[1]
    conns = []
    stop = threading.Event()

    def accept():
        srv.settimeout(0.2)
        while not stop.is_set():
            try:
                c, _ = srv.accept()
                conns.append(c)
            except OSError:
                continue

    t = threading.Thread(target=accept, daemon=True)
    t.start()
    try:
        url = f"http://u:p@127.0.0.1:{port}"
        proxy = ProxySettings(mode="generic", http_url=url, https_url=url, retries_when_blocked=4)
        t0 = time.monotonic()
        a = youtube_lib.fetch_route(VID, "proxy", proxy, deadline=t0 + 1.5)
        elapsed = time.monotonic() - t0
    finally:
        stop.set()
        t.join(2)
        for c in conns:
            c.close()
        srv.close()
    assert elapsed < 2.5, elapsed
    assert len(conns) == 1                                     # no transport retries
    assert a.outcome in (Outcome.TIMEOUT, Outcome.NETWORK) and a.outcome in service.PROXY_FAILURES


def test_supadata_bare_404_is_transient_and_pauses_supadata(world, fcache, supa_only, monkeypatch, caplog):
    supa = Supa(monkeypatch, httpx.Response(404, text="Not Found"))
    with caplog.at_level(logging.ERROR):
        res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.NETWORK and res.transient and fcache.writes == []
    assert "/v1/transcript" in caplog.text and "endpoint" in caplog.text
    assert guard.breaker("supadata").snapshot()["state"] == "open"
    run(service.get_captions(VID2, purpose="course_knowledge"))
    assert len(supa.requests) == 1


@pytest.mark.parametrize("code,outcome", [
    ("transcript-unavailable", Outcome.NO_CAPTIONS),
    ("not-found", Outcome.UNAVAILABLE),
])
def test_supadata_404_with_a_known_code(world, fcache, supa_only, monkeypatch, code, outcome):
    Supa(monkeypatch, httpx.Response(404, json={"error": code, "message": "x"}))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is outcome and not res.transient and fcache.writes[-1].outcome is outcome
    assert guard.breaker("supadata").snapshot()["state"] == "closed"


def test_supadata_404_unknown_code_is_transient(world, fcache, supa_only, monkeypatch):
    Supa(monkeypatch, httpx.Response(404, json={"error": "route-not-found"}))
    res = run(service.get_captions(VID, purpose="course_knowledge"))
    assert res.outcome is Outcome.NETWORK and res.transient and fcache.writes == []


def test_supadata_respects_the_deadline():
    a = run(supadata.fetch(VID, "k", deadline=time.monotonic() - 1))
    assert a.outcome is Outcome.TIMEOUT and a.credits == 0
